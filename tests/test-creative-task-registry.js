const assert = require('assert/strict');

const registryModule = require('../server/services/creativeTaskRegistry');
const { createCreativeTaskRegistry } = registryModule;

async function waitImmediate() {
  await new Promise(resolve => setImmediate(resolve));
}

(async () => {
  assert.deepEqual(Object.keys(registryModule).sort(), ['createCreativeTaskRegistry', 'defaultRegistry']);

  const times = [
    '2026-06-18T00:00:00.000Z',
    '2026-06-18T00:00:01.000Z',
    '2026-06-18T00:00:02.000Z',
    '2026-06-18T00:00:03.000Z',
  ];
  const registry = createCreativeTaskRegistry({
    now: () => times.shift() || '2026-06-18T00:00:04.000Z',
    ttlMs: 10 * 60 * 1000,
    maxFinishedTasks: 10,
    maxEventsPerTask: 3,
    idFactory: () => 'creative-task-test',
  });

  const taskId = registry.createTask({
    workflowId: '202606180000000001',
    operationId: 'workflow-op-1',
    runner: async ({ emit }) => {
      emit({ type: 'stage_started', stage: 'source', message: '正在准备来源资料...' });
      emit({ type: 'stage_done', stage: 'source', message: '来源资料已准备完成。' });
    },
  });

  assert.equal(taskId, 'creative-task-test');
  assert.equal(registry.getTask(taskId).events[0].type, 'task_started');
  assert.equal(registry.getTask(taskId).events[0].message, '后台创作任务已启动。');
  assert.deepEqual(registry.activeTaskForWorkflow('202606180000000001'), {
    task_id: 'creative-task-test',
    workflow_id: '202606180000000001',
    operation_id: 'workflow-op-1',
    kind: 'creative_workflow',
    status: 'running',
  });

  await waitImmediate();
  await waitImmediate();

  const task = registry.getTask(taskId);
  assert.equal(task.status, 'done');
  assert.equal(task.events.at(-1).type, 'task_done');

  const replayFromStart = [];
  const startReplaySubscription = registry.subscribe(taskId, 0, event => replayFromStart.push(event));
  assert.equal(startReplaySubscription.finished, true);
  assert.deepEqual(replayFromStart.map(event => event.type), ['stage_started', 'stage_done', 'task_done']);

  const replayed = [];
  const subscription = registry.subscribe(taskId, 1, event => replayed.push(event));
  assert.equal(subscription.finished, true);
  assert.deepEqual(replayed.map(event => event.seq), [2, 3, 4]);
  assert.equal(replayed.at(-1).type, 'task_done');

  const liveRegistry = createCreativeTaskRegistry({
    now: () => '2026-06-18T00:00:00.000Z',
    idFactory: () => 'creative-task-live',
  });
  const liveTaskId = liveRegistry.createDetachedTask({
    workflowId: '202606180000000002',
    operationId: 'workflow-op-2',
  });
  const liveTask = liveRegistry.getTask(liveTaskId);
  assert.equal(liveTask.ended_at, null);
  assert.equal(liveTask.error, null);
  const liveEvents = [];
  const liveSubscription = liveRegistry.subscribe(liveTaskId, 0, event => liveEvents.push(event));
  liveRegistry.emit(liveTaskId, { type: 'stage_progress', stage: 'project', message: '正在生成工程...' });
  assert.equal(liveEvents.at(-1).type, 'stage_progress');
  liveSubscription.unsubscribe();
  liveRegistry.emit(liveTaskId, { type: 'stage_progress', stage: 'project', message: '不会收到' });
  assert.equal(liveEvents.filter(event => event.message === '不会收到').length, 0);
  liveRegistry.markFailed(liveTaskId, new Error('失败测试'));
  assert.equal(liveRegistry.getTask(liveTaskId).status, 'failed');
  assert.equal(liveRegistry.getTask(liveTaskId).events.at(-1).type, 'task_failed');

  const resilientRegistry = createCreativeTaskRegistry({
    now: () => '2026-06-18T00:00:00.000Z',
    idFactory: () => 'creative-task-resilient',
  });
  const resilientTaskId = resilientRegistry.createDetachedTask({
    workflowId: '202606180000000003',
    operationId: 'workflow-op-3',
  });
  const resilientEvents = [];
  resilientRegistry.subscribe(resilientTaskId, 0, () => {
    throw new Error('订阅者失败');
  });
  resilientRegistry.subscribe(resilientTaskId, 0, event => resilientEvents.push(event));
  assert.doesNotThrow(() => {
    resilientRegistry.emit(resilientTaskId, {
      type: 'stage_progress',
      stage: 'project',
      message: '正常订阅者应收到',
    });
  });
  assert.equal(resilientEvents.at(-1).message, '正常订阅者应收到');
  assert.doesNotThrow(() => {
    resilientRegistry.subscribe(resilientTaskId, 0, () => {
      throw new Error('重放订阅者失败');
    });
  });

  const fullReplayRegistry = createCreativeTaskRegistry({
    now: () => '2026-06-18T00:00:00.000Z',
    idFactory: () => 'creative-task-full-replay',
  });
  const fullReplayTaskId = fullReplayRegistry.createTask({
    workflowId: '202606180000000004',
    operationId: 'workflow-op-4',
    runner: async ({ emit }) => {
      emit({ type: 'stage_done', stage: 'source', message: '来源资料已准备完成。' });
    },
  });
  await waitImmediate();
  await waitImmediate();
  const fullReplayEvents = [];
  const fullReplaySubscription = fullReplayRegistry.subscribe(fullReplayTaskId, 0, event => fullReplayEvents.push(event));
  assert.equal(fullReplaySubscription.finished, true);
  assert.deepEqual(fullReplayEvents.map(event => event.seq), [1, 2, 3]);
  assert.equal(fullReplayEvents[0].type, 'task_started');

  console.log('creative task registry tests passed');
})();
