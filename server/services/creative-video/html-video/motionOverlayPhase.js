// frameHtmlPhase 拆分出的动效 primitive 与连续性分桶工具组：beat 编排参数解析、
// scene_html 判定与场景 brief、base 布局摘要、continuity 分桶串行调度、overlay 兜底注入。
const { normalizeCaptions, trustedSceneDuration } = require('./rawHtmlFrameBuilder');
const { sliceCaptionsToWindow } = require('./captionLayer');
const { DEFAULT_FRAME_DURATION_SEC } = require('./contentGraph');
const { loadOverlaySnippet, loadDiagramSkeleton, hasRealOverlayElement } = require('./motionPrimitiveCatalog');
const { htmlEscape } = require('./materializer');

async function mapLimit(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const max = Math.max(1, Math.min(Number(limit) || 1, list.length || 1));
  const results = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: max }, async () => {
    while (next < list.length) {
      const current = next;
      next += 1;
      results[current] = await mapper(list[current], current);
    }
  }));
  return results;
}

function safeLoad(loader, ...args) {
  try {
    return loader(...args);
  } catch {
    return '';
  }
}

// 从 node.metadata.visual_beat（R3 唯一下传通道）取 beat 编排并加载 primitive 参考片段；
// scene_html 的 scene 级节点（metadata.visual_beats）聚合组内 beat：以首个带 motion_overlay 的 beat
// 为 prompt 基础，scene 级约束（data-mp-beat-scope 约定/时间窗口）经 sceneBeatsBrief 独立字段下传，
// 由 frameHtmlAgent 作为独立段落输出（不混入 primitive 参考片段）；brief 只依赖 beat_windows 存在，
// 与 motion_overlay 解耦（与时间线脚本注入条件一致）。
function resolveAssetFirstMotionArgs(node, { scene = null, beats = [], mediaOptions = {} } = {}) {
  const sceneBeatsBrief = buildSceneBeatsBrief(node, { scene, beats, mediaOptions });
  const visualBeats = Array.isArray(node?.metadata?.visual_beats) ? node.metadata.visual_beats : null;
  const beat = visualBeats && visualBeats.length
    ? (visualBeats.find(item => item?.motion_overlay) || visualBeats[0])
    : (node?.metadata?.visual_beat || {});
  if (!Object.keys(beat).length) return sceneBeatsBrief ? { sceneBeatsBrief } : {};
  const primitiveSnippet = beat.motion_overlay?.preset ? safeLoad(loadOverlaySnippet, beat.motion_overlay.preset) : '';
  const diagramSkeleton = beat.visual_base?.type === 'diagram' ? safeLoad(loadDiagramSkeleton) : '';
  // previousBeatSummary 由分桶调度侧透传（见 runBucketsWithContinuity）、hasCaptions 由 Task 5.2 后续接入
  return {
    beat,
    primitiveSnippet,
    diagramSkeleton,
    ...(sceneBeatsBrief ? { sceneBeatsBrief } : {}),
  };
}

// scene_html：scene 级节点判定（展开阶段写入 metadata.beat_windows / id 前缀 scene:）
function isSceneHtmlNode(node = {}) {
  return String(node?.id || '').startsWith('scene:')
    || (Array.isArray(node?.metadata?.beat_windows) && node.metadata.beat_windows.length > 0);
}

