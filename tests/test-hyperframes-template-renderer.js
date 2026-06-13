const assert = require('assert');
const renderer = require('../server/services/creative-video/hyperframesTemplateRenderer');

const sceneSpec = {
  title: '测试视频',
  aspect_ratio: '16:9',
  target_duration_sec: 12,
  scenes: [{
    id: 'scene_01',
    order: 1,
    start: 0,
    duration: 12,
    kind: 'text',
    narration_text: '旁白',
    captions: [{ id: 'cap_01_01', start: 0, end: 2, text: '字幕' }],
    visual_text: { headline: '标题', keywords: ['关键词'], cards: ['卡片'] },
  }],
};

const frameSpecs = {
  frames: [{
    id: 'frame_01_01',
    scene_id: 'scene_01',
    order: 1,
    start: 0,
    duration: 12,
    kind: 'text',
    template: 'hero_title',
    layout: 'center_stack',
    background: 'dark_gradient',
    motion: 'fade_up',
    text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }],
    visual_layers: [{ id: 'accent', type: 'glow_panel', variant: 'cyan_pink' }],
  }, {
    id: 'x");alert(1);//',
    scene_id: 'scene_01',
    order: 2,
    start: 6,
    duration: 6,
    kind: 'text',
    template: 'hero_title',
    layout: 'center_stack',
    background: 'dark_gradient',
    motion: 'fade_up',
    text_layers: [{ id: 'headline', role: 'headline', text: '第二帧', emphasis: 'primary' }],
    visual_layers: [],
  }],
};

const result = renderer.renderHyperframesProjectFiles({ sceneSpec, frameSpecs });
assert.equal(result.success, true);
const html = result.files['index.html'];
assert.ok(html.includes('data-composition-id="main"'));
assert.ok(html.includes('data-width="1920"'));
assert.ok(html.includes('data-height="1080"'));
assert.ok(html.includes('linear-gradient'));
assert.ok(html.includes('gsap.timeline'));
assert.ok(html.includes('window.__timelines["main"]'));
assert.ok(html.includes('class="creative-frame'));
assert.ok(html.includes('class="caption-line clip"'));
assert.ok(html.includes('data-duration="2"'));
assert.ok(html.includes('autoAlpha: 0'));
assert.ok(html.includes('autoAlpha: 1'));
assert.ok(html.includes('tl.set(caption, { autoAlpha: 1 }, start);'));
assert.equal(html.includes('#x");alert(1);//'), false);
assert.ok(result.files['scene_spec.json'].includes('"scene_01"'));
assert.ok(result.files['frame_specs.json'].includes('"frame_01_01"'));
assert.ok(result.files['frame_specs.json'].includes('alert(1)'));
assert.doesNotMatch(html, /<body>\s*<div class="composition"/);
assert.doesNotMatch(html, /performance\.now|requestAnimationFrame|setInterval|Date\.now/);

const incompatible = renderer.renderHyperframesProjectFiles({
  sceneSpec,
  frameSpecs: { frames: [{ ...frameSpecs.frames[0], template: 'process_steps' }] },
});
assert.equal(incompatible.success, false);
assert.ok(incompatible.message.includes('模板'));

console.log('hyperframes template renderer tests passed');
