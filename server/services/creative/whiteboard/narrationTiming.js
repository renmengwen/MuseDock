const { WhiteboardError, sha256, subtitleStyleFor } = require('./contracts');

const { CAPTION_LAYOUT_VERSION, letters, splitCaption, srtText } = require('../shared/captionLayout');
const { OPENING_CUE_ID, narrationCues, hasQuestionOpening, IMAGE_OPENING_DURATION_MS } = require('../shared/videoOpening');

function prependImageOpening(timing, opening) {
  const offset = IMAGE_OPENING_DURATION_MS;
  const shift = item => ({ ...item, startMs: item.startMs + offset, endMs: item.endMs + offset });
  return { ...timing, audioDurationMs: timing.durationMs, audioOffsetMs: offset, durationMs: timing.durationMs + offset,
    opening: { ...opening, startMs: 0, endMs: offset },
    cues: timing.cues.map(shift), captions: timing.captions.map(shift), scenes: timing.scenes.map(shift) };
}

function captionText(text) { return text.replace(/\s+/gu, ' ').trim(); }

function wordCharacters(evidence, durationMs) {
  const aligned = evidence.kind === 'post_asr_sentence_timestamps';
  if (aligned && (evidence.ttsNativeSubtitles !== false || evidence.timingSource !== 'firered_aed_ctc_forced_alignment'
    || evidence.provider !== 'firered' || !/^[a-f0-9]{64}$/.test(evidence.audioSha256 || ''))) {
    throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '后处理字幕缺少真实声学对齐来源或音频绑定。');
  }
  const words = evidence.provider === 'doubao' ? evidence.subtitle?.sentences?.flatMap(sentence => sentence.words || []) : evidence.words;
  if (!Array.isArray(words) || !words.length) throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '完整旁白缺少同请求字级时间戳。');
  const result = [];
  let previousEnd = 0;
  for (const word of words) {
    const chars = letters(word.text);
    if (!chars.length) continue;
    let start = aligned ? word.startMs : word.start_time;
    let end = aligned ? word.endMs : word.end_time;
    if (aligned && (start < previousEnd || end > durationMs)) throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '声学时间戳重叠或超出音频范围。');
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > durationMs + 100 || previousEnd - start > 100) {
      throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '原生字幕包含倒序、越界或无效时间戳。');
    }
    start = Math.max(previousEnd, start);
    end = Math.min(durationMs, end);
    if (end <= start) throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '原生字幕重叠无法在允许范围内校正。');
    chars.forEach((character, index) => result.push({ character, startMs: aligned ? start : Math.round(start + (end - start) * index / chars.length),
      endMs: aligned ? end : Math.round(start + (end - start) * (index + 1) / chars.length) }));
    previousEnd = end;
  }
  return result;
}

function buildNarrationTiming(artifact, evidence, durationMs, { fontSize = null, minSceneDurationMs = 800 } = {}) {
  if (evidence.humanAudioReview === 'accepted') {
    const review = { ...evidence, kind: 'narration_review', words: evidence.rawAsrWords,
      sourceText: artifact.narrationText, sourceTextSha256: evidence.humanAcceptance?.sourceTextSha256 };
    const verified = require('./narrationAcceptance').acceptedEvidence(review, artifact.narrationText, evidence.humanAcceptance);
    if (sha256(verified.words) !== sha256(evidence.words) || sha256(verified.textCorrections) !== sha256(evidence.textCorrections)) {
      throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '人工确认字幕与原始识别的对应关系已变化。');
    }
  }
  const characters = wordCharacters(evidence, durationMs);
  const sourceLetters = letters(artifact.narrationText).join('');
  if (characters.map(item => item.character).join('') !== sourceLetters) {
    if (hasQuestionOpening(artifact) && characters.map(item => item.character).join('') === letters(artifact.cues.map(cue => cue.text).join('')).join('')) {
      throw new WhiteboardError('NARRATION_TEXT_MISMATCH', '完整旁白缺少已确认的提问开场，现有音频只包含正文。音频已保留，请检查后决定是否重新生成完整旁白。');
    }
    throw new WhiteboardError('NARRATION_TEXT_MISMATCH', '完整旁白的原生字幕与已确认正文不一致。音频已保留，请检查后决定是否重新生成。');
  }
  let offset = 0;
  const captions = [];
  const cueTimings = narrationCues(artifact).map(cue => {
    const count = letters(cue.text).length;
    if (!count) throw new WhiteboardError('NARRATION_TEXT_MISMATCH', '旁白中存在没有可朗读文字的字幕。');
    const startMs = characters[offset].startMs;
    const endMs = characters[offset + count - 1].endMs;
    for (const [index, text] of splitCaption(cue.text, artifact.narrationLanguage, artifact.aspectRatio, fontSize).entries()) {
      const length = letters(text).length;
      if (!length) continue;
      captions.push({ id: `${cue.id}_${index + 1}`, sourceCueId: cue.id, text: captionText(text),
        startMs: characters[offset].startMs, endMs: characters[offset + length - 1].endMs });
      offset += length;
    }
    return { ...cue, startMs, endMs };
  });
  const aligned = evidence.kind === 'post_asr_sentence_timestamps';
  if (aligned) {
    for (let index = 1; index < cueTimings.length; index += 1) {
      if (cueTimings[index].startMs < cueTimings[index - 1].endMs) throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '分镜字幕切在同一声学词内部，请调整正文分句。');
    }
    for (let index = 1; index < captions.length;) {
      if (captions[index].startMs < captions[index - 1].endMs) {
        captions[index - 1].text += ' ' + captions[index].text;
        captions[index - 1].endMs = captions[index].endMs;
        captions.splice(index, 1);
      } else index += 1;
    }
  }
  const timing = materializeTiming(artifact, cueTimings, captions, durationMs, evidence.provider, minSceneDurationMs);
  if (aligned) Object.assign(timing, { timingKind: 'asr_words', evidenceKind: 'ctc_forced_aligned_words',
    timingSource: evidence.timingSource, sourceAudioSha256: evidence.audioSha256, lowConfidenceWordCount: evidence.lowConfidenceWordCount });
  if (evidence.humanAudioReview === 'accepted') Object.assign(timing, { evidenceKind: 'human_reviewed_asr_word_mapping',
    humanAcceptance: evidence.humanAcceptance, textCorrections: evidence.textCorrections });
  return timing;
}

