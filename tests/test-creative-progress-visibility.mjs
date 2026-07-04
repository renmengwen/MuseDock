import assert from 'node:assert/strict';

const {
  appendWorkflowProgressEvent,
  applyWorkflowStageEvent,
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

const stageDoneCurrent = normalizeWorkflowStages({
  status: 'running',
  current_stage: 'research',
  stages: [
    { id: 'source', label: '准备来源资料', status: 'done' },
    { id: 'research', label: '联网研究', status: 'done', message: '联网研究资料已准备完成。' },
  ],
});
assert.equal(stageDoneCurrent.find(stage => stage.id === 'research').status, 'done');

const syncedWorkflow = applyWorkflowStageEvent({
  status: 'running',
  current_stage: 'research',
  stages: [
    { id: 'source', status: 'done' },
    { id: 'research', status: 'running' },
    { id: 'assets', status: 'pending' },
    { id: 'audio', status: 'pending' },
  ],
}, {
  type: 'stage_started',
  stage: 'audio',
  message: '正在生成音频轨...',
});
assert.equal(syncedWorkflow.stages.find(stage => stage.id === 'research').status, 'done');
assert.equal(syncedWorkflow.stages.find(stage => stage.id === 'audio').status, 'running');

const audioDoneWorkflow = applyWorkflowStageEvent(syncedWorkflow, {
  type: 'stage_done',
  stage: 'audio',
  message: '分段配音已生成。',
});
assert.equal(audioDoneWorkflow.stages.find(stage => stage.id === 'audio').status, 'done');
assert.equal(audioDoneWorkflow.stages.find(stage => stage.id === 'audio').message, '分段配音已生成。');

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

let renderProgressEvents = {};
for (const percent of [12, 48, 90]) {
  renderProgressEvents = appendWorkflowProgressEvent(renderProgressEvents, {
    workflow_id: 'workflow-render',
    type: 'html_video_frame_render_progress',
    seq: percent,
    frame_id: 'frame_01',
    data: { frame_id: 'frame_01', index: 0, total: 2, percent },
  }, { now: () => `render-${percent}` });
}
renderProgressEvents = appendWorkflowProgressEvent(renderProgressEvents, {
  workflow_id: 'workflow-render',
  type: 'html_video_frame_render_progress',
  seq: 13,
  frame_id: 'frame_02',
  data: { frame_id: 'frame_02', index: 1, total: 2, percent: 13 },
}, { now: () => 'render-frame-02' });
assert.equal(renderProgressEvents['workflow-render'].length, 2);
assert.equal(renderProgressEvents['workflow-render'][0].seq, 90);
assert.equal(renderProgressEvents['workflow-render'][0].data.percent, 90);
assert.equal(renderProgressEvents['workflow-render'][1].frame_id, 'frame_02');

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

assert.equal(
  summarizeProgressEvent({
    type: 'html_video_frame_html_started',
    data: { index: 0, total: 8, completed: 0 },
  }),
  '第 1/8 项',
);

console.log('creative progress visibility tests passed');
