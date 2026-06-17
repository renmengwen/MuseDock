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
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(runCalls, [{ workflowId: WORKFLOW_ID, hasTaskContext: true }]);

  const task = registry.getTask(started.task_id);
  assert.equal(task.status, 'done');
  assert.equal(task.events.some(event => event.message === '正在生成第 1/2 帧 HTML...'), true);

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
  await workflowTasks.emitAndPersistTaskEvent({
    registry: doneRegistry,
    taskId: doneTaskId,
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-done',
    event: { type: 'task_done', progress: 100, message: '完成' },
    rootDir: doneRootDir,
  });
  assert.equal(readWorkflow(doneRootDir).task_status, 'done');

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
  await workflowTasks.emitAndPersistTaskEvent({
    registry: failedRegistry,
    taskId: failedTaskId,
    workflowId: WORKFLOW_ID,
    operationId: 'workflow-op-failed',
    event: { type: 'task_failed', message: '失败' },
    rootDir: failedRootDir,
  });
  assert.equal(readWorkflow(failedRootDir).task_status, 'failed');

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

  console.log('creative workflow task tests passed');
})();
