const assert = require('assert/strict');
const { validateChanges, proofreadTranscript } = require('../server/services/transcription/corrections');
const { callTextModel } = require('../server/services/ai/aiTextModel');

async function run() {
  const cues = [
    { index: 54, startMs: 100, endMs: 800, text: '家向的月光。' },
    { index: 55, startMs: 950, endMs: 1500, text: '照着小路。' },
  ];
  const original = structuredClone(cues);
  const changed = { index: 54, type: 'homophone', text: '家乡的月光。', reason: '上下文支持“家乡”。' };
  const unchanged = { index: 55, type: 'punctuation', text: cues[1].text, reason: '检查后保持原文。' };

  const changes = validateChanges({ changes: [changed, unchanged] }, cues);
  assert.equal(changes.length, 1, '模型混入无变化项时，应保留其他有效校订');
  assert.equal(changes[0].after, changed.text);
  assert.deepEqual(validateChanges({ changes: [unchanged, { ...unchanged, text: ` ${unchanged.text} ` }] }, cues), [], '无变化项不计入修改记录');
  assert.equal(validateChanges({ changes: [{ ...changed, text: cues[0].text }, changed] }, cues).length, 1, '无变化项不占用有效校订的编号');
  assert.deepEqual(validateChanges({ changes: [changed, { ...changed, type: 'punctuation', text: ` ${changed.text} `, reason: '重复描述同一改文。' }] }, cues),
    validateChanges({ changes: [changed] }, cues), '同一字幕的相同改文只保留一次，即使类型或理由不同');
  assert.deepEqual(cues, original);

  for (const invalid of [
    null, [], { ...changed, index: 99 }, { ...changed, index: '54' },
    { ...changed, type: 'rewrite' }, { ...changed, text: '' },
    { ...changed, text: '第一行\n第二行' }, { ...changed, text: '长'.repeat(301) },
    { ...changed, reason: '' }, { ...unchanged, startMs: 0 },
  ]) {
    assert.throws(() => validateChanges({ changes: [invalid] }, cues), error => error.code === 'CORRECTION_INVALID');
  }
  assert.throws(() => validateChanges({ changes: [changed, { ...changed, text: '另一个版本。' }] }, cues), error => error.code === 'CORRECTION_INVALID' && /冲突/.test(error.message));

  // 原始编号跨批保持不变；每批混入一个无变化项也不能中断后续批次。
  const longCues = Array.from({ length: 149 }, (_, index) => ({
    index: index + 1, startMs: index * 1000, endMs: index * 1000 + 800, text: `第${index + 1}句原文。`,
  }));
  const longOriginal = structuredClone(longCues);
  const batches = [];
  const responses = [];
  const result = await proofreadTranscript(longCues, {
    onModelResponse: async response => { responses.push(response); },
    callModel: async request => {
      assert.equal(request.maxRetries, 0);
      if (request.response_format) return { success: false, configured: true, message: '测试网关不支持 JSON 模式。' };
      const input = JSON.parse(request.messages[1].content);
      batches.push(input.sentences.map(cue => cue.index));
      return { success: true, text: JSON.stringify({ changes: [
        { index: input.sentences[0].index, type: 'punctuation', text: input.sentences[0].text.replace('。', '！'), reason: '测试标点校订。' },
        { index: input.sentences.at(-1).index, type: 'other', text: input.sentences.at(-1).text, reason: '无需变化。' },
      ] }), raw_response: { private: 'must-not-persist' } };
    },
  });
  assert.deepEqual(batches.map(batch => [batch[0], batch.at(-1)]), [[1, 60], [61, 120], [121, 149]]);
  assert.equal(result.changes.length, 3);
  assert.equal(result.sentences.length, 149);
  assert.deepEqual(result.sentences.map(({ index, startMs, endMs }) => [index, startMs, endMs]), longCues.map(({ index, startMs, endMs }) => [index, startMs, endMs]));
  assert.deepEqual(longCues, longOriginal);
  assert.equal(responses.length, 3);
  assert.deepEqual(responses[1].indices, batches[1]);
  assert.equal(responses[1].batchNumber, 2);
  assert.equal(responses[1].totalBatches, 3);
  assert.ok(!JSON.stringify(responses).includes('must-not-persist'));

  // 即使兼容服务忽略顶层 instructions，Responses input 仍应包含完整的校订任务与格式约束。
  let wireRequests = 0;
  const compatible = await proofreadTranscript(cues, {
    callModel: request => callTextModel({ ...request,
      textConfig: { enabled: true, provider: 'fixture', protocol: 'openai-responses',
        apiKey: 'fixture-only-key', baseUrl: 'https://example.invalid/v1', modelId: 'fixture-model' },
      fetchImpl: async (_url, options) => {
        wireRequests += 1;
        const body = JSON.parse(options.body);
        const userMessages = body.input.filter(message => message.role === 'user');
        const texts = userMessages.map(message => message.content.map(part => part.text || '').join(''));
        assert.deepEqual(JSON.parse(texts[0]).sentences, cues.map(({ index, text }) => ({ index, text })));
        const task = texts.slice(1).join('\n');
        assert.match(task, /请现在校订/);
        assert.match(task, /不要询问处理方式/);
        assert.ok(task.includes(body.instructions), '用户消息保留全部规则，而不只依赖被代理替换的 instructions');
        assert.match(task, /54 到 55/);
        assert.match(task, /不得增删字幕、修改编号或生成时间戳/);
        assert.equal(body.text?.format, undefined, '不强制使用兼容服务可能不支持的 JSON 模式');
        return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant',
          content: [{ type: 'output_text', text: JSON.stringify({ changes: [changed] }) }] }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    }),
  });
  assert.equal(wireRequests, 1);
  assert.equal(compatible.sentences[0].text, changed.text);
  assert.deepEqual(cues, original);

  for (const text of ['收到。你希望我怎么处理？回复序号即可。', '{"changes":', JSON.stringify({ changes: [{ ...changed, startMs: 0 }] })]) {
    let savedResponse;
    let calls = 0;
    await assert.rejects(proofreadTranscript(cues, {
      onModelResponse: async response => { savedResponse = response; },
      callModel: async () => { calls += 1; return { success: true, text }; },
    }), error => error.code === 'CORRECTION_INVALID');
    assert.equal(savedResponse.text, text, '解析或业务校验失败前必须保留模型原始正文');
    assert.equal(calls, 1, '校验失败不能隐式发起新的模型请求');
    assert.deepEqual(cues, original);
  }
}

run().then(() => console.log('校订回归测试通过：Responses 输入保留任务要求、无变化项、严格校验、跨批时间轴及失败响应留存。'))
  .catch(error => { console.error(error); process.exitCode = 1; });
