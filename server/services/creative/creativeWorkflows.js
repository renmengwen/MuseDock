const fsp = require('fs/promises');
const path = require('path');

const creativeContext = require('./creativeContext');
const defaultResearchService = require('../researchService');
const mediaPipeline = require('../mediaPipeline');
const defaultAgentRuns = require('../agent/agentRuns');
const aiModelConfig = require('../ai/aiModelConfig');
const appSettings = require('../appSettings');
const defaultCreativeVideoTtsService = require('../creative-video/ttsService');
const aiTextModel = require('../ai/aiTextModel');
const defaultSourceFetch = require('../source/sourceFetch');
const defaultSourceAssets = require('../source/sourceAssets');
const { prepareSource, prepareSourceAssetContext } = require('./creativeSourcePrep');
const htmlVideoProjectApi = require('../creative-video/htmlVideoProjectApi');
const retryPlanner = require('../creative-video/retryPlanner');
const resumeExecutor = require('../creative-video/resumeExecutor');
const { CreativeWorkflowStageError } = require('../creative-video/errors');
const { AGENTS, STAGES } = require('../creative-video/agentStages');
const { defaultRegistry: defaultCreativeTaskRegistry } = require('./creativeTaskRegistry');
const {
  projectStore: htmlVideoProjectStore,
  editPatchService: htmlVideoEditPatchService,
  frameHtmlEditService,
  iterateService: htmlVideoIterateService,
  layoutQaService,
  editModeService: htmlVideoEditModeService,
  projectOrchestrator: htmlVideoProjectOrchestrator,
  workflow: htmlVideoWorkflow,
  createDiagnostic,
  normalizeDiagnostics,
  syncRawHtmlFrameTextPatch,
  findFrameByAnyId,
  sfxEventService,
} = htmlVideoProjectApi;
const { computeSceneSpecSpeechHash } = require('../creative-video/sceneSpecHash');

// 持久化、阶段执行、工程同步已拆分为独立模块（同目录）
const {
  DEFAULT_ROOT,
  DEFAULT_MEDIA_ROOT,
  WORKFLOW_ID_PATTERN,
  STAGE_IDS,
  STAGE_LABELS,
  safeString,
  plainObject,
  getNow,
  makeId,
  appendWorkflowModelCall,
  makeLocalCreativeAwemeId,
  getWorkflowPath,
  isPathInside,
  createStages,
  normalizeStages,
  withWorkflowFileQueue,
  readJson,
  readWorkflow,
  workflowFileExists,
  persistWorkflow,
  persistWorkflowUnlocked,
  parseDateMs,
  isDefaultWorkflowRoot,
} = require('./workflowStore');
const {
  ensureSuccess,
  selectFailureDiagnostic,
  createLastFailureFromError,
  syncProjectStageSummariesFromCheckpoint,
  emitTaskContextEvent,
} = require('./workflowStageRunner');
const {
  normalizeProjectVisualAsset,
  applyAssetUsageReportToRecord,
  buildProjectAssetUsageReport,
  syncProjectStageSummariesFromProjectDir,
  projectPathFromStageResult,
  extractHtmlVideoProjectPathFromWorkflow,
  assetHydrationFingerprint,
  enrichWorkflowVideoUrls,
  readWorkflowAndHtmlVideoProject,
  loadWorkflowWithHtmlVideoProject,
} = require('./workflowProjectSync');

const DEFAULT_STALE_STAGE_TIMEOUT_MS = 10 * 60 * 1000;
const WORKFLOW_STOPPED = Symbol('workflow-stopped');
const NEUTRAL_VOICE_STYLE_PROMPT = '请使用自然、清晰、语速稳定的短视频口播风格；避免夸张表演、过长间隔、深呼吸或拖慢语速。';
const EMOTIONAL_VOICE_STYLE_PROMPT = '请使用自然、有情绪起伏的短视频口播风格；关键句加强语气，适度停顿，保持清晰表达，不要过度拖慢语速。';

function supportsEmotionalTtsRuntime(config) {
  const provider = safeString(config?.provider).toLowerCase();
  const providerName = safeString(config?.providerName).toLowerCase();
  const modelId = safeString(config?.modelId).toLowerCase();
  if (['mimo', 'xiaomi', 'xiaomimimo'].includes(provider)
    || ['mimo', 'xiaomi', 'xiaomimimo', '小米 mimo'].includes(providerName)
    || modelId.startsWith('mimo')) {
    return true;
  }
  const isMiniMax = ['minimax', 'minimaxi', 'mini-max'].includes(provider)
    || ['minimax', 'minimaxi', 'mini-max'].includes(providerName);
  return isMiniMax && (modelId === 'speech-2.8-hd' || modelId === 'speech-2.8-turbo');
}

async function resolveVoiceStylePrompt(record, services) {
  if (record?.target?.emotionalVoice !== true) return NEUTRAL_VOICE_STYLE_PROMPT;
  try {
    const config = await services.aiModelConfig.getRuntimeConfig('tts');
    if (supportsEmotionalTtsRuntime(config)) return EMOTIONAL_VOICE_STYLE_PROMPT;
  } catch {}
  return NEUTRAL_VOICE_STYLE_PROMPT;
}

function inferMediaRootFromProjectDir(projectDir, workflowId) {
  const resolvedProjectDir = path.resolve(String(projectDir || ''));
  const marker = `${path.sep}${safeString(workflowId)}${path.sep}agent_runs${path.sep}`;
  const index = resolvedProjectDir.indexOf(marker);
  return index >= 0 ? resolvedProjectDir.slice(0, index) : '';
}

function hasHtmlVideoNarrationReference(project = {}) {
  return Boolean(
    safeString(project.audio?.narration_path)
    || safeString(project.audio?.tts_manifest_path)
  );
}

function htmlVideoAudioDisabled(project = {}) {
  return project.audio?.status === 'skipped'
    && project.audio?.reason === 'disabled_by_settings';
}

