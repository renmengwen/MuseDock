const aiTextModel = require('../aiTextModel');
const quality = require('../hyperframesFreeformQuality');
const creativeSpecAgent = require('./creativeSpecAgent');
const sceneSpecService = require('./sceneSpecService');
const templateSelectorAgent = require('./html-video/templateSelectorAgent');
const templateInputAgent = require('./html-video/templateInputAgent');
const hyperframesTemplateRenderer = require('./hyperframesTemplateRenderer');
const templateRegistry = require('./templateRegistry');
const defaultProjectWriter = require('./projectWriter');
const defaultTtsService = require('./ttsService');
const { createRenderAdapter } = require('./renderAdapter');
const defaultVisualQaService = require('./visualQaService');
const hyperframesRenderer = require('../hyperframesRenderer');
const defaultHtmlVideoWorkflow = require('./html-video/htmlVideoWorkflow');
const { computeSceneSpecSpeechHash } = require('./sceneSpecHash');

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
    htmlVideoWorkflow: services.htmlVideoWorkflow || defaultHtmlVideoWorkflow,
  };
}

function envFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return !/^(0|false|off|no)$/i.test(String(raw).trim());
}

function getSceneDurationsFromContext(creativeContext = {}) {
  const scenes = Array.isArray(creativeContext?.audio?.scenes)
    ? creativeContext.audio.scenes
    : [];
  return scenes.map((scene, index) => ({
    id: scene?.id || scene?.scene_id || `scene_${String(index + 1).padStart(2, '0')}`,
    index: Number(scene?.index || index + 1),
    duration: Number(scene?.duration ?? scene?.actual_duration_sec ?? scene?.duration_sec ?? 0),
  })).filter(scene => Number.isFinite(scene.duration) && scene.duration > 0);
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function hasReusableAudioForStoryboard(audio = {}) {
  const status = String(audio?.status || '').trim();
  const audioPath = firstText(audio?.path, audio?.narration_path, audio?.narrationPath, audio?.combined_path);
  return ['ready', 'done', 'rendered'].includes(status) && Boolean(audioPath);
}

function getStoryboardScenes(brief = {}) {
  const storyboard = brief?.storyboard;
  if (Array.isArray(storyboard?.scenes)) return storyboard.scenes;
  if (Array.isArray(storyboard)) return storyboard;
  return [];
}

function durationOverridesByScene(creativeContext = {}) {
  const byId = new Map();
  const byIndex = new Map();
  getSceneDurationsFromContext(creativeContext).forEach(item => {
    if (item.id) byId.set(item.id, item.duration);
    byIndex.set(item.index, item.duration);
  });
  return { byId, byIndex };
}

function getAudioScenes(audio = {}) {
  if (Array.isArray(audio?.scenes)) return audio.scenes;
  if (Array.isArray(audio?.segments)) return audio.segments;
  return [];
}

function audioScenesByScene(audio = {}) {
  const byId = new Map();
  const byIndex = new Map();
  getAudioScenes(audio).forEach((scene, index) => {
    const id = firstText(scene?.id, scene?.scene_id, scene?.sceneId);
    const order = firstPositiveNumber(scene?.order, scene?.index, index + 1);
    if (id) byId.set(id, scene);
    if (order) byIndex.set(order, scene);
  });
  return { byId, byIndex };
}

function enrichAudioForSceneSpec(audio = {}, sceneSpec = {}) {
  const scenes = Array.isArray(sceneSpec?.scenes) ? sceneSpec.scenes : [];
  return {
    ...audio,
    original_source: audio.source,
    source: 'scene_spec',
    scene_spec_hash: computeSceneSpecSpeechHash(sceneSpec),
    scene_count: scenes.length,
    scene_ids: scenes.map(scene => scene.id),
    status: firstText(audio.status, 'ready'),
  };
}

function createSceneSpecFromVoicedStoryboard(creativeContext = {}, target = {}) {
  const brief = creativeContext?.brief || {};
  const audio = creativeContext?.audio || {};
  const storyboardScenes = getStoryboardScenes(brief);
  if (!storyboardScenes.length || !hasReusableAudioForStoryboard(audio)) return null;

  const durations = durationOverridesByScene(creativeContext);
  const audioSceneLookup = audioScenesByScene(audio);
  const scenes = storyboardScenes.map((scene, index) => {
    const id = firstText(scene?.id, scene?.scene_id, scene?.sceneId, `scene_${String(index + 1).padStart(2, '0')}`);
    const order = firstPositiveNumber(scene?.order, scene?.index, index + 1);
    const audioScene = audioSceneLookup.byId.get(id) || audioSceneLookup.byIndex.get(order) || {};
    const visualText = scene?.visual_text && typeof scene.visual_text === 'object' && !Array.isArray(scene.visual_text)
      ? scene.visual_text
      : {};
    const captions = Array.isArray(scene?.captions) && scene.captions.length
      ? scene.captions
      : (Array.isArray(audioScene?.captions) ? audioScene.captions : []);
    return {
      id,
      order,
      duration: firstPositiveNumber(
        audioScene?.actual_duration_sec,
        audioScene?.actualDurationSec,
        audioScene?.duration,
        audioScene?.duration_sec,
        audioScene?.durationSec,
        scene?.duration,
        scene?.duration_sec,
        scene?.durationSec,
        scene?.actual_duration_sec,
        scene?.actualDurationSec,
        durations.byId.get(id),
        durations.byIndex.get(order),
      ),
      kind: scene?.kind || 'text',
      narration_text: firstText(scene?.narration_text, scene?.narrationText, scene?.narration, scene?.voiceover, scene?.script, audioScene?.narration_text, audioScene?.narrationText),
      captions,
      visual_text: {
        headline: firstText(visualText.headline, scene?.headline, scene?.title),
        keywords: Array.isArray(visualText.keywords)
          ? visualText.keywords
          : (Array.isArray(scene?.keywords) ? scene.keywords : []),
        cards: Array.isArray(visualText.cards)
          ? visualText.cards
          : (Array.isArray(scene?.cards) ? scene.cards : []),
      },
    };
  });
  const validation = sceneSpecService.validateSceneSpec({
    version: 1,
    title: firstText(brief.title, brief.summary, target.title, creativeContext?.input?.title, creativeContext?.input?.raw_text, '创意视频'),
    aspect_ratio: firstText(target.aspect_ratio, target.aspectRatio, brief.aspect_ratio, brief.aspectRatio, '9:16'),
    target_duration_sec: firstPositiveNumber(
      target.duration_sec,
      target.durationSec,
      target.duration,
      brief.target_duration_sec,
      brief.targetDurationSec,
      scenes.reduce((total, scene) => total + (Number(scene.duration) || 0), 0),
    ),
    scenes,
  });

  if (!validation.success) return null;

  return {
    success: true,
    scene_spec: validation.scene_spec,
    creative_context: {
      ...creativeContext,
      audio: enrichAudioForSceneSpec(audio, validation.scene_spec),
    },
  };
}

async function requestSceneSpec({ model, creativeContext, target, sceneDurations, maxAttempts = 2 }) {
  let previousErrors = [];
  let lastParsed = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt = creativeSpecAgent.buildSceneSpecPrompt({
      creativeContext,
      target,
      retryCount: attempt,
      previousErrors,
    });
    const sceneAi = await callTextModel(model, prompt);
    if (!sceneAi.success) return sceneAi;
    lastParsed = creativeSpecAgent.parseSceneSpecResponse(sceneAi.text, { sceneDurations });
    if (lastParsed.success) return lastParsed;
    previousErrors = lastParsed.errors && lastParsed.errors.length
      ? lastParsed.errors
      : [lastParsed.message || 'AI 返回不是有效 JSON'];
  }
  return lastParsed || failure('scene_spec 生成失败。');
}

