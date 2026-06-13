const aiTextModel = require('../aiTextModel');
const quality = require('../hyperframesFreeformQuality');
const creativeSpecAgent = require('./creativeSpecAgent');
const hyperframesTemplateRenderer = require('./hyperframesTemplateRenderer');
const defaultProjectWriter = require('./projectWriter');
const defaultTtsService = require('./ttsService');
const { createRenderAdapter } = require('./renderAdapter');
const defaultVisualQaService = require('./visualQaService');

function failure(message, extra = {}) {
  return {
    success: false,
    message,
    ...extra,
  };
}

async function callTextModel(model, prompt) {
  const response = await model.callTextModel({
    messages: [{ role: 'user', content: prompt }],
  });
  if (!response || response.success === false) {
    return failure(response && response.message ? response.message : 'AI 规格生成失败。');
  }
  return { success: true, text: response.text || response.content || '' };
}

async function writeProject(writer, { rootDir, workflowId, runId, files }) {
  if (typeof writer === 'function') {
    return writer(files, { rootDir, workflowId, runId });
  }
  return writer.writeCreativeVideoProject({ rootDir, workflowId, runId, files });
}

async function checkProject(checker, projectDir) {
  if (typeof checker === 'function') {
    return checker({ projectDir });
  }
  return checker.checkFreeformProject({ projectDir });
}

function getServices(services = {}) {
  return {
    aiTextModel: services.aiTextModel || aiTextModel,
    projectWriter: services.projectWriter || defaultProjectWriter,
    checker: services.checker || quality,
    ttsService: services.ttsService || defaultTtsService,
    renderAdapter: services.renderAdapter || createRenderAdapter({ type: 'hyperframes' }),
    visualQaService: services.visualQaService || defaultVisualQaService,
  };
}

async function generateCreativeVideoProject({
  workflowId,
  runId,
  creativeContext = {},
  target = {},
  rootDir,
  services = {},
} = {}) {
  const resolved = getServices(services);

  const scenePrompt = creativeSpecAgent.buildSceneSpecPrompt({ creativeContext, target });
  const sceneAi = await callTextModel(resolved.aiTextModel, scenePrompt);
  if (!sceneAi.success) return sceneAi;
  const sceneParsed = creativeSpecAgent.parseSceneSpecResponse(sceneAi.text);
  if (!sceneParsed.success) return failure(sceneParsed.message, { errors: sceneParsed.errors || [] });

  const framePrompt = creativeSpecAgent.buildFrameSpecsPrompt({ sceneSpec: sceneParsed.scene_spec });
  const frameAi = await callTextModel(resolved.aiTextModel, framePrompt);
  if (!frameAi.success) return frameAi;
  const frameParsed = creativeSpecAgent.parseFrameSpecsResponse(frameAi.text, sceneParsed.scene_spec);
  if (!frameParsed.success) return failure(frameParsed.message, { errors: frameParsed.errors || [] });

  const renderedFiles = hyperframesTemplateRenderer.renderHyperframesProjectFiles({
    sceneSpec: sceneParsed.scene_spec,
    frameSpecs: frameParsed.frame_specs,
  });
  if (!renderedFiles.success) {
    return failure(renderedFiles.message || 'HyperFrames 工程文件生成失败。', {
      diagnostics: renderedFiles.diagnostics || [],
    });
  }

  const written = await writeProject(resolved.projectWriter, {
    rootDir,
    workflowId,
    runId,
    files: renderedFiles.files,
  });
  if (!written.success) {
    return failure(written.message || '工程写入失败。', {
      scene_spec: sceneParsed.scene_spec,
      frame_specs: frameParsed.frame_specs,
    });
  }

  const checked = await checkProject(resolved.checker, written.project_dir);
  if (!checked.success) {
    return failure(checked.message || '工程校验失败。', {
      scene_spec: sceneParsed.scene_spec,
      frame_specs: frameParsed.frame_specs,
      project_dir: written.project_dir,
      files: written.files || [],
      diagnostics: checked,
    });
  }

  const ttsResult = await resolved.ttsService.synthesizeSceneNarration({
    projectDir: written.project_dir,
    sceneSpec: sceneParsed.scene_spec,
  });
  if (!ttsResult.success) {
    return failure(ttsResult.message || '旁白音频生成失败。', {
      scene_spec: sceneParsed.scene_spec,
      frame_specs: frameParsed.frame_specs,
      project_dir: written.project_dir,
      files: written.files || [],
      audio_manifest: ttsResult.audio_manifest,
    });
  }

  const renderResult = await resolved.renderAdapter.render({
    project_dir: written.project_dir,
    duration: renderedFiles.scene_spec.target_duration_sec,
    audio_manifest: ttsResult.audio_manifest,
  });
  if (!renderResult.success) {
    return failure(renderResult.message || '视频渲染失败。', {
      scene_spec: sceneParsed.scene_spec,
      frame_specs: frameParsed.frame_specs,
      project_dir: written.project_dir,
      files: written.files || [],
      audio_manifest: ttsResult.audio_manifest,
      diagnostics: renderResult.diagnostics || [],
    });
  }

  const visualReport = await resolved.visualQaService.inspectRenderedVideo({
    projectDir: written.project_dir,
    outputPath: renderResult.output_path,
  });
  if (!visualReport.success) {
    return failure(visualReport.message || '视觉质检失败。', {
      scene_spec: sceneParsed.scene_spec,
      frame_specs: frameParsed.frame_specs,
      project_dir: written.project_dir,
      files: written.files || [],
      audio_manifest: ttsResult.audio_manifest,
      output_path: renderResult.output_path,
      visual_report: visualReport,
      issues: visualReport.issues || [],
      diagnostics: renderResult.diagnostics || [],
    });
  }

  return {
    success: true,
    message: '创意视频生成完成。',
    scene_spec: sceneParsed.scene_spec,
    frame_specs: frameParsed.frame_specs,
    project_dir: written.project_dir,
    files: written.files || [],
    audio_manifest: ttsResult.audio_manifest,
    output_path: renderResult.output_path,
    visual_report: visualReport,
    diagnostics: renderResult.diagnostics || [],
  };
}

async function rerenderCreativeVideoProject() {
  return failure('重新渲染接口尚未接入。');
}

async function applyCreativeVideoEdit() {
  return failure('编辑接口尚未接入。');
}

module.exports = {
  generateCreativeVideoProject,
  rerenderCreativeVideoProject,
  applyCreativeVideoEdit,
};