async function fileExists(filePath) {
  const resolved = safeString(filePath);
  if (!resolved) return false;
  try {
    const stat = await fsp.stat(resolved);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readHtmlVideoSceneSpec(projectDir) {
  try {
    const sceneSpecPath = htmlVideoProjectStore.resolveProjectPath(projectDir, 'scene-spec.json');
    return JSON.parse(await fsp.readFile(sceneSpecPath, 'utf8'));
  } catch {
    return null;
  }
}

function sceneIdsFromSceneSpec(sceneSpec = {}) {
  const scenes = Array.isArray(sceneSpec?.scenes) ? sceneSpec.scenes : [];
  return scenes.map((scene, index) => safeString(scene?.id) || `scene_${String(index + 1).padStart(2, '0')}`);
}

function sceneSpecFromProjectFrames(project = {}, baseSceneSpec = null) {
  const base = baseSceneSpec && typeof baseSceneSpec === 'object' ? baseSceneSpec : {};
  const baseScenes = Array.isArray(base.scenes) ? base.scenes : [];
  const frames = Array.isArray(project.frames) ? project.frames : [];
  return {
    ...base,
    scenes: frames.map((frame, index) => {
      const id = safeString(frame.scene_id || frame.id) || `scene_${String(index + 1).padStart(2, '0')}`;
      const matched = baseScenes.find(scene => safeString(scene?.id) === id) || {};
      // projectSchema 会把缺失的 frame.narration_text 归一化成空串：空串不算「帧改过旁白」，
      // 回退到 base scene-spec 的文本，避免把旁白只存在 scene-spec 的存量工程整批清空
      const frameNarration = String(frame.narration_text ?? '');
      const useFrameNarration = frame.narration_text_user_edited === true || frameNarration.trim();
      const frameCaptions = Array.isArray(frame.captions) && frame.captions.length ? frame.captions : null;
      return {
        ...matched,
        id,
        duration_sec: Number(frame.duration_sec || matched.duration_sec || matched.duration || 0) || matched.duration_sec,
        narration_text: useFrameNarration ? frameNarration : String(matched.narration_text ?? ''),
        captions: frameCaptions || (Array.isArray(matched.captions) ? matched.captions : frame.captions),
      };
    }),
  };
}

async function restoreHtmlVideoNarrationReference({ project, projectDir } = {}) {
  if (!project || typeof project !== 'object' || htmlVideoAudioDisabled(project) || hasHtmlVideoNarrationReference(project)) {
    return project;
  }
  const runId = safeString(project.run_id);
  if (!runId || !projectDir) return project;

  const candidate = path.join(path.dirname(projectDir), `${runId}-tts.wav`);
  if (!await fileExists(candidate)) return project;

  const sceneSpec = await readHtmlVideoSceneSpec(projectDir);
  const sceneIds = sceneIdsFromSceneSpec(sceneSpec);
  project.audio = {
    ...(project.audio || {}),
    status: 'ready',
    source: 'scene_spec',
    narration_path: candidate,
    tts_manifest_path: null,
    ...(sceneSpec ? {
      scene_spec_hash: computeSceneSpecSpeechHash(sceneSpec),
      scene_count: sceneIds.length,
      scene_ids: sceneIds,
    } : {}),
  };
  return project;
}

function createAuditedWorkflowTextModel(record, textModel) {
  if (!textModel || typeof textModel.callTextModel !== 'function') return textModel;
  return {
    ...textModel,
    callTextModel: async request => {
      const input = request && typeof request === 'object' && !Array.isArray(request) ? request : {};
      const audit = input.audit && typeof input.audit === 'object' && !Array.isArray(input.audit) ? input.audit : {};
      const { audit: _audit, ...forwardRequest } = input;
      const startedAt = Date.now();
      let response;
      let thrownError = null;
      try {
        response = await textModel.callTextModel(forwardRequest);
        return response;
      } catch (error) {
        thrownError = error;
        throw error;
      } finally {
        if (audit.agent && audit.stage) {
          appendWorkflowModelCall(record, {
            ...audit,
            model: response?.model || {},
            usage: response?.usage || {},
            duration_ms: Date.now() - startedAt,
            success: !thrownError && response?.success !== false,
            error: thrownError ? safeString(thrownError.message) : (response?.success === false ? safeString(response?.message || response?.error) : ''),
          });
        }
      }
    },
  };
}

function createAuditedResearchProvider(record, provider, services = {}) {
  if (typeof provider !== 'function') return provider;
  return request => provider({
    ...request,
    aiModelConfig: services.aiModelConfig || aiModelConfig,
    aiTextModel: createAuditedWorkflowTextModel(record, services.aiTextModel || aiTextModel),
    webSearchProvider: services.webSearchProvider,
  });
}

function summarizeVisualRoute(project = {}) {
  const frames = Array.isArray(project.frames) ? project.frames : [];
  const decisions = Array.isArray(project.render_decisions) ? project.render_decisions : [];
  const styleProfile = project.visual_plan?.style_profile || {};
  return {
    total_beats: Array.isArray(project.visual_plan?.beats) ? project.visual_plan.beats.length : frames.length,
    raw_html: frames.filter(frame => frame.source_mode === 'raw_html').length,
    fallback: decisions.filter(decision => decision.fallback_from || decision.fallback_reason).length,
    style_profile_id: styleProfile.id || '',
  };
}

function updateStage(record, stageId, patch = {}) {
  record.stages = normalizeStages(record.stages);
  record.stages = record.stages.map(stage => (
    stage.id === stageId
      ? {
        ...stage,
        id: stageId,
        label: STAGE_LABELS[stageId],
        ...patch,
      }
      : stage
  ));
}

function createWorkflowStoppedSummary(workflowId) {
  return {
    success: false,
    workflow_id: safeString(workflowId),
    status: 'deleted',
    message: '创作任务已停止并删除。',
  };
}

function normalizeFailureResult(normalized, payload = {}) {
  const input = safeString(payload.input);
  if (!input) {
    return {
      ...normalized,
      message: '请输入视频方向、抖音 ID 或抖音链接。',
    };
  }

  if (Array.isArray(payload.assetIds) && payload.assetIds.length > 0) {
    return {
      ...normalized,
      message: '暂不支持手动传入 assetIds，请先移除手动素材后重试。文章/GitHub 链接图片会自动尝试提取。',
    };
  }

  return normalized;
}

function createDouyinSourceContext(input = {}) {
  return {
    status: 'pending',
    kind: 'douyin',
    summary: '',
    transcript: '',
    comments_summary: '',
    douyin_metadata: {
      aweme_id: safeString(input.aweme_id),
      douyin_url: safeString(input.douyin_url),
    },
    diagnostics: {},
  };
}

function createSourceUrlSourceContext(input = {}) {
  const sourceUrl = safeString(input.source_url);
  const ignoredUrlCount = Number(input.ignored_url_count) || 0;
  return {
    status: 'pending',
    kind: 'source_url',
    summary: sourceUrl ? `等待读取外部来源：${sourceUrl}` : '等待读取外部来源。',
    source_url: sourceUrl,
    source_kind: '',
    source_metadata: {
      source_url: sourceUrl,
      user_hint: safeString(input.source_hint),
    },
    diagnostics: {
      ignored_url_count: ignoredUrlCount,
    },
  };
}

// 联网研究 / web 搜索逻辑已抽至 ./creativeResearchProvider
const {
  defaultResearchProvider,
  defaultWebSearchProvider,
  runResearchProvider,
} = require("./creativeResearchProvider");

function resolveServices(options = {}) {
  const services = options.services || {};
  const resolved = {
    ...services,
    researchService: services.researchService || defaultResearchService,
    researchProvider: services.researchProvider || defaultResearchProvider,
    mediaPipeline: services.mediaPipeline || mediaPipeline,
    agentRuns: services.agentRuns || defaultAgentRuns,
    aiModelConfig: services.aiModelConfig || aiModelConfig,
    appSettings: services.appSettings || appSettings,
    ttsService: services.ttsService || defaultCreativeVideoTtsService,
    sourceFetch: services.sourceFetch || defaultSourceFetch,
    sourceAssets: services.sourceAssets || defaultSourceAssets,
  };
  resolved.resumeActions = {
    retryFrameHtml: context => defaultRetryFrameHtmlAction({ ...context, services: resolved }),
    ...plainObject(services.resumeActions),
  };
  return resolved;
}

// 真实 retry 的 continuity 解析——workflow 显式值优先，其次落盘 project 的值，
// 两边都没有时返回 null，交由下游默认 beat_mp4。
function resolveRetryContinuityMode(workflow = {}, project = {}) {
  return {
    continuity_mode: safeString(workflow?.creative_context?.continuity_mode)
      || safeString(project?.continuity_mode)
      || null,
  };
}

async function defaultRetryFrameHtmlAction({ workflow, project, projectDir, mediaRoot, services, taskContext, plan } = {}) {
  const workflowId = safeString(workflow?.workflow_id || workflow?.id || project?.workflow_id);
  const runId = safeString(project?.run_id || project?.runId);
  if (!workflowId || !runId) {
    return {
      success: false,
      message: '缺少 workflowId 或 runId，无法重试失败帧。',
      diagnostics: [createDiagnostic({
        code: 'retry_frame_html_context_invalid',
        sub_stage: 'frame_html',
        user_message: '缺少 workflowId 或 runId，无法重试失败帧。',
        retryable: false,
      })],
    };
  }
  const sceneSpec = extractSceneSpecFromWorkflow(workflow) || project?.scene_spec || null;
  const rootDir = inferMediaRootFromProjectDir(projectDir, workflowId) || safeString(mediaRoot) || DEFAULT_MEDIA_ROOT;
  const target = {
    ...plainObject(project?.generation_checkpoint?.target),
    ...plainObject(project?.target),
    ...plainObject(workflow?.target),
  };
  const executorOptions = plainObject(plan?.executor_options);
  // 计划带定向 frame_ids 时，由 resumeExecutor 定向失效目标帧 checkpoint 驱动重生成；
  // 不再全局禁用复用，避免把未受影响的帧一并重生成
  const scopedFrameIds = Array.isArray(executorOptions.frame_ids)
    ? executorOptions.frame_ids.filter(Boolean)
    : [];
  const regenerateFrameHtml = !scopedFrameIds.length
    && (executorOptions.regenerate_frame_html === true || executorOptions.regenerateFrameHtml === true);
  const workflowService = services.htmlVideoWorkflow || htmlVideoWorkflow;
  return workflowService.generateHtmlVideo({
    workflowId,
    runId,
    rootDir,
    sceneSpec,
    creativeContext: {
      ...plainObject(workflow?.result?.hyperframes_freeform),
      ...resolveRetryContinuityMode(workflow, project),
      asset_context: plainObject(workflow?.creative_context?.asset_context),
      scene_spec: sceneSpec,
      frame_specs: extractFrameSpecsFromWorkflow(workflow),
    },
    target,
    reuseContentGraph: true,
    regenerateFrameHtml,
    projectOptions: {
      reuseContentGraph: true,
      regenerateFrameHtml,
    },
    services: {
      ...services,
      aiTextModel: createAuditedWorkflowTextModel(workflow, services.aiTextModel || aiTextModel),
    },
    onProgress: taskContext?.emit,
  });
}

function buildCreativeDefaultsSnapshot(defaults = {}, creativeDefaultsOverride = {}, payload = {}) {
  const defaultsSource = defaults && typeof defaults === 'object' ? defaults : {};
  const overrideSource = creativeDefaultsOverride && typeof creativeDefaultsOverride === 'object'
    ? creativeDefaultsOverride
    : {};
  const payloadSource = payload && typeof payload === 'object' ? payload : {};

  const aspectRatio = safeString(overrideSource.aspectRatio) || safeString(defaultsSource.aspectRatio);
  const targetDurationSec = Number.isFinite(Number(overrideSource.targetDurationSec))
    ? Number(overrideSource.targetDurationSec)
    : Number(defaultsSource.targetDurationSec);
  const useResearchFromDefaults = defaultsSource.useResearch !== false;
  const useResearch = typeof overrideSource.useResearch === 'boolean'
    ? overrideSource.useResearch
    : (typeof payloadSource.useResearch === 'boolean' ? payloadSource.useResearch : useResearchFromDefaults);
  const frameHtmlConcurrency = Number.isFinite(Number(overrideSource.frameHtmlConcurrency))
    ? Number(overrideSource.frameHtmlConcurrency)
    : Number(defaultsSource.frameHtmlConcurrency);

  return {
    aspectRatio,
    targetDurationSec,
    useResearch,
    generateAudio: typeof overrideSource.generateAudio === 'boolean'
      ? overrideSource.generateAudio
      : defaultsSource.generateAudio !== false,
    autoSfxEnabled: typeof overrideSource.autoSfxEnabled === 'boolean'
      ? overrideSource.autoSfxEnabled
      : defaultsSource.autoSfxEnabled !== false,
    generateCaptions: typeof overrideSource.generateCaptions === 'boolean'
      ? overrideSource.generateCaptions
      : defaultsSource.generateCaptions !== false,
    emotionalVoice: typeof overrideSource.emotionalVoice === 'boolean'
      ? overrideSource.emotionalVoice
      : defaultsSource.emotionalVoice === true,
    sourceImageAnalysisEnabled: typeof overrideSource.sourceImageAnalysisEnabled === 'boolean'
      ? overrideSource.sourceImageAnalysisEnabled
      : defaultsSource.sourceImageAnalysisEnabled === true,
    extractDouyinFrames: typeof overrideSource.extractDouyinFrames === 'boolean'
      ? overrideSource.extractDouyinFrames
      : defaultsSource.extractDouyinFrames === true,
    frameHtmlConcurrency: Number.isFinite(frameHtmlConcurrency)
      ? Math.min(5, Math.max(1, Math.round(frameHtmlConcurrency)))
      : 1,
  };
}

async function validateSourceImageAnalysisConfigIfNeeded(normalizedInput, snapshot, services) {
  if (normalizedInput?.mode !== 'source_url' || snapshot?.sourceImageAnalysisEnabled !== true) {
    return { success: true };
  }

  let runtime = null;
  try {
    runtime = await services.aiModelConfig.getRuntimeConfig('text');
  } catch {}
  if (!runtime || runtime.enabled !== true || !safeString(runtime.modelId) || !safeString(runtime.apiKey) || !safeString(runtime.baseUrl)) {
    return {
      success: false,
      message: '已开启来源图片多模态分析，但当前未配置可用的分析模型。请到设置页配置支持图片输入的分析模型，或关闭该功能后重试。',
    };
  }
  if (runtime.supportsMultimodal !== true) {
    return {
      success: false,
      message: '已开启来源图片多模态分析，但当前分析模型未标记为支持多模态输入。请到设置页勾选“支持多模态输入”，或关闭该功能后重试。',
    };
  }
  return { success: true };
}

function buildWorkflowTarget(snapshot = {}) {
  return {
    aspect_ratio: safeString(snapshot.aspectRatio),
    duration_sec: Number(snapshot.targetDurationSec),
    generateAudio: snapshot.generateAudio !== false,
    autoSfxEnabled: snapshot.autoSfxEnabled !== false,
    generateCaptions: snapshot.generateCaptions !== false,
    emotionalVoice: snapshot.emotionalVoice === true,
    extractDouyinFrames: snapshot.extractDouyinFrames === true,
    frameHtmlConcurrency: Number.isFinite(Number(snapshot.frameHtmlConcurrency))
      ? Math.min(5, Math.max(1, Math.round(Number(snapshot.frameHtmlConcurrency))))
      : 1,
  };
}

function resolveMediaGenerationOptions(defaults = {}, target = {}, options = {}) {
  const source = {
    ...defaults,
    ...(target && typeof target === 'object' ? target : {}),
    ...(options.projectOptions && typeof options.projectOptions === 'object' ? options.projectOptions : {}),
  };
  return {
    generateAudio: source.generateAudio !== false,
    generateCaptions: source.generateCaptions !== false,
  };
}

function mergeProjectOptions(recordTarget = {}, incoming = {}) {
  const target = recordTarget && typeof recordTarget === 'object' ? recordTarget : {};
  const incomingOptions = incoming && typeof incoming === 'object' ? incoming : {};
  return {
    ...target,
    ...incomingOptions,
  };
}

function buildFreeformTargetOptions(target = {}) {
  const durationSec = Number(target.duration_sec ?? target.durationSec ?? target.targetDurationSec ?? target.target_duration_sec);
  const aspectRatio = safeString(target.aspect_ratio || target.aspectRatio);
  return {
    ...(Number.isFinite(durationSec) && durationSec > 0 ? {
      targetDurationSec: durationSec,
      target_duration_sec: durationSec,
    } : {}),
    ...(aspectRatio ? { aspectRatio, aspect_ratio: aspectRatio } : {}),
  };
}

function createWorkflowSummary(record) {
  return {
    success: record.success !== false,
    workflow_id: record.workflow_id,
    aweme_id: record.aweme_id,
    status: record.status,
    run_id: record.run_id || '',
    message: record.message || '',
    active_task_id: record.active_task_id || '',
    active_operation_id: record.active_operation_id || '',
    active_task: record.active_task || null,
    task_status: record.task_status || '',
    current_stage: record.current_stage || '',
    current_stage_message: record.current_stage_message || '',
    current_progress: Number.isFinite(record.current_progress) ? record.current_progress : 0,
    last_event_seq: Number.isFinite(record.last_event_seq) ? record.last_event_seq : 0,
    stages: normalizeStages(record.stages),
    creative_context: record.creative_context,
    source_context: record.source_context,
    research_context: record.research_context,
    asset_context: record.asset_context,
    result: record.result,
    error: record.error,
    last_failure: record.last_failure || null,
    project_substages: Array.isArray(record.project_substages) ? record.project_substages : [],
  };
}

async function createCreativeWorkflow(payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const services = resolveServices(options);
  const now = getNow(services);
  const creativeDefaults = await services.appSettings.getCreativeDefaults(options);
  const snapshot = buildCreativeDefaultsSnapshot(
    creativeDefaults,
    payload && typeof payload === 'object' ? payload.creativeDefaultsOverride : {},
    payload,
  );
  const effectivePayload = {
    ...(payload || {}),
    useResearch: snapshot.useResearch,
  };
  const normalized = await creativeContext.normalizeCreativeInputWithDouyinShortLink(effectivePayload, {
    fetchImpl: services.fetchImpl,
  });
  if (!normalized.success) {
    return normalizeFailureResult(normalized, effectivePayload);
  }
  const sourceImageAnalysisConfig = await validateSourceImageAnalysisConfigIfNeeded(normalized.data, snapshot, services);
  if (!sourceImageAnalysisConfig.success) return sourceImageAnalysisConfig;
  const effectiveSystemSettings = await services.appSettings.getEffectiveSystemSettings(options);

  const workflowId = safeString(typeof services.idFactory === 'function' ? services.idFactory() : makeId(now));
  const awemeId = normalized.data.mode === 'douyin'
    ? normalized.data.aweme_id
    : makeLocalCreativeAwemeId(workflowId);
  let sourceContext;
  if (normalized.data.mode === 'douyin') {
    sourceContext = createDouyinSourceContext(normalized.data);
  } else if (normalized.data.mode === 'source_url') {
    sourceContext = createSourceUrlSourceContext(normalized.data);
  } else {
    sourceContext = creativeContext.createTextSourceContext(normalized.data.raw_text);
  }
  const researchQuery = normalized.data.raw_text || normalized.data.aweme_id;
  const researchContext = normalized.data.use_research
    ? creativeContext.createPendingResearchContext({ query: researchQuery, now })
    : creativeContext.createDisabledResearchContext({ now });
  const assetContext = creativeContext.createDisabledAssetContext({ now });
  const creative = creativeContext.buildCreativeContext({
    input: normalized.data,
    sourceContext,
    researchContext,
    assetContext,
    now,
  });
  const stages = createStages();
  const sourceStage = stages.find(stage => stage.id === 'source');
  sourceStage.status = 'queued';
  sourceStage.message = '来源资料已进入准备队列。';

  const record = {
    success: true,
    workflow_id: workflowId,
    aweme_id: awemeId,
    status: 'queued',
    message: '创作任务已创建，等待执行。',
    run_id: '',
    active_task_id: '',
    active_operation_id: '',
    task_status: '',
    current_stage: '',
    current_stage_message: '',
    current_progress: 0,
    last_event_seq: 0,
    input: normalized.data,
    source_context: sourceContext,
    research_context: researchContext,
    asset_context: assetContext,
    creative_context: creative,
    stages,
    result: null,
    error: null,
    creative_defaults_snapshot: snapshot,
    target: buildWorkflowTarget(snapshot),
    skipValidation: normalized.data.skip_validation === true || effectiveSystemSettings.skipValidation === true,
    created_at: now,
    updated_at: now,
  };

  const persisted = await persistWorkflow(record, rootDir);
  return createWorkflowSummary(persisted);
}

function isHtmlVideoLiteProjectResult(result) {
  const hyperframes = result?.hyperframes_freeform || {};
  const project = hyperframes.project || {};
  return project.render_mode === 'html-video'
    && Boolean(project.html_video_project_path)
    && hyperframes.render?.status === 'rendered';
}

async function markStage(record, stageId, status, message, now, extra = {}) {
  updateStage(record, stageId, {
    status,
    message: safeString(message),
    updated_at: now,
    ...extra,
  });
}

async function markHtmlVideoLiteFinalStages(record, now, projectStageResult = {}) {
  const hyperframes = projectStageResult.hyperframes_freeform || {};
  await markStage(record, 'check', 'skipped', 'html-video production 已完成，跳过旧 HyperFrames 工程校验。', now, {
    skipped_at: now,
  });
  await markStage(record, 'render', 'done', hyperframes.render?.message || 'html-video production 成片已导出。', now, {
    completed_at: now,
    result: {
      success: true,
      render: hyperframes.render || null,
    },
  });
  await markStage(record, 'inspect', 'done', hyperframes.visual_inspect?.message || 'html-video production 视觉质检通过。', now, {
    completed_at: now,
    result: {
      success: true,
      visual_inspect: hyperframes.visual_inspect || null,
    },
  });
}

async function runStage(record, stageId, rootDir, handler, services, taskContext = null) {
  if (!await workflowFileExists(record.workflow_id, rootDir)) {
    return WORKFLOW_STOPPED;
  }

  const startedAt = getNow(services);
  await markStage(record, stageId, 'running', `正在${STAGE_LABELS[stageId]}...`, startedAt, {
    started_at: startedAt,
  });
  record.status = 'running';
  record.updated_at = startedAt;
  await persistWorkflow(record, rootDir);
  await emitTaskContextEvent(taskContext, {
    type: 'stage_started',
    stage: stageId,
    stage_progress: 0,
    message: `正在${STAGE_LABELS[stageId]}...`,
  });

  try {
    const reportStage = (message, progress = 50, data = {}) => emitTaskContextEvent(
      taskContext,
      {
        type: 'stage_progress',
        stage: stageId,
        stage_progress: progress,
        message,
        data,
      },
    );
    const result = await handler({ reportStage, taskContext });
    if (!await workflowFileExists(record.workflow_id, rootDir)) {
      return WORKFLOW_STOPPED;
    }

    const completedAt = getNow(services);
    if (stageId === 'project') {
      await syncProjectStageSummariesFromProjectDir(
        record,
        projectPathFromStageResult(result),
        { mediaRoot: services.mediaRoot },
      );
      if (result?.project?.generation_checkpoint) {
        syncProjectStageSummariesFromCheckpoint(record, result.project.generation_checkpoint);
      }
    }
    await markStage(record, stageId, 'done', result?.message || `${STAGE_LABELS[stageId]}完成。`, completedAt, {
      completed_at: completedAt,
      result,
    });
    record.updated_at = completedAt;
    await persistWorkflow(record, rootDir);
    await emitTaskContextEvent(taskContext, {
      type: 'stage_done',
      stage: stageId,
      stage_progress: 100,
      message: result?.message || `${STAGE_LABELS[stageId]}完成。`,
    });
    return result;
  } catch (error) {
    if (!await workflowFileExists(record.workflow_id, rootDir)) {
      return WORKFLOW_STOPPED;
    }

    const failedAt = getNow(services);
    const message = safeString(error && error.message) || `${STAGE_LABELS[stageId]}失败。`;
    await markStage(record, stageId, 'failed', message, failedAt, {
      failed_at: failedAt,
    });
    record.success = false;
    record.status = 'failed';
    record.message = message;
    record.error = {
      stage: stageId,
      message,
      updated_at: failedAt,
    };
    if (error?.name === 'CreativeWorkflowStageError') {
      record.last_failure = createLastFailureFromError(error, stageId, failedAt);
      await syncProjectStageSummariesFromProjectDir(record, record.last_failure.project_dir, { mediaRoot: services.mediaRoot });
    }
    record.updated_at = failedAt;
    await persistWorkflow(record, rootDir);
    await emitTaskContextEvent(taskContext, {
      type: 'stage_failed',
      stage: stageId,
      stage_progress: 100,
      message,
      data: { error: message },
    });
    return null;
  }
}

async function runCreativeWorkflow(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const mediaRoot = options.mediaRoot || DEFAULT_MEDIA_ROOT;
  const services = { ...resolveServices(options), mediaRoot };
  const taskContext = options.taskContext || null;
  let record;
  try {
    record = await readWorkflow(workflowId, rootDir);
  } catch (error) {
    return {
      success: false,
      workflow_id: safeString(workflowId),
      message: '未找到创作任务。',
    };
  }

  if (options.skipValidation === undefined && record.skipValidation === true) {
    options = { ...options, skipValidation: true };
  }

  const creativeDefaultsSnapshot = record.creative_defaults_snapshot && typeof record.creative_defaults_snapshot === 'object'
    ? record.creative_defaults_snapshot
    : null;
  let creativeDefaultsForMedia = creativeDefaultsSnapshot;
  if (
    !creativeDefaultsForMedia
    || typeof creativeDefaultsForMedia.generateAudio !== 'boolean'
    || typeof creativeDefaultsForMedia.generateCaptions !== 'boolean'
  ) {
    const realtimeCreativeDefaults = await services.appSettings.getCreativeDefaults(options);
    creativeDefaultsForMedia = {
      ...(realtimeCreativeDefaults && typeof realtimeCreativeDefaults === 'object' ? realtimeCreativeDefaults : {}),
      ...(creativeDefaultsSnapshot || {}),
    };
  }
  const mediaOptions = resolveMediaGenerationOptions(
    creativeDefaultsForMedia,
    record.target,
    options,
  );

  const failIfStoppedOrNull = result => {
    if (result === WORKFLOW_STOPPED) {
      return createWorkflowStoppedSummary(workflowId);
    }
    if (result === null) {
      return createWorkflowSummary(record);
    }
    return null;
  };

  let stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'source', rootDir, async ({ reportStage }) => (
    ensureSuccess(await prepareSource(record, mediaRoot, getNow(services), services, reportStage), '来源资料准备失败。')
  ), services, taskContext));
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'research', rootDir, async ({ reportStage }) => {
    const inputContext = record.creative_context?.input || record.input || {};
    const useResearch = inputContext.use_research === true;
    const query = inputContext.raw_text || inputContext.aweme_id || record.research_context?.query || '';
    await reportStage(useResearch ? '正在联网研究最新资料...' : '联网研究已关闭，继续下一步。', 20);
    const nextResearchContext = await services.researchService.createResearchContext({
      enabled: useResearch,
      query,
      now: getNow(services),
      provider: createAuditedResearchProvider(record, services.researchProvider, services),
    });
    record.research_context = nextResearchContext;
    record.creative_context = {
      ...(record.creative_context || {}),
      research_context: nextResearchContext,
    };
    if (nextResearchContext?.status === 'failed') {
      throw new Error(nextResearchContext.summary || '联网研究失败。');
    }
    return {
      success: true,
      message: nextResearchContext?.status === 'disabled'
        ? '联网研究已关闭，继续下一步。'
        : '联网研究资料已准备完成。',
      research_context: nextResearchContext,
    };
  }, services, taskContext));
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'assets', rootDir, async ({ reportStage }) => (
    ensureSuccess(
      await prepareSourceAssetContext(record, mediaRoot, getNow(services), services, reportStage),
      '图片素材准备失败。',
    )
  ), services, taskContext));
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'agent_run', rootDir, async () => {
    const result = ensureSuccess(
      await services.agentRuns.createDouyinHyperframesFreeformRun(record.aweme_id, {
        rootDir: mediaRoot,
        ...buildFreeformTargetOptions(record.target),
      }),
      '导演改写任务创建失败。',
    );
    record.run_id = safeString(result.run_id);
    if (!record.run_id) {
      throw new Error('导演改写任务未返回 run_id。');
    }
    return result;
  }, services, taskContext));
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'brief', rootDir, async () => ensureSuccess(
    await services.agentRuns.generateDouyinRunHyperframesFreeformBrief(record.aweme_id, record.run_id, {
      rootDir: mediaRoot,
      briefOptions: {
        ...buildFreeformTargetOptions(record.target),
        creative_context: record.creative_context,
      },
    }),
    '成片策划失败。',
  ), services, taskContext));
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'audio', rootDir, async () => {
    if (mediaOptions.generateAudio === false) {
      return {
        success: true,
        skipped: true,
        message: '已关闭旁白音频生成，跳过 TTS。',
        audio: {
          status: 'skipped',
          reason: 'disabled_by_settings',
        },
      };
    }
    const stylePrompt = await resolveVoiceStylePrompt(record, services);
    return ensureSuccess(
      await services.agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(record.aweme_id, record.run_id, {
        rootDir: mediaRoot,
        ...buildFreeformTargetOptions(record.target),
        stylePrompt,
      }),
      '音频轨生成失败。',
    );
  }, services, taskContext));
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  let skipValidation = options.skipValidation === true || record.skipValidation === true;
  if (!skipValidation && typeof record.skipValidation !== 'boolean') {
    try {
      const effectiveSystemSettings = await services.appSettings.getEffectiveSystemSettings(options);
      skipValidation = effectiveSystemSettings.skipValidation === true;
    } catch {}
  }
  const existingProjectOptions = {
    ...(options.projectOptions && typeof options.projectOptions === 'object' ? options.projectOptions : {}),
    creative_context: record.creative_context,
    generateAudio: mediaOptions.generateAudio,
    generateCaptions: mediaOptions.generateCaptions,
  };

  const projectStageResult = await runStage(record, 'project', rootDir, async () => {
    const result = ensureSuccess(
      await services.agentRuns.generateDouyinRunHyperframesFreeformProject(record.aweme_id, record.run_id, {
        workflowId: record.workflow_id,
        rootDir: mediaRoot,
        useHtmlVideoLiteWorkflow: true,
        skipValidation,
        onProgress: async event => {
          await emitTaskContextEvent(taskContext, {
            ...event,
            type: event?.type || 'stage_progress',
            stage: 'project',
            message: event?.message || '正在生成 html-video 工程...',
          });
        },
        projectOptions: mergeProjectOptions(record.target, existingProjectOptions),
      }),
      '工程生成失败。',
      { stage: 'project', sub_stage: 'project', code: 'html_video_project_failed' },
    );
    if (!isHtmlVideoLiteProjectResult(result)) {
      throw new CreativeWorkflowStageError('html-video production 未返回可用工程。', {
        stage: 'project',
        sub_stage: 'project',
        code: 'html_video_project_missing',
        project_dir: projectPathFromStageResult(result),
      });
    }
    result.hyperframes_freeform.project.visual_route_summary = summarizeVisualRoute(result.hyperframes_freeform.project);
    return result;
  }, services, taskContext);
  stoppedOrFailed = failIfStoppedOrNull(projectStageResult);
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  const doneAt = getNow(services);
  await markHtmlVideoLiteFinalStages(record, doneAt, projectStageResult);
  record.success = true;
  record.status = 'done';
  record.message = '创作任务已完成。';
  record.result = { hyperframes_freeform: projectStageResult.hyperframes_freeform };
  record.error = null;
  record.updated_at = doneAt;
  await syncProjectStageSummariesFromProjectDir(record, extractHtmlVideoProjectPathFromWorkflow(record), { mediaRoot });
  const persisted = await persistWorkflow(record, rootDir);
  return createWorkflowSummary(persisted);
}

