const assert = require('assert/strict');

const {
  getWorkflowOutputUrl,
  normalizeCreativeWorkflowDto,
  normalizeCreativeWorkflowSummary,
} = require('../server/services/creative/creativeWorkflowDto');

const createdAt = '2026-07-03T12:00:00.000Z';
const updatedAt = '2026-07-03T12:10:00.000Z';

const workflow = {
  workflow_id: '202607031200000001',
  status: 'done',
  message: '视频生成完成。',
  title: '旧标题',
  created_at: createdAt,
  updated_at: updatedAt,
  creative_context: {
    input: {
      raw_text: '做一个产品介绍视频',
    },
  },
  active_task: null,
  result: {
    hyperframes_freeform: {
      title: '归一标题',
      project: {
        scene_spec: { title: '场景标题' },
        html_video_project: { id: 'project-1' },
        layout_qa: { status: 'passed' },
      },
      render: {
        output_url: '/api/old-output.mp4',
        output_path: 'D:/tmp/output.mp4',
        exports: [{ id: 'export-1', output_url: '/api/export.mp4' }],
      },
    },
  },
};

assert.equal(getWorkflowOutputUrl(workflow), '/api/old-output.mp4');
assert.equal(getWorkflowOutputUrl({ render_output_url: '/api/top-output.mp4' }), '/api/top-output.mp4');
assert.equal(getWorkflowOutputUrl({
  result: {
    render: { output_url: '/api/result-render.mp4' },
    hyperframes_freeform: { render: { output_url: '/api/hyperframes-render.mp4' } },
  },
}), '/api/result-render.mp4');
assert.equal(getWorkflowOutputUrl({
  stages: [{
    id: 'render',
    result: { render: { output_url: '/api/stage-render.mp4' } },
  }],
}), '/api/stage-render.mp4');
assert.equal(getWorkflowOutputUrl({
  stages: [{
    id: 'render',
    result: { output_url: '/api/stage-output.mp4' },
  }],
}), '/api/stage-output.mp4');
assert.equal(getWorkflowOutputUrl({
  stages: [{
    id: 'render',
    result: { video: { output_url: '/api/stage-video.mp4' } },
  }],
}), '/api/stage-video.mp4');
assert.equal(getWorkflowOutputUrl({
  stages: [{
    id: 'render',
    result: {
      hyperframes_freeform: { render: { output_url: '/api/stage-hyperframes.mp4' } },
    },
  }],
}), '/api/stage-hyperframes.mp4');

const dto = normalizeCreativeWorkflowDto(workflow);
assert.equal(dto.success, true);
assert.equal(dto.workflow_id, '202607031200000001');
assert.equal(dto.status, 'done');
assert.equal(dto.title, '归一标题');
assert.equal(dto.input, '做一个产品介绍视频');
assert.deepEqual(dto.result.render, {
  output_url: '/api/old-output.mp4',
  output_path: 'D:/tmp/output.mp4',
  exports: [{ id: 'export-1', output_url: '/api/export.mp4' }],
});
assert.deepEqual(dto.result.scene_spec, { title: '场景标题' });
assert.deepEqual(dto.result.html_video_project, { id: 'project-1' });
assert.deepEqual(dto.result.layout_qa, { status: 'passed' });
assert.equal(dto.workflow, workflow);

assert.deepEqual(normalizeCreativeWorkflowSummary(workflow), {
  workflow_id: '202607031200000001',
  status: 'done',
  message: '视频生成完成。',
  title: '归一标题',
  input: '做一个产品介绍视频',
  created_at: createdAt,
  updated_at: updatedAt,
  output_url: '/api/old-output.mp4',
  active_task: null,
});

const missingDto = normalizeCreativeWorkflowDto(null);
assert.equal(missingDto.success, false);
assert.equal(missingDto.message, '创作任务不存在。');

assert.deepEqual(normalizeCreativeWorkflowSummary(null), {
  workflow_id: '',
  status: '',
  message: '创作任务不存在。',
  title: '',
  input: '',
  created_at: '',
  updated_at: '',
  output_url: '',
  active_task: null,
});

console.log('test-creative-workflow-dto passed');
