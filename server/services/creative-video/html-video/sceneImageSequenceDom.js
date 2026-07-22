const fs = require('fs');
const path = require('path');
const MODES = new Set(['fullscreen_relay', 'overview_detail', 'semantic_compare', 'rhythm_montage']);
const { extractVisualAssetReferences } = require('./frameHtmlInspection');
const { buildPlaybackClockSource } = require('./playbackClock');
const { normalizeCaptionsForFrame } = require('./captionLayer');
const { CAPTION_SAFE_BOTTOM_PX } = require('./motionPrimitiveCatalog');
const START_MARKER = '<!-- hv-image-sequence:start -->';
const END_MARKER = '<!-- hv-image-sequence:end -->';
// 摄影机聚焦（REQ-D-05 / summary §13.4）：C 级仅接受 soft 低倍率宽松聚焦。
const CAMERA_MAX_ZOOM_BY_TRUST = { A: 3, B: 2.4, C: 1.5 };
const CAMERA_SOFT_REGION_EXPANSION = 1.5;
const CAMERA_SOFT_MIN_ZOOM = 1.15;
// fillFactor 必须小于 1：region 周围保留上下文，不把目标撑满画面（summary §13.4）。
const CAMERA_FILL_FACTOR = 0.72;

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
    if (!id) continue;
    if (map.has(id)) return fail(`素材注册表包含重复 ID：${id}。`);
    map.set(id, asset);
  }
  return { success: true, map };
}

function registrySrc(asset = {}) {
  const assetPath = String(asset.path || '').trim().replace(/\\/g, '/');
  const src = String(asset.frame_src || (assetPath ? `../${assetPath}` : '')).trim().replace(/\\/g, '/');
  let decodedPath = assetPath;
  let decodedSrc = src;
  try {
    decodedPath = decodeURIComponent(assetPath);
    decodedSrc = decodeURIComponent(src);
  } catch {
    return '';
  }
  const safePath = decodedPath.startsWith('assets/')
    && !decodedPath.includes('?')
    && !decodedPath.includes('#')
    && decodedPath.split('/').every(segment => segment && segment !== '.' && segment !== '..');
  if (!safePath || decodedSrc !== `../${decodedPath}`) return '';
  return src;
}