async function getCreativeWorkflow(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const mediaRoot = options.mediaRoot || DEFAULT_MEDIA_ROOT;
  const services = resolveServices(options);
  try {
    const record = await readWorkflow(workflowId, rootDir);
    const nextRecord = await markStaleRunningStageFailed(record, rootDir, services, options);
    const beforeHydrate = assetHydrationFingerprint(nextRecord);
    await syncProjectStageSummariesFromProjectDir(nextRecord, extractHtmlVideoProjectPathFromWorkflow(nextRecord), { mediaRoot });
    const afterHydrate = assetHydrationFingerprint(nextRecord);
    if (afterHydrate !== beforeHydrate) {
      nextRecord.updated_at = getNow(services);
      await persistWorkflow(nextRecord, rootDir);
    }
    return {
      success: true,
      data: await enrichWorkflowVideoUrls(nextRecord),
    };
  } catch (error) {
    return {
      success: false,
      workflow_id: safeString(workflowId),
      message: '未找到创作任务。',
    };
  }
}

function resolveTaskRegistry(rootDir, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'taskRegistry')) {
    return options.taskRegistry;
  }
  return isDefaultWorkflowRoot(rootDir) ? defaultCreativeTaskRegistry : null;
}

function findStaleRunningStage(record, nowMs, timeoutMs) {
  if (record?.status !== 'running') return null;
  const stages = normalizeStages(record.stages);
  return stages.find(stage => {
    if (stage.status !== 'running') return false;
    const stageTime = parseDateMs(stage.updated_at || stage.started_at || record.updated_at);
    return stageTime > 0 && nowMs - stageTime > timeoutMs;
  }) || null;
}

