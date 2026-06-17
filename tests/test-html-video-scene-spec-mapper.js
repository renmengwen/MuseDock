const assert = require('assert');

const mapper = require('../server/services/creative-video/html-video/sceneSpecMapper');

const sceneSpec = {
  title: '评论区正在改写品牌传播',
  aspect_ratio: '16:9',
  scenes: [
    {
      id: 'scene_02',
      order: 2,
      start: 4,
      duration: 5,
      kind: 'data',
      narration_text: '第二段旁白',
      captions: [{ id: 'cap_02_01', start: 0, end: 2, text: '第二句字幕' }],
      visual_text: {
        headline: '数据正在变化',
        keywords: ['互动', '转化'],
        cards: ['卡片二'],
      },
    },
    {
      id: 'scene_01',
      order: 1,
      start: 0,
      duration: 4,
      kind: 'text',
      narration_text: '第一段旁白',
      captions: [{ id: 'cap_01_01', start: 0, end: 1.5, text: '第一句字幕' }],
      visual_text: {
        headline: '信号失控',
        keywords: ['评论区'],
        cards: ['卡片一'],
      },
    },
  ],
};

const contentGraph = mapper.mapSceneSpecToContentGraph(sceneSpec);

assert.equal(contentGraph.schemaVersion, 1);
assert.equal(contentGraph.intent, 'promo');
assert.equal(contentGraph.synopsis, sceneSpec.title);
assert.deepEqual(contentGraph.nodes.map(node => node.id), ['scene_01', 'scene_02']);
assert.equal(contentGraph.nodes[0].kind, 'text');
assert.equal(contentGraph.nodes[0].label, '信号失控');
assert.equal(contentGraph.nodes[0].frameIntent, 'text');
assert.equal(contentGraph.nodes[0].durationSec, 4);
assert.equal(contentGraph.nodes[0].text, '信号失控');
assert.equal(contentGraph.nodes[0].metadata.narration_text, '第一段旁白');
assert.deepEqual(contentGraph.nodes[0].metadata.captions, sceneSpec.scenes[1].captions);
assert.deepEqual(contentGraph.nodes[0].metadata.visual_text.cards, ['卡片一']);
assert.deepEqual(contentGraph.edges, [{ from: 'scene_01', to: 'scene_02', kind: 'sequence' }]);

const frames = mapper.buildFramesFromGraph({
  sceneSpec,
  contentGraph,
  templateId: 'glitch_title',
  templateInputs: { title: '信号失控', subtitle: '评论区正在改写品牌传播' },
  templateSchema: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    section_no: { type: 'string' },
    bullets: { type: 'array' },
  },
});

assert.equal(frames.length, 2);
assert.equal(frames[0].id, 'scene_01');
assert.equal(frames[0].order, 1);
assert.equal(frames[0].scene_id, 'scene_01');
assert.equal(frames[0].template_id, 'glitch_title');
assert.equal(frames[0].engine, 'hyperframes-playwright');
assert.equal(frames[0].duration_sec, 4);
assert.equal(frames[0].inputs.title, '信号失控');
assert.equal(frames[0].inputs.subtitle, '评论区正在改写品牌传播');
assert.equal(frames[0].inputs.section_no, '01/02');
assert.deepEqual(frames[0].inputs.bullets, ['卡片一']);
assert.deepEqual(frames[0].captions, sceneSpec.scenes[1].captions);
assert.equal(frames[0].narration_text, '第一段旁白');
assert.deepEqual(frames[0].transition_in, { type: 'cut', duration_sec: 0, params: {} });
assert.deepEqual(frames[0].transition_out, { type: 'cut', duration_sec: 0, params: {} });
assert.deepEqual(frames[0].trim, { in_sec: 0, out_sec: null });
assert.equal(frames[0].speed, 1);
assert.equal(frames[0].loop, false);
assert.deepEqual(frames[0].enhancement, {
  enabled: false,
  engine: null,
  template_id: null,
  data: null,
  preview_mp4_path: null,
});

assert.equal(frames[1].id, 'scene_02');
assert.equal(frames[1].order, 2);
assert.equal(frames[1].duration_sec, 5);
assert.equal(frames[1].inputs.title, '数据正在变化');
assert.equal(frames[1].inputs.section_no, '02/02');
assert.deepEqual(frames[1].inputs.bullets, ['卡片二']);

const compactCardTitleInputs = mapper.buildFrameInputs({
  templateInputs: {},
  templateSchema: {
    card_title: { type: 'string', max_length: 8 },
  },
  scene: {
    id: 'scene_long',
    visual_text: {
      headline: '这是一个非常长的卡片标题应该被裁剪',
      keywords: [],
      cards: [],
    },
  },
  index: 0,
  total: 1,
});
assert.ok(compactCardTitleInputs.card_title.length <= 8);

console.log('html-video scene spec mapper tests passed');
