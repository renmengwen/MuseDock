const assert = require('node:assert/strict');
const agentRouter = require('../server/services/creative/whiteboard/agentRouter');
const production = require('../server/services/creative/whiteboard/productionWorkflows');
const store = require('../server/services/creative/whiteboard/mediaStore');
const artifactStore = require('../server/services/creative/whiteboard/artifactStore');
const aiTextModel = require('../server/services/ai/aiTextModel');

const context = {
  phase: 'production', status: 'waiting_approval', stageLabel: '生成线稿', gateTitle: '请检查全部线稿',
  progressMessage: '线稿已生成，等待检查。', lastError: '',
  scenes: [
    { index: 1, id: 'scene_1', title: '热烈表达', hasLineart: true, hasAnnotation: false, hasVideo: false },
    { index: 2, id: 'scene_2', title: '藏在心底', hasLineart: true, hasAnnotation: false, hasVideo: false },
    { index: 6, id: 'scene_6', title: '码头送别', hasLineart: true, hasAnnotation: false, hasVideo: false },
  ],
  canReviseScenes: true, canRevisePlan: false,
};

async function testNormalizeIntent() {
  const intent = agentRouter.normalizeIntent(
    { action: 'revise_scenes', sceneIds: ['scene_1', 'scene_6', 'scene_6'], instruction: '去掉手机边框后重新生成' }, context);
  assert.deepEqual(intent, { action: 'revise_scenes', sceneIds: ['scene_1', 'scene_6'], instruction: '去掉手机边框后重新生成' });

  assert.throws(() => agentRouter.normalizeIntent({ action: 'revise_scenes', sceneIds: ['scene_9'], instruction: 'x' }, context),
    /未能从消息中识别出要修改的幕/);
  assert.throws(() => agentRouter.normalizeIntent({ action: 'revise_plan', instruction: 'x' }, context), /不允许修改整体方案/);
  assert.throws(() => agentRouter.normalizeIntent({ action: 'revise_scenes', sceneIds: ['scene_1'], instruction: 'x' },
    { ...context, canReviseScenes: false }), /不允许修改指定幕/);
  assert.throws(() => agentRouter.normalizeIntent({ action: 'approve_media' }, context), /未知意图/);
  assert.deepEqual(agentRouter.normalizeIntent({ action: 'answer' }, context), { action: 'answer', instruction: '' });
}

async function testClassifyIntent() {
  const textConfig = { enabled: true, apiKey: 'fixture-only', baseUrl: 'https://example.invalid', modelId: 'fixture-text' };
  let request;
  const intent = await agentRouter.classifyIntent({
    message: '1、2、6生成的图片为什么有手机边框？重新生成', context,
    services: { aiModelConfig: { getRuntimeConfig: async () => textConfig }, aiTextModel: { callTextModel: async options => {
      request = options;
      return { success: true, text: '```json\n{"action":"revise_scenes","sceneIds":["scene_1","scene_2","scene_6"],"instruction":"生成的图片有手机边框，重新生成"}\n```' };
    } } },
  });
  assert.equal(request.temperature, 0);
  assert.deepEqual(request.response_format, { type: 'json_object' });
  assert.ok(request.messages[1].content.includes('1、2、6生成的图片为什么有手机边框？重新生成'));
  assert.ok(request.messages[1].content.includes('scene_6'));
  assert.deepEqual(intent.sceneIds, ['scene_1', 'scene_2', 'scene_6']);

  await assert.rejects(agentRouter.classifyIntent({ message: 'x', context, services: {
    aiModelConfig: { getRuntimeConfig: async () => textConfig },
    aiTextModel: { callTextModel: async () => ({ success: false, message: '请求失败' }) },
  } }), error => error.code === 'INTENT_CLASSIFICATION_FAILED');

  await assert.rejects(agentRouter.classifyIntent({ message: 'x', context, services: {
    aiModelConfig: { getRuntimeConfig: async () => ({ enabled: false }) },
  } }), error => error.code === 'INTENT_MODEL_NOT_CONFIGURED');
}

