const fs = require('fs');
const path = require('path');

const aiTextModel = require('../../ai/aiTextModel');
const { isGeneratedVisualAsset } = require('../../creative/visualAssetContract');
const frameHtmlAgent = require('./frameHtmlAgent');
const { runFrameHtmlPhase } = require('./frameHtmlPhase');
const { buildMixedFrameProject } = require('./mixedFrameBuilder');
const { buildVisualPlan, assignMotionOrchestration } = require('./visualPlanService');
const { matchVisualBeatsToRenderers } = require('./visualRouteMatcher');
const {
  runGeneratedImagePhase,
  hydrateGeneratedAssetsFromProject,
} = require('./generatedImagePhase');
const environmentDoctor = require('./environmentDoctor');
const projectStore = require('./projectStore');
const {
  markCheckpointStage,
  markCheckpointFrame,
  appendCheckpointModelCall,
} = require('./projectSchema');
const { validateHtmlVideoProject } = require('./validationGate');
const projectOrchestrator = require('./projectOrchestrator');
const editPatchService = require('./editPatchService');
const { syncRawHtmlFrameTextPatch } = require('./rawHtmlTextPatch');
const defaultVisualQaService = require('../visualQaService');
const defaultLayoutQaService = require('./layoutQaService');
const { audioMatchesSceneSpec } = require('../sceneSpecHash');
const { applyManifestToProjectAudio } = require('../ttsService');
const { createDiagnostic, normalizeDiagnostics, failureFromDiagnostics } = require('./diagnostics');
const { resolveNodeSceneId, validateGraphMatchesSceneSpec } = require('./sceneGraphBinding');
const sfxLibrary = require('./sfxLibrary');
const sfxPlannerAgent = require('./sfxPlannerAgent');
const sfxEventService = require('./sfxEventService');
const { AGENTS, STAGES } = require('../agentStages');
const {
  callTextModel,
  report,
  sha256,
  hasUsableContentGraph,
  contentGraphMatchesSceneSpec,
  loadCheckpointContentGraph,
  CONTENT_GRAPH_SCENE_SPEC_MISMATCH_MESSAGE,
  contentGraphSceneSpecMismatchDiagnostic,
  generateContentGraphWithRetry,
  expandContentGraphToVisualBeats,
  expandContentGraphToSceneEntries,
} = require('./contentGraphPhase');
const {
  objectOrEmpty,
  firstNonEmptyString,
  bindGeneratedAssetsToSceneSpec,
  materializeCreativeContextAssets,
  projectAssetsFromCreativeContext,
  buildAssetUsageReport,
  attachAssetUsageReport,
  missingRequiredAssetIds,
} = require('./assetUsagePhase');

function resolveExistingNarrationAudio(creativeContext = {}, sceneSpec = null) {
  const audio = objectOrEmpty(creativeContext.audio);
  const audioPath = firstNonEmptyString(audio.path, audio.narration_path, audio.narrationPath, audio.combined_path);
  if (!audioPath || !sceneSpec) {
    return { reusable: false, audio, path: null, reason: 'missing_path_or_scene_spec' };
  }
  if (!audioMatchesSceneSpec({ ...audio, path: audioPath }, sceneSpec)) {
    return { reusable: false, audio, path: audioPath, reason: 'scene_spec_mismatch' };
  }
  return { reusable: true, audio, path: audioPath, reason: 'matched' };
}

function audioWithResolvedPath(audio = {}) {
  const safeAudio = objectOrEmpty(audio);
  const pathValue = firstNonEmptyString(
    safeAudio.path,
    safeAudio.narration_path,
    safeAudio.narrationPath,
    safeAudio.combined_path,
  );
  return pathValue ? { ...safeAudio, path: pathValue } : safeAudio;
}

function mergeResumeAudioIntoCreativeContext(creativeContext = {}, project = {}, resumeProject = null, sceneSpec = null) {
  const current = objectOrEmpty(creativeContext);
  const candidates = [
    audioWithResolvedPath(current.audio),
    audioWithResolvedPath(project.audio),
    audioWithResolvedPath(resumeProject?.audio),
  ];
  const matched = candidates.find(audio => audioMatchesSceneSpec(audio, sceneSpec || {}));
  if (!matched) return current;
  if (matched === candidates[0]) return current;
  return { ...current, audio: matched };
}

function failure(message, diagnostics, extra = {}) {
  return failureFromDiagnostics(message, diagnostics, {
    render_mode: 'html-video',
    ...extra,
  });
}

function parseJsonOnlyResponse(text) {
  const fail = (userMessage, diagnostics = []) => ({
    success: false,
    user_message: userMessage,
    message: userMessage,
    fallback_allowed: true,
    diagnostics: diagnostics.length ? diagnostics : [userMessage],
  });
  const raw = String(text || '').trim();
  if (!raw) {
    return fail('AI 返回为空，无法解析 JSON。', ['empty_response']);
  }
  if (/<\s*html\b|<!doctype\b|<\s*script\b/i.test(raw)) {
    return fail('AI 返回包含 HTML、DOCTYPE 或 script，模板字段必须只返回 JSON。', ['response_contains_html']);
  }
  if (/^```/m.test(raw) || /```/.test(raw)) {
    return fail('AI 返回必须是纯 JSON，不能包含 Markdown 代码块。', ['response_contains_markdown']);
  }
  if (!raw.startsWith('{') || !raw.endsWith('}')) {
    return fail('AI 返回必须是一个 JSON object，不能包含解释、Markdown 或其他文本。', ['response_is_not_json_object']);
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return fail('AI 返回必须是一个 JSON object。', ['parsed_value_is_not_object']);
    }
    return { success: true, data };
  } catch (error) {
    return fail(`AI 返回不是有效 JSON：${error.message}`, [error.message]);
  }
}

function stableSceneSpecValue(value) {
  if (Array.isArray(value)) return value.map(stableSceneSpecValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableSceneSpecValue(value[key])]),
  );
}

function computeSceneSpecCheckpointHash(sceneSpec = {}) {
  return sha256(JSON.stringify(stableSceneSpecValue(sceneSpec || {})));
}

function rawHtmlBuildFrameIdFromError(error) {
  const message = String(error?.message || '');
  return message.match(/缺少帧\s+([^\s]+)\s+的 raw HTML 路径/)?.[1]
    || message.match(/内容图节点\s+([^\s]+)\s+未匹配到 scene_spec/)?.[1]
    || '';
}

function getModel(services = {}) {
  return services.aiTextModel || aiTextModel;
}

function responseModelInfo(response = {}) {
  const model = objectOrEmpty(response.model);
  return {
    provider: firstNonEmptyString(model.provider, response.provider),
    model_id: firstNonEmptyString(model.model_id, model.id, response.model_id, response.modelId),
  };
}

