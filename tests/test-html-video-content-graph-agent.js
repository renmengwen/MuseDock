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
assert.match(prompt, /nodes\.length 必须严格等于 scene_spec\.scenes\.length：2/);
assert.match(prompt, /scene_01 -> scene_02/);
assert.match(prompt, /禁止新增、删除、合并、拆分或重排序/);

const identityPrompt = agent.buildContentGraphPrompt({
  sceneSpec,
  creativeContext: {
    asset_context: {
      assets: [
        { id: 'formal_generated', origin: 'ai_generated', path: 'assets/formal.png', generation: { scene_id: 'scene_01' } },
        { id: 'legacy_generated', source: 'generated', path: 'assets/legacy.png', generation: { scene_id: 'scene_02' } },
        { id: 'formal_conflict', origin: 'source_extract', source: 'generated', path: 'assets/conflict.png', generation: { scene_id: 'scene_02' } },
      ],
    },
  },
});
const identityLines = Object.fromEntries(['formal_generated', 'legacy_generated', 'formal_conflict'].map(id => [
  id,
  identityPrompt.split('\n').find(line => line.includes(`asset_id=${id}`)) || '',
]));
assert.match(identityLines.formal_generated, /不是来源证据/);
assert.match(identityLines.legacy_generated, /不是来源证据/);
assert.doesNotMatch(identityLines.formal_conflict, /不是来源证据/);

const retryPromptAttempt1 = agent.buildRetryPrompt(sceneSpec, creativeContext, { duration_sec: 8 }, prompt, 1);
assert.match(retryPromptAttempt1, /scene_01/);
assert.match(retryPromptAttempt1, /基础版价格/);
assert.match(retryPromptAttempt1, /先看基础版价格/);
assert.ok(retryPromptAttempt1.length < prompt.length);

const retryPromptAttempt2 = agent.buildRetryPrompt(sceneSpec, creativeContext, { duration_sec: 8 }, prompt, 2);
assert.match(retryPromptAttempt2, /nodes/);
assert.match(retryPromptAttempt2, /durationSec/);
assert.match(retryPromptAttempt2, /scene ids: scene_01, scene_02/);
assert.match(retryPromptAttempt2, /nodes\.length must equal 2/);
assert.match(retryPromptAttempt2, /schema: \{"nodes":\[/);
assert.match(retryPromptAttempt2, /\{"id":"string","kind":"text","label":"string","durationSec":2,"text":"string"\}/);
assert.doesNotMatch(retryPromptAttempt2, /edges/);
assert.doesNotMatch(retryPromptAttempt2, /基础版价格/);
assert.doesNotMatch(retryPromptAttempt2, /先看基础版价格/);
assert.doesNotMatch(retryPromptAttempt2, /专业版对比/);
assert.doesNotMatch(retryPromptAttempt2, /再看专业版/);
assert.doesNotMatch(retryPromptAttempt2, /原始标题/);
assert.doesNotMatch(retryPromptAttempt2, /原始正文里提到基础版 12 元/);
assert.doesNotMatch(retryPromptAttempt2, /16:9/);
assert.doesNotMatch(retryPromptAttempt2, /duration=8/);
assert.ok(retryPromptAttempt2.length < retryPromptAttempt1.length);

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
assert.equal(invalid.diagnostics[0].code, 'content_graph_invalid');
assert.equal(invalid.diagnostics[0].sub_stage, 'content_graph');
assert.equal(invalid.diagnostics[0].retryable, true);
assert.equal(invalid.diagnostics[0].repair_action, 'retry_content_graph');

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

const assetFiltered = agent.normalizeContentGraph({
  synopsis: '素材过滤',
  nodes: [
    { id: 'scene_01', kind: 'text', label: '推荐好图', durationSec: 2, text: '使用好图', asset_refs: [{ asset_id: 'article_01' }] },
    { id: 'scene_02', kind: 'text', label: '过滤坏图', durationSec: 2, text: '不能用坏图', asset_refs: [{ asset_id: 'article_02' }] },
  ],
  edges: [],
}, sceneSpec, {
  asset_context: {
    assets: [
      { id: 'article_01', source: 'article', image_analysis: { should_use: true } },
      { id: 'article_02', source: 'article', image_analysis: { should_use: false } },
    ],
  },
});
assert.equal(assetFiltered.success, true);
assert.deepEqual(assetFiltered.graph.nodes[0].asset_refs, [{ asset_id: 'article_01', usage: '', reason: '' }]);
assert.equal(assetFiltered.graph.nodes[1].asset_refs, undefined);

const evidenceAssets = [
  { id: 'formal_direct', origin: 'source_extract', evidence_class: 'direct_source' },
  { id: 'formal_derived', origin: 'derived', evidence_class: 'derived_source' },
  { id: 'formal_synthetic', origin: 'source_extract', evidence_class: 'synthetic' },
  { id: 'formal_contextual', origin: 'page_capture', evidence_class: 'contextual' },
  { id: 'formal_user_supplied', origin: 'source_extract', evidence_class: 'user_supplied' },
  { id: 'formal_over_legacy', origin: 'source_extract', source: 'generated', evidence_class: 'direct_source' },
  { id: 'legacy_article', source: 'article' },
  { id: 'legacy_generated', source: 'generated' },
  { id: 'legacy_search', source: 'search' },
  { id: 'legacy_unknown' },
];
const evidenceScenes = evidenceAssets.map((asset, index) => ({ id: `evidence_scene_${index + 1}` }));
const evidenceResult = agent.normalizeContentGraph({
  synopsis: '证据类型单一真值',
  nodes: evidenceAssets.map((asset, index) => ({
    id: evidenceScenes[index].id,
    kind: 'text',
    label: asset.id,
    durationSec: 2,
    text: asset.id,
    asset_refs: [{ asset_id: asset.id, usage: 'evidence' }],
  })),
  edges: [],
}, { scenes: evidenceScenes }, { asset_context: { assets: evidenceAssets } });
const evidenceRefsByScene = Object.fromEntries(evidenceResult.graph.nodes.map(node => [
  node.id,
  node.asset_refs?.[0]?.asset_id || '',
]));
for (const index of [0, 1, 5, 6]) {
  assert.equal(evidenceRefsByScene[evidenceScenes[index].id], evidenceAssets[index].id);
}
for (const index of [2, 3, 4, 7, 8, 9]) {
  assert.equal(evidenceRefsByScene[evidenceScenes[index].id], '');
}

console.log('html-video content graph agent tests passed');
