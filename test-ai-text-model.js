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
        }),
      };
    },
  });

  assert.strictEqual(ok.success, true);
  assert.strictEqual(ok.text, '{"summary":"ok"}');
  assert.strictEqual(ok.model.provider, 'OpenAI');
  assert.strictEqual(ok.model.model_id, 'gpt-test');
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
      json: async () => ({ error: { message: 'rate limited' } }),
    }),
  });
  assert.strictEqual(failed.success, false);
  assert.strictEqual(failed.configured, true);
  assert.match(failed.message, /rate limited/);
}

run().then(() => {
  console.log('ai text model tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
