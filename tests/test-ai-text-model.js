const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const aiModelConfig = require('../server/services/ai/aiModelConfig');
const aiTextModel = require('../server/services/ai/aiTextModel');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-text-model-test-'));
  const configPath = path.join(root, 'ai-models.json');

  const missing = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'hello' }],
    configPath,
  });
  assert.strictEqual(missing.success, false);
  assert.strictEqual(missing.configured, false);
  assert.match(missing.message, /分析模型未配置/);

  await aiModelConfig.saveConfig({
    providers: {
      openai: {
        name: 'OpenAI',
        protocol: 'openai-responses',
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com/v1/',
        models: {
          text: { enabled: true, modelId: 'gpt-test', supportsMultimodal: true },
        },
      },
    },
    active: { text: 'openai/text' },
  }, { configPath });

  let requestedUrl = '';
  let requestedOptions = null;
  const ok = await aiTextModel.callTextModel({
    messages: [{ role: 'system', content: '只输出 JSON' }, { role: 'user', content: '生成 JSON' }],
    configPath,
    response_format: { type: 'json_object' },
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          output_text: '{"summary":"ok"}',
          debug: { request: { authorization: 'Bearer sk-test' } },
        }),
        headers: { get: () => 'application/json' },
      };
    },
  });

  assert.strictEqual(ok.success, true);
  assert.strictEqual(ok.text, '{"summary":"ok"}');
  assert.strictEqual(ok.model.provider, 'openai');
  assert.strictEqual(ok.model.model_id, 'gpt-test');
  assert.strictEqual(ok.model.protocol, 'openai-responses');
  assert.doesNotMatch(JSON.stringify(ok.raw_response), /sk-test/);
  assert.strictEqual(requestedUrl, 'https://api.example.com/v1/responses');
  assert.strictEqual(requestedOptions.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(requestedOptions.body);
  assert.strictEqual(body.model, 'gpt-test');
  assert.strictEqual(body.instructions, '只输出 JSON');
  assert.deepStrictEqual(body.input, [{ role: 'user', content: [{ type: 'input_text', text: '生成 JSON' }] }]);
  assert.deepStrictEqual(body.text, { format: { type: 'json_object' } });
  assert.ok(requestedOptions.signal, 'text model requests should include an AbortSignal');

  const imageResult = await aiTextModel.callTextModel({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
      ],
    }],
    configPath,
    fetchImpl: async (url, options) => {
      const request = JSON.parse(options.body);
      assert.deepStrictEqual(request.input[0].content, [
        { type: 'input_text', text: '看图' },
        { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' },
      ]);
      return {
        ok: true,
        status: 200,
        json: async () => ({ output: [{ content: [{ type: 'output_text', text: '图片 ok' }] }] }),
      };
    },
  });
  assert.strictEqual(imageResult.success, true);
  assert.strictEqual(imageResult.text, '图片 ok');

  const usageResult = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'usage' }],
    configPath,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        output_text: 'usage ok',
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          total_tokens: 16,
          input_tokens_details: { cached_tokens: 7 },
        },
      }),
    }),
  });
  assert.deepStrictEqual(usageResult.usage, {
    prompt_tokens: 12,
    completion_tokens: 4,
    total_tokens: 16,
    cached_tokens: 7,
  });

  let toolBody = null;
  const toolCallResult = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: '搜索 OpenAI' }],
    configPath,
    tools: [{
      type: 'function',
      function: {
        name: 'web_search',
        description: '联网搜索',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    }],
    fetchImpl: async (url, options) => {
      toolBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [{
            type: 'function_call',
            call_id: 'call_1',
            name: 'web_search',
            arguments: '{"query":"OpenAI"}',
          }],
        }),
      };
    },
  });
  assert.strictEqual(toolCallResult.success, false);
  assert.deepStrictEqual(toolBody.tools, [{
    type: 'function',
    name: 'web_search',
    description: '联网搜索',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  }]);
  assert.deepStrictEqual(toolCallResult.raw_response.normalized_tool_calls, [{
    id: 'call_1',
    type: 'function',
    function: { name: 'web_search', arguments: '{"query":"OpenAI"}' },
  }]);

  let injectedRequestOptions = null;
  const injected = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'injected config' }],
    textConfig: {
      enabled: true,
      provider: 'anthropic',
      protocol: 'anthropic-messages',
      apiKey: 'sk-ant-test',
      baseUrl: 'https://anthropic.example.com/v1/',
      modelId: 'claude-test',
    },
    response_format: { type: 'json_object' },
    fetchImpl: async (url, options) => {
      assert.strictEqual(url, 'https://anthropic.example.com/v1/messages');
      injectedRequestOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: '{"ok":true}' }],
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      };
    },
  });
  assert.strictEqual(injected.success, true);
  assert.strictEqual(injected.text, '{"ok":true}');
  assert.strictEqual(injected.model.protocol, 'anthropic-messages');
  assert.strictEqual(injectedRequestOptions.headers['x-api-key'], 'sk-ant-test');
  assert.strictEqual(injectedRequestOptions.headers['anthropic-version'], '2023-06-01');
  const anthropicBody = JSON.parse(injectedRequestOptions.body);
  assert.strictEqual(anthropicBody.model, 'claude-test');
  assert.strictEqual(anthropicBody.max_tokens, 4096);
  assert.match(anthropicBody.system, /有效 JSON/);

  const anthropicImageAndTool = await aiTextModel.callTextModel({
    messages: [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'toolu_1', function: { name: 'web_search', arguments: '{"query":"MuseDock"}' } }],
      },
      {
        role: 'tool',
        tool_call_id: 'toolu_1',
        name: 'web_search',
        content: '{"results":[]}',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: '继续' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abcd' } },
        ],
      },
    ],
    textConfig: {
      enabled: true,
      provider: 'anthropic',
      protocol: 'anthropic-messages',
      apiKey: 'sk-ant-test',
      baseUrl: 'https://anthropic.example.com/v1',
      modelId: 'claude-test',
    },
    fetchImpl: async (url, options) => {
      const request = JSON.parse(options.body);
      assert.deepStrictEqual(request.messages[0].content[0], {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'web_search',
        input: { query: 'MuseDock' },
      });
      assert.deepStrictEqual(request.messages[1].content[0], {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: '{"results":[]}',
      });
      assert.deepStrictEqual(request.messages[2].content[1], {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'abcd' },
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'tool_use', id: 'toolu_2', name: 'web_search', input: { query: '继续' } }],
        }),
      };
    },
  });
  assert.strictEqual(anthropicImageAndTool.success, false);
  assert.deepStrictEqual(anthropicImageAndTool.raw_response.normalized_tool_calls, [{
    id: 'toolu_2',
    type: 'function',
    function: { name: 'web_search', arguments: '{"query":"继续"}' },
  }]);

  const failed = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'fail' }],
    configPath,
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'rate limited sk-test' } }),
    }),
  });
  assert.strictEqual(failed.success, false);
  assert.match(failed.message, /rate limited/);
  assert.doesNotMatch(failed.message, /sk-test/);
  assert.doesNotMatch(JSON.stringify(failed.raw_response), /sk-test/);

  const plainTextFailed = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'plain text fail' }],
    configPath,
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      headers: { get: () => 'text/plain; charset=utf-8' },
      text: async () => 'This request failed sk-test',
    }),
  });
  assert.strictEqual(plainTextFailed.success, false);
  assert.match(plainTextFailed.message, /request failed/);
  assert.doesNotMatch(plainTextFailed.message, /sk-test/);

  let retryCalls = 0;
  const retried = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'retry timeout' }],
    configPath,
    retryDelayMs: 1,
    fetchImpl: async () => {
      retryCalls += 1;
      if (retryCalls === 1) {
        return { ok: false, status: 504, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ output_text: 'retry ok' }) };
    },
  });
  assert.strictEqual(retried.success, true);
  assert.strictEqual(retried.text, 'retry ok');
  assert.strictEqual(retryCalls, 2);

  const htmlResponse = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'html response' }],
    configPath,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: name => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      json: async () => { throw new Error('Unexpected token < in JSON'); },
      text: async () => '<!doctype html><html><title>API Gateway</title></html>',
    }),
  });
  assert.strictEqual(htmlResponse.success, false);
  assert.match(htmlResponse.message, /返回了非 JSON 响应/);
  assert.match(htmlResponse.message, /Base URL/);
  assert.match(htmlResponse.raw_response.preview, /API Gateway/);

  let missingTextAttempts = 0;
  const missingTextRetry = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'missing text retry' }],
    configPath,
    maxRetries: 1,
    retryDelayMs: 1,
    fetchImpl: async () => {
      missingTextAttempts += 1;
      return {
        ok: true,
        status: 200,
        json: async () => missingTextAttempts === 1 ? ({ output: [] }) : ({ output_text: '重试成功' }),
      };
    },
  });
  assert.strictEqual(missingTextRetry.success, true);
  assert.strictEqual(missingTextRetry.text, '重试成功');
  assert.strictEqual(missingTextAttempts, 2);
}

run().then(() => {
  console.log('ai text model tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
