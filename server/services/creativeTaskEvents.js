const STAGE_WEIGHTS = Object.freeze({
  source: 5,
  research: 5,
  assets: 5,
  agent_run: 5,
  brief: 15,
  audio: 15,
  project: 35,
  check: 5,
  render: 5,
  inspect: 5,
});

const PROJECT_WEIGHTS = Object.freeze({
  template: 5,
  graph: 10,
  frame_html: 35,
  materialize: 5,
  frame_render: 30,
  compose: 10,
  inspect: 5,
});

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeSinceSeq(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return Math.floor(number);
}

function normalizeString(value) {
  return typeof value === 'string' ? value : '';
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sumWeightsBefore(weights, key) {
  let total = 0;
  for (const [currentKey, weight] of Object.entries(weights)) {
    if (currentKey === key) {
      return total;
    }
    total += weight;
  }
  return 0;
}

function sumActiveStageWeights(skippedStages) {
  const skipped = new Set(Array.isArray(skippedStages) ? skippedStages : []);
  return Object.entries(STAGE_WEIGHTS).reduce((total, [stage, weight]) => {
    return skipped.has(stage) ? total : total + weight;
  }, 0);
}

function normalizeWorkflowProgressForSkippedStages(progress, skippedStages) {
  if (!Array.isArray(skippedStages) || skippedStages.length === 0) {
    return clampPercent(progress);
  }

  const activeTotal = sumActiveStageWeights(skippedStages);
  if (activeTotal <= 0) {
    return clampPercent(progress);
  }

  return clampPercent((progress / activeTotal) * 100);
}

function createTaskEvent(input = {}) {
  const now = typeof input.now === 'function' ? input.now : () => new Date().toISOString();

  return {
    seq: normalizeSinceSeq(input.seq),
    task_id: normalizeString(input.task_id ?? input.taskId),
    workflow_id: normalizeString(input.workflow_id ?? input.workflowId),
    operation_id: normalizeString(input.operation_id ?? input.operationId),
    type: normalizeString(input.type),
    stage: normalizeString(input.stage),
    progress: clampPercent(input.progress),
    message: normalizeString(input.message),
    data: isPlainObject(input.data) ? input.data : {},
    time: normalizeString(now()),
  };
}

function calculateWorkflowProgress({ stage, stageProgress = 0, skippedStages = [] } = {}) {
  const progress = clampPercent(stageProgress);
  let rawProgress;

  if (stage === 'source') {
    rawProgress = (progress / 100) * STAGE_WEIGHTS.source;
    return normalizeWorkflowProgressForSkippedStages(rawProgress, skippedStages);
  }

  if (stage === 'project') {
    const projectStart = sumWeightsBefore(STAGE_WEIGHTS, 'project');
    const projectEnd = sumWeightsBefore(STAGE_WEIGHTS, 'check');
    rawProgress = Math.min(projectEnd, Math.max(projectStart, STAGE_WEIGHTS.source + progress));
    return normalizeWorkflowProgressForSkippedStages(rawProgress, skippedStages);
  }

  if (stage === 'inspect') {
    rawProgress = sumWeightsBefore(STAGE_WEIGHTS, 'inspect') + (progress / 100) * STAGE_WEIGHTS.inspect;
    return normalizeWorkflowProgressForSkippedStages(rawProgress, skippedStages);
  }

  if (!Object.prototype.hasOwnProperty.call(STAGE_WEIGHTS, stage)) {
    return 0;
  }

  rawProgress = sumWeightsBefore(STAGE_WEIGHTS, stage) + (progress / 100) * STAGE_WEIGHTS[stage];
  return normalizeWorkflowProgressForSkippedStages(rawProgress, skippedStages);
}

function calculateProjectProgress({ step, index = 0, total = 1, stepProgress = 0 } = {}) {
  if (!Object.prototype.hasOwnProperty.call(PROJECT_WEIGHTS, step)) {
    return 0;
  }

  const base = sumWeightsBefore(PROJECT_WEIGHTS, step);
  const progress = clampPercent(stepProgress);
  const weight = PROJECT_WEIGHTS[step];

  if ((step === 'frame_html' || step === 'frame_render') && Number(total) > 0) {
    const normalizedTotal = Math.max(1, Math.floor(Number(total)));
    const normalizedIndex = Math.max(0, Math.min(normalizedTotal - 1, Math.floor(Number(index))));
    const completed = (normalizedIndex / normalizedTotal) * weight;
    const current = (progress / 100) * (weight / normalizedTotal);
    return clampPercent(base + completed + current);
  }

  return clampPercent(base + (progress / 100) * weight);
}

function isTerminalEvent(event = {}) {
  return event.type === 'task_done' || event.type === 'task_failed' || event.type === 'workflow_deleted';
}

function formatSseEvent(event = {}) {
  const seq = normalizeSinceSeq(event.seq);
  const type = normalizeString(event.type) || 'message';
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}

module.exports = {
  STAGE_WEIGHTS,
  PROJECT_WEIGHTS,
  normalizeSinceSeq,
  createTaskEvent,
  calculateWorkflowProgress,
  calculateProjectProgress,
  isTerminalEvent,
  formatSseEvent,
};
