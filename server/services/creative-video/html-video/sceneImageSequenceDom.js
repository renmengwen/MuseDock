const MODES = new Set(['fullscreen_relay', 'overview_detail', 'semantic_compare', 'rhythm_montage']);
const { buildPlaybackClockSource } = require('./playbackClock');
const START_MARKER = '<!-- hv-image-sequence:start -->';
const END_MARKER = '<!-- hv-image-sequence:end -->';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fail(message, details = {}) {
  return {
    success: false,
    code: 'frame_html_shot_contract_invalid',
    message,
    retryable: true,
    repair_action: 'retry_frame_html',
    fallback_allowed: false,
    details: { validation_code: 'frame_html_shot_contract_invalid', ...details },
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stable(value[key]);
      return result;
    }, {});
  }
  return value;
}

function canonicalSequence(node = {}) {
  const beats = Array.isArray(node?.metadata?.visual_beats)
    ? node.metadata.visual_beats
    : [node?.metadata?.visual_beat].filter(Boolean);
  const sequences = beats
    .map(beat => beat?.visual_base)
    .filter(base => base?.type === 'image_sequence');
  if (!sequences.length) return { success: true, sequence: null };
  if (sequences.length !== beats.length) return fail('同一 Scene 的多个 Beat 未共享完整 Image Sequence。');
  const signature = JSON.stringify(stable(sequences[0]));
  if (sequences.some(sequence => JSON.stringify(stable(sequence)) !== signature)) {
    return fail('同一 Scene 的多个 Beat 使用了不一致的 Image Sequence。');
  }
  return { success: true, sequence: sequences[0] };
}

function registryMap(creativeContext = {}) {
  const entries = Array.isArray(creativeContext?.asset_context?.assets)
    ? creativeContext.asset_context.assets
    : [];
  const map = new Map();
  for (const asset of entries) {
    const id = String(asset?.id || asset?.asset_id || '').trim();
    if (!id || map.has(id)) continue;
    map.set(id, asset);
  }
  return map;
}

function registrySrc(asset = {}) {
  const src = String(asset.frame_src || (asset.path ? `../${asset.path}` : '')).trim().replace(/\\/g, '/');
  if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src) || src.startsWith('/')) return '';
  return src;
}

function normalizeContract(node, creativeContext) {
  const resolved = canonicalSequence(node);
  if (!resolved.success || !resolved.sequence) return resolved;
  const sequence = resolved.sequence;
  const mode = String(sequence.sequence_mode || '').trim();
  const shots = Array.isArray(sequence.shots) ? sequence.shots : [];
  if (!MODES.has(mode)) return fail(`Image Sequence mode 无效：${mode || '空值'}。`);
  if (shots.length < 1 || shots.length > 4) return fail('Image Sequence 必须包含 1～4 个 Shot。');
  if (mode === 'semantic_compare' && shots.length !== 2) return fail('semantic_compare 必须恰好包含两个 Shot。');
  if (mode === 'overview_detail' && shots.length < 2) return fail('overview_detail 必须至少包含两个 Shot。');
  if (mode === 'rhythm_montage' && shots.length < 2) return fail('rhythm_montage 必须包含 2～4 个 Shot。');

  const assets = registryMap(creativeContext);
  const ids = new Set();
  const normalized = [];
  for (const shot of shots) {
    const id = String(shot?.id || '').trim();
    const assetId = String(shot?.asset_id || '').trim();
    const window = shot?.active_window || {};
    const start = Number(window.start_sec);
    const end = Number(window.end_sec);
    const minimum = Number(shot?.minimum_visible_duration_sec);
    if (!id || ids.has(id)) return fail(`Shot ID 缺失或重复：${id || '空值'}。`);
    ids.add(id);
    if (window.time_base !== 'scene_local' || !Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start) {
      return fail(`Shot ${id} 的 scene-local active_window 无效。`);
    }
    if (!Number.isFinite(minimum) || minimum <= 0 || end - start + 1e-6 < minimum) {
      return fail(`Shot ${id} 未满足最短可见时长。`);
    }
    const asset = assets.get(assetId);
    const src = registrySrc(asset);
    const mediaType = String(asset?.media_type || asset?.type || '').toLowerCase();
    if (!asset || (mediaType && mediaType !== 'image' && !mediaType.startsWith('image/')) || asset.status === 'failed' || !src) {
      return fail(`Shot ${id} 引用了未登记或不可用的图片素材 ${assetId || '空值'}。`);
    }
    normalized.push({
      id,
      asset_id: assetId,
      role: String(shot.role || ''),
      requirement: String(shot.requirement || ''),
      caption_ids: (Array.isArray(shot.caption_ids) ? shot.caption_ids : []).map(value => String(value)),
      minimum_visible_duration_sec: minimum,
      start_sec: start,
      end_sec: end,
      src,
    });
  }
  if (mode === 'semantic_compare' && (
    normalized[0].start_sec !== normalized[1].start_sec
    || normalized[0].end_sec !== normalized[1].end_sec
  )) return fail('semantic_compare 的两个 Shot 必须共享同一并行时间窗。');
  if (mode === 'overview_detail') {
    const overview = normalized[0];
    if (normalized.slice(1).some(shot => shot.start_sec < overview.start_sec || shot.end_sec > overview.end_sec)) {
      return fail('overview_detail 的 overview Shot 必须覆盖所有 detail 时间窗。');
    }
  }
  return {
    success: true,
    contract: {
      scene_id: String(node?.scene_id || node?.metadata?.scene_id || node?.id || '').replace(/^scene:/, ''),
      mode,
      shots: normalized,
    },
  };
}