// R8：判定某 beat 的时间窗口内是否有系统字幕，派生路径与 mixedFrameBuilder 建帧侧对齐：
// 整场景字幕轨 normalizeCaptions（rawHtmlFrameBuilder）后按 beat 前缀时长偏移 sliceCaptionsToWindow
//（captionLayer）切窗。beat 上没有 caption_text 字段，字幕是建帧阶段从 scene 派生的，
// 因此这里复用同一对函数计算，不新造字段。
function hasCaptionsForBeat({ scene = {}, beats = [], beatId = '', mediaOptions = {} } = {}) {
  if (mediaOptions.generateCaptions === false) return false;
  const sceneId = String(scene.id || scene.scene_id || '').trim();
  // 与建帧侧一致：无 id 的损坏 beat 跳过（不推进 offset），scene_id 按 String().trim() 对齐比较
  const sceneBeats = beats.filter(b => b && b.id && String(b.scene_id || '').trim() === sceneId);
  const index = sceneBeats.findIndex(b => b.id === beatId);
  if (index < 0) return false;
  // 与建帧侧一致：窗口时长/偏移推进用 positiveNumber || DEFAULT_FRAME_DURATION_SEC 兜底
  const beatWindowSec = b => positiveDurationSec(b.duration_sec) || DEFAULT_FRAME_DURATION_SEC;
  const offsetSec = sceneBeats.slice(0, index)
    .reduce((sum, b) => sum + beatWindowSec(b), 0);
  const beatDuration = beatWindowSec(sceneBeats[index]);
  // 与建帧侧一致：场景总时长先取各 beat 时长累计（无效计 0），再退 trustedSceneDuration 兜底
  const sceneDuration = sceneBeats.reduce((sum, b) => sum + (positiveDurationSec(b.duration_sec) || 0), 0)
    || trustedSceneDuration(scene);
  const track = normalizeCaptions(scene, sceneDuration);
  return sliceCaptionsToWindow(track, offsetSec, beatDuration).length > 0;
}

