const assert = require('assert');
const sceneSpec = require('../server/services/creative-video/sceneSpecService');

const raw = {
  title: '测试视频',
  aspect_ratio: '16:9',
  target_duration_sec: 20,
  scenes: [
    {
      id: 'scene_01',
      duration: 8.345,
      kind: 'text',
      narration_text: '第一段旁白',
      captions: [{ id: 'cap_01_01', start: 0, end: 2.2, text: '第一句字幕' }],
      visual_text: {
        headline: '第一幕',
        keywords: ['重点'],
        cards: ['观众可见卡片'],
      },
    },
    {
      id: 'scene_02',
      duration: 6,
      kind: 'cta',
      narration_text: '第二段旁白',
      captions: [],
      visual_text: { headline: '行动号召', keywords: [], cards: [] },
    },
  ],
};

const normalized = sceneSpec.normalizeSceneSpec(raw);
assert.equal(normalized.version, 1);
assert.equal(normalized.scenes[0].start, 0);
assert.equal(normalized.scenes[0].duration, 8.35);
assert.equal(normalized.scenes[1].start, 8.35);
assert.equal(normalized.scenes[0].kind, 'text');
assert.equal(sceneSpec.validateSceneSpec(normalized).success, true);

const edited = sceneSpec.applySceneEdit(normalized, {
  type: 'duration',
  scene_id: 'scene_01',
  duration: 10,
});
assert.equal(edited.scene_spec.scenes[1].start, 10);
assert.equal(edited.requires_render, true);
assert.equal(edited.requires_tts, false);

const textEdit = sceneSpec.applySceneEdit(normalized, {
  type: 'narration_text',
  scene_id: 'scene_01',
  text: '新的旁白',
});
assert.equal(textEdit.requires_tts, true);
assert.equal(textEdit.scene_spec.scenes[0].narration_text, '新的旁白');

const invalidVisualText = sceneSpec.validateSceneSpec({
  scenes: [{
    id: 'scene_01',
    duration: 3,
    kind: 'text',
    narration_text: '旁白',
    captions: [],
    visual_text: { headline: '标题', keywords: [], cards: ['深色科技背景'] },
  }],
});
assert.equal(invalidVisualText.success, false);
assert.ok(invalidVisualText.errors.some(error => error.includes('视觉描述')));

const technicalTopicText = sceneSpec.validateSceneSpec({
  scenes: [{
    id: 'scene_01',
    duration: 3,
    kind: 'text',
    narration_text: '用 HTML 定义视频动画和渲染流程。',
    captions: [],
    visual_text: {
      headline: '代码化视频',
      keywords: ['HTML', 'GSAP'],
      cards: ['字幕同步和场景转场都能用结构化数据描述'],
    },
  }],
});
assert.equal(technicalTopicText.success, true);

const narrationAboutAnimationFeature = sceneSpec.validateSceneSpec({
  scenes: [{
    id: 'scene_02',
    duration: 10,
    kind: 'text',
    narration_text: '它支持动画、特效和场景过渡，让视频更生动。（语速加快）例如，轻松添加动态文字和音频同步。',
    captions: [{ id: 'cap_02_01', start: 0, end: 5, text: '它支持动画、特效和场景过渡，让视频更生动。' }],
    visual_text: {
      headline: '核心功能展示',
      keywords: ['动画', '音频同步'],
      cards: ['轻松添加动态文字'],
    },
  }],
});
assert.equal(narrationAboutAnimationFeature.success, true);

let invalidCaptionResult;
assert.doesNotThrow(() => {
  invalidCaptionResult = sceneSpec.validateSceneSpec({
    scenes: [{
      id: 'scene_01',
      duration: 3,
      kind: 'text',
      narration_text: '旁白',
      captions: [null],
      visual_text: { headline: '标题', keywords: [], cards: ['卡片'] },
    }],
  });
});
assert.equal(invalidCaptionResult.success, false);
assert.ok(invalidCaptionResult.errors.some(error => error.includes('字幕')));

const outOfRangeCaption = sceneSpec.validateSceneSpec({
  scenes: [{
    id: 'scene_01',
    duration: 3,
    kind: 'text',
    narration_text: '旁白',
    captions: [{ id: 'cap_01_01', start: -1, end: 4, text: '越界字幕' }],
    visual_text: { headline: '标题', keywords: [], cards: ['卡片'] },
  }],
});
assert.equal(outOfRangeCaption.success, false);
assert.ok(outOfRangeCaption.errors.some(error => error.includes('时间范围')));

console.log('creative video scene spec tests passed');
