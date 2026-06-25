const assert = require('assert');

const { computeSceneSpecSpeechHash } = require('../server/services/creative-video/sceneSpecHash');
const { validateSceneSpecTimelineConsistency } = require('../server/services/creative-video/html-video/timelineConsistency');

function spec() {
  return {
    scenes: [
      { id: 'scene_01', order: 1, narration_text: '第一段', captions: [{ text: '字幕一' }] },
      { id: 'scene_02', order: 2, narration_text: '第二段', captions: [{ text: '字幕二' }] },
    ],
  };
}

function project() {
  return {
    frames: [
      { id: 'scene_01', scene_id: 'scene_01', narration_text: '第一段', captions: [{ text: '字幕一' }] },
      { id: 'scene_02', scene_id: 'scene_02', narration_text: '第二段', captions: [{ text: '字幕二' }] },
    ],
    audio: {
      source: 'scene_spec',
      scene_spec_hash: computeSceneSpecSpeechHash(spec()),
      scene_count: 2,
      scene_ids: ['scene_01', 'scene_02'],
      narration_path: 'tts/combined.wav',
      status: 'ready',
    },
  };
}

function diagnosticByCode(result, code) {
  return result.diagnostics.find(item => item.code === code);
}

function assertDiagnosticCode(result, code) {
  const diagnostic = diagnosticByCode(result, code);
  assert.ok(diagnostic, `Expected diagnostic ${code}`);
  return diagnostic;
}

{
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: project(), audio: project().audio });
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
}

{
  const badProject = project();
  badProject.frames = [badProject.frames[1], badProject.frames[0]];
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  const diagnostic = assertDiagnosticCode(result, 'frame_scene_order_mismatch');
  assert.equal(diagnostic.details.index, 0);
  assert.equal(diagnostic.details.expected_scene_id, 'scene_01');
  assert.equal(diagnostic.details.actual_scene_id, 'scene_02');
  assert.equal(diagnostic.sub_stage, 'timeline_check');
  assert.equal(diagnostic.frame_id, 'scene_02');
  assert.equal(Object.hasOwn(diagnostic.details, 'frame_id'), false);
}

for (const emptySceneSpec of [{ scenes: [] }, {}]) {
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: emptySceneSpec, project: project(), audio: project().audio });
  assert.equal(result.ok, false);
  const diagnostic = assertDiagnosticCode(result, 'scene_spec_empty');
  assert.deepEqual(diagnostic.details, {
    scene_count: 0,
    frame_count: 2,
    has_scene_spec: true,
  });
}

{
  const badProject = project();
  badProject.frames = badProject.frames.slice(0, 1);
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assertDiagnosticCode(result, 'frame_scene_count_mismatch');
}

{
  const badProject = project();
  badProject.frames[1].scene_id = 'scene_03';
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  const diagnostic = assertDiagnosticCode(result, 'frame_scene_missing');
  assert.equal(diagnostic.sub_stage, 'timeline_check');
  assert.equal(diagnostic.frame_id, 'scene_02');
  assert.equal(Object.hasOwn(diagnostic.details, 'frame_id'), false);
}

{
  const badProject = project();
  badProject.frames[1].scene_id = 'scene_01';
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assertDiagnosticCode(result, 'frame_scene_duplicate');
  assertDiagnosticCode(result, 'frame_scene_missing');
}

{
  const badProject = project();
  badProject.frames[0].narration_text = '错误旁白';
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  const diagnostic = assertDiagnosticCode(result, 'frame_narration_mismatch');
  assert.equal(diagnostic.details.expected_narration_length, 3);
  assert.equal(diagnostic.details.actual_narration_length, 4);
}

{
  const camelCaseSpec = {
    scenes: [
      { id: 'scene_01', order: 1, narrationText: '第一段', captions: [{ text: '字幕一' }] },
    ],
  };
  const badProject = {
    frames: [
      { id: 'scene_01', sceneId: 'scene_01', narrationText: '错误旁白', captions: [{ text: '字幕一' }] },
    ],
    audio: {
      source: 'scene_spec',
      scene_spec_hash: computeSceneSpecSpeechHash(camelCaseSpec),
      scene_count: 1,
      scene_ids: ['scene_01'],
      narration_path: 'tts/combined.wav',
      status: 'ready',
    },
  };
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: camelCaseSpec, project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assertDiagnosticCode(result, 'frame_narration_mismatch');
}

{
  const badProject = project();
  badProject.frames[0].captions = [{ text: '错误字幕' }, { text: '多余字幕' }];
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  const diagnostic = assertDiagnosticCode(result, 'frame_captions_mismatch');
  assert.equal(diagnostic.details.expected_caption_count, 1);
  assert.equal(diagnostic.details.actual_caption_count, 2);
}

{
  const richSpec = spec();
  richSpec.scenes[0].captions = [{ id: 'caption_01', start: 0, end: 1.2, text: '字幕一', style: { color: 'red', fontSize: 18 } }];
  const richProject = project();
  richProject.frames[0].captions = [{ text: '字幕一', duration: 1.2, style: { fontSize: 18, color: 'red' }, end: 1.2, start: 0, id: 'caption_01' }];
  richProject.audio.scene_spec_hash = computeSceneSpecSpeechHash(richSpec);
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: richSpec, project: richProject, audio: richProject.audio });
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
}

