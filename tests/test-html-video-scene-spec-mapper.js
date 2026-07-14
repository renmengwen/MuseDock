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

assert.equal(contentGraph.nodes[1].kind, 'data');
assert.equal(contentGraph.nodes[1].durationSec, 5);
assert.deepEqual(contentGraph.nodes[1].data.keywords, ['互动', '转化']);

// 模板帧编排已删除：mapper 只保留 scene_spec -> content graph 映射
assert.strictEqual('buildFramesFromGraph' in mapper, false, '模板帧编排 buildFramesFromGraph 应已删除');
assert.strictEqual('buildFrameInputs' in mapper, false, '模板字段填充 buildFrameInputs 应已删除');

{
  const pollutedDurationSceneSpec = {
    title: 'TTS 清理时长优先',
    aspect_ratio: '9:16',
    scenes: [
      {
        id: 'scene_04',
        order: 1,
        duration: 9,
        speech_duration_sec: 13.996,
        actual_duration_sec: 13.996,
        raw_duration_sec: 231.04,
        narration_text: '他用 Claude Code 搭建了一套 Python 工具。',
        captions: [{ start: 0, end: 13.996, text: '他用 Claude Code 搭建了一套 Python 工具。' }],
        visual_text: { headline: 'Python 工具' },
      },
    ],
  };
  const pollutedDurationGraph = mapper.mapSceneSpecToContentGraph(pollutedDurationSceneSpec);
  assert.equal(pollutedDurationGraph.nodes[0].durationSec, 13.996);
}

console.log('html-video scene spec mapper tests passed');