function createAuditedModel(model, projectDir) {
  if (!model || typeof model.callTextModel !== 'function' || !projectDir) return model;
  let auditWriteQueue = Promise.resolve();
  return {
    ...model,
    callTextModel: async request => {
      const audit = objectOrEmpty(request?.audit);
      const { audit: _audit, ...forwardRequest } = objectOrEmpty(request);
      if (audit.agent && audit.stage) {
        Object.defineProperty(forwardRequest, 'audit', {
          value: audit,
          enumerable: false,
        });
      }
      const startedAt = Date.now();
      let response;
      let thrownError = null;
      try {
        response = await model.callTextModel(forwardRequest);
        return response;
      } catch (error) {
        thrownError = error;
        throw error;
      } finally {
        if (audit.agent && audit.stage) {
          auditWriteQueue = auditWriteQueue.catch(() => {}).then(async () => {
            await projectStore.writeProjectJson(projectDir, project => appendCheckpointModelCall(project, {
              ...audit,
              model: responseModelInfo(response),
              usage: objectOrEmpty(response?.usage),
              duration_ms: Date.now() - startedAt,
              success: !thrownError && response?.success !== false,
              error: thrownError ? firstNonEmptyString(thrownError.message) : (response?.success === false ? firstNonEmptyString(response?.message, response?.error) : ''),
            }));
          });
          await auditWriteQueue.catch(() => {});
        }
      }
    },
  };
}

const SAFE_PROJECT_ID = /^[A-Za-z0-9_.-]+$/;

function existingProjectDir(rootDir, workflowId, runId) {
  const safeWorkflowId = String(workflowId || '').trim();
  const safeRunId = String(runId || '').trim();
  if (!rootDir || !SAFE_PROJECT_ID.test(safeWorkflowId) || !SAFE_PROJECT_ID.test(safeRunId)) return '';
  return path.resolve(rootDir, safeWorkflowId, 'agent_runs', `${safeRunId}-html-video`);
}

async function loadExistingProject(projectDir) {
  if (!projectDir) return null;
  try {
    return await projectStore.loadProject(projectDir);
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
    return null;
  }
}

function stripIgnoredHtmlRegions(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '');
}

function htmlHasTextKey(html, key) {
  const tags = stripIgnoredHtmlRegions(html).match(/<[A-Za-z][^>]*>/g) || [];
  const pattern = new RegExp(`\\bdata-text-key\\s*=\\s*(['"])${key}\\1`, 'i');
  return tags.some(tag => pattern.test(tag));
}

function attachContinuityMode(project, creativeContext) {
  if (!project) return project;
  project.continuity_mode = creativeContext?.continuity_mode || project.continuity_mode || 'beat_mp4';
  return project;
}

// 旧链路（hf_first/模板/整片模式）产物标记：命中任一即不再支持续跑，只能查看。
// 注意：normalizeProject 已把这些旧字段裁出白名单，判定必须基于原始 project.json（见调用处）。
function detectLegacyPipelineMarkers(rawProject = {}) {
  const project = rawProject && typeof rawProject === 'object' ? rawProject : {};
  if (String(project.template_id || '').trim()) return { legacy: true, marker: 'template_id' };
  const strategy = String(project.visual_strategy || '').trim();
  if (strategy && strategy !== 'asset_first') return { legacy: true, marker: 'visual_strategy' };
  const frames = Array.isArray(project.frames) ? project.frames : [];
  if (frames.some(frame => frame && frame.source_mode === 'template_inputs')) {
    return { legacy: true, marker: 'template_frames' };
  }
  return { legacy: false, marker: '' };
}

// 复用判定只看 scene_spec_hash；legacy 工程一律不复用
function resumeArtifactsMatch(project = {}, sceneSpec = null) {
  if (detectLegacyPipelineMarkers(project).legacy) return false;
  const currentHash = computeSceneSpecCheckpointHash(sceneSpec || {});
  const checkpointHash = String(project.generation_checkpoint?.scene_spec_hash || '').trim();
  return Boolean(checkpointHash && currentHash && checkpointHash === currentHash);
}

function shouldReuseFrameHtml({ projectDir, checkpointFrame, scene, node, target, resumeAllowed = true, inputFingerprint = '' } = {}) {
  if (!resumeAllowed) return { reuse: false };
  const frame = objectOrEmpty(checkpointFrame);
  if (frame.status !== 'done' || !frame.html_path) return { reuse: false };
  // P1-2：真实输入指纹判定——checkpoint 无指纹（旧链路产物）一律不复用；
  // 有指纹但与当前输入指纹不一致（beat/素材/主题/画幅/prompt 版本任一变化）时不复用。
  const checkpointFingerprint = String(frame.input_fingerprint || '').trim();
  const currentFingerprint = String(inputFingerprint || '').trim();
  if (!checkpointFingerprint) return { reuse: false };
  if (currentFingerprint && checkpointFingerprint !== currentFingerprint) return { reuse: false };
  let html;
  try {
    const absolutePath = projectStore.resolveProjectPath(projectDir, frame.html_path);
    if (!fs.existsSync(absolutePath)) return { reuse: false };
    html = fs.readFileSync(absolutePath, 'utf8');
  } catch {
    return { reuse: false };
  }
  const extracted = frameHtmlAgent.extractHtmlDocument(html);
  if (!extracted.success) return { reuse: false };
  const validation = frameHtmlAgent.validateHtmlTargetResolution(extracted.html, target || {});
  if (!validation.success) return { reuse: false };
  for (const key of ['headline', 'subtitle', 'body']) {
    if (!htmlHasTextKey(extracted.html, key)) {
      return { reuse: false };
    }
  }
  return {
    reuse: true,
    html,
    html_path: frame.html_path,
    scene_id: scene?.id || resolveNodeSceneId(node) || node?.id || '',
  };
}

function invalidateFrameHtmlDependents(project, sceneId) {
  if (!project) return project;
  // beat 展开后同一场景可能对应多个帧（渲染检查点按帧键控），场景 HTML 变更需要一并失效
  const dependentFrameIds = new Set([sceneId]);
  for (const frame of Array.isArray(project.frames) ? project.frames : []) {
    if (!frame) continue;
    if (frame.scene_id === sceneId || frame.id === sceneId) {
      dependentFrameIds.add(String(frame.id || sceneId));
    }
  }
  for (const frameId of dependentFrameIds) {
    markCheckpointFrame(project, 'render', frameId, {
      status: 'pending',
      mp4_path: '',
      output_hash: '',
      diagnostic_code: '',
    });
  }
  markCheckpointStage(project, 'compose', {
    status: 'pending',
    output_path: '',
    output_audio_path: '',
    diagnostic_code: '',
  });
  markCheckpointStage(project, 'duration_verify', {
    status: 'pending',
    expected_duration_sec: undefined,
    actual_duration_sec: undefined,
    diagnostic_code: '',
  });
  markCheckpointStage(project, 'visual_inspect', {
    status: 'pending',
    report_path: null,
    diagnostic_code: '',
  });
  project.exports = [];
  project.render_outputs = [];
  project.status = 'draft';
  return project;
}

function invalidateFrameHtmlResumeState(project) {
  if (!project) return project;
  markCheckpointStage(project, 'frame_html', { status: 'pending' });
  if (project.generation_checkpoint?.stages?.frame_html) {
    project.generation_checkpoint.stages.frame_html.frames = {};
  }
  if (project.generation_checkpoint?.stages?.render) {
    project.generation_checkpoint.stages.render.frames = {};
    project.generation_checkpoint.stages.render.status = 'pending';
  }
  markCheckpointStage(project, 'compose', {
    status: 'pending',
    output_path: '',
    output_audio_path: '',
    diagnostic_code: '',
  });
  markCheckpointStage(project, 'duration_verify', {
    status: 'pending',
    expected_duration_sec: undefined,
    actual_duration_sec: undefined,
    diagnostic_code: '',
  });
  markCheckpointStage(project, 'visual_inspect', {
    status: 'pending',
    report_path: null,
    diagnostic_code: '',
  });
  project.exports = [];
  project.render_outputs = [];
  project.status = 'draft';
  return project;
}

