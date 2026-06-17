const assert = require('assert');

const schema = require('../server/services/creative-video/html-video/projectSchema');

const project = schema.createEmptyProject({
  projectId: 'project_001',
  workflowId: 'workflow_001',
  runId: 'run_001',
});

assert.equal(project.project_id, 'project_001');
assert.equal(project.workflow_id, 'workflow_001');
assert.equal(project.run_id, 'run_001');
assert.equal(project.schema_version, 1);
assert.equal(project.template_id, null);
assert.deepEqual(project.template_inputs, {});
assert.deepEqual(project.content_graph, { schemaVersion: 1, intent: 'promo', synopsis: '', nodes: [], edges: [] });
assert.deepEqual(project.frames, []);
assert.deepEqual(project.timeline, {
  tracks: [
    { id: 'main', type: 'video', items: [] },
    { id: 'voice', type: 'audio', items: [] },
    { id: 'music', type: 'audio', items: [] },
  ],
});
assert.deepEqual(project.assets, []);
assert.deepEqual(project.audio, {
  tts_manifest_path: null,
  narration_path: null,
  music_path: null,
  mix: {
    music_volume_db: -18,
    narration_volume_db: 0,
    fade_in_sec: 0,
    fade_out_sec: 1.5,
  },
});
assert.deepEqual(project.overrides, { html: { enabled: false, frames: {} }, elements: {}, transitions: {} });
assert.deepEqual(project.revisions, []);
assert.deepEqual(project.exports, []);
assert.equal(project.status, 'draft');

const outputProject = schema.normalizeProject({
  project_id: 'p1',
  output: {
    resolution: { width: 1080, height: 1920 },
    fps: 24,
    duration: 7,
  },
  template_schema: {
    type: 'object',
    properties: { headline: { type: 'string', label: '标题' } },
  },
});

assert.deepEqual(outputProject.output.resolution, { width: 1080, height: 1920 });
assert.equal(outputProject.output.fps, 24);
assert.equal(outputProject.output.duration, 7);
assert.equal(outputProject.template_schema.properties.headline.label, '标题');

const normalized = schema.normalizeProject({
  project_id: 'project_002',
  workflow_id: 'workflow_002',
  run_id: 'run_002',
  schema_version: 999,
  frames: [
    {
      id: 'frame_01',
      scene_id: 'scene_01',
      order: 1,
      template_id: 'basic',
      duration_sec: 4,
      captions: [{ text: '保留字幕' }],
      metadata: { visual_text: { headline: '保留元数据' } },
    },
  ],
});

assert.equal(normalized.schema_version, 1);
assert.equal(normalized.frames[0].graph_node_id, null);
assert.deepEqual(normalized.frames[0].inputs, {});
assert.equal(normalized.frames[0].html_path, null);
assert.equal(normalized.frames[0].engine, 'hyperframes-playwright');
assert.deepEqual(normalized.frames[0].transition_in, { type: 'cut', duration_sec: 0, params: {} });
assert.deepEqual(normalized.frames[0].transition_out, { type: 'cut', duration_sec: 0, params: {} });
assert.deepEqual(normalized.frames[0].trim, { in_sec: 0, out_sec: null });
assert.equal(normalized.frames[0].speed, 1);
assert.equal(normalized.frames[0].loop, false);
assert.deepEqual(normalized.frames[0].enhancement, {
  enabled: false,
  engine: null,
  template_id: null,
  data: null,
  preview_mp4_path: null,
});
assert.deepEqual(normalized.frames[0].captions, [{ text: '保留字幕' }]);
assert.deepEqual(normalized.frames[0].metadata, { visual_text: { headline: '保留元数据' } });

assert.deepEqual(schema.validateProject(normalized), { ok: true, errors: [], warnings: [] });

function assertValidationError(input, code, ref) {
  const result = schema.validateProject(schema.normalizeProject(input));
  assert.equal(result.ok, false);
  const error = result.errors.find(item => item.code === code);
  assert.ok(error, `expected validation error ${code}`);
  if (ref) {
    assert.equal(error.ref, ref);
  }
}

assertValidationError({
  project_id: 'project_003',
  workflow_id: 'workflow_003',
  run_id: 'run_003',
  assets: [{ id: 'asset_01', path: '/tmp/escape.png' }],
}, 'asset-path-absolute', 'asset_01');

assertValidationError({
  project_id: 'project_004',
  workflow_id: 'workflow_004',
  run_id: 'run_004',
  assets: [{ id: 'asset_02', path: '../escape.png' }],
}, 'asset-path-escape', 'asset_02');

assertValidationError({
  project_id: 'project_005',
  workflow_id: 'workflow_005',
  run_id: 'run_005',
  timeline: {
    tracks: [
      { id: 'main', type: 'video', items: [{ id: 'clip_01', kind: 'video', frame_id: 'frame_01' }] },
    ],
  },
}, 'timeline-item-kind-unsupported', 'main/clip_01');

console.log('html-video project schema tests passed');
