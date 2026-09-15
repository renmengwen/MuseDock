const assert = require('assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { normalizeSentences, transcriptionEndpoint, transcribeFunasrAudio } = require('../server/services/transcription/funasr');
const { toSrt, validateChanges, proofreadTranscript } = require('../server/services/transcription/corrections');
const aiModelConfig = require('../server/services/ai/aiModelConfig');
const mediaPipeline = require('../server/services/mediaPipeline');

async function run() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'musedock-funasr-test-'));
  try {
    assert.equal(transcriptionEndpoint('http://127.0.0.1:8000/v1/'), 'http://127.0.0.1:8000/v1/audio/transcriptions');
    assert.equal(transcriptionEndpoint('http://localhost:8000/v1/audio/transcriptions'), 'http://localhost:8000/v1/audio/transcriptions');
    for (const value of ['file:///etc/passwd', 'http://user:pass@localhost/v1', 'http://localhost/v1?token=bad']) {
      assert.throws(() => transcriptionEndpoint(value), error => error.code === 'ASR_CONFIG_INVALID');
    }
    const cues = normalizeSentences({ sentence_info: [
      { start: 120, end: 700, text: '回到故乡。' }, { start: 800, end: 1200, text: '看见月光。' },
    ] }, 1500, 2000);
    assert.deepEqual(cues.map(cue => [cue.startMs, cue.endMs]), [[2120, 2700], [2800, 3200]]);
    for (const payload of [
      { text: '无时间轴。' }, { segments: [] },
      { timing_source: 'proportional_fallback', segments: [{ start: 0, end: 1, text: '估算。' }] },
      { segments: [{ start: NaN, end: 1, text: '错。' }] },
      { segments: [{ start: 0, end: Infinity, text: '错。' }] },
      { segments: [{ start: '0', end: 1, text: '错。' }] },
      { segments: [{ start: 0, end: 1, text: '' }] },
      { segments: [{ start: 0, end: 1, text: '一。' }, { start: 0.9, end: 1.2, text: '二。' }] },
    ]) assert.throws(() => normalizeSentences(payload, 1500));

    let requests = 0;
    const source = path.join(root, 'audio.mp3');
    await fsp.writeFile(source, 'audio-fixture');
    const fetchImpl = async (url, request) => {
      requests += 1;
      assert.equal(url, 'http://localhost:8000/v1/audio/transcriptions');
      assert.equal(request.body.get('model'), 'paraformer');
      assert.equal(request.body.get('response_format'), 'verbose_json');
      assert.equal(request.body.get('file').type, 'audio/wav');
      assert.equal(request.headers.Authorization, undefined, '本地无鉴权服务不应携带其他供应商凭据');
      return { ok: true, json: async () => ({ text: '回到故乡。', timing_source: 'funasr_sentence_info',
        sentence_info: [{ start: 100, end: 800, text: '回到故乡。' }] }) };
    };
    const execute = async (_file, args, opts) => {
      assert.equal(opts.windowsHide, true);
      assert.ok(args.includes('pcm_s16le'));
      await fsp.writeFile(args.at(-1), Buffer.alloc(100));
    };
    const result = await transcribeFunasrAudio(source, { baseUrl: 'http://localhost:8000/v1', modelId: 'paraformer' }, {
      durationMs: 1200, execute, fetchImpl, workDir: path.join(root, 'asr'),
    });
    assert.equal(requests, 1);
    assert.equal(result.timingSource, 'funasr_sentence_info');
    assert.equal(result.sentences[0].startMs, 100);
    assert.deepEqual(result.missingRanges, []);
    assert.ok(await fsp.readFile(path.join(root, 'asr/response-1.json'), 'utf8'));

    requests = 0;
    const segmented = await transcribeFunasrAudio(source, { baseUrl: 'http://localhost:8000/v1' }, {
      durationMs: 3500, maxRequestBytes: 40000, execute, workDir: path.join(root, 'segmented'),
      fetchImpl: async () => {
        requests += 1;
        return { ok: true, json: async () => ({ text: '片段。', segments: [{ start: 0.02, end: 0.1, text: '片段。' }] }) };
      },
    });
    assert.ok(requests > 1);
    assert.equal(segmented.sentences[1].startMs, Math.floor((40000 - 4096) / 32) + 20);
    assert.equal(segmented.timingSource, 'provider_segments');
    await assert.rejects(transcribeFunasrAudio(source, { baseUrl: 'http://localhost/v1' }, {
      durationMs: 1000, execute, workDir: path.join(root, 'failed'),
      fetchImpl: async () => ({ ok: false, status: 429 }),
    }), error => error.code === 'ASR_RATE_LIMITED');

    const srt = toSrt(cues);
    assert.match(srt, /00:00:02,120 --> 00:00:02,700/);
    assert.throws(() => validateChanges({ changes: [{ index: 1, type: 'other', text: '改变。', reason: '上下文', startMs: 0 }] }, cues));
    assert.throws(() => validateChanges({ changes: [{ index: 99, type: 'other', text: '新增。', reason: '无' }] }, cues));
    const correction = await proofreadTranscript(cues, { callModel: async request => {
      assert.equal(request.maxRetries, 0);
      assert.ok(request.messages[0].content.includes('不得增删字幕'));
      return { success: true, text: JSON.stringify({ changes: [{ index: 1, type: 'wrong-word', text: '回到家乡。', reason: '测试上下文' }] }) };
    } });
    assert.deepEqual(correction.sentences.map(({ index, startMs, endMs }) => [index, startMs, endMs]), cues.map(({ index, startMs, endMs }) => [index, startMs, endMs]));
    assert.equal(cues[0].text, '回到故乡。');
    assert.equal(correction.sentences[0].text, '回到家乡。');

    const configPath = path.join(root, 'ai-models.json');
    const builtinConfig = await aiModelConfig.getRuntimeConfig('asr', { configPath });
    assert.equal(builtinConfig.builtin, true);
    assert.equal(builtinConfig.apiKey, '');
    const builtinRuntime = await mediaPipeline.resolveAsrRuntime({ asrConfig: builtinConfig, env: {
      MIMO_API_KEY: 'unrelated-mimo-secret', ASR_API_KEY: 'unrelated-asr-secret',
      ASR_BASE_URL: 'https://example.invalid/v1', ASR_MODEL: 'cloud-model',
    } });
    assert.equal(builtinRuntime.configured, true);
    assert.equal(builtinRuntime.provider, 'funasr');
    assert.equal(builtinRuntime.modelId, 'paraformer');
    assert.equal(builtinRuntime.baseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal(builtinRuntime.apiKey, '');
    const localPaths = await mediaPipeline.resolveAsrRuntime({ asrConfig: {
      ...builtinConfig, pythonPath: 'local-python', modelCache: 'local-cache',
    }, env: {} });
    assert.equal(localPaths.pythonPath, 'local-python');
    assert.equal(localPaths.modelCache, 'local-cache');
    const environmentPaths = await mediaPipeline.resolveAsrRuntime({ asrConfig: builtinConfig,
      env: { FUNASR_PYTHON: 'override-python', MODELSCOPE_CACHE: 'override-cache' } });
    assert.equal(environmentPaths.pythonPath, 'override-python');
    assert.equal(environmentPaths.modelCache, 'override-cache');
    const explicitMimo = await mediaPipeline.resolveAsrRuntime({ asrConfig: builtinConfig, env: {
      ASR_PROVIDER: 'mimo', MIMO_API_KEY: 'explicit-mimo-secret',
    } });
    assert.equal(explicitMimo.provider, 'mimo');
    assert.equal(explicitMimo.modelId, 'mimo-v2.5-asr');
    assert.equal(explicitMimo.baseUrl, 'https://api.xiaomimimo.com/v1');
    const previousKey = process.env.MIMO_API_KEY;
    process.env.MIMO_API_KEY = 'unrelated-provider-secret';
    try {
      await aiModelConfig.saveConfig({ providers: { local: { name: '本地 FunASR', baseUrl: 'http://localhost:8000/v1',
        models: { asr: { enabled: true, modelId: 'paraformer', backend: 'funasr' } } } }, active: { asr: 'local/asr' } }, { configPath });
      const stored = await aiModelConfig.getPublicConfig({ configPath });
      assert.equal(stored.providers.local.models.asr.backend, 'funasr');
      const config = await aiModelConfig.getRuntimeConfig('asr', { configPath });
      assert.notEqual(config.apiKey, 'unrelated-provider-secret');
      const runtime = await mediaPipeline.resolveAsrRuntime({ asrConfig: { ...config, apiKey: '' }, env: {} });
      assert.equal(runtime.configured, true);
      assert.equal(runtime.provider, 'funasr');
      assert.equal(runtime.apiKey, '');
      const overridden = await mediaPipeline.resolveAsrRuntime({
        env: { ASR_PROVIDER: 'funasr', FUNASR_BASE_URL: 'http://localhost:8000/v1' },
        asrConfig: { enabled: true, backend: 'mimo', provider: 'mimo', modelId: 'mimo-asr', apiKey: 'unrelated-provider-secret', baseUrl: 'https://example.invalid/v1' },
      });
      assert.equal(overridden.apiKey, '');
      assert.equal(overridden.modelId, 'paraformer');
      assert.equal(overridden.baseUrl, 'http://localhost:8000/v1');
    } finally {
      if (previousKey === undefined) delete process.env.MIMO_API_KEY; else process.env.MIMO_API_KEY = previousKey;
    }
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

run().then(() => console.log('FunASR 适配、时间轴、校订及配置测试通过。')).catch(error => { console.error(error); process.exitCode = 1; });
