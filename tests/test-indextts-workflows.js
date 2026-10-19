const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { fixture } = require('./test-illustrated-narration');
const { wav } = require('./test-illustrated-media');
const { aligned } = require('./test-indextts');
const { validateAlignment } = require('../server/services/ai/indexTts');
const { buildNarrationReview } = require('../server/services/ai/narrationReview');
const workflow = require('../server/services/creative/illustrated/workflows');
const whiteStore = require('../server/services/creative/whiteboard/mediaStore');
const { narrationStage } = require('../server/services/creative/whiteboard/productionStages');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const audio = wav(5000);
const evidence = text => validateAlignment(aligned(text), text, 5000, digest(audio));

async function illustrated() {
  await fixture(async ctx => {
    ctx.current.tts = { enabled: true, provider: 'indextts', modelId: 'IndexTTS-2.5', baseUrl: 'local://indextts',
      configured: true, localIndexTts: { referenceSha256: 'fixture' }, alignmentConfig: { provider: 'firered' } };
    ctx.options.services.aiTtsModel.resolveTtsRuntime = async ({ ttsConfig }) => ttsConfig;
    let recovered = 0;
    ctx.options.services.aiTtsModel.callTtsModel = async request => {
      ctx.counters.tts++;
      return ctx.counters.tts === 1
        ? { success: false, code: 'ASR_UNAVAILABLE', model: { provider: 'indextts' }, message: '本地对齐失败', audioBuffer: audio, format: 'wav' }
        : { success: true, audioBuffer: audio, format: 'wav', alignedSubtitles: evidence(request.text) };
    };
    ctx.options.services.alignIndexTtsAudio = async (file, duration, text) => { recovered++; assert.equal(duration, 5000); return evidence(text); };
    const id = await ctx.create({ narrationMode: 'enabled' });
    await workflow.run(id, ctx.options); await ctx.act(id, 'approve_plan'); await ctx.act(id, 'prepare_narration');
    assert.equal((await workflow.run(id, ctx.options)).status, 'failed');
    assert.equal(ctx.counters.tts, 1);
    await ctx.act(id, 'prepare_narration');
    const result = await workflow.run(id, ctx.options);
    assert.equal(result.current_stage, 'audio_review', result.message);
    assert.equal(result.illustrated.narration.timing.timingKind, 'asr_words');
    assert.equal(ctx.counters.tts, 3); assert.equal(recovered, 1);
    await ctx.act(id, 'prepare_narration'); await workflow.run(id, ctx.options);
    assert.equal(ctx.counters.tts, 3); assert.equal(recovered, 1);
    console.log('PASS 旁白配图使用 IndexTTS 后处理字幕、失败后复用原音频、成功缓存恢复');
  });
}

async function whiteboard() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'indextts-whiteboard-'));
  const workflowId = '20261019000000000001';
  const media = whiteStore.makeMedia('fixture-plan', {}); media.voiceService = { contractHash: 'fixture-voice' };
  const record = { workflow_id: workflowId, whiteboard: { media, mediaHistory: [] } };
  const artifact = { narrationText: '你好，世界。', narrationLanguage: 'zh-CN', aspectRatio: '16:9', durationMs: 5000,
    productionPlan: { narrationMode: 'enabled', burnSubtitles: true }, cues: [{ id: 'cue_1', text: '你好，世界。' }],
    scenes: [{ id: 'scene_1', title: '测试', cueIds: ['cue_1'] }] };
  let tts = 0, asr = 0;
  const ctx = { workflowId, rootDir, runtime: {}, processOptions: {},
    voice: { service: media.voiceService, runtime: { provider: 'indextts', alignmentConfig: {} } },
    tools: { normalizeAudio: async (input, output) => { await fs.copyFile(input, output); return { durationMs: 5000 }; },
      hashFile: async file => digest(await fs.readFile(file)) },
    services: { aiTtsModel: { callTtsModel: async () => { tts++; return { success: false, audioBuffer: audio, code: 'ASR_UNAVAILABLE', message: '本地对齐失败',
      narrationReview: buildNarrationReview(aligned('你好地球'), artifact.narrationText, 5000, digest(audio)) }; } },
      alignIndexTtsAudio: async () => { asr++; return evidence(artifact.narrationText); } },
    read: async () => record, change: async callback => ({ result: await callback(record, new Date().toISOString()) }),
    requesting: async () => {}, filePath: async (_, descriptor) => (await whiteStore.mediaFile(record, descriptor, rootDir)).path,
    attempt: async (stage, sceneId, external, inputIdentity) => {
      const item = { id: crypto.randomUUID(), stage, inputIdentity }; media.attempts.push(item);
      await fs.mkdir(whiteStore.workDirectory(workflowId, item.id, rootDir), { recursive: true }); return item;
    },
    jsonFile: async (item, name, value) => { const file = path.join(whiteStore.workDirectory(workflowId, item.id, rootDir), name); await fs.writeFile(file, JSON.stringify(value)); return file; },
    publish: async (item, files) => {
      const result = {};
      for (const [key, file] of Object.entries(files)) result[key] = await whiteStore.publishFile(record, item, file.path, { ...file, rootDir });
      item.received = { ...item.received, ...result }; return { result };
    },
  };
  try {
    await assert.rejects(narrationStage(ctx, artifact), /本地对齐失败/);
    assert.ok(media.attempts[0].received.raw); assert.equal(tts, 1);
    assert.ok(media.attempts[0].received.review);
    assert.equal((await whiteStore.readData(record, media.attempts[0].received.review, rootDir)).status, 'unverified');
    await narrationStage(ctx, artifact);
    assert.equal(tts, 1); assert.equal(asr, 1);
    const binding = media.current.full_narration;
    assert.equal(binding.timingKind, 'asr_words');
    await whiteStore.validateBinding(record, binding, rootDir);
    const timing = await whiteStore.readData(record, binding.timeline, rootDir);
    assert.equal(timing.sourceAudioSha256, digest(audio));
    console.log('PASS 白板对齐失败保存原音频、恢复不重复配音、真实时间线哈希绑定');
  } finally { await fs.rm(rootDir, { recursive: true, force: true }); }
}
async function run() { await illustrated(); await whiteboard(); }
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
