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
assert.equal(html.includes('cdn.jsdelivr'), false);
assert.equal(html.includes('https://'), false);
assert.ok(html.includes('<script src="./gsap.min.js"></script>'));
assert.ok(result.files['gsap.min.js'].length > 1000);
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

const richTemplate = renderer.assembleProjectFiles({
  sceneSpec,
  frameSpecs: { frames: [] },
  templateId: 'glitch_title',
  aiGeneratedHtml: [
    '<!doctype html><html lang="zh-CN"><head>',
    '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Noto+Sans+SC:wght@900&display=swap" rel="stylesheet" />',
    '<style>body{font-family:\'Space Grotesk\',\'Noto Sans SC\',sans-serif}.mono{font-family:\'JetBrains Mono\',monospace}</style>',
    '</head><body data-duration="12">',
    '<main style="position:relative"><h1>测试</h1></main>',
    '<script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.to({}, { duration: 12 });window.__timelines["main"]=tl;</script>',
    '</body></html>',
  ].join(''),
});
assert.equal(richTemplate.success, true);
const richHtml = richTemplate.files['index.html'];
assert.doesNotMatch(richHtml, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
assert.doesNotMatch(richHtml, /font-family:[^;}]*Space Grotesk/i);
assert.doesNotMatch(richHtml, /font-family:[^;}]*Noto Sans SC/i);
assert.match(richHtml, /<body>\s*<div id="stage"[^>]*data-composition-id="main"/);
assert.match(richHtml, /<div id="stage"[^>]*data-duration="12"/);
assert.match(richHtml, /<div id="stage"[^>]*data-width="1920"/);
assert.match(richHtml, /<div id="stage"[^>]*data-height="1080"/);

const richTemplateWithSvgLead = renderer.assembleProjectFiles({
  sceneSpec,
  frameSpecs: { frames: [] },
  templateId: 'svg_lead',
  aiGeneratedHtml: [
    '<!doctype html><html><head><style>body{font-family:\'Noto Sans SC\',sans-serif}</style></head>',
    '<body data-duration="12">',
    '<svg width="0" height="0"></svg><div class="title">测试</div>',
    '<script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.to({}, { duration: 12 });window.__timelines["main"]=tl;</script>',
    '</body></html>',
  ].join(''),
});
assert.equal(richTemplateWithSvgLead.success, true);
const svgLeadHtml = richTemplateWithSvgLead.files['index.html'];
assert.match(svgLeadHtml, /<body>\s*<div id="stage"[^>]*data-composition-id="main"/);
assert.match(svgLeadHtml, /<div id="stage"[^>]*data-width="1920"/);
assert.match(svgLeadHtml, /<div id="stage"[^>]*data-height="1080"/);
assert.match(svgLeadHtml, /<div id="stage"[^>]*>\s*<svg width="0" height="0"><\/svg><div class="title">测试<\/div>\s*<\/div>\s*<script>/);

const richTemplateWithBodyVisuals = renderer.assembleProjectFiles({
  sceneSpec,
  frameSpecs: { frames: [] },
  templateId: 'body_visuals',
  aiGeneratedHtml: [
    '<!doctype html><html><head>',
    '<style>',
    'html,body{margin:0;width:100%;height:100%;overflow:hidden}',
    'body{background:#0d0e10;color:#f5f5f7;display:flex;align-items:center;justify-content:center}',
    'body::before{content:"";position:absolute;inset:0;background:linear-gradient(#000,#123);opacity:.5}',
    '</style>',
    '</head><body data-duration="12">',
    '<main><h1>测试</h1></main>',
    '<script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.to({}, { duration: 12 });window.__timelines["main"]=tl;</script>',
    '</body></html>',
  ].join(''),
});
assert.equal(richTemplateWithBodyVisuals.success, true);
const bodyVisualHtml = richTemplateWithBodyVisuals.files['index.html'];
assert.match(bodyVisualHtml, /#stage\{[^}]*background:#0d0e10[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center/i);
assert.match(bodyVisualHtml, /#stage::before\{[^}]*linear-gradient\(#000,#123\)/i);

const multiSceneSpec = {
  ...sceneSpec,
  aspect_ratio: '9:16',
  target_duration_sec: 16,
  scenes: [
    { ...sceneSpec.scenes[0], id: 'scene_01', order: 1, start: 0, duration: 8, visual_text: { headline: '第一屏', keywords: ['A'], cards: [] } },
    { ...sceneSpec.scenes[0], id: 'scene_02', order: 2, start: 8, duration: 8, visual_text: { headline: '第二屏', keywords: ['B'], cards: [] } },
  ],
};
const richTemplateWithStaticTimeline = renderer.assembleProjectFiles({
  sceneSpec: multiSceneSpec,
  frameSpecs: { frames: [] },
  templateId: 'static_timeline',
  aiGeneratedHtml: [
    '<!doctype html><html><head><style>body{background:#f7f5ee;color:#111}.article{width:80%}</style></head>',
    '<body data-duration="6">',
    '<article class="article"><h1>第一屏</h1><svg><polyline class="line-anim" points="0,0 10,10" /></svg></article>',
    '<script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.to({}, { duration: 6 });window.__timelines["main"]=tl;</script>',
    '</body></html>',
  ].join(''),
});
assert.equal(richTemplateWithStaticTimeline.success, true);
const staticTimelineHtml = richTemplateWithStaticTimeline.files['index.html'];
assert.match(staticTimelineHtml, /data-hf-scene-overlay/);
assert.match(staticTimelineHtml, /第二屏/);
assert.match(staticTimelineHtml, /hfSceneOverlay/);
assert.match(staticTimelineHtml, /tl\.to\(\{\}, \{ duration: 16 \}/);
assert.match(staticTimelineHtml, /body\{display:block!important;padding:0!important;width:1080px!important;height:1920px!important/);
assert.doesNotMatch(staticTimelineHtml, /-apple-system|BlinkMacSystemFont/i);
assert.doesNotMatch(staticTimelineHtml, /\by:\s*[-\d]/);

console.log('hyperframes template renderer tests passed');
