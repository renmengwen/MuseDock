const assert = require('assert/strict');

const events = require('../server/services/creativeTaskEvents');

{
  assert.equal(events.normalizeSinceSeq(undefined), 0);
  assert.equal(events.normalizeSinceSeq('12'), 12);
  assert.equal(events.normalizeSinceSeq('-1'), 0);
  assert.equal(events.normalizeSinceSeq('bad'), 0);
}

{
  const event = events.createTaskEvent({
    seq: 3,
    taskId: 'creative-task-1',
    workflowId: '202606180000000001',
    operationId: 'workflow-op-1',
    type: 'stage_progress',
    stage: 'project',
    progress: 44.4,
    message: '正在生成第 1/3 帧 HTML...',
    data: { frame_id: 'scene_01' },
    now: () => '2026-06-18T00:00:00.000Z',
  });
  assert.equal(event.seq, 3);
  assert.equal(event.task_id, 'creative-task-1');
  assert.equal(event.workflow_id, '202606180000000001');
  assert.equal(event.operation_id, 'workflow-op-1');
  assert.equal(event.type, 'stage_progress');
  assert.equal(event.stage, 'project');
  assert.equal(event.progress, 44);
  assert.equal(event.message, '正在生成第 1/3 帧 HTML...');
  assert.deepEqual(event.data, { frame_id: 'scene_01' });
  assert.equal(event.time, '2026-06-18T00:00:00.000Z');
}

{
  assert.equal(events.isTerminalEvent({ type: 'task_done' }), true);
  assert.equal(events.isTerminalEvent({ type: 'task_failed' }), true);
  assert.equal(events.isTerminalEvent({ type: 'workflow_deleted' }), true);
  assert.equal(events.isTerminalEvent({ type: 'stage_progress' }), false);
}

{
  assert.equal(events.calculateWorkflowProgress({ stage: 'source', stageProgress: 100 }), 5);
  assert.equal(events.calculateWorkflowProgress({ stage: 'project', stageProgress: 50 }), 55);
  assert.equal(events.calculateWorkflowProgress({ stage: 'project', stageProgress: 50, skippedStages: ['research'] }), 58);
  assert.equal(events.calculateWorkflowProgress({
    stage: 'project',
    stageProgress: events.calculateProjectProgress({ step: 'frame_html', index: 1, total: 4, stepProgress: 50 }),
  }), 50);
  assert.equal(events.calculateWorkflowProgress({ stage: 'inspect', stageProgress: 100 }), 100);
}

{
  const sse = events.formatSseEvent({ seq: 2, type: 'task_done', message: '完成' });
  assert.match(sse, /^id: 2\n/);
  assert.match(sse, /event: task_done\n/);
  assert.match(sse, /data: /);
  assert.match(sse, /\n\n$/);
}

console.log('creative task event tests passed');
