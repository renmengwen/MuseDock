// frameHtmlPhase 拆分出的支撑工具组：帧输入指纹（含提示词结构版本号）、帧 HTML 静态统计、
// scene_html 的 beat 分组与时间线脚本。
const crypto = require('crypto');

const frameHtmlAgent = require('./frameHtmlAgent');
const { validateOverlayHtml, hasRealOverlayElement } = require('./motionPrimitiveCatalog');

// Frame HTML 生成提示词/primitive 结构版本号：当 frameHtmlAgent 的 prompt 结构、primitive
// 参考片段语义或帧 HTML 约定发生会影响产物的变化时手动 +1，使旧 checkpoint 指纹失配、
// resume 时强制重新生成，避免代码升级后静默复用旧版产物。
const FRAME_PROMPT_VERSION = 2;

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
 * 素材绑定、scene_html 时间窗口与提示词版本。resume 复用时与 checkpoint 持久化的指纹比较，
 * 任一维度变化即重新生成，杜绝「换素材/换编排后静默复用旧 HTML」。纯函数，可独立测试。
 */
function computeFrameInputFingerprint({ node, continuityMode, target } = {}) {
  const resolution = frameHtmlAgent.resolveResolution(target || {}) || {};
  const assetRefs = (Array.isArray(node?.asset_refs) ? node.asset_refs : [])
    .filter(Boolean)
    .map(ref => stableJsonValue(ref))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const signature = {
    continuity_mode: continuityMode || 'beat_mp4',
    resolution: { width: resolution.width ?? null, height: resolution.height ?? null },
    beat: node?.metadata?.visual_beats ?? node?.metadata?.visual_beat ?? null,
    asset_refs: assetRefs,
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
  // P1-3：beat 时钟不随页面加载自启——预加载（字体/render-ready/动画探测）耗时会被 ffmpeg 按
  // leadInMs 裁掉，但页面内部时钟不会回拨，导致成片 t=0 已跳过首 beat。改为暴露
  // __mpStartBeatClock，由渲染 adapter 在正式录制起点（__hvUnfreeze 之后）显式调用；
  // 非 adapter 环境（本地预览，无 __mpAdapterControlled 标志）才挂 5s 兜底自启——
  // adapter 受控时不挂，避免预加载 >5s 时兜底抢先起钟偏移 origin。
  // 启动前 body 已同步置首 beat，预加载期间画面即 beat1 状态。
  return `<script>
(function () {
  window.__MP_BEATS__ = ${payload};
  var beats = window.__MP_BEATS__;
  if (beats.length) document.body.setAttribute('data-mp-beat', beats[0].id);
  var started = false;
  var origin = null;
  function tick(now) {
    if (origin === null) origin = now;
    var t = (now - origin) / 1000;
    var active = null;
    for (var i = 0; i < beats.length; i++) {
      if (t >= beats[i].start && t < beats[i].end) { active = beats[i]; break; }
    }
    if (!active && beats.length) active = beats[beats.length - 1];
    if (active) document.body.setAttribute('data-mp-beat', active.id);
    requestAnimationFrame(tick);
  }
  window.__mpStartBeatClock = function () {
    if (started) return;
    started = true;
    requestAnimationFrame(tick);
  };
  if (!window.__mpAdapterControlled) {
    setTimeout(function () { window.__mpStartBeatClock(); }, 5000);
  }
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
