const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const creativeContext = require('./creativeContext');
const defaultResearchService = require('./researchService');
const mediaPipeline = require('./mediaPipeline');
const defaultAgentRuns = require('./agentRuns');
const defaultCreativeVideoEditor = require('./creativeVideoEditor');
const defaultCreativeVideoRerender = require('./creativeVideoRerender');
const sceneSpecService = require('./sceneSpec');
const aiTextModel = require('./aiTextModel');

const DEFAULT_ROOT = path.join(__dirname, '../../data/creative-workflows');
const DEFAULT_MEDIA_ROOT = path.join(__dirname, '../../data/media/douyin');
const WORKFLOW_ID_PATTERN = /^\d{5,32}$/;
const DEFAULT_STALE_STAGE_TIMEOUT_MS = 10 * 60 * 1000;
const WORKFLOW_STOPPED = Symbol('workflow-stopped');

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

function getNow(services = {}) {
  if (typeof services.now === 'function') {
    return safeString(services.now()) || new Date().toISOString();
  }
  return new Date().toISOString();
}

function makeId(now = new Date().toISOString()) {
  const stamp = safeString(now).replace(/\D/g, '').slice(0, 14)
    || new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const random = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  return `${stamp}${random}`;
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

async function writeJson(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
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

async function defaultResearchProvider({ query } = {}) {
  const messages = [
    {
      role: 'system',
      content: '你是一个联网研究助手。请搜索最新资料，为用户提供准确、有帮助的信息。',
    },
    {
      role: 'user',
      content: `请搜索并研究以下主题：${query}`,
    },
  ];

  // 获取模型配置，判断是否为mimo模型
  const aiModelConfig = require('./aiModelConfig');
  const config = await aiModelConfig.getRuntimeConfig('text');
  const modelId = config?.modelId || '';
  const isMimo = modelId.toLowerCase().startsWith('mimo');

  // 根据模型类型选择工具格式
  let tools;
  let toolChoice;

  if (isMimo) {
    // mimo-v2.5-pro 的 web_search 工具格式
    tools = [
      {
        type: 'web_search',
        max_keyword: 3,
        force_search: true,
        limit: 5,
      },
    ];
    toolChoice = 'auto';
  } else {
    // OpenAI 标准格式
    tools = [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: '搜索互联网获取最新信息',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: '搜索关键词',
              },
            },
            required: ['query'],
          },
        },
      },
    ];
    toolChoice = { type: 'function', function: { name: 'web_search' } };
  }

  try {
    const result = await aiTextModel.callTextModel({
      messages,
      tools,
      tool_choice: toolChoice,
      temperature: 0.3,
      stream: false,
    });

    if (!result.success) {
      throw new Error(result.message || '文本模型调用失败');
    }

    // 从响应中提取搜索结果
    const text = result.text || '';
    const rawResponse = result.raw_response || {};

    // 尝试从raw_response中提取搜索结果
    let sources = [];
    if (rawResponse.choices && rawResponse.choices[0] && rawResponse.choices[0].message) {
      const message = rawResponse.choices[0].message;
      // mimo的搜索结果可能在message的某个字段中
      if (message.tool_calls) {
        // 解析tool_calls中的搜索结果
        for (const toolCall of message.tool_calls) {
          if (toolCall.function && toolCall.function.name === 'web_search') {
            try {
              const searchResult = JSON.parse(toolCall.function.arguments);
              if (searchResult.results) {
                sources = searchResult.results.map(item => ({
                  title: item.title || '',
                  url: item.url || item.link || '',
                  summary: item.snippet || item.description || '',
                }));
              }
            } catch {
              // 解析失败，继续
            }
          }
        }
      }
    }

    // 如果没有从tool_calls中提取到，尝试从文本中提取
    if (sources.length === 0) {
      // 尝试从文本中提取URL和标题
      const urlRegex = /https?:\/\/[^\s]+/g;
      const urls = text.match(urlRegex) || [];
      sources = urls.slice(0, 5).map(url => ({
        title: '',
        url: url,
        summary: '',
      }));
    }

    return {
      summary: text,
      sources: sources,
    };
  } catch (error) {
    throw new Error(`联网研究失败：${error.message}`);
  }
}

function resolveServices(options = {}) {
  const services = options.services || {};
  return {
    ...services,
    researchService: services.researchService || defaultResearchService,
    researchProvider: services.researchProvider || defaultResearchProvider,
    mediaPipeline: services.mediaPipeline || mediaPipeline,
    agentRuns: services.agentRuns || defaultAgentRuns,
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
    stages: normalizeStages(record.stages),
    creative_context: record.creative_context,
    source_context: record.source_context,
    research_context: record.research_context,
    asset_context: record.asset_context,
    result: record.result,
    error: record.error,
  };
}