async function markStaleRunningStageFailed(record, rootDir, services = {}, options = {}) {
  const timeoutMs = Number(options.staleStageTimeoutMs) || DEFAULT_STALE_STAGE_TIMEOUT_MS;
  const now = getNow(services);
  const nowMs = parseDateMs(now) || Date.now();
  const taskRegistry = resolveTaskRegistry(rootDir, options);
  const activeTask = taskRegistry?.activeTaskForWorkflow?.(record.workflow_id);
  if (activeTask && activeTask.status === 'running') {
    record.active_task = activeTask;
    return record;
  }
  const stage = findStaleRunningStage(record, nowMs, timeoutMs);
  if (!stage) return record;

  const message = `${stage.label || STAGE_LABELS[stage.id] || '当前阶段'}长时间未更新，后台任务可能已中断，请重新创建任务或稍后重试。`;
  await markStage(record, stage.id, 'failed', message, now, {
    failed_at: now,
    stale: true,
  });
  record.success = false;
  record.status = 'failed';
  record.message = message;
  record.error = {
    stage: stage.id,
    message,
    updated_at: now,
    stale: true,
  };
  record.updated_at = now;
  return persistWorkflow(record, rootDir);
}

async function patchCreativeWorkflowTaskSummary(workflowId, patch = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const workflowPath = getWorkflowPath(workflowId, rootDir);
  return withWorkflowFileQueue(workflowPath, () => patchCreativeWorkflowTaskSummaryUnlocked(workflowId, patch, options, rootDir, workflowPath));
}

