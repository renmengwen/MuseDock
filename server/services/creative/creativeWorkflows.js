const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const creativeContext = require('./creativeContext');
const defaultResearchService = require('../researchService');
const mediaPipeline = require('../mediaPipeline');
const defaultAgentRuns = require('../agent/agentRuns');
const aiModelConfig = require('../ai/aiModelConfig');
const appSettings = require('../appSettings');
const defaultCreativeVideoEditor = require('./creativeVideoEditor');
const defaultCreativeVideoRerender = require('./creativeVideoRerender');
const defaultCreativeVideoTtsService = require('../creative-video/ttsService');
const defaultTtsTimeline = require('../tts/ttsTimeline');
const sceneSpecService = require('../sceneSpec');
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
  createTemplateRegistry: createHtmlVideoTemplateRegistry,
} = htmlVideoProjectApi;

const DEFAULT_ROOT = path.join(__dirname, '../../../data/creative-workflows');
const DEFAULT_MEDIA_ROOT = path.join(__dirname, '../../../data/media/douyin');
const WORKFLOW_ID_PATTERN = /^\d{5,32}$/;
const DEFAULT_STALE_STAGE_TIMEOUT_MS = 10 * 60 * 1000;
const WORKFLOW_STOPPED = Symbol('workflow-stopped');
const NEUTRAL_VOICE_STYLE_PROMPT = '请使用自然、清晰、语速稳定的短视频口播风格；避免夸张表演、过长间隔、深呼吸或拖慢语速。';
const EMOTIONAL_VOICE_STYLE_PROMPT = '请使用自然、有情绪起伏的短视频口播风格；关键句加强语气，适度停顿，保持清晰表达，不要过度拖慢语速。';

const STAGE_IDS = ['source', 'research', 'assets', 'agent_run', 'brief', 'audio', 'project', 'check', 'render', 'inspect'];
const STAGE_LABELS = {
  source: '准备来源资料',
  research: '联网研究',
  assets: '素材分析',
  agent_run: '导演改写',
  brief: '成片策划',
  audio: '生成音频轨',
  project: '生成工程',
  check: '校验工程',
  render: '渲染视频',
  inspect: '巡检视频',
};

function safeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

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

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function inferMediaRootFromProjectDir(projectDir, workflowId) {
  const resolvedProjectDir = path.resolve(String(projectDir || ''));
  const marker = `${path.sep}${safeString(workflowId)}${path.sep}agent_runs${path.sep}`;
  const index = resolvedProjectDir.indexOf(marker);
  return index >= 0 ? resolvedProjectDir.slice(0, index) : '';
}


function getNow(services = {}) {
  if (typeof services.now === 'function') {
    return safeString(services.now()) || new Date().toISOString();
  }
  return new Date().toISOString();
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeModelUsage(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    prompt_tokens: nullableNumber(input.prompt_tokens),
    completion_tokens: nullableNumber(input.completion_tokens),
    total_tokens: nullableNumber(input.total_tokens),
    cached_tokens: nullableNumber(input.cached_tokens),
  };
}

function makeId(now = new Date().toISOString()) {
  const stamp = safeString(now).replace(/\D/g, '').slice(0, 14)
    || new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const random = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  return `${stamp}${random}`;
}

function appendWorkflowModelCall(record, modelCall = {}) {
  if (!record || typeof record !== 'object') return record;
  const input = modelCall && typeof modelCall === 'object' && !Array.isArray(modelCall) ? modelCall : {};
  const attempt = Number(input.attempt);
  const durationMs = Number(input.duration_ms);
  const existingCount = Array.isArray(record.model_calls) ? record.model_calls.length : 0;
  const call = {
    id: safeString(input.id) || `model_call_${String(existingCount + 1).padStart(4, '0')}`,
    agent: safeString(input.agent),
    stage: safeString(input.stage),
    sub_stage: safeString(input.sub_stage),
    frame_id: safeString(input.frame_id),
    node_id: safeString(input.node_id),
    attempt: Number.isFinite(attempt) ? attempt : null,
    model: {
      provider: safeString(input.model?.provider),
      model_id: safeString(input.model?.model_id),
    },
    usage: normalizeModelUsage(input.usage),
    duration_ms: Number.isFinite(durationMs) ? durationMs : null,
    success: input.success !== false,
    error: safeString(input.error),
    created_at: safeString(input.created_at) || new Date().toISOString(),
  };
  record.model_calls = [
    ...(Array.isArray(record.model_calls) ? record.model_calls : []),
    call,
  ].slice(-500);
  return record;
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

function makeLocalCreativeAwemeId(seed) {
  const numeric = safeString(seed).replace(/\D/g, '');
  if (WORKFLOW_ID_PATTERN.test(numeric)) {
    return numeric;
  }

  return makeId().slice(0, 20);
}

function getWorkflowPath(workflowId, rootDir = DEFAULT_ROOT) {
  const id = safeString(workflowId);
  if (!WORKFLOW_ID_PATTERN.test(id)) {
    throw new Error('非法或无效的创作任务 ID。');
  }

  const rootPath = path.resolve(rootDir || DEFAULT_ROOT);
  const filePath = path.resolve(rootPath, `${id}.json`);
  const relative = path.relative(rootPath, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('创作任务路径越界。');
  }
  return filePath;
}

function createStages() {
  return STAGE_IDS.map(id => ({
      id,
      label: STAGE_LABELS[id],
      status: 'pending',
      message: '',
  }));
}

function normalizeStages(stages) {
  if (Array.isArray(stages)) {
    const byId = new Map(stages.map(stage => [stage && stage.id, stage]));
    return STAGE_IDS.map(id => ({
      id,
      label: STAGE_LABELS[id],
      status: 'pending',
      message: '',
      ...(byId.get(id) || {}),
    }));
  }

  if (stages && typeof stages === 'object') {
    return STAGE_IDS.map(id => ({
      id,
      label: STAGE_LABELS[id],
      status: 'pending',
      message: '',
      ...(stages[id] || {}),
    }));
  }

  return createStages();
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

const workflowFileQueues = new Map();

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientRenameError(error) {
  return error?.syscall === 'rename' && ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code);
}

async function renameWithRetry(tempPath, filePath) {
  const delays = [25, 75, 150, 300];
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fsp.rename(tempPath, filePath);
      return;
    } catch (error) {
      if (!isTransientRenameError(error) || attempt >= delays.length) throw error;
      await delay(delays[attempt]);
    }
  }
}

