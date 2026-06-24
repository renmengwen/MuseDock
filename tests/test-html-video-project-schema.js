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
assert.deepEqual(project.output.resolution, { width: 1920, height: 1080 });
assert.equal(project.output.fps, 30);
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
  source: null,
  scene_spec_hash: null,
  scene_count: 0,
  scene_ids: [],
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

const audioHashProject = schema.normalizeProject({
  project_id: 'audio_hash_project',
  audio: {
    source: 'scene_spec',
    scene_spec_hash: 'hash-001',
    scene_count: 2,
    scene_ids: ['scene_01', 'scene_02'],
    narration_path: 'tts/narration.wav',
    tts_manifest_path: 'tts/manifest.json',
    music_path: 'music/background.mp3',
    mix: {
      music_volume_db: -12,
      narration_volume_db: 1,
    },
  },
});

assert.equal(audioHashProject.audio.source, 'scene_spec');
assert.equal(audioHashProject.audio.scene_spec_hash, 'hash-001');
assert.equal(audioHashProject.audio.scene_count, 2);
assert.deepEqual(audioHashProject.audio.scene_ids, ['scene_01', 'scene_02']);
assert.equal(audioHashProject.audio.narration_path, 'tts/narration.wav');
assert.equal(audioHashProject.audio.tts_manifest_path, 'tts/manifest.json');
assert.equal(audioHashProject.audio.music_path, 'music/background.mp3');
assert.equal(audioHashProject.audio.mix.music_volume_db, -12);
assert.equal(audioHashProject.audio.mix.narration_volume_db, 1);
assert.equal(audioHashProject.audio.mix.fade_in_sec, 0);
assert.equal(audioHashProject.audio.mix.fade_out_sec, 1.5);

{
  const project = schema.normalizeProject({
    project_id: 'audio_hash_camel_project',
    audio: {
      sceneIds: ['scene_camel_01', 'scene_camel_02'],
    },
  });

  assert.deepEqual(project.audio.scene_ids, ['scene_camel_01', 'scene_camel_02']);
}

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
assert.equal(normalized.frames[0].graph_node_id, normalized.frames[0].id);
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
assert.equal(normalized.frames[0].captions.length, 1);
assert.equal(normalized.frames[0].captions[0].id, 'frame_01_caption_01');
assert.equal(normalized.frames[0].captions[0].text, '保留字幕');
assert.equal(normalized.frames[0].captions[0].start, 0);
assert.equal(normalized.frames[0].captions[0].end, 4);
assert.equal(normalized.frames[0].captions[0].duration, 4);
assert.deepEqual(normalized.frames[0].metadata, { visual_text: { headline: '保留元数据' } });

{
  const project = schema.normalizeProject({
    project_id: 'wf_run',
    frames: [
      {
        id: 'scene_01',
        source_mode: 'raw_html',
        html_path: 'frames/01-scene_01.html',
        duration_sec: 4,
        narration_text: '第一帧旁白。',
        metadata: {
          visual_text: { headline: '标题一' },
        },
      },
    ],
  });

  assert.equal(project.frames[0].id, 'scene_01');
  assert.equal(project.frames[0].scene_id, 'scene_01');
  assert.equal(project.frames[0].graph_node_id, 'scene_01');
  assert.equal(project.frames[0].order, 1);
  assert.equal(project.frames[0].source_mode, 'raw_html');
  assert.equal(project.frames[0].duration_sec, 4);
  assert.equal(project.frames[0].captions.length, 1);
  assert.equal(project.frames[0].captions[0].text, '第一帧旁白。');
  assert.equal(project.frames[0].captions[0].start, 0);
  assert.equal(project.frames[0].captions[0].end, 4);
  assert.equal(project.frames[0].metadata.visual_text.headline, '标题一');
}

{
  const project = schema.normalizeProject({
    project_id: 'captions_disabled_project',
    frames: [
      {
        id: 'scene_no_captions',
        duration_sec: 4,
        narration_text: '这段旁白不应该被自动生成字幕。',
        captions: [],
        generate_captions: false,
      },
    ],
  });

  assert.equal(project.frames[0].generate_captions, false);
  assert.deepEqual(project.frames[0].captions, []);
}

{
  const project = schema.normalizeProject({
    project_id: 'camel_case_project',
    frames: [
      {
        id: 'camel_frame',
        sourceMode: 'raw_html',
        htmlPath: 'frames/camel.html',
        durationSec: 5,
        narrationText: '驼峰字段旁白。',
        graphNodeId: 'graph_camel',
      },
    ],
  });

  assert.equal(project.frames[0].source_mode, 'raw_html');
  assert.equal(project.frames[0].html_path, 'frames/camel.html');
  assert.equal(project.frames[0].duration_sec, 5);
  assert.equal(project.frames[0].narration_text, '驼峰字段旁白。');
  assert.equal(project.frames[0].graph_node_id, 'graph_camel');
  assert.equal(project.frames[0].captions[0].end, 5);
}

{
  const project = schema.normalizeProject({
    project_id: 'default_id_project',
    frames: [
      {},
    ],
  });

  assert.equal(project.frames[0].id, 'frame_01');
  assert.equal(project.frames[0].scene_id, 'frame_01');
  assert.equal(project.frames[0].graph_node_id, 'frame_01');
}

{
  const project = schema.normalizeProject({
    project_id: 'trim_project',
    frames: [
      {
        id: '  ',
        scene_id: '  ',
        sceneId: ' scene_camel ',
        graph_node_id: '  ',
        graphNodeId: ' graph_camel ',
      },
      {
        id: ' frame_explicit ',
        scene_id: '  ',
        graph_node_id: '  ',
      },
    ],
  });

  assert.equal(project.frames[0].id, 'scene_camel');
  assert.equal(project.frames[0].scene_id, 'scene_camel');
  assert.equal(project.frames[0].graph_node_id, 'graph_camel');
  assert.equal(project.frames[1].id, 'frame_explicit');
  assert.equal(project.frames[1].scene_id, 'frame_explicit');
  assert.equal(project.frames[1].graph_node_id, 'frame_explicit');
}

{
  const project = schema.normalizeProject({
    project_id: 'fallback_project',
    frames: [
      {
        id: 'fallback_frame',
        source_mode: 'unsupported',
        duration_sec: 0,
        speed: 0,
      },
    ],
  });

  assert.equal(project.frames[0].source_mode, 'template_inputs');
  assert.equal(project.frames[0].duration_sec, 3);
  assert.equal(project.frames[0].speed, 1);
}

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
