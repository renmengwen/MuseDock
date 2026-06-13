const assert = require('assert');
const editor = require('../server/services/creativeVideoEditor');

const spec = {
  title: '测试',
  scenes: [
    {
      id: 'scene_01',
      duration: 5,
      narration_text: '旧旁白',
      captions: [{ id: 'cap_01_01', start: 0, end: 2, text: '旧字幕' }],
      visual_text: { headline: '旧标题', keywords: ['旧'], cards: [] },
    },
  ],
};

const caption = editor.applyEditCommand(spec, {
  type: 'caption_text',
  scene_id: 'scene_01',
  caption_id: 'cap_01_01',
  text: '新字幕',
});
assert.equal(caption.scene_spec.scenes[0].captions[0].text, '新字幕');
assert.equal(caption.requires_tts, false);
assert.equal(caption.requires_render, true);
assert.equal(caption.edit_type, 'caption_text');

const rewrite = editor.applyRewriteResult(spec, 'scene_01', {
  narration_text: '重写旁白',
  captions: [{ id: 'cap_new', start: 0, end: 3, text: '重写字幕' }],
  visual_text: { headline: '重写标题', keywords: ['新'], cards: ['新卡片'] },
  layout: 'headline_keywords',
  motion: 'staggered_reveal',
});
assert.equal(rewrite.scene_spec.scenes[0].narration_text, '重写旁白');
assert.equal(rewrite.requires_tts, true);
assert.equal(rewrite.requires_render, true);

console.log('creative video editor tests passed');
