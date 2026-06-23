const assert = require('assert/strict');

const registryModule = require('../server/services/creativeTaskRegistry');
const { createCreativeTaskRegistry } = registryModule;

async function waitImmediate() {
  await new Promise(resolve => setImmediate(resolve));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

  const failedAfterDataRegistry = createCreativeTaskRegistry({
    now: () => '2026-06-18T00:00:00.000Z',
    idFactory: () => 'creative-task-failed-after-data',
  });
  const failedAfterDataTaskId = failedAfterDataRegistry.createDetachedTask({
    workflowId: '202606180000000012',
    operationId: 'workflow-op-failed-after-data',
  });
  const businessError = new Error('业务失败');
  businessError.data = { code: 'X', stage: 'project' };
  const failedAfterDataEvent = await failedAfterDataRegistry.markFailedAfter(failedAfterDataTaskId, businessError);
  assert.equal(failedAfterDataEvent.type, 'task_failed');
  assert.equal(failedAfterDataEvent.data.code, 'X');
  assert.equal(failedAfterDataEvent.data.stage, 'project');
  assert.equal(failedAfterDataEvent.data.error, '业务失败');

  const orderedRegistry = createCreativeTaskRegistry({
    now: () => '2026-06-18T00:00:00.000Z',
    idFactory: () => 'creative-task-ordered-terminal',
  });
  const orderedTaskId = orderedRegistry.createDetachedTask({
    workflowId: '202606180000000006',
    operationId: 'workflow-op-ordered',
  });
  const orderedEvents = [];
  const orderedCalls = [];
  orderedRegistry.subscribe(orderedTaskId, 0, event => {
    if (event.type === 'task_done') {
      orderedCalls.push('subscriber-task_done');
    }
    orderedEvents.push(event);
  });
  const orderedTerminal = await orderedRegistry.markDoneAfter(orderedTaskId, '完成', async event => {
    orderedCalls.push(`before-${event.type}-${event.seq}`);
  });
  assert.equal(orderedTerminal.type, 'task_done');
  assert.deepEqual(orderedCalls, [`before-task_done-${orderedTerminal.seq}`, 'subscriber-task_done']);
  assert.equal(orderedRegistry.getTask(orderedTaskId).status, 'done');
  assert.equal(orderedEvents.at(-1).type, 'task_done');

  const blockedRegistry = createCreativeTaskRegistry({
    now: () => '2026-06-18T00:00:00.000Z',
    idFactory: () => 'creative-task-blocked-terminal',
  });
  const blockedTaskId = blockedRegistry.createDetachedTask({
    workflowId: '202606180000000007',
    operationId: 'workflow-op-blocked',
  });
  const blockedEvents = [];
  blockedRegistry.subscribe(blockedTaskId, 0, event => blockedEvents.push(event));
  await assert.rejects(
    () => blockedRegistry.markDoneAfter(blockedTaskId, '完成', async () => {
      throw new Error('终态写入失败');
    }),
    /终态写入失败/,
  );
  assert.equal(blockedRegistry.getTask(blockedTaskId).status, 'running');
  assert.equal(blockedEvents.some(event => event.type === 'task_done'), false);
  const blockedPersistFailed = blockedRegistry.emit(blockedTaskId, {
    type: 'workflow_persist_failed',
    message: '终态写入失败后持久化失败可记录',
    data: { error: 'patch failed' },
  });
  const blockedFailed = blockedRegistry.markFailed(blockedTaskId, new Error('终态写入失败'));
  assert.equal(blockedPersistFailed.type, 'workflow_persist_failed');
  assert.equal(blockedFailed.type, 'task_failed');
  assert.equal(blockedRegistry.getTask(blockedTaskId).status, 'failed');

  const pendingPersistFailFallbackRegistry = createCreativeTaskRegistry({
    now: () => '2026-06-18T00:00:00.000Z',
    idFactory: () => 'creative-task-pending-persist-fail-fallback',
  });
  const pendingPersistFailFallbackTaskId = pendingPersistFailFallbackRegistry.createDetachedTask({
    workflowId: '202606180000000011',
    operationId: 'workflow-op-pending-persist-fail-fallback',
  });
  let pendingPersistFailFallbackEmit = undefined;
  await assert.rejects(
    () => pendingPersistFailFallbackRegistry.markDoneAfter(pendingPersistFailFallbackTaskId, '完成', async () => {
      pendingPersistFailFallbackEmit = pendingPersistFailFallbackRegistry.emit(pendingPersistFailFallbackTaskId, {
        type: 'workflow_persist_failed',
        message: '终态写入失败后持久化失败可补记',
        data: { error: 'patch failed' },
      });
      throw new Error('终态写入失败');
    }),
    /终态写入失败/,
  );
  const pendingPersistFailFallbackTask = pendingPersistFailFallbackRegistry.getTask(pendingPersistFailFallbackTaskId);
  assert.equal(pendingPersistFailFallbackEmit, null);
  assert.equal(pendingPersistFailFallbackTask.status, 'running');
  assert.deepEqual(pendingPersistFailFallbackTask.events.map(event => event.type), ['workflow_persist_failed']);
  assert.deepEqual(pendingPersistFailFallbackTask.events.map(event => event.seq), [2]);
  const pendingPersistFailFallbackFailed = pendingPersistFailFallbackRegistry.markFailed(pendingPersistFailFallbackTaskId, new Error('终态写入失败'));
  assert.equal(pendingPersistFailFallbackFailed.type, 'task_failed');
  assert.equal(pendingPersistFailFallbackRegistry.getTask(pendingPersistFailFallbackTaskId).status, 'failed');

  const pendingFailRaceRegistry = createCreativeTaskRegistry({
    now: () => '2026-06-18T00:00:00.000Z',
    idFactory: () => 'creative-task-pending-fail-race',
  });
  const pendingFailRaceTaskId = pendingFailRaceRegistry.createDetachedTask({
    workflowId: '202606180000000008',
    operationId: 'workflow-op-pending-fail-race',
  });
  pendingFailRaceRegistry.emit(pendingFailRaceTaskId, {
    type: 'stage_progress',
    stage: 'project',
    message: '正在生成工程...',
  });
  const pendingFailDeferred = createDeferred();
  const pendingDonePromise = pendingFailRaceRegistry.markDoneAfter(
    pendingFailRaceTaskId,
    '完成',
    async () => pendingFailDeferred.promise,
  );
  await waitImmediate();
  const competingProgress = pendingFailRaceRegistry.emit(pendingFailRaceTaskId, {
    type: 'stage_progress',
    stage: 'project',
    message: '终态等待期间的进度不应插入',
  });
  const competingFailed = pendingFailRaceRegistry.markFailed(pendingFailRaceTaskId, new Error('并发失败'));
  pendingFailDeferred.resolve();
  const pendingDoneEvent = await pendingDonePromise;
  const pendingFailRaceTask = pendingFailRaceRegistry.getTask(pendingFailRaceTaskId);
  assert.equal(competingProgress, null);
  assert.equal(competingFailed, null);
  assert.equal(pendingFailRaceTask.status, 'done');
  assert.equal(pendingDoneEvent.type, 'task_done');
  assert.deepEqual(pendingFailRaceTask.events.map(event => event.seq), [1, 2]);
  assert.deepEqual(
    pendingFailRaceTask.events.filter(event => event.type === 'task_done' || event.type === 'task_failed').map(event => event.type),
    ['task_done'],
  );

  const pendingPersistFailRaceRegistry = createCreativeTaskRegistry({
    now: () => '2026-06-18T00:00:00.000Z',
    idFactory: () => 'creative-task-pending-persist-fail-race',
  });
  const pendingPersistFailRaceTaskId = pendingPersistFailRaceRegistry.createDetachedTask({
    workflowId: '202606180000000010',
    operationId: 'workflow-op-pending-persist-fail-race',
  });
  pendingPersistFailRaceRegistry.emit(pendingPersistFailRaceTaskId, {
    type: 'stage_progress',
    stage: 'project',
    message: '正在生成工程...',
  });
  const pendingPersistFailDeferred = createDeferred();
  const pendingPersistFailDonePromise = pendingPersistFailRaceRegistry.markDoneAfter(
    pendingPersistFailRaceTaskId,
    '完成',
    async () => pendingPersistFailDeferred.promise,
  );
  await waitImmediate();
  const competingPersistFailed = pendingPersistFailRaceRegistry.emit(pendingPersistFailRaceTaskId, {
    type: 'workflow_persist_failed',
    message: '终态等待期间的持久化失败不应插入',
    data: { error: 'patch failed' },
  });
  pendingPersistFailDeferred.resolve();
  await pendingPersistFailDonePromise;
  const pendingPersistFailRaceTask = pendingPersistFailRaceRegistry.getTask(pendingPersistFailRaceTaskId);
  assert.equal(competingPersistFailed, null);
  assert.equal(pendingPersistFailRaceTask.status, 'done');
  assert.deepEqual(pendingPersistFailRaceTask.events.map(event => event.seq), [1, 2]);
  assert.deepEqual(
    pendingPersistFailRaceTask.events.filter(event => event.type === 'task_done' || event.type === 'workflow_persist_failed').map(event => event.type),
    ['task_done'],
  );

  const pendingDeleteRaceRegistry = createCreativeTaskRegistry({
    now: () => '2026-06-18T00:00:00.000Z',
    idFactory: () => 'creative-task-pending-delete-race',
  });
  const pendingDeleteRaceTaskId = pendingDeleteRaceRegistry.createDetachedTask({
    workflowId: '202606180000000009',
    operationId: 'workflow-op-pending-delete-race',
  });
  const pendingDeleteDeferred = createDeferred();
  const pendingDeleteDonePromise = pendingDeleteRaceRegistry.markDoneAfter(
    pendingDeleteRaceTaskId,
    '完成',
    async () => pendingDeleteDeferred.promise,
  );
  await waitImmediate();
  const competingDeleted = pendingDeleteRaceRegistry.markDeleted(pendingDeleteRaceTaskId, '并发删除');
  pendingDeleteDeferred.resolve();
  await pendingDeleteDonePromise;
  const pendingDeleteRaceTask = pendingDeleteRaceRegistry.getTask(pendingDeleteRaceTaskId);
  assert.equal(competingDeleted, null);
  assert.equal(pendingDeleteRaceTask.status, 'done');
  assert.deepEqual(
    pendingDeleteRaceTask.events.filter(event => event.type === 'task_done' || event.type === 'workflow_deleted').map(event => event.type),
    ['task_done'],
  );

  const deletedRegistry = createCreativeTaskRegistry({
    now: () => '2026-06-18T00:00:00.000Z',
    idFactory: () => 'creative-task-deleted',
  });
  const deletedTaskId = deletedRegistry.createDetachedTask({
    workflowId: '202606180000000005',
    operationId: 'workflow-op-deleted',
  });
  const deletedEvent = deletedRegistry.markDeleted(deletedTaskId, '创作任务已停止并删除。');
  assert.equal(deletedRegistry.getTask(deletedTaskId).status, 'deleted');
  assert.equal(deletedEvent.type, 'workflow_deleted');
  assert.equal(deletedRegistry.getTask(deletedTaskId).events.at(-1).type, 'workflow_deleted');
  assert.equal(deletedRegistry.activeTaskForWorkflow('202606180000000005'), null);

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