async function requestFrameSpecs({ model, sceneSpec, maxAttempts = 2 }) {
  let previousErrors = [];
  let lastParsed = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt = creativeSpecAgent.buildFrameSpecsPrompt({
      sceneSpec,
      retryCount: attempt,
      previousErrors,
    });
    const frameAi = await callTextModel(model, prompt);
    if (!frameAi.success) return frameAi;
    lastParsed = creativeSpecAgent.parseFrameSpecsResponse(frameAi.text, sceneSpec);
    if (lastParsed.success) return lastParsed;
    previousErrors = lastParsed.errors && lastParsed.errors.length
      ? lastParsed.errors
      : [lastParsed.message || 'AI 返回不是有效 JSON'];
  }
  return lastParsed || failure('frame_specs 生成失败。');
}

// ---------------------------------------------------------------------------
// Rich template path (new high-quality rendering)
// ---------------------------------------------------------------------------

async function requestTemplateSelection({ model, sceneSpec, target, maxAttempts = 2 }) {
  const compactIndex = templateRegistry.buildCompactIndex();
  if (!compactIndex.length) {
    return failure('没有可用的 rich 模板。');
  }

  let lastParsed = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt = templateSelectorAgent.buildTemplateSelectionPrompt({
      sceneSpec,
      compactIndex,
      target,
    });
    const ai = await callTextModel(model, prompt);
    if (!ai.success) return ai;

    lastParsed = templateSelectorAgent.parseTemplateSelectionResponse(ai.text, { compactIndex });
    if (lastParsed.success) return lastParsed;
  }
  return lastParsed || failure('模板选择失败。');
}

