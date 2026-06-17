const defaultCreativeWorkflows = require('./creativeWorkflows');
const { defaultRegistry } = require('./creativeTaskRegistry');
const { calculateProjectProgress, calculateWorkflowProgress } = require('./creativeTaskEvents');

function createOperationId(workflowId) {
  const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]/g, '');
  return `workflow-${workflowId}-${stamp}`;
}

function htmlVideoProjectProgress(event = {}) {
  const data = event.data || {};
  if (event.type === 'html_video_template_selected') {
    return calculateProjectProgress({ step: 'template', stepProgress: 100 });
  }
  if (event.type === 'html_video_graph_started') {
    return calculateProjectProgress({ step: 'graph', stepProgress: 10 });
  }
  if (event.type === 'html_video_graph_done') {
    return calculateProjectProgress({ step: 'graph', stepProgress: 100 });
  }
  if (event.type === 'html_video_frame_html_started') {
    return calculateProjectProgress({
      step: 'frame_html',
      index: data.index,
      total: data.total,
      stepProgress: 10,
    });
  }
  if (event.type === 'html_video_frame_html_done') {
    return calculateProjectProgress({
      step: 'frame_html',
      index: data.index,
      total: data.total,
      stepProgress: 100,
    });
  }
  if (event.type === 'html_video_frame_render_progress') {
    return calculateProjectProgress({
      step: 'frame_render',
      index: data.index,
      total: data.total,
      stepProgress: data.percent ?? event.frame_progress ?? 0,
    });
  }
  if (event.type === 'html_video_compose_started') {
    return calculateProjectProgress({ step: 'compose', stepProgress: 10 });
  }
  if (event.type === 'html_video_export_ready') {
    return calculateProjectProgress({ step: 'compose', stepProgress: 100 });
  }
  return null;
}

function taskEventProgress(event = {}) {
  if (Number.isFinite(event.progress)) {
    return event.progress;
  }

  if (typeof event.type === 'string' && event.type.startsWith('html_video_')) {
    const projectProgress = htmlVideoProjectProgress(event);
    if (Number.isFinite(projectProgress)) {
      return calculateWorkflowProgress({ stage: 'project', stageProgress: projectProgress });
    }
    return calculateWorkflowProgress({
      stage: event.stage || 'project',
      stageProgress: event.stage_progress || 0,
    });
  }

  return calculateWorkflowProgress({
    stage: event.stage,
    stageProgress: event.stage_progress || 0,
  });
}

function taskStatusForEvent(event = {}) {
  if (event.type === 'task_done') {
    return 'done';
  }
  if (event.type === 'task_failed') {
    return 'failed';
  }
  return 'running';
}

function emitWorkflowPersistFailed(registry, taskId, operationId, message, failedEventSeq) {
  return registry.emit(taskId, {
    type: 'workflow_persist_failed',
    operation_id: operationId,
    message: message || '更新创作任务进度失败。',
    data: {
      error: message || '更新创作任务进度失败。',
      failed_event_seq: failedEventSeq,
    },
  });
}

async function patchTaskSummaryOrEmitFailure({
  registry,
  taskId,
  workflowId,
  operationId,
  creativeWorkflows,
  rootDir,
  patch,
  failedEventSeq,
}) {
  try {
    const persisted = await creativeWorkflows.patchCreativeWorkflowTaskSummary(workflowId, patch, { rootDir });
    if (!persisted?.success) {
      emitWorkflowPersistFailed(registry, taskId, operationId, persisted?.message || '更新创作任务进度失败。', failedEventSeq);
    }
    return persisted;
  } catch (error) {
    emitWorkflowPersistFailed(registry, taskId, operationId, error.message || '更新创作任务进度失败。', failedEventSeq);
    return { success: false, message: error.message || '更新创作任务进度失败。' };
  }
}

async function emitAndPersistTaskEvent({
  registry,
  taskId,
  workflowId,
  operationId,
  event,
  rootDir,
  creativeWorkflows = defaultCreativeWorkflows,
}) {
  const emitted = registry.emit(taskId, {
    ...(event || {}),
    operation_id: operationId,
  });
  if (!emitted) {
    return null;
  }

  const progress = taskEventProgress(event || {});
  const patch = {
    active_task_id: taskId,
    active_operation_id: operationId,
    task_status: taskStatusForEvent(event || {}),
    current_stage: emitted.stage,
    current_stage_message: emitted.message,
    current_progress: progress,
    last_event_seq: emitted.seq,
  };

  await patchTaskSummaryOrEmitFailure({
    registry,
    taskId,
    workflowId,
    operationId,
    creativeWorkflows,
    rootDir,
    patch,
    failedEventSeq: emitted.seq,
  });

  return emitted;
}

