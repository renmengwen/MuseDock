const fsp = require('fs/promises');
const path = require('path');

const projectStore = require('./projectStore');
const frameHtmlAgent = require('./frameHtmlAgent');
const frameFallbackBuilder = require('./frameFallbackBuilder');
const { markCheckpointStage, markCheckpointFrame } = require('./projectSchema');
const { createDiagnostic, normalizeDiagnostics } = require('./diagnostics');
const { normalizeCaptions, trustedSceneDuration } = require('./rawHtmlFrameBuilder');
const { resolveNodeSceneId } = require('./sceneGraphBinding');
const {
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
} = require('./motionOverlayPhase');
const {
  FRAME_PROMPT_VERSION,
  computeFrameInputFingerprint,
  computeFrameHtmlStats,
  frameHtmlStatsEntry,
  groupBeatsForSceneHtml,
  buildSceneTimelineScript,
} = require('./frameHtmlPhaseSupport');
const { AGENTS, STAGES } = require('../agentStages');

const FRAME_HTML_MODEL_OPTIONS = { requestTimeoutMs: 180000, maxRetries: 1 };
const FRAME_HTML_CONCURRENCY = 1;

function isProviderMissingText(message) {
  return /返回结果缺少文本内容|流式返回结果缺少文本内容/.test(String(message || ''));
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
          const frameId = node.id || sceneId;
          const message = `第 ${index + 1} 帧自动修复后仍存在布局遮挡：${summarizeLayoutIssues(unresolved)}`;
          htmlResult = {
            success: false,
            message,
            failed_html: htmlResult.html,
            diagnostics: [createDiagnostic({
              code: 'frame_layout_qa_unresolved',
              stage: 'ai-frame-html',
              sub_stage: 'frame_html',
              frame_id: frameId,
              severity: 'error',
              retryable: true,
              repair_action: 'retry_frame_html',
              fallback_allowed: false,
              user_message: message,
              details: { frame_id: frameId, issues: unresolved.slice(0, 5) },
            })],
          };
        }
        await report(onProgress, {
          type: 'html_video_frame_layout_repair_done',
          stage: 'project',
          sub_stage: 'frame_html',
          message: unresolved.length
            ? `第 ${index + 1}/${nodes.length} 帧布局自动修复后仍有遮挡，判为生成失败。`
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
