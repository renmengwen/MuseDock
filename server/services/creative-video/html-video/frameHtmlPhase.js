const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const projectStore = require('./projectStore');
const frameHtmlAgent = require('./frameHtmlAgent');
const frameFallbackBuilder = require('./frameFallbackBuilder');
const { markCheckpointStage, markCheckpointFrame } = require('./projectSchema');
const { createDiagnostic, normalizeDiagnostics } = require('./diagnostics');
const { normalizeCaptions, trustedSceneDuration } = require('./rawHtmlFrameBuilder');
const { sliceCaptionsToWindow } = require('./captionLayer');
const { DEFAULT_FRAME_DURATION_SEC } = require('./contentGraph');
const { resolveNodeSceneId } = require('./sceneGraphBinding');
const { loadOverlaySnippet, loadDiagramSkeleton, validateOverlayHtml, hasRealOverlayElement } = require('./motionPrimitiveCatalog');
const { htmlEscape } = require('./materializer');
const { AGENTS, STAGES } = require('../agentStages');

const FRAME_HTML_MODEL_OPTIONS = { requestTimeoutMs: 180000, maxRetries: 1 };
const FRAME_HTML_CONCURRENCY = 1;

// Frame HTML 生成提示词/primitive 结构版本号：当 frameHtmlAgent 的 prompt 结构、primitive
// 参考片段语义或帧 HTML 约定发生会影响产物的变化时手动 +1，使旧 checkpoint 指纹失配、
// resume 时强制重新生成，避免代码升级后静默复用旧版产物。
const FRAME_PROMPT_VERSION = 1;

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

function isProviderMissingText(message) {
  return /返回结果缺少文本内容|流式返回结果缺少文本内容/.test(String(message || ''));
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
  if (!beat?.motion_overlay) return sceneBeatsBrief ? { sceneBeatsBrief } : {};
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

function firstExplicitDiagnosticCode(diagnostics) {
  if (!Array.isArray(diagnostics)) return '';
  for (const item of diagnostics) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const code = String(item.code || '').trim().replace(/-/g, '_');
    if (code) return code;
  }
  return '';
}

async function writeFailedFrameHtml(projectDir, sceneId, html) {
  const text = String(html || '');
  if (!text.trim()) return '';
  const safeSceneId = String(sceneId || 'frame').replace(/[^A-Za-z0-9_.-]+/g, '_') || 'frame';
  const relativePath = `frames/.failed/${safeSceneId}.html`;
  const absolutePath = projectStore.resolveProjectPath(projectDir, relativePath);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsp.writeFile(absolutePath, text, 'utf8');
  return relativePath;
}

function isFrameProviderMissingText(result = {}) {
  const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
  if (diagnostics.some(item => item?.details?.retry_provider_missing_text === true)) return true;
  const diagnosticCode = firstExplicitDiagnosticCode(diagnostics);
  if (diagnosticCode) return diagnosticCode === 'provider_missing_text';
  return isProviderMissingText(result.message);
}

function frameFallbackDiagnostic(frameId, details = {}) {
  return createDiagnostic({
    code: 'fallback_frame_html_used',
    stage: 'ai-frame-html',
    sub_stage: 'frame_html',
    frame_id: frameId,
    severity: 'warning',
    fallback_allowed: true,
    retryable: false,
    user_message: '当前帧 AI 生成连续失败，已使用基础 HTML 兜底。',
    details,
  });
}

function clipText(value, max = 42) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function blockingLayoutIssues(report = {}) {
  return (Array.isArray(report.issues) ? report.issues : [])
    .filter(issue => issue && issue.severity !== 'warning' && issue.severity !== 'info');
}

function summarizeLayoutIssues(issues = []) {
  return issues.slice(0, 3).map((issue) => {
    const details = issue.details || {};
    const pair = details.first?.text && details.second?.text
      ? `「${clipText(details.first.text)}」与「${clipText(details.second.text)}」互相遮挡`
      : (details.text ? `「${clipText(details.text)}」` : '');
    return [issue.message || issue.code, pair].filter(Boolean).join('：');
  }).join('；');
}

