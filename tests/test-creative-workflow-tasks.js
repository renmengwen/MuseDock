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

  console.log('creative workflow task tests passed');
})();
