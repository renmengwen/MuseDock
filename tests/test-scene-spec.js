const assert = require('assert');
const sceneSpec = require('../server/services/sceneSpec');

const base = {
  title: '测试视频',
  aspect_ratio: '9:16',
  target_duration_sec: 60,
  scenes: [
    {
      id: 'intro',
      duration: 4.234,
      narration_text: '第一段旁白',
      captions: [{ id: 'c1', start: 0.1, end: 1.8, text: '第一句字幕' }],
      visual_text: { headline: '开场', keywords: ['稳定'], cards: ['卡片'] },
    },
    {
      id: 'body',
      duration: 6,
      narration_text: '第二段旁白',
      captions: [{ id: 'c2', start: 4.3, end: 7, text: '第二句字幕' }],
      visual_text: { headline: '主体', keywords: [], cards: [] },
    },
  ],
};

const normalized = sceneSpec.normalizeSceneSpec(base);
assert.equal(normalized.version, 1);
assert.equal(normalized.scenes[0].order, 1);
assert.equal(normalized.scenes[0].start, 0);
assert.equal(normalized.scenes[0].duration, 4.23);
assert.equal(normalized.scenes[1].order, 2);
assert.equal(normalized.scenes[1].start, 4.23);
assert.equal(normalized.scenes[0].editable.local_tts, true);
assert.equal(sceneSpec.validateSceneSpec(normalized).success, true);

const captionEdit = sceneSpec.applySceneSpecEdit(normalized, {
  type: 'caption_text',
  scene_id: 'intro',
  caption_id: 'c1',
  text: '新字幕',
});
assert.equal(captionEdit.scene_spec.scenes[0].captions[0].text, '新字幕');
assert.equal(captionEdit.requires_tts, false);
assert.equal(captionEdit.requires_render, true);

const narrationEdit = sceneSpec.applySceneSpecEdit(normalized, {
  type: 'narration_text',
  scene_id: 'intro',
  text: '新旁白',
});
assert.equal(narrationEdit.requires_tts, true);

const reordered = sceneSpec.applySceneSpecEdit(normalized, {
  type: 'reorder_scenes',
  scene_ids: ['body', 'intro'],
});
assert.equal(reordered.scene_spec.scenes[0].id, 'body');
assert.equal(reordered.scene_spec.scenes[0].start, 0);
assert.equal(reordered.scene_spec.scenes[1].start, 6);

const invalid = sceneSpec.validateSceneSpec({ scenes: [{ id: '', duration: -1 }] });
assert.equal(invalid.success, false);
assert.ok(invalid.errors.some(error => /场景 1/.test(error)));

console.log('scene spec tests passed');
