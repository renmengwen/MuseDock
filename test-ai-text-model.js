const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const aiModelConfig = require('./server/services/aiModelConfig');
const aiTextModel = require('./server/services/aiTextModel');

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
