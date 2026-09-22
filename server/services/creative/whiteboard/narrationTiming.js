const { WhiteboardError, sha256, subtitleStyleFor } = require('./contracts');

const { CAPTION_LAYOUT_VERSION, letters, splitCaption, srtText } = require('../shared/captionLayout');

function captionText(text) { return text.replace(/\s+/gu, ' ').trim(); }

function wordCharacters(evidence, durationMs) {
  const words = evidence.provider === 'doubao' ? evidence.subtitle?.sentences?.flatMap(sentence => sentence.words || []) : evidence.words;
  if (!Array.isArray(words) || !words.length) throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '完整旁白缺少同请求字级时间戳。');
  const result = [];
  let previousEnd = 0;
  for (const word of words) {
    const chars = letters(word.text);
    if (!chars.length) continue;
    let start = word.start_time;
    let end = word.end_time;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > durationMs + 100 || previousEnd - start > 100) {
      throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '原生字幕包含倒序、越界或无效时间戳。');
    }
    start = Math.max(previousEnd, start);
    end = Math.min(durationMs, end);
    if (end <= start) throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '原生字幕重叠无法在允许范围内校正。');
    chars.forEach((character, index) => result.push({ character, startMs: Math.round(start + (end - start) * index / chars.length),
      endMs: Math.round(start + (end - start) * (index + 1) / chars.length) }));
    previousEnd = end;
  }
  return result;
}

function buildNarrationTiming(artifact, evidence, durationMs, { fontSize = null, minSceneDurationMs = 800 } = {}) {
  const characters = wordCharacters(evidence, durationMs);
  const sourceLetters = letters(artifact.narrationText).join('');
  if (characters.map(item => item.character).join('') !== sourceLetters) {
    throw new WhiteboardError('NARRATION_TEXT_MISMATCH', '完整旁白的原生字幕与已确认正文不一致。音频已保留，请检查后决定是否重新生成。');
  }
  let offset = 0;
  const captions = [];
  const cueTimings = artifact.cues.map(cue => {
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
  return materializeTiming(artifact, cueTimings, captions, durationMs, evidence.provider, minSceneDurationMs);
}

function materializeTiming(artifact, cueTimings, captions, durationMs, provider, minSceneDurationMs = 800) {
  const byId = new Map(cueTimings.map(cue => [cue.id, cue]));
  let startMs = 0;
  const scenes = artifact.scenes.map((scene, index) => {
    const nextScene = artifact.scenes[index + 1];
    const endMs = nextScene ? Math.round((byId.get(scene.cueIds.at(-1)).endMs + byId.get(nextScene.cueIds[0]).startMs) / 2) : durationMs;
    if (endMs - startMs < minSceneDurationMs) throw new WhiteboardError('TIMELINE_INVALID', '某幕时长不足以完成落墨与至少半秒停留，请减少分镜或增加目标时长后重新确认。');
    const result = { id: scene.id, title: scene.title, cueIds: scene.cueIds, startMs, endMs };
    startMs = endMs;
    return result;
  });
  return { schemaVersion: 1, captionLayoutVersion: CAPTION_LAYOUT_VERSION,
    timingKind: provider === 'disabled' ? 'source_srt' : 'provider_native_words', provider,
    durationMs, sourceTextSha256: sha256(artifact.narrationText), cues: cueTimings, captions, scenes };
}

function buildSilentTiming(artifact, { fontSize = null, referenceOnly = false } = {}) {
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
  if (timing.timingKind === 'provider_native_words') {
    if (!evidence) throw new WhiteboardError('NARRATION_EVIDENCE_INVALID', '调整字幕字号需要已保存的同次原生字幕，请先检查旁白产物。');
    display = buildNarrationTiming(artifact, evidence, timing.durationMs, { fontSize });
  } else {
    display = buildSilentTiming({ ...artifact, cues: timing.cues, scenes: timing.scenes, durationMs: timing.durationMs,
      timingKind: timing.timingKind === 'planned' ? 'provisional' : timing.timingKind }, { fontSize });
  }
  if (sha256({ cues: display.cues, scenes: display.scenes }) !== sha256({ cues: timing.cues, scenes: timing.scenes })) {
    throw new WhiteboardError('TIMELINE_INVALID', '字幕显示时间与已确认的旁白或分镜时间不一致，请检查现有时间轴。');
  }
  return display.captions;
}

module.exports = { CAPTION_LAYOUT_VERSION, letters, splitCaption, buildNarrationTiming, buildSilentTiming, buildDisplayCaptions, srtText };
