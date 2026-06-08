const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const aiModelConfig = require('./server/services/aiModelConfig');
const aiTtsModel = require('./server/services/aiTtsModel');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-tts-model-test-'));
  const configPath = path.join(root, 'ai-models.json');

  const missing = await aiTtsModel.callTtsModel({
    text: '需要合成的脚本',
    configPath,
  });
  assert.strictEqual(missing.success, false);
  assert.match(missing.message, /TTS|语音合成|未配置/);

  await aiModelConfig.saveConfig({
    models: {
      tts: {
        enabled: true,
        provider: 'mimo',
        apiKey: 'mimo-secret',
        baseUrl: 'https://api.xiaomimimo.com/v1/',
        modelId: 'mimo-v2.5-tts',
      },
    },
  }, { configPath });

  let capturedUrl = '';
  let capturedOptions = null;
  const ok = await aiTtsModel.callTtsModel({
    text: '大家好，今天聊聊本地创作工作流。',
    voice: 'mimo_default',
    stylePrompt: '请使用自然、亲切、节奏稍快的口播风格。',
    configPath,
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                audio: {
                  data: Buffer.from('fake wav data').toString('base64'),
                },
              },
            },
          ],
        }),
      };
    },
  });

  assert.strictEqual(ok.success, true);
  assert.strictEqual(ok.audioBuffer.toString(), 'fake wav data');
  assert.strictEqual(ok.format, 'wav');
  assert.strictEqual(ok.voice, 'mimo_default');
  assert.strictEqual(ok.model.provider, 'mimo');
  assert.strictEqual(ok.model.model_id, 'mimo-v2.5-tts');
  assert.strictEqual(capturedUrl, 'https://api.xiaomimimo.com/v1/chat/completions');
  assert.strictEqual(capturedOptions.headers['api-key'], 'mimo-secret');
  const body = JSON.parse(capturedOptions.body);
  assert.strictEqual(body.model, 'mimo-v2.5-tts');
  assert.strictEqual(body.audio.format, 'wav');
  assert.strictEqual(body.audio.voice, 'mimo_default');
  assert.strictEqual(body.messages[0].role, 'user');
  assert.match(body.messages[0].content, /自然、亲切/);
  assert.strictEqual(body.messages[1].role, 'assistant');
  assert.match(body.messages[1].content, /大家好/);

  const failed = await aiTtsModel.callTtsModel({
    text: '失败测试',
    ttsConfig: {
      enabled: true,
      provider: 'mimo',
      apiKey: 'mimo-secret',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      modelId: 'mimo-v2.5-tts',
    },
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'bad voice' } }),
    }),
  });
  assert.strictEqual(failed.success, false);
  assert.match(failed.message, /bad voice/);
}

run().then(() => {
  console.log('ai tts model tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
