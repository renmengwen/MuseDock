const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const aiModelConfig = require('../server/services/ai/aiModelConfig');

async function run() {
  const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-model-config-test-')), 'ai-models.json');

  // Test 1: empty config returns default structure
  const initial = await aiModelConfig.getPublicConfig({ configPath });
  assert.deepStrictEqual(Object.keys(initial), ['providers', 'active', 'skipValidation']);
  assert.deepStrictEqual(initial.providers, {});
  assert.strictEqual(initial.skipValidation, false);
  for (const type of aiModelConfig.MODEL_TYPES) {
    assert.strictEqual(initial.active[type], '');
  }

  // Test 2: save new multi-provider config
  const saved = await aiModelConfig.saveConfig({
    providers: {
      openai: {
        name: 'OpenAI',
        apiKey: 'sk-openai-secret-1234',
        baseUrl: 'https://api.openai.com/v1/',
        models: {
          text: { enabled: true, modelId: 'gpt-4o', supportsMultimodal: true },
          asr: { enabled: true, modelId: 'whisper-1' },
          multimodal: { enabled: true, modelId: 'gpt-4o-legacy' },
        },
      },
      mimo: {
        name: '小米 MiMo',
        apiKey: 'mimo-secret',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        models: {
          tts: { enabled: true, modelId: 'mimo-v2.5-tts', ttsConcurrency: 2, ttsQueueIntervalMs: 3000 },
          text: { enabled: true, modelId: 'mimo-v2.5-pro' },
        },
      },
    },
    active: {
      text: 'mimo/text',
      tts: 'mimo/tts',
      asr: 'openai/asr',
      multimodal: 'openai/multimodal',
    },
    skipValidation: true,
  }, { configPath });

  // Verify public config masks API keys
  assert.strictEqual(saved.providers.openai.hasApiKey, true);
  assert.strictEqual(saved.providers.openai.apiKeyMasked, 'sk-****1234');
  assert.strictEqual(saved.providers.openai.apiKey, undefined);
  assert.strictEqual(saved.providers.mimo.apiKeyMasked, '****cret');
  assert.strictEqual(saved.providers.openai.models.text.enabled, true);
  assert.strictEqual(saved.providers.openai.models.text.modelId, 'gpt-4o');
  assert.strictEqual(saved.providers.openai.models.text.supportsMultimodal, true);
  assert.strictEqual(saved.providers.openai.models.multimodal, undefined);
  assert.strictEqual(saved.active.text, 'mimo/text');
  assert.strictEqual(saved.active.multimodal, undefined);
  assert.strictEqual(saved.skipValidation, true);

  // Verify raw storage preserves API keys
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  assert.strictEqual(raw.providers.openai.apiKey, 'sk-openai-secret-1234');
  assert.strictEqual(raw.providers.mimo.apiKey, 'mimo-secret');

  // Test 3: runtime config resolves active provider
  const textRuntime = await aiModelConfig.getRuntimeConfig('text', { configPath });
  assert.strictEqual(textRuntime.provider, 'mimo');
  assert.strictEqual(textRuntime.apiKey, 'mimo-secret');
  assert.strictEqual(textRuntime.baseUrl, 'https://api.xiaomimimo.com/v1');
  assert.strictEqual(textRuntime.modelId, 'mimo-v2.5-pro');
  assert.strictEqual(textRuntime.supportsMultimodal, false);

  const ttsRuntime = await aiModelConfig.getRuntimeConfig('tts', { configPath });
  assert.strictEqual(ttsRuntime.provider, 'mimo');
  assert.strictEqual(ttsRuntime.modelId, 'mimo-v2.5-tts');
  assert.strictEqual(ttsRuntime.ttsConcurrency, 2);
  assert.strictEqual(ttsRuntime.ttsQueueIntervalMs, 3000);

  const asrRuntime = await aiModelConfig.getRuntimeConfig('asr', { configPath });
  assert.strictEqual(asrRuntime.provider, 'openai');
  assert.strictEqual(asrRuntime.apiKey, 'sk-openai-secret-1234');
  assert.strictEqual(asrRuntime.modelId, 'whisper-1');

  // Test 4: unselected model returns null
  const multimodalRuntime = await aiModelConfig.getRuntimeConfig('multimodal', { configPath });
  assert.strictEqual(multimodalRuntime, null);

  const videoRuntime = await aiModelConfig.getRuntimeConfig('video', { configPath });
  assert.strictEqual(videoRuntime, null);

  // Test 5: update with blank API key preserves old key
  const updated = await aiModelConfig.saveConfig({
    providers: {
      openai: {
        name: 'OpenAI',
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1/',
        models: {
          text: { enabled: true, modelId: 'gpt-4o-mini' },
        },
      },
    },
    active: { text: 'openai/text' },
  }, { configPath });

  const afterUpdate = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  assert.strictEqual(afterUpdate.providers.openai.apiKey, 'sk-openai-secret-1234'); // blank key preserves old
  assert.strictEqual(afterUpdate.active.text, 'openai/text');

  // Test 6: getSkipValidation
  const skipVal = await aiModelConfig.getSkipValidation({ configPath });
  assert.strictEqual(skipVal, false); // new save didn't set it

  // Test 7: old format migration
  const oldConfigPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'old-config-')), 'ai-models.json');
  fs.writeFileSync(oldConfigPath, JSON.stringify({
    models: {
      text: { enabled: true, provider: 'mimo', apiKey: 'old-key', baseUrl: 'https://old.com/v1', modelId: 'mimo-v2.5-pro' },
      tts: { enabled: true, provider: 'mimo', apiKey: 'old-key', baseUrl: 'https://old.com/v1', modelId: 'mimo-v2.5-tts', ttsConcurrency: 3, ttsQueueIntervalMs: 500 },
    },
  }));
  const migrated = await aiModelConfig.getPublicConfig({ configPath: oldConfigPath });
  assert.strictEqual(Object.keys(migrated.providers).length, 1);
  const migProvider = migrated.providers[Object.keys(migrated.providers)[0]];
  assert.strictEqual(migProvider.models.text.enabled, true);
  assert.strictEqual(migProvider.models.text.modelId, 'mimo-v2.5-pro');
  assert.strictEqual(migrated.active.text?.includes('/text'), true);
}

run().then(() => {
  console.log('ai model config tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
