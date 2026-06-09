const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const aiModelConfig = require('./server/services/aiModelConfig');
const aiTextModel = require('./server/services/aiTextModel');

function makeStreamResponse(chunks) {
  const encoder = new TextEncoder();
  return {
    getReader() {
      let index = 0;
      return {
        async read() {
          if (index >= chunks.length) return { done: true };
          const value = encoder.encode(chunks[index]);
          index += 1;
          return { done: false, value };
        },
      };
    },
  };
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-text-model-test-'));
  const configPath = path.join(root, 'ai-models.json');

  const missing = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'hello' }],
    configPath,
  });
  assert.strictEqual(missing.success, false);
  assert.strictEqual(missing.configured, false);
  assert.match(missing.message, /文本模型未配置/);

  await aiModelConfig.saveConfig({
    models: {
      text: {
        enabled: true,
        provider: 'OpenAI',
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com/v1/',
        modelId: 'gpt-test',
        note: '',
      },
    },
  }, { configPath });

  let requestedUrl = '';
  let requestedOptions = null;
  const ok = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: '生成 JSON' }],
    configPath,
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"summary":"ok"}' } }],
          debug: { request: { authorization: 'Bearer sk-test' } },
        }),
      };
    },
  });

  assert.strictEqual(ok.success, true);
  assert.strictEqual(ok.text, '{"summary":"ok"}');
  assert.strictEqual(ok.model.provider, 'OpenAI');
  assert.strictEqual(ok.model.model_id, 'gpt-test');
  assert.doesNotMatch(JSON.stringify(ok.raw_response), /sk-test/);
  assert.strictEqual(requestedUrl, 'https://api.example.com/v1/chat/completions');
  assert.strictEqual(requestedOptions.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(requestedOptions.body);
  assert.strictEqual(body.model, 'gpt-test');
  assert.deepStrictEqual(body.messages, [{ role: 'user', content: '生成 JSON' }]);

  let injectedRequestOptions = null;
  const injected = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'injected config' }],
    textConfig: {
      enabled: true,
      provider: 'InjectedProvider',
      apiKey: 'sk-injected',
      baseUrl: 'https://injected.example.com/v1/',
      modelId: 'injected-model',
    },
    fetchImpl: async (url, options) => {
      assert.strictEqual(url, 'https://injected.example.com/v1/chat/completions');
      injectedRequestOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'injected ok' } }],
        }),
      };
    },
  });
  assert.strictEqual(injected.success, true);
  assert.strictEqual(injected.text, 'injected ok');
  assert.strictEqual(injected.model.provider, 'InjectedProvider');
  assert.strictEqual(injected.model.model_id, 'injected-model');
  assert.strictEqual(injectedRequestOptions.headers.Authorization, 'Bearer sk-injected');
  assert.strictEqual(JSON.parse(injectedRequestOptions.body).model, 'injected-model');

  const failed = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'fail' }],
    configPath,
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      json: async () => ({
        error: {
          message: 'rate limited sk-test',
          details: {
            headers: {
              authorization: 'Bearer sk-test',
            },
          },
        },
      }),
    }),
  });
  assert.strictEqual(failed.success, false);
  assert.strictEqual(failed.configured, true);
  assert.match(failed.message, /rate limited/);
  assert.doesNotMatch(failed.message, /sk-test/);
  assert.doesNotMatch(JSON.stringify(failed.raw_response), /sk-test/);

  let retryCalls = 0;
  const retried = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'retry timeout' }],
    configPath,
    retryDelayMs: 1,
    fetchImpl: async () => {
      retryCalls += 1;
      if (retryCalls === 1) {
        return {
          ok: false,
          status: 504,
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'retry ok' } }],
        }),
      };
    },
  });
  assert.strictEqual(retried.success, true);
  assert.strictEqual(retried.text, 'retry ok');
  assert.strictEqual(retryCalls, 2);

  let streamRequestBody = null;
  const streamed = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'stream json' }],
    configPath,
    stream: true,
    fetchImpl: async (url, options) => {
      assert.strictEqual(url, 'https://api.example.com/v1/chat/completions');
      streamRequestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        headers: {
          get: name => (name.toLowerCase() === 'content-type' ? 'text/event-stream' : null),
        },
        body: makeStreamResponse([
          'data: {"choices":[{"delta":{"content":"{\\"summary\\":"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"\\"stream ok\\"}"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      };
    },
  });
  assert.strictEqual(streamed.success, true);
  assert.strictEqual(streamed.text, '{"summary":"stream ok"}');
  assert.strictEqual(streamRequestBody.stream, true);

  const networkFailed = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'network fail' }],
    configPath,
    fetchImpl: async () => {
      throw new Error('connect ECONNRESET sk-test');
    },
  });
  assert.strictEqual(networkFailed.success, false);
  assert.strictEqual(networkFailed.configured, true);
  assert.strictEqual(networkFailed.model.provider, 'OpenAI');
  assert.strictEqual(networkFailed.model.model_id, 'gpt-test');
  assert.match(networkFailed.message, /文本模型调用失败/);
  assert.match(networkFailed.message, /connect ECONNRESET/);
  assert.doesNotMatch(networkFailed.message, /sk-test/);

  const invalidJson = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'invalid json' }],
    configPath,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json sk-test');
      },
    }),
  });
  assert.strictEqual(invalidJson.success, false);
  assert.strictEqual(invalidJson.configured, true);
  assert.match(invalidJson.message, /缺少文本内容/);
  assert.doesNotMatch(invalidJson.message, /sk-test/);

  const htmlResponse = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'html response' }],
    configPath,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get: name => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
      },
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
      text: async () => '<!doctype html><html><title>PipeApi - AI API Gateway</title></html>',
    }),
  });
  assert.strictEqual(htmlResponse.success, false);
  assert.strictEqual(htmlResponse.configured, true);
  assert.match(htmlResponse.message, /返回了非 JSON 响应/);
  assert.match(htmlResponse.message, /Base URL/);
  assert.match(htmlResponse.raw_response.preview, /PipeApi/);
  assert.doesNotMatch(htmlResponse.message, /sk-test/);
  assert.doesNotMatch(JSON.stringify(htmlResponse.raw_response), /sk-test/);

  const missingText = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'missing text' }],
    configPath,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: {} }] }),
    }),
  });
  assert.strictEqual(missingText.success, false);
  assert.strictEqual(missingText.configured, true);
  assert.match(missingText.message, /缺少文本内容/);
  assert.doesNotMatch(missingText.message, /sk-test/);
}

run().then(() => {
  console.log('ai text model tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
