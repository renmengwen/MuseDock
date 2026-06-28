import assert from 'node:assert/strict';

const {
  appendWorkflowProgressEvent,
  formatWorkflowDurationLabel,
  getSidebarTaskTimeSource,
  normalizeWorkflowProgress,
} = await import('../frontend-react/src/components/creative/creativeProgress.js');
const { normalizeWorkflowStages } = await import('../frontend-react/src/components/creative/creativeDisplay.js');

assert.equal(normalizeWorkflowProgress({ current_progress: 68.6 }), 69);
assert.equal(normalizeWorkflowProgress({ current_progress: 140 }), 100);
assert.equal(normalizeWorkflowProgress({ current_progress: -20 }), 0);
assert.equal(normalizeWorkflowProgress({}), 0);
assert.equal(normalizeWorkflowProgress({ status: 'done' }), 100);

const retryStages = normalizeWorkflowStages({
  status: 'running',
  current_stage: 'project',
  current_stage_message: '正在生成第 2/6 帧 HTML...',
  stages: [
    { id: 'source', label: '准备来源资料', status: 'done' },
    { id: 'project', label: '生成工程', status: 'failed', message: 'AI 未返回有效 HTML document。' },
  ],
});
assert.equal(retryStages.find(stage => stage.id === 'project').status, 'running');
assert.equal(retryStages.find(stage => stage.id === 'project').message, '正在生成第 2/6 帧 HTML...');

assert.equal(
  formatWorkflowDurationLabel({
    status: 'done',
    created_at: '2026-06-27T01:00:00.000Z',
    updated_at: '2026-06-27T01:10:00.000Z',
    stages: [
      { id: 'render', completed_at: '2026-06-27T01:01:05.000Z' },
      { id: 'inspect', completed_at: '2026-06-27T01:02:09.000Z' },
    ],
  }),
  '用时 2 分 9 秒',
);

assert.equal(
  formatWorkflowDurationLabel({
    status: 'done',
    created_at: '2026-06-27T01:00:00.000Z',
    updated_at: '2026-06-27T01:00:09.000Z',
    stages: [],
  }),
  '用时 9 秒',
);

assert.equal(
  formatWorkflowDurationLabel({
    status: 'running',
    created_at: '2026-06-27T01:00:00.000Z',
    updated_at: '2026-06-27T01:00:09.000Z',
  }),
  '',
);

assert.equal(
  getSidebarTaskTimeSource({
    created_at: '2026-06-27T01:00:00.000Z',
    updated_at: '2026-06-27T01:09:00.000Z',
  }),
  '2026-06-27T01:00:00.000Z',
);

let eventsByWorkflow = {};
for (let index = 0; index < 31; index += 1) {
  eventsByWorkflow = appendWorkflowProgressEvent(eventsByWorkflow, {
    workflow_id: 'workflow-1',
    type: 'html_video_frame_html_done',
    seq: index + 1,
    data: { index, total: 31 },
  }, { now: () => `received-${index}` });
}

assert.equal(eventsByWorkflow['workflow-1'].length, 30);
assert.equal(eventsByWorkflow['workflow-1'][0].seq, 2);
assert.equal(eventsByWorkflow['workflow-1'][29].received_at, 'received-30');

assert.equal(
  appendWorkflowProgressEvent(eventsByWorkflow, { type: 'stage_progress' }),
  eventsByWorkflow,
);

const { summarizeProgressEvent } = await import('../frontend-react/src/components/creative/creativeProgress.js');
assert.equal(
  summarizeProgressEvent({
    type: 'html_video_frame_html_parallel_started',
    data: { completed: 1, total: 4, concurrency: 3 },
  }),
  '已完成 1/4 项 · 并发上限 3',
);

console.log('creative progress visibility tests passed');
