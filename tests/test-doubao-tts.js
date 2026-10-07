const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const config = require('../server/services/ai/aiModelConfig');
const { callTtsModel } = require('../server/services/ai/aiTtsModel');
const { createTextPrompt, nativeSubtitleEvidence } = require('../server/services/ai/doubaoTts');
const { runWithApiCallContext, flushApiCallRecords } = require('../server/services/diagnostics/apiCallRecorder');

function wav() {
  const bytes = Buffer.alloc(2444);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40); return bytes;
}
const runtime = { enabled: true, provider: 'doubao', apiKey: 'fixture-secret-only', baseUrl: 'https://openspeech.bytedance.com',
  modelId: 'seed-audio-1.0', ttsQueueIntervalMs: 0, doubao: { voiceDirection: '声音温暖自然。', speechRate: 8, loudnessRate: -2, pitchRate: 1 } };
const payload = () => ({ audio: wav().toString('base64'), duration: 1, original_duration: 1,
  subtitle: { text: '你好。', sentences: [{ text: '你好。', start_time: 0, end_time: 1000,
    words: [{ text: '你', start_time: 10, end_time: 400 }, { text: '好', start_time: 390, end_time: 950 }, { text: '。', start_time: 950, end_time: 950 }] }] } });

(async () => {
  // 英文词间空格和零时长标点必须保留，不能误判为缺失词条。
  const mixed = payload();
  mixed.subtitle.text = mixed.subtitle.sentences[0].text = 'MySQL 与 PostgreSQL。';
  mixed.subtitle.sentences[0].words = [
    { text: 'MySQL', start_time: 10, end_time: 300 },
    { text: ' ', start_time: 300, end_time: 300 },
    { text: '与', start_time: 300, end_time: 400 },
    { text: '\t ', start_time: 400, end_time: 420 },
    { text: 'PostgreSQL', start_time: 420, end_time: 950 },
    { text: '。', start_time: 950, end_time: 950 },
  ];
  assert.deepEqual(nativeSubtitleEvidence(mixed, 'fixture').subtitle, mixed.subtitle);
  const invalidWord = (patch, code) => {
    const bad = structuredClone(mixed);
    Object.assign(bad.subtitle.sentences[0].words[1], patch);
    assert.throws(() => nativeSubtitleEvidence(bad, 'fixture'), error => error.evidenceCode === code);
  };
  invalidWord({ text: '' }, 'invalid_word');
  invalidWord({ text: null }, 'invalid_word');
  invalidWord({ start_time: -1 }, 'invalid_word_timing');
  invalidWord({ start_time: 301 }, 'invalid_word_timing');
  invalidWord({ end_time: 1200 }, 'invalid_word_timing');
  invalidWord({ start_time: 1.5 }, 'invalid_word_timing');
  invalidWord({ text: '字' }, 'invalid_word_timing');
  invalidWord({ text: '错', end_time: 350 }, 'sentence_words_text_mismatch');
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://openspeech.bytedance.com/api/v3/tts/create');
    assert.equal(init.headers['X-Api-Key'], runtime.apiKey);
    assert.ok(init.headers['X-Api-Request-Id']);
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body).sort(), ['audio_config', 'model', 'text_prompt']);
    assert.equal(body.audio_config.enable_subtitle, true);
    assert.equal(body.audio_config.speech_rate, 8);
    assert.equal(body.audio_config.loudness_rate, -2);
    assert.equal(body.audio_config.pitch_rate, 1);
    assert.ok(body.text_prompt.includes('「你好。」'));
    assert.ok(!Object.hasOwn(body, 'references'));
    return { ok: true, status: 200, json: async () => payload() };
  };
  const result = await callTtsModel({ text: '你好。', ttsConfig: runtime, env: {}, fetchImpl });
  assert.equal(result.success, true); assert.equal(calls, 1);
  assert.equal(result.nativeSubtitles.provider, 'doubao');
  assert.equal(result.voice, 'text-prompt-authored');
  assert.ok(!JSON.stringify(result).includes(runtime.apiKey));
  assert.throws(() => createTextPrompt({ text: '甲'.repeat(3000) }), /3000/);
  const tooLong = await callTtsModel({ text: '甲'.repeat(3000), ttsConfig: runtime, env: {}, fetchImpl });
  assert.equal(tooLong.code, 'TTS_INPUT_INVALID'); assert.equal(calls, 1);
  const incomplete = await callTtsModel({ text: '你好。', ttsConfig: runtime, env: {}, maxRetries: 10,
    fetchImpl: async () => { calls += 1; return { ok: true, json: async () => ({ ...payload(), subtitle: null }) }; } });
  assert.equal(incomplete.status, 'unknown_external_outcome'); assert.ok(incomplete.audioBuffer); assert.equal(calls, 2);
  assert.equal(incomplete.evidenceCode, 'missing_subtitle');
  assert.match(incomplete.message, /校验原因：missing_subtitle/);
  const timeout = await callTtsModel({ text: '你好。', ttsConfig: runtime, env: {}, maxRetries: 10,
    fetchImpl: async () => { calls += 1; throw new Error('fixture network failure'); } });
  assert.equal(timeout.status, 'unknown_external_outcome'); assert.equal(calls, 3);
  const rejected = await callTtsModel({ text: '你好。', ttsConfig: runtime, env: {}, fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.equal(rejected.code, 'TTS_HTTP_401');
  const records = new Map();
  const diagnosticStore = {
    start: record => { const id = String(records.size + 1); records.set(id, { ...record }); return id; },
    update: (id, patch) => Object.assign(records.get(id), patch),
  };
  const invalid = await runWithApiCallContext({ store: diagnosticStore }, () => callTtsModel({
    text: '你好。', ttsConfig: runtime, env: {},
    fetchImpl: async () => new Response(JSON.stringify({ ...payload(), subtitle: null }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }),
  }));
  await flushApiCallRecords();
  assert.equal(invalid.evidenceCode, 'missing_subtitle');
  assert.deepEqual(JSON.parse(records.get('1').validation_json), ['原生字幕校验失败：missing_subtitle']);
  assert.ok(!JSON.stringify([...records.values()]).includes(runtime.apiKey));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-doubao-'));
  try {
    const configPath = path.join(directory, 'models.json');
    const saved = await config.saveConfig({ providers: { doubao: { name: '豆包语音', apiKey: runtime.apiKey, baseUrl: runtime.baseUrl,
      models: { tts: { enabled: true, modelId: runtime.modelId, doubao: runtime.doubao } } } }, active: { tts: 'doubao/tts' } }, { configPath });
    assert.deepEqual(saved.providers.doubao.models.tts.doubao, runtime.doubao);
    assert.equal(saved.providers.doubao.hasApiKey, true); assert.equal(saved.providers.doubao.apiKey, undefined);
    assert.equal((await config.getRuntimeConfig('tts', { configPath })).apiKey, runtime.apiKey);
    await config.saveConfig(saved, { configPath });
    assert.equal((await config.getRuntimeConfig('tts', { configPath })).apiKey, runtime.apiKey);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
  console.log('豆包语音：请求合同、配置往返、原生字幕、长输入预检和未知结果不重试通过（无真实请求）。');
})().catch(error => { console.error(error); process.exitCode = 1; });
