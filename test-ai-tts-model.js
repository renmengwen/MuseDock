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

  let retryAttempts = 0;
  let waitedMs = 0;
  const retried = await aiTtsModel.callTtsModel({
    text: '闄愭祦閲嶈瘯娴嬭瘯',
    ttsConfig: {
      enabled: true,
      provider: 'mimo',
      apiKey: 'mimo-secret',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      modelId: 'mimo-v2.5-tts',
    },
    maxRetries: 1,
    retryDelayMs: 25,
    ttsQueueIntervalMs: 0,
    waitImpl: async ms => {
      waitedMs += ms;
    },
    fetchImpl: async () => {
      retryAttempts += 1;
      if (retryAttempts === 1) {
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: { message: 'Too many requests' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                audio: {
                  data: Buffer.from('retry wav data').toString('base64'),
                },
              },
            },
          ],
        }),
      };
    },
  });
  assert.strictEqual(retried.success, true);
  assert.strictEqual(retried.audioBuffer.toString(), 'retry wav data');
  assert.strictEqual(retryAttempts, 2);
  assert.strictEqual(waitedMs, 25);

  const queueEvents = [];
  let queueWaitedMs = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const queuedCalls = ['first', 'second'].map(label => aiTtsModel.callTtsModel({
    text: label,
    ttsConfig: {
      enabled: true,
      provider: 'mimo',
      apiKey: 'mimo-secret',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      modelId: 'mimo-v2.5-tts',
    },
    ttsQueueIntervalMs: 100,
    waitImpl: async ms => {
      queueWaitedMs += ms;
    },
    fetchImpl: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      queueEvents.push(`start:${label}`);
      await Promise.resolve();
      queueEvents.push(`end:${label}`);
      inFlight -= 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: Buffer.from(`queued ${label}`).toString('base64') }),
      };
    },
  }));
  const queuedResults = await Promise.all(queuedCalls);
  assert.deepStrictEqual(queuedResults.map(item => item.audioBuffer.toString()), ['queued first', 'queued second']);
  assert.strictEqual(maxInFlight, 1);
  assert.deepStrictEqual(queueEvents, ['start:first', 'end:first', 'start:second', 'end:second']);
  assert.ok(queueWaitedMs >= 100);

  let concurrencyInFlight = 0;
  let concurrencyMaxInFlight = 0;
  let releaseConcurrentFetches;
  const concurrentGate = new Promise(resolve => {
    releaseConcurrentFetches = resolve;
  });
  let concurrentStarted = 0;
  const concurrentCalls = ['one', 'two', 'three'].map(label => aiTtsModel.callTtsModel({
    text: label,
    ttsConfig: {
      enabled: true,
      provider: 'mimo',
      apiKey: 'mimo-secret',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      modelId: 'mimo-v2.5-tts',
      ttsConcurrency: 2,
      ttsQueueIntervalMs: 0,
    },
    fetchImpl: async () => {
      concurrencyInFlight += 1;
      concurrentStarted += 1;
      concurrencyMaxInFlight = Math.max(concurrencyMaxInFlight, concurrencyInFlight);
      if (concurrentStarted === 2) {
        releaseConcurrentFetches();
      }
      await concurrentGate;
      concurrencyInFlight -= 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: Buffer.from(`concurrent ${label}`).toString('base64') }),
      };
    },
  }));
  const concurrentResults = await Promise.all(concurrentCalls);
  assert.deepStrictEqual(concurrentResults.map(item => item.audioBuffer.toString()), [
    'concurrent one',
    'concurrent two',
    'concurrent three',
  ]);
  assert.strictEqual(concurrencyMaxInFlight, 2);
}

run().then(() => {
  console.log('ai tts model tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