async function requestTemplateInputs({ model, sceneSpec, template, creativeContext, maxAttempts = 2 }) {
  let lastParsed = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt = templateInputAgent.buildTemplateInputPrompt({
      sceneSpec,
      template,
      creativeContext,
    });
    const ai = await callTextModel(model, prompt);
    if (!ai.success) return ai;

    lastParsed = templateInputAgent.parseTemplateInputResponse(ai.text, { template });
    if (lastParsed.success) return lastParsed;
  }
  return lastParsed || failure('模板字段填写失败。', {
    user_message: '模板字段填写失败。',
    fallback_allowed: true,
  });
}

// Legacy fallback only: kept for manual rollback/debug paths. The default
// production path must not ask AI to generate complete HTML.
async function requestHtmlFill({ model, sceneSpec, frameSpecs, templateId, maxAttempts = 2 }) {
  const templateHtml = templateRegistry.getTemplateHtml(templateId, 4000);
  const templateManifest = templateRegistry.getTemplateManifest(templateId);

  let lastParsed = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt = creativeSpecAgent.buildFillTemplatePrompt({
      sceneSpec,
      frameSpecs,
      templateHtml,
      templateManifest,
    });
    const ai = await callTextModel(model, prompt);
    if (!ai.success) return ai;

    lastParsed = creativeSpecAgent.parseFillTemplateResponse(ai.text);
    if (lastParsed.success) return lastParsed;
  }
  return lastParsed || failure('HTML 填充失败。');
}

/**
 * Try the rich template path: AI selects template → AI fills JSON inputs → local HTML assembly.
 * Returns { success, ... } on success, or { success: false, ... } to trigger fallback.
 */