async function testStreamAnswer() {
  const textConfig = { enabled: true, apiKey: 'fixture-only', baseUrl: 'https://example.invalid', modelId: 'fixture-text' };
  const deltas = [];
  const text = await agentRouter.streamAnswer({
    message: '为什么线稿有手机边框？', context,
    services: { aiModelConfig: { getRuntimeConfig: async () => textConfig }, aiTextModel: { callTextModel: async options => {
      assert.equal(options.stream, true);
      assert.equal(typeof options.onDelta, 'function');
      options.onDelta('因为图片模型画了');
      options.onDelta('手机外壳。');
      return { success: true, text: '因为图片模型画了手机外壳。' };
    } } },
    onDelta: delta => deltas.push(delta),
  });
  assert.equal(text, '因为图片模型画了手机外壳。');
  assert.deepEqual(deltas, ['因为图片模型画了', '手机外壳。']);
}

// 流式管道真实读取：SSE 分块到达时 onDelta 逐块触发，最终文本完整。
async function testAiTextModelStreamDeltas() {
  const textConfig = { enabled: true, apiKey: 'fixture-only', baseUrl: 'https://example.invalid', modelId: 'fixture-text' };
  const chunks = [
    'data: {"choices":[{"delta":{"content":"第一段。"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"第二段。"}}]}\n\n',
    'data: [DONE]\n\n',
  ];
  let remaining = chunks.map(chunk => new TextEncoder().encode(chunk));
  const deltas = [];
  const result = await aiTextModel.callTextModel({
    textConfig, messages: [{ role: 'user', content: 'fixture' }], stream: true, maxRetries: 0,
    onDelta: delta => deltas.push(delta),
    fetchImpl: async () => ({
      ok: true, status: 200,
      headers: { get: () => 'text/event-stream' },
      body: { getReader: () => ({ read: async () => (remaining.length ? { done: false, value: remaining.shift() } : { done: true }) }) },
    }),
  });
  assert.equal(result.success, true);
  assert.equal(result.text, '第一段。第二段。');
  assert.deepEqual(deltas, ['第一段。', '第二段。']);
}

// OpenAI Responses 协议的事件流：output_text.delta 增量 + completed 事件携带 usage。
async function testAiTextModelStreamResponsesEvents() {
  const textConfig = { enabled: true, apiKey: 'fixture-only', baseUrl: 'https://example.invalid', modelId: 'fixture-text' };
  const chunks = [
    'data: {"type":"response.output_text.delta","delta":"回答甲"}\n\n',
    'data: {"type":"response.output_text.delta","delta":"回答乙"}\n\n',
    'data: {"type":"response.completed","response":{"usage":{"output_tokens":7}}}\n\n',
  ];
  let remaining = chunks.map(chunk => new TextEncoder().encode(chunk));
  const deltas = [];
  let sawBody = false;
  const result = await aiTextModel.callTextModel({
    textConfig, messages: [{ role: 'user', content: 'fixture' }], stream: true, maxRetries: 0,
    onDelta: delta => deltas.push(delta),
    fetchImpl: async (url, init) => {
      sawBody = JSON.parse(init.body).stream === true;
      return {
        ok: true, status: 200,
        headers: { get: () => 'text/event-stream' },
        body: { getReader: () => ({ read: async () => (remaining.length ? { done: false, value: remaining.shift() } : { done: true }) }) },
      };
    },
  });
  assert.equal(sawBody, true, '流式请求必须在请求体中声明 stream: true');
  assert.equal(result.success, true);
  assert.equal(result.text, '回答甲回答乙');
  assert.equal(result.usage?.completion_tokens, 7);
  assert.deepEqual(deltas, ['回答甲', '回答乙']);
}