function materializeTiming(artifact, cueTimings, captions, durationMs, provider, minSceneDurationMs = 800) {
  const byId = new Map(cueTimings.map(cue => [cue.id, cue]));
  const question = hasQuestionOpening(artifact) ? byId.get(OPENING_CUE_ID) : null;
  const opening = question ? { ...artifact.opening, cueId: OPENING_CUE_ID, startMs: 0,
    endMs: Math.round((question.endMs + byId.get(artifact.cues[0].id).startMs) / 2) } : null;
  let startMs = opening?.endMs || 0;
  const scenes = artifact.scenes.map((scene, index) => {
    const nextScene = artifact.scenes[index + 1];
    const endMs = nextScene ? Math.round((byId.get(scene.cueIds.at(-1)).endMs + byId.get(nextScene.cueIds[0]).startMs) / 2) : durationMs;
    if (endMs - startMs < minSceneDurationMs) throw new WhiteboardError('TIMELINE_INVALID', '某幕时长不足以完成落墨与至少半秒停留，请减少分镜或增加目标时长后重新确认。');
    const result = { id: scene.id, title: scene.title, cueIds: scene.cueIds, startMs, endMs };
    startMs = endMs;
    return result;
  });
  const timing = { schemaVersion: 1, captionLayoutVersion: CAPTION_LAYOUT_VERSION,
    timingKind: provider === 'disabled' ? 'source_srt' : 'provider_native_words', provider,
    durationMs, sourceTextSha256: sha256(artifact.narrationText), cues: cueTimings, captions, scenes,
    ...(opening ? { opening } : {}) };
  return artifact.opening?.mode === 'image-montage' ? prependImageOpening(timing, artifact.opening) : timing;
}