// R4：帧统计（overlay_check/text_blocks/cards/graphics）必须合并进 attachVisualRouting
// 闭包引用的 visualDecisions/renderDecisions 源对象，直接写 project.render_decisions
// 会在下一次 attachVisualRouting 重挂时被覆盖抹掉。
// scene_html 模式下 statsByBeatId 的键是 scene:<scene_id>（决策仍按 beat_id 键控），
// beat 键 miss 时按 scene 键回落，把整场景 HTML 的统计展开到该 scene 全部 beat 决策上，
// 并打 stats_scope:'scene' 标记（下游 QA 对 scene 维度统计按 scene 去重，避免 N 倍重复告警）。
function mergeFrameStatsIntoDecisions({ visualDecisions, renderDecisions, statsByBeatId = {} }) {
  const applyTo = decision => {
    if (!decision) return;
    const beatStats = statsByBeatId[decision.beat_id];
    if (beatStats) {
      Object.assign(decision, beatStats); // { overlay_check, text_blocks, cards, graphics }
      return;
    }
    const sceneStats = statsByBeatId[`scene:${String(decision.scene_id || '').trim()}`];
    if (sceneStats) Object.assign(decision, sceneStats, { stats_scope: 'scene' });
  };
  if (visualDecisions instanceof Map) for (const decision of visualDecisions.values()) applyTo(decision);
  if (Array.isArray(renderDecisions)) for (const decision of renderDecisions) applyTo(decision);
}

function resolveResumeContentGraph(projectDir, project = {}, sceneSpec = null) {
  if (!project) return null;
  if (!resumeArtifactsMatch(project, sceneSpec)) return null;
  if (hasUsableContentGraph(project.content_graph) && contentGraphMatchesSceneSpec(project.content_graph, sceneSpec)) {
    return project.content_graph;
  }
  const checkpointGraph = loadCheckpointContentGraph(projectDir, project);
  return checkpointGraph && contentGraphMatchesSceneSpec(checkpointGraph, sceneSpec) ? checkpointGraph : null;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function resolveRenderTarget(target = {}, sceneSpec = {}) {
  const aspectRatio = target.aspect_ratio
    || target.aspectRatio
    || sceneSpec.aspect_ratio
    || sceneSpec.aspectRatio
    || '';
  const durationSec = firstPositiveNumber(
    target.duration_sec,
    target.durationSec,
    target.duration,
    target.target_duration_sec,
    target.targetDurationSec,
    sceneSpec.target_duration_sec,
    sceneSpec.targetDurationSec,
  );
  return {
    ...target,
    aspect_ratio: aspectRatio,
    aspectRatio,
    duration_sec: durationSec || target.duration_sec || target.durationSec || target.duration,
  };
}

const RENDER_TARGET_DEFAULTS = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};
const DEFAULT_RENDER_FPS = 30;

function applyRenderTargetDefaults(target = {}) {
  const aspect = String(target.aspect_ratio || target.aspectRatio || '9:16').trim();
  const fallback = RENDER_TARGET_DEFAULTS[aspect] || RENDER_TARGET_DEFAULTS['9:16'];
  const targetResolution = objectOrEmpty(target.resolution);
  const width = firstPositiveNumber(target.width, targetResolution.width, fallback.width);
  const height = firstPositiveNumber(target.height, targetResolution.height, fallback.height);
  const fps = firstPositiveNumber(target.fps, DEFAULT_RENDER_FPS);
  return { ...target, width, height, resolution: { width, height }, fps };
}

function hasSceneSpecScenes(sceneSpec) {
  return Boolean(sceneSpec && Array.isArray(sceneSpec.scenes) && sceneSpec.scenes.length > 0);
}

function isBlockingVisualQaIssue(issue = {}) {
  // 阻断 code 共享常量：与 resumeExecutor / retryPlanner 保持字面一致
  return require('../visualQaCodes').isBlockingVisualQaCode(issue.code);
}

function applyMediaOptionsToProject(project, mediaOptions = {}) {
  if (mediaOptions.generateCaptions !== false) return project;
  for (const frame of Array.isArray(project?.frames) ? project.frames : []) {
    frame.generate_captions = false;
    frame.captions = [];
  }
  return project;
}

function mediaOptionEnabled(key, target = {}, projectOptions = {}) {
  const snakeKey = key === 'generateAudio' ? 'generate_audio' : 'generate_captions';
  if (typeof projectOptions[key] === 'boolean') return projectOptions[key];
  if (typeof projectOptions[snakeKey] === 'boolean') return projectOptions[snakeKey];
  if (typeof target[key] === 'boolean') return target[key];
  if (typeof target[snakeKey] === 'boolean') return target[snakeKey];
  return true;
}

function normalizeFrameHtmlConcurrency(target = {}, projectOptions = {}) {
  const number = Number(projectOptions.frameHtmlConcurrency ?? projectOptions.frame_html_concurrency ?? target.frameHtmlConcurrency ?? target.frame_html_concurrency);
  if (!Number.isFinite(number)) return 1;
  return Math.min(5, Math.max(1, Math.round(number)));
}

function summarizeVisualRoute(project = {}) {
  const frames = Array.isArray(project.frames) ? project.frames : [];
  const decisions = Array.isArray(project.render_decisions) ? project.render_decisions : [];
  const styleProfile = objectOrEmpty(project.visual_plan?.style_profile);
  return {
    total_beats: Array.isArray(project.visual_plan?.beats) ? project.visual_plan.beats.length : frames.length,
    raw_html: frames.filter(frame => frame.source_mode === 'raw_html').length,
    fallback: decisions.filter(decision => decision.fallback_from || decision.fallback_reason).length,
    style_profile_id: styleProfile.id || '',
  };
}

async function runEnvironmentDoctor(services) {
  const doctor = services.environmentDoctor || environmentDoctor.diagnoseEnvironment;
  return doctor();
}

