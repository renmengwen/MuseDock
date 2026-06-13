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

const sceneParsed = agent.parseSceneSpecResponse(JSON.stringify({
  scene_spec: {
    title: '测试',
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

const framePrompt = agent.buildFrameSpecsPrompt({
  sceneSpec: sceneParsed.scene_spec,
});
assert.ok(framePrompt.includes('只输出 JSON'));
assert.ok(framePrompt.includes('不允许改写 scene_spec 文案'));
assert.ok(framePrompt.includes('allowed_templates'));
assert.ok(framePrompt.includes('hero_title'));
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
