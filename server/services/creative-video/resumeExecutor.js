const fs = require('fs/promises');
const path = require('path');

const projectStore = require('./html-video/projectStore');
const { markCheckpointFrame } = require('./html-video/projectSchema');
const projectOrchestrator = require('./html-video/projectOrchestrator');
const { createDiagnostic, normalizeDiagnostics, failureFromDiagnostics } = require('./html-video/diagnostics');
const { mapSceneSpecToContentGraph } = require('./html-video/sceneSpecMapper');
const { repairProjectTimeline, compressNarrationForTarget } = require('./html-video/timelineRepair');
const { computeSceneSpecSpeechHash } = require('./sceneSpecHash');
const { applyManifestToProjectAudio } = require('./ttsService');
const { resolveRetryFrameIds } = require('./retryPlanner');
const defaultVisualQaService = require('./visualQaService');
const { isBlockingVisualQaCode } = require('./visualQaCodes');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function safeString(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function targetDurationSec(project) {
  const value = Number(project?.target?.duration_sec ?? project?.output?.duration);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function expectedAspectRatio(project) {
  const direct = safeString(
    project?.target?.aspect_ratio
    || project?.output?.aspect_ratio
    || project?.generation_checkpoint?.target?.aspect_ratio,
  );
  if (direct) return direct;
  const width = Number(project?.output?.resolution?.width);
  const height = Number(project?.output?.resolution?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';
  const gcd = (left, right) => (right ? gcd(right, left % right) : left);
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function frameIds(project) {
  return arrayOrEmpty(project.frames)
    .map(frame => safeString(frame.scene_id || frame.id))
    .filter(Boolean);
}

function failedFrameIds(project, stageId) {
  const frames = objectOrEmpty(project.generation_checkpoint?.stages?.[stageId]?.frames);
  return Object.entries(frames)
    .filter(([, frame]) => frame?.status === 'failed')
    .map(([frameId]) => frameId);
}

function planFrameIds(plan, project, stageId) {
  const options = objectOrEmpty(plan.executor_options);
  const ids = [
    ...arrayOrEmpty(options.frame_ids),
    safeString(options.frame_id),
  ].filter(Boolean);
  return ids.length ? ids : failedFrameIds(project, stageId);
}

// scene_html 工程：定向失效/重渲染前把 beat 级 frame_ids 归并为 scene:<scene_id> 键；
// beat_mp4（缺省）下 resolveRetryFrameIds 原样返回，行为不变。
function resolveProjectRetryFrameIds(project, frameIds) {
  const beatToScene = {};
  for (const frame of arrayOrEmpty(project?.frames)) {
    const sceneId = safeString(frame?.scene_id);
    if (!sceneId) continue;
    for (const window of arrayOrEmpty(frame?.metadata?.beat_windows)) {
      const beatId = safeString(window?.id);
      if (beatId) beatToScene[beatId] = sceneId;
    }
  }
  return resolveRetryFrameIds(frameIds, {
    continuityMode: safeString(project?.continuity_mode) || 'beat_mp4',
    beatToScene,
  });
}

function actionFailure(message, diagnostics = [], extra = {}) {
  return failureFromDiagnostics(message, normalizeDiagnostics(diagnostics), extra);
}

function configuredAction(services, name) {
  const actions = objectOrEmpty(services.resumeActions);
  return typeof actions[name] === 'function' ? actions[name] : null;
}

function hasCompletedRenderOutput(result = {}) {
  return Boolean(safeString(result.output_path || result.outputPath || result.output_url || result.outputUrl));
}

async function emit(taskContext, event) {
  if (typeof taskContext?.emit !== 'function') return;
  await taskContext.emit(event);
}

async function saveActionProject(projectDir, result, fallbackProject) {
  const project = result?.project || fallbackProject;
  return projectStore.saveProject(projectDir, project);
}

// 与主工作流 htmlVideoWorkflow.isBlockingVisualQaIssue 对齐（共享常量，见 visualQaCodes.js）：
// 开头白屏 / 镜头边界白屏属于阻断问题，resume 路径也必须返回失败而不是标成恢复完成。
function blockingVisualIssuesOf(visualInspectResult) {
  return arrayOrEmpty(visualInspectResult?.issues)
    .filter(issue => isBlockingVisualQaCode(issue?.code));
}

// 巡检结果为失败且含阻断问题时，构造与主流程对齐的 visual_qa_blocking_failure 失败返回；
// 非阻断的 success=false 维持现状（warning 语义），返回 null 表示不阻断。
function visualInspectBlockingFailure(inspected, { projectDir, outputPath } = {}) {
  const visualInspectResult = inspected?.visualInspectResult;
  if (visualInspectResult?.success !== false) return null;
  const blockingIssues = blockingVisualIssuesOf(visualInspectResult);
  if (!blockingIssues.length) return null;
  const message = 'html-video 成片画面存在开头或镜头边界白屏，未通过视觉安全检查。';
  return actionFailure(message, [createDiagnostic({
    // 诊断 code 与主流程字面一致（htmlVideoWorkflow 阻断失败也是 visual_qa_warning 诊断）：
    // retryPlanner 按该 code 才会给出 retry_frame_html，否则下一轮 retry 会陷入只重新巡检的死循环
    code: 'visual_qa_warning',
    stage: 'inspect',
    sub_stage: 'visual_inspect',
    severity: 'error',
    retryable: true,
    repair_action: 'retry_frame_html',
    user_message: message,
    details: {
      issues: arrayOrEmpty(visualInspectResult.issues),
      metrics: objectOrEmpty(visualInspectResult.metrics),
    },
  })], {
    code: 'visual_qa_blocking_failure',
    project: inspected.project,
    project_dir: projectDir,
    html_video_project_path: projectDir,
    output_path: outputPath,
    visualInspectResult,
    // 与主流程 generateHtmlVideo 阻断失败返回的字段名统一，消费方双读兜底
    visual_report: visualInspectResult,
  });
}

async function inspectVisual({ projectDir, project, outputPath, services, taskContext }) {
  const visualQaService = services.visualQaService || defaultVisualQaService;
  await emit(taskContext, {
    type: 'html_video_visual_inspect_started',
    stage: 'project',
    sub_stage: 'visual_inspect',
    message: '正在巡检 html-video 成片画面...',
  });
  const visualInspectResult = await visualQaService.inspectRenderedVideo({
    projectDir,
    outputPath,
    project,
    expectedAspectRatio: expectedAspectRatio(project),
    // asset_first 工程 resume 重巡检时同样走 warnings 观测通道（策略取落盘 project，Task 1.0 已持久化）
    visualStrategy: project?.visual_strategy || null,
  });
  const reportPath = visualInspectResult.report_path || visualInspectResult.reportPath || 'inspect/visual-report.json';
  // 阻断问题（白屏）checkpoint 写 failed，与主工作流对齐；其余失败维持 warning
  const hasBlockingIssues = visualInspectResult.success === false
    && blockingVisualIssuesOf(visualInspectResult).length > 0;
  const nextProject = await projectStore.writeProjectJson(projectDir, current => {
    projectOrchestrator.markVisualInspectCheckpoint(current, {
      status: visualInspectResult.success === false ? (hasBlockingIssues ? 'failed' : 'warning') : 'done',
      report_path: reportPath,
      diagnostic_code: visualInspectResult.success === false ? 'visual_qa_warning' : '',
    });
    return current;
  });
  await emit(taskContext, {
    type: 'html_video_visual_inspect_done',
    stage: 'project',
    sub_stage: 'visual_inspect',
    message: visualInspectResult.success === false ? 'html-video 成片画面巡检发现问题。' : 'html-video 成片画面巡检完成。',
    data: visualInspectResult,
  });
  return { project: nextProject, visualInspectResult };
}

async function composeAndInspect({ workflowId, rootDir, projectDir, project, services, taskContext }) {
  const composed = await projectOrchestrator.composeHtmlVideoProject({
    rootDir,
    workflowId,
    runId: project.run_id,
    projectDir,
    project,
    services,
    onProgress: event => emit(taskContext, event),
    targetDurationSec: targetDurationSec(project),
  });
  if (!composed.success) return composed;
  const inspected = await inspectVisual({
    projectDir,
    project: composed.project,
    outputPath: composed.output_path,
    services,
    taskContext,
  });
  const blockingFailure = visualInspectBlockingFailure(inspected, {
    projectDir,
    outputPath: composed.output_path,
  });
  if (blockingFailure) return blockingFailure;
  return {
    success: true,
    project: inspected.project,
    project_dir: projectDir,
    html_video_project_path: projectDir,
    output_path: composed.output_path,
    renderResult: composed,
    visualInspectResult: inspected.visualInspectResult,
    diagnostics: normalizeDiagnostics(composed.diagnostics),
  };
}

async function renderComposeInspect({
  workflowId,
  rootDir,
  projectDir,
  project,
  frameIds,
  materialize,
  services,
  taskContext,
}) {
  const rendered = await projectOrchestrator.renderHtmlVideoFrames({
    rootDir,
    workflowId,
    runId: project.run_id,
    projectDir,
    project,
    frameIds,
    services,
    onProgress: event => emit(taskContext, event),
    materialize,
  });
  if (!rendered.success) return rendered;
  const composed = await composeAndInspect({
    workflowId,
    rootDir,
    projectDir,
    project: rendered.project,
    services,
    taskContext,
  });
  return {
    ...composed,
    frameRenderResult: rendered,
    diagnostics: [
      ...normalizeDiagnostics(rendered.diagnostics),
      ...normalizeDiagnostics(composed.diagnostics),
    ],
  };
}

async function callConfiguredProjectAction({ name, workflow, project, projectDir, plan, services, taskContext, rootDir, mediaRoot, extra = {} }) {
  const action = configuredAction(services, name);
  if (!action) {
    return actionFailure(`恢复动作 ${name} 未配置，无法自动重试。`, [createDiagnostic({
      code: 'resume_action_not_configured',
      sub_stage: plan.retry_from || plan.repair_action,
      user_message: `恢复动作 ${name} 未配置，无法自动重试。`,
      retryable: false,
    })]);
  }
  const result = await action({
    workflow,
    project,
    projectDir,
    plan,
    rootDir,
    mediaRoot,
    services,
    taskContext,
    ...extra,
  });
  if (!result?.success) return result;
  return {
    ...result,
    project: await saveActionProject(projectDir, result, project),
  };
}

async function retryFrameHtml(context) {
  const { workflowId, rootDir, mediaRoot, workflow, projectDir, plan, services, taskContext } = context;
  const project = context.project;
  const ids = resolveProjectRetryFrameIds(project, planFrameIds(plan, project, 'frame_html'));
  if (!ids.length) {
    return actionFailure('未找到需要重试的 HTML 帧。', [createDiagnostic({
      code: 'frame_not_found',
      sub_stage: 'frame_html',
      user_message: '未找到需要重试的 HTML 帧。',
      retryable: false,
    })]);
  }
  let nextProject = project;
  const executorOptions = objectOrEmpty(plan?.executor_options);
  const regenerateRequested = executorOptions.regenerate_frame_html === true
    || executorOptions.regenerateFrameHtml === true;
  const scopedFrameIds = arrayOrEmpty(executorOptions.frame_ids).filter(Boolean);
  if (regenerateRequested && scopedFrameIds.length) {
    // 定向失效目标帧的 frame_html/render checkpoint：后续 generateHtmlVideo 复用其余帧、
    // 只重生成这些帧，替代全局 regenerateFrameHtml 的全量重生成
    nextProject = await projectStore.writeProjectJson(projectDir, current => {
      for (const frameId of ids) {
        markCheckpointFrame(current, 'frame_html', frameId, {
          status: 'pending',
          html_path: '',
          input_hash: '',
          output_hash: '',
          diagnostic_code: '',
        });
        markCheckpointFrame(current, 'render', frameId, {
          status: 'pending',
          mp4_path: '',
          output_hash: '',
          diagnostic_code: '',
        });
      }
      return current;
    });
  }
  for (const frameId of ids) {
    const actionResult = await callConfiguredProjectAction({
      name: 'retryFrameHtml',
      workflow,
      project: nextProject,
      projectDir,
      plan,
      services,
      taskContext,
      rootDir,
      mediaRoot,
      extra: { frame_id: frameId, frameId },
    });
    if (!actionResult.success) return actionResult;
    nextProject = actionResult.project;
    if (hasCompletedRenderOutput(actionResult)) {
      return {
        ...actionResult,
        project: nextProject,
        project_dir: actionResult.project_dir || projectDir,
        html_video_project_path: actionResult.html_video_project_path || projectDir,
      };
    }
  }
  return renderComposeInspect({
    workflowId,
    rootDir,
    projectDir,
    project: nextProject,
    frameIds: ids,
    materialize: true,
    services,
    taskContext,
  });
}

async function retryContentGraph(context, actionName) {
  const actionResult = await callConfiguredProjectAction({
    name: actionName,
    workflow: context.workflow,
    project: context.project,
    projectDir: context.projectDir,
    plan: context.plan,
    services: context.services,
    taskContext: context.taskContext,
  });
  if (!actionResult.success) return actionResult;
  return renderComposeInspect({
    workflowId: context.workflowId,
    rootDir: context.rootDir,
    projectDir: context.projectDir,
    project: actionResult.project,
    frameIds: frameIds(actionResult.project),
    materialize: true,
    services: context.services,
    taskContext: context.taskContext,
  });
}

async function fallbackSceneSpecGraph(context) {
  const action = configuredAction(context.services, 'fallbackSceneSpecGraph');
  if (action) return retryContentGraph(context, 'fallbackSceneSpecGraph');
  const sceneSpec = context.project.scene_spec || context.workflow?.result?.hyperframes_freeform?.project?.scene_spec;
  if (!sceneSpec) {
    return actionFailure('缺少 scene_spec，无法用脚本结构恢复 content graph。', [createDiagnostic({
      code: 'scene_spec_missing',
      sub_stage: 'content_graph',
      user_message: '缺少 scene_spec，无法用脚本结构恢复 content graph。',
      retryable: false,
    })]);
  }
  const project = {
    ...context.project,
    content_graph: mapSceneSpecToContentGraph(sceneSpec),
  };
  const saved = await projectStore.saveProject(context.projectDir, project);
  return renderComposeInspect({
    workflowId: context.workflowId,
    rootDir: context.rootDir,
    projectDir: context.projectDir,
    project: saved,
    frameIds: frameIds(saved),
    materialize: true,
    services: context.services,
    taskContext: context.taskContext,
  });
}

async function repairTimeline(context) {
  const repaired = repairProjectTimeline({
    project: context.project,
    sceneSpec: context.project.scene_spec,
    targetDurationSec: targetDurationSec(context.project),
    audioManifest: context.project.audio,
  });
  if (!repaired.ok) return actionFailure(repaired.analysis?.message || '时间轴修复失败。', repaired.diagnostics);
  const saved = await projectStore.saveProject(context.projectDir, repaired.project);
  return renderComposeInspect({
    workflowId: context.workflowId,
    rootDir: context.rootDir,
    projectDir: context.projectDir,
    project: saved,
    frameIds: frameIds(saved),
    materialize: true,
    services: context.services,
    taskContext: context.taskContext,
  });
}

async function repairScriptAndTimeline(context) {
  const ttsService = context.services.ttsService;
  if (!ttsService || typeof ttsService.synthesizeSceneNarration !== 'function') {
    return actionFailure('旁白重生成服务未配置，无法修复脚本与时间轴。', [createDiagnostic({
      code: 'tts_service_not_configured',
      sub_stage: 'timeline_check',
      user_message: '旁白重生成服务未配置，无法修复脚本与时间轴。',
      retryable: false,
    })]);
  }
  const sceneSpec = compressNarrationForTarget(context.project.scene_spec, targetDurationSec(context.project));
  let project = {
    ...context.project,
    scene_spec: sceneSpec,
    audio: {},
    exports: [],
    render_outputs: [],
  };
  const tts = await ttsService.synthesizeSceneNarration({ projectDir: context.projectDir, sceneSpec });
  if (!tts.success) return tts;
  applyManifestToProjectAudio(project, sceneSpec, objectOrEmpty(tts.audio_manifest));
  const repaired = repairProjectTimeline({
    project,
    sceneSpec,
    targetDurationSec: targetDurationSec(project),
    audioManifest: project.audio,
  });
  if (!repaired.ok) return actionFailure(repaired.analysis?.message || '脚本与时间轴修复失败。', repaired.diagnostics);
  const saved = await projectStore.saveProject(context.projectDir, repaired.project);
  return renderComposeInspect({
    workflowId: context.workflowId,
    rootDir: context.rootDir,
    projectDir: context.projectDir,
    project: saved,
    frameIds: frameIds(saved),
    materialize: true,
    services: context.services,
    taskContext: context.taskContext,
  });
}

async function existingOutputPath(projectDir, project) {
  const candidates = [
    ...arrayOrEmpty(project.exports).slice().reverse().map(item => item?.absolute_path || item?.path),
    project.generation_checkpoint?.stages?.compose?.output_path,
  ].map(value => safeString(value)).filter(Boolean);
  for (const candidate of candidates) {
    const outputPath = path.isAbsolute(candidate) ? candidate : projectStore.resolveProjectPath(projectDir, candidate);
    try {
      const stat = await fs.stat(outputPath);
      if (stat.isFile()) return outputPath;
    } catch {
      // try next candidate
    }
  }
  return '';
}

async function rerunVisualInspect(context) {
  const outputPath = await existingOutputPath(context.projectDir, context.project);
  if (!outputPath) {
    return actionFailure('未找到可复用的成片文件，无法重新巡检。', [createDiagnostic({
      code: 'output_missing',
      sub_stage: 'visual_inspect',
      user_message: '未找到可复用的成片文件，无法重新巡检。',
      retryable: false,
    })]);
  }
  const inspected = await inspectVisual({
    projectDir: context.projectDir,
    project: context.project,
    outputPath,
    services: context.services,
    taskContext: context.taskContext,
  });
  const blockingFailure = visualInspectBlockingFailure(inspected, {
    projectDir: context.projectDir,
    outputPath,
  });
  if (blockingFailure) return blockingFailure;
  return {
    success: true,
    project: inspected.project,
    project_dir: context.projectDir,
    html_video_project_path: context.projectDir,
    output_path: outputPath,
    renderResult: { success: true, output_path: outputPath, project: inspected.project },
    visualInspectResult: inspected.visualInspectResult,
    diagnostics: [],
  };
}

async function restartProject(context) {
  const actionResult = await callConfiguredProjectAction({
    name: 'restartProject',
    workflow: context.workflow,
    project: context.project,
    projectDir: context.projectDir,
    plan: context.plan,
    services: context.services,
    taskContext: context.taskContext,
    extra: {
      projectLoadError: context.projectLoadError,
      project_load_error: context.projectLoadError,
    },
  });
  if (!actionResult.success) return actionResult;
  return renderComposeInspect({
    workflowId: context.workflowId,
    rootDir: context.rootDir,
    projectDir: context.projectDir,
    project: actionResult.project,
    frameIds: frameIds(actionResult.project),
    materialize: true,
    services: context.services,
    taskContext: context.taskContext,
  });
}

async function executeCreativeWorkflowRetryPlan({
  workflowId,
  workflow = null,
  projectDir = '',
  plan,
  rootDir,
  mediaRoot,
  services = {},
  taskContext,
} = {}) {
  if (!plan || plan.mode !== 'repair_and_resume') {
    return actionFailure('恢复计划无效：V1 只支持 repair_and_resume。', [createDiagnostic({
      code: 'retry_plan_invalid',
      user_message: '恢复计划无效：V1 只支持 repair_and_resume。',
      retryable: false,
    })]);
  }
  if (plan.can_retry !== true) {
    return actionFailure(plan.user_message || '当前失败不支持自动重试。', [createDiagnostic({
      code: plan.code || 'retry_not_allowed',
      user_message: plan.user_message || '当前失败不支持自动重试。',
      retryable: false,
    })]);
  }
  const resolvedProjectDir = safeString(projectDir);
  if (!resolvedProjectDir) {
    return actionFailure('未找到 html-video 工程目录，无法恢复。', [createDiagnostic({
      code: 'project_dir_missing',
      user_message: '未找到 html-video 工程目录，无法恢复。',
      retryable: false,
    })]);
  }
  let project = null;
  let projectLoadError = null;
  try {
    project = await projectStore.loadProject(resolvedProjectDir);
  } catch (error) {
    projectLoadError = error;
    if (plan.repair_action !== 'restart_project') throw error;
  }
  const context = {
    workflowId,
    workflow,
    project,
    projectLoadError,
    projectDir: resolvedProjectDir,
    plan,
    rootDir,
    services,
    taskContext,
  };
  switch (plan.repair_action) {
    case 'retry_content_graph':
      return retryContentGraph(context, 'retryContentGraph');
    case 'fallback_scene_spec_graph':
      return fallbackSceneSpecGraph(context);
    case 'retry_frame_html':
      return retryFrameHtml(context);
    case 'repair_timeline':
      return repairTimeline(context);
    case 'repair_script_and_timeline':
      return repairScriptAndTimeline(context);
    case 'rerender_frames':
      return renderComposeInspect({
        workflowId,
        rootDir,
        projectDir: resolvedProjectDir,
        project,
        frameIds: resolveProjectRetryFrameIds(project, planFrameIds(plan, project, 'render')),
        materialize: false,
        services,
        taskContext,
      });
    case 'recompose':
      return composeAndInspect({ workflowId, rootDir, projectDir: resolvedProjectDir, project, services, taskContext });
    case 'rerun_visual_inspect':
      return rerunVisualInspect(context);
    case 'restart_project':
      return restartProject(context);
    default:
      return actionFailure(`暂不支持恢复动作：${plan.repair_action || 'unknown'}。`, [createDiagnostic({
        code: 'retry_action_unsupported',
        sub_stage: plan.retry_from || '',
        user_message: `暂不支持恢复动作：${plan.repair_action || 'unknown'}。`,
        retryable: false,
      })]);
  }
}

module.exports = {
  executeCreativeWorkflowRetryPlan,
};