async function generateHtmlVideo(options = {}) {
  const {
    workflowId,
    runId,
    rootDir,
    sceneSpec: inputSceneSpec = null,
    creativeContext: inputCreativeContext = {},
    target = {},
    services = {},
    skipValidation = false,
    runLayoutQa = false,
    ignoreLayoutQaFrameIds = [],
    onProgress = null,
    projectOptions = {},
  } = options;
  let creativeContext = inputCreativeContext || {};
  let sceneSpec = inputSceneSpec
    || objectOrEmpty(creativeContext).scene_spec
    || objectOrEmpty(creativeContext).sceneSpec
    || null;
  if (!hasSceneSpecScenes(sceneSpec)) {
    const persistedSceneSpec = await projectStore.loadSceneSpec(existingProjectDir(rootDir, workflowId, runId));
    if (hasSceneSpecScenes(persistedSceneSpec)) sceneSpec = persistedSceneSpec;
  }
  const mediaOptions = {
    generateAudio: mediaOptionEnabled('generateAudio', target, projectOptions),
    generateCaptions: mediaOptionEnabled('generateCaptions', target, projectOptions),
  };
  const frameHtmlConcurrency = normalizeFrameHtmlConcurrency(target, projectOptions);
  const reuseContentGraphRequested = options.reuseContentGraph === true || projectOptions?.reuseContentGraph === true;
  const regenerateFrameHtmlRequested = options.regenerateFrameHtml === true || projectOptions?.regenerateFrameHtml === true;
  const diagnostics = [];
  let model = getModel(services);
  const renderTarget = resolveRenderTarget(target, sceneSpec || {});

  let projectDir = existingProjectDir(rootDir, workflowId, runId);
  const resumeProject = await loadExistingProject(projectDir);
  if (!resumeProject) {
    projectDir = await projectStore.createProjectDir({ rootDir, workflowId, runId });
  }
  // 旧链路工程直接拒绝续跑：normalizeProject 会裁掉 template_id/visual_strategy 等旧字段，
  // 因此从原始 project.json 判定。必须在任何写盘/阶段开始之前拦下。
  if (resumeProject) {
    const rawResumeProject = await projectStore.readRawProjectJson(projectDir);
    const legacyMarkers = detectLegacyPipelineMarkers(rawResumeProject || {});
    if (legacyMarkers.legacy) {
      return failure('该任务由旧版链路生成，已不支持续跑重试，请重新发起任务。', [
        createDiagnostic({
          code: 'legacy_pipeline_project',
          stage: 'project',
          sub_stage: 'validate_project',
          user_message: '该任务由旧版链路生成，已不支持续跑重试，请重新发起任务。',
          details: { marker: legacyMarkers.marker },
          retryable: false,
          fallback_allowed: false,
        }),
      ], { html_video_project_path: projectDir, project_dir: projectDir });
    }
  }
  // 决策2：resume 时以落盘 project 的 continuity_mode 为兜底，保证二次执行
  // （retry/resume 不带 creativeContext）不掉 scene_html；creativeContext 显式值优先。
  if (resumeProject) {
    creativeContext = {
      ...creativeContext,
      continuity_mode: creativeContext?.continuity_mode || resumeProject.continuity_mode || null,
    };
  }
  // P1-1a：在进入任何可失败阶段（生图/内容图/Frame HTML）之前先把 continuity_mode 落盘。
  // 否则首次执行在建帧阶段失败提前返回时，真实 retry（不带 creativeContext）会丢失 scene_html 选择。
  // 后续 attachContinuityMode 调用幂等，成功路径行为不变。
  await projectStore.writeProjectJson(projectDir, current => attachContinuityMode(current, creativeContext));
  model = createAuditedModel(model, projectDir);
  // 尽早广播工程目录：任务运行中前端轮询依赖它水合生成图等工程内素材
  await report(onProgress, {
    type: 'html_video_project_dir_ready',
    stage: 'project',
    sub_stage: 'validate_project',
    message: 'html-video 工程目录已就绪。',
    data: { html_video_project_path: projectDir, project_dir: projectDir },
  });
  if (hasSceneSpecScenes(sceneSpec)) {
    await projectStore.saveSceneSpec(projectDir, sceneSpec);
  }

  // beat 级视觉计划：内存版 visualPlan 含 source_scene 供建帧/路由消费，持久化版剥离 source_scene
  let visualPlan = null;
  let persistableVisualPlan = null;
  // beat 级路由决策（Map，键为 beat.id），建帧与持久化共用
  let visualDecisions = null;
  let renderDecisions = null;
  // per_scene 工程重建/重写 project.json 时统一挂载视觉计划与路由决策，始终读取最新值
  const attachVisualRouting = target => {
    if (persistableVisualPlan && target) {
      target.scene_spec = objectOrEmpty(sceneSpec);
      target.visual_plan = persistableVisualPlan;
      target.render_decisions = renderDecisions;
      target.visual_route_summary = summarizeVisualRoute(target);
    }
    return target;
  };
  // 生图/素材水合必须在 beat 路由之前完成，否则路由决策看不到生成图。
  creativeContext = await materializeCreativeContextAssets(projectDir, creativeContext);
  const existingProjectForGeneration = resumeProject || await loadExistingProject(projectDir);
  creativeContext = hydrateGeneratedAssetsFromProject({
    project: existingProjectForGeneration,
    creativeContext,
    projectDir,
  });
  let skipGeneration = false;
  let requiredSceneIds = [];
  if (reuseContentGraphRequested) {
    const reusedNodes = Array.isArray(existingProjectForGeneration?.content_graph?.nodes)
      ? existingProjectForGeneration.content_graph.nodes
      : [];
    const referencedGeneratedIds = new Set(reusedNodes
      .flatMap(node => (Array.isArray(node?.asset_refs) ? node.asset_refs : []))
      .map(ref => String(ref?.asset_id || ''))
      .filter(id => id.startsWith('gen_')));
    const hydratedGeneratedIds = new Set((creativeContext.asset_context?.assets || [])
      .filter(isGeneratedVisualAsset)
      .map(asset => asset.id));
    requiredSceneIds = [...referencedGeneratedIds]
      .filter(id => !hydratedGeneratedIds.has(id))
      .map(id => id.replace(/^gen_/, ''));
    skipGeneration = requiredSceneIds.length === 0;
  }
  const generatedImageResult = skipGeneration
    ? { creativeContext, generated_count: 0, failures: [], diagnostics: [] }
    : await runGeneratedImagePhase({
      sceneSpec,
      creativeContext,
      projectDir,
      aspectRatio: renderTarget.aspect_ratio || renderTarget.aspectRatio || '',
      requiredSceneIds,
      services: { ...services, aiTextModel: model },
      onProgress,
      now: new Date().toISOString(),
    });
  creativeContext = generatedImageResult.creativeContext;
  if (generatedImageResult.diagnostics?.length) diagnostics.push(...generatedImageResult.diagnostics);
  if (generatedImageResult.generated_count > 0) {
    await projectStore.writeProjectJson(projectDir, current => {
      const generatedAssets = projectAssetsFromCreativeContext(creativeContext)
        .filter(isGeneratedVisualAsset);
      const byId = new Map((current.assets || []).map(asset => [asset.id, asset]));
      generatedAssets.forEach(asset => byId.set(asset.id, { ...(byId.get(asset.id) || {}), ...asset }));
      current.assets = Array.from(byId.values()).filter(asset => asset.path);
      return current;
    });
  }
  if (!hasSceneSpecScenes(sceneSpec)) {
    return failure('缺少 scene_spec，无法逐场景生成。', [
      createDiagnostic({
        code: 'scene_spec_missing',
        stage: 'project',
        sub_stage: 'route_decision',
        user_message: '缺少 scene_spec，无法逐场景生成。',
        fallback_allowed: false,
      }),
    ], {
      html_video_project_path: projectDir,
      project_dir: projectDir,
    });
  }
  // 路由输入用绑定生成图后的克隆 spec；原始 sceneSpec 保持不变以稳定 scene_spec_hash
  const routingSceneSpec = bindGeneratedAssetsToSceneSpec(sceneSpec, creativeContext);
  visualPlan = buildVisualPlan({ sceneSpec: routingSceneSpec, workflowId });
  assignMotionOrchestration(visualPlan, {
    styleProfile: visualPlan.style_profile || null,
  });
  visualDecisions = matchVisualBeatsToRenderers({ visualPlan });
  renderDecisions = Array.from(visualDecisions.values());
  // 持久化版剥离 source_scene，防止 project.json 膨胀
  persistableVisualPlan = {
    ...visualPlan,
    beats: visualPlan.beats.map(({ source_scene, ...beat }) => beat),
  };
  const templateRenderTarget = applyRenderTargetDefaults(renderTarget);
  const currentSceneSpecHash = computeSceneSpecCheckpointHash(sceneSpec || {});
  const trustedTargetDurationSec = firstPositiveNumber(
    templateRenderTarget.duration_sec,
    templateRenderTarget.durationSec,
    templateRenderTarget.duration,
  );
  await report(onProgress, {
    type: 'html_video_routing_ready',
    stage: 'project',
    sub_stage: 'route_decision',
    message: '已启用逐场景生成。',
    data: {},
  });

  const env = skipValidation ? { ok: true, diagnostics: [] } : await runEnvironmentDoctor(services);
  let project = resumeProject || undefined;

  const resumeAllowed = resumeArtifactsMatch(resumeProject || {}, sceneSpec);
  let contentGraph = resolveResumeContentGraph(projectDir, resumeProject, sceneSpec);
  const reusedContentGraph = Boolean(contentGraph);
  if (contentGraph) {
    project = await projectStore.writeProjectJson(projectDir, current => {
      attachVisualRouting(current);
      current.generation_checkpoint.scene_spec_hash = currentSceneSpecHash;
      current.content_graph = contentGraph;
      markCheckpointStage(current, 'content_graph', {
        status: 'done',
        reused: true,
        diagnostic_code: '',
      });
      return current;
    });
  } else {
    if (reuseContentGraphRequested) {
      const message = '未找到可复用的内容图，请先完整生成一次视频。';
      return failure(message, [
        ...diagnostics,
        createDiagnostic({
          code: 'content_graph_reuse_missing',
          stage: 'project',
          sub_stage: 'content_graph',
          user_message: message,
          retryable: false,
          fallback_allowed: false,
        }),
      ], {
        html_video_project_path: projectDir,
        project_dir: projectDir,
        project,
      });
    }
    await report(onProgress, {
      type: 'html_video_graph_started',
      stage: 'project',
      sub_stage: 'content_graph',
      message: '正在生成 html-video 内容图...',
      data: {},
    });
    const graphResult = await generateContentGraphWithRetry({
      model,
      sceneSpec,
      creativeContext,
      target: templateRenderTarget,
      onProgress,
      project,
      projectDir,
    });
    if (!graphResult.success) {
      const graphDiagnostics = normalizeDiagnostics(graphResult.diagnostics, {
        code: 'content_graph_failed',
        stage: 'ai-content-graph',
        sub_stage: 'content_graph',
        user_message: graphResult.message || 'content graph 生成失败。',
        retryable: true,
        repair_action: 'retry_content_graph',
      });
      project = await projectStore.writeProjectJson(projectDir, current => {
        markCheckpointStage(current, 'content_graph', {
          status: 'failed',
          input_hash: graphResult.inputHash || '',
          diagnostic_code: graphDiagnostics[0]?.code || 'content_graph_failed',
        });
        return current;
      });
      return failure(graphResult.message || 'content graph 生成失败。', [...diagnostics, ...graphDiagnostics], {
        html_video_project_path: projectDir,
        project_dir: projectDir,
        project,
      });
    }
    diagnostics.push(...normalizeDiagnostics(graphResult.diagnostics));
    contentGraph = graphResult.contentGraph;
    if (sceneSpec) {
      const graphBinding = validateGraphMatchesSceneSpec(contentGraph, sceneSpec);
      if (!graphBinding.ok) {
        const graphDiagnostics = [
          ...diagnostics,
          contentGraphSceneSpecMismatchDiagnostic(graphBinding),
        ];
        await report(onProgress, {
          type: 'html_video_graph_scene_spec_mismatch',
          stage: 'project',
          sub_stage: 'content_graph',
          message: CONTENT_GRAPH_SCENE_SPEC_MISMATCH_MESSAGE,
          data: graphBinding,
        });
        project = await projectStore.writeProjectJson(projectDir, current => {
          markCheckpointStage(current, 'content_graph', {
            status: 'failed',
            input_hash: graphResult.inputHash || '',
            diagnostic_code: 'content_graph_scene_spec_mismatch',
          });
          return current;
        });
        return failure(CONTENT_GRAPH_SCENE_SPEC_MISMATCH_MESSAGE, graphDiagnostics, {
          html_video_project_path: projectDir,
          project_dir: projectDir,
          project,
        });
      }
    }
    await report(onProgress, {
      type: 'html_video_graph_done',
      stage: 'project',
      sub_stage: 'content_graph',
      message: 'html-video 内容图已生成。',
      data: {
        node_count: contentGraph.nodes?.length || 0,
        edge_count: contentGraph.edges?.length || 0,
      },
    });
    const contentGraphPath = await projectStore.saveContentGraph(projectDir, contentGraph);
    project = await projectStore.writeProjectJson(projectDir, current => {
      if (!reusedContentGraph) invalidateFrameHtmlResumeState(current);
      attachVisualRouting(current);
      current.content_graph = contentGraph;
      current.generation_checkpoint.scene_spec_hash = currentSceneSpecHash;
      current.generation_checkpoint.target = {
        duration_sec: firstPositiveNumber(templateRenderTarget.duration_sec, templateRenderTarget.durationSec, templateRenderTarget.duration),
        aspect_ratio: templateRenderTarget.aspect_ratio || templateRenderTarget.aspectRatio || '',
      };
      markCheckpointStage(current, 'content_graph', {
        status: 'done',
        path: contentGraphPath,
        input_hash: graphResult.inputHash || '',
        output_hash: sha256(JSON.stringify(contentGraph)),
        diagnostic_code: '',
        reused: false,
      });
      return current;
    });
  }
  // scene_html 分支只在 continuity_mode = scene_html 生效；此时 project.continuity_mode 尚未挂载
  // （attachContinuityMode 在建帧后才调用），用 creativeContext 判断等价条件。
  if ((creativeContext?.continuity_mode || 'beat_mp4') === 'scene_html') {
    const refsBySceneId = new Map(contentGraph.nodes.map(node => [
      firstNonEmptyString(resolveNodeSceneId(node), node.id),
      Array.isArray(node.asset_refs) ? node.asset_refs : [],
    ]));
    contentGraph = expandContentGraphToSceneEntries(contentGraph, visualPlan);
    contentGraph.nodes = contentGraph.nodes.map(node => ({
      ...node,
      asset_refs: Array.isArray(node.asset_refs) && node.asset_refs.length
        ? node.asset_refs
        : (refsBySceneId.get(firstNonEmptyString(resolveNodeSceneId(node), node.id)) || []),
    }));
  } else {
    contentGraph = expandContentGraphToVisualBeats({ graph: contentGraph, visualPlan, visualDecisions });
  }
  const expandedContentGraphPath = await projectStore.saveContentGraph(projectDir, contentGraph);
  project = await projectStore.writeProjectJson(projectDir, current => {
    current.content_graph = contentGraph;
    current.generation_checkpoint = objectOrEmpty(current.generation_checkpoint);
    current.generation_checkpoint.stages = objectOrEmpty(current.generation_checkpoint.stages);
    current.generation_checkpoint.stages.content_graph = {
      ...(current.generation_checkpoint.stages.content_graph || {}),
      path: expandedContentGraphPath,
      output_hash: sha256(JSON.stringify(contentGraph)),
    };
    attachVisualRouting(current);
    return current;
  });
  const frameHtmlResult = await runFrameHtmlPhase({
    model,
    projectDir,
    project,
    contentGraph,
    sceneSpec,
    creativeContext,
    templateRenderTarget,
    mediaOptions,
    frameHtmlConcurrency,
    resumeAllowed,
    regenerateFrameHtmlRequested,
    // 帧生成阶段的布局自检不跟随 skipValidation：skipValidation 只跳过阻断式校验，
    // 而这里是生成质量自修复，关掉它就会重现“元素互相遮挡”的成片。
    runLayoutQa: runLayoutQa === true,
    ignoreLayoutQaFrameIds,
    layoutQaService: services.layoutQaService || defaultLayoutQaService,
    onProgress,
    diagnostics,
    report,
    objectOrEmpty,
    sha256,
    failure,
    shouldReuseFrameHtml,
    invalidateFrameHtmlDependents,
    templateRoutingDecisions: visualDecisions,
  });
  if (!frameHtmlResult.ok) return frameHtmlResult.failure;
  project = frameHtmlResult.project;
  contentGraph = frameHtmlResult.contentGraph;
  // R4：在 attachVisualRouting 重挂之前，把帧统计合并进闭包引用的决策源对象
  mergeFrameStatsIntoDecisions({
    visualDecisions,
    renderDecisions,
    statsByBeatId: frameHtmlResult.stats_by_beat_id || {},
  });
  try {
    project = await buildMixedFrameProject({
      projectDir,
      workflowId,
      runId,
      graph: contentGraph,
      sceneSpec,
      target: templateRenderTarget,
      decisions: visualDecisions,
      visualPlan,
      mediaOptions,
      generationCheckpoint: project?.generation_checkpoint,
      // 与 attachContinuityMode 同优先级（creativeContext 优先）：此时 project 尚未挂载，
      // 且 normalizeProject 会把 continuity_mode 缺省成 beat_mp4，不能反过来盖掉 creativeContext
      continuityMode: creativeContext?.continuity_mode || project?.continuity_mode || 'beat_mp4',
    });
    // buildMixedFrameProject 会重建 project，这里要重新挂上视觉计划与路由决策
    attachVisualRouting(project);
    attachContinuityMode(project, creativeContext);
    project.generation_checkpoint = objectOrEmpty(project.generation_checkpoint);
    project.generation_checkpoint.agent_pipeline = [
      { agent: AGENTS.contentGraph, stage: STAGES.contentGraph, artifact: 'content-graph.json' },
      { agent: AGENTS.frameHtml, stage: STAGES.frameHtml, artifact: 'frames' },
    ];
    project = await projectStore.saveProject(projectDir, project);
  } catch (error) {
    const frameId = rawHtmlBuildFrameIdFromError(error);
    const message = error?.message || 'raw HTML 工程构建失败。';
    return failure(message, [
      ...diagnostics,
      createDiagnostic({
        code: 'raw_html_build_failed',
        stage: 'project',
        sub_stage: 'raw_html_build',
        ...(frameId ? { frame_id: frameId } : {}),
        user_message: message,
        retryable: true,
        repair_action: 'retry_frame_html',
        details: { message },
      }),
    ], {
      html_video_project_path: projectDir,
      project_dir: projectDir,
      project,
    });
  }
  project = applyMediaOptionsToProject(project, mediaOptions);
  // 首次 saveProject 之前统一挂上 continuity_mode
  attachContinuityMode(project, creativeContext);
  const sourceProjectAssets = projectAssetsFromCreativeContext(creativeContext);
  if (sourceProjectAssets.length) {
    const byPath = new Map((Array.isArray(project.assets) ? project.assets : []).map(asset => [String(asset.path || ''), asset]));
    sourceProjectAssets.forEach(asset => byPath.set(asset.path, { ...(byPath.get(asset.path) || {}), ...asset }));
    project.assets = Array.from(byPath.values()).filter(asset => asset.path);
  }

  const validation = await validateHtmlVideoProject({
    project,
    projectDir,
    environment: env,
    sceneSpec: skipValidation ? null : sceneSpec,
    mediaOptions,
  });
  diagnostics.push(...validation.diagnostics);
  if (!validation.ok) {
    markCheckpointStage(project, 'validate_project', {
      status: 'failed',
      diagnostic_code: validation.diagnostics[0]?.code || diagnostics[0]?.code || 'project_invalid',
    });
    project = await projectStore.saveProject(projectDir, project);
    project = await attachAssetUsageReport({ project, projectDir, creativeContext });
    return failure('html-video 工程未通过生成前校验。', diagnostics, {
      html_video_project_path: projectDir,
      project_dir: projectDir,
      project,
    });
  }
  markCheckpointStage(project, 'validate_project', {
    status: 'done',
    diagnostic_code: '',
  });
  project = await projectStore.saveProject(projectDir, project);

  // 已编排过（含用户在编辑器里的删除标记）就不再重跑 AI，避免恢复/重试时覆盖用户改动；
  // 脚本（scene_spec）变了则时间点已失效，重新编排
  const sfxEnabledForRun = target.autoSfxEnabled !== false && mediaOptions.generateAudio !== false;
  const reusableSfx = [
    objectOrEmpty(objectOrEmpty(project.audio).sfx),
    objectOrEmpty(objectOrEmpty(resumeProject?.audio).sfx),
  ].find(sfx => sfx.status === 'ready'
    && sfx.scene_spec_hash === currentSceneSpecHash
    && Array.isArray(sfx.events) && sfx.events.length > 0) || null;
  if (mediaOptions.generateAudio === false) {
    project.audio = {
      ...(project.audio || {}),
      status: 'skipped',
      reason: 'disabled_by_settings',
      narration_path: null,
      tts_manifest_path: null,
    };
  } else {
    const existingNarrationAudio = resolveExistingNarrationAudio(
      mergeResumeAudioIntoCreativeContext(creativeContext, project, resumeProject, sceneSpec),
      sceneSpec,
    );
    if (existingNarrationAudio.reusable) {
      const audio = existingNarrationAudio.audio;
      project.audio = objectOrEmpty(project.audio);
      project.audio.source = audio.source;
      project.audio.scene_spec_hash = audio.scene_spec_hash;
      project.audio.scene_count = audio.scene_count ?? audio.sceneCount;
      project.audio.scene_ids = Array.isArray(audio.scene_ids) ? audio.scene_ids : [];
      project.audio.status = audio.status || 'ready';
      project.audio.narration_path = existingNarrationAudio.path;
      project.audio.tts_manifest_path = audio.tts_manifest_path || audio.ttsManifestPath || null;
    } else if (services.ttsService && sceneSpec) {
      if (existingNarrationAudio.path) {
        await report(onProgress, {
          type: 'html_video_tts_regenerate_started',
          stage: 'audio',
          sub_stage: 'tts',
          message: '检测到脚本已变化，正在按当前字幕重新生成旁白...',
          data: { reason: existingNarrationAudio.reason },
        });
      }
      const tts = await services.ttsService.synthesizeSceneNarration({
        projectDir,
        sceneSpec,
      });
      if (!tts.success) {
        return failure(tts.message || '旁白音频生成失败。', diagnostics, {
          html_video_project_path: projectDir,
          project_dir: projectDir,
          project,
        });
      }
      applyManifestToProjectAudio(project, sceneSpec, objectOrEmpty(tts.audio_manifest));
    } else if (existingNarrationAudio.path && sceneSpec) {
      return failure('当前音频与字幕脚本不一致，请重新生成旁白后再渲染。', diagnostics, {
        html_video_project_path: projectDir,
        project_dir: projectDir,
        project,
      });
    }
  }
  if (sfxEnabledForRun && reusableSfx) {
    project.audio = objectOrEmpty(project.audio);
    project.audio.sfx = reusableSfx;
    await report(onProgress, {
      type: 'html_video_sfx_planning_reused',
      stage: 'audio',
      sub_stage: 'sfx',
      message: '复用已有自动音效编排。',
      data: { count: reusableSfx.events.length },
    });
  } else if (sfxEnabledForRun) {
    try {
      await report(onProgress, {
        type: 'html_video_sfx_planning_started',
        stage: 'audio',
        sub_stage: 'sfx',
        message: '正在编排自动音效...',
        data: {},
      });
      const library = sfxLibrary.loadSfxLibrary();
      const librarySummary = sfxLibrary.getSfxLibrarySummary({ library });
      if (!librarySummary.length) {
        const emptyLibraryError = new Error('本地音效素材库为空。');
        emptyLibraryError.code = 'sfx_library_missing';
        throw emptyLibraryError;
      }
      const planned = await (services.sfxPlannerAgent || sfxPlannerAgent).planSfxEvents({
        model,
        target: templateRenderTarget,
        rules: sfxEventService.getPlanningRules(project, sceneSpec),
        sfxLibrary: librarySummary,
        scenes: sfxEventService.buildSfxPlanningScenes({ project, sceneSpec }),
      });
      if (!planned || planned.success === false) {
        const plannedError = new Error(planned?.message || '自动音效编排失败，已跳过音效增强。');
        plannedError.code = planned?.code;
        throw plannedError;
      }
      const applied = await sfxEventService.applyPlannedSfxEvents({
        projectDir,
        project,
        sceneSpec,
        library,
        aiEvents: planned.events,
      });
      project = applied.project;
      project.audio.sfx.scene_spec_hash = currentSceneSpecHash;
      if (!applied.events.length) {
        diagnostics.push(createDiagnostic({
          code: 'sfx_no_valid_events',
          stage: 'audio',
          sub_stage: 'sfx',
          user_message: '自动音效编排未产生可用事件，已跳过音效增强。',
          details: {},
          severity: 'warning',
        }));
      }
      if (applied.dropped.length) {
        diagnostics.push(createDiagnostic({
          code: 'sfx_asset_missing',
          stage: 'audio',
          sub_stage: 'sfx',
          user_message: `部分自动音效素材不可用，已丢弃 ${applied.dropped.length} 条。`,
          details: { dropped: applied.dropped },
          severity: 'warning',
        }));
      }
      await report(onProgress, {
        type: 'html_video_sfx_planning_done',
        stage: 'audio',
        sub_stage: 'sfx',
        message: '自动音效编排完成。',
        data: { count: applied.events.length, dropped: applied.dropped.length },
      });
    } catch (error) {
      const diagnosticCode = error?.code === 'ENOENT' ? 'sfx_library_missing' : (error?.code || 'sfx_planning_failed');
      const reason = error?.message || '自动音效编排失败，已跳过音效增强。';
      sfxEventService.markSfxSkipped(project, reason);
      await sfxEventService.persistProjectSfxMirror(projectDir, project).catch(() => {});
      diagnostics.push(createDiagnostic({
        code: diagnosticCode,
        stage: 'audio',
        sub_stage: 'sfx',
        user_message: '自动音效编排失败，已跳过音效增强。',
        details: { reason },
        severity: 'warning',
      }));
      await report(onProgress, {
        type: 'html_video_sfx_planning_skipped',
        stage: 'audio',
        sub_stage: 'sfx',
        message: '自动音效编排失败，已跳过音效增强。',
        data: { code: diagnosticCode, reason },
      });
    }
  }
  project = await projectStore.saveProject(projectDir, project);
  const rendered = await projectOrchestrator.renderHtmlVideoProject({
    rootDir,
    workflowId,
    runId,
    projectDir,
    project,
    services,
    onProgress,
    runLayoutQa: runLayoutQa === true && !skipValidation,
    ignoreLayoutQaFrameIds,
    targetDurationSec: trustedTargetDurationSec,
    creativeContext,
  });
  diagnostics.push(...normalizeDiagnostics(rendered.diagnostics));
  if (!rendered.success) {
    return failure(rendered.message || 'html-video 工程渲染失败。', diagnostics, {
      ...(rendered.code ? { code: rendered.code } : {}),
      html_video_project_path: rendered.html_video_project_path || projectDir,
      project_dir: rendered.project_dir || projectDir,
      project: rendered.project || project,
    });
  }

  let visualReport = { success: true, issues: [], metrics: {} };
  const visualQaService = services.visualQaService || defaultVisualQaService;
  await report(onProgress, {
    type: 'html_video_visual_inspect_started',
    stage: 'project',
    sub_stage: 'visual_inspect',
    message: skipValidation ? '正在执行 html-video 成片轻量安全检查...' : '正在巡检 html-video 成片画面...',
    data: { safety_only: skipValidation === true },
  });
  visualReport = await visualQaService.inspectRenderedVideo({
    projectDir,
    outputPath: rendered.output_path,
    project: rendered.project,
    expectedAspectRatio: templateRenderTarget.aspect_ratio || sceneSpec?.aspect_ratio,
    safetyOnly: skipValidation === true,
  });
  const visualReportPath = visualReport.report_path || visualReport.reportPath || 'inspect/visual-report.json';
  const visualIssues = Array.isArray(visualReport.issues) ? visualReport.issues : [];
  const blockingVisualIssues = visualIssues.filter(isBlockingVisualQaIssue);
  if (!visualReport.success) {
    diagnostics.push(createDiagnostic({
      code: 'visual_qa_warning',
      stage: 'inspect',
      sub_stage: 'visual_inspect',
      user_message: visualReport.message || (blockingVisualIssues.length
        ? 'html-video 成片画面存在开头或镜头边界白屏，未通过视觉安全检查。'
        : 'html-video 视觉质检未通过，仅记录为参考报告。'),
      details: { issues: visualIssues, metrics: visualReport.metrics || {} },
      severity: blockingVisualIssues.length ? 'error' : 'warning',
    }));
  }
  markCheckpointStage(rendered.project, 'visual_inspect', {
    status: visualReport.success ? 'done' : (blockingVisualIssues.length ? 'failed' : 'warning'),
    report_path: visualReportPath,
    diagnostic_code: visualReport.success ? '' : 'visual_qa_warning',
  });
  rendered.project = await projectStore.saveProject(projectDir, rendered.project);
  await report(onProgress, {
    type: 'html_video_visual_inspect_done',
    stage: 'project',
    sub_stage: 'visual_inspect',
    message: visualReport.success ? 'html-video 成片画面巡检完成。' : 'html-video 成片画面巡检发现问题。',
    data: visualReport,
  });
  const missingRequiredAssets = missingRequiredAssetIds(rendered.project);
  if (missingRequiredAssets.length) {
    // 素材必须进画面：缺引用要阻断并触发帧重试
    diagnostics.push(createDiagnostic({
      code: 'required_visual_asset_missing',
      stage: 'project',
      sub_stage: 'asset_usage',
      severity: 'error',
      retryable: true,
      repair_action: 'retry_frame_html',
      user_message: `有 ${missingRequiredAssets.length} 个必用视觉素材未进入最终画面，已停止导出，可重试重新生成对应镜头。`,
      details: {
        missing_required_asset_ids: missingRequiredAssets,
        required_asset_ids: rendered.project.asset_usage_report?.required_asset_ids || [],
      },
    }));
    rendered.project = await projectStore.saveProject(projectDir, rendered.project);
    return failure(`有 ${missingRequiredAssets.length} 个必用视觉素材未进入最终画面，已停止导出。`, diagnostics, {
      code: 'required_visual_asset_missing',
      html_video_project_path: projectDir,
      project_dir: projectDir,
      project: rendered.project,
      output_path: rendered.output_path,
    });
  }
  if (blockingVisualIssues.length) {
    rendered.project = await projectStore.saveProject(projectDir, rendered.project);
    return failure('html-video 成片画面存在开头或镜头边界白屏，未通过视觉安全检查。', diagnostics, {
      code: 'visual_qa_blocking_failure',
      html_video_project_path: projectDir,
      project_dir: projectDir,
      project: rendered.project,
      output_path: rendered.output_path,
      visual_report: visualReport,
    });
  }

  return {
    success: true,
    message: 'html-video 成片完成。',
    render_mode: 'html-video',
    project: rendered.project,
    project_dir: projectDir,
    html_video_project_path: projectDir,
    output_path: rendered.output_path,
    files: ['project.json', 'content-graph.json'],
    audio_manifest: rendered.project.audio?.tts_manifest_path || null,
    scene_spec: sceneSpec,
    visual_report: visualReport,
    html_video_diagnostics: diagnostics,
    diagnostics,
  };
}