async function patchCreativeWorkflowTaskSummaryUnlocked(workflowId, patch = {}, options = {}, rootDir = DEFAULT_ROOT, workflowPath = getWorkflowPath(workflowId, rootDir)) {
  try {
    const record = await readWorkflow(workflowId, rootDir);
    const now = safeString(patch.updated_at) || getNow(resolveServices(options)) || new Date().toISOString();
    const seq = Number(patch.last_event_seq ?? record.last_event_seq);
    if (Number.isFinite(seq) && seq > 0 && Number(record.last_event_seq) > seq) {
      return { success: true, workflow_id: record.workflow_id, data: record };
    }
    record.active_task_id = safeString(patch.active_task_id ?? record.active_task_id);
    record.active_operation_id = safeString(patch.active_operation_id ?? record.active_operation_id);
    if (Object.prototype.hasOwnProperty.call(patch, 'operation')) record.operation = safeString(patch.operation);
    if (Object.prototype.hasOwnProperty.call(patch, 'retry_attempt_id')) record.retry_attempt_id = safeString(patch.retry_attempt_id);
    record.task_status = safeString(patch.task_status ?? record.task_status);
    if (safeString(patch.active_project_dir)) record.active_project_dir = safeString(patch.active_project_dir);
    record.current_stage = safeString(patch.current_stage ?? record.current_stage);
    record.current_stage_message = safeString(patch.current_stage_message ?? record.current_stage_message);
    const progress = Number(patch.current_progress ?? record.current_progress);
    record.current_progress = Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : 0;
    record.last_event_seq = Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : 0;
    if (record.task_status === 'running' && record.current_stage) {
      const stageMessage = record.current_stage_message || `正在${STAGE_LABELS[record.current_stage] || '处理当前阶段'}...`;
      updateStage(record, record.current_stage, {
        status: 'running',
        message: stageMessage,
        updated_at: now,
        started_at: normalizeStages(record.stages).find(stage => stage.id === record.current_stage)?.started_at || now,
      });
    }
    if (patch.fail_running_stages === true) {
      const failedStageMessage = safeString(patch.message || patch.current_stage_message)
        || '服务器重启，后台创作任务被中断，请重新创建任务。';
      record.stages = normalizeStages(record.stages).map(stage => (
        stage.status === 'running'
          ? {
            ...stage,
            status: 'failed',
            message: failedStageMessage,
            updated_at: now,
            failed_at: now,
            stale: true,
            reason: 'server_restart',
          }
          : stage
      ));
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'success')) record.success = patch.success !== false;
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) record.status = safeString(patch.status);
    if (Object.prototype.hasOwnProperty.call(patch, 'message')) record.message = safeString(patch.message);
    if (Object.prototype.hasOwnProperty.call(patch, 'error')) record.error = patch.error || null;
    record.updated_at = now;
    const persisted = await persistWorkflowUnlocked(record, rootDir, workflowPath);
    return { success: true, workflow_id: record.workflow_id, data: persisted };
  } catch (error) {
    return { success: false, workflow_id: safeString(workflowId), message: `更新创作任务进度失败：${error.message}` };
  }
}

async function clearCreativeWorkflowTaskSummary(workflowId, options = {}) {
  return patchCreativeWorkflowTaskSummary(workflowId, {
    active_task_id: '',
    active_operation_id: '',
    task_status: '',
    current_stage: '',
    current_stage_message: '',
    current_progress: 0,
    last_event_seq: 0,
  }, options);
}

async function listCreativeWorkflowRecords(options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  let files;
  try { files = await fsp.readdir(rootDir); } catch { return []; }
  const records = [];
  for (const file of files.filter(name => WORKFLOW_ID_PATTERN.test(path.basename(name, '.json')) && name.endsWith('.json'))) {
    try { records.push(await readJson(path.join(rootDir, file))); } catch {}
  }
  return records;
}

async function deleteCreativeWorkflow(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const mediaRoot = options.mediaRoot || DEFAULT_MEDIA_ROOT;
  const id = safeString(workflowId);

  if (!WORKFLOW_ID_PATTERN.test(id)) {
    return { success: false, workflow_id: id, message: '创作任务 ID 无效。' };
  }

  const workflowPath = getWorkflowPath(id, rootDir);
  const mediaDir = path.resolve(mediaRoot, id);
  const deleted = { workflow: false, media: false };

  try {
    await fsp.unlink(workflowPath);
    deleted.workflow = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return { success: false, workflow_id: id, message: `删除创作任务文件失败：${error.message}` };
    }
  }

  try {
    await fsp.rm(mediaDir, { recursive: true, force: true });
    deleted.media = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return { success: false, workflow_id: id, message: `删除媒体文件失败：${error.message}` };
    }
  }

  if (!deleted.workflow && !deleted.media) {
    return { success: false, workflow_id: id, message: '未找到创作任务。' };
  }

  return { success: true, workflow_id: id, message: '创作任务已删除。' };
}

async function recoverStaleWorkflowsOnStartup(services = {}) {
  const rootDir = DEFAULT_ROOT;
  let files;
  try { files = await fsp.readdir(rootDir); } catch { return; }
  files = files.filter(f => f.endsWith('.json'));

  const now = getNow(services);
  const nowMs = parseDateMs(now) || Date.now();
  let recovered = 0;

  for (const file of files) {
    const filePath = path.join(rootDir, file);
    let record;
    try { record = await readJson(filePath); } catch { continue; }
    if (!record) continue;
    record.stages = normalizeStages(record.stages);

    // 处理 running 状态：有阶段卡在 running
    const staleStage = findStaleRunningStage(record, nowMs, 0);
    if (staleStage) {
      const label = staleStage.label || STAGE_LABELS[staleStage.id] || '当前阶段';
      const message = `服务器重启，${label}被中断，请重新创建任务。`;
      await markStage(record, staleStage.id, 'failed', message, now, {
        failed_at: now, stale: true,
      });
      record.success = false;
      record.status = 'failed';
      record.message = message;
      record.error = { stage: staleStage.id, message, updated_at: now, stale: true };
      record.updated_at = now;
      await persistWorkflow(record, rootDir);
      recovered++;
      console.log(`[startup] 已清理卡死的工作流: ${record.workflow_id} (${label})`);
      continue;
    }

    // 处理 queued 状态：工作流已创建但从未开始执行
    if (record.status === 'queued') {
      const createdMs = parseDateMs(record.created_at);
      if (createdMs > 0 && nowMs - createdMs > 60_000) {
        record.success = false;
        record.status = 'failed';
        record.message = '服务器重启，任务未开始执行，请重新创建。';
        record.error = { stage: 'source', message: record.message, updated_at: now, stale: true };
        record.updated_at = now;
        await persistWorkflow(record, rootDir);
        recovered++;
        console.log(`[startup] 已清理未执行的工作流: ${record.workflow_id}`);
      }
    }
  }

  if (recovered > 0) console.log(`[startup] 共清理 ${recovered} 个卡死的工作流`);
}

function extractSceneSpecFromWorkflow(record) {
  const hyperframes = record?.result?.hyperframes_freeform;
  if (!hyperframes || !hyperframes.project || !hyperframes.project.scene_spec) {
    return null;
  }
  return hyperframes.project.scene_spec;
}

function extractFrameSpecsFromWorkflow(record) {
  const frameSpecs = record?.result?.hyperframes_freeform?.project?.frame_specs;
  if (!frameSpecs || typeof frameSpecs !== 'object' || Array.isArray(frameSpecs)) {
    return { frames: [] };
  }
  return frameSpecs;
}

async function getCreativeWorkflowRetryPlan(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { record, project, projectDir, error } = await readWorkflowAndHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const plan = retryPlanner.createCreativeWorkflowRetryPlan({
    workflow: record,
    project,
    project_dir: projectDir,
  });
  return {
    success: true,
    workflow_id: safeString(workflowId),
    project_dir: projectDir,
    plan,
  };
}

async function refreshCreativeWorkflowRetryPlan(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const services = options.services || {};
  const { record, project, projectDir, error } = await readWorkflowAndHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const plan = retryPlanner.createCreativeWorkflowRetryPlan({
    workflow: record,
    project,
    project_dir: projectDir,
  });
  record.retry = {
    ...(record.retry || {}),
    version: 1,
    attempts: Array.isArray(record.retry?.attempts) ? record.retry.attempts : [],
    latest_plan: plan,
  };
  record.updated_at = getNow(services);
  await persistWorkflow(record, rootDir);
  return {
    success: true,
    workflow_id: safeString(workflowId),
    project_dir: projectDir,
    plan,
  };
}

function makeRetryAttemptId(now) {
  const stamp = safeString(now).replace(/\D/g, '').slice(0, 14)
    || new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `retry_${stamp}`;
}

// P1-6：视觉质检 warnings（观测通道）非阻断透出到 retry 汇总，
// 摘要逻辑收敛到共享模块 visualQaCodes（details 只保留定位字段控制体积）。
const { summarizeVisualQaWarnings: summarizeVisualQaWarningsForStage } = require('../creative-video/visualQaCodes');

function buildHtmlVideoLiteProjectStageResult({ project, projectDir, renderResult, visualInspectResult } = {}) {
  const outputPath = safeString(renderResult?.output_path || renderResult?.outputPath);
  const inspectStatus = visualInspectResult?.skipped === true
    ? 'skipped'
    : (visualInspectResult?.success === false ? 'warning' : 'done');
  const inspectWarnings = summarizeVisualQaWarningsForStage(visualInspectResult?.warnings);
  const baseInspectMessage = safeString(visualInspectResult?.message)
    || (inspectStatus === 'warning' ? 'html-video production 视觉质检发现问题。' : 'html-video production 视觉质检完成。');
  // warnings 非阻断：status 不降级，但 message 带上告警条数，避免用户只看到"质检完成"
  const inspectMessage = inspectWarnings.length && inspectStatus === 'done'
    ? `${baseInspectMessage.replace(/。$/, '')}（${inspectWarnings.length} 条观察告警）。`
    : baseInspectMessage;
  return {
    hyperframes_freeform: {
      project: {
        render_mode: 'html-video',
        html_video_project_path: projectDir,
        project_dir: projectDir,
        ...(project?.asset_usage_report ? { asset_usage_report: project.asset_usage_report } : {}),
        ...(project && typeof project === 'object' ? { visual_route_summary: summarizeVisualRoute(project) } : {}),
      },
      render: {
        status: 'rendered',
        message: 'html-video production 成片已导出。',
        output_path: outputPath,
        project_status: project?.status || '',
      },
      visual_inspect: {
        status: inspectStatus,
        message: inspectMessage,
        report_path: visualInspectResult?.report_path || visualInspectResult?.reportPath || null,
        issues: Array.isArray(visualInspectResult?.issues) ? visualInspectResult.issues : [],
        warnings: inspectWarnings,
        metrics: plainObject(visualInspectResult?.metrics),
      },
    },
  };
}

