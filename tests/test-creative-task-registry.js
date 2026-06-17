const assert = require('assert/strict');

const { createCreativeTaskRegistry } = require('../server/services/creativeTaskRegistry');

async function waitImmediate() {
  await new Promise(resolve => setImmediate(resolve));
}

(async () => {
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

  const replayed = [];
  const subscription = registry.subscribe(taskId, 1, event => replayed.push(event));
  assert.equal(subscription.finished, true);
  assert.deepEqual(replayed.map(event => event.seq), [2, 3]);
  assert.equal(replayed.at(-1).type, 'task_done');

  const liveRegistry = createCreativeTaskRegistry({
    now: () => '2026-06-18T00:00:00.000Z',
    idFactory: () => 'creative-task-live',
  });
  const liveTaskId = liveRegistry.createDetachedTask({
    workflowId: '202606180000000002',
    operationId: 'workflow-op-2',
  });
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

  console.log('creative task registry tests passed');
})();
