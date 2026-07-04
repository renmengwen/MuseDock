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

function getEventStageStatus(event) {
  if (event?.type === 'stage_done') return 'done';
  if (event?.type === 'stage_failed' || event?.type === 'task_failed') return 'failed';
  if (event?.type === 'stage_started' || event?.type === 'stage_progress') return 'running';
  if (typeof event?.type === 'string' && event.type.startsWith('html_video_')) return 'running';
  return '';
}

function isUnfinishedStageStatus(status) {
  return !status || status === 'waiting' || status === 'pending' || status === 'queued' || status === 'running';
}

export function applyWorkflowStageEvent(workflow, event) {
  const stageId = event?.stage;
  const nextStatus = getEventStageStatus(event);
  const stages = Array.isArray(workflow?.stages) ? workflow.stages : [];
  if (!stageId || !nextStatus || stages.length === 0) return workflow;

  const targetIndex = stages.findIndex(stage => stage?.id === stageId);
  if (targetIndex < 0) return workflow;

  return {
    ...workflow,
    stages: stages.map((stage, index) => {
      if (!stage || typeof stage !== 'object') return stage;
      if (index === targetIndex) {
        return {
          ...stage,
          status: nextStatus,
          ...(event.message ? { message: event.message } : {}),
        };
      }
      if (nextStatus === 'running' && index < targetIndex && isUnfinishedStageStatus(stage.status)) {
        return { ...stage, status: 'done' };
      }
      if (nextStatus === 'running' && index !== targetIndex && stage.status === 'running') {
        return { ...stage, status: index < targetIndex ? 'done' : 'pending' };
      }
      return stage;
    }),
  };
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

function getFrameRenderProgressKey(event) {
  if (event?.type !== 'html_video_frame_render_progress') return '';
  const data = event?.data && typeof event.data === 'object' ? event.data : {};
  const frameId = data.frame_id || event.frame_id;
  return frameId ? `html_video_frame_render_progress:${frameId}` : '';
}

export function appendWorkflowProgressEvent(eventsByWorkflow, event, options = {}) {
  if (!event?.workflow_id || !event?.type) return eventsByWorkflow;
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 30;
  const now = typeof options.now === 'function' ? options.now() : new Date().toISOString();
  const current = eventsByWorkflow?.[event.workflow_id] || [];
  const nextEvent = {
    ...event,
    received_at: now,
  };
  const mergeKey = getFrameRenderProgressKey(nextEvent);
  const mergeIndex = mergeKey ? current.findIndex(item => getFrameRenderProgressKey(item) === mergeKey) : -1;
  const nextEvents = mergeIndex >= 0
    ? [...current.slice(0, mergeIndex), ...current.slice(mergeIndex + 1), nextEvent]
    : [...current, nextEvent];
  return {
    ...(eventsByWorkflow || {}),
    [event.workflow_id]: nextEvents.slice(-limit),
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
  const isFrameEvent = event?.type === 'html_video_frame_html_started'
    || event?.type === 'html_video_frame_html_done'
    || event?.type === 'html_video_frame_render_progress';
  const parts = [
    !isFrameEvent && Number.isFinite(Number(data.completed)) && Number.isFinite(Number(data.total))
      ? `已完成 ${Number(data.completed)}/${data.total} 项`
      : '',
    Number.isFinite(Number(data.concurrency))
      ? `并发上限 ${Number(data.concurrency)}`
      : '',
    Number.isFinite(Number(data.index)) && Number.isFinite(Number(data.total))
      ? `第 ${Number(data.index) + 1}/${data.total} 项`
      : '',
    Number.isFinite(Number(data.percent)) ? `${Math.round(Number(data.percent))}%` : '',
    data.error ? `错误：${data.error}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : (event?.message || '无附加信息');
}
