const assert = require('node:assert/strict');
const { callTextModel } = require('../server/services/ai/aiTextModel');
const { runWithApiCallContext } = require('../server/services/diagnostics/apiCallRecorder');

const config = { enabled: true, provider: 'fixture', protocol: 'openai-chat-completions',
  apiKey: 'fixture-only-key', baseUrl: 'https://example.invalid/v1/', modelId: 'deepseek-flash' };
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const reply = (content, extra = {}) => ({ choices: [{ message: { role: 'assistant', content, ...extra } }] });
const call = options => runWithApiCallContext({ store: { start: () => null } }, () => callTextModel({
  textConfig: config, messages: [{ role: 'user', content: '测试' }], maxRetries: 0, ...options,
}));

async function run() {
  const messages = [{ role: 'system', content: '只输出 JSON，例如 {"ok":true}。' }, {
    role: 'user', content: [{ type: 'text', text: '看图并返回 JSON' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=', detail: 'low' } }],
  }];
  const result = await call({ messages, response_format: { type: 'json_object' }, maxTokens: 14000,
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://example.invalid/v1/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer fixture-only-key');
      assert.ok(init.signal);
      const body = JSON.parse(init.body);
      assert.deepEqual(body.messages, messages);
      assert.deepEqual(body.response_format, { type: 'json_object' });
      assert.equal(body.model, 'deepseek-flash');
      assert.equal(body.max_tokens, 14000);
      for (const field of ['input', 'instructions', 'text', 'max_output_tokens', 'reasoning']) assert.equal(body[field], undefined);
      return json({ ...reply('{"ok":true}', { reasoning_content: '不要把内部分析当答案' }),
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } });
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.text, '{"ok":true}');
  assert.equal(result.model.protocol, 'openai-chat-completions');
  assert.equal(result.usage.prompt_tokens, 20);
  assert.equal(result.usage.completion_tokens, 5);
  console.log('PASS Chat 端点、认证、文本与图片消息、JSON 模式、token 上限和返回统计');

  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
  const flatFormat = { type: 'json_schema', name: 'example', schema, strict: true };
  const nestedFormat = { type: 'json_schema', json_schema: { name: 'example', schema, strict: true } };
  for (const response_format of [flatFormat, nestedFormat, undefined]) {
    await call({ response_format, fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.response_format, response_format ? nestedFormat : undefined);
      return json(reply('普通正文'));
    } });
  }
  console.log('PASS 显式 JSON Schema 正确嵌套，普通请求不会被强制为 JSON');

  const tool = { type: 'function', function: { name: 'lookup', description: '查询', parameters: { type: 'object', properties: {} } } };
  const toolCall = { id: 'fixture-call', type: 'function', function: { name: 'lookup', arguments: '{}' } };
  let toolRequests = 0;
  const toolResult = await call({ tools: [tool], tool_choice: { type: 'function', function: { name: 'lookup' } },
    stream: true, onDelta: () => assert.fail('工具调用不能混入文本流'), maxRetries: 1,
    fetchImpl: async (_url, init) => {
      toolRequests++;
      const body = JSON.parse(init.body);
      assert.deepEqual(body.tools, [tool]);
      assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'lookup' } });
      assert.equal(body.stream, undefined);
      return json(reply(null, { tool_calls: [toolCall] }));
    },
  });
  assert.equal(toolResult.success, true);
  assert.equal(toolResult.text, '');
  assert.equal(toolRequests, 1, '有效工具调用不能因正文为空而重复请求');
  assert.deepEqual(toolResult.raw_response.normalized_tool_calls, [toolCall]);
  const toolMessages = [{ role: 'assistant', content: null, tool_calls: [toolCall] },
    { role: 'tool', tool_call_id: toolCall.id, content: '{"found":true}' }];
  await call({ messages: toolMessages, fetchImpl: async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body).messages, toolMessages);
    return json(reply('查询完成'));
  } });
  console.log('PASS Chat 工具定义、工具消息往返及仅工具返回不重复请求');

  const deltas = [];
  const streamed = await call({ stream: true, onDelta: text => deltas.push(text), fetchImpl: async (_url, init) => {
    assert.equal(JSON.parse(init.body).stream, true);
    const chunks = [{ choices: [{ delta: { reasoning_content: '不要展示' } }] },
      { choices: [{ delta: { content: '你' } }] }, { choices: [{ delta: { content: '好' } }] },
      { choices: [], usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 } }];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } });
  } });
  assert.equal(streamed.success, true);
  assert.equal(streamed.text, '你好');
  assert.deepEqual(deltas, ['你', '好']);
  assert.equal(streamed.usage.total_tokens, 11);
  console.log('PASS Chat 流式正文和 usage，不拼接 reasoning_content');

  let retries = 0;
  const retried = await call({ maxTokens: 100, maxOutputTokens: 800, reasoningEffort: 'low', maxRetries: 1, retryDelayMs: 1,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.max_completion_tokens, 800);
      assert.equal(body.reasoning_effort, 'low');
      assert.equal(body.temperature, undefined);
      return json(retries++ ? reply('补齐正文') : { choices: [] });
    },
  });
  assert.equal(retried.success, true);
  assert.equal(retries, 2);
  console.log('PASS 调用方已允许的重试保留推理参数及输出预算');

  const thinking = { type: 'reasoning', content: [{ type: 'reasoning_text', text: '内部分析' }] };
  const message = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"ok":true}' }] };
  for (const output of [[thinking, message], [message, thinking], [{ content: message.content }],
    [{ ...message, content: [{ type: 'reasoning_text', text: '不应成为正文' }, ...message.content] }]]) {
    const parsed = await call({ textConfig: { ...config, protocol: 'openai-responses' },
      fetchImpl: async () => json({ output }),
    });
    assert.equal(parsed.success, true);
    assert.deepEqual(JSON.parse(parsed.text), { ok: true });
    assert.deepEqual(parsed.raw_response.output, output, '诊断原始响应仍保留思考块');
  }
  for (const output of [[thinking], [{ type: 'function_call', content: message.content }],
    [{ ...message, role: 'user' }], [{ ...message, content: [{ type: 'reasoning_text', text: '只有分析' }] }]]) {
    const missing = await call({ textConfig: { ...config, protocol: 'openai-responses' },
      fetchImpl: async () => json({ output }),
    });
    assert.equal(missing.success, false);
    assert.match(missing.message, /缺少文本内容/);
  }
  console.log('PASS Responses 只取正式答案，思考或工具块不能冒充正文，兼容省略 type 的响应');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