function buildShotTimelineSource() {
  return `(function () {
  var shots = Array.prototype.slice.call(document.querySelectorAll('[data-hv-shot]'));
  function render(t) {
    var anyShot = false;
    for (var i = 0; i < shots.length; i++) {
      var start = Number(shots[i].dataset.windowStartSec);
      var end = Number(shots[i].dataset.windowEndSec);
      var visible = Number.isFinite(start) && Number.isFinite(end) && t >= start && t < end;
      if (visible) { shots[i].dataset.shotActive = 'true'; anyShot = true; }
      else delete shots[i].dataset.shotActive;
    }
    if (!anyShot && shots.length) {
      var fallback = shots[0];
      for (var j = 0; j < shots.length; j++) {
        if (t >= Number(shots[j].dataset.windowStartSec)) fallback = shots[j];
      }
      fallback.dataset.shotActive = 'true';
    }
  }
  window.__mpSetTimelineTime = function (timeSec) { window.__hvPlaybackClock.setTime(timeSec); };
  window.__hvPlaybackClock.subscribe(render);
})();`;
}

function renderDom(contract) {
  const figures = contract.shots.map(shot => [
    `<figure data-hv-shot="true" data-shot-id="${escapeHtml(shot.id)}" data-asset-id="${escapeHtml(shot.asset_id)}" data-window-start-sec="${escapeHtml(shot.start_sec)}" data-window-end-sec="${escapeHtml(shot.end_sec)}" data-time-base="scene_local" data-shot-role="${escapeHtml(shot.role)}" data-shot-requirement="${escapeHtml(shot.requirement)}" data-caption-ids="${escapeHtml(shot.caption_ids.join(','))}" data-minimum-visible-duration-sec="${escapeHtml(shot.minimum_visible_duration_sec)}">`,
    `<img data-shot-layer="background" src="${escapeHtml(shot.src)}" alt="" aria-hidden="true">`,
    `<img data-shot-layer="foreground" src="${escapeHtml(shot.src)}" alt="">`,
    '</figure>',
  ].join('')).join('');
  return [
    START_MARKER,
    '<style data-hv-image-sequence-style="true">',
    '[data-hv-image-sequence]{position:absolute;inset:0;z-index:1;overflow:hidden;pointer-events:none}',
    '[data-hv-shot]{position:absolute;inset:0;margin:0;opacity:0;visibility:hidden;transition:opacity .35s ease,transform .35s ease;transform:translate3d(0,8px,0)}',
    '[data-hv-shot][data-shot-active="true"]{opacity:1;visibility:visible;transform:none}',
    '[data-hv-shot] img{position:absolute;inset:0;width:100%;height:100%}',
    '[data-shot-layer="background"]{object-fit:cover;filter:blur(18px);transform:scale(1.04);opacity:.42}',
    '[data-shot-layer="foreground"]{object-fit:contain}',
    '[data-sequence-mode="semantic_compare"]{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:18px;box-sizing:border-box}',
    '[data-sequence-mode="semantic_compare"] [data-hv-shot]{position:relative;grid-row:1}',
    '[data-sequence-mode="semantic_compare"] [data-hv-shot]:nth-of-type(1){grid-column:1}',
    '[data-sequence-mode="semantic_compare"] [data-hv-shot]:nth-of-type(2){grid-column:2}',
    '[data-sequence-mode="overview_detail"] [data-hv-shot]:not(:first-child){inset:10% 6% 10% 48%}',
    '</style>',
    `<section data-hv-image-sequence="true" data-sequence-mode="${escapeHtml(contract.mode)}" data-scene-id="${escapeHtml(contract.scene_id)}">`,
    figures,
    '</section>',
    `<script data-hv-shot-clock="true">${buildPlaybackClockSource()}${buildShotTimelineSource()}<\/script>`,
    END_MARKER,
  ].join('');
}

