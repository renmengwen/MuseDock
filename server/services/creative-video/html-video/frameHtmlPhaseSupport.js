// frameHtmlPhase 拆分出的支撑工具组：帧输入指纹（含提示词结构版本号）、帧 HTML 静态统计、
// scene_html 的 beat 分组与时间线脚本。
const crypto = require('crypto');

const frameHtmlAgent = require('./frameHtmlAgent');
const frameFallbackBuilder = require('./frameFallbackBuilder');
const { ensureMotionOverlay, isSceneHtmlNode } = require('./motionOverlayPhase');
const { buildPlaybackClockSource } = require('./playbackClock');
const { validateOverlayHtml, hasRealOverlayElement } = require('./motionPrimitiveCatalog');
const { normalizeContract } = require('./sceneImageSequenceDom');
const { stableStringify } = require('../sceneSpecHash');

// Frame HTML 生成提示词/primitive 结构版本号：当 frameHtmlAgent 的 prompt 结构、primitive
// 参考片段语义或帧 HTML 约定发生会影响产物的变化时手动 +1，使旧 checkpoint 指纹失配、
// resume 时强制重新生成，避免代码升级后静默复用旧版产物。
const FRAME_PROMPT_VERSION = 5;

/**
 * 单帧 HTML 的真实模型输入指纹：直接签完整 canonical prompt，避免在这里维护第二份字段清单。
 * 模型调用后的确定性物化结果也直接复用各自构建器，避免在这里维护第二份字段清单。
 */
function computeFrameInputFingerprint({
  graph,
  node,
  index,
  total,
  sceneSpec,
  scene,
  creativeContext,
  target,
  styleProfile,
  visualStyleReferenceHtml,
  previousFrameHtml,
  beat,
  primitiveSnippet,
  diagramSkeleton,
  previousBeatSummary,
  hasCaptions,
  captions,
  sceneBeatsBrief,
  continuityMode,
} = {}) {
  const managedContract = normalizeContract(node, creativeContext);
  const fallbackHtml = frameFallbackBuilder.buildFallbackFrameHtml({ scene, node, target });
  const overlayHtml = beat && !isSceneHtmlNode(node)
    ? ensureMotionOverlay('<!doctype html><html><body></body></html>', beat).html
    : '';
  const signature = {
    continuity_mode: continuityMode || 'beat_mp4',
    prompt: frameHtmlAgent.buildFrameHtmlPrompt({
      graph,
      node,
      index,
      total,
      sceneSpec,
      creativeContext,
      target,
      styleProfile,
      visualStyleReferenceHtml,
      previousFrameHtml,
      beat,
      primitiveSnippet,
      diagramSkeleton,
      previousBeatSummary,
      hasCaptions,
      sceneBeatsBrief,
    }),
    fallback_html: fallbackHtml,
    final_captions: Array.isArray(captions) ? captions : [],
    ...(managedContract.contract ? { managed_dom_contract: managedContract.contract } : {}),
    ...(overlayHtml ? { overlay_fallback_html: overlayHtml } : {}),
    prompt_version: FRAME_PROMPT_VERSION,
  };
  return crypto.createHash('sha256').update(stableStringify(signature)).digest('hex');
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
