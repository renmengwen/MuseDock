const fsp = require('fs/promises');
const path = require('path');

const projectStore = require('./projectStore');
const frameHtmlAgent = require('./frameHtmlAgent');
const frameFallbackBuilder = require('./frameFallbackBuilder');
const { markCheckpointStage, markCheckpointFrame } = require('./projectSchema');
const { createDiagnostic, normalizeDiagnostics } = require('./diagnostics');
const { normalizeCaptions, trustedSceneDuration } = require('./rawHtmlFrameBuilder');
const { resolveNodeSceneId } = require('./sceneGraphBinding');
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
      visualStyleReferenceHtml: styleReferenceHtml,
      previousFrameHtml: '',
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
        visualStyleReferenceHtml: styleReferenceHtml,
        previousFrameHtml: '',
      });
      if (!htmlResult.success && isFrameProviderMissingText(htmlResult)) {
        const failedHtmlPath = await writeFailedFrameHtml(projectDir, sceneId, htmlResult.failed_html || previousFailedHtml);
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
          visualStyleReferenceHtml: styleReferenceHtml,
          previousFrameHtml: '',
          layoutFeedback: summarizeLayoutIssues(firstBlocking),
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
    return { ...job, htmlResult };
  };

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const sceneId = resolveNodeSceneId(node) || node.id;
    const scene = scenes.get(sceneId);
    // per_scene 模式下 workflow 传入的是 beat 决策按 scene 聚合后的结构：
    // 仅当该场景全部 beat 都是 template_inputs 时 source_mode 才是 template_inputs（跳过场景 HTML 生成）；
    // 任一 beat 是 raw_html（或缺决策）都会生成场景 HTML，供同场景 raw beat 共享
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
        markCheckpointFrame(current, 'frame_html', sceneId, {
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
    const checkpointFrame = objectOrEmpty(project.generation_checkpoint?.stages?.frame_html?.frames?.[sceneId]);
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
    if (!visualStyleReferenceHtml) {
      const firstResult = await generateFrameJob({
        ...frameJobs[0],
        styleReferenceHtml: '',
      });
      frameResults.push(firstResult);
      if (firstResult.htmlResult.success) visualStyleReferenceHtml = firstResult.htmlResult.html;
      remainingJobs = frameJobs.slice(1);
    }
    frameResults.push(...await mapLimit(
      remainingJobs.map(job => ({ ...job, styleReferenceHtml: visualStyleReferenceHtml })),
      concurrency,
      generateFrameJob,
    ));
  }

  for (const frameResult of frameResults.sort((a, b) => a.index - b.index)) {
    const { index, node, sceneId, scene, htmlResult } = frameResult;
    if (!htmlResult.success) {
      const failedHtmlPath = await writeFailedFrameHtml(projectDir, sceneId, htmlResult.failed_html);
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
        invalidateFrameHtmlDependents(current, sceneId);
        markCheckpointStage(current, 'frame_html', { status: 'partial' });
        markCheckpointFrame(current, 'frame_html', sceneId, {
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
    const durationSec = trustedSceneDuration(scene || {}, node);
    const captions = mediaOptions.generateCaptions !== false && scene
      ? normalizeCaptions(scene, durationSec)
      : [];
    let written;
    try {
      written = await projectStore.writeRawFrameHtml({
        projectDir,
        sceneId,
        order: index + 1,
        html: htmlResult.html,
        captions,
        durationSec,
      });
    } catch (error) {
      project = await projectStore.writeProjectJson(projectDir, current => {
        invalidateFrameHtmlDependents(current, sceneId);
        markCheckpointStage(current, 'frame_html', { status: 'partial' });
        markCheckpointFrame(current, 'frame_html', sceneId, {
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
      invalidateFrameHtmlDependents(current, sceneId);
      current.content_graph = contentGraph;
      markCheckpointStage(current, 'frame_html', { status: 'partial' });
      markCheckpointFrame(current, 'frame_html', sceneId, {
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

  return { ok: true, project, contentGraph };
}

module.exports = {
  runFrameHtmlPhase,
  isProviderMissingText,
  FRAME_HTML_CONCURRENCY,
  FRAME_HTML_MODEL_OPTIONS,
};