function markerRange(html) {
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if ((start < 0) !== (end < 0)) return null;
  if (start < 0) return { start: -1, end: -1 };
  if (html.indexOf(START_MARKER, start + 1) >= 0 || html.indexOf(END_MARKER, end + 1) >= 0 || end < start) return null;
  return { start, end: end + END_MARKER.length };
}

function validateSceneImageSequenceDom(html, { node = {}, creativeContext = {} } = {}) {
  const normalized = normalizeContract(node, creativeContext);
  if (!normalized.success || !normalized.contract) return normalized;
  const text = String(html || '');
  const range = markerRange(text);
  if (!range || range.start < 0) return fail('Frame HTML 缺少受管 Image Sequence DOM。');
  const managed = text.slice(range.start, range.end);
  if ((text.match(/<section\b[^>]*\bdata-hv-image-sequence\s*=/gi) || []).length !== 1) return fail('Frame HTML 的 Image Sequence 根节点数量不等于 1。');
  if ((text.match(/<figure\b[^>]*\bdata-hv-shot\s*=/gi) || []).length !== normalized.contract.shots.length) return fail('Frame HTML 的 Shot DOM 数量与计划不一致。');
  if (!managed.includes(`data-sequence-mode="${escapeHtml(normalized.contract.mode)}"`)) return fail('Frame HTML 的 Sequence Mode 与计划不一致。');
  let cursor = 0;
  for (const shot of normalized.contract.shots) {
    const id = `data-shot-id="${escapeHtml(shot.id)}"`;
    const at = managed.indexOf(id, cursor);
    if (at < 0) return fail(`Frame HTML 缺少 Shot ${shot.id} 或顺序错误。`);
    const figureEnd = managed.indexOf('</figure>', at);
    const figure = managed.slice(at, figureEnd);
    const required = [
      `data-asset-id="${escapeHtml(shot.asset_id)}"`,
      `data-window-start-sec="${escapeHtml(shot.start_sec)}"`,
      `data-window-end-sec="${escapeHtml(shot.end_sec)}"`,
      'data-time-base="scene_local"',
      `data-shot-role="${escapeHtml(shot.role)}"`,
      `data-shot-requirement="${escapeHtml(shot.requirement)}"`,
      `data-caption-ids="${escapeHtml(shot.caption_ids.join(','))}"`,
      `data-minimum-visible-duration-sec="${escapeHtml(shot.minimum_visible_duration_sec)}"`,
      `data-shot-layer="background" src="${escapeHtml(shot.src)}"`,
      `data-shot-layer="foreground" src="${escapeHtml(shot.src)}"`,
    ];
    const backgroundCount = (figure.match(/data-shot-layer="background"/g) || []).length;
    const foregroundCount = (figure.match(/data-shot-layer="foreground"/g) || []).length;
    if (figureEnd < 0 || backgroundCount !== 1 || foregroundCount !== 1 || required.some(value => !figure.includes(value))) {
      return fail(`Frame HTML 的 Shot ${shot.id} 契约不完整。`);
    }
    cursor = figureEnd + 9;
  }
  return { success: true, contract: normalized.contract };
}

function materializeSceneImageSequenceDom({ html = '', node = {}, creativeContext = {} } = {}) {
  const normalized = normalizeContract(node, creativeContext);
  if (!normalized.success) return normalized;
  if (!normalized.contract) return { success: true, html: String(html), applied: false };
  const text = String(html || '');
  const range = markerRange(text);
  if (!range) return fail('Frame HTML 中的受管 Image Sequence 标记损坏。');
  const withoutManaged = range.start >= 0 ? text.slice(0, range.start) + text.slice(range.end) : text;
  if (/\bdata-hv-shot\s*=|\bdata-hv-image-sequence\s*=/i.test(withoutManaged)) {
    return fail('模型不得自行生成 Shot DOM。');
  }
  const closingBody = withoutManaged.toLowerCase().lastIndexOf('</body>');
  if (closingBody < 0) return fail('Frame HTML 缺少 closing body，无法注入 Shot DOM。');
  const dom = renderDom(normalized.contract);
  const output = withoutManaged.slice(0, closingBody) + dom + withoutManaged.slice(closingBody);
  const validation = validateSceneImageSequenceDom(output, { node, creativeContext });
  return validation.success ? { success: true, html: output, applied: true, contract: normalized.contract } : validation;
}

module.exports = {
  buildShotTimelineSource,
  materializeSceneImageSequenceDom,
  validateSceneImageSequenceDom,
};
