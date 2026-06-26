export function toValidDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeWorkflowProgress(workflow) {
  const value = Number(workflow?.current_progress);
  if (!Number.isFinite(value) && workflow?.status === 'done') return 100;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  const restSeconds = seconds % 60;
  if (hours > 0) return `用时 ${hours} 小时 ${restMinutes} 分 ${restSeconds} 秒`;
  if (minutes > 0) return `用时 ${minutes} 分 ${restSeconds} 秒`;
  return `用时 ${restSeconds} 秒`;
}

function getDoneAt(workflow) {
  const stages = Array.isArray(workflow?.stages) ? workflow.stages : [];
  const completedStages = stages
    .map(stage => toValidDate(stage?.completed_at))
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime());
  return completedStages[0] || toValidDate(workflow?.updated_at);
}

export function formatWorkflowDurationLabel(workflow) {
  if (workflow?.status !== 'done') return '';
  const createdAt = toValidDate(workflow?.created_at);
  const doneAt = getDoneAt(workflow);
  if (!createdAt || !doneAt) return '';
  return formatDuration(doneAt.getTime() - createdAt.getTime());
}

export function getSidebarTaskTimeSource(task) {
  return task?.created_at || task?.updated_at || '';
}

export function appendWorkflowProgressEvent(eventsByWorkflow, event, options = {}) {
  if (!event?.workflow_id || !event?.type) return eventsByWorkflow;
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 30;
  const now = typeof options.now === 'function' ? options.now() : new Date().toISOString();
  const current = eventsByWorkflow?.[event.workflow_id] || [];
  return {
    ...(eventsByWorkflow || {}),
    [event.workflow_id]: [
      ...current,
      {
        ...event,
        received_at: now,
      },
    ].slice(-limit),
  };
}

export function removeWorkflowProgressEvents(eventsByWorkflow, workflowId) {
  if (!workflowId || !eventsByWorkflow?.[workflowId]) return eventsByWorkflow;
  const next = { ...eventsByWorkflow };
  delete next[workflowId];
  return next;
}

export function summarizeProgressEvent(event) {
  const data = event?.data && typeof event.data === 'object' ? event.data : {};
  const parts = [
    Number.isFinite(Number(data.index)) && Number.isFinite(Number(data.total))
      ? `第 ${Number(data.index) + 1}/${data.total} 项`
      : '',
    Number.isFinite(Number(data.percent)) ? `${Math.round(Number(data.percent))}%` : '',
    data.error ? `错误：${data.error}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : (event?.message || '无附加信息');
}
