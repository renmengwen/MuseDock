const assert = require('assert');

const agent = require('../server/services/creative-video/html-video/contentGraphAgent');

const sceneSpec = {
  title: '价格对比短片',
  aspect_ratio: '16:9',
  target_duration_sec: 8,
  scenes: [
    {
      id: 'scene_01',
      order: 1,
      kind: 'data',
      duration: 4,
      narration_text: '先看基础版价格。',
      visual_text: { headline: '基础版价格', cards: [{ label: 'A', value: 12 }] },
    },
    {
      id: 'scene_02',
      order: 2,
      kind: 'text',
      duration: 4,
      narration_text: '再看专业版。',
      visual_text: { headline: '专业版对比', keywords: ['增长'] },
    },
  ],
};

const creativeContext = {
  input: {
    title: '原始标题',
    raw_text: '原始正文里提到基础版 12 元，专业版 20 元。',
  },
  source_context: { summary: '来源摘要：用户关心价格差异。' },
  brief: { summary: '用两帧解释价格对比。' },
  comments_summary: '评论问有没有更便宜的版本。',
  secondary_comments_summary: '二级评论追问专业版权益。',
  audio: { narration_text: '旁白全文。' },
};

const prompt = agent.buildContentGraphPrompt({
  sceneSpec,
  creativeContext,
  target: { aspect_ratio: '16:9', duration_sec: 8, language: 'zh-CN' },
});

assert.match(prompt, /原始标题/);
assert.match(prompt, /原始正文里提到基础版 12 元/);
assert.match(prompt, /来源摘要：用户关心价格差异/);
assert.match(prompt, /用两帧解释价格对比/);
assert.match(prompt, /评论问有没有更便宜的版本/);
assert.match(prompt, /二级评论追问专业版权益/);
assert.match(prompt, /旁白全文/);
assert.match(prompt, /价格对比短片/);
assert.match(prompt, /scene_01/);
assert.match(prompt, /16:9/);
assert.match(prompt, /8/);
assert.match(prompt, /zh-CN/);
assert.match(prompt, /严格 JSON/);
assert.match(prompt, /id/);
assert.match(prompt, /kind/);
assert.match(prompt, /label/);
assert.match(prompt, /durationSec/);
assert.match(prompt, /text/);
assert.match(prompt, /data/);
assert.match(prompt, /可比较的同一单位/);
assert.match(prompt, /不要编造/);
assert.match(prompt, /\[object Object\]/);
assert.match(prompt, /每个 intended frame 对应一个 node/);

const fenced = agent.parseContentGraphResponse([
  '```json',
  JSON.stringify({
    synopsis: '测试图',
    nodes: [
      { id: 'a', kind: 'text', label: 'A', durationSec: 2, text: 'A 文案' },
    ],
    edges: [],
  }),
  '```',
].join('\n'));
assert.equal(fenced.success, true);
assert.equal(fenced.graph.nodes[0].id, 'a');

const contentGraphFence = agent.parseContentGraphResponse([
  '```json#content-graph',
  JSON.stringify({
    synopsis: '参考 fence',
    nodes: [
      { id: 'cg_01', kind: 'text', label: 'CG', durationSec: 2, text: 'CG 文案' },
    ],
    edges: [],
  }),
  '```',
].join('\n'));
assert.equal(contentGraphFence.success, true);
assert.equal(contentGraphFence.graph.nodes[0].id, 'cg_01');

const raw = agent.parseContentGraphResponse(JSON.stringify({
  synopsis: '裸 JSON',
  nodes: [
    { id: 'b', kind: 'data', label: 'B', durationSec: 3, data: { title: '价格', unit: '元', items: [{ label: '基础版', value: 12 }] } },
  ],
  edges: [],
}));
assert.equal(raw.success, true);
assert.equal(raw.graph.nodes[0].data.items[0].value, 12);

const invalid = agent.parseContentGraphResponse('{bad json');
assert.equal(invalid.success, false);

const missingNodes = agent.parseContentGraphResponse(JSON.stringify({ synopsis: '缺 nodes' }));
assert.equal(missingNodes.success, false);

const normalized = agent.normalizeContentGraph({
  synopsis: '对象转文本',
  nodes: [
    { id: 'node object', kind: 'text', label: { title: '对象标题' }, durationSec: '2.5', text: { headline: '对象正文' } },
    { id: 'data', kind: 'data', label: '数据', durationSec: 2, data: { title: { text: '价格' }, unit: '元', items: [{ label: { name: '基础版' }, value: '12' }] } },
  ],
  edges: [{ from: 'node object', to: 'data', kind: 'sequence' }],
}, sceneSpec);
assert.equal(normalized.success, true);
assert.equal(normalized.graph.nodes[0].id, 'node_object');
assert.equal(normalized.graph.nodes[0].label, '对象标题');
assert.equal(normalized.graph.nodes[0].text, '对象正文');
assert.equal(normalized.graph.nodes[1].data.title, '价格');
assert.equal(normalized.graph.nodes[1].data.items[0].label, '基础版');
assert.equal(normalized.graph.nodes[1].data.items[0].value, 12);
assert.equal(JSON.stringify(normalized.graph).includes('[object Object]'), false);

console.log('html-video content graph agent tests passed');
