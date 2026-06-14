const assert = require('assert');
const registry = require('../server/services/creative-video/templateRegistry');
const enums = require('../server/services/creative-video/specEnums');

const templates = registry.listTemplates();
assert.ok(templates.length >= 6);
assert.ok(templates.some(template => template.id === 'hero_title'));
assert.ok(templates.some(template => template.id === 'data_cards'));
assert.deepEqual(templates.map(template => template.id).sort(), enums.TEMPLATES.slice().sort());
assert.equal(typeof registry.getLayoutClass, 'function');

const hero = registry.getTemplate('hero_title');
assert.equal(hero.id, 'hero_title');
assert.ok(hero.supportedKinds.includes('text'));
assert.equal(typeof hero.renderFrame, 'function');
const rendered = hero.renderFrame({
  id: 'frame_01_01',
  scene_id: 'scene_01',
  template: 'hero_title',
  layout: 'center_stack',
  background: 'dark_gradient',
  motion: 'fade_up',
  text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }],
  visual_layers: [],
}, { id: 'scene_01', visual_text: { headline: '标题' } });
assert.ok(rendered.html.includes('creative-frame'));
assert.equal(rendered.html.includes('<html'), false);
assert.equal(rendered.html.includes('<head'), false);
assert.equal(rendered.html.includes('<body'), false);
assert.ok(rendered.css.includes('dark_gradient'));
assert.ok(rendered.timeline.includes('gsap'));
assert.ok(registry.getBackgroundCss('dark_gradient').includes('linear-gradient'));
assert.ok(registry.getMotionSnippet('fade_up', '.target', 0).includes('fromTo'));
assert.ok(registry.getVisualLayerRenderer('glow_panel'));

const escaped = hero.renderFrame({
  id: 'frame_escape',
  scene_id: 'scene_01',
  template: 'hero_title',
  layout: 'center_stack',
  background: 'dark_gradient',
  motion: 'fade_up',
  text_layers: [{ id: 'headline', role: 'headline', text: '<script>alert("x")</script>', emphasis: 'primary' }],
  visual_layers: [],
}, { id: 'scene_01', visual_text: { headline: '标题' } });
assert.equal(escaped.html.includes('<script>'), false);
assert.ok(escaped.html.includes('&lt;script&gt;'));

const fallbackText = hero.renderFrame({
  id: 'frame_empty_text',
  scene_id: 'scene_01',
  template: 'hero_title',
  layout: 'center_stack',
  background: 'dark_gradient',
  motion: 'fade_up',
  text_layers: [
    { id: 'empty_headline', role: 'headline', text: '', emphasis: 'primary' },
    { id: 'empty_body', role: 'body', text: '   ', emphasis: 'secondary' },
  ],
  visual_layers: [],
}, {
  id: 'scene_01',
  visual_text: { headline: '场景标题', keywords: ['关键词'], cards: ['卡片一', '卡片二'] },
});
assert.ok(fallbackText.html.includes('场景标题'));
assert.ok(fallbackText.html.includes('卡片一'));
assert.doesNotMatch(fallbackText.html, /class="creative-text-layer"[^>]*>\s*<\/div>/);

enums.BACKGROUNDS.forEach(background => assert.ok(registry.getBackgroundCss(background)));
enums.LAYOUTS.forEach(layout => assert.ok(registry.getLayoutClass(layout)));
enums.MOTIONS.forEach(motion => assert.ok(registry.getMotionSnippet(motion, '.target', 0).includes('gsap')));
enums.VISUAL_LAYER_TYPES.forEach(type => assert.equal(typeof registry.getVisualLayerRenderer(type), 'function'));

assert.throws(() => registry.getTemplate('missing_template'), /未知模板/);
assert.throws(() => registry.getBackgroundCss('freeform_background'), /未知背景/);
assert.throws(() => registry.getLayoutClass('freeform_layout'), /未知布局/);
assert.throws(() => registry.getMotionSnippet('freeform_motion', '.target', 0), /未知动效/);
assert.throws(() => registry.getVisualLayerRenderer('freeform_visual'), /未知视觉层/);

console.log('creative template registry tests passed');
