const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const creativeContext = require('./creativeContext');
const defaultResearchService = require('./researchService');
const mediaPipeline = require('./mediaPipeline');
const defaultAgentRuns = require('./agentRuns');

const DEFAULT_ROOT = path.join(__dirname, '../../data/creative-workflows');
const DEFAULT_MEDIA_ROOT = path.join(__dirname, '../../data/media/douyin');
const WORKFLOW_ID_PATTERN = /^\d{5,32}$/;

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

function resolveServices(options = {}) {
  const services = options.services || {};
  return {
    ...services,
    researchService: services.researchService || defaultResearchService,
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
  const startedAt = getNow(services);
  await markStage(record, stageId, 'running', `正在${STAGE_LABELS[stageId]}...`, startedAt, {
    started_at: startedAt,
  });
  record.status = 'running';
  record.updated_at = startedAt;
  await persistWorkflow(record, rootDir);

  try {
    const result = await handler();
    const completedAt = getNow(services);
    await markStage(record, stageId, 'done', result?.message || `${STAGE_LABELS[stageId]}完成。`, completedAt, {
      completed_at: completedAt,
      result,
    });
    record.updated_at = completedAt;
    await persistWorkflow(record, rootDir);
    return result;
  } catch (error) {
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

  const failIfNull = result => {
    if (result === null) {
      return true;
    }
    return false;
  };

  if (failIfNull(await runStage(record, 'source', rootDir, async () => (
    ensureSuccess(await prepareSource(record, mediaRoot, getNow(services), services), '来源资料准备失败。')
  ), services))) {
    return createWorkflowSummary(record);
  }

  if (failIfNull(await runStage(record, 'research', rootDir, async () => {
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
  }, services))) {
    return createWorkflowSummary(record);
  }

  if (failIfNull(await runStage(record, 'assets', rootDir, async () => ({
    success: true,
    message: '图片素材将在下一阶段开放，当前任务继续使用来源上下文。',
    asset_context: record.asset_context,
  }), services))) {
    return createWorkflowSummary(record);
  }

  if (failIfNull(await runStage(record, 'agent_run', rootDir, async () => {
    const result = ensureSuccess(
      await services.agentRuns.createDouyinHyperframesFreeformRun(record.aweme_id, { rootDir: mediaRoot }),
      '导演改写任务创建失败。',
    );
    record.run_id = safeString(result.run_id);
    if (!record.run_id) {
      throw new Error('导演改写任务未返回 run_id。');
    }
    return result;
  }, services))) {
    return createWorkflowSummary(record);
  }

  if (failIfNull(await runStage(record, 'brief', rootDir, async () => ensureSuccess(
    await services.agentRuns.generateDouyinRunHyperframesFreeformBrief(record.aweme_id, record.run_id, {
      rootDir: mediaRoot,
      briefOptions: {
        creative_context: record.creative_context,
      },
    }),
    '成片策划失败。',
  ), services))) {
    return createWorkflowSummary(record);
  }

  if (failIfNull(await runStage(record, 'audio', rootDir, async () => ensureSuccess(
    await services.agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(record.aweme_id, record.run_id, {
      rootDir: mediaRoot,
    }),
    '音频轨生成失败。',
  ), services))) {
    return createWorkflowSummary(record);
  }

  if (failIfNull(await runStage(record, 'project', rootDir, async () => ensureSuccess(
    await services.agentRuns.generateDouyinRunHyperframesFreeformProject(record.aweme_id, record.run_id, {
      rootDir: mediaRoot,
      projectOptions: {
        creative_context: record.creative_context,
      },
    }),
    '工程生成失败。',
  ), services))) {
    return createWorkflowSummary(record);
  }

  if (failIfNull(await runStage(record, 'check', rootDir, async () => ensureSuccess(
    await services.agentRuns.checkDouyinRunHyperframesFreeformProject(record.aweme_id, record.run_id, {
      rootDir: mediaRoot,
    }),
    '工程校验失败。',
  ), services))) {
    return createWorkflowSummary(record);
  }

  if (failIfNull(await runStage(record, 'render', rootDir, async () => ensureSuccess(
    await services.agentRuns.renderDouyinRunHyperframesFreeformVideo(record.aweme_id, record.run_id, {
      rootDir: mediaRoot,
    }),
    '视频渲染失败。',
  ), services))) {
    return createWorkflowSummary(record);
  }

  const inspectResult = await runStage(record, 'inspect', rootDir, async () => ensureSuccess(
    await services.agentRuns.inspectDouyinRunHyperframesFreeformVideo(record.aweme_id, record.run_id, {
      rootDir: mediaRoot,
    }),
    '视频巡检失败。',
  ), services);
  if (failIfNull(inspectResult)) {
    return createWorkflowSummary(record);
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
  try {
    const record = await readWorkflow(workflowId, rootDir);
    return {
      success: true,
      data: record,
    };
  } catch (error) {
    return {
      success: false,
      workflow_id: safeString(workflowId),
      message: '未找到创作任务。',
    };
  }
}

module.exports = {
  STAGE_IDS,
  STAGE_LABELS,
  createCreativeWorkflow,
  runCreativeWorkflow,
  getCreativeWorkflow,
  getWorkflowPath,
  makeLocalCreativeAwemeId,
};