async function createCreativeWorkflow(payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const services = resolveServices(options);
  const now = getNow(services);
  const normalized = creativeContext.normalizeCreativeInput(payload);
  if (!normalized.success) {
    return normalizeFailureResult(normalized, payload);
  }

  const workflowId = safeString(typeof services.idFactory === 'function' ? services.idFactory() : makeId(now));
  const awemeId = normalized.data.mode === 'douyin'
    ? normalized.data.aweme_id
    : makeLocalCreativeAwemeId(workflowId);
  const sourceContext = normalized.data.mode === 'douyin'
    ? createDouyinSourceContext(normalized.data)
    : creativeContext.createTextSourceContext(normalized.data.raw_text);
  const researchContext = await services.researchService.createResearchContext({
    enabled: normalized.data.use_research,
    query: normalized.data.raw_text || normalized.data.aweme_id,
    now,
    provider: services.researchProvider,
  });
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
    input: normalized.data,
    source_context: sourceContext,
    research_context: researchContext,
    asset_context: assetContext,
    creative_context: creative,
    stages,
    result: null,
    error: null,
    skipValidation: normalized.data.skip_validation === true,
    created_at: now,
    updated_at: now,
  };

  const persisted = await persistWorkflow(record, rootDir);
  return createWorkflowSummary(persisted);
}

async function writeSyntheticTextWorkspace(record, mediaRoot, now) {
  const paths = mediaPipeline.getMediaPaths(record.aweme_id, mediaRoot);
  const text = safeString(record.creative_context?.input?.raw_text);
  await fsp.mkdir(paths.framesDir, { recursive: true });

  await writeJson(paths.metadata, {
    aweme_id: record.aweme_id,
    source_type: 'creative_text',
    title: text.slice(0, 80),
    description: text,
    creative_workflow_id: record.workflow_id,
    created_at: record.created_at,
    updated_at: now,
  });

  await writeJson(paths.transcript, {
    success: true,
    status: 'done',
    source_type: 'creative_text',
    text,
    updated_at: now,
  });

  await writeJson(paths.analysisInput, {
    aweme_id: record.aweme_id,
    video: {
      title: text.slice(0, 80),
      description: text,
      author: {},
      statistics: {},
      aweme_url: '',
    },
    local_assets: {
      dir: paths.dir,
      metadata: paths.metadata,
      video: '',
      audio: '',
      frames: [],
    },
    comments_summary: {
      status: 'disabled',
      message: '纯文本创作来源暂无评论素材。',
    },
    transcript: {
      status: 'done',
      path: paths.transcript,
    },
    steps: {
      metadata: { status: 'done', path: paths.metadata },
      transcript: { status: 'done', path: paths.transcript },
      analysis_input: { status: 'done', path: paths.analysisInput },
    },
    creative_context: record.creative_context,
    updated_at: now,
  });

  return {
    success: true,
    message: '纯文本来源资料已准备完成。',
    paths,
  };
}

function hasPreparedLocalMedia(analysisInput = {}, status = {}) {
  if (status && Object.prototype.hasOwnProperty.call(status, 'assets')) {
    const localAssets = analysisInput.local_assets || {};
    const localVideo = safeString(localAssets.video);
    const statusVideo = safeString(status.assets?.video?.path);
    const analysisFrames = Array.isArray(localAssets.frames) ? localAssets.frames : [];
    const statusFramePaths = new Set(
      (Array.isArray(status.frames) ? status.frames : [])
        .map(frame => safeString(frame?.path))
        .filter(Boolean)
        .map(framePath => path.resolve(framePath)),
    );
    const hasMatchingFrame = analysisFrames.some(framePath => (
      statusFramePaths.has(path.resolve(safeString(framePath)))
    ));
    return !!(
      (localVideo && statusVideo && path.resolve(localVideo) === path.resolve(statusVideo))
      || hasMatchingFrame
    );
  }

  const localAssets = analysisInput.local_assets || {};
  const analysisFrames = Array.isArray(localAssets.frames) ? localAssets.frames : [];
  return !!(
    safeString(localAssets.video)
    || analysisFrames.length > 0
  );
}

function hasReusableDouyinSource(status) {
  return !!(
    status
    && status.success !== false
    && status.exists
    && status.analysis_input
    && hasPreparedLocalMedia(status.analysis_input, status)
  );
}

function createDouyinDetailFailureMessage(detail = {}) {
  if (detail.needLogin) {
    return '需要先登录抖音后才能获取视频资料，请扫码登录后重试。';
  }
  if (detail.needVerify) {
    return '抖音需要完成验证后才能获取视频资料，请完成验证后重试。';
  }
  const detailMessage = safeString(detail.message || detail.error);
  return detailMessage
    ? `获取抖音视频资料失败：${detailMessage}`
    : '获取抖音视频资料失败，请稍后重试。';
}