function createLastFailureFromRetryResult(result = {}, projectDir = '', updatedAt = '') {
  const diagnostics = normalizeDiagnostics(result.diagnostics || result.html_video_diagnostics || []);
  const failureDiagnostic = selectFailureDiagnostic(diagnostics);
  return {
    stage: 'project',
    sub_stage: safeString(failureDiagnostic.sub_stage || result.sub_stage),
    code: safeString(failureDiagnostic.code || result.code || 'retry_failed'),
    frame_id: safeString(failureDiagnostic.frame_id || result.frame_id),
    project_dir: safeString(result.project_dir || result.html_video_project_path || projectDir),
    message: safeString(result.message) || safeString(failureDiagnostic.user_message) || '恢复重试失败。',
    diagnostics,
    updated_at: updatedAt,
  };
}

async function retryCreativeWorkflow(workflowId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const mediaRoot = options.mediaRoot || DEFAULT_MEDIA_ROOT;
  const services = resolveServices(options);
  const mode = safeString(payload.mode);
  if (mode !== 'repair_and_resume') {
    return {
      success: false,
      workflow_id: safeString(workflowId),
      code: 'RETRY_MODE_UNSUPPORTED',
      message: 'V1 仅支持 repair_and_resume 恢复模式。',
    };
  }

  const refreshed = await refreshCreativeWorkflowRetryPlan(workflowId, { rootDir, services });
  if (!refreshed.success) return refreshed;
  const plan = refreshed.plan;
  if (safeString(payload.confirm_plan_code) !== safeString(plan.code)) {
    return {
      success: false,
      workflow_id: safeString(workflowId),
      code: 'RETRY_PLAN_CODE_CHANGED',
      plan,
      message: '恢复计划已变化，请确认最新建议后再重试。',
    };
  }
  if (plan.can_retry !== true) {
    return {
      success: false,
      workflow_id: safeString(workflowId),
      code: plan.code || 'RETRY_NOT_ALLOWED',
      plan,
      message: plan.user_message || '当前任务无法自动重试。',
    };
  }

  const loaded = await readWorkflowAndHtmlVideoProject(workflowId, rootDir);
  if (loaded.error) return loaded.error;
  const record = loaded.record;
  const projectDir = loaded.projectDir || refreshed.project_dir;
  const now = getNow(services);
  const attempt = {
    id: safeString(options.retryAttemptId) || makeRetryAttemptId(now),
    created_at: now,
    mode,
    reason_code: plan.code,
    retry_from: plan.retry_from,
    repair_action: plan.repair_action,
    reuse: Array.isArray(plan.reuse) ? plan.reuse : [],
    discard: Array.isArray(plan.discard) ? plan.discard : [],
    status: 'running',
    message: plan.user_message || '正在修复并重试。',
    previous_failure: record.last_failure || null,
  };
  record.retry = {
    ...(record.retry || {}),
    version: 1,
    attempts: [...(Array.isArray(record.retry?.attempts) ? record.retry.attempts : []), attempt],
    latest_plan: plan,
  };
  record.status = 'running';
  record.success = false;
  record.message = '正在修复并重试。';
  record.updated_at = now;
  await persistWorkflow(record, rootDir);

  let execution;
  try {
    execution = await resumeExecutor.executeCreativeWorkflowRetryPlan({
      workflowId: safeString(workflowId),
      workflow: record,
      projectDir,
      plan,
      rootDir,
      mediaRoot,
      services,
      taskContext: options.taskContext,
    });
  } catch (error) {
    execution = {
      success: false,
      message: error.message || '恢复重试失败。',
      project_dir: projectDir,
      diagnostics: [createDiagnostic({
        code: 'retry_executor_failed',
        sub_stage: plan.retry_from || plan.repair_action,
        user_message: error.message || '恢复重试失败。',
        retryable: true,
        repair_action: plan.repair_action,
      })],
    };
  }

  const finishedAt = getNow(services);
  const latestProject = execution.project || await htmlVideoProjectStore.loadProject(projectDir).catch(() => null);
  if (latestProject?.generation_checkpoint) {
    syncProjectStageSummariesFromCheckpoint(record, latestProject.generation_checkpoint);
  }

  if (execution.success) {
    attempt.status = 'done';
    attempt.message = execution.message || '恢复重试已完成。';
    attempt.completed_at = finishedAt;
    const projectStageResult = buildHtmlVideoLiteProjectStageResult({
      project: latestProject,
      projectDir,
      renderResult: execution.renderResult || execution,
      // 默认 retryFrameHtml 动作直接返回 generateHtmlVideo 结果（字段名 visual_report），
      // resumeExecutor 自身路径返回 visualInspectResult——两个字段名都要读，避免 warnings/issues 丢失
      visualInspectResult: execution.visualInspectResult || execution.visual_report,
    });
    record.result = record.result || {};
    const existingHyperframes = record.result.hyperframes_freeform || {};
    const nextHyperframes = projectStageResult.hyperframes_freeform || {};
    record.result.hyperframes_freeform = {
      ...existingHyperframes,
      ...nextHyperframes,
      project: {
        ...(existingHyperframes.project || {}),
        ...(nextHyperframes.project || {}),
      },
    };
    applyAssetUsageReportToRecord(record, buildProjectAssetUsageReport(latestProject, projectDir, record));
    await markStage(record, 'project', 'done', 'html-video 工程已恢复。', finishedAt, {
      completed_at: finishedAt,
      result: { success: true, project: projectStageResult.hyperframes_freeform.project },
    });
    await markHtmlVideoLiteFinalStages(record, finishedAt, projectStageResult);
    record.success = true;
    record.status = 'done';
    record.message = '创作任务已修复并完成。';
    record.error = null;
    record.last_failure = null;
    record.current_progress = 100;
    record.updated_at = finishedAt;
    const persisted = await persistWorkflow(record, rootDir);
    return {
      success: true,
      workflow_id: safeString(workflowId),
      retry_attempt_id: attempt.id,
      data: persisted,
      output_path: execution.output_path || execution.outputPath || null,
      output_url: execution.output_url || execution.outputUrl || null,
      message: record.message,
    };
  }

  attempt.status = 'failed';
  attempt.message = execution.message || '恢复重试失败。';
  attempt.failed_at = finishedAt;
  record.last_failure = createLastFailureFromRetryResult(execution, projectDir, finishedAt);
  record.success = false;
  record.status = 'failed';
  record.message = record.last_failure.message;
  record.error = {
    stage: 'project',
    sub_stage: record.last_failure.sub_stage,
    code: record.last_failure.code,
    message: record.last_failure.message,
    updated_at: finishedAt,
  };
  record.updated_at = finishedAt;
  const persisted = await persistWorkflow(record, rootDir);
  return {
    success: false,
    workflow_id: safeString(workflowId),
    retry_attempt_id: attempt.id,
    data: persisted,
    message: record.message,
    diagnostics: record.last_failure.diagnostics,
  };
}

async function getCreativeWorkflowHtmlVideoProject(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  return {
    success: true,
    workflow_id: workflowId,
    html_video_project: project,
    html_video_project_path: projectDir,
  };
}

async function attachSavedHtmlVideoProject(result, workflowId, planId, projectDir, project) {
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return {
    ...result,
    workflow_id: workflowId,
    plan_id: result.plan_id || planId,
    html_video_project: saved,
    html_video_project_path: projectDir,
  };
}

async function patchCreativeWorkflowHtmlVideoProject(workflowId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;

  const patcher = options.htmlVideoEditPatchService || htmlVideoEditPatchService;
  const result = patcher.applyEditPatch(project, payload);
  if (!result.success) {
    return {
      success: false,
      code: result.code || 'EDIT_FAILED',
      workflow_id: workflowId,
      message: result.message || 'html-video 编辑失败。',
    };
  }

  const rawHtmlTextPatch = await syncRawHtmlFrameTextPatch({
    projectDir,
    project: result.project,
    editPatch: payload,
  });
  const saved = await htmlVideoProjectStore.saveProject(projectDir, result.project);
  return {
    success: true,
    workflow_id: workflowId,
    html_video_project: saved,
    html_video_project_path: projectDir,
    revision: result.revision,
    requires_tts: result.requires_tts,
    requires_render: result.requires_render,
    raw_html_text_patch: rawHtmlTextPatch,
    message: result.message || 'html-video 工程已保存。',
  };
}

async function patchHtmlVideoProjectFrame(workflowId, frameId, payload = {}, options = {}) {
  const patch = payload.frame_inputs_patch || payload.patch || payload.inputs || {};
  if (payload.type === 'frame_patch') {
    return patchCreativeWorkflowHtmlVideoProject(workflowId, {
      ...payload,
      type: 'frame_patch',
      frame_id: frameId,
      patch,
      inputs: payload.inputs,
      summary: payload.summary || '帧字段已保存，需要重新渲染。',
    }, options);
  }
  const type = payload.type || (
    payload.duration_sec != null || payload.duration != null
      ? 'duration_patch'
      : 'frame_inputs_patch'
  );
  return patchCreativeWorkflowHtmlVideoProject(workflowId, {
    type,
    frame_id: frameId,
    patch,
    duration_sec: payload.duration_sec,
    duration: payload.duration,
    summary: payload.summary || '帧字段已保存，需要重新渲染。',
  }, options);
}

async function patchHtmlVideoProjectSfxEvent(workflowId, eventId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  if (payload.enabled !== false) {
    return {
      success: false,
      code: 'SFX_EVENT_PATCH_UNSUPPORTED',
      workflow_id: workflowId,
      message: '首版只支持删除音效。',
    };
  }
  const result = sfxEventService.disableSfxEvent({ project, eventId });
  if (!result.success) {
    return { ...result, workflow_id: workflowId };
  }
  // 先落权威 project.json 再写镜像：save 失败时镜像不会先说"已删"（spec §4.3 同步要求）
  const saved = await htmlVideoProjectStore.saveProject(projectDir, result.project);
  await sfxEventService.persistProjectSfxMirror(projectDir, saved);
  return {
    success: true,
    workflow_id: workflowId,
    message: '音效已删除，重新导出后生效。',
    html_video_project: saved,
    html_video_project_path: projectDir,
    requires_render: true,
    requires_export: true,
    render_scope: 'export_only',
  };
}

async function createHtmlVideoProjectEditPlan(workflowId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;

  const service = options.htmlVideoEditModeService || htmlVideoEditModeService;
  const result = await service.createEditPlan({
    project,
    instruction: payload.instruction,
    selectedFrameId: payload.selected_frame_id || payload.selectedFrameId,
  });
  if (!result.success) {
    return {
      ...result,
      workflow_id: workflowId,
    };
  }

  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return {
    ...result,
    workflow_id: workflowId,
    html_video_project: saved,
    html_video_project_path: projectDir,
  };
}

