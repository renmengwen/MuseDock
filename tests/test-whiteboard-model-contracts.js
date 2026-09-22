const assert = require('node:assert/strict');
const { callTextModel } = require('../server/services/ai/aiTextModel');
const { generateLineart, lineartPrompt } = require('../server/services/creative/whiteboard/mediaModels');
const { generateDraft } = require('../server/services/creative/whiteboard/structuredDraft');
const { normalizeInput, normalizeProductionPlan, candidateContractFor, validateCandidate } = require('../server/services/creative/whiteboard/contracts');

async function verifyDraftRequest(protocol) {
  const input = normalizeInput({ inputMode: 'text', rewritePolicy: 'preserve', content: '从一个具体的小动作开始。',
    visualStylePreset: 'whiteboard-handwritten-explainer-v1' });
  const contract = candidateContractFor(input);
  const task = { input, role: 'contentDrafting', productionPlan: normalizeProductionPlan(),
    candidateSkeleton: contract.skeleton, candidateSchema: contract.schema };
  const invalid = { schemaVersion: 1, summary: '测试方案', cues: [{ id: 'cue_1', text: input.content }],
    scenes: [{ id: 'scene_1', title: '开始', cueIds: ['cue_1'], visualDescription: '一个人把大纸张拆成小纸条。' }] };
  let requests = 0;
  const result = await generateDraft(task, {
    apiContext: { store: { start: () => null } },
    services: {
      aiModelConfig: { getRuntimeConfig: async () => ({ enabled: true, apiKey: 'fixture-key',
        baseUrl: 'https://example.invalid/v1', modelId: 'gpt-5.6-sol', protocol, stream: false }) },
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        const messages = protocol === 'anthropic-messages' ? body.messages : body.input;
        const payload = JSON.parse(messages[0].content[0].text);
        // 仅消费用户消息，模拟兼容网关忽略或覆盖 system/instructions。
        assert.deepEqual(payload.candidateSchema, contract.schema);
        assert.deepEqual(payload.candidateSkeleton, contract.skeleton);
        assert.match(payload.instructions, /text\/preserve/);
        assert.match(payload.instructions, /只返回一个 JSON 对象/);
        assert.match(payload.instructions, /imageTexts/);
        assert.equal(payload.input.content, input.content);
        let candidate = invalid;
        if (requests++) {
          const repair = JSON.parse(messages.at(-1).content[0].text);
          assert.deepEqual(repair.candidateSchema, contract.schema);
          assert.deepEqual(repair.candidateSkeleton, contract.skeleton);
          assert.deepEqual(repair.validationErrors, validateCandidate(invalid, input));
          assert.match(repair.instructions, /保留已经正确/);
          assert.match(repair.instructions, /完整 JSON 对象/);
          assert.deepEqual(JSON.parse(messages.at(-2).content[0].text), invalid);
          candidate = { ...payload.candidateSkeleton, title: '从小动作开始',
            cues: [{ id: 'cue_1', text: payload.input.content }],
            scenes: [{ ...payload.candidateSkeleton.scenes[0], imageTexts: [] }] };
        }
        assert.ok(requests <= 2);
        const text = JSON.stringify(candidate);
        return new Response(JSON.stringify(protocol === 'anthropic-messages'
          ? { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
          : { output_text: text, status: 'completed', instructions: '通用助手提示词替身' }), { status: 200 });
      },
    },
  });
  assert.equal(requests, 2);
  assert.deepEqual(validateCandidate(result, input), []);
  assert.equal(result.cues[0].text, input.content);
}

(async () => {
  let body;
  const text = await callTextModel({ textConfig: { enabled: true, apiKey: 'fixture-key', baseUrl: 'https://example.invalid/v1', modelId: 'gpt-6-astra' },
    messages: [{ role: 'user', content: '返回 JSON' }], reasoningEffort: 'low', maxOutputTokens: 10000, maxRetries: 0,
    fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ output_text: '{"ok":true}' }), { status: 200 }); } });
  assert.equal(text.success, true);
  assert.deepEqual(body.reasoning, { effort: 'low' }); assert.equal(body.max_output_tokens, 10000);
  assert.equal(body.temperature, undefined);
  assert.equal(body.text, undefined);
  await verifyDraftRequest('openai-responses');
  await verifyDraftRequest('anthropic-messages');
  const imageConfig = { enabled: true, apiKey: 'fixture-key', baseUrl: 'https://example.invalid/v1', modelId: 'seedream-test' };
  const input = { artifact: { visualStyle: { displayName: '测试', description: '测试线稿' } }, scene: { imagePrompt: '两个独立图形' }, imageConfig };
  const prompt = lineartPrompt(input.artifact, input.scene);
  assert.ok(prompt.includes('低饱和橙色与钴蓝色'));
  assert.ok(!prompt.includes('#F5EBD7'));
  assert.ok(prompt.includes('色号、尺寸、制作术语和提示词都是创作说明，不能写在图里'));
  await assert.rejects(generateLineart({ ...input, services: { fetchImpl: async (_url, init) => {
    body = JSON.parse(init.body); return new Response(JSON.stringify({ error: { message: 'unsupported parameter' } }), { status: 400 });
  } } }), error => error.code === 'IMAGE_REQUEST_REJECTED');
  assert.equal(body.output_format, undefined); assert.equal(body.size, '2560x1440');
  await assert.rejects(generateLineart({ ...input, services: { fetchImpl: async () => { throw new Error('fixture timeout'); } } }), error => error.code === 'UNKNOWN_EXTERNAL_OUTCOME');
  console.log('白板模型合同：两种协议的自包含方案请求与补正、Responses 推理预算、Seedream 参数与明确拒绝/未知结果区分通过。');
})().catch(error => { console.error(error); process.exitCode = 1; });
