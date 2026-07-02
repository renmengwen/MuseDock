export const STAGE_LABELS = {
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

export const DEFAULT_STAGES = Object.entries(STAGE_LABELS).map(([id, label]) => ({
  id,
  label,
  status: 'waiting',
}));

export const STATUS_TEXT = {
  waiting: '等待中',
  pending: '排队中',
  queued: '排队中',
  running: '进行中',
  done: '已完成',
  skipped: '已跳过',
  failed: '失败',
};

export function getStatusClass(status) {
  if (status === 'done' || status === 'skipped') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'queued' || status === 'pending' || status === 'running') return 'pending';
  return '';
}

export function getStatusMessageClass(status) {
  if (status === 'creating' || status === 'polling') return 'loading';
  if (status === 'done') return 'success';
  if (status === 'failed') return 'error';
  return 'info';
}

export function getWorkflowStatusText(workflow, fallbackStatus = 'idle') {
  const nextStatus = workflow?.status || fallbackStatus;
  if (!workflow && fallbackStatus === 'idle') return '等待输入';
  return STATUS_TEXT[nextStatus] || nextStatus || '等待中';
}

export function normalizeWorkflowStages(workflow) {
  const source = Array.isArray(workflow?.stages) && workflow.stages.length ? workflow.stages : DEFAULT_STAGES;
  return source.map(stage => ({
    ...stage,
    label: stage.label || STAGE_LABELS[stage.id] || stage.id || '未命名阶段',
    status: workflow?.status === 'running' && workflow?.current_stage === stage.id
      ? 'running'
      : (stage.status || 'waiting'),
    message: workflow?.status === 'running' && workflow?.current_stage === stage.id
      ? (workflow.current_stage_message || stage.message || '')
      : stage.message,
  }));
}

export function getStepState(stage, index, stages) {
  if (stage.status === 'done') return 'done';
  if (stage.status === 'skipped') return 'done';
  if (stage.status === 'failed') return 'failed';
  if (stage.status === 'running') return 'active';
  if (stage.status === 'queued' || stage.status === 'pending') return 'queued';
  const hasActiveBefore = stages.slice(0, index).some(item => (
    item.status === 'running'
    || item.status === 'queued'
    || item.status === 'pending'
    || item.status === 'failed'
  ));
  return hasActiveBefore ? 'waiting' : '';
}