async function runHtmlVideoProjectEditPlan(workflowId, planId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;

  const service = options.htmlVideoEditModeService || htmlVideoEditModeService;
  const result = await service.runEditPlan({
    projectDir,
    project,
    planId,
    confirm: payload.confirm === true,
    runLayoutQa: payload.run_layout_qa !== false && payload.runLayoutQa !== false,
    iterateService: options.htmlVideoIterateService || htmlVideoIterateService,
    layoutQaService: options.layoutQaService || layoutQaService,
    model: options.aiTextModel || aiTextModel,
  });
  if (!result.success) {
    if (result.plan) {
      return attachSavedHtmlVideoProject(result, workflowId, planId, projectDir, project);
    }
    return {
      ...result,
      workflow_id: workflowId,
      plan_id: planId,
    };
  }

  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return {
    ...result,
    workflow_id: workflowId,
    plan_id: result.plan_id || planId,
    html_video_project: saved,
    html_video_project_path: projectDir,
  };
}

async function acceptHtmlVideoProjectEditPlan(workflowId, planId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;

  const service = options.htmlVideoEditModeService || htmlVideoEditModeService;
  const result = await service.acceptEditPlanDrafts({
    projectDir,
    project,
    planId,
    frameHtmlEditService: options.frameHtmlEditService || frameHtmlEditService,
  });
  if (!result.success) {
    if (result.plan) {
      return attachSavedHtmlVideoProject(result, workflowId, planId, projectDir, project);
    }
    return {
      ...result,
      workflow_id: workflowId,
      plan_id: planId,
    };
  }

  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return {
    ...result,
    workflow_id: workflowId,
    plan_id: result.plan_id || planId,
    html_video_project: saved,
    html_video_project_path: projectDir,
  };
}

async function discardHtmlVideoProjectEditPlan(workflowId, planId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;

  const service = options.htmlVideoEditModeService || htmlVideoEditModeService;
  const result = await service.discardEditPlanDrafts({
    project,
    planId,
    frameHtmlEditService: options.frameHtmlEditService || frameHtmlEditService,
  });
  if (!result.success) {
    if (result.plan) {
      return attachSavedHtmlVideoProject(result, workflowId, planId, projectDir, project);
    }
    return {
      ...result,
      workflow_id: workflowId,
      plan_id: planId,
    };
  }

  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return {
    ...result,
    workflow_id: workflowId,
    plan_id: result.plan_id || planId,
    html_video_project: saved,
    html_video_project_path: projectDir,
  };
}

async function getHtmlVideoProjectFrameHtml(workflowId, frameId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  return frameHtmlEditService.readFrameHtml({ projectDir, project, frameId, format: payload.format });
}

async function saveHtmlVideoProjectFrameHtml(workflowId, frameId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const result = await frameHtmlEditService.saveFrameHtmlDraft({
    projectDir,
    project,
    frameId,
    html: payload.html,
    mode: payload.mode,
    summary: payload.summary,
    instruction: payload.instruction,
    kind: payload.kind || 'manual_source',
  });
  if (!result.success) return { ...result, workflow_id: workflowId, frame_id: frameId };
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return { ...result, workflow_id: workflowId, frame_id: frameId, html_video_project: saved, html_video_project_path: projectDir };
}

async function iterateHtmlVideoProjectFrame(workflowId, frameId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const iterateService = options.htmlVideoIterateService || htmlVideoIterateService;
  const result = await iterateService.iterateFrameHtml({
    projectDir,
    project,
    frameId,
    instruction: payload.instruction,
    mode: payload.mode,
    preserveText: payload.preserve_text !== false,
    model: options.aiTextModel || aiTextModel,
  });
  if (!result.success) return { ...result, workflow_id: workflowId, frame_id: frameId };
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return {
    ...result,
    workflow_id: workflowId,
    frame_id: frameId,
    html_video_project: saved,
    html_video_project_path: projectDir,
  };
}

async function acceptHtmlVideoProjectFrameDraft(workflowId, frameId, draftId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const result = await frameHtmlEditService.acceptFrameDraft({ projectDir, project, frameId, draftId });
  if (!result.success) return { ...result, workflow_id: workflowId, frame_id: frameId };
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return { ...result, workflow_id: workflowId, frame_id: frameId, html_video_project: saved, html_video_project_path: projectDir };
}

async function discardHtmlVideoProjectFrameDraft(workflowId, frameId, draftId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const result = await frameHtmlEditService.discardFrameDraft({ project, frameId, draftId });
  if (!result.success) return { ...result, workflow_id: workflowId, frame_id: frameId };
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return { ...result, workflow_id: workflowId, frame_id: frameId, html_video_project: saved, html_video_project_path: projectDir };
}

async function inspectHtmlVideoProjectLayout(workflowId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const layoutQaService = options.layoutQaService || htmlVideoProjectApi.layoutQaService;
  const frameId = safeString(payload.frame_id || payload.frameId);
  const targetFrame = frameId ? findFrameByAnyId(project, frameId) : null;
  if (frameId && !targetFrame) {
    return { success: false, code: 'FRAME_NOT_FOUND', workflow_id: workflowId, frame_id: frameId, message: '未找到要检查的帧。' };
  }

  const frames = frameId ? [targetFrame] : (Array.isArray(project.frames) ? project.frames : []);
  const reports = [];
  for (const frame of frames) {
    if (frame.source_mode !== 'raw_html' || !frame.html_path) continue;
    const htmlPath = path.isAbsolute(frame.html_path) ? frame.html_path : path.join(projectDir, frame.html_path);
    reports.push(await layoutQaService.inspectFrameHtmlLayout({
      htmlPath,
      frame,
      resolution: project.output?.resolution || { width: 1920, height: 1080 },
      durationSec: frame.duration_sec,
    }));
  }

  const issues = reports.flatMap(report => report.issues || []);
  const layoutQa = {
    success: issues.every(issue => issue.severity === 'warning' || issue.severity === 'info'),
    issues,
    reports,
  };
  project.layout_qa_reports = Array.isArray(project.layout_qa_reports) ? project.layout_qa_reports : [];
  project.layout_qa_reports.push({
    id: `layout_qa_${String(project.layout_qa_reports.length + 1).padStart(4, '0')}`,
    created_at: new Date().toISOString(),
    frame_id: frameId || null,
    ...layoutQa,
  });
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return {
    success: true,
    workflow_id: workflowId,
    html_video_project: saved,
    html_video_project_path: projectDir,
    layout_qa: layoutQa,
    message: layoutQa.success ? '布局检查通过。' : '布局检查发现问题。',
  };
}

async function regenerateHtmlVideoProjectNarration(workflowId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;

  if (htmlVideoAudioDisabled(project)) {
    return {
      success: false,
      code: 'AUDIO_DISABLED',
      workflow_id: workflowId,
      message: '该工程生成时已关闭配音，无法重新生成旁白。',
    };
  }

  const frameId = safeString(payload.frame_id || payload.frameId);
  const narrationText = String(payload.text ?? payload.narration_text ?? '');
  if (frameId && !narrationText.trim()) {
    return {
      success: false,
      code: 'NARRATION_EMPTY',
      workflow_id: workflowId,
      message: '旁白文本为空，请先填写旁白再重新生成。',
    };
  }

  let nextProject = project;
  if (frameId) {
    const patcher = options.htmlVideoEditPatchService || htmlVideoEditPatchService;
    const patched = patcher.applyEditPatch(nextProject, {
      type: 'frame_patch',
      frame_id: frameId,
      narration_text: narrationText,
      summary: '旁白已更新并重新生成音频。',
    });
    if (!patched.success) {
      return {
        success: false,
        code: patched.code || 'EDIT_FAILED',
        workflow_id: workflowId,
        message: patched.message || '保存旁白失败。',
      };
    }
    nextProject = patched.project;
  }

  const baseSceneSpec = await readHtmlVideoSceneSpec(projectDir);
  const sceneSpec = sceneSpecFromProjectFrames(nextProject, baseSceneSpec);
  if (!Array.isArray(sceneSpec.scenes) || sceneSpec.scenes.length === 0) {
    return {
      success: false,
      code: 'SCENE_SPEC_MISSING',
      workflow_id: workflowId,
      message: '重新生成旁白失败：未找到可生成音频的场景。',
    };
  }
  if (!sceneSpec.scenes.some(scene => String(scene?.narration_text || '').trim())) {
    return {
      success: false,
      code: 'NARRATION_EMPTY',
      workflow_id: workflowId,
      message: '重新生成旁白失败：所有场景的旁白文本都为空。',
    };
  }

  // 先落盘文本再合成：TTS 失败时用户的旁白编辑不丢失
  await htmlVideoProjectStore.saveSceneSpec(projectDir, sceneSpec);
  nextProject = await htmlVideoProjectStore.saveProject(projectDir, nextProject);

  // 只改一帧时按场景增量合成（manifest 由 ttsService 增量合并），避免整片重跑 TTS
  const targetFrame = frameId
    ? (Array.isArray(nextProject.frames) ? nextProject.frames : [])
      .find(frame => safeString(frame.id) === frameId || safeString(frame.scene_id) === frameId)
    : null;
  const sceneId = targetFrame ? safeString(targetFrame.scene_id || targetFrame.id) : '';

  const ttsService = options.htmlVideoServices?.ttsService
    || options.services?.ttsService
    || defaultCreativeVideoTtsService;
  const tts = await ttsService.synthesizeSceneNarration({
    projectDir,
    sceneSpec,
    ...(sceneId ? { sceneId } : {}),
  });
  if (!tts.success) {
    return {
      success: true,
      code: 'TTS_FAILED',
      workflow_id: workflowId,
      html_video_project: nextProject,
      requires_tts: true,
      requires_render: true,
      message: `${tts.message || '重新生成旁白失败。'}旁白文本已保存，音频生成失败，可稍后重试。`,
    };
  }

  defaultCreativeVideoTtsService.applyManifestToProjectAudio(nextProject, sceneSpec, plainObject(tts.audio_manifest));
  const saved = await htmlVideoProjectStore.saveProject(projectDir, nextProject);
  return {
    success: true,
    workflow_id: workflowId,
    html_video_project: saved,
    html_video_project_path: projectDir,
    audio_manifest: saved.audio?.tts_manifest_path || null,
    requires_tts: false,
    requires_render: true,
    message: tts.message || '旁白音频已重新生成，需要重新导出成片。',
  };
}