async function loadProjectForWorkflow({ workflowId, projectDir, rootDir }) {
  if (projectDir) {
    return { projectDir, project: await projectStore.loadProject(projectDir) };
  }
  throw new Error(`缺少 html-video 工程目录，无法加载工作流 ${workflowId || ''}。`);
}

async function parseEditInstruction({ model, project, instruction }) {
  const response = await model.callTextModel({
    messages: [{
      role: 'user',
      content: [
        '你是 html-video 可编辑工程的编辑补丁生成器。',
        '只能返回 JSON，不要返回 Markdown、HTML、CSS 或 JS。',
        'JSON 必须是 edit_patch，type 只能是 frame_inputs_patch、frame_patch、narration_patch、caption_patch、duration_patch。',
        '编辑单帧标题、旁白、字幕、时长或 inputs 时，优先返回 type=frame_patch，并带 frame_id；字幕必须写入 frame_patch.captions，不要写 project 顶层 captions。',
        '标题写入 frame_patch.metadata_patch.visual_text.headline；旁白写入 frame_patch.narration_text；时长写入 frame_patch.duration_sec。',
        '当前 project 摘要：',
        JSON.stringify({
          frames: (project.frames || []).map(frame => ({
            id: frame.id,
            scene_id: frame.scene_id,
            source_mode: frame.source_mode,
            inputs: frame.inputs,
            visual_text: frame.metadata?.visual_text || {},
            narration_text: frame.narration_text || '',
            captions: frame.captions || [],
            duration_sec: frame.duration_sec,
          })),
        }),
        `用户编辑意图：${instruction}`,
      ].join('\n'),
    }],
  });
  if (!response || response.success === false) {
    return { success: false, message: response?.message || '解析编辑意图失败。' };
  }
  const parsed = parseJsonOnlyResponse(response.text || response.content || '');
  if (!parsed.success) {
    return { success: false, message: parsed.user_message || parsed.message || 'AI 返回的 edit_patch JSON 无效。' };
  }
  return { success: true, edit_patch: parsed.data.edit_patch || parsed.data };
}

