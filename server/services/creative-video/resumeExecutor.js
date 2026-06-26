const fs = require('fs/promises');
const path = require('path');

const projectStore = require('./html-video/projectStore');
const projectOrchestrator = require('./html-video/projectOrchestrator');
const { createDiagnostic, normalizeDiagnostics, failureFromDiagnostics } = require('./html-video/diagnostics');
const { mapSceneSpecToContentGraph } = require('./html-video/sceneSpecMapper');
const { repairProjectTimeline, compressNarrationForTarget } = require('./html-video/timelineRepair');
const { computeSceneSpecSpeechHash } = require('./sceneSpecHash');
const defaultVisualQaService = require('./visualQaService');

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

function actionFailure(message, diagnostics = [], extra = {}) {
  return failureFromDiagnostics(message, normalizeDiagnostics(diagnostics), extra);
}

function configuredAction(services, name) {
  const actions = objectOrEmpty(services.resumeActions);
  return typeof actions[name] === 'function' ? actions[name] : null;
}

async function emit(taskContext, event) {
  if (typeof taskContext?.emit !== 'function') return;
  await taskContext.emit(event);
}

async function saveActionProject(projectDir, result, fallbackProject) {
  const project = result?.project || fallbackProject;
  return projectStore.saveProject(projectDir, project);
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
    expectedAspectRatio: expectedAspectRatio(project),
  });
  const reportPath = visualInspectResult.report_path || visualInspectResult.reportPath || 'inspect/visual-report.json';
  const nextProject = await projectStore.writeProjectJson(projectDir, current => {
    projectOrchestrator.markVisualInspectCheckpoint(current, {
      status: visualInspectResult.success === false ? 'warning' : 'done',
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

async function callConfiguredProjectAction({ name, workflow, project, projectDir, plan, services, taskContext, extra = {} }) {
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
  const { workflowId, rootDir, workflow, projectDir, plan, services, taskContext } = context;
  const project = context.project;
  const ids = planFrameIds(plan, project, 'frame_html');
  if (!ids.length) {
    return actionFailure('未找到需要重试的 HTML 帧。', [createDiagnostic({
      code: 'frame_not_found',
      sub_stage: 'frame_html',
      user_message: '未找到需要重试的 HTML 帧。',
      retryable: false,
    })]);
  }
  let nextProject = project;
  for (const frameId of ids) {
    const actionResult = await callConfiguredProjectAction({
      name: 'retryFrameHtml',
      workflow,
      project: nextProject,
      projectDir,
      plan,
      services,
      taskContext,
      extra: { frame_id: frameId, frameId },
    });
    if (!actionResult.success) return actionResult;
    nextProject = actionResult.project;
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
  const audioManifest = objectOrEmpty(tts.audio_manifest);
  const scenes = arrayOrEmpty(sceneSpec.scenes);
  project.audio = {
    source: 'scene_spec',
    scene_spec_hash: audioManifest.scene_spec_hash || computeSceneSpecSpeechHash(sceneSpec),
    scene_count: audioManifest.scene_count || scenes.length,
    scene_ids: audioManifest.scene_ids || scenes.map(scene => scene.id),
    status: audioManifest.status || 'ready',
    narration_path: audioManifest.combined_path || audioManifest.narration_path || audioManifest.narrationPath || null,
    tts_manifest_path: audioManifest.tts_manifest_path || audioManifest.ttsManifestPath || audioManifest.manifest_path || 'tts/audio_manifest.json',
  };
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
  void mediaRoot;
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
        frameIds: planFrameIds(plan, project, 'render'),
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
