const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const aiModelConfig = require('./server/services/aiModelConfig');

async function run() {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-model-config-test-')), 'ai-models.json');

  const initial = await aiModelConfig.getPublicConfig({ configPath });
  assert.deepStrictEqual(Object.keys(initial.models), ['asr', 'text', 'image', 'video', 'multimodal', 'tts']);
  assert.strictEqual(initial.models.asr.enabled, false);
  assert.strictEqual(initial.models.text.provider, '');
  assert.strictEqual(initial.models.image.apiKeyMasked, '');
  assert.strictEqual(initial.models.video.hasApiKey, false);
  assert.strictEqual(initial.models.tts.modelId, '');

  const saved = await aiModelConfig.saveConfig({
    models: {
      asr: {
        enabled: true,
        provider: 'openai',
        apiKey: 'sk-asr-secret-1234',
        baseUrl: 'https://api.openai.com/v1/',
        modelId: 'whisper-1',
        note: 'audio transcription',
      },
      text: {
        enabled: true,
        provider: 'deepseek',
        apiKey: 'deepseek-secret',
        baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-chat',
      },
      tts: {
        enabled: true,
        provider: 'mimo',
        apiKey: 'mimo-secret',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        modelId: 'mimo-v2.5-tts',
        ttsConcurrency: 2,
        ttsQueueIntervalMs: 3000,
      },
      unknown: {
        enabled: true,
        apiKey: 'ignored',
      },
    },
  }, { configPath });

  assert.strictEqual(saved.models.asr.enabled, true);
  assert.strictEqual(saved.models.asr.baseUrl, 'https://api.openai.com/v1');
  assert.strictEqual(saved.models.asr.apiKey, undefined);
  assert.strictEqual(saved.models.asr.hasApiKey, true);
  assert.strictEqual(saved.models.asr.apiKeyMasked, 'sk-****1234');
  assert.strictEqual(saved.models.text.apiKeyMasked, '****cret');
  assert.strictEqual(saved.models.multimodal.enabled, false);
  assert.strictEqual(saved.models.tts.enabled, true);
  assert.strictEqual(saved.models.tts.ttsConcurrency, 2);
  assert.strictEqual(saved.models.tts.ttsQueueIntervalMs, 3000);
  assert.strictEqual(saved.models.unknown, undefined);

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  assert.strictEqual(raw.models.asr.apiKey, 'sk-asr-secret-1234');
  assert.strictEqual(raw.models.text.apiKey, 'deepseek-secret');

  const updated = await aiModelConfig.saveConfig({
    models: {
      asr: {
        enabled: false,
        provider: 'openai',
        apiKey: '',
        baseUrl: 'https://proxy.example/v1',
        modelId: 'gpt-4o-transcribe',
      },
    },
  }, { configPath });

  assert.strictEqual(updated.models.asr.enabled, false);
  assert.strictEqual(updated.models.asr.baseUrl, 'https://proxy.example/v1');
  assert.strictEqual(updated.models.asr.apiKeyMasked, 'sk-****1234');

  const rawAfterBlankKeyUpdate = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  assert.strictEqual(rawAfterBlankKeyUpdate.models.asr.apiKey, 'sk-asr-secret-1234');

  const runtime = await aiModelConfig.getRuntimeConfig('asr', { configPath });
  assert.strictEqual(runtime.apiKey, 'sk-asr-secret-1234');
  assert.strictEqual(runtime.modelId, 'gpt-4o-transcribe');

  const ttsRuntime = await aiModelConfig.getRuntimeConfig('tts', { configPath });
  assert.strictEqual(ttsRuntime.ttsConcurrency, 2);
  assert.strictEqual(ttsRuntime.ttsQueueIntervalMs, 3000);
}

run().then(() => {
  console.log('ai model config tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
