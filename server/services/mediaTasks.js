const tasks = new Map();
let sequence = 0;

function nowIso() {
  return new Date().toISOString();
}

function cloneTask(task) {
  return task ? JSON.parse(JSON.stringify(task)) : null;
}

function createTask({ awemeId, type, label }) {
  sequence += 1;
  const timestamp = nowIso();
  const task = {
    task_id: `media-${Date.now()}-${sequence}`,
    type: String(type || 'media'),
    label: String(label || '媒体任务'),
    aweme_id: String(awemeId || ''),
    status: 'queued',
    success: null,
    progress: 0,
    step: 'queued',
    message: '任务已创建，等待执行...',
    result: null,
    error: '',
    created_at: timestamp,
    updated_at: timestamp,
  };
  tasks.set(task.task_id, task);
  return cloneTask(task);
}

function updateTask(taskId, patch = {}) {
  const task = tasks.get(taskId);
  if (!task) return null;
  const nextProgress = typeof patch.progress === 'number'
    ? Math.max(0, Math.min(100, Math.round(patch.progress)))
    : task.progress;
  Object.assign(task, {
    ...patch,
    progress: nextProgress,
    updated_at: nowIso(),
  });
  tasks.set(taskId, task);
  return cloneTask(task);
}

function completeTask(taskId, { message = '任务已完成', result = null } = {}) {
  return updateTask(taskId, {
    status: 'done',
    success: true,
    progress: 100,
    step: 'done',
    message,
    result,
    error: '',
  });
}

function failTask(taskId, error, result = null) {
  const message = error?.message || String(error || '任务执行失败');
  return updateTask(taskId, {
    status: 'failed',
    success: false,
    step: 'failed',
    message,
    error: message,
    result,
  });
}

function getTask(taskId) {
  return cloneTask(tasks.get(taskId));
}

function listTasks({ awemeId, type } = {}) {
  return Array.from(tasks.values())
    .filter(task => !awemeId || task.aweme_id === String(awemeId))
    .filter(task => !type || task.type === String(type))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map(cloneTask);
}

function clearTasks() {
  tasks.clear();
  sequence = 0;
}

module.exports = {
  createTask,
  updateTask,
  completeTask,
  failTask,
  getTask,
  listTasks,
  clearTasks,
};