async function editHtmlVideoProject(workflowId, payload = {}, options = {}) {
  if (safeString(payload.type) === 'tts') {
    return regenerateHtmlVideoProjectNarration(workflowId, payload, options);
  }
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const workflow = options.htmlVideoWorkflow || htmlVideoWorkflow;
  const result = await workflow.applyEdit({
    workflowId,
    rootDir,
    projectDir,
    project,
    payload,
    services: {
      aiTextModel: options.aiTextModel || aiTextModel,
      ...(options.htmlVideoServices || {}),
    },
  });
  if (!result.success) {
    return {
      success: false,
      code: result.code || 'EDIT_FAILED',
      workflow_id: workflowId,
      message: result.message || 'html-video 编辑失败。',
    };
  }
  return {
    success: true,
    workflow_id: workflowId,
    html_video_project: result.project,
    html_video_project_path: projectDir,
    revision: result.revision,
    requires_tts: result.requires_tts,
    requires_render: result.requires_render,
    message: result.message || 'html-video 工程已保存。',
  };
}

async function renderCreativeWorkflowHtmlVideoProject(workflowId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const loaded = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  const { record, projectDir, error } = loaded;
  let { project } = loaded;
  if (error) return error;
  project = await restoreHtmlVideoNarrationReference({ project, projectDir });

  const orchestrator = options.htmlVideoProjectOrchestrator || htmlVideoProjectOrchestrator;
  const baseOptions = {
    rootDir,
    workflowId,
    runId: project.run_id || safeString(payload.run_id) || 'manual',
    projectDir,
    project,
    services: {
      ...(options.services || {}),
      ...(options.htmlVideoServices || {}),
      ttsService: options.htmlVideoServices?.ttsService || (options.services || {}).ttsService || defaultCreativeVideoTtsService,
    },
  };
  const mode = safeString(payload.mode || payload.action || '');
  let result;
  if (mode === 'materialize') {
    result = await orchestrator.materializeHtmlVideoProject(baseOptions);
  } else if (mode === 'frame') {
    result = await orchestrator.renderHtmlVideoFramePreview({
      ...baseOptions,
      frameId: safeString(payload.frame_id || payload.frameId),
      draftId: safeString(payload.draft_id || payload.draftId),
      runLayoutQa: payload.run_layout_qa === true || payload.runLayoutQa === true,
    });
  } else {
    result = await orchestrator.exportHtmlVideoProject({
      ...baseOptions,
      skipRender: payload.skip_render === true,
    });
  }

  await syncProjectStageSummariesFromProjectDir(record, result.html_video_project_path || projectDir, {
    mediaRoot: options.mediaRoot || DEFAULT_MEDIA_ROOT,
  });
  if (result.project?.generation_checkpoint) {
    syncProjectStageSummariesFromCheckpoint(record, result.project.generation_checkpoint);
  }
  record.updated_at = getNow(options.services || {});
  await persistWorkflow(record, rootDir);

  return {
    success: result.success,
    workflow_id: workflowId,
    html_video_project: result.project,
    html_video_project_path: result.html_video_project_path || projectDir,
    output_path: result.output_path,
    preview_path: result.preview_path,
    preview_frame_id: result.preview_frame_id,
    preview_draft_id: result.preview_draft_id || null,
    layout_qa: result.layout_qa || null,
    diagnostics: result.diagnostics || [],
    message: result.message || (result.success ? '操作已完成。' : 'html-video 工程渲染失败。'),
  };
}

async function renderHtmlVideoProject(workflowId, payload = {}, options = {}) {
  const mode = safeString(payload.mode || payload.action || '');
  if (mode !== 'materialize' && mode !== 'frame') {
    return {
      success: false,
      code: 'HTML_VIDEO_RENDER_MODE_INVALID',
      workflow_id: workflowId,
      message: 'html-video render mode 无效，请选择 materialize 或 frame。',
    };
  }
  if (mode === 'frame' && !safeString(payload.frame_id || payload.frameId)) {
    return {
      success: false,
      code: 'HTML_VIDEO_FRAME_ID_REQUIRED',
      workflow_id: workflowId,
      message: '渲染单帧预览失败：缺少帧 ID。',
    };
  }
  return renderCreativeWorkflowHtmlVideoProject(workflowId, payload, options);
}

async function exportHtmlVideoProject(workflowId, payload = {}, options = {}) {
  return renderCreativeWorkflowHtmlVideoProject(workflowId, { ...payload, skip_render: false, mode: 'export' }, options);
}

async function listHtmlVideoProjectExports(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  return {
    success: true,
    workflow_id: workflowId,
    html_video_project_path: projectDir,
    exports: Array.isArray(project.exports) ? project.exports : [],
  };
}

async function getHtmlVideoProjectExportFile(workflowId, exportId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const safeExportId = safeString(exportId);
  const exportItem = (Array.isArray(project.exports) ? project.exports : [])
    .find(item => String(item?.id || '') === safeExportId);
  if (!exportItem || !exportItem.path) {
    return {
      success: false,
      code: 'EXPORT_NOT_FOUND',
      workflow_id: workflowId,
      export_id: safeExportId,
      message: '未找到导出文件记录。',
    };
  }
  let filePath;
  try {
    filePath = htmlVideoProjectStore.resolveProjectPath(projectDir, exportItem.path);
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('not file');
  } catch {
    return {
      success: false,
      code: 'EXPORT_NOT_FOUND',
      workflow_id: workflowId,
      export_id: safeExportId,
      message: '导出文件不存在或路径无效。',
    };
  }
  return {
    success: true,
    workflow_id: workflowId,
    export_id: safeExportId,
    export: exportItem,
    file_path: filePath,
  };
}

async function getCreativeWorkflowAssetFile(workflowId, assetId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const mediaRoot = options.mediaRoot || DEFAULT_MEDIA_ROOT;
  const id = safeString(assetId);
  let record;
  try {
    record = await readWorkflow(workflowId, rootDir);
  } catch {
    return {
      success: false,
      code: 'ASSET_NOT_FOUND',
      workflow_id: workflowId,
      asset_id: id,
      message: '未找到视觉素材文件。',
    };
  }
  const workflowDir = path.resolve(mediaRoot, safeString(workflowId));
  const realWorkflowDir = workflowDir ? await fsp.realpath(workflowDir).catch(() => '') : '';
  const projectDir = extractHtmlVideoProjectPathFromWorkflow(record);
  const realProjectDir = projectDir ? await fsp.realpath(projectDir).catch(() => '') : '';
  const allowProjectDir = realProjectDir && realWorkflowDir
    && (realProjectDir === realWorkflowDir || isPathInside(realProjectDir, realWorkflowDir));
  let projectAssets = [];
  if (allowProjectDir) {
    try {
      const projectPath = htmlVideoProjectStore.resolveProjectPath(realProjectDir, 'project.json');
      const project = JSON.parse(await fsp.readFile(projectPath, 'utf8'));
      projectAssets = (Array.isArray(project.assets) ? project.assets : [])
        .map(asset => normalizeProjectVisualAsset(asset, realProjectDir))
        .filter(Boolean);
    } catch {}
  }
  const assets = [
    ...(Array.isArray(record.asset_context?.assets) ? record.asset_context.assets : []),
    ...(Array.isArray(record.creative_context?.asset_context?.assets) ? record.creative_context.asset_context.assets : []),
    ...projectAssets,
  ];
  const asset = assets.find((item, index) => (
    safeString(item?.id) === id
    || safeString(item?.asset_id) === id
    || `asset_${index + 1}` === id
  ));
  const allowedRoots = [realWorkflowDir, allowProjectDir ? realProjectDir : ''].filter(Boolean);
  const rawPathCandidates = [
    safeString(asset?.local_path),
    safeString(asset?.path) ? path.join(workflowDir, asset.path) : '',
    allowProjectDir && safeString(asset?.path) ? path.join(realProjectDir, asset.path) : '',
  ].filter(Boolean);
  let realFilePath = '';
  for (const candidate of rawPathCandidates) {
    const resolved = path.resolve(candidate);
    const realCandidate = await fsp.realpath(resolved).catch(() => '');
    if (!realCandidate || !await fileExists(realCandidate)) continue;
    if (!allowedRoots.some(root => isPathInside(realCandidate, root))) continue;
    realFilePath = realCandidate;
    break;
  }
  if (!asset || !realFilePath) {
    return {
      success: false,
      code: 'ASSET_NOT_FOUND',
      workflow_id: workflowId,
      asset_id: id,
      message: '未找到视觉素材文件。',
    };
  }
  return {
    success: true,
    workflow_id: workflowId,
    asset_id: id,
    asset,
    file_path: realFilePath,
  };
}

module.exports = {
  STAGE_IDS,
  STAGE_LABELS,
  createCreativeWorkflow,
  runCreativeWorkflow,
  getCreativeWorkflow,
  getCreativeWorkflowRetryPlan,
  refreshCreativeWorkflowRetryPlan,
  retryCreativeWorkflow,
  buildHtmlVideoLiteProjectStageResult,
  patchCreativeWorkflowTaskSummary,
  clearCreativeWorkflowTaskSummary,
  listCreativeWorkflowRecords,
  deleteCreativeWorkflow,
  getWorkflowPath,
  makeLocalCreativeAwemeId,
  appendWorkflowModelCall,
  recoverStaleWorkflowsOnStartup,
  getCreativeWorkflowHtmlVideoProject,
  patchCreativeWorkflowHtmlVideoProject,
  renderCreativeWorkflowHtmlVideoProject,
  patchHtmlVideoProjectFrame,
  patchHtmlVideoProjectSfxEvent,
  createHtmlVideoProjectEditPlan,
  runHtmlVideoProjectEditPlan,
  acceptHtmlVideoProjectEditPlan,
  discardHtmlVideoProjectEditPlan,
  getHtmlVideoProjectFrameHtml,
  saveHtmlVideoProjectFrameHtml,
  iterateHtmlVideoProjectFrame,
  acceptHtmlVideoProjectFrameDraft,
  discardHtmlVideoProjectFrameDraft,
  inspectHtmlVideoProjectLayout,
  regenerateHtmlVideoProjectNarration,
  editHtmlVideoProject,
  renderHtmlVideoProject,
  exportHtmlVideoProject,
  listHtmlVideoProjectExports,
  getHtmlVideoProjectExportFile,
  getCreativeWorkflowAssetFile,
  extractHtmlVideoProjectPathFromWorkflow,
  runResearchProvider,
  defaultResearchProvider,
  defaultWebSearchProvider,
  buildCreativeDefaultsSnapshot,
  buildWorkflowTarget,
  resolveRetryContinuityMode,
  defaultRetryFrameHtmlAction,
};