{
  const longText = 'AI 大时代，金字塔顶尖的学生毕业就能实现别人一辈子达不到的财富高度。';
  const longSpec = {
    scenes: [
      { id: 'scene_01', order: 1, duration: 8, narration_text: longText, captions: [{ id: 'cap_01', start: 0, end: 8, text: longText }] },
    ],
  };
  const longProject = {
    frames: [
      {
        id: 'scene_01',
        scene_id: 'scene_01',
        duration_sec: 8,
        narration_text: longText,
        captions: [
          { id: 'cap_01_01', start: 0, end: 1.6, duration: 1.6, text: 'AI 大时代，' },
          { id: 'cap_01_02', start: 1.6, end: 8, duration: 6.4, text: '金字塔顶尖的学生毕业就能实现别人一辈子达不到的财富高度。' },
        ],
      },
    ],
    audio: {
      source: 'scene_spec',
      scene_spec_hash: computeSceneSpecSpeechHash(longSpec),
      scene_count: 1,
      scene_ids: ['scene_01'],
      narration_path: 'tts/combined.wav',
      status: 'ready',
    },
  };
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: longSpec, project: longProject, audio: longProject.audio });
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
}

{
  const richSpec = spec();
  richSpec.scenes[0].captions = [{ id: 'caption_01', start: 0, end: 1.2, text: '字幕一', style: { color: 'red' } }];
  const badProject = project();
  badProject.frames[0].captions = [{ id: 'caption_01', start: 0, end: 1.2, text: '字幕一', style: { color: 'blue' } }];
  badProject.audio.scene_spec_hash = computeSceneSpecSpeechHash(richSpec);
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: richSpec, project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assertDiagnosticCode(result, 'frame_captions_mismatch');
}

{
  const richSpec = spec();
  richSpec.scenes[0].captions = [{ id: 'caption_01', start: 0, end: 1.2, text: '字幕一' }];
  const badProject = project();
  badProject.frames[0].captions = [{ id: 'caption_01', start: 0.1, end: 1.2, text: '字幕一' }];
  badProject.audio.scene_spec_hash = computeSceneSpecSpeechHash(richSpec);
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: richSpec, project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assertDiagnosticCode(result, 'frame_captions_mismatch');
}

{
  const fallbackProject = project();
  delete fallbackProject.frames[0].scene_id;
  delete fallbackProject.frames[1].scene_id;
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: fallbackProject, audio: fallbackProject.audio });
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
}

{
  const fallbackProject = project();
  fallbackProject.frames[0].scene_id = '   ';
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: fallbackProject, audio: fallbackProject.audio });
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
}

{
  const badProject = project();
  badProject.audio.scene_spec_hash = 'legacy-hash';
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  const diagnostic = assertDiagnosticCode(result, 'audio_scene_spec_hash_mismatch');
  assert.equal(diagnostic.severity, 'error');
  assert.deepEqual(diagnostic.details, {
    expected_scene_spec_hash: computeSceneSpecSpeechHash(spec()),
    audio_scene_spec_hash: 'legacy-hash',
    audio_source: 'scene_spec',
    audio_scene_count: 2,
    audio_scene_ids: ['scene_01', 'scene_02'],
    audio_path_present: true,
    audio_path: 'tts/combined.wav',
  });
}

{
  const badProject = project();
  badProject.audio = {
    source: 'scene_spec',
    scene_spec_hash: 'legacy-hash',
    scene_count: 2,
    scene_ids: ['scene_01', 'scene_02'],
    path: 'tts/current.wav',
    status: 'ready',
  };
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assertDiagnosticCode(result, 'audio_scene_spec_hash_mismatch');
}

{
  const badProject = project();
  badProject.audio = {
    source: 'scene_spec',
    scene_spec_hash: 'legacy-hash',
    scene_count: 2,
    scene_ids: ['scene_01', 'scene_02'],
    narrationPath: 'tts/current.wav',
    status: 'ready',
  };
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assertDiagnosticCode(result, 'audio_scene_spec_hash_mismatch');
}

{
  const badProject = project();
  badProject.audio = {
    source: 'scene_spec',
    scene_spec_hash: 'legacy-hash',
    scene_count: 2,
    scene_ids: ['scene_01', 'scene_02'],
    combined_path: 'tts/combined.wav',
    status: 'ready',
  };
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assertDiagnosticCode(result, 'audio_scene_spec_hash_mismatch');
}

{
  const legacyAudioProject = project();
  legacyAudioProject.audio = {
    source: 'scene_spec',
    scene_spec_hash: 'legacy-hash',
    scene_count: 2,
    scene_ids: ['scene_01', 'scene_02'],
    path: '   ',
    narration_path: '\t',
    narrationPath: '\n',
    combined_path: '  ',
    status: 'ready',
  };
  const result = validateSceneSpecTimelineConsistency({
    sceneSpec: spec(),
    project: legacyAudioProject,
    audio: legacyAudioProject.audio,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
}

{
  const legacyAudioProject = project();
  legacyAudioProject.audio = {
    source: 'scene_spec',
    scene_spec_hash: 'legacy-hash',
    scene_count: 2,
    scene_ids: ['scene_01', 'scene_02'],
    status: 'ready',
  };
  const result = validateSceneSpecTimelineConsistency({
    sceneSpec: spec(),
    project: legacyAudioProject,
    audio: legacyAudioProject.audio,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
}