async function applyEdit({
  workflowId,
  rootDir,
  projectDir,
  project,
  payload = {},
  services = {},
} = {}) {
  const loaded = project
    ? { projectDir, project }
    : await loadProjectForWorkflow({ workflowId, rootDir, projectDir });
  let editPatch = payload.edit_patch || (payload.type ? payload : null);
  if (!editPatch && payload.instruction) {
    const parsed = await parseEditInstruction({
      model: getModel(services),
      project: loaded.project,
      instruction: payload.instruction,
    });
    if (!parsed.success) {
      return { success: false, code: 'EDIT_PATCH_INVALID', workflow_id: workflowId, message: parsed.message };
    }
    editPatch = parsed.edit_patch;
  }
  if (!editPatch) {
    return {
      success: false,
      code: 'EDIT_PATCH_REQUIRED',
      workflow_id: workflowId,
      message: '自然语言编辑需要先解析为 edit_patch JSON，首版不接受直接写 HTML 或自由文本改工程。',
    };
  }
  const result = editPatchService.applyEditPatch(loaded.project, editPatch);
  if (!result.success) return result;
  let rawHtmlTextPatch = { updated: false, updated_keys: [] };
  if (loaded.projectDir) {
    rawHtmlTextPatch = await syncRawHtmlFrameTextPatch({
      projectDir: loaded.projectDir,
      project: result.project,
      editPatch,
    });
    await projectStore.saveProject(loaded.projectDir, result.project);
  }
  return {
    ...result,
    workflow_id: workflowId,
    html_video_project_path: loaded.projectDir,
    raw_html_text_patch: rawHtmlTextPatch,
  };
}

async function renderOrExport(options = {}) {
  return projectOrchestrator.renderHtmlVideoProject(options);
}

async function rerender(options = {}) {
  return renderOrExport(options);
}

module.exports = {
  generateHtmlVideo,
  generateHtmlVideoProject: generateHtmlVideo,
  generateProject: generateHtmlVideo,
  renderOrExport,
  rerender,
  applyEdit,
  callTextModel,
  generateContentGraphWithRetry,
  buildAssetUsageReport,
  shouldReuseFrameHtml,
  detectLegacyPipelineMarkers,
  resumeArtifactsMatch,
  resolveRenderTarget,
  applyRenderTargetDefaults,
  expandContentGraphToVisualBeats,
  expandContentGraphToSceneEntries,
  bindGeneratedAssetsToSceneSpec,
};
