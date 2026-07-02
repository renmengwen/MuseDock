const assert = require('assert');
const agent = require('../server/services/creative-video/creativeSpecAgent');

const scenePrompt = agent.buildSceneSpecPrompt({
  creativeContext: { input: { raw_text: '介绍 Superpowers Skill' } },
  target: { aspect_ratio: '16:9', duration: 60 },
});
assert.ok(scenePrompt.includes('只输出 JSON'));
assert.ok(scenePrompt.includes('不允许输出 frame_specs'));
assert.ok(scenePrompt.includes('不要输出 HTML'));
assert.ok(scenePrompt.includes('visual_text.cards'));
assert.ok(scenePrompt.includes('背景'));
assert.ok(scenePrompt.includes('scene_spec 是内容图'));
assert.ok(scenePrompt.includes('title_candidates'));
assert.ok(scenePrompt.includes('1 个主标题'));
assert.ok(scenePrompt.includes('不要因为主题本身提到 HTML、CSS、动画、转场或渲染就删除这些词'));
assert.ok(scenePrompt.includes('frame_specs 阶段'));

const sceneParsed = agent.parseSceneSpecResponse(JSON.stringify({
  scene_spec: {
    title: '测试',
    title_candidates: ['测试备选 1', '测试备选 2'],
    aspect_ratio: '16:9',
    scenes: [{
      id: 'scene_01',
      duration: 8,
      kind: 'text',
      narration_text: '旁白',
      captions: [],
      visual_text: { headline: '标题', keywords: [], cards: ['卡片文案'] },
    }],
  },
}));
assert.equal(sceneParsed.success, true);
assert.equal(sceneParsed.scene_spec.scenes[0].kind, 'text');
assert.deepEqual(sceneParsed.scene_spec.title_candidates, ['测试备选 1', '测试备选 2']);

const sceneParsedWithDurationAliases = agent.parseSceneSpecResponse(JSON.stringify({
  scene_spec: {
    title: '字段别名测试',
    aspect_ratio: '16:9',
    scenes: [{
      id: 'scene_08',
      target_duration_sec: 3,
      kind: 'text',
      narration_text: '第八段旁白',
      captions: [],
      visual_text: { headline: '第八幕', keywords: [], cards: ['结尾文案'] },
    }],
  },
}));
assert.equal(sceneParsedWithDurationAliases.success, true);
assert.equal(sceneParsedWithDurationAliases.scene_spec.scenes[0].duration, 3);

const sceneParsedWithDurationFallback = agent.parseSceneSpecResponse(JSON.stringify({
  scene_spec: {
    title: '测试',
    aspect_ratio: '16:9',
    scenes: [{
      id: 'scene_01',
      kind: 'text',
      narration_text: '旁白',
      captions: [],
      visual_text: { headline: '标题', keywords: [], cards: ['卡片文案'] },
    }],
  },
}), {
  sceneDurations: [{ id: 'scene_01', duration: 5.44 }],
});
assert.equal(sceneParsedWithDurationFallback.success, true);
assert.equal(sceneParsedWithDurationFallback.scene_spec.scenes[0].duration, 5.44);

const sceneParsedWithTrailingComma = agent.parseSceneSpecResponse('{"scene_spec":{"title":"测试","aspect_ratio":"16:9","scenes":[{"id":"scene_01","duration":5,"kind":"text","narration_text":"旁白","captions":[],"visual_text":{"headline":"标题","keywords":[],"cards":["卡片文案",],},}],},}');
assert.equal(sceneParsedWithTrailingComma.success, true);
assert.equal(sceneParsedWithTrailingComma.scene_spec.scenes[0].duration, 5);

const framePrompt = agent.buildFrameSpecsPrompt({
  sceneSpec: sceneParsed.scene_spec,
});
assert.ok(framePrompt.includes('只输出 JSON'));
assert.ok(framePrompt.includes('不允许改写 scene_spec 文案'));
assert.ok(framePrompt.includes('allowed_templates'));
assert.ok(framePrompt.includes('hero_title'));
assert.ok(framePrompt.includes('像 html-video 的模板 manifest'));
assert.ok(framePrompt.includes('用 template、layout、background、motion 和 visual_layers 表达视觉实现'));
assert.ok(framePrompt.includes('默认每个 scene 生成一个覆盖整段的 frame'));
assert.equal(framePrompt.includes('上一次输出包含以下问题'), false);

const frameParsed = agent.parseFrameSpecsResponse(JSON.stringify({
  frame_specs: [{
    id: 'frame_01_01',
    scene_id: 'scene_01',
    start: 0,
    duration: 8,
    kind: 'text',
    template: 'hero_title',
    layout: 'center_stack',
    background: 'dark_gradient',
    motion: 'fade_up',
    text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }],
    visual_layers: [{ id: 'accent', type: 'glow_panel', variant: 'cyan_pink' }],
  }],
}), sceneParsed.scene_spec);
assert.equal(frameParsed.success, true);
assert.equal(frameParsed.frame_specs.frames[0].template, 'hero_title');

const frameParsedWithMissingArrayComma = agent.parseFrameSpecsResponse('{"frame_specs":[{"id":"frame_01_01","scene_id":"scene_01","start":0,"duration":4,"kind":"text","template":"hero_title","layout":"center_stack","background":"dark_gradient","motion":"fade_up","text_layers":[{"id":"headline","role":"headline","text":"标题","emphasis":"primary"}],"visual_layers":[]}{"id":"frame_01_02","scene_id":"scene_01","start":4,"duration":4,"kind":"text","template":"keyword_burst","layout":"center_stack","background":"radial_spotlight","motion":"stagger_cards","text_layers":[{"id":"card","role":"body","text":"卡片文案","emphasis":"secondary"}],"visual_layers":[]}]}', sceneParsed.scene_spec);
assert.equal(frameParsedWithMissingArrayComma.success, true);
assert.equal(frameParsedWithMissingArrayComma.frame_specs.frames.length, 2);

const badScene = agent.parseSceneSpecResponse('```html\n<div>bad</div>\n```');
assert.equal(badScene.success, false);
assert.ok(badScene.message.includes('JSON'));

const sceneWithFrameSpecs = agent.parseSceneSpecResponse(JSON.stringify({
  scene_spec: sceneParsed.scene_spec,
  frame_specs: [],
}));
assert.equal(sceneWithFrameSpecs.success, false);

const sceneWithProjectFiles = agent.parseSceneSpecResponse(JSON.stringify({
  scene_spec: { ...sceneParsed.scene_spec, files: { 'index.html': '<div></div>' } },
}));
assert.equal(sceneWithProjectFiles.success, false);

const frameWithSceneSpec = agent.parseFrameSpecsResponse(JSON.stringify({
  frame_specs: frameParsed.frame_specs.frames,
  scene_spec: sceneParsed.scene_spec,
}), sceneParsed.scene_spec);
assert.equal(frameWithSceneSpec.success, false);

const frameWithProjectFile = agent.parseFrameSpecsResponse(JSON.stringify({
  frame_specs: frameParsed.frame_specs.frames,
  'hyperframes.json': {},
}), sceneParsed.scene_spec);
assert.equal(frameWithProjectFile.success, false);

const retryPrompt = agent.buildFrameSpecsPrompt({
  sceneSpec: sceneParsed.scene_spec,
  retryCount: 1,
  previousErrors: ['visual_text.cards 包含视觉描述'],
});
assert.ok(retryPrompt.includes('上一次输出包含以下问题'));
assert.ok(retryPrompt.includes('visual_text.cards 包含视觉描述'));

console.log('creative spec agent tests passed');
