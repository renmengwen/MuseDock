import { getTaskTitle } from './workflowDisplay.js';

export const CREATIVE_TASKS_STORAGE_KEY = 'musedock.creative.tasks.v1';
export const ACTIVE_CREATIVE_TASK_STORAGE_KEY = 'musedock.creative.activeTask.v1';

export function loadStoredTasks() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CREATIVE_TASKS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(compactStoredTask).filter(task => task.workflow_id).slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function compactStoredTask(task) {
  return {
    workflow_id: String(task?.workflow_id || '').trim(),
    creationModeId: task?.creationModeId || task?.workflow?.creationModeId || 'hyperframes-v1',
    ...((task?.production_summary || task?.workflow?.illustrated) ? { production_summary: task?.workflow?.illustrated ? [
      task.workflow.illustrated.settings.narrationMode === 'disabled' ? '无配音' : '有配音',
      task.workflow.illustrated.settings.burnSubtitles ? '烧录字幕' : '不烧录字幕',
      task.workflow.illustrated.settings.motion.mode === 'off' ? '静止画面' : '图片微动',
    ].join(' · ') : task.production_summary } : {}),
    title: String(task?.title || ''),
    input: String(task?.input || ''),
    status: String(task?.status || 'queued'),
    message: String(task?.message || ''),
    created_at: String(task?.created_at || ''),
    updated_at: String(task?.updated_at || ''),
  };
}

export function saveStoredTasks(tasks) {
  if (typeof window === 'undefined') return;
  try {
    const storedTasks = (Array.isArray(tasks) ? tasks : [])
      .map(compactStoredTask)
      .filter(task => task.workflow_id)
      .slice(0, 30);
    window.localStorage.setItem(CREATIVE_TASKS_STORAGE_KEY, JSON.stringify(storedTasks));
  } catch {
    window.localStorage.removeItem(CREATIVE_TASKS_STORAGE_KEY);
  }
}

export function normalizeLastSeq(value) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue) || nextValue < 0) return 0;
  return Math.floor(nextValue);
}

export function saveActiveCreativeTask(value) {
  if (typeof window === 'undefined') return;
  try {
    if (!value?.workflow_id || !value?.task_id) {
      window.localStorage.removeItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY, JSON.stringify({
      workflow_id: value.workflow_id,
      task_id: value.task_id,
      last_seq: normalizeLastSeq(value.last_seq),
      updated_at: new Date().toISOString(),
    }));
  } catch {
    window.localStorage.removeItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY);
  }
}

export function loadActiveCreativeTask() {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY) || 'null');
    if (!parsed?.workflow_id || !parsed?.task_id) {
      window.localStorage.removeItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY);
      return null;
    }
    return {
      workflow_id: parsed.workflow_id,
      task_id: parsed.task_id,
      last_seq: normalizeLastSeq(parsed.last_seq),
    };
  } catch {
    window.localStorage.removeItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY);
    return null;
  }
}

export function mergeServerTasks(localTasks, serverItems) {
  const byId = new Map(localTasks.map(task => [task.workflow_id, task]));
  for (const item of Array.isArray(serverItems) ? serverItems : []) {
    const id = String(item?.workflow_id || '').trim();
    if (!id) continue;
    const prev = byId.get(id) || {};
    byId.set(id, {
      ...prev,
      workflow_id: id,
      creationModeId: item.creationModeId || prev.creationModeId || 'hyperframes-v1',
      title: prev.title || item.title || getTaskTitle(item.input),
      input: prev.input || item.input || '',
      status: item.status || prev.status || 'queued',
      message: item.message || prev.message || '',
      workflow: prev.workflow || null,
      created_at: prev.created_at || item.created_at || item.updated_at || '',
      updated_at: item.updated_at || prev.updated_at || item.created_at || '',
    });
  }
  return Array.from(byId.values())
    .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())
    .slice(0, 30);
}

export function upsertTask(tasks, task) {
  const next = [task, ...tasks.filter(item => item.workflow_id !== task.workflow_id)];
  return next.slice(0, 30);
}

export function updateTask(tasks, task) {
  if (!tasks.some(item => item.workflow_id === task.workflow_id)) {
    return upsertTask(tasks, task);
  }
  return tasks.map(item => item.workflow_id === task.workflow_id ? { ...item, ...task } : item);
}
