const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WhiteboardError, sha256 } = require('./contracts');
const { letters } = require('../shared/captionLayout');
const { buildNarrationReview } = require('../../ai/narrationReview');
const { validateAlignment } = require('../../ai/indexTts');
const store = require('./mediaStore');
const digest = text => crypto.createHash('sha256').update(text).digest('hex');

function reviewableAttempt(media) {
  const attempt = media?.attempts?.findLast(item => item.stage === 'full_narration');
  return media?.stage === 'full_narration' && !media.current.full_narration
    && attempt?.status === 'failed' && attempt.errorCode === 'NARRATION_TEXT_MISMATCH'
    && attempt.received?.raw && attempt.received?.review ? attempt : null;
}

function acceptedEvidence(review, text, acceptance) {
  const reject = message => { throw new WhiteboardError('NARRATION_ACCEPTANCE_INVALID', message, 409); };
  if (review.kind !== 'narration_review' || review.provider !== 'firered'
    || review.timingSource !== 'firered_aed_ctc_forced_alignment' || review.sourceText !== text
    || review.sourceTextSha256 !== digest(text) || !/^[a-f0-9]{64}$/.test(review.audioSha256 || '')
    || !Number.isInteger(review.durationMs) || review.durationMs <= 0 || !review.words?.length) reject('识别对照与当前正文或音频不匹配，请重新核对。');
  // 接受仅适用于中文逐字边界与等长单字替换；不为增删词、重复或英文词内改写编造时间点。
  if (review.words.some(word => !/^\p{Script=Han}$/u.test(word.text))) reject('此对照包含非中文逐字证据，不能直接沿用时间点，请重新对齐。');
  validateAlignment(review, review.words.map(word => word.text).join(''), review.durationMs, review.audioSha256);
  const comparison = buildNarrationReview(review, text, review.durationMs, review.audioSha256);
  const chars = letters(text);
  if (chars.length !== review.words.length || !comparison.comparisonAvailable || !comparison.differences.length
    || comparison.differences.some(item => !/^\p{Script=Han}$/u.test(item.expected) || !/^\p{Script=Han}$/u.test(item.recognized))) {
    reject('差异包含增字、漏字或连续替换，无法确认逐字对应；请保留音频并重新对齐或重新配音。');
  }
  if (acceptance?.actor !== 'user' || acceptance.basis !== 'user_review_narration_text_differences'
    || acceptance.audioSha256 !== review.audioSha256 || acceptance.sourceTextSha256 !== review.sourceTextSha256
    || !acceptance.attemptId || !acceptance.reviewSha256 || !Number.isFinite(Date.parse(acceptance.acceptedAt))) reject('缺少绑定本次音频与正文的人工确认。');
  const corrections = [];
  const words = review.words.map((word, index) => {
    if (chars[index] !== word.text) corrections.push({ wordIndex: index, recognized: word.text, acceptedText: chars[index],
      startMs: word.startMs, endMs: word.endMs, basis: 'user_accepted_script_spelling' });
    return { ...word, text: chars[index] };
  });
  const result = validateAlignment({ ...review, words }, text, review.durationMs, review.audioSha256);
  return { ...result, rawAsrWords: structuredClone(review.words), textCorrections: corrections,
    humanAudioReview: 'accepted', humanAcceptance: acceptance,
    evidenceKind: 'human_reviewed_asr_word_mapping',
    confidenceBasis: 'original_asr_words_not_recomputed_for_corrected_text' };
}