function cameraFiniteUnit(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

// 构建期仅消费逐字段校验通过的 registry region；非法则该 cue 按不存在处理。
// focus_point 缺失或越界时回退 region 中心（与 cameraMath 缺省行为一致）。
function cameraRegionGeometry(region, trustLevel) {
  const source = region && typeof region === 'object' ? region.region : null;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const { x, y, width, height } = source;
  if (![x, y, width, height].every(cameraFiniteUnit)
    || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return null;
  if (trustLevel === 'C') {
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const expandedWidth = Math.min(1, width * CAMERA_SOFT_REGION_EXPANSION);
    const expandedHeight = Math.min(1, height * CAMERA_SOFT_REGION_EXPANSION);
    return {
      region: {
        x: Math.min(1 - expandedWidth, Math.max(0, centerX - expandedWidth / 2)),
        y: Math.min(1 - expandedHeight, Math.max(0, centerY - expandedHeight / 2)),
        width: expandedWidth,
        height: expandedHeight,
      },
      focus_point: { x: centerX, y: centerY },
    };
  }
  const focus = region.focus_point;
  const focusValid = focus && typeof focus === 'object' && !Array.isArray(focus)
    && cameraFiniteUnit(focus.x) && cameraFiniteUnit(focus.y)
    && focus.x >= x && focus.x <= x + width && focus.y >= y && focus.y <= y + height;
  return {
    region: { x, y, width, height },
    focus_point: focusValid ? { x: focus.x, y: focus.y } : { x: x + width / 2, y: y + height / 2 },
  };
}

// 构建期预解析 camera cue 进 DOM data：A/B 保持既有规则；C 仅接受 zoom=soft，并扩大取景区域。
// highlight_only、D/缺失 trust、region_id 解析不到、几何非法、无 caption 的 cue 一律按不存在处理（REQ-D-05）。
// cue 起止时间在构建期从 canonical caption 数据派生，浏览器只消费已解析的时间与几何。
function cameraCaptionWindows(node, sceneDuration) {
  const captions = normalizeCaptionsForFrame({
    id: String(node?.scene_id || node?.metadata?.scene_id || node?.id || '').replace(/^scene:/, ''),
    duration_sec: sceneDuration,
    narration_text: node?.metadata?.narration_text,
    captions: node?.metadata?.captions,
  });
  return new Map(captions
    .filter(caption => Number.isFinite(caption.start) && Number.isFinite(caption.end)
      && caption.start >= 0 && caption.end > caption.start && caption.end <= sceneDuration)
    .map(caption => [String(caption.id), { start: caption.start, end: caption.end }]));
}

function normalizeCameraCues(shot, asset, captionWindows) {
  const cues = Array.isArray(shot?.camera?.focus_cues) ? shot.camera.focus_cues : [];
  if (!cues.length) return [];
  const regions = new Map();
  for (const region of Array.isArray(asset?.focus_regions) ? asset.focus_regions : []) {
    const id = String(region?.id || '').trim();
    if (id && !regions.has(id)) regions.set(id, region);
  }
  const normalized = [];
  for (const cue of cues) {
    if (!cue || typeof cue !== 'object' || Array.isArray(cue) || cue.effect !== 'camera_zoom') continue;
    const region = regions.get(String(cue.region_id || '').trim());
    const trustLevel = String(region?.trust_level || '').trim().toUpperCase();
    const maxZoom = CAMERA_MAX_ZOOM_BY_TRUST[trustLevel];
    if (!maxZoom) continue;
    if (trustLevel === 'C' && cue.zoom !== 'soft') continue;
    const geometry = cameraRegionGeometry(region, trustLevel);
    if (!geometry) continue;
    const captionIds = (Array.isArray(cue.caption_ids) ? cue.caption_ids : [])
      .map(value => String(value).trim())
      .filter(Boolean);
    if (!captionIds.length) continue;
    const windows = captionIds.map(id => captionWindows.get(id));
    if (windows.some(window => !window)) continue;
    const startSec = Math.min(...windows.map(window => window.start));
    const endSec = Math.max(...windows.map(window => window.end));
    if (startSec < Number(shot?.active_window?.start_sec)
      || endSec > Number(shot?.active_window?.end_sec) || endSec <= startSec) continue;
    normalized.push({
      id: String(cue.id || ''),
      start_sec: startSec,
      end_sec: endSec,
      region: geometry.region,
      focus_point: geometry.focus_point,
      max_zoom: maxZoom,
      ...(trustLevel === 'C' ? { min_zoom: CAMERA_SOFT_MIN_ZOOM } : {}),
    });
  }
  return normalized;
}

function sceneDurationSec(node = {}) {
  const candidates = [];
  const windows = Array.isArray(node?.metadata?.beat_windows) ? node.metadata.beat_windows : [];
  const windowEnd = windows.reduce((max, window) => {
    const end = Number(window?.end_sec);
    return Number.isFinite(end) && end > max ? end : max;
  }, 0);
  if (windowEnd > 0) candidates.push(windowEnd);
  for (const value of [node.duration_sec, node.durationSec, node?.metadata?.duration_sec, node?.metadata?.scene_duration_sec]) {
    const duration = Number(value);
    if (Number.isFinite(duration) && duration > 0) candidates.push(duration);
  }
  const beats = Array.isArray(node?.metadata?.visual_beats) ? node.metadata.visual_beats : [];
  const total = beats.reduce((sum, beat) => {
    const duration = Number(beat?.duration_sec ?? beat?.durationSec);
    return sum + (Number.isFinite(duration) && duration > 0 ? duration : 0);
  }, 0);
  if (total > 0) candidates.push(total);
  if (!candidates.length) return 0;
  return candidates.some(duration => Math.abs(duration - candidates[0]) > 1e-6) ? -1 : candidates[0];
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

  const registry = registryMap(creativeContext);
  if (!registry.success) return registry;
  const assets = registry.map;
  const sceneDuration = sceneDurationSec(node);
  if (sceneDuration < 0) return fail('Image Sequence 的 Scene 时长字段不一致。');
  if (!sceneDuration) return fail('无法确定 Image Sequence 的 Scene 时长。');
  const captionWindows = cameraCaptionWindows(node, sceneDuration);
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
    if (end > sceneDuration + 1e-6) return fail(`Shot ${id} 的 active_window 超出 Scene 时长。`);
    if (normalized.length && start + 1e-6 < normalized[normalized.length - 1].start_sec) {
      return fail(`Shot ${id} 的 active_window 未按开始时间排序。`);
    }
    if (!Number.isFinite(minimum) || minimum <= 0 || end - start + 1e-6 < minimum) {
      return fail(`Shot ${id} 未满足最短可见时长。`);
    }
    const asset = assets.get(assetId);
    const src = registrySrc(asset);
    const mediaType = String(asset?.media_type || asset?.type || '').toLowerCase();
    const status = String(asset?.status || '').trim();
    const statusReady = status ? status === 'ready' : true; // legacy 工程可能没有 status；新 registry 必须显式 ready
    if (!asset || (mediaType && mediaType !== 'image' && !mediaType.startsWith('image/')) || !statusReady || !src) {
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
      camera_cues: normalizeCameraCues(shot, asset, captionWindows),
    });
  }
  let coveredUntil = 0;
  for (const shot of normalized) {
    if (shot.start_sec > coveredUntil + 1e-6) return fail('Image Sequence 的 active_window 存在空档。');
    coveredUntil = Math.max(coveredUntil, shot.end_sec);
  }
  if (coveredUntil < sceneDuration - 1e-6) return fail('Image Sequence 未覆盖完整 Scene 时长。');
  if (mode === 'semantic_compare' && (
    normalized.some(shot => shot.start_sec !== 0 || Math.abs(shot.end_sec - sceneDuration) > 1e-6)
  )) return fail('semantic_compare 的两个 Shot 必须共享完整 Scene 时间窗。');
  if (mode === 'overview_detail') {
    const overview = normalized[0];
    if (overview.start_sec !== 0 || Math.abs(overview.end_sec - sceneDuration) > 1e-6) {
      return fail('overview_detail 的 overview Shot 必须覆盖完整 Scene 时间窗。');
    }
  }
  return {
    success: true,
    contract: {
      scene_id: String(node?.scene_id || node?.metadata?.scene_id || node?.id || '').replace(/^scene:/, ''),
      duration_sec: sceneDuration,
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

let cameraMathModuleSource = '';
// cameraMath 复用 playbackClock 的"Node 源码字符串注入浏览器"模式：整文件读入 + module shim，
// 包在运行时 IIFE 内不落任何新全局；cameraMath.js 本身只读不改。
function cameraMathSource() {
  if (!cameraMathModuleSource) {
    cameraMathModuleSource = fs.readFileSync(path.join(__dirname, 'cameraMath.js'), 'utf8');
  }
  return cameraMathModuleSource;
}

// 摄影机运行时：订阅 __hvPlaybackClock，transform 是 clock 时间的纯函数（可 seek/暂停确定性重放）。
// 节奏遵循 summary §14：cue 前 overview、caption start 起 0.45～0.8s 平滑过渡、保持到 cue 结束、
// 相邻 cue 直接平滑转向、最后一个 cue 结束后剩余窗口足够才回全景；全程 try/catch 不抛异常。
function buildCameraRuntimeSource() {
  return `(function () {
  var module = { exports: {} };
  var exports = module.exports;
${cameraMathSource()}
  var computeCameraTransform = module.exports && module.exports.computeCameraTransform;
  if (typeof computeCameraTransform !== 'function') return;
  var SAFE_BOTTOM_PX = ${CAPTION_SAFE_BOTTOM_PX};
  var FILL_FACTOR = ${CAMERA_FILL_FACTOR};
  var TRANSITION_MIN_SEC = 0.45;
  var TRANSITION_MAX_SEC = 0.8;
  var TRANSITION_WINDOW_RATIO = 0.4;
  var RETURN_TRANSITION_SEC = 0.6;
  var TIME_EPSILON = 1e-6;
  var IDENTITY = { scale: 1, tx: 0, ty: 0 };
  var shots = [];
  var figures = document.querySelectorAll('[data-hv-shot][data-camera-cues]');
  for (var i = 0; i < figures.length; i++) {
    var cues = null;
    try { cues = JSON.parse(figures[i].dataset.cameraCues || '[]'); } catch (_) { cues = null; }
    var image = figures[i].querySelector('img[data-shot-layer="foreground"]');
    if (!cues || !cues.length || !image) continue;
    image.style.transformOrigin = '0 0';
    shots.push({
      figure: figures[i],
      image: image,
      cues: cues,
      windowStart: Number(figures[i].dataset.windowStartSec),
      windowEnd: Number(figures[i].dataset.windowEndSec),
      metrics: null,
      applied: ''
    });
  }
  if (!shots.length) return;
  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function ease(value) {
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }
  function mix(from, to, progress) {
    return {
      scale: from.scale + (to.scale - from.scale) * progress,
      tx: from.tx + (to.tx - from.tx) * progress,
      ty: from.ty + (to.ty - from.ty) * progress
    };
  }
  function resolveMetrics(shot) {
    var imageWidth = shot.image.naturalWidth;
    var imageHeight = shot.image.naturalHeight;
    var width = shot.image.clientWidth;
    var height = shot.image.clientHeight;
    if (!imageWidth || !imageHeight || !width || !height) return null;
    var active = [];
    var acceptedCues = [];
    for (var i = 0; i < shot.cues.length; i++) {
      var cue = shot.cues[i];
      var result = computeCameraTransform({
        image_width: imageWidth,
        image_height: imageHeight,
        canvas_width: width,
        canvas_height: height,
        fit: 'contain',
        region: cue.region,
        focus_point: cue.focus_point,
        safe_rect: { left: 0, top: 0, right: width, bottom: height - SAFE_BOTTOM_PX },
        fill_factor: FILL_FACTOR,
        max_zoom: cue.max_zoom
      });
      if (!result || !result.applied || !result.image_rect
        || (Number.isFinite(cue.min_zoom) && result.zoom < cue.min_zoom)) continue;
      acceptedCues.push(cue);
      var baseScale = Math.min(width / imageWidth, height / imageHeight);
      var baseLeft = (width - imageWidth * baseScale) / 2;
      var baseTop = (height - imageHeight * baseScale) / 2;
      active.push({
        begin: cue.start_sec,
        end: cue.end_sec,
        duration: Math.min(TRANSITION_MAX_SEC, Math.max(TRANSITION_MIN_SEC, (cue.end_sec - cue.start_sec) * TRANSITION_WINDOW_RATIO)),
        target: {
          scale: result.zoom,
          tx: result.image_rect.left - baseLeft * result.zoom,
          ty: result.image_rect.top - baseTop * result.zoom
        }
      });
    }
    var from = IDENTITY;
    for (var k = 0; k < active.length; k++) {
      active[k].from = from;
      var nextBegin = k + 1 < active.length ? active[k + 1].begin : Infinity;
      from = mix(active[k].from, active[k].target, ease(clamp01((nextBegin - active[k].begin) / active[k].duration)));
    }
    if (active.length) {
      var last = active[active.length - 1];
      if (shot.windowEnd - last.end + TIME_EPSILON >= RETURN_TRANSITION_SEC) {
        active.push({ begin: last.end, end: last.end, duration: RETURN_TRANSITION_SEC, from: from, target: IDENTITY });
      }
    }
    shot.figure.__hvResolvedCameraCues = acceptedCues;
    return { active: active };
  }
  function stateAt(shot, timeSec) {
    var active = shot.metrics.active;
    for (var i = active.length - 1; i >= 0; i--) {
      if (timeSec >= active[i].begin) {
        return mix(active[i].from, active[i].target, ease(clamp01((timeSec - active[i].begin) / active[i].duration)));
      }
    }
    return IDENTITY;
  }
  function formatTransform(state) {
    if (Math.abs(state.scale - 1) < 1e-4 && Math.abs(state.tx) < 1e-2 && Math.abs(state.ty) < 1e-2) return '';
    return 'translate(' + state.tx.toFixed(2) + 'px, ' + state.ty.toFixed(2) + 'px) scale(' + state.scale.toFixed(4) + ')';
  }
  function render(timeSec) {
    for (var i = 0; i < shots.length; i++) {
      var shot = shots[i];
      var transform = '';
      if (timeSec >= shot.windowStart && timeSec < shot.windowEnd) {
        if (!shot.metrics) shot.metrics = resolveMetrics(shot);
        if (shot.metrics) transform = formatTransform(stateAt(shot, timeSec));
      }
      if (transform === shot.applied) continue;
      shot.applied = transform;
      shot.image.style.transform = transform;
    }
  }
  window.__hvPlaybackClock.subscribe(function (timeSec) {
    try { render(timeSec); } catch (_) {}
  });
})();`;
}

function renderDom(contract) {
  const figures = contract.shots.map(shot => [
    `<figure data-hv-shot="true" data-shot-id="${escapeHtml(shot.id)}" data-asset-id="${escapeHtml(shot.asset_id)}" data-window-start-sec="${escapeHtml(shot.start_sec)}" data-window-end-sec="${escapeHtml(shot.end_sec)}" data-time-base="scene_local" data-shot-role="${escapeHtml(shot.role)}" data-shot-requirement="${escapeHtml(shot.requirement)}" data-caption-ids="${escapeHtml(shot.caption_ids.join(','))}" data-minimum-visible-duration-sec="${escapeHtml(shot.minimum_visible_duration_sec)}"${shot.camera_cues.length ? ` data-camera-cues="${escapeHtml(JSON.stringify(shot.camera_cues))}"` : ''}>`,
    `<img data-shot-layer="background" src="${escapeHtml(shot.src)}" alt="" aria-hidden="true">`,
    `<img data-shot-layer="foreground" src="${escapeHtml(shot.src)}" alt="">`,
    '</figure>',
  ].join('')).join('');
  // 摄影机运行时只在存在 camera_zoom cue 时注入：无 cue 场景输出与 D-07 之前字节级一致。
  const cameraRuntime = contract.shots.some(shot => shot.camera_cues.length) ? buildCameraRuntimeSource() : '';
  return [
    START_MARKER,
    '<style data-hv-image-sequence-style="true">',
    '[data-hv-image-sequence]{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none}',
    ':where(body>:not([data-hv-image-sequence]):not([data-hv-layer="captions"]):not(style):not(script)){position:relative;z-index:1}',
    ':where(body>[data-hv-canvas],body>#root,[data-hv-canvas]>[data-role="main-visual"]){background-color:transparent!important}',
    '[data-hv-shot]{position:absolute;inset:0;margin:0;opacity:0;visibility:hidden;transition:opacity .35s ease,transform .35s ease,visibility 0s linear .35s;transform:translate3d(0,8px,0)}',
    '[data-hv-shot][data-shot-active="true"]{opacity:1;visibility:visible;transform:none;transition-delay:0s}',
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
    `<script data-hv-shot-clock="true">${buildPlaybackClockSource()}${buildShotTimelineSource()}${cameraRuntime}<\/script>`,
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

function withoutManagedBlock(text, range) {
  return range.start >= 0 ? text.slice(0, range.start) + text.slice(range.end) : text;
}

function validateNoDuplicateShotReferences(html, range) {
  const shell = withoutManagedBlock(html, range);
  const visualShell = shell.replace(/@font-face\s*\{[^{}]*\}/gi, '');
  const references = extractVisualAssetReferences(visualShell);
  return references.length
    ? fail('Image Sequence 模型美术壳不得输出任何外部视觉素材。', {
    offending_references: references.map(item => item.reference),
    }) : { success: true };
}

function validateSceneImageSequenceDom(html, { node = {}, creativeContext = {} } = {}) {
  const normalized = normalizeContract(node, creativeContext);
  if (!normalized.success || !normalized.contract) return normalized;
  const text = String(html || '');
  const range = markerRange(text);
  if (!range || range.start < 0) return fail('Frame HTML 缺少受管 Image Sequence DOM。');
  const managed = text.slice(range.start, range.end);
  const duplicateReferences = validateNoDuplicateShotReferences(text, range);
  if (!duplicateReferences.success) return duplicateReferences;
  // 受管块由本模块唯一生成，直接绑定确定性产物，避免摄影机数据仍在但运行时被删改时假通过。
  if (managed !== renderDom(normalized.contract)) return fail('Frame HTML 的受管 Image Sequence DOM 与运行时不完整。');
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
    if (shot.camera_cues.length) {
      required.push(`data-camera-cues="${escapeHtml(JSON.stringify(shot.camera_cues))}"`);
    } else if (figure.includes('data-camera-cues=')) {
      return fail(`Frame HTML 的 Shot ${shot.id} 包含计划外摄影机数据。`);
    }
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
  const withoutManaged = withoutManagedBlock(text, range);
  if (/\bdata-hv-shot\s*=|\bdata-hv-image-sequence\s*=/i.test(withoutManaged)) {
    return fail('模型不得自行生成 Shot DOM。');
  }
  if (withoutManaged.includes('__hvPlaybackClock')) return fail('模型不得占用系统保留的 __hvPlaybackClock。');
  const duplicateReferences = validateNoDuplicateShotReferences(text, range);
  if (!duplicateReferences.success) return duplicateReferences;
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
