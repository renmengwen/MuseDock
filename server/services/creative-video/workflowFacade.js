const aiTextModel = require('../ai/aiTextModel');
const creativeSpecAgent = require('./creativeSpecAgent');
const sceneSpecService = require('./sceneSpecService');
const defaultTtsService = require('./ttsService');
const defaultHtmlVideoWorkflow = require('./html-video/htmlVideoWorkflow');
const { failureFromDiagnostics } = require('./html-video/diagnostics');
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

function getServices(services = {}) {
  return {
    aiTextModel: services.aiTextModel || aiTextModel,
    ttsService: services.ttsService || defaultTtsService,
    htmlVideoWorkflow: services.htmlVideoWorkflow || defaultHtmlVideoWorkflow,
  };
}

function getSceneDurationsFromContext(creativeContext = {}) {
  const scenes = Array.isArray(creativeContext?.audio?.scenes)
    ? creativeContext.audio.scenes
    : [];
  return scenes.map((scene, index) => ({
    id: scene?.id || scene?.scene_id || `scene_${String(index + 1).padStart(2, '0')}`,
    index: Number(scene?.index || index + 1),
    duration: Number(scene?.speech_duration_sec ?? scene?.speechDurationSec ?? scene?.duration ?? scene?.duration_sec ?? scene?.durationSec ?? scene?.actual_duration_sec ?? scene?.actualDurationSec ?? 0),
  })).filter(scene => Number.isFinite(scene.duration) && scene.duration > 0);
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function titleCandidates(...values) {
  const items = values.flatMap(value => (Array.isArray(value) ? value : []))
    .map(value => firstText(value))
    .filter(Boolean);
  return Array.from(new Set(items)).slice(0, 4);
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
    const captions = Array.isArray(audioScene?.captions) && audioScene.captions.length
      ? audioScene.captions
      : (Array.isArray(scene?.captions) ? scene.captions : []);
    return {
      id,
      order,
      duration: firstPositiveNumber(
        audioScene?.speech_duration_sec,
        audioScene?.speechDurationSec,
        audioScene?.duration,
        audioScene?.duration_sec,
        audioScene?.durationSec,
        audioScene?.actual_duration_sec,
        audioScene?.actualDurationSec,
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
    title_candidates: titleCandidates(brief.title_candidates, brief.titleCandidates, brief.titles, target.title_candidates, target.titleCandidates),
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

  // Stage 1: Generate scene_spec (content layer).
  const sceneParsed = createSceneSpecFromVoicedStoryboard(creativeContext, target)
    || await requestSceneSpec({
      model: resolved.aiTextModel,
      creativeContext,
      target,
      sceneDurations: getSceneDurationsFromContext(creativeContext),
    });
  if (!sceneParsed.success) return failure(sceneParsed.message, { errors: sceneParsed.errors || [] });
  const sceneCreativeContext = sceneParsed.creative_context || creativeContext;

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
      },
      skipValidation,
      runLayoutQa: true,
      onProgress,
    });
  } catch (error) {
    const message = `html-video 成片失败：${error.message || '未知错误'}`;
    htmlVideoResult = failureFromDiagnostics(message, [{
      code: 'html_video_error',
      stage: 'workflow',
      user_message: message,
      details: {},
      fallback_allowed: true,
    }]);
  }

  if (htmlVideoResult && htmlVideoResult.success) {
    return {
      ...htmlVideoResult,
      render_mode: 'html-video',
      html_video_project_path: htmlVideoResult.html_video_project_path || htmlVideoResult.project_dir || null,
      html_video_diagnostics: htmlVideoResult.html_video_diagnostics || htmlVideoResult.diagnostics || [],
      scene_spec: htmlVideoResult.scene_spec || sceneParsed.scene_spec,
      frame_specs: htmlVideoResult.frame_specs || { frames: htmlVideoResult.project?.frames || [] },
    };
  }

  const diagnostics = htmlVideoResult?.html_video_diagnostics || htmlVideoResult?.diagnostics || [];
  const extra = {
    render_mode: 'html-video',
    html_video_project_path: htmlVideoResult?.html_video_project_path || htmlVideoResult?.project_dir || null,
  };
  if (typeof htmlVideoResult?.fallback_allowed === 'boolean') extra.fallback_allowed = htmlVideoResult.fallback_allowed;
  if (typeof htmlVideoResult?.retryable === 'boolean') extra.retryable = htmlVideoResult.retryable;
  return failureFromDiagnostics(
    htmlVideoResult?.user_message || htmlVideoResult?.message || 'html-video production path 失败。',
    diagnostics,
    extra,
  );
}

module.exports = {
  generateCreativeVideoProject,
  getSceneDurationsFromContext,
};