async function acceptNarration(record, artifact, payload, options, now) {
  const media = record.whiteboard.media, attempt = reviewableAttempt(media);
  if (payload.confirmed !== true) throw new WhiteboardError('APPROVAL_REQUIRED', '请试听当前音频并明确确认接受本次文字差异。', 409);
  if (!attempt || payload.narrationAttemptId !== attempt.id || payload.audioSha256 !== attempt.received.raw.sha256
    || payload.reviewSha256 !== attempt.received.review.sha256) throw new WhiteboardError('STALE_IDENTITY', '试听的音频或对照已变化，请重新打开试听入口。', 409);
  const review = await store.readData(record, attempt.received.review, options.rootDir);
  const raw = await store.mediaFile(record, attempt.received.raw, options.rootDir);
  if (review.audioSha256 !== raw.artifact.sha256) throw new WhiteboardError('ARTIFACT_INVALID', '识别对照与音频哈希不匹配。', 409);
  const acceptance = { actor: 'user', basis: 'user_review_narration_text_differences', acceptedAt: now,
    attemptId: attempt.id, audioSha256: raw.artifact.sha256, reviewSha256: attempt.received.review.sha256,
    sourceTextSha256: digest(artifact.narrationText), planIdentity: media.planIdentity };
  const evidence = acceptedEvidence(review, artifact.narrationText, acceptance);
  const tools = options.services?.whiteboardMediaTools || require('./mediaTools');
  const runtime = await tools.preflight({ ...options.mediaOptions, aspectRatio: artifact.aspectRatio, visualStyle: artifact.visualStyle });
  const item = { id: crypto.randomUUID(), stage: 'full_narration', inputIdentity: attempt.inputIdentity, external: false,
    status: 'validated', createdAt: now, completedAt: now, acceptedFromAttemptId: attempt.id };
  const directory = store.workDirectory(record.workflow_id, item.id, options.rootDir);
  await fs.mkdir(directory, { recursive: true });
  const audioPath = path.join(directory, 'narration.wav');
  const audioInfo = await tools.normalizeAudio(raw.path, audioPath, runtime, options.mediaOptions);
  if (Math.abs(review.durationMs - audioInfo.durationMs) > 120) throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '音频实际时长与识别对照不一致。');
  const { buildNarrationTiming, CAPTION_LAYOUT_VERSION, srtText } = require('./narrationTiming');
  const timing = buildNarrationTiming(artifact, evidence, audioInfo.durationMs);
  timing.audioSha256 = await tools.hashFile(audioPath);
  const publish = async (name, body, kind, label, mime) => {
    const file = path.join(directory, name);
    await fs.writeFile(file, body, { flag: 'wx' });
    return store.publishFile(record, item, file, { kind, name: label, mime, rootDir: options.rootDir });
  };
  const native = await publish('reviewed-alignment.json', JSON.stringify(evidence, null, 2), 'provider_subtitles', '人工确认的声学对照（保留原始识别）', 'application/json');
  timing.nativeSubtitlesSha256 = native.sha256;
  const audio = await store.publishFile(record, item, audioPath, { kind: 'narration', name: '人工试听确认的完整旁白', mime: 'audio/wav', rootDir: options.rootDir });
  const timeline = await publish('timeline.json', JSON.stringify(timing, null, 2), 'timeline', '人工确认的真实时间线', 'application/json');
  const subtitles = await publish('narration.srt', srtText(timing.captions), 'subtitles', '按原文校订的字幕', 'application/x-subrip');
  item.received = { raw: attempt.received.raw, review: attempt.received.review, native, audio, timeline, subtitles };
  media.attempts.push(item);
  media.current.full_narration = store.bind({ kind: 'full_narration', inputIdentity: item.inputIdentity,
    captionLayoutVersion: CAPTION_LAYOUT_VERSION, audio, native, timeline, subtitles, raw: attempt.received.raw,
    review: attempt.received.review, humanAcceptance: acceptance, durationMs: timing.durationMs, audioInfo,
    timingKind: timing.timingKind, sourceTextSha256: timing.sourceTextSha256, language: artifact.narrationLanguage });
  (media.narrationAcceptances ||= []).push({ ...acceptance, identity: media.current.full_narration.identity });
  media.activeAttemptId = ''; media.gate = 'full_narration';
  return media.current.full_narration;
}
module.exports = { reviewableAttempt, acceptedEvidence, acceptNarration };
