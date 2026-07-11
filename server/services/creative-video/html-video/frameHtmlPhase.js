const fsp = require('fs/promises');
const path = require('path');

const projectStore = require('./projectStore');
const frameHtmlAgent = require('./frameHtmlAgent');
const frameFallbackBuilder = require('./frameFallbackBuilder');
const { markCheckpointStage, markCheckpointFrame } = require('./projectSchema');
const { createDiagnostic, normalizeDiagnostics } = require('./diagnostics');
const { normalizeCaptions, trustedSceneDuration } = require('./rawHtmlFrameBuilder');
const { resolveNodeSceneId } = require('./sceneGraphBinding');
const { loadOverlaySnippet, loadDiagramSkeleton, validateOverlayHtml } = require('./motionPrimitiveCatalog');
const { htmlEscape } = require('./materializer');
const { AGENTS, STAGES } = require('../agentStages');

const FRAME_HTML_MODEL_OPTIONS = { requestTimeoutMs: 180000, maxRetries: 1 };
const FRAME_HTML_CONCURRENCY = 1;

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

// asset_first 时从 node.metadata.visual_beat（R3 唯一下传通道）取 beat 编排并加载 primitive 参考片段；
// hf_first 返回空对象，agent 侧不追加任何新 prompt 段。
function resolveAssetFirstMotionArgs(node, creativeContext) {
  if (creativeContext?.visual_strategy !== 'asset_first') return {};
  const beat = node?.metadata?.visual_beat || {};
  if (!beat.motion_overlay) return {};
  const primitiveSnippet = beat.motion_overlay?.preset ? safeLoad(loadOverlaySnippet, beat.motion_overlay.preset) : '';
  const diagramSkeleton = beat.visual_base?.type === 'diagram' ? safeLoad(loadDiagramSkeleton) : '';
  // previousBeatSummary 由分桶调度侧透传（见 runBucketsWithContinuity）、hasCaptions 由 Task 5.2 后续接入
  return { beat, primitiveSnippet, diagramSkeleton };
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
// initialHtmlByGroup：分桶前已生成的帧（如串行首帧）HTML，按 group_id 作为对应桶的初始 previousHtml。
async function runBucketsWithContinuity({ buckets = [], concurrency = 1, runJob, initialHtmlByGroup = new Map() } = {}) {
  const bucketResults = await mapLimit(buckets, concurrency, async bucket => {
    const results = [];
    const groupId = bucket.length ? continuityGroupId(bucket[0]) : null;
    let previousHtml = (groupId && initialHtmlByGroup.get(groupId)) || '';
    for (const job of bucket) {
      const beat = job.node?.metadata?.visual_beat || {};
      const result = await runJob({
        ...job,
        previousBeatSummary: (beat.continuity?.beat_index || 1) > 1 && previousHtml
          ? summarizeBaseLayout(previousHtml)
          : '',
      });
      if (result?.htmlResult?.success) previousHtml = result.htmlResult.html;
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

// asset_first 时若模型漏写 overlay（无 data-mp-overlay），确定性注入 primitive 兜底片段；
// hf_first 或已有 overlay 时原样返回（硬约束 A）。
function ensureMotionOverlay(html = '', beat = {}, { visualStrategy = null } = {}) {
  if (visualStrategy !== 'asset_first') return { html, injected: false };
  const preset = beat.motion_overlay?.preset;
  if (!preset) return { html, injected: false };
  const text = String(html);
  if (text.includes('data-mp-overlay')) return { html: text, injected: false };
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
    template,
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
  // asset_first 时按 beat 收集帧 HTML 静态统计与 overlay 确定性校验结果；
  // hf_first 保持空对象（硬约束 A：不产生任何新 issue/统计）。
  const isAssetFirst = creativeContext?.visual_strategy === 'asset_first';
  const statsByBeatId = {};
  const nodes = contentGraph.nodes || [];
  const scenes = new Map((Array.isArray(sceneSpec?.scenes) ? sceneSpec.scenes : []).map(scene => [scene.id, scene]));
  let visualStyleReferenceHtml = '';
  const frameResults = [];
  const frameJobs = [];
  let completedFrameHtmlCount = 0;
  const concurrency = Math.min(5, Math.max(1, Math.round(Number(frameHtmlConcurrency) || FRAME_HTML_CONCURRENCY)));
  const frameHtmlRunsInParallel = concurrency > 1;
  const generateFrameJob = async job => {
    const { index, node, sceneId, scene, styleReferenceHtml } = job;
    // previousBeatSummary 仅 asset_first 分桶路径会写入（hf_first 恒为 undefined，不改变原展开形态）
    const assetFirstMotionArgs = {
      ...resolveAssetFirstMotionArgs(node, creativeContext),
      ...(job.previousBeatSummary ? { previousBeatSummary: job.previousBeatSummary } : {}),
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
      template,
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
        template,
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
            template,
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
          template,
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
    // raw_html 帧校验通过后、写盘前：asset_first 且模型漏写 overlay 时确定性注入 primitive 兜底片段
    if (htmlResult.success && assetFirstMotionArgs.beat) {
      const overlayResult = ensureMotionOverlay(htmlResult.html, assetFirstMotionArgs.beat, {
        visualStrategy: creativeContext?.visual_strategy || null,
      });
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
    if (routingDecision?.source_mode === 'template_inputs') {
      const durationSec = trustedSceneDuration(scene || {}, node);
      nodes[index] = { ...node, durationSec };
      contentGraph = { ...contentGraph, nodes };
      project = await projectStore.writeProjectJson(projectDir, current => {
        current.content_graph = contentGraph;
        markCheckpointStage(current, 'frame_html', { status: 'partial' });
        markCheckpointFrame(current, 'frame_html', frameKey || sceneId, {
          status: 'skipped',
          diagnostic_code: '',
        });
        return current;
      });
      completedFrameHtmlCount += 1;
      await report(onProgress, {
        type: 'html_video_frame_template_inputs_selected',
        stage: 'project',
        sub_stage: 'frame_html',
        message: `第 ${index + 1}/${nodes.length} 帧已匹配模板变量，跳过自由 HTML 生成。`,
        frame_id: node.id,
        data: {
          frame_id: node.id,
          template_id: routingDecision.template_id,
          index,
          total: nodes.length,
          completed: completedFrameHtmlCount,
        },
      });
      continue;
    }
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
    // 首帧串行生成时记录其所属 continuity group 的 HTML，作为 asset_first 分桶的初始 previousHtml
    const initialHtmlByGroup = new Map();
    if (!visualStyleReferenceHtml) {
      const firstResult = await generateFrameJob({
        ...frameJobs[0],
        styleReferenceHtml: '',
      });
      frameResults.push(firstResult);
      if (firstResult.htmlResult.success) {
        visualStyleReferenceHtml = firstResult.htmlResult.html;
        if (isAssetFirst) {
          const firstGroupId = continuityGroupId(frameJobs[0]);
          if (firstGroupId) initialHtmlByGroup.set(firstGroupId, firstResult.htmlResult.html);
        }
      }
      remainingJobs = frameJobs.slice(1);
    }
    if (isAssetFirst) {
      // asset_first：按 continuity group 分桶，桶间沿用并发上限、桶内串行传前帧布局摘要
      const buckets = bucketJobsByContinuityGroup(
        remainingJobs.map(job => ({ ...job, styleReferenceHtml: visualStyleReferenceHtml })),
      );
      frameResults.push(...await runBucketsWithContinuity({
        buckets,
        concurrency,
        runJob: generateFrameJob,
        initialHtmlByGroup,
      }));
    } else {
      frameResults.push(...await mapLimit(
        remainingJobs.map(job => ({ ...job, styleReferenceHtml: visualStyleReferenceHtml })),
        concurrency,
        generateFrameJob,
      ));
    }
  }

  for (const frameResult of frameResults.sort((a, b) => a.index - b.index)) {
    const { index, node, sceneId, scene, htmlResult } = frameResult;
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
    if (isAssetFirst) {
      const frameHeight = Number(frameHtmlAgent.resolveResolution(templateRenderTarget)?.height) || 1920;
      statsByBeatId[frameKey || node.id || sceneId] = {
        ...computeFrameHtmlStats(htmlResult.html),
        overlay_check: /data-mp-overlay/.test(String(htmlResult.html || ''))
          ? validateOverlayHtml(htmlResult.html, { height: frameHeight })
          : null,
      };
    }
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

module.exports = {
  runFrameHtmlPhase,
  isProviderMissingText,
  computeFrameHtmlStats,
  ensureMotionOverlay,
  summarizeBaseLayout,
  bucketJobsByContinuityGroup,
  runBucketsWithContinuity,
  FRAME_HTML_CONCURRENCY,
  FRAME_HTML_MODEL_OPTIONS,
};