function buildSilentTiming(artifact, { fontSize = null, referenceOnly = false } = {}) {
  if (artifact.opening) {
    const { opening, ...body } = artifact;
    const timing = buildSilentTiming(body, { fontSize, referenceOnly });
    if (opening.mode === 'image-montage') return prependImageOpening(timing, opening);
    const offset = opening.estimatedDurationMs;
    const shift = item => ({ ...item, startMs: item.startMs + offset, endMs: item.endMs + offset });
    const parts = splitCaption(opening.question, artifact.narrationLanguage, artifact.aspectRatio, fontSize);
    const total = parts.reduce((sum, text) => sum + text.length, 0);
    let cursor = 0;
    const captions = parts.map((text, index) => {
      const startMs = Math.round(offset * cursor / total);
      cursor += text.length;
      return { id: `${OPENING_CUE_ID}_${index + 1}`, sourceCueId: OPENING_CUE_ID, text: captionText(text), startMs, endMs: Math.round(offset * cursor / total) };
    });
    return { ...timing, durationMs: timing.durationMs + offset,
      opening: { ...opening, cueId: OPENING_CUE_ID, startMs: 0, endMs: offset },
      cues: [{ id: OPENING_CUE_ID, text: opening.question, startMs: 0, endMs: offset }, ...timing.cues.map(shift)],
      captions: [...captions, ...timing.captions.map(shift)], scenes: timing.scenes.map(shift) };
  }
  if (!['source_srt', 'provisional'].includes(artifact.timingKind)) {
    throw new WhiteboardError('TIMELINE_INVALID', '无旁白制作需要已确认的计划时间轴或输入 SRT 时间轴，请重新确认内容与制作方案。');
  }
  const planned = artifact.timingKind === 'provisional';
  if (!Number.isSafeInteger(artifact.durationMs) || artifact.durationMs <= 0
    || !Array.isArray(artifact.cues) || !artifact.cues.length || !Array.isArray(artifact.scenes) || !artifact.scenes.length) {
    throw new WhiteboardError('TIMELINE_INVALID', '字幕或分镜时间缺失，请重新整理并确认方案。');
  }
  let previousEnd = 0;
  const ids = new Set();
  for (const cue of artifact.cues) {
    if (!cue || typeof cue.id !== 'string' || ids.has(cue.id) || typeof cue.text !== 'string' || !cue.text.trim()
      || !Number.isSafeInteger(cue.startMs) || !Number.isSafeInteger(cue.endMs)
      || cue.startMs < previousEnd || cue.endMs <= cue.startMs || cue.endMs > artifact.durationMs) {
      throw new WhiteboardError('TIMELINE_INVALID', '字幕时间存在重叠、越界或空片段，请重新整理并确认方案。');
    }
    ids.add(cue.id);
    previousEnd = cue.endMs;
  }
  if (artifact.scenes.some(scene => !scene || !Array.isArray(scene.cueIds) || !scene.cueIds.length)
    || JSON.stringify(artifact.scenes.flatMap(scene => scene.cueIds)) !== JSON.stringify([...ids])) {
    throw new WhiteboardError('TIMELINE_INVALID', '分镜必须按顺序完整覆盖字幕，请重新整理并确认方案。');
  }
  const captions = artifact.cues.flatMap(cue => {
    const parts = splitCaption(cue.text, artifact.narrationLanguage, artifact.aspectRatio, fontSize);
    // 新计划在源 cue 内为每个短句预留阅读时间，不移动已确认的源 cue 或分镜。
    const charactersPerSecond = artifact.narrationLanguage === 'zh-CN' ? 10 : 20;
    const minimums = parts.map(text => planned && artifact.productionPlan?.burnSubtitles !== false
      ? Math.max(500, Math.ceil(letters(text).length * 1000 / charactersPerSecond)) : 0);
    let remainingMs = cue.endMs - cue.startMs - minimums.reduce((sum, ms) => sum + ms, 0);
    if (remainingMs < 0) {
      if (!referenceOnly) throw new WhiteboardError('TIMELINE_INVALID', '计划字幕显示过快，请增加目标时长、合并短句或减少正文后重新确认。');
      // 基础时间线与字号无关；实际字幕的阅读预算在开始制作和最终排版时校验。
      minimums.fill(0);
      remainingMs = cue.endMs - cue.startMs;
    }
    let cursor = 0;
    let reservedMs = 0;
    return parts.map((text, index) => {
      const startMs = cue.startMs + reservedMs + Math.round(remainingMs * cursor / cue.text.length);
      cursor += text.length;
      reservedMs += minimums[index];
      return { id: `${cue.id}_${index + 1}`, sourceCueId: cue.id, text: captionText(text), startMs,
        endMs: cue.startMs + reservedMs + Math.round(remainingMs * cursor / cue.text.length) };
    });
  });
  if (captions.some(caption => caption.endMs <= caption.startMs)) {
    throw new WhiteboardError('TIMELINE_INVALID', '拆分后的字幕显示时间不足，请合并短句或增加时长后重新确认。');
  }
  const timing = materializeTiming(artifact, artifact.cues, captions, artifact.durationMs, 'disabled');
  if (planned) timing.timingKind = 'planned';
  return timing;
}

function buildDisplayCaptions(artifact, timing, fontSize, evidence) {
  // 字号只改变最终显示字幕，保留旁白时间线身份，供标注与单幕视频继续复用。
  if (artifact.productionPlan.burnSubtitles === false
    || (fontSize === subtitleStyleFor({}, artifact.aspectRatio).fontSize && timing.captionLayoutVersion === CAPTION_LAYOUT_VERSION)) return timing.captions;
  let display;
  if (['provider_native_words', 'asr_words'].includes(timing.timingKind)) {
    if (!evidence) throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '调整字幕字号需要已保存的同次原生字幕，请先检查旁白产物。');
    display = buildNarrationTiming(artifact, evidence, timing.audioDurationMs ?? timing.durationMs, { fontSize });
  } else {
    display = buildSilentTiming(artifact.opening ? artifact : { ...artifact, cues: timing.cues, scenes: timing.scenes, durationMs: timing.durationMs,
      timingKind: timing.timingKind === 'planned' ? 'provisional' : timing.timingKind }, { fontSize });
  }
  if (sha256({ cues: display.cues, scenes: display.scenes }) !== sha256({ cues: timing.cues, scenes: timing.scenes })) {
    throw new WhiteboardError('TIMELINE_INVALID', '字幕显示时间与已确认的旁白或分镜时间不一致，请检查现有时间轴。');
  }
  return display.captions;
}

module.exports = { CAPTION_LAYOUT_VERSION, letters, splitCaption, buildNarrationTiming, buildSilentTiming, buildDisplayCaptions, srtText };
