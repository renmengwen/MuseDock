const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_ROOT = path.join(require('../../dataRoot'), 'data/creative-workflows');
const DEFAULT_MEDIA_ROOT = path.join(require('../../dataRoot'), 'data/media/douyin');
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

const workflowFileQueues = new Map();

function safeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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
  const repairAttempt = Number(input.repair_attempt ?? input.repairAttempt);
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
    repair_attempt: Number.isFinite(repairAttempt) ? repairAttempt : null,
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

function isPathInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isPathSameOrInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
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

function parseDateMs(value) {
  const time = Date.parse(safeString(value));
  return Number.isFinite(time) ? time : 0;
}

function isDefaultWorkflowRoot(rootDir) {
  return path.resolve(rootDir || DEFAULT_ROOT) === path.resolve(DEFAULT_ROOT);
}

module.exports = {
  DEFAULT_ROOT,
  DEFAULT_MEDIA_ROOT,
  WORKFLOW_ID_PATTERN,
  STAGE_IDS,
  STAGE_LABELS,
  safeString,
  plainObject,
  getNow,
  nullableNumber,
  normalizeModelUsage,
  makeId,
  appendWorkflowModelCall,
  makeLocalCreativeAwemeId,
  getWorkflowPath,
  isPathInside,
  isPathSameOrInside,
  createStages,
  normalizeStages,
  delay,
  isTransientRenameError,
  renameWithRetry,
  withWorkflowFileQueue,
  writeJson,
  readJson,
  readWorkflow,
  workflowFileExists,
  persistWorkflow,
  persistWorkflowUnlocked,
  parseDateMs,
  isDefaultWorkflowRoot,
};
