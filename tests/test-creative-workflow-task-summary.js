const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workflows = require('../server/services/creativeWorkflows');

const WORKFLOW_ID = '202606180000000001';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'creative-workflow-task-summary-'));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

(async () => {
  const rootDir = tempRoot();
  const services = {
    idFactory: () => WORKFLOW_ID,
    researchService: {
      createResearchContext: async ({ now }) => ({ status: 'disabled', query: '', sources: [], summary: '', updated_at: now }),
    },
  };

  await workflows.createCreativeWorkflow({ input: '测试后台任务', useResearch: false }, { rootDir, services });

  const updated = await workflows.patchCreativeWorkflowTaskSummary(WORKFLOW_ID, {
    active_task_id: 'creative-task-1',
    active_operation_id: 'workflow-op-1',
    task_status: 'running',
    current_stage: 'project',
    current_stage_message: '正在生成第 1/2 帧 HTML...',
    current_progress: 55,
    last_event_seq: 7,
    updated_at: '2026-06-18T00:00:00.000Z',
  }, { rootDir });

  assert.equal(updated.success, true);
  assert.equal(updated.data.active_task_id, 'creative-task-1');
  assert.equal(updated.data.current_progress, 55);
  assert.equal(updated.data.last_event_seq, 7);

  const persisted = readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
  assert.equal(persisted.active_task_id, 'creative-task-1');
  assert.equal(persisted.active_operation_id, 'workflow-op-1');
  assert.equal(persisted.task_status, 'running');
  assert.equal(persisted.current_stage, 'project');
  assert.equal(persisted.current_stage_message, '正在生成第 1/2 帧 HTML...');
  assert.equal(persisted.current_progress, 55);
  assert.equal(persisted.last_event_seq, 7);

  const cleared = await workflows.clearCreativeWorkflowTaskSummary(WORKFLOW_ID, { rootDir });
  assert.equal(cleared.success, true);
  const clearedPersisted = readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
  assert.equal(clearedPersisted.active_task_id, '');
  assert.equal(clearedPersisted.task_status, '');

  console.log('creative workflow task summary tests passed');
})();
