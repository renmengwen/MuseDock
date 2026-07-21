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
assert.match(prompt, /每帧最多 4 张/);
assert.match(prompt, /普通场景默认建议不超过 3 张/);
assert.match(prompt, /montage/);
assert.match(prompt, /asset_id 必须唯一/);
assert.match(prompt, /reason 需要区分/);
assert.match(prompt, /subject\|showcase\|evidence\|background/);
assert.doesNotMatch(prompt, /不同的 usage/);

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

const requiredAssets = Array.from({ length: 10 }, (_, index) => ({
  id: `upload_required_${index + 1}`,
  file_name: `必用素材-${index + 1}.png`,
  alt: `不应优先显示的 alt ${index + 1}`,
  path: `assets/required-${index + 1}.png`,
  requirement: 'required',
  ...(index === 9 ? { image_analysis: { should_use: false, avoid_reason: '模型不建议' } } : {}),
}));
const optionalAssets = Array.from({ length: 10 }, (_, index) => ({
  id: `optional_${index + 1}`,
  file_name: `可选素材-${index + 1}.png`,
  path: `assets/optional-${index + 1}.png`,
  source: 'article',
}));
const requiredPromptContext = { asset_context: { assets: [...requiredAssets, ...optionalAssets] } };
const requiredPrompt = agent.buildContentGraphPrompt({ sceneSpec, creativeContext: requiredPromptContext });
for (const asset of requiredAssets) {
  assert.match(requiredPrompt, new RegExp(`asset_id=${asset.id}`), '超过 8 张的 required 素材也必须全部进入 Prompt');
  assert.match(requiredPrompt, new RegExp(asset.file_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '素材 label 必须优先 file_name');
}
assert.equal(optionalAssets.filter(asset => requiredPrompt.includes(`asset_id=${asset.id}`)).length, 8, '非 required 素材继续限制为 8 张');
assert.match(requiredPrompt, /requirement=required 的素材必须绑定并实际进入画面，不得因图片分析或叙事偏好省略/);
const requiredRetryPrompt = agent.buildRetryPrompt(sceneSpec, requiredPromptContext, {}, requiredPrompt, 2);
for (const asset of requiredAssets) assert.match(requiredRetryPrompt, new RegExp(`asset_id=${asset.id}`));

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
assert.match(retryPromptAttempt1, /max 4 items/);
assert.match(retryPromptAttempt1, /unique asset_id/);
assert.match(retryPromptAttempt1, /semantically distinct reason/);
assert.doesNotMatch(retryPromptAttempt1, /different usage/);
assert.match(retryPromptAttempt2, /max 4 items/);

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
    { id: 'scene_01', kind: 'text', label: '推荐好图', durationSec: 2, text: '使用好图', asset_refs: [{ asset_id: 'article_01', usage: 'subject' }] },
    { id: 'scene_02', kind: 'text', label: '过滤坏图', durationSec: 2, text: '不能用坏图', asset_refs: [{ asset_id: 'article_02', usage: 'subject' }] },
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
assert.deepEqual(assetFiltered.graph.nodes[0].asset_refs, [{ asset_id: 'article_01', usage: 'subject', reason: '' }]);
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

const multiAssetContext = {
  asset_context: {
    assets: [
      { id: 'asset_1', evidence_class: 'direct_source' },
      { id: 'asset_2', evidence_class: 'derived_source' },
      { id: 'asset_3', evidence_class: 'synthetic' },
      { id: 'asset_4', evidence_class: 'contextual' },
      { id: 'asset_5', evidence_class: 'user_supplied' },
      { id: 'asset_6', source: 'stock' },
      { id: 'asset_disabled', evidence_class: 'direct_source', image_analysis: { should_use: false } },
    ],
  },
};
const multiAssetResult = agent.normalizeContentGraph({
  synopsis: '多素材候选',
  nodes: [
    {
      id: 'scene_many',
      kind: 'text',
      label: '五张截断且去重',
      durationSec: 2,
      text: '五张截断且去重',
      asset_refs: [
        { asset_id: 'asset_1', usage: 'subject', reason: '首图' },
        { asset_id: 'asset_2', usage: 'showcase', reason: '第二图' },
        { asset_id: 'asset_1', usage: 'background', reason: '重复项不得覆盖首项' },
        { asset_id: 'asset_3', usage: 'background', reason: '第三图' },
        { asset_id: 'asset_4', usage: 'background', reason: '第四图' },
        { asset_id: 'asset_5', usage: 'background', reason: '第五图应截断' },
      ],
    },
    {
      id: 'scene_one',
      kind: 'text',
      label: '一张保持',
      durationSec: 2,
      text: '一张保持',
      asset_refs: [{ asset_id: 'asset_2', usage: 'subject', reason: '唯一候选' }],
    },
    {
      id: 'scene_filtered',
      kind: 'text',
      label: '过滤非法候选',
      durationSec: 2,
      text: '过滤非法候选',
      asset_refs: [
        { asset_id: 'missing', usage: 'subject', reason: '未登记' },
        { asset_id: 'asset_disabled', usage: 'subject', reason: '禁用' },
        { asset_id: 'asset_3', usage: 'evidence', reason: 'synthetic 不能作证据' },
        { asset_id: 'asset_4', usage: 'source', reason: 'contextual 不能作证据' },
        { asset_id: 'asset_5', usage: 'citation', reason: 'user supplied 不能作证据' },
        { asset_id: 'asset_6', usage: 'proof', reason: 'stock 不能作证据' },
        { asset_id: 'asset_2', usage: 'evidence', reason: 'derived 可作证据' },
        { asset_id: 'asset_1', usage: 'evidence', reason: 'direct 可作证据' },
      ],
    },
  ],
  edges: [],
}, {
  scenes: [{ id: 'scene_many' }, { id: 'scene_one' }, { id: 'scene_filtered' }],
}, multiAssetContext);
assert.equal(multiAssetResult.success, true);
assert.deepEqual(multiAssetResult.graph.nodes[0].asset_refs, [
  { asset_id: 'asset_1', usage: 'subject', reason: '首图' },
  { asset_id: 'asset_2', usage: 'showcase', reason: '第二图' },
  { asset_id: 'asset_3', usage: 'background', reason: '第三图' },
  { asset_id: 'asset_4', usage: 'background', reason: '第四图' },
]);
assert.deepEqual(multiAssetResult.graph.nodes[1].asset_refs, [
  { asset_id: 'asset_2', usage: 'subject', reason: '唯一候选' },
]);
assert.deepEqual(multiAssetResult.graph.nodes[2].asset_refs, [
  { asset_id: 'asset_2', usage: 'evidence', reason: 'derived 可作证据' },
  { asset_id: 'asset_1', usage: 'evidence', reason: 'direct 可作证据' },
]);

for (const creativeContextWithoutRegistry of [{}, { asset_context: {} }, { asset_context: { assets: [] } }]) {
  const failClosed = agent.normalizeContentGraph({
    synopsis: '空注册表拒绝引用',
    nodes: [{
      id: 'scene_01',
      kind: 'text',
      label: '空注册表',
      durationSec: 2,
      text: '空注册表',
      asset_refs: [{ asset_id: 'unregistered', usage: 'subject', reason: '不得通过' }],
    }],
    edges: [],
  }, { scenes: [{ id: 'scene_01' }] }, creativeContextWithoutRegistry);
  assert.equal(failClosed.success, true);
  assert.equal(failClosed.graph.nodes[0].asset_refs, undefined);
}

const graphWithoutAssetRefs = agent.normalizeContentGraph({
  synopsis: '无引用仍合法',
  nodes: [{ id: 'scene_01', kind: 'text', label: '普通场景', durationSec: 2, text: '普通场景' }],
  edges: [],
}, { scenes: [{ id: 'scene_01' }] }, {});
assert.equal(graphWithoutAssetRefs.success, true);

const generatedBinding = agent.normalizeContentGraph({
  synopsis: '生成图场景绑定',
  nodes: [
    {
      id: 'scene_01',
      kind: 'text',
      label: '场景一',
      durationSec: 2,
      text: '场景一',
      asset_refs: [
        { asset_id: 'formal_same', usage: 'subject', reason: 'formal 同场景' },
        { asset_id: 'formal_cross', usage: 'subject', reason: 'formal 跨场景' },
        { asset_id: 'legacy_same', usage: 'subject', reason: 'legacy 同场景' },
        { asset_id: 'legacy_cross', usage: 'subject', reason: 'legacy 跨场景' },
      ],
    },
  ],
  edges: [],
}, { scenes: [{ id: 'scene_01' }] }, {
  asset_context: {
    assets: [
      { id: 'formal_same', origin: 'ai_generated', generation: { scene_id: 'scene_01' } },
      { id: 'formal_cross', origin: 'ai_generated', generation: { scene_id: 'scene_02' } },
      { id: 'legacy_same', source: 'generated', generation: { scene_id: 'scene_01' } },
      { id: 'legacy_cross', source: 'generated', generation: { scene_id: 'scene_02' } },
    ],
  },
});
assert.deepEqual(generatedBinding.graph.nodes[0].asset_refs.map(ref => ref.asset_id), [
  'formal_same',
  'legacy_same',
]);

const usageAndBackfill = agent.normalizeContentGraph({
  synopsis: 'usage 校验与补位',
  nodes: [{
    id: 'scene_01',
    kind: 'text',
    label: '合法重复 usage',
    durationSec: 2,
    text: '合法重复 usage',
    asset_refs: [
      { asset_id: 'asset_1', usage: 'hero', reason: '非法 usage' },
      { asset_id: 'asset_1', usage: 'evidence', reason: '非法项后同 ID 合法项应补位' },
      { asset_id: 'asset_2', usage: 'evidence', reason: '第二张 evidence' },
      { asset_id: 'asset_3', usage: 'background', reason: '第一张 background' },
      { asset_id: 'asset_4', usage: 'background', reason: '第二张 background' },
      { asset_id: 'asset_5', usage: 'subject', reason: '第五张合法项应截断' },
    ],
  }],
  edges: [],
}, { scenes: [{ id: 'scene_01' }] }, multiAssetContext);
assert.deepEqual(usageAndBackfill.graph.nodes[0].asset_refs, [
  { asset_id: 'asset_1', usage: 'evidence', reason: '非法项后同 ID 合法项应补位' },
  { asset_id: 'asset_2', usage: 'evidence', reason: '第二张 evidence' },
  { asset_id: 'asset_3', usage: 'background', reason: '第一张 background' },
  { asset_id: 'asset_4', usage: 'background', reason: '第二张 background' },
]);

console.log('html-video content graph agent tests passed');
