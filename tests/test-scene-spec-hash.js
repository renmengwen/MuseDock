const assert = require('assert');

const {
  getSceneSpecSpeechSignature,
  computeSceneSpecSpeechHash,
  audioMatchesSceneSpec,
} = require('../server/services/creative-video/sceneSpecHash');

function sceneSpec(overrides = {}) {
  return {
    title: '测试视频',
    scenes: [
      {
        id: 'scene_01',
        order: 1,
        narration_text: '第一段旁白',
        captions: [{ start: 0, end: 1.2, text: '第一段字幕' }],
        visual_text: { headline: '视觉标题 A' },
        visual_variant: 'visual-template-a',
      },
      {
        id: 'scene_02',
        order: 2,
        narration_text: '第二段旁白',
        captions: [{ start: 0, end: 1.4, text: '第二段字幕' }],
        visual_text: { headline: '视觉标题 B' },
        visual_variant: 'visual-template-b',
      },
    ],
    ...overrides,
  };
}

function matchingAudio(spec) {
  const hash = computeSceneSpecSpeechHash(spec);
  return {
    source: 'scene_spec',
    scene_spec_hash: hash,
    scene_count: spec.scenes.length,
    scene_ids: spec.scenes.map(scene => scene.id),
    path: 'D:/tmp/current.wav',
    status: 'ready',
  };
}

{
  assert.deepEqual(getSceneSpecSpeechSignature(null), { version: 1, scenes: [] });
  assert.deepEqual(getSceneSpecSpeechSignature(['not-object']), { version: 1, scenes: [] });
  assert.equal(typeof computeSceneSpecSpeechHash(null), 'string');
  assert.equal(typeof computeSceneSpecSpeechHash('not-object'), 'string');
  assert.equal(audioMatchesSceneSpec(null, { scenes: [] }), false);
  assert.equal(audioMatchesSceneSpec([], { scenes: [] }), false);
  assert.equal(audioMatchesSceneSpec('not-object', { scenes: [] }), false);
}

{
  const spec = sceneSpec();
  assert.deepEqual(getSceneSpecSpeechSignature(spec), {
    version: 1,
    scenes: [
      {
        id: 'scene_01',
        order: 1,
        narration_text: '第一段旁白',
        captions: [{ start: 0, end: 1.2, text: '第一段字幕' }],
      },
      {
        id: 'scene_02',
        order: 2,
        narration_text: '第二段旁白',
        captions: [{ start: 0, end: 1.4, text: '第二段字幕' }],
      },
    ],
  });
}

{
  assert.deepEqual(getSceneSpecSpeechSignature({
    scenes: [
      { narrationText: 'camelCase 旁白' },
      { id: 'custom_scene', order: 'not-a-number', narration_text: null, captions: 'not-array' },
    ],
  }), {
    version: 1,
    scenes: [
      { id: 'scene_01', order: 1, narration_text: 'camelCase 旁白', captions: [] },
      { id: 'custom_scene', order: 2, narration_text: '', captions: [] },
    ],
  });
}

{
  const spec = sceneSpec();
  assert.equal(computeSceneSpecSpeechHash(spec), computeSceneSpecSpeechHash(sceneSpec()));
}

{
  const base = sceneSpec();
  const changed = sceneSpec({
    scenes: base.scenes.map(scene => (
      scene.id === 'scene_02'
        ? { ...scene, narration_text: '第二段旁白已修改' }
        : scene
    )),
  });
  assert.notEqual(computeSceneSpecSpeechHash(base), computeSceneSpecSpeechHash(changed));
}

{
  const base = sceneSpec();
  const changed = sceneSpec({
    scenes: base.scenes.map(scene => (
      scene.id === 'scene_01'
        ? { ...scene, captions: [{ start: 0, end: 1.2, text: '字幕已修改' }] }
        : scene
    )),
  });
  assert.notEqual(computeSceneSpecSpeechHash(base), computeSceneSpecSpeechHash(changed));
}

{
  const base = sceneSpec();
  const changed = sceneSpec({ scenes: [...base.scenes].reverse() });
  assert.notEqual(computeSceneSpecSpeechHash(base), computeSceneSpecSpeechHash(changed));
}

{
  const base = sceneSpec();
  const changed = sceneSpec({
    scenes: base.scenes.map(scene => ({
      ...scene,
      visual_text: { headline: `${scene.id} 新视觉标题`, cards: ['只改画面'] },
      visual_variant: 'another-visual-template',
      inputs: { accent: 'red' },
    })),
  });
  assert.equal(computeSceneSpecSpeechHash(base), computeSceneSpecSpeechHash(changed));
}

{
  const spec = sceneSpec();
  assert.equal(audioMatchesSceneSpec(matchingAudio(spec), spec), true);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), status: 'done' }, spec), true);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), status: 'rendered' }, spec), true);
  {
    const { status, ...audioWithoutStatus } = matchingAudio(spec);
    assert.equal(audioMatchesSceneSpec(audioWithoutStatus, spec), false);
  }
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), status: null }, spec), false);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), status: '' }, spec), false);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), status: 'pending' }, spec), false);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), source: 'brief_storyboard' }, spec), false);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), scene_spec_hash: 'old-hash' }, spec), false);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), scene_count: 1 }, spec), false);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), scene_ids: ['scene_02', 'scene_01'] }, spec), false);
  assert.equal(audioMatchesSceneSpec({ path: 'D:/tmp/legacy.wav', status: 'ready' }, spec), false);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), path: '   ' }, spec), false);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), path: null, narration_path: '', narrationPath: '', combined_path: '' }, spec), false);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), path: '   ', narration_path: 'tts/current.wav' }, spec), true);
}

{
  const emptySpec = sceneSpec({ scenes: [] });
  const audio = matchingAudio(emptySpec);
  assert.equal(audioMatchesSceneSpec({ ...audio, scene_count: null }, emptySpec), false);
  assert.equal(audioMatchesSceneSpec({ ...audio, scene_count: '' }, emptySpec), false);
  assert.equal(audioMatchesSceneSpec({ ...audio, scene_count: undefined }, emptySpec), false);
}