async function startCreativeWorkflowTask(workflowId, options = {}) {
  const rootDir = options.rootDir;
  const registry = options.registry || defaultRegistry;
  const creativeWorkflows = {
    ...defaultCreativeWorkflows,
    ...(options.services?.creativeWorkflows || {}),
  };
  const operationId = options.operationId || createOperationId(workflowId);
  const taskId = registry.createDetachedTask({
    workflowId,
    operationId,
    kind: 'creative_workflow',
  });

  await creativeWorkflows.patchCreativeWorkflowTaskSummary(workflowId, {
    active_task_id: taskId,
    active_operation_id: operationId,
    task_status: 'running',
    current_stage: '',
    current_stage_message: '后台创作任务已启动。',
    current_progress: 0,
    last_event_seq: 0,
  }, { rootDir });

  registry.emit(taskId, {
    type: 'task_started',
    progress: 0,
    message: '后台创作任务已启动。',
  });

  async function runBackgroundTask() {
    const pendingEventWrites = new Set();
    function trackEventWrite(promise) {
      const tracked = Promise.resolve(promise).catch(() => null);
      pendingEventWrites.add(tracked);
      tracked.finally(() => {
        pendingEventWrites.delete(tracked);
      });
      return promise;
    }

    const taskContext = {
      taskId,
      operationId,
      emit: event => trackEventWrite(emitAndPersistTaskEvent({
        registry,
        taskId,
        workflowId,
        operationId,
        event,
        rootDir,
        creativeWorkflows,
      })),
    };

    try {
      const result = await creativeWorkflows.runCreativeWorkflow(workflowId, {
        ...(options.workflowOptions || {}),
        taskContext,
      });
      if (result && result.success === false) {
        throw new Error(result.message || '创作任务执行失败。');
      }

      await Promise.allSettled([...pendingEventWrites]);
      const terminalEvent = registry.markDone(taskId, '创作任务已完成。')
        || registry.emit(taskId, { type: 'task_done', progress: 100, message: '创作任务已完成。' });
      await patchTaskSummaryOrEmitFailure({
        registry,
        taskId,
        workflowId,
        operationId,
        creativeWorkflows,
        rootDir,
        patch: {
          active_task_id: '',
          active_operation_id: '',
          task_status: 'done',
          current_stage: '',
          current_stage_message: '创作任务已完成。',
          current_progress: 100,
          status: 'done',
          message: '创作任务已完成。',
          error: null,
          last_event_seq: terminalEvent?.seq || 0,
        },
        failedEventSeq: terminalEvent?.seq || 0,
      });
    } catch (error) {
      const message = error.message || '创作任务执行失败。';
      await Promise.allSettled([...pendingEventWrites]);
      const terminalEvent = registry.markFailed(taskId, error)
        || registry.emit(taskId, { type: 'task_failed', message, data: { error: message } });
      await patchTaskSummaryOrEmitFailure({
        registry,
        taskId,
        workflowId,
        operationId,
        creativeWorkflows,
        rootDir,
        patch: {
          active_task_id: '',
          active_operation_id: '',
          task_status: 'failed',
          current_stage: '',
          current_stage_message: message,
          status: 'failed',
          message,
          error: {
            message,
          },
          last_event_seq: terminalEvent?.seq || 0,
        },
        failedEventSeq: terminalEvent?.seq || 0,
      });
    }
  }

  setImmediate(() => {
    runBackgroundTask().catch(error => {
      emitWorkflowPersistFailed(registry, taskId, operationId, error.message || '后台创作任务执行异常。', 0);
    });
  });

  return {
    success: true,
    workflow_id: workflowId,
    task_id: taskId,
    active_task: registry.activeTaskForWorkflow(workflowId),
  };
}

module.exports = {
  startCreativeWorkflowTask,
  emitAndPersistTaskEvent,
};
