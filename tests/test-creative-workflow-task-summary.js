const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workflows = require('../server/services/creative/creativeWorkflows');

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
  assert.equal(persisted.stages.find(stage => stage.id === 'project').status, 'running');
  assert.equal(persisted.stages.find(stage => stage.id === 'project').message, '正在生成第 1/2 帧 HTML...');

  const retrySummary = await workflows.patchCreativeWorkflowTaskSummary(WORKFLOW_ID, {
    operation: 'retry',
    retry_attempt_id: 'retry_attempt_summary',
  }, { rootDir });
  assert.equal(retrySummary.success, true);
  assert.equal(retrySummary.data.operation, 'retry');
  assert.equal(retrySummary.data.retry_attempt_id, 'retry_attempt_summary');
  const retryPersisted = readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
  assert.equal(retryPersisted.operation, 'retry');
  assert.equal(retryPersisted.retry_attempt_id, 'retry_attempt_summary');

  await workflows.patchCreativeWorkflowTaskSummary(WORKFLOW_ID, {
    status: 'running',
    message: '正在处理后台任务。',
  }, { rootDir });
  const emptiedMessage = await workflows.patchCreativeWorkflowTaskSummary(WORKFLOW_ID, {
    status: 'running',
    message: '',
  }, { rootDir });
  assert.equal(emptiedMessage.success, true);
  assert.equal(emptiedMessage.data.message, '');
  const emptiedMessagePersisted = readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
  assert.equal(emptiedMessagePersisted.message, '');

  await Promise.all(Array.from({ length: 50 }, (_, index) => workflows.patchCreativeWorkflowTaskSummary(WORKFLOW_ID, {
    active_task_id: 'creative-task-1',
    active_operation_id: 'workflow-op-1',
    task_status: 'running',
    current_stage: 'project',
    current_stage_message: `并发进度 ${index + 1}`,
    current_progress: index + 1,
    last_event_seq: index + 1,
  }, { rootDir })));
  const concurrentPersisted = readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
  assert.equal(concurrentPersisted.last_event_seq, 50);
  assert.equal(concurrentPersisted.current_progress, 50);
  assert.equal(concurrentPersisted.current_stage_message, '并发进度 50');

  const cleared = await workflows.clearCreativeWorkflowTaskSummary(WORKFLOW_ID, { rootDir });
  assert.equal(cleared.success, true);
  const clearedPersisted = readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
  assert.equal(clearedPersisted.active_task_id, '');
  assert.equal(clearedPersisted.task_status, '');

  const videoWorkflowId = '202606180000000002';
  const projectDir = path.join(rootDir, 'html-video-project');
  const outputPath = path.join(projectDir, 'exports', 'output-audio.mp4');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, 'fake mp4');
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    exports: [{ id: 'export_0001', path: 'exports/output-audio.mp4', absolute_path: outputPath }],
  }));
  fs.writeFileSync(workflows.getWorkflowPath(videoWorkflowId, rootDir), JSON.stringify({
    workflow_id: videoWorkflowId,
    aweme_id: videoWorkflowId,
    success: true,
    status: 'done',
    result: {
      hyperframes_freeform: {
        project: { render_mode: 'html-video', html_video_project_path: projectDir },
        render: { status: 'rendered', output_path: outputPath },
      },
    },
    stages: [],
  }));
  const videoWorkflow = await workflows.getCreativeWorkflow(videoWorkflowId, { rootDir });
  assert.equal(
    videoWorkflow.data.result.hyperframes_freeform.render.output_url,
    `/api/creative-workflows/${videoWorkflowId}/html-video-project/exports/export_0001/file`,
  );

  console.log('creative workflow task summary tests passed');
})();
