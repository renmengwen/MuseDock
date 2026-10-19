const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const configService = require('../server/services/ai/aiModelConfig');
const { resolveTtsRuntime, callTtsModel } = require('../server/services/ai/aiTtsModel');
const { validateAlignment } = require('../server/services/ai/indexTts');
const { buildNarrationTiming, buildDisplayCaptions } = require('../server/services/creative/whiteboard/narrationTiming');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const source = '你好，世界。';
function aligned(text = source) {
  const chars = Array.from(text.replace(/[^\p{L}\p{N}]/gu, ''));
  return { provider: 'firered', timingSource: 'firered_aed_ctc_forced_alignment',
    words: chars.map((text, index) => ({ text, startMs: index * 200 + 100, endMs: index * 200 + 260, confidence: .9 })) };
}
async function run() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'indextts-contract-'));
  const configPath = path.join(directory, 'config.json');
  const referenceAudio = path.join(directory, 'reference.wav'), pythonPath = path.join(directory, 'python');
  await fs.mkdir(path.join(directory, 'repo/checkpoints'), { recursive: true });
  await fs.writeFile(path.join(directory, 'repo/checkpoints/config.yaml'), 'fixture');
  await fs.writeFile(referenceAudio, 'reference'); await fs.writeFile(pythonPath, 'fixture');
  try {
    const saved = await configService.saveConfig({ providers: {}, localIndexTts: { rootPath: directory, referenceAudio, pythonPath } }, { configPath });
    assert.equal(saved.active.tts, 'builtin/indextts');
    assert.equal(saved.localIndexTts.durationFactor, 1.25); assert.equal(saved.localIndexTts.maxTextTokens, 120);
    await configService.saveConfig({ providers: {}, localIndexTts: { threads: 3 } }, { configPath });
    const ttsConfig = await configService.getRuntimeConfig('tts', { configPath });
    assert.equal(ttsConfig.localIndexTts.referenceAudio, referenceAudio);
    const runtime = await resolveTtsRuntime({ ttsConfig, env: { MIMO_API_KEY: 'irrelevant', MINIMAX_TTS_MODEL: 'speech-irrelevant' } });
    assert.equal(runtime.provider, 'indextts'); assert.equal(runtime.apiKey, ''); assert.equal(runtime.configured, true);
    assert.equal(runtime.localIndexTts.threads, 3);
    let synthesis = 0, asr = 0, fail = true;
    const audio = Buffer.from('fixture-wave');
    const options = { ttsConfig, env: {}, text: source, language: 'zh-CN', indexTtsCacheDir: path.join(directory, 'cache'),
      ensureLocalAsrService: async () => {},
      runIndexTtsWorker: async request => {
        synthesis++;
        await fs.writeFile(request.output, audio);
        await fs.writeFile(request.receipt, JSON.stringify({ audioSha256: hash(audio), durationMs: 1500, requestIdentity: request.identity }));
      },
      transcribeLocalAsrAudio: async () => { asr++; if (fail) throw Object.assign(new Error('本地识别暂不可用'), { code: 'ASR_UNAVAILABLE' }); return aligned(); },
    };
    const failed = await callTtsModel(options);
    assert.equal(failed.success, false); assert.deepEqual(failed.audioBuffer, audio);
    fail = false;
    const result = await callTtsModel(options);
    assert.equal(result.success, true, result.message); assert.equal(synthesis, 1); assert.equal(asr, 2);
    assert.equal(result.nativeSubtitles, undefined); assert.equal(result.alignedSubtitles.ttsNativeSubtitles, false);
    assert.equal(result.alignedSubtitles.audioSha256, hash(audio));
    assert.equal((await callTtsModel(options)).success, true); assert.equal(synthesis, 1); assert.equal(asr, 2);
    const entry = (await fs.readdir(options.indexTtsCacheDir))[0];
    const cachedDir = path.join(options.indexTtsCacheDir, entry);
    const alignmentFile = (await fs.readdir(cachedDir)).find(name => /^alignment-.*\.json$/.test(name));
    await fs.writeFile(path.join(cachedDir, alignmentFile), '{');
    assert.equal((await callTtsModel(options)).success, true); assert.equal(synthesis, 1); assert.equal(asr, 3);
    assert.ok((await fs.readdir(cachedDir)).some(name => name.includes('.invalid-')));
    assert.equal((await callTtsModel({ ...options, localTake: 'new-take' })).success, true); assert.equal(synthesis, 2);
    const relative = await resolveTtsRuntime({ ttsConfig: { ...ttsConfig, localIndexTts: { ...ttsConfig.localIndexTts,
      rootPath: path.relative(process.cwd(), directory), referenceAudio: path.relative(process.cwd(), referenceAudio) } }, env: {} });
    assert.equal(relative.localIndexTts.rootPath, directory); assert.equal(relative.localIndexTts.referenceAudio, referenceAudio);
    const aborted = await callTtsModel({ ...options, signal: AbortSignal.abort() });
    assert.equal(aborted.code, 'INDEXTTS_CANCELLED'); assert.equal(synthesis, 2);
    const before = runtime.localIndexTts.referenceSha256;
    await fs.writeFile(referenceAudio, 'changed reference');
    assert.notEqual((await resolveTtsRuntime({ ttsConfig, env: {} })).localIndexTts.referenceSha256, before);
    console.log('PASS 默认配置、云环境隔离、声音身份、音频缓存、对齐失败恢复与显式新配音');

    assert.throws(() => validateAlignment(aligned('你好地球'), source, 1500, hash(audio)), /不一致/);
    const overlapping = aligned(); overlapping.words[1].startMs = 100;
    assert.throws(() => validateAlignment(overlapping, source, 1500, hash(audio)), /重叠/);
    assert.throws(() => validateAlignment({ ...aligned(), timingSource: 'estimated' }, source, 1500, hash(audio)), /独立识别/);
    const artifact = { narrationText: source, narrationLanguage: 'zh-CN', aspectRatio: '16:9', productionPlan: { burnSubtitles: true },
      cues: [{ id: 'cue_1', text: source }], scenes: [{ id: 'scene_1', cueIds: ['cue_1'] }] };
    const timing = buildNarrationTiming(artifact, result.alignedSubtitles, 1500);
    assert.equal(timing.timingKind, 'asr_words'); assert.equal(timing.sourceAudioSha256, hash(audio));
    assert.ok(buildDisplayCaptions(artifact, timing, 72, result.alignedSubtitles).length);
    assert.equal(timing.captions[0].startMs, 100); assert.equal(timing.captions.at(-1).endMs, 860);
    const english = { ...aligned(), words: [{ text: 'extraordinarily', startMs: 100, endMs: 1000, confidence: .8 }] };
    const words = validateAlignment(english, 'extraordinarily', 1500, hash(audio));
    const engArtifact = { ...artifact, narrationText: 'extraordinarily', narrationLanguage: 'en-US',
      aspectRatio: '9:16', cues: [{ id: 'cue_1', text: 'extraordinarily' }] };
    const englishTiming = buildNarrationTiming(engArtifact, words, 1500, { fontSize: 96 });
    assert.equal(englishTiming.captions.length, 1); assert.equal(englishTiming.captions[0].endMs, 1000);
    console.log('PASS 声学来源、文本一致性、时间范围、白板字幕改字号、英文整词边界');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run, aligned };