// 与 mixedFrameBuilder.positiveNumber 同语义的小工具（正有限数或 null）
function positiveDurationSec(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// scene_html 的 scene 级 prompt 约束段：data-mp-beat-scope 约定 + CSS 可见性规则示例 +
// 每个 beat 的时间窗口与文案要点（一份 HTML 覆盖整场景，base 层稳定、overlay 分 beat 显隐）。
// review P2-3(a)：传入 scene/beats/mediaOptions 时按 beat 计算 hasCaptionsForBeat，
// 无系统字幕的 beat 行追加「补画面重点短句」要求（与 beat_mp4 路径的 hasCaptions 契约对齐）；
// 未传 scene（旧调用形态/单测）不做字幕判定，行为不变。
function buildSceneBeatsBrief(node = {}, { scene = null, beats = [], mediaOptions = {} } = {}) {
  const windows = Array.isArray(node?.metadata?.beat_windows) ? node.metadata.beat_windows : [];
  if (!windows.length) return '';
  const visualBeats = Array.isArray(node?.metadata?.visual_beats) ? node.metadata.visual_beats : [];
  const beatById = new Map(visualBeats.filter(beat => beat && beat.id).map(beat => [beat.id, beat]));
  const lines = [
    '本帧是同场景多 beat 的连续 HTML（scene_html 模式），一份 HTML 覆盖整个场景时长：',
    '- base 层（主视觉/背景/主卡片）不带 data-mp-beat-scope，整场景全程稳定可见，禁止中途重排或重新开场。',
    '- 每个 beat 的局部 overlay 元素必须带 data-mp-beat-scope="<beat_id>"，并用 CSS 控制可见性，示例：',
    '  [data-mp-beat-scope]{opacity:0;pointer-events:none;transition:opacity .35s}',
    '  body[data-mp-beat="scene_x_b1"] [data-mp-beat-scope="scene_x_b1"]{opacity:1}（按下方每个 beat_id 逐个写出选择器）',
    '- 系统会在 </body> 前注入时间线脚本，按时间把 body 的 data-mp-beat 切到当前 beat_id；HTML 不要自己实现切换逻辑。',
    '各 beat 时间窗口与文案要点：',
  ];
  for (const window of windows) {
    const beat = beatById.get(window.id) || {};
    const headline = String(beat.visual_text?.headline || '').trim();
    const keywords = Array.isArray(beat.visual_text?.keywords)
      ? beat.visual_text.keywords.filter(Boolean).join(' / ')
      : '';
    const preset = beat.motion_overlay?.preset ? `overlay=${beat.motion_overlay.preset}` : '';
    const summary = [headline, keywords, preset].filter(Boolean).join('；');
    const captionNote = scene && !hasCaptionsForBeat({ scene, beats, beatId: window.id, mediaOptions })
      ? '（无系统字幕：该 beat 的 overlay 必须含一条画面重点短句，不超过 18 字）'
      : '';
    lines.push(`- ${window.id}：${window.start_sec}s - ${window.end_sec}s${summary ? `，${summary}` : ''}${captionNote}`);
  }
  return lines.join('\n');
}

// 前一 beat 帧 HTML 的 base 布局摘要：剥离 overlay 节点与脚本，保留 body 结构与内联样式要点并限长，
// 供同 continuity group 的后续 beat 复用布局（asset_first 专用）。
function summarizeBaseLayout(html = '') {
  const withoutOverlays = String(html)
    .replace(/<div[^>]*data-mp-overlay[^>]*>[\s\S]*?<\/div>\s*<\/div>/g, '')
    .replace(/<div[^>]*data-mp-overlay[^>]*>[\s\S]*?<\/div>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/\s+/g, ' ');
  const bodyMatch = withoutOverlays.match(/<body[^>]*>([\s\S]*)<\/body>/);
  const body = bodyMatch ? bodyMatch[1] : withoutOverlays;
  return body.trim().slice(0, 1600);
}

// R3：continuity group 只从展开阶段写入的 node.metadata.visual_beat 读，不做查表兜底
function continuityGroupId(job) {
  const beat = job.node?.metadata?.visual_beat || {};
  return beat.continuity?.group_id || null;
}

// 按 continuity group 分桶：同组 beat 同桶（桶内串行），无组 job 各自独立桶（保持可并发）
function bucketJobsByContinuityGroup(jobs = []) {
  const buckets = [];
  const byGroup = new Map();
  for (const job of jobs) {
    const groupId = continuityGroupId(job);
    if (!groupId) {
      buckets.push([job]);
      continue;
    }
    let bucket = byGroup.get(groupId);
    if (!bucket) {
      bucket = [];
      byGroup.set(groupId, bucket);
      buckets.push(bucket);
    }
    bucket.push(job);
  }
  return buckets;
}

// 桶间并发、桶内严格串行，并把前帧 HTML 摘要向后传给同组后续 beat（beat_index>1 才注入）。
// initialHtmlByGroup：分桶前已就绪的帧 HTML（复用帧/串行首帧），Map<group_id, Map<beat_index, html>>；
// P2-2：每个待生成 job 的前驱 = max_by_beat_index(
//   桶内已成功生成的最近前驱, initialHtmlByGroup 中 beat_index 小于当前的最近复用前驱 )，
// 两个候选都要求 beat_index 严格小于当前 job，比较后取更近（beat_index 更大）者。
// 覆盖场景：同组非相邻多 beat 同批重试（复用 b1/b3、待生成 b2/b4）时，b4 取更近的复用帧 b3
// 而不是刚生成的 b2；b2 失败时 b4 仍回落到 b3；只有 b1 复用时 b4 沿用生成的 b2（桶内传递语义保留）。
async function runBucketsWithContinuity({ buckets = [], concurrency = 1, runJob, initialHtmlByGroup = new Map() } = {}) {
  const bucketResults = await mapLimit(buckets, concurrency, async bucket => {
    const results = [];
    const groupId = bucket.length ? continuityGroupId(bucket[0]) : null;
    let previousGeneratedBeatIndex = null;
    let previousGeneratedHtml = '';
    for (const job of bucket) {
      const beat = job.node?.metadata?.visual_beat || {};
      const currentIndex = Number(beat.continuity?.beat_index) || 1;
      const reusedPredecessor = groupId
        ? predecessorForBeat(initialHtmlByGroup, groupId, currentIndex)
        : null;
      const generatedPredecessor = previousGeneratedBeatIndex !== null && previousGeneratedBeatIndex < currentIndex
        ? { index: previousGeneratedBeatIndex, html: previousGeneratedHtml }
        : null;
      const chosen = [reusedPredecessor, generatedPredecessor]
        .filter(Boolean)
        .sort((a, b) => b.index - a.index)[0] || null;
      const previousHtml = chosen?.html || '';
      const result = await runJob({
        ...job,
        previousBeatSummary: currentIndex > 1 && previousHtml
          ? summarizeBaseLayout(previousHtml)
          : '',
      });
      if (result?.htmlResult?.success) {
        previousGeneratedBeatIndex = currentIndex;
        previousGeneratedHtml = result.htmlResult.html;
      }
      results.push(result);
    }
    return results;
  });
  return bucketResults.flat();
}

// 从 beat 的文案信息派生各 primitive slot 的默认取值（overlay 兜底注入用）
function overlaySlotValues(beat = {}) {
  const headline = String(beat.visual_text?.headline || '').trim();
  const keywords = Array.isArray(beat.visual_text?.keywords) ? beat.visual_text.keywords.filter(Boolean) : [];
  const cards = Array.isArray(beat.visual_text?.cards) ? beat.visual_text.cards.filter(Boolean) : [];
  const narration = String(beat.narration_text || '').trim();
  const point = headline || narration.slice(0, 18) || '重点';
  const items = (cards.length ? cards : keywords).map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item)));
  return {
    kicker: keywords[0] || '重点',
    point,
    term: headline || keywords[0] || '概念',
    definition: narration.slice(0, 40) || point,
    step_1: items[0] || '第一步', step_2: items[1] || '第二步', step_3: items[2] || '第三步',
    cause: items[0] || '原因', mechanism: items[1] || '机制', result: items[2] || '结果',
    item_1: items[0] || point, item_2: items[1] || '', item_3: items[2] || '',
    value_a: items[0] || 'A', label_a: keywords[0] || '对象 A',
    value_b: items[1] || 'B', label_b: keywords[1] || '对象 B',
  };
}

