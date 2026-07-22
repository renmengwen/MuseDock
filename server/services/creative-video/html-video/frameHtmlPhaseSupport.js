// frameHtmlPhase 拆分出的支撑工具组：帧输入指纹（含提示词结构版本号）、帧 HTML 静态统计、
// scene_html 的 beat 分组与时间线脚本。
const crypto = require('crypto');

const frameHtmlAgent = require('./frameHtmlAgent');
const { buildPlaybackClockSource } = require('./playbackClock');
const { validateOverlayHtml, hasRealOverlayElement } = require('./motionPrimitiveCatalog');

// Frame HTML 生成提示词/primitive 结构版本号：当 frameHtmlAgent 的 prompt 结构、primitive
// 参考片段语义或帧 HTML 约定发生会影响产物的变化时手动 +1，使旧 checkpoint 指纹失配、
// resume 时强制重新生成，避免代码升级后静默复用旧版产物。
const FRAME_PROMPT_VERSION = 5;

// 确定性 JSON 序列化（对象键递归排序），保证同一输入结构得到稳定字符串
function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableJsonValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableJsonStringify(value) {
  return JSON.stringify(stableJsonValue(value));
}

/**
 * P1-2：计算单帧 HTML 生成的真实输入指纹。覆盖会改变产物的全部关键输入：
 * 连续性模式、画幅、beat 编排（含 visual_base/motion_overlay(theme_tokens)/visual_text）、
 * 素材绑定、受管 Shot 当前 registry、scene_html 时间窗口与提示词版本。resume 复用时与 checkpoint 持久化的指纹比较，
 * 任一维度变化即重新生成，杜绝「换素材/换编排后静默复用旧 HTML」。纯函数，可独立测试。
 */
function computeFrameInputFingerprint({ node, continuityMode, target, creativeContext } = {}) {
  const resolution = frameHtmlAgent.resolveResolution(target || {}) || {};
  const assetRefs = (Array.isArray(node?.asset_refs) ? node.asset_refs : [])
    .filter(Boolean)
    .map(ref => stableJsonValue(ref))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const shotAssetIds = new Set((Array.isArray(node?.metadata?.visual_beats)
    ? node.metadata.visual_beats
    : [node?.metadata?.visual_beat].filter(Boolean))
    .flatMap(beat => beat?.visual_base?.type === 'image_sequence' && Array.isArray(beat.visual_base.shots)
      ? beat.visual_base.shots.map(shot => String(shot?.asset_id || '').trim())
      : [])
    .filter(Boolean));
  const shotAssets = (Array.isArray(creativeContext?.asset_context?.assets)
    ? creativeContext.asset_context.assets
    : [])
    .map((asset) => {
      const id = String(asset?.id || asset?.asset_id || '').trim();
      if (!shotAssetIds.has(id)) return null;
      const assetPath = String(asset?.path || '').trim().replace(/\\/g, '/');
      return {
        id,
        media_type: String(asset?.media_type || asset?.type || '').toLowerCase(),
        status: String(asset?.status || '').trim() || 'ready',
        path: assetPath,
        frame_src: String(asset?.frame_src || (assetPath ? `../${assetPath}` : '')).trim().replace(/\\/g, '/'),
      };
    })
    .filter(Boolean)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const signature = {
    continuity_mode: continuityMode || 'beat_mp4',
    resolution: { width: resolution.width ?? null, height: resolution.height ?? null },
    beat: node?.metadata?.visual_beats ?? node?.metadata?.visual_beat ?? null,
    asset_refs: assetRefs,
    ...(shotAssetIds.size ? { shot_assets: shotAssets } : {}),
    beat_windows: node?.metadata?.beat_windows || null,
    prompt_version: FRAME_PROMPT_VERSION,
  };
  return crypto.createHash('sha256').update(stableJsonStringify(signature)).digest('hex');
}

// asset_first 帧 HTML 的静态结构统计（简单启发式，供 QA/路由决策观测用）
function computeFrameHtmlStats(html = '') {
  const text = String(html);
  const count = re => (text.match(re) || []).length;
  return {
    text_blocks: count(/<(h1|h2|h3|h4|p|li)\b/gi),
    cards: count(/class="[^"]*card[^"]*"/gi),
    graphics: count(/<(svg|canvas|img)\b/gi),
  };
}

// statsByBeatId 条目的统一构造：复用帧与新生成帧共用，保证两路统计结构同构
function frameHtmlStatsEntry(html, frameHeight = 1920) {
  const text = String(html || '');
  return {
    ...computeFrameHtmlStats(text),
    overlay_check: hasRealOverlayElement(text)
      ? validateOverlayHtml(text, { height: frameHeight })
      : null,
  };
}

function groupBeatsForSceneHtml(beats = []) {
  const groups = [];
  const byScene = new Map();
  for (const beat of beats) {
    let group = byScene.get(beat.scene_id);
    if (!group) {
      group = { scene_id: beat.scene_id, duration_sec: 0, beats: [] };
      byScene.set(beat.scene_id, group);
      groups.push(group);
    }
    const start = group.duration_sec;
    const duration = Number(beat.duration_sec) || 0;
    group.beats.push({ ...beat, start_sec: start, end_sec: start + duration });
    group.duration_sec = start + duration;
  }
  return groups;
}

function buildSceneTimelineScript(beatWindows = []) {
  const payload = JSON.stringify(beatWindows.map(b => ({ id: b.id, start: b.start_sec, end: b.end_sec })));
  return `<script>
${buildPlaybackClockSource()}
(function () {
  window.__MP_BEATS__ = ${payload};
  var beats = window.__MP_BEATS__;
  function render(t) {
    var active = null;
    for (var i = 0; i < beats.length; i++) {
      if (t >= beats[i].start && t < beats[i].end) { active = beats[i]; break; }
    }
    if (!active && beats.length) active = beats[beats.length - 1];
    if (active) document.body.setAttribute('data-mp-beat', active.id);
  }
  window.__mpStartBeatClock = function () {
    window.__hvPlaybackClock.play();
  };
  window.__mpSetTimelineTime = function (timeSec) { window.__hvPlaybackClock.setTime(timeSec); };
  window.__hvPlaybackClock.subscribe(render);
})();
<\/script>`;
}

module.exports = {
  FRAME_PROMPT_VERSION,
  computeFrameInputFingerprint,
  computeFrameHtmlStats,
  frameHtmlStatsEntry,
  groupBeatsForSceneHtml,
  buildSceneTimelineScript,
};