function resolveDouyinDetailGetter(services = {}) {
  if (typeof services.getVideoDetail === 'function') {
    return services.getVideoDetail;
  }
  if (typeof services.douyinDetailService?.getVideoDetail === 'function') {
    return services.douyinDetailService.getVideoDetail.bind(services.douyinDetailService);
  }
  return require('../scraper/douyin').getVideoDetail;
}

function updatePreparedDouyinSourceContext(record, metadata = {}, result = {}, now) {
  const analysisInput = result.analysis_input || {};
  const video = analysisInput.video || {};
  const title = safeString(metadata.title || video.title);
  const description = safeString(metadata.description || video.description);
  const sourceContext = {
    ...(record.source_context || {}),
    ...(record.creative_context?.source_context || {}),
    status: 'ready',
    kind: 'douyin',
    summary: title || description || `抖音视频 ${record.aweme_id}`,
    transcript: safeString(record.creative_context?.source_context?.transcript),
    comments_summary: safeString(record.creative_context?.source_context?.comments_summary),
    douyin_metadata: {
      ...(record.creative_context?.source_context?.douyin_metadata || {}),
      ...metadata,
      aweme_id: safeString(metadata.aweme_id || record.aweme_id),
      title,
      description,
    },
    diagnostics: {
      ...(record.creative_context?.source_context?.diagnostics || {}),
      source_type: 'douyin',
      prepared_at: now,
      cache: result.cache || null,
      steps: result.steps || {},
    },
  };

  record.source_context = sourceContext;
  record.creative_context = {
    ...record.creative_context,
    source_context: sourceContext,
  };
  return sourceContext;
}

async function prepareDouyinSource(record, mediaRoot, now, services = {}) {
  const pipeline = services.mediaPipeline || mediaPipeline;
  const awemeId = safeString(record.aweme_id);
  const status = await pipeline.getStatus(awemeId, { rootDir: mediaRoot });

  if (hasReusableDouyinSource(status)) {
    updatePreparedDouyinSourceContext(record, status.metadata || {}, {
      analysis_input: status.analysis_input,
      cache: { metadata: 'local', force: false },
      steps: status.steps || {},
    }, now);
    return {
      success: true,
      message: '已复用本地抖音素材。',
      status,
    };
  }

  let metadata = status?.metadata?.aweme_id ? status.metadata : null;
  let detail = null;

  if (!metadata) {
    const getVideoDetail = resolveDouyinDetailGetter(services);
    detail = await getVideoDetail(awemeId);
    if (!detail || detail.success === false || detail.needLogin || detail.needVerify) {
      return {
        success: false,
        message: createDouyinDetailFailureMessage(detail || {}),
        detail_diagnostic: detail?.diagnostic,
      };
    }
    metadata = detail.data;
  }

  if (!metadata?.aweme_id) {
    return {
      success: false,
      aweme_id: awemeId,
      message: '抖音视频资料缺少 aweme_id，无法准备本地素材。',
      detail_diagnostic: detail?.diagnostic,
    };
  }

  const prepared = await pipeline.prepareDouyinMedia(awemeId, metadata, {
    rootDir: mediaRoot,
    force: false,
  });
  if (!prepared || prepared.success === false) {
    return {
      success: false,
      message: safeString(prepared?.message || prepared?.error) || '抖音素材准备失败，请稍后重试。',
      result: prepared,
    };
  }

  const preparedStatus = await pipeline.getStatus(awemeId, { rootDir: mediaRoot });
  if (!hasReusableDouyinSource(preparedStatus)) {
    return {
      success: false,
      message: '抖音素材准备失败：未生成可用的本地视频或关键帧。',
      result: prepared,
      status: preparedStatus,
    };
  }

  updatePreparedDouyinSourceContext(record, preparedStatus.metadata || metadata, {
    ...preparedStatus,
    cache: prepared.cache || { metadata: detail ? 'remote' : 'local', force: false },
  }, now);
  return {
    ...prepared,
    success: true,
    message: detail ? '抖音来源资料已获取并准备完成。' : '已复用本地抖音元数据并准备素材。',
    detail_diagnostic: detail?.diagnostic,
    elapsed: detail?.elapsed,
  };
}

async function prepareSource(record, mediaRoot, now, services = {}) {
  if (record.creative_context?.input?.mode === 'text') {
    return writeSyntheticTextWorkspace(record, mediaRoot, now);
  }

  return prepareDouyinSource(record, mediaRoot, now, services);
}

function ensureSuccess(result, fallbackMessage) {
  if (!result || result.success === false) {
    throw new Error(safeString(result && result.message) || fallbackMessage);
  }
  return result;
}

