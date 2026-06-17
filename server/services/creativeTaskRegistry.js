const crypto = require('crypto');

const { createTaskEvent, isTerminalEvent } = require('./creativeTaskEvents');

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_EVENTS_PER_TASK = 1000;
const DEFAULT_MAX_FINISHED_TASKS = 100;

function defaultNow() {
  return new Date().toISOString();
}

function sanitizeIsoStamp(value) {
  return String(value || defaultNow()).replace(/[^0-9A-Za-z]/g, '');
}

function defaultIdFactory() {
  const stamp = sanitizeIsoStamp(defaultNow());
  const randomHex = crypto.randomBytes(3).toString('hex');
  return `creative-task-${stamp}-${randomHex}`;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.floor(number);
}

function normalizeTtlMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return DEFAULT_TTL_MS;
  }
  return number;
}

function toTimestamp(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message || '后台创作任务执行失败。';
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return '后台创作任务执行失败。';
}

function createCreativeTaskRegistry(options = {}) {
  const now = typeof options.now === 'function' ? options.now : defaultNow;
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : defaultIdFactory;
  const ttlMs = normalizeTtlMs(options.ttlMs);
  const maxEventsPerTask = normalizePositiveInteger(options.maxEventsPerTask, DEFAULT_MAX_EVENTS_PER_TASK);
  const maxFinishedTasks = normalizePositiveInteger(options.maxFinishedTasks, DEFAULT_MAX_FINISHED_TASKS);

  const tasks = new Map();
  let seq = 0;

  function nextSeq() {
    const currentSeq = seq;
    seq += 1;
    return currentSeq;
  }

  function trimEvents(task) {
    if (task.events.length <= maxEventsPerTask) {
      return;
    }

    task.events = task.events.slice(-maxEventsPerTask);
    task.truncated = true;
  }

  function createDetachedTask({ workflowId, operationId, kind = 'creative_workflow' } = {}) {
    prune();

    const taskId = idFactory();
    const timestamp = now();
    const task = {
      task_id: taskId,
      workflow_id: typeof workflowId === 'string' ? workflowId : '',
      operation_id: typeof operationId === 'string' ? operationId : '',
      kind: typeof kind === 'string' && kind ? kind : 'creative_workflow',
      status: 'running',
      started_at: timestamp,
      updated_at: timestamp,
      ended_at: '',
      error: '',
      events: [],
      subscribers: new Set(),
      truncated: false,
    };

    tasks.set(taskId, task);
    return taskId;
  }

  function emit(taskId, event = {}) {
    const task = tasks.get(taskId);
    if (!task) {
      return null;
    }

    const taskEvent = createTaskEvent({
      ...event,
      seq: nextSeq(),
      task_id: task.task_id,
      workflow_id: task.workflow_id,
      operation_id: task.operation_id,
      now,
    });

    task.events.push(taskEvent);
    task.updated_at = taskEvent.time;
    trimEvents(task);

    for (const subscriber of task.subscribers) {
      subscriber(taskEvent);
    }

    return taskEvent;
  }

  function markDone(taskId, message = '后台创作任务已完成。') {
    const task = tasks.get(taskId);
    if (!task || task.status !== 'running') {
      return null;
    }

    const endedAt = now();
    task.status = 'done';
    task.ended_at = endedAt;
    task.updated_at = endedAt;
    return emit(taskId, {
      type: 'task_done',
      progress: 100,
      message,
    });
  }

  function markFailed(taskId, error) {
    const task = tasks.get(taskId);
    if (!task || task.status !== 'running') {
      return null;
    }

    const message = getErrorMessage(error);
    const endedAt = now();
    task.status = 'failed';
    task.error = message;
    task.ended_at = endedAt;
    task.updated_at = endedAt;
    return emit(taskId, {
      type: 'task_failed',
      message,
      data: { error: message },
    });
  }

  function createTask({ workflowId, operationId, kind = 'creative_workflow', runner } = {}) {
    const taskId = createDetachedTask({ workflowId, operationId, kind });

    emit(taskId, {
      type: 'task_started',
      progress: 0,
      message: '后台创作任务已开始。',
    });

    Promise.resolve()
      .then(() => {
        if (typeof runner !== 'function') {
          return null;
        }
        return runner({
          taskId,
          emit: event => emit(taskId, event),
        });
      })
      .then(() => {
        markDone(taskId);
      })
      .catch(error => {
        markFailed(taskId, error);
      });

    return taskId;
  }

  function subscribe(taskId, sinceSeq, onEvent) {
    const task = tasks.get(taskId);
    if (!task) {
      return null;
    }

    const normalizedSinceSeq = Number.isFinite(Number(sinceSeq)) ? Math.floor(Number(sinceSeq)) : 0;
    const listener = typeof onEvent === 'function' ? onEvent : () => {};

    for (const event of task.events) {
      if (event.seq > normalizedSinceSeq) {
        listener(event);
      }
    }

    if (task.status !== 'running') {
      return {
        unsubscribe: () => {},
        finished: true,
      };
    }

    task.subscribers.add(listener);
    return {
      unsubscribe: () => {
        task.subscribers.delete(listener);
      },
      finished: false,
    };
  }

  function getTask(taskId) {
    return tasks.get(taskId) || null;
  }

  function activeTaskForWorkflow(workflowId) {
    let newestTask = null;

    for (const task of tasks.values()) {
      if (task.workflow_id !== workflowId || task.status !== 'running') {
        continue;
      }

      if (!newestTask || toTimestamp(task.started_at) >= toTimestamp(newestTask.started_at)) {
        newestTask = task;
      }
    }

    if (!newestTask) {
      return null;
    }

    return {
      task_id: newestTask.task_id,
      workflow_id: newestTask.workflow_id,
      operation_id: newestTask.operation_id,
      kind: newestTask.kind,
      status: newestTask.status,
    };
  }

  function prune(nowMs = Date.now()) {
    const finishedTasks = [];

    for (const [taskId, task] of tasks.entries()) {
      if (task.status === 'running') {
        continue;
      }

      const finishedAt = toTimestamp(task.ended_at || task.updated_at);
      if (finishedAt && nowMs - finishedAt > ttlMs) {
        tasks.delete(taskId);
        continue;
      }

      finishedTasks.push([taskId, task]);
    }

    if (finishedTasks.length <= maxFinishedTasks) {
      return;
    }

    finishedTasks.sort((left, right) => {
      const leftTime = toTimestamp(left[1].ended_at || left[1].updated_at);
      const rightTime = toTimestamp(right[1].ended_at || right[1].updated_at);
      return leftTime - rightTime;
    });

    const removeCount = finishedTasks.length - maxFinishedTasks;
    for (const [taskId] of finishedTasks.slice(0, removeCount)) {
      tasks.delete(taskId);
    }
  }

  return {
    createTask,
    createDetachedTask,
    emit,
    markDone,
    markFailed,
    subscribe,
    getTask,
    activeTaskForWorkflow,
    prune,
    isTerminalEvent,
  };
}

const defaultRegistry = createCreativeTaskRegistry();

module.exports = {
  defaultIdFactory,
  createCreativeTaskRegistry,
  defaultRegistry,
};
