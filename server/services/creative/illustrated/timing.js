const { hash, ErrorType, readingBudget, subtitleStyleFor, FPS } = require('./contracts');
const { CAPTION_LAYOUT_VERSION, letters, splitCaption } = require('../shared/captionLayout');
const { buildNarrationTiming } = require('../whiteboard/narrationTiming');

function chunkText(scene, language = 'zh-CN', voice = {}) {
  // 一次请求最多约 80 秒的正文；长自然段按句子/词边界分段，稳定身份与整篇修订无关。
  const rate = voice.provider === 'doubao' ? Math.max(0.5, 1 + Number(voice.doubao?.speechRate || 0) / 100) : 1;
  const limit = language === 'zh-CN' ? Math.min(260, Math.floor(280 * rate)) : Math.min(850, Math.floor(1200 * rate));
  const words = Array.from(new Intl.Segmenter(language, { granularity: 'word' }).segment(scene.text), item => item.segment);
  const chunks = [];
  let pending = '';
  for (const word of words) {
    if (pending && pending.length + word.length > limit) { chunks.push(pending); pending = ''; }
    if (word.length > limit) {
      if (pending) { chunks.push(pending); pending = ''; }
      const chars = Array.from(word);
      while (chars.length) chunks.push(chars.splice(0, limit).join(''));
    } else pending += word;
  }
  if (pending) chunks.push(pending);
  return chunks.map((text, index) => ({ id: scene.id + '_part_' + hash(text).slice(0, 20) + '_' + index, sceneId: scene.id, text }));
}
function audioSegmentIdentity(chunk, settings, model) {
  return hash({ text: chunk.text, language: settings.narrationLanguage, model: model?.hash, version: 1 });
}
function nativeSegmentTiming(chunk, evidence, durationMs, settings) {
  const artifact = { narrationText: chunk.text, narrationLanguage: settings.narrationLanguage, aspectRatio: settings.aspectRatio,
    cues: [{ id: chunk.id, text: chunk.text }], scenes: [{ id: chunk.sceneId, title: '', cueIds: [chunk.id] }] };
  // 原生证据由共享校验器检查文本和真实时间，不把计划时间误称为语音证据。
  return buildNarrationTiming(artifact, evidence, durationMs, { fontSize: subtitleStyleFor(settings, settings.aspectRatio).fontSize, minSceneDurationMs: 1 });
}
function asrSegmentTiming(chunk, evidence, durationMs, settings) {
  const sentences = evidence.sentences;
  if (!Array.isArray(sentences) || !sentences.length || letters(sentences.map(item => item.text).join('')).join('') !== letters(chunk.text).join('')) {
    throw new ErrorType('NARRATION_TEXT_MISMATCH', '转写结果与已确认正文不一致，音频已保留；请检查读音或转写证据。', 409);
  }
  let previous = 0;
  const cues = sentences.map((sentence, index) => {
    if (!Number.isInteger(sentence.startMs) || !Number.isInteger(sentence.endMs) || sentence.startMs < previous
      || sentence.endMs <= sentence.startMs || sentence.endMs > durationMs + 100) throw new ErrorType('NARRATION_EVIDENCE_INVALID', '转写时间点无效，不能作为当前字幕。');
    previous = Math.min(durationMs, sentence.endMs);
    return { id: chunk.id + '_asr_' + index, text: sentence.text, startMs: sentence.startMs, endMs: previous };
  });
  return { timingKind: 'asr_sentences', provider: 'funasr', durationMs, cues, captions: displayFromCues(cues, settings),
    evidenceKind: 'sentence_timestamps_with_display_allocation' };
}
function displayFromCues(cues, settings, planned = false) {
  const fontSize = subtitleStyleFor(settings, settings.aspectRatio).fontSize;
  return cues.flatMap(cue => {
    const parts = splitCaption(cue.text, settings.narrationLanguage, settings.aspectRatio, fontSize).filter(part => letters(part).length);
    const weights = parts.map(part => Math.max(1, letters(part).length));
    const minimums = parts.map((part, index) => planned && settings.burnSubtitles
      ? Math.max(500, Math.ceil(weights[index] * 1000 / (settings.narrationLanguage === 'zh-CN' ? 10 : 20))) : 1);
    const remainder = cue.endMs - cue.startMs - minimums.reduce((a, b) => a + b, 0);
    if (remainder < 0) throw new ErrorType('READING_BUDGET', '当前字幕显示过快，请增加目标时长、减少正文或使用更小字号。');
    const weight = weights.reduce((a, b) => a + b, 0);
    let consumed = 0;
    let reserved = 0;
    return parts.map((part, index) => {
      const startMs = cue.startMs + reserved + Math.round(remainder * consumed / weight);
      consumed += weights[index]; reserved += minimums[index];
      return { id: cue.id + '_' + index, sourceCueId: cue.id, text: part.replace(/\s+/gu, ' ').trim(), startMs,
        endMs: cue.startMs + reserved + Math.round(remainder * consumed / weight) };
    });
  });
}
function plannedTiming(plan, settings) {
  const durationMs = settings.targetDurationSeconds * 1000;
  const minimums = plan.scenes.map(scene => Math.max(1000, settings.burnSubtitles ? readingBudget(scene, settings) : 1000));
  const remainder = durationMs - minimums.reduce((a, b) => a + b, 0);
  if (remainder < 0) throw new ErrorType('READING_BUDGET', '目标时长不足以阅读完整字幕，请增加时长或减少正文后确认。');
  const weights = plan.scenes.map(scene => letters(scene.text).length * scene.weight);
  const total = weights.reduce((a, b) => a + b, 0);
  let weight = 0;
  let reserved = 0;
  const cues = plan.scenes.map((scene, index) => {
    const startMs = reserved + Math.round(remainder * weight / total);
    weight += weights[index]; reserved += minimums[index];
    return { id: scene.id, text: scene.text, startMs, endMs: reserved + Math.round(remainder * weight / total) };
  });
  const timing = { timingKind: 'planned', provider: 'disabled', durationMs, cues,
    scenes: cues.map(cue => ({ id: cue.id, startMs: cue.startMs, endMs: cue.endMs })) };
  timing.identity = hash(timing);
  return timing;
}
function assembleTiming(plan, segments) {
  let offset = 0;
  const cues = [];
  const sceneRanges = new Map();
  for (const segment of segments) {
    if (!sceneRanges.has(segment.sceneId)) sceneRanges.set(segment.sceneId, { id: segment.sceneId, startMs: offset, endMs: offset });
    cues.push(...segment.timing.cues.map(cue => ({ ...cue, id: segment.id + ':' + cue.id, startMs: cue.startMs + offset, endMs: cue.endMs + offset })));
    offset += segment.durationMs;
    sceneRanges.get(segment.sceneId).endMs = offset;
  }
  const timing = { timingKind: segments.every(item => item.timing.timingKind === 'provider_native_words') ? 'provider_native_words' : 'asr_sentences',
    provider: segments[0]?.timing.provider, durationMs: offset, cues, scenes: plan.scenes.map(scene => sceneRanges.get(scene.id)),
    segmentIdentities: segments.map(item => item.identity) };
  if (timing.scenes.some(scene => !scene || scene.endMs - scene.startMs < 1000 / FPS)) throw new ErrorType('TIMELINE_INVALID', '部分分镜不足一帧，请合并短句后重新确认。');
  timing.identity = hash(timing);
  return timing;
}
function quantizedScenes(timing) {
  return timing.scenes.map((scene, index) => {
    const startFrame = Math.round(scene.startMs * FPS / 1000);
    const endFrame = index === timing.scenes.length - 1 ? Math.ceil(timing.durationMs * FPS / 1000) : Math.round(scene.endMs * FPS / 1000);
    return { ...scene, startFrame, endFrame, frameCount: endFrame - startFrame, startMs: startFrame * 1000 / FPS, endMs: endFrame * 1000 / FPS };
  });
}
async function displayCaptions(state, readEvidence) {
  const timing = state.narration.timing;
  if (timing.timingKind !== 'provider_native_words') return displayFromCues(timing.cues, state.settings, timing.timingKind === 'planned');
  const result = [];
  let offset = 0;
  for (const segment of state.narration.segments) {
    const evidence = await readEvidence(segment.evidenceId);
    const part = nativeSegmentTiming(segment, evidence, segment.durationMs, state.settings);
    result.push(...part.captions.map(cue => ({ ...cue, startMs: cue.startMs + offset, endMs: cue.endMs + offset })));
    offset += segment.durationMs;
  }
  return result;
}

module.exports = { CAPTION_LAYOUT_VERSION, chunkText, audioSegmentIdentity, nativeSegmentTiming, asrSegmentTiming,
  displayFromCues, plannedTiming, assembleTiming, quantizedScenes, displayCaptions };