function withWorkflowFileQueue(filePath, task) {
  const key = path.resolve(filePath);
  const previous = workflowFileQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  workflowFileQueues.set(key, current);
  current.finally(() => {
    if (workflowFileQueues.get(key) === current) workflowFileQueues.delete(key);
  }).catch(() => {});
  return current;
}

async function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  try {
    await fsp.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
}

async function readWorkflow(workflowId, rootDir) {
  const filePath = getWorkflowPath(workflowId, rootDir);
  const record = await readJson(filePath);
  record.stages = normalizeStages(record.stages);
  return record;
}

async function workflowFileExists(workflowId, rootDir) {
  try {
    await fsp.access(getWorkflowPath(workflowId, rootDir));
    return true;
  } catch {
    return false;
  }
}

function createWorkflowStoppedSummary(workflowId) {
  return {
    success: false,
    workflow_id: safeString(workflowId),
    status: 'deleted',
    message: '创作任务已停止并删除。',
  };
}

async function persistWorkflow(record, rootDir) {
  const filePath = getWorkflowPath(record.workflow_id, rootDir);
  return withWorkflowFileQueue(filePath, () => persistWorkflowUnlocked(record, rootDir, filePath));
}

async function persistWorkflowUnlocked(record, rootDir, filePath = getWorkflowPath(record.workflow_id, rootDir)) {
  record.stages = normalizeStages(record.stages);
  const nextRecord = {
    ...record,
    path: filePath,
  };
  await writeJson(filePath, nextRecord);
  return nextRecord;
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
      message: '图片素材将在下一阶段开放。',
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

async function defaultRetryFrameHtmlAction({ workflow, project, projectDir, mediaRoot, services, taskContext } = {}) {
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
  const storedTemplateId = safeString(project?.template_id);
  const workflowService = services.htmlVideoWorkflow || htmlVideoWorkflow;
  return workflowService.generateHtmlVideo({
    workflowId,
    runId,
    rootDir,
    sceneSpec,
    creativeContext: {
      ...plainObject(workflow?.result?.hyperframes_freeform),
      scene_spec: sceneSpec,
      frame_specs: extractFrameSpecsFromWorkflow(workflow),
    },
    target,
    preferredTemplateId: safeString(target.preferredTemplateId) || storedTemplateId || '',
    lockTemplate: target.lockTemplate === true || Boolean(storedTemplateId),
    reuseContentGraph: true,
    projectOptions: {
      reuseContentGraph: true,
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
  const defaultTemplates = defaultsSource.templateByAspectRatio && typeof defaultsSource.templateByAspectRatio === 'object'
    ? defaultsSource.templateByAspectRatio
    : {};
  const overrideTemplates = overrideSource.templateByAspectRatio && typeof overrideSource.templateByAspectRatio === 'object'
    ? overrideSource.templateByAspectRatio
    : {};
  const templateByAspectRatio = {
    ...defaultTemplates,
    ...overrideTemplates,
  };

  const aspectRatio = safeString(overrideSource.aspectRatio) || safeString(defaultsSource.aspectRatio);
  const targetDurationSec = Number.isFinite(Number(overrideSource.targetDurationSec))
    ? Number(overrideSource.targetDurationSec)
    : Number(defaultsSource.targetDurationSec);
  const useResearchFromDefaults = defaultsSource.useResearch !== false;
  const useResearch = typeof overrideSource.useResearch === 'boolean'
    ? overrideSource.useResearch
    : (typeof payloadSource.useResearch === 'boolean' ? payloadSource.useResearch : useResearchFromDefaults);
  const templateId = safeString(overrideSource.templateId) || safeString(templateByAspectRatio[aspectRatio]);

  return {
    aspectRatio,
    targetDurationSec,
    templateByAspectRatio,
    templateId,
    lockTemplate: typeof overrideSource.lockTemplate === 'boolean'
      ? overrideSource.lockTemplate
      : defaultsSource.lockTemplate === true,
    useResearch,
    generateAudio: typeof overrideSource.generateAudio === 'boolean'
      ? overrideSource.generateAudio
      : defaultsSource.generateAudio !== false,
    generateCaptions: typeof overrideSource.generateCaptions === 'boolean'
      ? overrideSource.generateCaptions
      : defaultsSource.generateCaptions !== false,
    emotionalVoice: typeof overrideSource.emotionalVoice === 'boolean'
      ? overrideSource.emotionalVoice
      : defaultsSource.emotionalVoice === true,
  };
}

function buildWorkflowTarget(snapshot = {}) {
  return {
    aspect_ratio: safeString(snapshot.aspectRatio),
    duration_sec: Number(snapshot.targetDurationSec),
    preferredTemplateId: safeString(snapshot.templateId),
    lockTemplate: snapshot.lockTemplate === true,
    generateAudio: snapshot.generateAudio !== false,
    generateCaptions: snapshot.generateCaptions !== false,
    emotionalVoice: snapshot.emotionalVoice === true,
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
    preferredTemplateId: safeString(target.preferredTemplateId) || safeString(incomingOptions.preferredTemplateId),
    lockTemplate: target.lockTemplate === true,
  };
}

function buildHtmlVideoExportFileUrl(workflowId, exportId) {
  return `/api/creative-workflows/${encodeURIComponent(String(workflowId))}/html-video-project/exports/${encodeURIComponent(String(exportId))}/file`;
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
  const normalized = creativeContext.normalizeCreativeInput(effectivePayload);
  if (!normalized.success) {
    return normalizeFailureResult(normalized, effectivePayload);
  }
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


















function ensureSuccess(result, fallbackMessage, context = {}) {
  if (!result || result.success === false) {
    const diagnostics = normalizeDiagnostics(selectFailureDiagnostics(result));
    const failureDiagnostic = selectFailureDiagnostic(diagnostics);
    throw new CreativeWorkflowStageError(safeString(result && result.message) || fallbackMessage, {
      stage: context.stage || '',
      sub_stage: failureDiagnostic.sub_stage || context.sub_stage || '',
      code: failureDiagnostic.code || context.code || '',
      frame_id: failureDiagnostic.frame_id || '',
      project_dir: result?.project_dir || result?.html_video_project_path || context.project_dir || '',
      diagnostics,
      retryable: result?.retryable === true || failureDiagnostic.retryable === true,
      fallback_allowed: result?.fallback_allowed !== false && failureDiagnostic.fallback_allowed !== false,
    });
  }
  return result;
}




function selectFailureDiagnostics(result = {}) {
  const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
  if (diagnostics.length > 0) return diagnostics;
  const htmlVideoDiagnostics = Array.isArray(result?.html_video_diagnostics) ? result.html_video_diagnostics : [];
  return htmlVideoDiagnostics.length > 0 ? htmlVideoDiagnostics : [];
}

function selectFailureDiagnostic(diagnostics = []) {
  const items = Array.isArray(diagnostics) ? diagnostics : [];
  if (!items.length) return {};
  const nonWarnings = items.filter(item => item?.severity !== 'warning');
  if (nonWarnings.length) {
    return nonWarnings.find(item => item?.retryable === true || safeString(item?.repair_action))
      || nonWarnings[nonWarnings.length - 1]
      || {};
  }
  return items[0] || {};
}

function createLastFailureFromError(error, stageId, updatedAt) {
  const diagnostics = normalizeDiagnostics(error?.diagnostics || []);
  const failureDiagnostic = selectFailureDiagnostic(diagnostics);
  return {
    stage: safeString(error?.stage) || stageId,
    sub_stage: safeString(error?.sub_stage) || safeString(failureDiagnostic.sub_stage),
    code: safeString(error?.code) || safeString(failureDiagnostic.code),
    frame_id: safeString(error?.frame_id) || safeString(failureDiagnostic.frame_id),
    project_dir: safeString(error?.project_dir),
    message: safeString(error?.message) || `${STAGE_LABELS[stageId]}失败。`,
    diagnostics,
    updated_at: updatedAt,
  };
}

function normalizeProjectStageSummary(summary = {}) {
  const input = summary && typeof summary === 'object' ? summary : {};
  const next = {
    id: safeString(input.id),
    status: safeString(input.status),
    message: safeString(input.message),
    artifacts: Array.isArray(input.artifacts)
      ? input.artifacts
      : input.artifacts && typeof input.artifacts === 'object'
      ? input.artifacts
      : {},
    diagnostics: normalizeDiagnostics(input.diagnostics || []),
  };
  return next.id ? next : null;
}

function upsertProjectStageSummary(record, summary) {
  const next = normalizeProjectStageSummary(summary);
  if (!next) return record;
  const existing = Array.isArray(record.project_substages) ? record.project_substages : [];
  const index = existing.findIndex(item => item?.id === next.id);
  record.project_substages = index >= 0
    ? existing.map((item, itemIndex) => (itemIndex === index ? next : item))
    : [...existing, next];
  return record;
}

function checkpointStageSummaries(generationCheckpoint = {}) {
  const stages = generationCheckpoint?.stages;
  if (Array.isArray(stages)) return stages;
  if (!stages || typeof stages !== 'object') return [];
  return Object.entries(stages).map(([id, stage]) => checkpointStageSummary(id, stage));
}

function checkpointDiagnostic(code, sub_stage, frame_id = '') {
  return safeString(code) ? createDiagnostic({ code, sub_stage, frame_id }) : null;
}

function compactFrameStageSummary(id, stage = {}, sub_stage, pathKey, kind) {
  const frames = stage?.frames && typeof stage.frames === 'object' ? stage.frames : {};
  const artifacts = [];
  const diagnostics = [];
  let hasDone = false;
  let hasFailed = false;
  for (const [frameId, frame] of Object.entries(frames)) {
    if (frame?.status === 'done') {
      hasDone = true;
      if (safeString(frame[pathKey])) {
        artifacts.push({
          kind,
          frame_id: frameId,
          path: safeString(frame[pathKey]),
          ...(safeString(frame.output_hash) ? { hash: safeString(frame.output_hash) } : {}),
        });
      }
    } else if (frame?.status === 'failed') {
      hasFailed = true;
      const diagnostic = checkpointDiagnostic(frame.diagnostic_code, sub_stage, frameId);
      if (diagnostic) diagnostics.push(diagnostic);
    }
  }
  return {
    id,
    status: hasFailed ? 'failed' : hasDone ? 'done' : safeString(stage?.status),
    artifacts,
    diagnostics,
  };
}

function checkpointStageSummary(id, stage = {}) {
  if (id === 'content_graph') {
    return {
      id,
      status: safeString(stage?.status),
      artifacts: safeString(stage?.path) ? {
        kind: 'content_graph',
        path: safeString(stage.path),
        ...(safeString(stage.output_hash) ? { hash: safeString(stage.output_hash) } : {}),
      } : {},
      diagnostics: [checkpointDiagnostic(stage?.diagnostic_code, 'content_graph')].filter(Boolean),
    };
  }
  if (id === 'frame_html') {
    return compactFrameStageSummary(id, stage, 'frame_html', 'html_path', 'frame_html');
  }
  if (id === 'render') {
    return compactFrameStageSummary(id, stage, 'render', 'mp4_path', 'render_frame');
  }
  if (id === 'compose') {
    return {
      id,
      status: safeString(stage?.status),
      artifacts: [
        safeString(stage?.output_path) ? { kind: 'compose_output', path: safeString(stage.output_path) } : null,
        safeString(stage?.output_audio_path) ? { kind: 'compose_audio_output', path: safeString(stage.output_audio_path) } : null,
      ].filter(Boolean),
      diagnostics: [checkpointDiagnostic(stage?.diagnostic_code, 'compose')].filter(Boolean),
    };
  }
  if (id === 'duration_verify') {
    return {
      id,
      status: safeString(stage?.status),
      artifacts: {
        kind: 'duration_verify',
        expected_duration_sec: stage?.expected_duration_sec ?? null,
        actual_duration_sec: stage?.actual_duration_sec ?? null,
      },
      diagnostics: stage?.status === 'failed'
        ? [checkpointDiagnostic(stage?.diagnostic_code || 'duration_mismatch', 'duration_verify')].filter(Boolean)
        : [],
    };
  }
  if (id === 'visual_inspect') {
    return {
      id,
      status: safeString(stage?.status),
      artifacts: safeString(stage?.report_path) ? { kind: 'visual_report', path: safeString(stage.report_path) } : {},
      diagnostics: [checkpointDiagnostic(stage?.diagnostic_code, 'visual_inspect')].filter(Boolean),
    };
  }
  return {
    id,
    status: stage?.status || '',
    message: stage?.message || '',
    artifacts: stage?.artifacts && typeof stage.artifacts === 'object' ? stage.artifacts : {},
    diagnostics: stage?.diagnostics || [],
  };
}

function syncProjectStageSummariesFromCheckpoint(record, generationCheckpoint) {
  for (const summary of checkpointStageSummaries(generationCheckpoint)) {
    upsertProjectStageSummary(record, summary);
  }
  return record;
}

async function syncProjectStageSummariesFromProjectDir(record, projectDir) {
  const resolvedProjectDir = safeString(projectDir);
  if (!resolvedProjectDir) return record;
  try {
    const projectPath = htmlVideoProjectStore.resolveProjectPath(resolvedProjectDir, 'project.json');
    const project = JSON.parse(await fsp.readFile(projectPath, 'utf8'));
    syncProjectStageSummariesFromCheckpoint(record, project.generation_checkpoint);
  } catch {
    // checkpoint 只是辅助恢复状态，读取失败不能覆盖主阶段错误。
  }
  return record;
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

async function emitTaskContextEvent(taskContext, event) {
  if (!taskContext || typeof taskContext.emit !== 'function') {
    return;
  }
  try {
    await taskContext.emit(event);
  } catch {
    // 后台任务事件是辅助状态通道，不能改变主 workflow 阶段成败。
  }
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
        result?.project_dir || result?.html_video_project_path,
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
      await syncProjectStageSummariesFromProjectDir(record, record.last_failure.project_dir);
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
  const services = resolveServices(options);
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
      await services.agentRuns.createDouyinHyperframesFreeformRun(record.aweme_id, { rootDir: mediaRoot }),
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

  const projectStageResult = await runStage(record, 'project', rootDir, async () => ensureSuccess(
    await services.agentRuns.generateDouyinRunHyperframesFreeformProject(record.aweme_id, record.run_id, {
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
  ), services, taskContext);
  stoppedOrFailed = failIfStoppedOrNull(projectStageResult);
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  if (isHtmlVideoLiteProjectResult(projectStageResult)) {
    const doneAt = getNow(services);
    await markHtmlVideoLiteFinalStages(record, doneAt, projectStageResult);
    record.success = true;
    record.status = 'done';
    record.message = '创作任务已完成。';
    record.result = { hyperframes_freeform: projectStageResult.hyperframes_freeform };
    record.error = null;
    record.updated_at = doneAt;
    const persisted = await persistWorkflow(record, rootDir);
    return createWorkflowSummary(persisted);
  }

  if (!skipValidation) {
    stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'check', rootDir, async () => ensureSuccess(
      await services.agentRuns.checkDouyinRunHyperframesFreeformProject(record.aweme_id, record.run_id, {
        rootDir: mediaRoot,
      }),
      '工程校验失败。',
    ), services, taskContext));
    if (stoppedOrFailed) {
      return stoppedOrFailed;
    }
  }

  stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'render', rootDir, async () => ensureSuccess(
    await services.agentRuns.renderDouyinRunHyperframesFreeformVideo(record.aweme_id, record.run_id, {
      rootDir: mediaRoot,
    }),
    '视频渲染失败。',
  ), services, taskContext));
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  let inspectResult = null;
  if (!skipValidation) {
    inspectResult = await runStage(record, 'inspect', rootDir, async () => ensureSuccess(
      await services.agentRuns.inspectDouyinRunHyperframesFreeformVideo(record.aweme_id, record.run_id, {
        rootDir: mediaRoot,
      }),
      '视频巡检失败。',
    ), services, taskContext);
    stoppedOrFailed = failIfStoppedOrNull(inspectResult);
    if (stoppedOrFailed) {
      return stoppedOrFailed;
    }
  }

  if (!await workflowFileExists(workflowId, rootDir)) {
    return createWorkflowStoppedSummary(workflowId);
  }

  const doneAt = getNow(services);
  record.success = true;
  record.status = 'done';
  record.message = '创作任务已完成。';
  record.result = inspectResult;
  record.error = null;
  record.updated_at = doneAt;
  const persisted = await persistWorkflow(record, rootDir);
  return createWorkflowSummary(persisted);
}

async function getCreativeWorkflow(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const services = resolveServices(options);
  try {
    const record = await readWorkflow(workflowId, rootDir);
    const nextRecord = await markStaleRunningStageFailed(record, rootDir, services, options);
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

function parseDateMs(value) {
  const time = Date.parse(safeString(value));
  return Number.isFinite(time) ? time : 0;
}

function isDefaultWorkflowRoot(rootDir) {
  return path.resolve(rootDir || DEFAULT_ROOT) === path.resolve(DEFAULT_ROOT);
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

function extractRenderVersionsFromWorkflow(record) {
  const versions = record?.result?.hyperframes_freeform?.render?.render_versions;
  return Array.isArray(versions) ? versions : [];
}

function projectPathFromStageResult(value) {
  if (!value || typeof value !== 'object') return '';
  const hyperframes = value.hyperframes_freeform || {};
  return safeString(
    value.html_video_project_path
    || value.project_dir
    || value.project?.html_video_project_path
    || value.project?.project_dir
    || value.result?.html_video_project_path
    || value.result?.project_dir
    || value.result?.project?.html_video_project_path
    || value.result?.project?.project_dir
    || hyperframes.html_video_project_path
    || hyperframes.project_dir
    || hyperframes.project?.html_video_project_path
    || hyperframes.project?.project_dir,
  );
}

function extractStageHtmlVideoProjectPath(record) {
  const stages = Array.isArray(record?.stages) ? record.stages : [];
  for (const stage of stages) {
    const found = projectPathFromStageResult(stage?.result || stage?.data || stage);
    if (found) return found;
  }
  const stageResults = record?.stage_results;
  if (stageResults && typeof stageResults === 'object') {
    for (const result of Object.values(stageResults)) {
      const found = projectPathFromStageResult(result);
      if (found) return found;
    }
  }
  return '';
}

function extractHtmlVideoProjectPathFromWorkflow(record) {
  const hyperframes = record?.result?.hyperframes_freeform || {};
  const project = hyperframes.project || {};
  return safeString(
    record?.last_failure?.project_dir
    || project.html_video_project_path
    || project.project_dir
    || hyperframes.html_video_project_path
    || hyperframes.project_dir
    || extractStageHtmlVideoProjectPath(record),
  );
}

function normalizeComparablePath(value) {
  const text = safeString(value);
  if (!text) return '';
  const normalized = path.normalize(text);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function findMatchingHtmlVideoExport(project, projectDir, outputPath) {
  const output = normalizeComparablePath(outputPath);
  if (!output || !Array.isArray(project?.exports)) return null;
  return project.exports.find(item => {
    const exportPath = safeString(item?.path);
    const candidates = [
      item?.absolute_path,
      exportPath && projectDir ? path.resolve(projectDir, exportPath) : '',
      exportPath,
    ].map(normalizeComparablePath).filter(Boolean);
    return safeString(item?.id) && candidates.includes(output);
  }) || null;
}

async function enrichWorkflowVideoUrls(record) {
  const workflowId = safeString(record?.workflow_id);
  const render = record?.result?.hyperframes_freeform?.render;
  const outputPath = safeString(render?.output_path || render?.outputPath);
  if (!workflowId || !render || safeString(render.output_url) || !outputPath) return record;
  const projectDir = extractHtmlVideoProjectPathFromWorkflow(record);
  if (!projectDir) return record;
  try {
    const project = await htmlVideoProjectStore.loadProject(projectDir);
    const exportItem = findMatchingHtmlVideoExport(project, projectDir, outputPath);
    if (exportItem) render.output_url = buildHtmlVideoExportFileUrl(workflowId, exportItem.id);
  } catch {}
  return record;
}

async function readWorkflowAndHtmlVideoProject(workflowId, rootDir) {
  let record;
  try {
    record = await readWorkflow(workflowId, rootDir);
  } catch {
    return { record: null, project: null, projectDir: '', error: { success: false, code: 'NOT_FOUND', message: '未找到创作任务。' } };
  }
  const projectDir = extractHtmlVideoProjectPathFromWorkflow(record);
  if (!projectDir) {
    return { record, project: null, projectDir: '', error: null };
  }
  try {
    const project = await htmlVideoProjectStore.loadProject(projectDir);
    return { record, project, projectDir, error: null };
  } catch (error) {
    try {
      const stat = await fsp.stat(projectDir);
      if (stat.isDirectory()) {
        return {
          record,
          project: {
            workflow_id: safeString(workflowId),
            generation_checkpoint: {
              stages: {
                validate_project: {
                  status: 'failed',
                  diagnostic_code: 'project_read_failed',
                },
              },
            },
          },
          projectDir,
          projectLoadError: error,
          error: null,
        };
      }
    } catch {
      // fall through to the existing hard failure when the project directory itself is gone
    }
    return {
      record,
      project: null,
      projectDir,
      error: {
        success: false,
        code: 'NO_HTML_VIDEO_PROJECT',
        message: `读取 html-video 工程失败：${error.message}`,
      },
    };
  }
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

function buildHtmlVideoLiteProjectStageResult({ project, projectDir, renderResult, visualInspectResult } = {}) {
  const outputPath = safeString(renderResult?.output_path || renderResult?.outputPath);
  return {
    hyperframes_freeform: {
      project: {
        render_mode: 'html-video',
        html_video_project_path: projectDir,
        project_dir: projectDir,
      },
      render: {
        status: 'rendered',
        message: 'html-video production 成片已导出。',
        output_path: outputPath,
        project_status: project?.status || '',
      },
      visual_inspect: {
        status: 'done',
        message: 'html-video production 视觉质检通过。',
        report_path: visualInspectResult?.report_path || visualInspectResult?.reportPath || null,
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
      visualInspectResult: execution.visualInspectResult,
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

async function loadWorkflowWithHtmlVideoProject(workflowId, rootDir) {
  let record;
  try {
    record = await readWorkflow(workflowId, rootDir);
  } catch {
    return { record: null, project: null, projectDir: '', error: { success: false, code: 'NOT_FOUND', message: '未找到创作任务。' } };
  }
  const projectDir = extractHtmlVideoProjectPathFromWorkflow(record);
  if (!projectDir) {
    return { record, project: null, projectDir: '', error: { success: false, code: 'NO_HTML_VIDEO_PROJECT', message: '该创作任务尚未生成 html-video 工程。' } };
  }
  try {
    const project = await htmlVideoProjectStore.loadProject(projectDir);
    return { record, project, projectDir, error: null };
  } catch (error) {
    return {
      record,
      project: null,
      projectDir,
      error: {
        success: false,
        code: 'NO_HTML_VIDEO_PROJECT',
        message: `读取 html-video 工程失败：${error.message}`,
      },
    };
  }
}

async function loadWorkflowWithSceneSpec(workflowId, rootDir) {
  let record;
  try {
    record = await readWorkflow(workflowId, rootDir);
  } catch {
    return { record: null, sceneSpec: null, error: { success: false, code: 'NOT_FOUND', message: '未找到创作任务。' } };
  }
  if (!record) {
    return { record: null, sceneSpec: null, error: { success: false, code: 'NOT_FOUND', message: '未找到创作任务。' } };
  }
  const rawSceneSpec = extractSceneSpecFromWorkflow(record);
  if (!rawSceneSpec) {
    return { record, sceneSpec: null, error: { success: false, code: 'NO_SCENE_SPEC', message: '该创作任务尚未生成场景规格。' } };
  }
  const sceneSpec = sceneSpecService.normalizeSceneSpec(rawSceneSpec);
  return { record, sceneSpec, error: null };
}

async function getCreativeWorkflowVideoSpec(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { record, sceneSpec, error } = await loadWorkflowWithSceneSpec(workflowId, rootDir);
  if (error) return error;

  return {
    success: true,
    workflow_id: workflowId,
    scene_spec: sceneSpec,
    frame_specs: extractFrameSpecsFromWorkflow(record),
    render_versions: extractRenderVersionsFromWorkflow(record),
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

async function patchHtmlVideoProjectInputs(workflowId, payload = {}, options = {}) {
  const patch = payload.template_inputs_patch || payload.patch || payload.inputs || payload.template_inputs || {};
  return patchCreativeWorkflowHtmlVideoProject(workflowId, {
    type: 'template_inputs_patch',
    patch,
    summary: payload.summary || '模板字段已保存，需要重新渲染。',
  }, options);
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

async function editHtmlVideoProject(workflowId, payload = {}, options = {}) {
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
  const { record, project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;

  const templateRegistry = options.htmlVideoTemplateRegistry || createHtmlVideoTemplateRegistry(options.htmlVideoTemplateOptions || {});
  const orchestrator = options.htmlVideoProjectOrchestrator || htmlVideoProjectOrchestrator;
  const baseOptions = {
    rootDir,
    workflowId,
    runId: project.run_id || safeString(payload.run_id) || 'manual',
    projectDir,
    project,
    templateRegistry,
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

  await syncProjectStageSummariesFromProjectDir(record, result.html_video_project_path || projectDir);
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


async function getCreativeWorkflowSceneSpec(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { record, sceneSpec, error } = await loadWorkflowWithSceneSpec(workflowId, rootDir);
  if (error) return error;

  return {
    success: true,
    workflow_id: workflowId,
    scene_spec: sceneSpec,
  };
}

async function patchCreativeWorkflowVideoSpec(workflowId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { record, sceneSpec, error } = await loadWorkflowWithSceneSpec(workflowId, rootDir);
  if (error) return error;

  const nextSceneSpec = payload.scene_spec && typeof payload.scene_spec === 'object'
    ? payload.scene_spec
    : sceneSpec;
  const nextFrameSpecs = payload.frame_specs && typeof payload.frame_specs === 'object'
    ? payload.frame_specs
    : extractFrameSpecsFromWorkflow(record);
  const hyperframes = record.result.hyperframes_freeform;
  hyperframes.project.scene_spec = nextSceneSpec;
  hyperframes.project.frame_specs = nextFrameSpecs;
  record.updated_at = new Date().toISOString();
  await persistWorkflow(record, rootDir);

  return {
    success: true,
    workflow_id: workflowId,
    scene_spec: nextSceneSpec,
    frame_specs: nextFrameSpecs,
    render_versions: extractRenderVersionsFromWorkflow(record),
    requires_tts: !!payload.requires_tts,
    requires_render: true,
    message: '视频规格已保存。',
  };
}

async function patchCreativeWorkflowSceneSpec(workflowId, edit, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const editor = options.creativeVideoEditor || defaultCreativeVideoEditor;
  const { record, sceneSpec, error } = await loadWorkflowWithSceneSpec(workflowId, rootDir);
  if (error) return error;

  try {
    const result = editor.applyEditCommand(sceneSpec, edit);
    if (!result.success) {
      return { success: false, code: 'EDIT_FAILED', message: result.message };
    }
    const hyperframes = record.result.hyperframes_freeform;
    hyperframes.project.scene_spec = result.scene_spec;
    record.updated_at = new Date().toISOString();
    await persistWorkflow(record, rootDir);

    return {
      success: true,
      workflow_id: workflowId,
      scene_spec: result.scene_spec,
      edit_type: result.edit_type,
      requires_tts: result.requires_tts,
      requires_render: result.requires_render,
      message: '编辑已保存。',
    };
  } catch (error) {
    return { success: false, code: 'EDIT_FAILED', message: `编辑失败：${error.message}` };
  }
}

async function remixCreativeWorkflow(workflowId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const mediaRoot = options.mediaRoot || DEFAULT_MEDIA_ROOT;
  const { record, sceneSpec, error } = await loadWorkflowWithSceneSpec(workflowId, rootDir);
  if (error) return error;

  const frameSpecs = extractFrameSpecsFromWorkflow(record);
  const sourceInput = safeString(payload.input)
    || safeString(record.input?.raw_text)
    || safeString(record.creative_context?.input?.raw_text)
    || `二创 ${workflowId}`;
  const created = await createCreativeWorkflow({
    ...(payload || {}),
    input: sourceInput,
  }, {
    rootDir,
    mediaRoot,
    services: options.services || {},
  });
  if (!created.success) return created;

  const remixRecord = await readWorkflow(created.workflow_id, rootDir);
  remixRecord.status = 'done';
  remixRecord.success = true;
  remixRecord.source_workflow_id = workflowId;
  remixRecord.message = '二创任务已创建。';
  remixRecord.result = {
    ...(record.result || {}),
    source_workflow_id: workflowId,
    hyperframes_freeform: {
      ...(record.result?.hyperframes_freeform || {}),
      project: {
        ...(record.result?.hyperframes_freeform?.project || {}),
        scene_spec: sceneSpec,
        frame_specs: frameSpecs,
      },
    },
  };
  remixRecord.updated_at = getNow(options.services || {});
  await persistWorkflow(remixRecord, rootDir);

  return {
    success: true,
    workflow_id: created.workflow_id,
    source_workflow_id: workflowId,
    scene_spec: sceneSpec,
    frame_specs: frameSpecs,
    message: '二创任务已创建。',
  };
}

async function rewriteCreativeWorkflowScene(workflowId, sceneId, payload, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const editor = options.creativeVideoEditor || defaultCreativeVideoEditor;
  const { record, sceneSpec, error } = await loadWorkflowWithSceneSpec(workflowId, rootDir);
  if (error) return error;

  const scene = (sceneSpec.scenes || []).find(s => s.id === sceneId);
  if (!scene) {
    return { success: false, code: 'NOT_FOUND', message: `未找到场景 ${sceneId}。` };
  }

  try {
    const result = editor.applyRewriteResult(sceneSpec, sceneId, payload);
    if (!result.success) {
      return { success: false, code: 'REWRITE_FAILED', message: result.message };
    }
    const hyperframes = record.result.hyperframes_freeform;
    hyperframes.project.scene_spec = result.scene_spec;
    record.updated_at = new Date().toISOString();
    await persistWorkflow(record, rootDir);

    return {
      success: true,
      workflow_id: workflowId,
      scene_spec: result.scene_spec,
      requires_tts: result.requires_tts,
      requires_render: result.requires_render,
      message: '场景已重写。',
    };
  } catch (error) {
    return { success: false, code: 'REWRITE_FAILED', message: `重写失败：${error.message}` };
  }
}

async function ttsCreativeWorkflowScene(workflowId, sceneId, payload, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const rerender = options.creativeVideoRerender || defaultCreativeVideoRerender;
  const { record, sceneSpec, error } = await loadWorkflowWithSceneSpec(workflowId, rootDir);
  if (error) return error;

  const scene = (sceneSpec.scenes || []).find(s => s.id === sceneId);
  if (!scene) {
    return { success: false, code: 'NOT_FOUND', message: `未找到场景 ${sceneId}。` };
  }

  const hyperframes = record.result.hyperframes_freeform;
  const previousOutputPath = hyperframes?.render?.output_path || '';
  const projectDir = extractHtmlVideoProjectPathFromWorkflow(record);
  const inputServices = options.services || {};
  const readAudioDuration = inputServices.readAudioDuration || (async filePath => {
    const duration = await defaultTtsTimeline.readAudioDuration(filePath, options.audioDurationOptions || {});
    return duration?.success ? duration.duration : 0;
  });

  try {
    const result = await rerender.rerenderSceneWithLocalTts({
      workflowId,
      sceneSpec,
      sceneId,
      projectDir,
      outputPath: payload?.outputPath || previousOutputPath,
      previousOutputPath,
      services: {
        ...inputServices,
        ttsService: inputServices.ttsService || defaultCreativeVideoTtsService,
        readAudioDuration,
      },
    });

    if (result.success) {
      const requiresRender = result.requires_render === true;
      hyperframes.render = {
        ...hyperframes.render,
        status: requiresRender ? 'needs_render' : 'ready',
        ...(result.output_path ? { output_path: result.output_path } : {}),
        message: result.message || (requiresRender ? '场景配音已更新，需要重新导出成片。' : '场景配音已更新。'),
      };
      if (result.scene_spec) {
        hyperframes.project.scene_spec = result.scene_spec;
      }
      record.updated_at = new Date().toISOString();
      await persistWorkflow(record, rootDir);
    }

    return {
      success: result.success,
      workflow_id: workflowId,
      scene_id: sceneId,
      scene_spec: result.scene_spec || sceneSpec,
      output_path: result.output_path || previousOutputPath,
      previous_output_path: result.previous_output_path,
      requires_render: result.requires_render === true,
      message: result.message || (result.success ? '场景配音已更新。' : '场景配音失败。'),
    };
  } catch (error) {
    return { success: false, code: 'TTS_FAILED', message: `场景配音失败：${error.message}` };
  }
}

async function rerenderCreativeWorkflow(workflowId, payload, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const rerender = options.creativeVideoRerender || defaultCreativeVideoRerender;
  const { record, sceneSpec, error } = await loadWorkflowWithSceneSpec(workflowId, rootDir);
  if (error) return error;

  const hyperframes = record.result.hyperframes_freeform;
  const previousOutputPath = hyperframes?.render?.output_path || '';

  try {
    const result = await rerender.rerenderSceneSpecProject({
      workflowId,
      sceneSpec,
      outputPath: payload?.outputPath || previousOutputPath,
      previousOutputPath,
      services: options.services || {},
    });

    if (result.success) {
      hyperframes.render = {
        ...hyperframes.render,
        status: 'ready',
        output_path: result.output_path,
        message: '成片已重新渲染。',
      };
      if (result.scene_spec) {
        hyperframes.project.scene_spec = result.scene_spec;
      }
      record.updated_at = new Date().toISOString();
      await persistWorkflow(record, rootDir);
    }

    return {
      success: result.success,
      workflow_id: workflowId,
      output_path: result.output_path,
      previous_output_path: result.previous_output_path,
      message: result.message || (result.success ? '成片已重新渲染。' : '重新渲染失败。'),
    };
  } catch (error) {
    return { success: false, code: 'RENDER_FAILED', message: `重新渲染失败：${error.message}` };
  }
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
  getCreativeWorkflowVideoSpec,
  getCreativeWorkflowHtmlVideoProject,
  patchCreativeWorkflowHtmlVideoProject,
  renderCreativeWorkflowHtmlVideoProject,
  patchHtmlVideoProjectInputs,
  patchHtmlVideoProjectFrame,
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
  editHtmlVideoProject,
  renderHtmlVideoProject,
  exportHtmlVideoProject,
  listHtmlVideoProjectExports,
  getHtmlVideoProjectExportFile,
  extractHtmlVideoProjectPathFromWorkflow,
  patchCreativeWorkflowVideoSpec,
  getCreativeWorkflowSceneSpec,
  patchCreativeWorkflowSceneSpec,
  rewriteCreativeWorkflowScene,
  ttsCreativeWorkflowScene,
  rerenderCreativeWorkflow,
  remixCreativeWorkflow,
  runResearchProvider,
  defaultResearchProvider,
  defaultWebSearchProvider,
};