async function inspectGeneratedFrameLayout({
  layoutQaService,
  projectDir,
  sceneId,
  node,
  scene,
  html,
  target,
}) {
  const safeSceneId = String(sceneId || node.id || 'frame').replace(/[^A-Za-z0-9_.-]+/g, '_') || 'frame';
  const relativePath = `frames/.qa/${safeSceneId}.html`;
  const absolutePath = projectStore.resolveProjectPath(projectDir, relativePath);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsp.writeFile(absolutePath, String(html || ''), 'utf8');
  try {
    return await layoutQaService.inspectFrameHtmlLayout({
      htmlPath: absolutePath,
      frame: { id: node.id || sceneId },
      resolution: frameHtmlAgent.resolveResolution(target),
      durationSec: trustedSceneDuration(scene || {}, node),
    });
  } catch (error) {
    // ponytail: QA 基建失败不拦帧，渲染前的 layout gate 仍是最终兜底
    return { success: true, issues: [], metrics: { skipped: true, error: error.message || String(error) } };
  }
}

// P2-A：复用帧也要进入连续性与统计链路（asset_first 专用）：
// (1) 复用 HTML 产生与新生成帧同构的 stats/overlay_check，避免全复用/半复用时 render_decisions 统计丢失；
// (2) 按 continuity group + beat_index 全量记录复用 HTML（P2-1：不再只留组内最大者，
//     定向重试任意中间 beat 时可查其真实前驱）。空 HTML 容错跳过。
function collectReusedFrameContext({
  node,
  html,
  frameKey,
  frameHeight = 1920,
  statsByBeatId = {},
  initialHtmlByGroup = new Map(),
} = {}) {
  const text = String(html || '');
  if (!text.trim() || !frameKey) return;
  statsByBeatId[frameKey] = frameHtmlStatsEntry(text, frameHeight);
  const groupId = continuityGroupId({ node });
  if (!groupId) return;
  const beatIndex = Number(node?.metadata?.visual_beat?.continuity?.beat_index) || 1;
  recordGroupHtml(initialHtmlByGroup, groupId, beatIndex, text);
}