// 用 beat 派生文案替换 primitive 片段中 data-mp-slot 占位文本（R7：值必须 htmlEscape）
function fillOverlaySlots(snippet, slots) {
  return snippet.replace(/(data-mp-slot="([a-z0-9_]+)"[^>]*>)([^<]*)/g, (match, open, key, current) => {
    const value = slots[key];
    return value === undefined || value === '' ? match : `${open}${htmlEscape(String(value))}`;
  });
}

// beat.motion_overlay.theme_tokens 转成 :root CSS 变量，供 primitive 片段内 var(--mp-*) 消费
function themeTokenStyle(tokens = {}) {
  const entries = [
    ['--mp-accent', tokens.accent], ['--mp-foreground', tokens.foreground],
    ['--mp-surface', tokens.surface], ['--mp-background', tokens.background],
  ].filter(([, value]) => value);
  if (!entries.length) return '';
  return `<style data-mp-theme>:root{${entries.map(([k, v]) => `${k}:${v}`).join(';')}}</style>`;
}

// 模型漏写 overlay（无 data-mp-overlay）时，确定性注入 primitive 兜底片段；
// 已有 overlay 时原样返回（硬约束 A）。
function ensureMotionOverlay(html = '', beat = {}) {
  const preset = beat.motion_overlay?.preset;
  if (!preset) return { html, injected: false };
  const text = String(html);
  // P1-8：按真实 opening tag 判定，<style> 选择器/注释里的字样不算已有 overlay
  if (hasRealOverlayElement(text)) return { html: text, injected: false };
  let snippet;
  try {
    snippet = loadOverlaySnippet(preset);
  } catch {
    return { html: text, injected: false };
  }
  const filled = fillOverlaySlots(snippet, overlaySlotValues(beat));
  const theme = themeTokenStyle(beat.motion_overlay.theme_tokens);
  const payload = `${theme}${filled}`;
  const next = text.includes('</body>')
    ? text.replace('</body>', `${payload}</body>`)
    : text + payload;
  return { html: next, injected: true };
}

// P2-2：查组内「beat_index 严格小于当前的最近前驱」，返回 { index, html } 或 null（无前驱/未知组）
function predecessorForBeat(initialHtmlByGroup, groupId, beatIndex) {
  const byIndex = groupId ? initialHtmlByGroup.get(groupId) : null;
  if (!(byIndex instanceof Map)) return null;
  const current = Number(beatIndex) || 1;
  let best = null;
  for (const [index, html] of byIndex) {
    if (index < current && (!best || index > best.index)) {
      best = { index, html };
    }
  }
  return best;
}

module.exports = {
  resolveAssetFirstMotionArgs,
  isSceneHtmlNode,
  hasCaptionsForBeat,
  buildSceneBeatsBrief,
  summarizeBaseLayout,
  continuityGroupId,
  bucketJobsByContinuityGroup,
  runBucketsWithContinuity,
  ensureMotionOverlay,
  predecessorForBeat,
};
