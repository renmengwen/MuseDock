const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { buildNarrationReview } = require('../server/services/ai/narrationReview');
const { acceptedEvidence } = require('../server/services/creative/whiteboard/narrationAcceptance');
const store = require('../server/services/creative/whiteboard/mediaStore');
const artifactStore = require('../server/services/creative/whiteboard/artifactStore');
const production = require('../server/services/creative/whiteboard/productionWorkflows');
const { buildNarrationTiming, buildDisplayCaptions } = require('../server/services/creative/whiteboard/narrationTiming');
const { wav } = require('./test-illustrated-media');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const text = '你好世界。';
const raw = { provider: 'firered', timingSource: 'firered_aed_ctc_forced_alignment', text: '你好世间',
  words: Array.from('你好世间', (text, i) => ({ text, startMs: 100 + i * 300, endMs: 300 + i * 300, confidence: .8 })) };

async function run() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'narration-acceptance-'));
  const audioBytes = wav(2000), audioSha256 = hash(audioBytes);
  const review = buildNarrationReview(raw, text, 2000, audioSha256);
  const reviewBefore = JSON.stringify(review);
  const now = new Date().toISOString();
  const approval = { actor: 'user', basis: 'user_review_narration_text_differences', acceptedAt: now,
    attemptId: crypto.randomUUID(), audioSha256, reviewSha256: 'b'.repeat(64), sourceTextSha256: hash(text) };
  const e = acceptedEvidence(review, text, approval);
  assert.equal(JSON.stringify(review), reviewBefore);
  assert.deepEqual(e.rawAsrWords, raw.words);
  assert.equal(e.words.map(w => w.text).join(''), '你好世界');
  assert.deepEqual(e.words.map(w => [w.startMs, w.endMs]), raw.words.map(w => [w.startMs, w.endMs]));
  assert.equal(e.textCorrections.length, 1);
  assert.throws(() => acceptedEvidence(review, text, { ...approval, actor: 'automation' }), /人工确认/);
  assert.throws(() => acceptedEvidence(review, '别的正文。', approval), /不匹配/);
  const missing = buildNarrationReview(raw, '你好世界间。', 2000, audioSha256);
  assert.throws(() => acceptedEvidence(missing, missing.sourceText, { ...approval, sourceTextSha256: missing.sourceTextSha256 }), /增字、漏字/);
  const reordered = structuredClone(review); reordered.words[1].startMs = 0;
  assert.throws(() => acceptedEvidence(reordered, text, approval), /重叠/);
  const artifact = { narrationText: text, narrationLanguage: 'zh-CN', aspectRatio: '16:9', productionPlan: { burnSubtitles: true },
    cues: [{ id: 'cue_1', text }], scenes: [{ id: 'scene_1', title: '测试', cueIds: ['cue_1'] }] };
  const timing = buildNarrationTiming(artifact, e, 2000);
  assert.equal(timing.evidenceKind, 'human_reviewed_asr_word_mapping');
  assert.equal(timing.humanAcceptance.actor, 'user'); assert.equal(timing.captions[0].endMs, 1200);
  assert.ok(buildDisplayCaptions(artifact, timing, 72, e).length);
  const forged = structuredClone(e); forged.words[0].endMs = 299;
  assert.throws(() => buildNarrationTiming(artifact, forged, 2000), /对应关系已变化/);

  const media = store.makeMedia('plan-fixture', {});
  const voiceConfig = { enabled: true, provider: 'minimax', modelId: 'speech-fixture', apiKey: 'fixture', baseUrl: 'http://fixture.invalid' };
  let normalized = 0;
  const services = { aiModelConfig: { getRuntimeConfig: async () => voiceConfig },
    whiteboardMediaTools: { preflight: async () => ({}), normalizeAudio: async (input, output) => {
      normalized++; await fs.copyFile(input, output); return { durationMs: 2000 }; }, hashFile: async file => hash(await fs.readFile(file)) } };
  media.voiceService = (await production.voiceSnapshot(services)).service;
  const record = { workflow_id: '20261019000000000012', status: 'failed', error: { code: 'NARRATION_TEXT_MISMATCH' },
    whiteboard: { current: { identity: 'plan-fixture' }, initialApproval: { identity: 'plan-fixture' },
      media, mediaHistory: [], messages: [], interactions: [] } };
  const attempt = { id: approval.attemptId, stage: 'full_narration', status: 'failed', errorCode: 'NARRATION_TEXT_MISMATCH', inputIdentity: 'same-input' };
  const directory = store.workDirectory(record.workflow_id, attempt.id, rootDir); await fs.mkdir(directory, { recursive: true });
  const audio = path.join(directory, 'provider-audio.bin'), report = path.join(directory, 'review.json');
  await fs.writeFile(audio, audioBytes); await fs.writeFile(report, JSON.stringify(review));
  media.attempts.push(attempt);
  attempt.received = { raw: await store.publishFile(record, attempt, audio, { kind: 'provider_audio', mime: 'application/octet-stream', rootDir }),
    review: await store.publishFile(record, attempt, report, { kind: 'narration_review', mime: 'application/json', rootDir }) };
  const payload = { action: 'accept_narration', confirmed: true, expectedMediaIdentity: store.mediaIdentity(media),
    narrationAttemptId: attempt.id, audioSha256, reviewSha256: attempt.received.review.sha256 };
  const originalRead = artifactStore.readArtifact;
  artifactStore.readArtifact = async () => artifact;
  try {
    assert.ok(production.actionsFor(record).some(a => a.id === 'accept_narration'));
    await assert.rejects(production.act(record, { ...payload, confirmed: false }, { rootDir, services }, now), /明确确认/);
    await assert.rejects(production.act(record, { ...payload, audioSha256: 'wrong' }, { rootDir, services }, now), /已变化/);
    await assert.rejects(production.act(record, { ...payload, expectedMediaIdentity: 'old' }, { rootDir, services }, now), /已变化/);
    assert.equal(normalized, 0);
    assert.equal(await production.act(record, payload, { rootDir, services }, now), true);
    assert.equal(record.status, 'queued'); assert.equal(media.stage, 'lineart_generation');
    assert.equal(normalized, 1); assert.equal(attempt.status, 'failed', '原始失败证据不能被改写成识别一致');
    const binding = media.current.full_narration;
    assert.equal(binding.humanAcceptance.actor, 'user'); assert.equal(binding.raw.sha256, audioSha256);
    assert.equal(media.approvals.at(-1).basis, 'user_review_narration_text_differences');
    await store.validateBinding(record, binding, rootDir);
    const persisted = await store.readData(record, binding.native, rootDir);
    assert.deepEqual(persisted.rawAsrWords, raw.words);
    assert.equal((await store.readData(record, attempt.received.review, rootDir)).status, 'unverified');
    assert(!production.actionsFor(record).some(a => a.id === 'accept_narration'));
    console.log('PASS 人工确认绑定、保留原始识别、原声学边界、篡改/增删/重叠拦截、字号重建、仅本地恢复并推进到线稿阶段');
  } finally { artifactStore.readArtifact = originalRead; await fs.rm(rootDir, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