async function markStage(record, stageId, status, message, now, extra = {}) {
  updateStage(record, stageId, {
    status,
    message: safeString(message),
    updated_at: now,
    ...extra,
  });
}

async function runStage(record, stageId, rootDir, handler, services) {
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

  try {
    const result = await handler();
    if (!await workflowFileExists(record.workflow_id, rootDir)) {
      return WORKFLOW_STOPPED;
    }

    const completedAt = getNow(services);
    await markStage(record, stageId, 'done', result?.message || `${STAGE_LABELS[stageId]}完成。`, completedAt, {
      completed_at: completedAt,
      result,
    });
    record.updated_at = completedAt;
    await persistWorkflow(record, rootDir);
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
    record.updated_at = failedAt;
    await persistWorkflow(record, rootDir);
    return null;
  }
}

async function runCreativeWorkflow(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const mediaRoot = options.mediaRoot || DEFAULT_MEDIA_ROOT;
  const services = resolveServices(options);
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

  const failIfStoppedOrNull = result => {
    if (result === WORKFLOW_STOPPED) {
      return createWorkflowStoppedSummary(workflowId);
    }
    if (result === null) {
      return createWorkflowSummary(record);
    }
    return null;
  };

  let stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'source', rootDir, async () => (
    ensureSuccess(await prepareSource(record, mediaRoot, getNow(services), services), '来源资料准备失败。')
  ), services));
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'research', rootDir, async () => {
    if (record.research_context?.status === 'failed') {
      throw new Error(record.research_context.summary || '联网研究失败。');
    }
    return {
      success: true,
      message: record.research_context?.status === 'disabled'
        ? '联网研究已关闭，继续下一步。'
        : '联网研究资料已准备完成。',
      research_context: record.research_context,
    };
  }, services));
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'assets', rootDir, async () => ({
    success: true,
    message: '图片素材将在下一阶段开放，当前任务继续使用来源上下文。',
    asset_context: record.asset_context,
  }), services));
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
  }, services));
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
  ), services));
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'audio', rootDir, async () => ensureSuccess(
    await services.agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(record.aweme_id, record.run_id, {
      rootDir: mediaRoot,
    }),
    '音频轨生成失败。',
  ), services));
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  let skipValidation = options.skipValidation === true;
  if (!skipValidation && services.aiModelConfig) {
    try { skipValidation = await services.aiModelConfig.getSkipValidation({ rootDir }); } catch {}
  }

  stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'project', rootDir, async () => ensureSuccess(
    await services.agentRuns.generateDouyinRunHyperframesFreeformProject(record.aweme_id, record.run_id, {
      rootDir: mediaRoot,
      useHtmlVideoLiteWorkflow: true,
      skipValidation,
      projectOptions: {
        creative_context: record.creative_context,
      },
    }),
    '工程生成失败。',
  ), services));
  if (stoppedOrFailed) {
    return stoppedOrFailed;
  }

  if (!skipValidation) {
    stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'check', rootDir, async () => ensureSuccess(
      await services.agentRuns.checkDouyinRunHyperframesFreeformProject(record.aweme_id, record.run_id, {
        rootDir: mediaRoot,
      }),
      '工程校验失败。',
    ), services));
    if (stoppedOrFailed) {
      return stoppedOrFailed;
    }
  }

  stoppedOrFailed = failIfStoppedOrNull(await runStage(record, 'render', rootDir, async () => ensureSuccess(
    await services.agentRuns.renderDouyinRunHyperframesFreeformVideo(record.aweme_id, record.run_id, {
      rootDir: mediaRoot,
    }),
    '视频渲染失败。',
  ), services));
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
    ), services);
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
      data: nextRecord,
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

  try {
    const result = await rerender.rerenderSceneWithLocalTts({
      workflowId,
      sceneSpec,
      sceneId,
      outputPath: payload?.outputPath || previousOutputPath,
      previousOutputPath,
      services: options.services || {},
    });

    if (result.success) {
      hyperframes.render = {
        ...hyperframes.render,
        status: 'ready',
        output_path: result.output_path,
        message: '场景配音已更新。',
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
      output_path: result.output_path,
      previous_output_path: result.previous_output_path,
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
  deleteCreativeWorkflow,
  getWorkflowPath,
  makeLocalCreativeAwemeId,
  recoverStaleWorkflowsOnStartup,
  getCreativeWorkflowVideoSpec,
  patchCreativeWorkflowVideoSpec,
  getCreativeWorkflowSceneSpec,
  patchCreativeWorkflowSceneSpec,
  rewriteCreativeWorkflowScene,
  ttsCreativeWorkflowScene,
  rerenderCreativeWorkflow,
  remixCreativeWorkflow,
};