async function tryRichTemplate({ model, sceneSpec, frameSpecs, creativeContext, target }) {
  // Step 1: AI selects template
  const selection = await requestTemplateSelection({ model, sceneSpec, target });
  if (!selection.success) {
    return failure(`Rich 模板选择失败（将回退到旧模板）：${selection.message}`, {
      user_message: selection.user_message || selection.message || '模板选择失败。',
      fallback_allowed: selection.fallback_allowed !== false,
      diagnostics: selection.diagnostics || [],
    });
  }

  const templateId = selection.template_id;
  const templateManifest = templateRegistry.getTemplateManifest(templateId);
  const templateHtml = templateRegistry.getTemplateHtml(templateId, 120000);

  // Step 2: AI fills JSON inputs only. HTML is rendered locally.
  const inputResult = await requestTemplateInputs({
    model,
    sceneSpec,
    template: templateManifest,
    creativeContext,
  });
  if (!inputResult.success) {
    return failure(`Rich 模板字段填写失败（将回退到旧模板）：${inputResult.message}`, {
      user_message: inputResult.user_message || inputResult.message || '模板字段填写失败。',
      fallback_allowed: inputResult.fallback_allowed !== false,
      diagnostics: inputResult.diagnostics || [],
    });
  }

  const filledHtml = hyperframesTemplateRenderer.renderTemplateHtmlWithInputs({
    templateHtml,
    inputs: inputResult.inputs,
    sceneSpec,
    templateId,
  });

  // Step 3: Assemble project files
  const assembled = hyperframesTemplateRenderer.assembleProjectFiles({
    sceneSpec,
    frameSpecs,
    aiGeneratedHtml: filledHtml,
    templateId,
  });

  if (!assembled.success) {
    return failure(`Rich 项目组装失败（将回退到旧模板）：${assembled.message}`, {
      user_message: `项目组装失败：${assembled.message || '未知错误'}`,
      fallback_allowed: true,
      diagnostics: assembled.diagnostics || [assembled.message || '项目组装失败'],
    });
  }

  return {
    success: true,
    template_id: templateId,
    template_reason: selection.reason,
    template_inputs: inputResult.inputs,
    scene_spec: assembled.scene_spec,
    frame_specs: assembled.frame_specs,
    target_duration_sec: assembled.target_duration_sec,
    files: assembled.files,
  };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

async function generateCreativeVideoProject({
  workflowId,
  runId,
  creativeContext = {},
  target = {},
  rootDir,
  services = {},
  skipValidation = false,
  onProgress = null,
} = {}) {
  const resolved = getServices(services);
  let htmlVideoDiagnostics = [];
  let htmlVideoProjectPath = null;
  let legacyFallbackReason = null;

  // Stage 1: Generate scene_spec (content layer). html-video and legacy share this IR.
  const sceneParsed = createSceneSpecFromVoicedStoryboard(creativeContext, target)
    || await requestSceneSpec({
      model: resolved.aiTextModel,
      creativeContext,
      target,
      sceneDurations: getSceneDurationsFromContext(creativeContext),
    });
  if (!sceneParsed.success) return failure(sceneParsed.message, { errors: sceneParsed.errors || [] });
  const sceneCreativeContext = sceneParsed.creative_context || creativeContext;

  const htmlVideoEnabled = target.useHtmlVideoProduction !== false
    && target.use_html_video_production !== false
    && services.useHtmlVideoProduction !== false
    && envFlag('HTML_VIDEO_PRODUCTION_ENABLED', true);
  const legacyFallbackEnabled = target.fallbackLegacy !== false
    && target.fallback_legacy !== false
    && services.fallbackLegacy !== false
    && envFlag('HTML_VIDEO_LEGACY_FALLBACK_ENABLED', false);

  if (htmlVideoEnabled) {
    let htmlVideoResult;
    try {
      htmlVideoResult = await resolved.htmlVideoWorkflow.generateHtmlVideo({
        workflowId,
        runId,
        sceneSpec: sceneParsed.scene_spec,
        creativeContext: sceneCreativeContext,
        target,
        preferredTemplateId: target.preferredTemplateId || '',
        lockTemplate: target.lockTemplate === true,
        rootDir,
        services: {
          ...services,
          aiTextModel: resolved.aiTextModel,
          ttsService: resolved.ttsService,
          visualQaService: resolved.visualQaService,
        },
        skipValidation,
        onProgress,
      });
    } catch (error) {
      htmlVideoResult = failure(`html-video 成片失败：${error.message || '未知错误'}`, {
        fallback_allowed: true,
        html_video_diagnostics: [{
          code: 'html_video_error',
          stage: 'workflow',
          user_message: `html-video 成片失败：${error.message || '未知错误'}`,
          details: {},
          fallback_allowed: true,
        }],
      });
    }

    if (htmlVideoResult && htmlVideoResult.success) {
      return {
        ...htmlVideoResult,
        render_mode: 'html-video',
        html_video_project_path: htmlVideoResult.html_video_project_path || htmlVideoResult.project_dir || null,
        html_video_diagnostics: htmlVideoResult.html_video_diagnostics || htmlVideoResult.diagnostics || [],
        legacy_fallback_reason: null,
        scene_spec: htmlVideoResult.scene_spec || sceneParsed.scene_spec,
        frame_specs: htmlVideoResult.frame_specs || { frames: htmlVideoResult.project?.frames || [] },
      };
    }

    htmlVideoDiagnostics = htmlVideoResult?.html_video_diagnostics || htmlVideoResult?.diagnostics || [];
    htmlVideoProjectPath = htmlVideoResult?.html_video_project_path || htmlVideoResult?.project_dir || null;
    legacyFallbackReason = htmlVideoResult?.user_message || htmlVideoResult?.message || 'html-video production path 失败。';
    if (!legacyFallbackEnabled || htmlVideoResult?.fallback_allowed === false) {
      return failure(legacyFallbackReason, {
        render_mode: 'html-video',
        html_video_project_path: htmlVideoProjectPath,
        html_video_diagnostics: htmlVideoDiagnostics,
        legacy_fallback_reason: legacyFallbackReason,
      });
    }
    htmlVideoDiagnostics.push({
      code: 'legacy_fallback_used',
      stage: 'workflow',
      user_message: 'html-video 生成失败，已按配置回退到 Legacy 模式。',
      details: { reason: legacyFallbackReason },
      fallback_allowed: true,
    });
  }

  // Stage 2: Try rich template path first
  let renderedFiles = null;
  let renderMode = 'legacy';
  let richTemplateDiagnostics = null;

  const hasRichTemplates = templateRegistry.getRichTemplateIds().length > 0;
  if (hasRichTemplates) {
    const richResult = await tryRichTemplate({
      model: resolved.aiTextModel,
      sceneSpec: sceneParsed.scene_spec,
      frameSpecs: null, // Rich path generates its own frame_specs if needed
      creativeContext: sceneCreativeContext,
      target,
    });

    if (richResult.success) {
      renderedFiles = richResult;
      renderMode = 'rich';
    } else {
      richTemplateDiagnostics = richResult.message || 'Rich template path failed';
      console.warn(`[workflowFacade] Rich template fallback: ${richTemplateDiagnostics}`);
    }
  }

  // Stage 3: Fallback to legacy path if rich path didn't work
  if (!renderedFiles) {
    const frameParsed = await requestFrameSpecs({
      model: resolved.aiTextModel,
      sceneSpec: sceneParsed.scene_spec,
    });
    if (!frameParsed.success) return failure(frameParsed.message, { errors: frameParsed.errors || [] });

    renderedFiles = hyperframesTemplateRenderer.renderHyperframesProjectFiles({
      sceneSpec: sceneParsed.scene_spec,
      frameSpecs: frameParsed.frame_specs,
    });
    if (!renderedFiles.success) {
      return failure(renderedFiles.message || 'HyperFrames 工程文件生成失败。', {
        diagnostics: renderedFiles.diagnostics || [],
      });
    }
  }

  // Stage 4: Write project files
  const written = await writeProject(resolved.projectWriter, {
    rootDir,
    workflowId,
    runId,
    files: renderedFiles.files,
  });
  if (!written.success) {
    return failure(written.message || '工程写入失败。', {
      scene_spec: renderedFiles.scene_spec,
      frame_specs: renderedFiles.frame_specs,
    });
  }

  // Stage 5: Validate project
  if (!skipValidation) {
    const checked = await checkProject(resolved.checker, written.project_dir);
    if (!checked.success) {
      return failure(checked.message || '工程校验失败。', {
        scene_spec: renderedFiles.scene_spec,
        frame_specs: renderedFiles.frame_specs,
        project_dir: written.project_dir,
        files: written.files || [],
        diagnostics: checked,
      });
    }
  }

  // Stage 6: TTS synthesis
  const ttsResult = await resolved.ttsService.synthesizeSceneNarration({
    projectDir: written.project_dir,
    sceneSpec: renderedFiles.scene_spec,
  });
  if (!ttsResult.success) {
    return failure(ttsResult.message || '旁白音频生成失败。', {
      scene_spec: renderedFiles.scene_spec,
      frame_specs: renderedFiles.frame_specs,
      project_dir: written.project_dir,
      files: written.files || [],
      audio_manifest: ttsResult.audio_manifest,
    });
  }

  // Stage 7: Render video
  const renderResult = await resolved.renderAdapter.render({
    project_dir: written.project_dir,
    duration: renderedFiles.target_duration_sec || renderedFiles.scene_spec?.target_duration_sec,
    audio_manifest: ttsResult.audio_manifest,
  });
  if (!renderResult.success) {
    return failure(renderResult.message || '视频渲染失败。', {
      scene_spec: renderedFiles.scene_spec,
      frame_specs: renderedFiles.frame_specs,
      project_dir: written.project_dir,
      files: written.files || [],
      audio_manifest: ttsResult.audio_manifest,
      diagnostics: renderResult.diagnostics || [],
    });
  }

  // Stage 8: Mux audio
  const muxResult = await hyperframesRenderer.concatAndMuxAudio({
    projectDir: written.project_dir,
    videoPath: renderResult.output_path,
    audioManifest: ttsResult.audio_manifest,
  });
  if (!muxResult.success) {
    return failure(muxResult.message || '音频混流失败。', {
      scene_spec: renderedFiles.scene_spec,
      frame_specs: renderedFiles.frame_specs,
      project_dir: written.project_dir,
      output_path: renderResult.output_path,
    });
  }

  // Stage 9: Visual QA
  let visualReport = { success: true, issues: [] };
  if (!skipValidation) {
    visualReport = await resolved.visualQaService.inspectRenderedVideo({
      projectDir: written.project_dir,
      outputPath: renderResult.output_path,
    });
  }

  return {
    success: true,
    message: legacyFallbackReason
      ? 'html-video 生成失败，已按配置回退到 Legacy 模式。'
      : `创意视频生成完成。（${renderMode === 'rich' ? 'Rich Template' : 'Legacy'} 模式）`,
    render_mode: legacyFallbackReason ? 'legacy' : renderMode,
    template_id: renderedFiles.template_id || null,
    rich_template_diagnostics: richTemplateDiagnostics,
    html_video_project_path: htmlVideoProjectPath,
    html_video_diagnostics: htmlVideoDiagnostics,
    legacy_fallback_reason: legacyFallbackReason,
    scene_spec: renderedFiles.scene_spec,
    frame_specs: renderedFiles.frame_specs,
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
  getSceneDurationsFromContext,
  // Export for testing
  tryRichTemplate,
  requestTemplateSelection,
  requestTemplateInputs,
  requestHtmlFill,
};
