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
assert.equal(project.generation_checkpoint.version, 1);
assert.equal(project.generation_checkpoint.workflow_id, 'workflow_001');
assert.equal(project.generation_checkpoint.run_id, 'run_001');
assert.deepEqual(project.generation_checkpoint.model_calls, []);
assert.equal(project.generation_checkpoint.stages.content_graph.status, 'pending');
assert.deepEqual(project.generation_checkpoint.stages.frame_html.frames, {});
assert.deepEqual(project.generation_checkpoint.stages.render.frames, {});

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
  const checkpointProject = schema.normalizeProject({
    workflow_id: 'workflow_checkpoint',
    run_id: 'run_checkpoint',
    generation_checkpoint: {
      version: 99,
      workflow_id: 'custom_workflow',
      run_id: 'custom_run',
      scene_spec_hash: 'scene-hash',
      target: { duration_sec: 12, aspect_ratio: '9:16', unknown: true },
      stages: {
        content_graph: {
          status: 'done',
          path: 'content-graph.json',
          input_hash: 'input',
          output_hash: 'output',
          diagnostic_code: '',
          ignored: 'drop',
        },
        frame_html: {
          status: 'done',
          frames: {
            scene_01: {
              status: 'done',
              html_path: 'frames/01-scene_01.html',
              input_hash: 'frame-input',
              output_hash: 'frame-output',
              diagnostic_code: '',
              ignored: 'drop',
            },
          },
        },
      },
      ignored: 'drop',
    },
  });

  assert.deepEqual(checkpointProject.generation_checkpoint, {
    version: 1,
    workflow_id: 'custom_workflow',
    run_id: 'custom_run',
    scene_spec_hash: 'scene-hash',
    target: { duration_sec: 12, aspect_ratio: '9:16' },
    model_calls: [],
    stages: {
      validate_project: { status: 'pending', diagnostic_code: '' },
      content_graph: {
        status: 'done',
        path: 'content-graph.json',
        input_hash: 'input',
        output_hash: 'output',
        diagnostic_code: '',
      },
      frame_html: {
        status: 'done',
        frames: {
          scene_01: {
            status: 'done',
            html_path: 'frames/01-scene_01.html',
            input_hash: 'frame-input',
            output_hash: 'frame-output',
            diagnostic_code: '',
          },
        },
      },
      render: { status: 'pending', frames: {} },
      compose: { status: 'pending', output_path: '', output_audio_path: '', diagnostic_code: '' },
      duration_verify: { status: 'pending', expected_duration_sec: null, actual_duration_sec: null, diagnostic_code: '' },
      visual_inspect: { status: 'pending', report_path: null, diagnostic_code: '' },
    },
    updated_at: '',
  });

  schema.markCheckpointStage(checkpointProject, 'content_graph', { status: 'failed', diagnostic_code: 'bad_graph' });
  schema.markCheckpointFrame(checkpointProject, 'frame_html', 'scene_02', { status: 'failed', diagnostic_code: 'bad_html' });
  assert.equal(checkpointProject.generation_checkpoint.stages.content_graph.status, 'failed');
  assert.equal(checkpointProject.generation_checkpoint.stages.content_graph.diagnostic_code, 'bad_graph');
  assert.equal(checkpointProject.generation_checkpoint.stages.frame_html.frames.scene_02.status, 'failed');
  assert.equal(checkpointProject.generation_checkpoint.stages.frame_html.frames.scene_02.diagnostic_code, 'bad_html');
  assert.ok(checkpointProject.generation_checkpoint.updated_at);
}

{
  const checkpointProject = schema.createEmptyProject({
    workflowId: 'workflow_calls',
    runId: 'run_calls',
  });
  schema.appendCheckpointModelCall(checkpointProject, {
    agent: 'planner',
    stage: 'content_graph',
    sub_stage: 'draft',
    frame_id: 'frame_01',
    node_id: 'node_01',
    attempt: 2,
    model: { provider: 'OpenAI', model_id: 'gpt-test' },
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 'bad', cached_tokens: 2 },
    duration_ms: 1234,
    error: 'ignored when success',
    extra: 'drop',
  });

  const firstCall = checkpointProject.generation_checkpoint.model_calls[0];
  assert.equal(checkpointProject.generation_checkpoint.model_calls.length, 1);
  assert.match(firstCall.id, /^model_call_/);
  assert.ok(firstCall.created_at);
  assert.equal(firstCall.agent, 'planner');
  assert.equal(firstCall.stage, 'content_graph');
  assert.equal(firstCall.sub_stage, 'draft');
  assert.equal(firstCall.frame_id, 'frame_01');
  assert.equal(firstCall.node_id, 'node_01');
  assert.equal(firstCall.attempt, 2);
  assert.deepEqual(firstCall.model, { provider: 'OpenAI', model_id: 'gpt-test' });
  assert.deepEqual(firstCall.usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: null, cached_tokens: 2 });
  assert.equal(firstCall.duration_ms, 1234);
  assert.equal(firstCall.success, true);
  assert.equal(firstCall.error, 'ignored when success');
  assert.equal(Object.prototype.hasOwnProperty.call(firstCall, 'extra'), false);

  const normalized = schema.normalizeGenerationCheckpoint({
    model_calls: [{
      ...firstCall,
      success: false,
      extra: 'drop',
      usage: {
        prompt_tokens: 'bad',
      },
    }],
  }, checkpointProject);
  assert.equal(normalized.model_calls.length, 1);
  assert.equal(normalized.model_calls[0].id, firstCall.id);
  assert.equal(normalized.model_calls[0].success, false);
  assert.deepEqual(normalized.model_calls[0].usage, {
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    cached_tokens: null,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.model_calls[0], 'extra'), false);

  for (let index = 0; index < 505; index += 1) {
    schema.appendCheckpointModelCall(checkpointProject, { id: `explicit_${index}`, created_at: `2026-06-12T12:00:${String(index % 60).padStart(2, '0')}.000Z` });
  }
  assert.equal(checkpointProject.generation_checkpoint.model_calls.length, 500);
  assert.equal(checkpointProject.generation_checkpoint.model_calls[0].id, 'explicit_5');
  assert.equal(checkpointProject.generation_checkpoint.model_calls[499].id, 'explicit_504');
}

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