// P2-1：向 Map<group_id, Map<beat_index, html>> 记录一帧已就绪 HTML
function recordGroupHtml(initialHtmlByGroup, groupId, beatIndex, html) {
  if (!groupId) return;
  let byIndex = initialHtmlByGroup.get(groupId);
  if (!(byIndex instanceof Map)) {
    byIndex = new Map();
    initialHtmlByGroup.set(groupId, byIndex);
  }
  byIndex.set(Number(beatIndex) || 1, html);
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

// P2-1 兼容导出：仅返回前驱 HTML（既有单测/调用方沿用旧签名）
function predecessorHtmlForBeat(initialHtmlByGroup, groupId, beatIndex) {
  return predecessorForBeat(initialHtmlByGroup, groupId, beatIndex)?.html || '';
}

/**
 * 生成（或复用）每一帧的 HTML，并写盘 + 打 checkpoint。
 * 行为与原 generateHtmlVideo 内联实现 1:1 一致。
 * @returns {Promise<{ok:true, project:object, contentGraph:object}|{ok:false, failure:object}>}
 */
async function runFrameHtmlPhase(ctx) {
  const {
    model,
    projectDir,
    sceneSpec,
    creativeContext,
    templateRenderTarget,
    mediaOptions,
    frameHtmlConcurrency,
    resumeAllowed,
    regenerateFrameHtmlRequested,
    runLayoutQa,
    layoutQaService,
    onProgress,
    diagnostics,
    // workflow-local 共享助手
    report,
    objectOrEmpty,
    sha256,
    failure,
    shouldReuseFrameHtml,
    invalidateFrameHtmlDependents,
    templateRoutingDecisions,
  } = ctx;
  let { project, contentGraph } = ctx;

  const styleProfile = objectOrEmpty(project.visual_plan?.style_profile);
  // 按 beat 收集帧 HTML 静态统计与 overlay 确定性校验结果
  const statsByBeatId = {};
  // overlay 校验用的帧高在整个 phase 内不变，循环外算一次
  const frameHeight = Number(frameHtmlAgent.resolveResolution(templateRenderTarget)?.height) || 1920;
  const nodes = contentGraph.nodes || [];
  const scenes = new Map((Array.isArray(sceneSpec?.scenes) ? sceneSpec.scenes : []).map(scene => [scene.id, scene]));
  let visualStyleReferenceHtml = '';
  const frameResults = [];
  const frameJobs = [];
  // 复用帧与串行首帧共同维护「按 continuity group + beat_index 的已就绪 HTML」，
  // 供分桶调度按前驱选取同组后续 beat 的布局摘要来源。
  const initialHtmlByGroup = new Map();
  let completedFrameHtmlCount = 0;
  const concurrency = Math.min(5, Math.max(1, Math.round(Number(frameHtmlConcurrency) || FRAME_HTML_CONCURRENCY)));
  const frameHtmlRunsInParallel = concurrency > 1;
  const generateFrameJob = async job => {
    const { index, node, sceneId, scene, styleReferenceHtml } = job;
    // previousBeatSummary 仅分桶路径会写入
    const jobBeatId = String(node.beat_id || node.beatId || '').trim();
    const assetFirstMotionArgs = {
      // P2-3(a)：scene/beats/mediaOptions 下传给 buildSceneBeatsBrief，
      // 供 scene_html 节点按 beat 判定字幕、给无字幕 beat 追加画面重点短句要求
      ...resolveAssetFirstMotionArgs(node, {
        scene,
        beats: project.visual_plan?.beats || [],
        mediaOptions,
      }),
      ...(job.previousBeatSummary ? { previousBeatSummary: job.previousBeatSummary } : {}),
      // R8：仅 beat_mp4 帧计算 hasCaptions（scene_html 的 scene 级帧 beat 粒度不适用，
      // 保持 undefined，agent 侧缺省 true 不追加要求行）
      ...(jobBeatId && node?.metadata?.visual_beat && !isSceneHtmlNode(node)
        ? {
          hasCaptions: hasCaptionsForBeat({
            scene,
            beats: project.visual_plan?.beats || [],
            beatId: jobBeatId,
            mediaOptions,
          }),
        }
        : {}),
    };
    await report(onProgress, {
      type: 'html_video_frame_html_started',
      stage: 'project',
      sub_stage: 'frame_html',
      message: frameHtmlRunsInParallel
        ? `正在并发生成第 ${index + 1}/${nodes.length} 帧 HTML...`
        : `正在逐帧生成第 ${index + 1}/${nodes.length} 帧 HTML...`,
      frame_id: node.id,
      data: {
        frame_id: node.id,
        index,
        total: nodes.length,
        completed: completedFrameHtmlCount,
        parallel: frameHtmlRunsInParallel,
        concurrency,
      },
    });
    let htmlResult = await frameHtmlAgent.generateFrameHtml({
      model,
      frameId: node.id || sceneId,
      attempt: 1,
      modelOptions: {
        ...FRAME_HTML_MODEL_OPTIONS,
        audit: {
          agent: AGENTS.frameHtml,
          stage: STAGES.frameHtml,
          sub_stage: 'frame_html',
          frame_id: node.id || sceneId,
          node_id: node.id || '',
          attempt: 1,
        },
      },
      graph: contentGraph,
      node,
      index,
      total: nodes.length,
      sceneSpec,
      creativeContext,
      target: templateRenderTarget,
      styleProfile,
      visualStyleReferenceHtml: styleReferenceHtml,
      previousFrameHtml: '',
      ...assetFirstMotionArgs,
    });
    if (!htmlResult.success && isFrameProviderMissingText(htmlResult)) {
      const previousFailedHtml = htmlResult.failed_html;
      const previousDiagnostics = Array.isArray(htmlResult.diagnostics) ? htmlResult.diagnostics : [];
      htmlResult = await frameHtmlAgent.generateFrameHtml({
        model,
        frameId: node.id || sceneId,
        attempt: 2,
        modelOptions: {
          ...FRAME_HTML_MODEL_OPTIONS,
          stream: false,
          audit: {
            agent: AGENTS.frameHtml,
            stage: STAGES.frameHtml,
            sub_stage: 'frame_html',
            frame_id: node.id || sceneId,
            node_id: node.id || '',
            attempt: 2,
          },
        },
        shortPrompt: true,
        graph: contentGraph,
        node,
        index,
        total: nodes.length,
        sceneSpec,
        creativeContext,
        target: templateRenderTarget,
        styleProfile,
        visualStyleReferenceHtml: styleReferenceHtml,
        previousFrameHtml: '',
        ...assetFirstMotionArgs,
      });
      if (!htmlResult.success && isFrameProviderMissingText(htmlResult)) {
        const failedHtmlPath = await writeFailedFrameHtml(
          projectDir,
          String(node.beat_id || node.beatId || node.id || sceneId || '').trim() || sceneId,
          htmlResult.failed_html || previousFailedHtml,
        );
        const warning = frameFallbackDiagnostic(node.id || sceneId, {
          ...(failedHtmlPath ? { failed_html_path: failedHtmlPath } : {}),
          diagnostics: [
            ...previousDiagnostics.map(item => item?.user_message || item?.message || item?.code).filter(Boolean),
            ...(Array.isArray(htmlResult.diagnostics) ? htmlResult.diagnostics : []).map(item => item?.user_message || item?.message || item?.code).filter(Boolean),
          ].slice(0, 6),
        });
        diagnostics.push(warning);
        htmlResult = {
          success: true,
          html: frameFallbackBuilder.buildFallbackFrameHtml({
            scene,
            node,
            target: templateRenderTarget,
          }),
          fallbackDiagnostic: warning,
        };
      }
    }
    if (
      htmlResult.success
      && !htmlResult.fallbackDiagnostic
      && runLayoutQa === true
      && layoutQaService
      && typeof layoutQaService.inspectFrameHtmlLayout === 'function'
    ) {
      const layoutQaArgs = {
        layoutQaService,
        projectDir,
        sceneId,
        node,
        scene,
        target: templateRenderTarget,
      };
      const firstQa = await inspectGeneratedFrameLayout({ ...layoutQaArgs, html: htmlResult.html });
      const firstBlocking = blockingLayoutIssues(firstQa);
      if (firstBlocking.length) {
        await report(onProgress, {
          type: 'html_video_frame_layout_repair_started',
          stage: 'project',
          sub_stage: 'frame_html',
          message: `第 ${index + 1}/${nodes.length} 帧检测到布局遮挡，正在自动修复...`,
          frame_id: node.id,
          data: { frame_id: node.id, issues: firstBlocking.slice(0, 3) },
        });
        const repaired = await frameHtmlAgent.generateFrameHtml({
          model,
          frameId: node.id || sceneId,
          attempt: 2,
          modelOptions: {
            ...FRAME_HTML_MODEL_OPTIONS,
            stream: false,
            audit: {
              agent: AGENTS.frameHtml,
              stage: STAGES.frameHtml,
              sub_stage: 'frame_html',
              frame_id: node.id || sceneId,
              node_id: node.id || '',
              attempt: 2,
              repair_attempt: 'layout_qa',
            },
          },
          graph: contentGraph,
          node,
          index,
          total: nodes.length,
          sceneSpec,
          creativeContext,
          target: templateRenderTarget,
          styleProfile,
          visualStyleReferenceHtml: styleReferenceHtml,
          previousFrameHtml: '',
          layoutFeedback: summarizeLayoutIssues(firstBlocking),
          ...assetFirstMotionArgs,
        });
        let unresolved = firstBlocking;
        if (repaired.success) {
          const secondQa = await inspectGeneratedFrameLayout({ ...layoutQaArgs, html: repaired.html });
          const secondBlocking = blockingLayoutIssues(secondQa);
          if (secondBlocking.length < firstBlocking.length) {
            htmlResult = { success: true, html: repaired.html, diagnostics: repaired.diagnostics || [] };
            unresolved = secondBlocking;
          }
        }
        if (unresolved.length) {
          diagnostics.push(createDiagnostic({
            code: 'frame_layout_qa_unresolved',
            stage: 'ai-frame-html',
            sub_stage: 'frame_html',
            frame_id: node.id || sceneId,
            severity: 'warning',
            retryable: true,
            repair_action: 'retry_frame_html',
            fallback_allowed: true,
            user_message: `第 ${index + 1} 帧自动修复后仍可能存在布局遮挡：${summarizeLayoutIssues(unresolved)}`,
            details: { frame_id: node.id || sceneId, issues: unresolved.slice(0, 5) },
          }));
        }
        await report(onProgress, {
          type: 'html_video_frame_layout_repair_done',
          stage: 'project',
          sub_stage: 'frame_html',
          message: unresolved.length
            ? `第 ${index + 1}/${nodes.length} 帧布局自动修复后仍有疑似遮挡，已记录警告。`
            : `第 ${index + 1}/${nodes.length} 帧布局遮挡已自动修复。`,
          frame_id: node.id,
          data: { frame_id: node.id, resolved: unresolved.length === 0, remaining_issues: unresolved.slice(0, 3) },
        });
      }
    }
    // raw_html 帧校验通过后、写盘前：asset_first 且模型漏写 overlay 时确定性注入 primitive 兜底片段；
    // scene_html 的 scene 级节点跳过兜底（单 beat 片段无 scope，注入会全程常显破坏分 beat 显隐）
    if (htmlResult.success && assetFirstMotionArgs.beat && !isSceneHtmlNode(node)) {
      const overlayResult = ensureMotionOverlay(htmlResult.html, assetFirstMotionArgs.beat);
      if (overlayResult.injected) {
        htmlResult = { ...htmlResult, html: overlayResult.html };
        diagnostics.push(createDiagnostic({
          code: 'overlay_primitive_injected',
          stage: 'ai-frame-html',
          sub_stage: 'frame_html',
          frame_id: node.id || sceneId,
          severity: 'warning',
          retryable: false,
          user_message: '模型未按 primitive 落 overlay，已确定性注入兜底片段。',
          details: { frame_id: node.id || sceneId, preset: assetFirstMotionArgs.beat.motion_overlay?.preset || '' },
        }));
      }
    }
    return { ...job, htmlResult };
  };

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const sceneId = resolveNodeSceneId(node) || node.id;
    const frameKey = String(node.beat_id || node.beatId || node.id || sceneId || '').trim();
    const scene = scenes.get(sceneId);
    const beatId = String(node.beat_id || node.beatId || '').trim();
    const routingDecision = templateRoutingDecisions instanceof Map
      ? (beatId ? templateRoutingDecisions.get(beatId) : null) || templateRoutingDecisions.get(sceneId)
      : (beatId ? objectOrEmpty(templateRoutingDecisions)[beatId] : null) || objectOrEmpty(templateRoutingDecisions)[sceneId];
    // 兼容旧版按 sceneId 键控的 checkpoint：beat 键 miss 时回退场景键（场景 HTML 由同场景 beat 共享）
    const checkpointFrames = objectOrEmpty(project.generation_checkpoint?.stages?.frame_html?.frames);
    const checkpointFrame = objectOrEmpty(
      checkpointFrames[frameKey || sceneId] || checkpointFrames[sceneId] || checkpointFrames[node.id],
    );
    const reuse = shouldReuseFrameHtml({
      projectDir,
      checkpointFrame,
      scene,
      node,
      target: templateRenderTarget,
      resumeAllowed: resumeAllowed && !regenerateFrameHtmlRequested,
      // P1-2：真实输入指纹比较——checkpoint 有指纹且不匹配则重新生成；无指纹的旧工程不复用
      inputFingerprint: computeFrameInputFingerprint({
        node,
        continuityMode: creativeContext?.continuity_mode,
        target: templateRenderTarget,
      }),
    });
    if (reuse.reuse) {
      const durationSec = trustedSceneDuration(scene || {}, node);
      nodes[index] = {
        ...node,
        durationSec,
        html_path: reuse.html_path,
      };
      contentGraph = {
        ...contentGraph,
        nodes,
      };
      project = await projectStore.writeProjectJson(projectDir, current => {
        current.content_graph = contentGraph;
        markCheckpointStage(current, 'frame_html', { status: 'partial' });
        return current;
      });
      if (!visualStyleReferenceHtml) visualStyleReferenceHtml = reuse.html;
      // P2-A：复用帧进入统计与连续性链路
      collectReusedFrameContext({
        node,
        html: reuse.html,
        frameKey: frameKey || node.id || sceneId,
        frameHeight,
        statsByBeatId,
        initialHtmlByGroup,
      });
      completedFrameHtmlCount += 1;
      await report(onProgress, {
        type: 'html_video_frame_html_done',
        stage: 'project',
        sub_stage: 'frame_html',
        message: `第 ${index + 1}/${nodes.length} 帧 HTML 已复用。`,
        frame_id: node.id,
        data: {
          frame_id: node.id,
          index,
          total: nodes.length,
          reused: true,
          completed: completedFrameHtmlCount,
        },
      });
      continue;
    }
    frameJobs.push({ index, node, sceneId, scene });
  }

  if (frameJobs.length > 1) {
    await report(onProgress, {
      type: 'html_video_frame_html_parallel_started',
      stage: 'project',
      sub_stage: 'frame_html',
      message: frameHtmlRunsInParallel
        ? `正在并发生成 ${frameJobs.length} 帧 HTML，最多同时生成 ${concurrency} 帧。`
        : `正在逐帧生成 ${frameJobs.length} 帧 HTML。`,
      data: {
        total: nodes.length,
        completed: completedFrameHtmlCount,
        pending: frameJobs.length,
        concurrency,
      },
    });
  }

  if (frameJobs.length) {
    let remainingJobs = frameJobs;
    // 首帧串行生成时记录其所属 continuity group 的 HTML（复用帧已在上方循环写入 initialHtmlByGroup）
    if (!visualStyleReferenceHtml) {
      const firstResult = await generateFrameJob({
        ...frameJobs[0],
        styleReferenceHtml: '',
      });
      frameResults.push(firstResult);
      if (firstResult.htmlResult.success) {
        visualStyleReferenceHtml = firstResult.htmlResult.html;
        const firstGroupId = continuityGroupId(frameJobs[0]);
        if (firstGroupId) {
          const firstBeatIndex = Number(frameJobs[0].node?.metadata?.visual_beat?.continuity?.beat_index) || 1;
          recordGroupHtml(initialHtmlByGroup, firstGroupId, firstBeatIndex, firstResult.htmlResult.html);
        }
      }
      remainingJobs = frameJobs.slice(1);
    }
    // 按 continuity group 分桶，桶间沿用并发上限、桶内串行传前帧布局摘要
    const buckets = bucketJobsByContinuityGroup(
      remainingJobs.map(job => ({ ...job, styleReferenceHtml: visualStyleReferenceHtml })),
    );
    frameResults.push(...await runBucketsWithContinuity({
      buckets,
      concurrency,
      runJob: generateFrameJob,
      initialHtmlByGroup,
    }));
  }

  for (const frameResult of frameResults.sort((a, b) => a.index - b.index)) {
    const { index, node, sceneId, scene } = frameResult;
    let { htmlResult } = frameResult;
    const frameKey = String(node.beat_id || node.beatId || node.id || sceneId || '').trim();
    if (!htmlResult.success) {
      const failedHtmlPath = await writeFailedFrameHtml(projectDir, frameKey || sceneId, htmlResult.failed_html);
      const explicitDiagnosticCode = firstExplicitDiagnosticCode(htmlResult.diagnostics);
      const diagnosticCode = explicitDiagnosticCode || (isProviderMissingText(htmlResult.message) ? 'provider_missing_text' : 'frame_html_invalid');
      let rawDiagnostics = diagnosticCode === 'provider_missing_text' && !explicitDiagnosticCode
        ? (Array.isArray(htmlResult.diagnostics) ? htmlResult.diagnostics : []).map(item => ({
          ...objectOrEmpty(item),
          code: 'provider_missing_text',
        }))
        : htmlResult.diagnostics;
      if (failedHtmlPath && Array.isArray(rawDiagnostics)) {
        rawDiagnostics = rawDiagnostics.map(item => ({
          ...objectOrEmpty(item),
          details: (() => {
            const { failed_html: _failedHtml, ...details } = objectOrEmpty(item?.details);
            return { ...details, failed_html_path: failedHtmlPath };
          })(),
        }));
      }
      const normalizedFrameDiagnostics = normalizeDiagnostics(rawDiagnostics, {
        code: diagnosticCode,
        stage: 'ai-frame-html',
        sub_stage: 'frame_html',
        frame_id: node.id || sceneId,
        user_message: htmlResult.message || '单帧 HTML 生成失败。',
        retryable: true,
        repair_action: 'retry_frame_html',
        details: failedHtmlPath ? { failed_html_path: failedHtmlPath } : {},
      });
      const checkpointDiagnosticCode = normalizedFrameDiagnostics[0]?.code || diagnosticCode;
      project = await projectStore.writeProjectJson(projectDir, current => {
        // 场景 HTML 变更需按 scene_id 扇出失效（覆盖旧版 scene 键与全部 beat 帧），再补 beat 键自身
        invalidateFrameHtmlDependents(current, sceneId);
        if (frameKey && frameKey !== sceneId) invalidateFrameHtmlDependents(current, frameKey);
        markCheckpointStage(current, 'frame_html', { status: 'partial' });
        markCheckpointFrame(current, 'frame_html', frameKey || sceneId, {
          status: 'failed',
          diagnostic_code: checkpointDiagnosticCode,
        });
        return current;
      });
      return { ok: false, failure: failure(htmlResult.message || '单帧 HTML 生成失败。', normalizedFrameDiagnostics.length ? normalizedFrameDiagnostics : [
        createDiagnostic({
          code: diagnosticCode,
          stage: 'ai-frame-html',
          sub_stage: 'frame_html',
          frame_id: node.id || sceneId,
          user_message: htmlResult.message || '单帧 HTML 生成失败。',
          retryable: true,
          repair_action: 'retry_frame_html',
          details: { frame_id: node.id },
        }),
      ], {
        html_video_project_path: projectDir,
        project_dir: projectDir,
      }) };
    }
    if (Array.isArray(htmlResult.diagnostics) && htmlResult.diagnostics.length) {
      diagnostics.push(...normalizeDiagnostics(htmlResult.diagnostics));
    }
    // scene_html：scene 级节点写盘前注入时间线脚本（按时间切 body[data-mp-beat]，驱动分 beat overlay 显隐）
    const sceneBeatWindows = Array.isArray(node?.metadata?.beat_windows) ? node.metadata.beat_windows : [];
    if (sceneBeatWindows.length) {
      const timelineScript = buildSceneTimelineScript(sceneBeatWindows);
      const withTimeline = String(htmlResult.html || '').includes('</body>')
        ? String(htmlResult.html).replace('</body>', `${timelineScript}</body>`)
        : `${htmlResult.html || ''}${timelineScript}`;
      htmlResult = { ...htmlResult, html: withTimeline };
    }
    statsByBeatId[frameKey || node.id || sceneId] = frameHtmlStatsEntry(htmlResult.html, frameHeight);
    const durationSec = trustedSceneDuration(scene || {}, node);
    const captions = mediaOptions.generateCaptions !== false && scene
      ? normalizeCaptions(scene, durationSec)
      : [];
    let written;
    try {
      written = await projectStore.writeRawFrameHtml({
        projectDir,
        sceneId: frameKey || sceneId,
        order: index + 1,
        html: htmlResult.html,
        captions,
        durationSec,
      });
    } catch (error) {
      project = await projectStore.writeProjectJson(projectDir, current => {
        // 场景 HTML 变更需按 scene_id 扇出失效（覆盖旧版 scene 键与全部 beat 帧），再补 beat 键自身
        invalidateFrameHtmlDependents(current, sceneId);
        if (frameKey && frameKey !== sceneId) invalidateFrameHtmlDependents(current, frameKey);
        markCheckpointStage(current, 'frame_html', { status: 'partial' });
        markCheckpointFrame(current, 'frame_html', frameKey || sceneId, {
          status: 'failed',
          diagnostic_code: 'frame_html_write_failed',
        });
        return current;
      });
      return { ok: false, failure: failure(error.message || '单帧 HTML 写入失败。', [
        createDiagnostic({
          code: 'frame_html_write_failed',
          stage: 'frame-html',
          sub_stage: 'frame_html',
          frame_id: node.id || sceneId,
          user_message: '单帧 HTML 写入失败。',
          retryable: true,
          repair_action: 'retry_frame_html',
          details: { frame_id: node.id },
        }),
      ], {
        html_video_project_path: projectDir,
        project_dir: projectDir,
      }) };
    }
    nodes[index] = {
      ...node,
      durationSec,
      html_path: written.html_path,
    };
    contentGraph = {
      ...contentGraph,
      nodes,
    };
    project = await projectStore.writeProjectJson(projectDir, current => {
      // 场景 HTML 变更需按 scene_id 扇出失效（覆盖旧版 scene 键与全部 beat 帧），再补 beat 键自身
      invalidateFrameHtmlDependents(current, sceneId);
      if (frameKey && frameKey !== sceneId) invalidateFrameHtmlDependents(current, frameKey);
      current.content_graph = contentGraph;
      markCheckpointStage(current, 'frame_html', { status: 'partial' });
      markCheckpointFrame(current, 'frame_html', frameKey || sceneId, {
        status: 'done',
        html_path: written.html_path,
        input_hash: sha256(htmlResult.html),
        // P1-2：持久化真实输入指纹（input_hash 是历史遗留的输出 hash，保留不动）
        input_fingerprint: computeFrameInputFingerprint({
          node,
          continuityMode: creativeContext?.continuity_mode,
          target: templateRenderTarget,
        }),
        output_hash: written.output_hash,
        diagnostic_code: htmlResult.fallbackDiagnostic?.code || '',
      });
      return current;
    });
    completedFrameHtmlCount += 1;
    await report(onProgress, {
      type: 'html_video_frame_html_done',
      stage: 'project',
      sub_stage: 'frame_html',
      message: `第 ${index + 1}/${nodes.length} 帧 HTML 已生成。`,
      frame_id: node.id,
      data: {
        frame_id: node.id,
        index,
        total: nodes.length,
        completed: completedFrameHtmlCount,
        parallel: frameJobs.length > 1 && frameHtmlRunsInParallel,
        concurrency: frameJobs.length > 1 ? concurrency : 1,
      },
    });
  }
  project = await projectStore.writeProjectJson(projectDir, current => {
    current.content_graph = contentGraph;
    markCheckpointStage(current, 'frame_html', { status: 'done' });
    return current;
  });

  return { ok: true, project, contentGraph, stats_by_beat_id: statsByBeatId };
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
  runFrameHtmlPhase,
  isProviderMissingText,
  computeFrameHtmlStats,
  ensureMotionOverlay,
  summarizeBaseLayout,
  collectReusedFrameContext,
  predecessorHtmlForBeat,
  buildSceneBeatsBrief,
  hasCaptionsForBeat,
  bucketJobsByContinuityGroup,
  runBucketsWithContinuity,
  groupBeatsForSceneHtml,
  buildSceneTimelineScript,
  computeFrameInputFingerprint,
  FRAME_PROMPT_VERSION,
  FRAME_HTML_CONCURRENCY,
  FRAME_HTML_MODEL_OPTIONS,
};
