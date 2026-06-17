const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workflows = require('../server/services/creativeWorkflows');
const { createCreativeTaskRegistry } = require('../server/services/creativeTaskRegistry');
const workflowTasks = require('../server/services/creativeWorkflowTasks');

const WORKFLOW_ID = '202606180000000001';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'creative-workflow-tasks-'));
}

function readWorkflow(rootDir) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, `${WORKFLOW_ID}.json`), 'utf-8'));
}

function services(now = '2026-06-18T00:00:00.000Z') {
  return {
    idFactory: () => WORKFLOW_ID,
    now: () => now,
    researchService: {
      createResearchContext: async ({ now: n }) => ({ status: 'disabled', query: '', sources: [], summary: '', updated_at: n }),
    },
  };
}

async function waitFor(assertion, timeoutMs = 1000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

(async () => {
  const rootDir = tempRoot();
  await workflows.createCreativeWorkflow({ input: '测试后台任务', useResearch: false }, { rootDir, services: services() });
  const registry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-test',
    now: () => '2026-06-18T00:00:00.000Z',
  });
  const runCalls = [];

  const started = await workflowTasks.startCreativeWorkflowTask(WORKFLOW_ID, {
    rootDir,
    registry,
    services: {
      ...services(),
      creativeWorkflows: {
        runCreativeWorkflow: async (workflowId, options) => {
          runCalls.push({ workflowId, hasTaskContext: Boolean(options.taskContext) });
          options.taskContext.emit({
            type: 'stage_progress',
            stage: 'project',
            progress: 50,
            message: '正在生成第 1/2 帧 HTML...',
          });
          return { success: true, workflow_id: workflowId, status: 'done', message: '完成' };
        },
      },
    },
  });

  assert.equal(started.success, true);
  assert.equal(started.task_id, 'creative-task-test');
  assert.equal(started.active_task.status, 'running');
  const startedRecord = readWorkflow(rootDir);
  assert.equal(startedRecord.current_stage_message, '后台创作任务已启动。');
  assert.equal(registry.getTask(started.task_id).events[0].message, '后台创作任务已启动。');
  await waitFor(() => assert.equal(registry.getTask(started.task_id).status, 'done'));
  assert.deepEqual(runCalls, [{ workflowId: WORKFLOW_ID, hasTaskContext: true }]);

  const task = registry.getTask(started.task_id);
  assert.equal(task.status, 'done');
  assert.equal(task.events.some(event => event.message === '正在生成第 1/2 帧 HTML...'), true);
  assert.equal(task.events.filter(event => event.type === 'task_done').length, 1);
  await waitFor(() => assert.equal(readWorkflow(rootDir).last_event_seq, task.events.at(-1).seq));
  await waitFor(() => assert.equal(readWorkflow(rootDir).task_status, 'done'));

  const fetched = await workflows.getCreativeWorkflow(WORKFLOW_ID, {
    rootDir,
    services: { now: () => '2026-06-18T00:20:00.000Z' },
    taskRegistry: registry,
  });
  assert.equal(fetched.success, true);
  assert.notEqual(fetched.data.status, 'failed');

  const doneRootDir = tempRoot();
  await workflows.createCreativeWorkflow({ input: '测试终态状态', useResearch: false }, { rootDir: doneRootDir, services: services() });
  const doneRegistry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-done',
    now: () => '2026-06-18T00:00:00.000Z',
  });
  const doneTaskId = doneRegistry.createDetachedTask({
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-done',
    kind: 'creative_workflow',
  });
  const ignoredDoneEvent = await workflowTasks.emitAndPersistTaskEvent({
    registry: doneRegistry,
    taskId: doneTaskId,
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-done',
    event: { type: 'task_done', progress: 100, message: '完成' },
    rootDir: doneRootDir,
  });
  assert.equal(ignoredDoneEvent, null);
  assert.equal(doneRegistry.getTask(doneTaskId).events.some(event => event.type === 'task_done'), false);
  assert.equal(readWorkflow(doneRootDir).task_status || '', '');

  const deletedRootDir = tempRoot();
  await workflows.createCreativeWorkflow({ input: '测试删除状态', useResearch: false }, { rootDir: deletedRootDir, services: services() });
  const deletedRegistry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-deleted',
    now: () => '2026-06-18T00:00:00.000Z',
  });
  const deletedTaskId = deletedRegistry.createDetachedTask({
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-deleted',
    kind: 'creative_workflow',
  });
  const ignoredDeletedEvent = await workflowTasks.emitAndPersistTaskEvent({
    registry: deletedRegistry,
    taskId: deletedTaskId,
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-deleted',
    event: { type: 'workflow_deleted' },
    rootDir: deletedRootDir,
  });
  assert.equal(ignoredDeletedEvent, null);
  assert.equal(deletedRegistry.getTask(deletedTaskId).events.some(event => event.type === 'workflow_deleted'), false);
  assert.equal(readWorkflow(deletedRootDir).task_status || '', '');

  const unknownHtmlVideoRootDir = tempRoot();
  await workflows.createCreativeWorkflow({ input: '测试未知 HTML 事件', useResearch: false }, { rootDir: unknownHtmlVideoRootDir, services: services() });
  const unknownHtmlVideoRegistry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-unknown-html-video',
    now: () => '2026-06-18T00:00:00.000Z',
  });
  const unknownHtmlVideoTaskId = unknownHtmlVideoRegistry.createDetachedTask({
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-unknown-html-video',
    kind: 'creative_workflow',
  });
  await workflowTasks.emitAndPersistTaskEvent({
    registry: unknownHtmlVideoRegistry,
    taskId: unknownHtmlVideoTaskId,
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-unknown-html-video',
    event: {
      type: 'html_video_custom_progress',
      stage: 'project',
      message: '未知 HTML 事件',
    },
    rootDir: unknownHtmlVideoRootDir,
  });
  const unknownHtmlVideoRecord = readWorkflow(unknownHtmlVideoRootDir);
  assert.equal(unknownHtmlVideoRegistry.getTask(unknownHtmlVideoTaskId).events[0].type, 'html_video_custom_progress');
  assert.equal(unknownHtmlVideoRecord.current_progress > 0, true);

  const failedRootDir = tempRoot();
  await workflows.createCreativeWorkflow({ input: '测试失败状态', useResearch: false }, { rootDir: failedRootDir, services: services() });
  const failedRegistry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-failed',
    now: () => '2026-06-18T00:00:00.000Z',
  });
  const failedTaskId = failedRegistry.createDetachedTask({
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-failed',
    kind: 'creative_workflow',
  });
  const ignoredFailedEvent = await workflowTasks.emitAndPersistTaskEvent({
    registry: failedRegistry,
    taskId: failedTaskId,
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-failed',
    event: { type: 'task_failed', message: '失败' },
    rootDir: failedRootDir,
  });
  assert.equal(ignoredFailedEvent, null);
  assert.equal(failedRegistry.getTask(failedTaskId).events.some(event => event.type === 'task_failed'), false);
  assert.equal(readWorkflow(failedRootDir).task_status || '', '');

  const persistFailRegistry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-persist-failed',
    now: () => '2026-06-18T00:00:00.000Z',
  });
  const persistFailTaskId = persistFailRegistry.createDetachedTask({
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-persist-failed',
    kind: 'creative_workflow',
  });
  const emitted = await workflowTasks.emitAndPersistTaskEvent({
    registry: persistFailRegistry,
    taskId: persistFailTaskId,
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-persist-failed',
    event: { type: 'stage_progress', stage: 'project', message: '写入失败测试' },
    rootDir: tempRoot(),
    creativeWorkflows: {
      patchCreativeWorkflowTaskSummary: async () => ({ success: false, message: '写入失败' }),
    },
  });
  const persistFailedEvent = persistFailRegistry.getTask(persistFailTaskId).events
    .find(event => event.type === 'workflow_persist_failed');
  assert.equal(persistFailedEvent.data.failed_event_seq, emitted.seq);

  const failedRunRootDir = tempRoot();
  await workflows.createCreativeWorkflow({ input: '测试后台失败', useResearch: false }, { rootDir: failedRunRootDir, services: services() });
  const failedRunRegistry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-run-failed',
    now: () => '2026-06-18T00:00:00.000Z',
  });
  const failedRun = await workflowTasks.startCreativeWorkflowTask(WORKFLOW_ID, {
    rootDir: failedRunRootDir,
    registry: failedRunRegistry,
    services: {
      creativeWorkflows: {
        runCreativeWorkflow: async () => {
          throw new Error('后台失败');
        },
      },
    },
  });
  await waitFor(() => assert.equal(failedRunRegistry.getTask(failedRun.task_id).status, 'failed'));
  const failedRunTask = failedRunRegistry.getTask(failedRun.task_id);
  assert.equal(failedRunTask.events.filter(event => event.type === 'task_failed').length, 1);
  await waitFor(() => assert.equal(readWorkflow(failedRunRootDir).task_status, 'failed'));

  const innerDoneRootDir = tempRoot();
  await workflows.createCreativeWorkflow({ input: '测试内部完成事件', useResearch: false }, { rootDir: innerDoneRootDir, services: services() });
  const innerDoneRegistry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-inner-done',
    now: () => '2026-06-18T00:00:00.000Z',
  });
  const innerDone = await workflowTasks.startCreativeWorkflowTask(WORKFLOW_ID, {
    rootDir: innerDoneRootDir,
    registry: innerDoneRegistry,
    services: {
      creativeWorkflows: {
        runCreativeWorkflow: async (workflowId, options) => {
          await options.taskContext.emit({ type: 'task_done', progress: 100, message: '内部完成' });
          return { success: true, workflow_id: workflowId, status: 'done', message: '完成' };
        },
      },
    },
  });
  await waitFor(() => assert.equal(innerDoneRegistry.getTask(innerDone.task_id).status, 'done'));
  const innerDoneEvents = innerDoneRegistry.getTask(innerDone.task_id).events
    .filter(event => event.type === 'task_done');
  assert.equal(innerDoneEvents.length, 1);
  assert.equal(innerDoneEvents[0].message, '创作任务已完成。');

  const innerFailedRootDir = tempRoot();
  await workflows.createCreativeWorkflow({ input: '测试内部失败事件', useResearch: false }, { rootDir: innerFailedRootDir, services: services() });
  const innerFailedRegistry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-inner-failed',
    now: () => '2026-06-18T00:00:00.000Z',
  });
  const innerFailed = await workflowTasks.startCreativeWorkflowTask(WORKFLOW_ID, {
    rootDir: innerFailedRootDir,
    registry: innerFailedRegistry,
    services: {
      creativeWorkflows: {
        runCreativeWorkflow: async (workflowId, options) => {
          await options.taskContext.emit({ type: 'task_failed', message: '内部失败' });
          throw new Error('外层失败');
        },
      },
    },
  });
  await waitFor(() => assert.equal(innerFailedRegistry.getTask(innerFailed.task_id).status, 'failed'));
  const innerFailedEvents = innerFailedRegistry.getTask(innerFailed.task_id).events
    .filter(event => event.type === 'task_failed');
  assert.equal(innerFailedEvents.length, 1);
  assert.equal(innerFailedEvents[0].message, '外层失败');

  const donePatchFailRootDir = tempRoot();
  await workflows.createCreativeWorkflow({ input: '测试终态写入失败', useResearch: false }, { rootDir: donePatchFailRootDir, services: services() });
  const donePatchFailRegistry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-done-patch-fail',
    now: () => '2026-06-18T00:00:00.000Z',
  });
  let donePatchCalls = 0;
  const donePatchFail = await workflowTasks.startCreativeWorkflowTask(WORKFLOW_ID, {
    rootDir: donePatchFailRootDir,
    registry: donePatchFailRegistry,
    services: {
      creativeWorkflows: {
        patchCreativeWorkflowTaskSummary: async () => {
          donePatchCalls += 1;
          if (donePatchCalls > 1) {
            throw new Error('终态写入失败');
          }
          return { success: true };
        },
        runCreativeWorkflow: async workflowId => ({ success: true, workflow_id: workflowId, status: 'done', message: '完成' }),
      },
    },
  });
  await waitFor(() => assert.equal(donePatchFailRegistry.getTask(donePatchFail.task_id).status, 'done'));
  const donePatchFailTask = donePatchFailRegistry.getTask(donePatchFail.task_id);
  assert.equal(donePatchFailTask.status, 'done');
  assert.equal(donePatchFailTask.events.filter(event => event.type === 'task_failed').length, 0);
  assert.equal(donePatchFailTask.events.filter(event => event.type === 'task_done').length, 1);
  assert.equal(donePatchFailTask.events.some(event => event.type === 'workflow_persist_failed'), true);

  const deletedRunRegistry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-run-deleted',
    now: () => '2026-06-18T00:00:00.000Z',
  });
  const deletedPatchCalls = [];
  const deletedRun = await workflowTasks.startCreativeWorkflowTask(WORKFLOW_ID, {
    registry: deletedRunRegistry,
    services: {
      creativeWorkflows: {
        patchCreativeWorkflowTaskSummary: async (workflowId, patch) => {
          deletedPatchCalls.push({ workflowId, patch });
          return { success: true };
        },
        runCreativeWorkflow: async workflowId => ({
          success: false,
          workflow_id: workflowId,
          status: 'deleted',
          message: '创作任务已停止并删除。',
        }),
      },
    },
  });
  await waitFor(() => assert.equal(deletedRunRegistry.getTask(deletedRun.task_id).status, 'deleted'));
  const deletedRunTask = deletedRunRegistry.getTask(deletedRun.task_id);
  assert.equal(deletedRunTask.events.some(event => event.type === 'workflow_deleted'), true);
  assert.equal(deletedRunTask.events.some(event => event.type === 'task_failed'), false);
  assert.equal(deletedRunRegistry.activeTaskForWorkflow(WORKFLOW_ID), null);
  assert.equal(deletedPatchCalls.length, 1);
  const deletedReplayEvents = [];
  await workflowTasks.subscribeCreativeWorkflowEvents({
    workflowId: WORKFLOW_ID,
    taskId: deletedRun.task_id,
    sinceSeq: 0,
    registry: deletedRunRegistry,
    writeEvent: event => {
      deletedReplayEvents.push(event);
      return true;
    },
  });
  assert.equal(deletedReplayEvents.some(event => event.type === 'workflow_deleted'), true);
  assert.equal(deletedReplayEvents.at(-1).type, 'task_stream_closed');
  assert.equal(deletedReplayEvents.at(-1).status, 'deleted');

  const closeThrowRegistry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-close-throw',
    now: () => '2026-06-18T00:00:00.000Z',
  });
  const closeThrowTaskId = closeThrowRegistry.createDetachedTask({
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-close-throw',
    kind: 'creative_workflow',
  });
  closeThrowRegistry.markDone(closeThrowTaskId, '完成');
  let onCloseCalls = 0;
  await workflowTasks.subscribeCreativeWorkflowEvents({
    workflowId: WORKFLOW_ID,
    taskId: closeThrowTaskId,
    sinceSeq: 0,
    registry: closeThrowRegistry,
    writeEvent: event => {
      if (event.type === 'task_stream_closed') {
        throw new Error('关闭事件写入失败');
      }
      return true;
    },
    onClose: () => {
      onCloseCalls += 1;
    },
  });
  assert.equal(onCloseCalls, 1);

  console.log('creative workflow task tests passed');
})();