// 历史行为兼容：stream: true 但未提供 onDelta 时仍走非流式 JSON 路径。
async function testAiTextModelStreamIgnoredWithoutOnDelta() {
  const textConfig = { enabled: true, apiKey: 'fixture-only', baseUrl: 'https://example.invalid', modelId: 'fixture-text' };
  const result = await aiTextModel.callTextModel({
    textConfig, messages: [{ role: 'user', content: 'fixture' }], stream: true, maxRetries: 0,
    fetchImpl: async () => ({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content: '非流式结果' } }] }),
    }),
  });
  assert.equal(result.success, true);
  assert.equal(result.text, '非流式结果');
}

// 多幕修订：一次写入多个 override 并清理对应产物缓存。
async function testReviseMediaMultipleScenes() {
  const media = store.makeMedia('plan-identity', { fps: 60 });
  media.stage = 'lineart_generation';
  media.gate = 'lineart_approval';
  media.lineart = { scene_1: { kind: 'lineart' }, scene_2: { kind: 'lineart' }, scene_3: { kind: 'lineart' } };
  media.annotations = { scene_1: { kind: 'annotation' } };
  media.interactionId = 'interaction-1';
  const record = {
    workflow_id: '00000000000000001', status: 'waiting_approval', updated_at: 0, error: null, success: true,
    message: '请检查全部线稿', current_stage: 'lineart_generation', current_progress: 40, last_event_seq: 1, result: null,
    creationModeId: 'whiteboard-stream-v1',
    whiteboard: {
      messages: [],
      pendingInitialApproval: false,
      initialApproval: { stale: false, identity: 'plan-identity' },
      current: { stale: false, identity: 'plan-identity', attemptId: 'attempt-1' },
      interactions: [{ id: 'interaction-1', status: 'pending' }],
      media,
    },
  };
  const originalReadArtifact = artifactStore.readArtifact;
  artifactStore.readArtifact = async () => ({ scenes: [{ id: 'scene_1' }, { id: 'scene_2' }, { id: 'scene_3' }] });
  try {
    const payload = { action: 'revise_media', sceneIds: ['scene_1', 'scene_3', 'scene_3'], interactionId: 'interaction-1',
      message: '1、3生成的图片有手机边框，去掉边框重新生成', expectedMediaIdentity: store.mediaIdentity(media) };
    const restart = await production.act(record, payload, {}, 12345);
    assert.equal(restart, true);
    assert.equal(media.overrides['lineart_generation:scene_1'], '1、3生成的图片有手机边框，去掉边框重新生成');
    assert.equal(media.overrides['lineart_generation:scene_3'], media.overrides['lineart_generation:scene_1']);
    assert.ok(!media.lineart.scene_1 && !media.lineart.scene_3, '修订幕的线稿缓存应被删除');
    assert.ok(media.lineart.scene_2, '未修订幕的线稿缓存必须保留');
    assert.ok(!media.annotations.scene_1, '线稿阶段的修订连带删除标注缓存');
    assert.equal(media.revision, 2);
    assert.equal(media.gate, '');
    assert.equal(record.status, 'queued');
    assert.equal(record.whiteboard.interactions[0].status, 'superseded');

    // 还原到等待审批状态，验证非法幕列表被拒绝。
    record.status = 'waiting_approval';
    media.gate = 'lineart_approval';
    const invalid = { action: 'revise_media', sceneIds: ['scene_9'], interactionId: '', expectedMediaIdentity: store.mediaIdentity(media) };
    await assert.rejects(production.act(record, invalid, {}, 12346), error => error.code === 'INVALID_INPUT');
  } finally {
    artifactStore.readArtifact = originalReadArtifact;
  }
}

(async () => {
  await testNormalizeIntent();
  await testClassifyIntent();
  await testStreamAnswer();
  await testAiTextModelStreamDeltas();
  await testAiTextModelStreamResponsesEvents();
  await testAiTextModelStreamIgnoredWithoutOnDelta();
  await testReviseMediaMultipleScenes();
  console.log('白板对话意图理解与流式传输测试通过。');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
