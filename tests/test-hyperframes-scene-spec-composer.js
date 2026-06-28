const assert = require('assert');
const composer = require('../server/services/hyperframes/hyperframesSceneSpecComposer');

const result = composer.composeHyperframesProjectFiles({
  title: '可编辑视频',
  aspect_ratio: '9:16',
  scenes: [
    {
      id: 'intro',
      start: 0,
      duration: 5,
      narration_text: '开场旁白',
      captions: [{ id: 'cap1', start: 0, end: 2, text: '开场字幕' }],
      visual_text: { headline: '开场标题', keywords: ['稳定', '可编辑'], cards: ['第一张卡片'] },
    },
  ],
});

assert.equal(result.success, true);
assert.ok(result.files['index.html'].includes('data-composition-id="main"'));
assert.ok(result.files['index.html'].includes('data-width="1080"'));
assert.ok(result.files['index.html'].includes('data-height="1920"'));
assert.ok(result.files['index.html'].includes('window.__timelines["main"]'));
assert.ok(result.files['index.html'].includes('开场标题'));
assert.ok(result.files['index.html'].includes('开场字幕'));
assert.ok(result.files['scene_spec.json'].includes('"id": "intro"'));
assert.ok(result.files['meta.json'].includes('"scene_count": 1'));
assert.ok(result.files['hyperframes.json'].includes('"composition": "main"'));
assert.doesNotMatch(result.files['index.html'], /performance\.now|requestAnimationFrame|setInterval/);

console.log('hyperframes scene spec composer tests passed');
