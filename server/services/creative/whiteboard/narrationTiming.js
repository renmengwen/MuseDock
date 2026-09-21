const { WhiteboardError, sha256, subtitleStyleFor } = require('./contracts');

const CAPTION_LAYOUT_VERSION = 'single-line-phrases-v1';

function letters(text) { return Array.from(String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')); }
function splitCaption(text, language = 'zh-CN', aspectRatio = '16:9', fontSize = null) {
  // 先按口播停顿拆句，再按单行容量拆长句；保留原始字符供时间分配使用。
  const baseLimit = aspectRatio === '9:16' ? 16 : aspectRatio === '4:3' ? 24 : 28;
  const defaultSize = subtitleStyleFor({}, aspectRatio).fontSize;
  const selectedSize = subtitleStyleFor({ subtitleFontSize: fontSize }, aspectRatio).fontSize;
  const limit = Math.max(4, Math.floor(baseLimit * defaultSize / selectedSize));
  const charWidth = char => /[\r\n]/u.test(char) ? 0 : /^[\x20-\x7e]$/u.test(char) && !/[MWmw@%&]/u.test(char) ? 0.75 : 1;
  const chars = Array.from(text);
  const phrases = [];
  let start = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (!/[，。！？；：、,.!?;:\r\n]/u.test(char)) continue;
    // 小数、千位分隔符、时间和英文词内部的点不是分句边界。
    if (/[.,:]/u.test(char) && /[0-9]/u.test(chars[index - 1] || '') && /[0-9]/u.test(chars[index + 1] || '')) continue;
    if (char === '.' && /[\p{L}\p{N}]/u.test(chars[index - 1] || '') && /[\p{L}\p{N}]/u.test(chars[index + 1] || '')) continue;
    if (char === ':' && chars[index + 1] === '/') continue;
    let end = index + 1;
    while (end < chars.length && /[，。！？；：、,.!?;:\s”’」』）】》\)\]"']/u.test(chars[end])) end += 1;
    const phrase = chars.slice(start, end).join('');
    // “第三，”“最后，”等很短的引导语跟随下一分句，避免单独闪过。
    if (letters(phrase).length < 4 && !/[。！？.!?\r\n]/u.test(char)) continue;
    if (letters(phrase).length) { phrases.push(phrase); start = end; }
    index = end - 1;
  }
  if (start < chars.length) phrases.push(chars.slice(start).join(''));

  const parts = [];
  const segmenter = new Intl.Segmenter(language, { granularity: 'word' });
  for (const phrase of phrases) {
    let rest = Array.from(phrase);
    while (rest.length) {
      let cut = 0;
      let width = 0;
      const remainingWidth = rest.reduce((sum, char) => sum + charWidth(char), 0);
      // 略超一行时均衡拆成两段，不把两三个字单独留到下一条。
      const targetWidth = remainingWidth > limit && remainingWidth < limit * 4 / 3 ? remainingWidth / 2 : limit;
      while (cut < rest.length && width + charWidth(rest[cut]) <= targetWidth) width += charWidth(rest[cut++]);
      if (cut < rest.length) {
        let offset = 0;
        let wordEnd = 0;
        for (const token of segmenter.segment(rest.join(''))) {
          offset += Array.from(token.segment).length;
          if (offset > cut) break;
          if (token.isWordLike && offset >= Math.ceil(cut / 2)) wordEnd = offset;
        }
        if (wordEnd) cut = wordEnd;
      }
      const part = rest.slice(0, cut).join('');
      if (!letters(part).length && parts.length) parts[parts.length - 1] += part;
      else parts.push(part);
      rest = rest.slice(cut);
    }
  }
  return parts;
}

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

function buildNarrationTiming(artifact, evidence, durationMs, { fontSize = null } = {}) {
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
  return materializeTiming(artifact, cueTimings, captions, durationMs, evidence.provider);
}

function materializeTiming(artifact, cueTimings, captions, durationMs, provider) {
  const byId = new Map(cueTimings.map(cue => [cue.id, cue]));
  let startMs = 0;
  const scenes = artifact.scenes.map((scene, index) => {
    const nextScene = artifact.scenes[index + 1];
    const endMs = nextScene ? Math.round((byId.get(scene.cueIds.at(-1)).endMs + byId.get(nextScene.cueIds[0]).startMs) / 2) : durationMs;
    if (endMs - startMs < 800) throw new WhiteboardError('TIMELINE_INVALID', '某幕时长不足以完成落墨与至少半秒停留，请减少分镜或增加目标时长后重新确认。');
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

function srtText(captions) {
  const time = ms => `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  return captions.map((cue, index) => `${index + 1}\n${time(cue.startMs)} --> ${time(cue.endMs)}\n${cue.text}\n`).join('\n');
}

module.exports = { CAPTION_LAYOUT_VERSION, letters, splitCaption, buildNarrationTiming, buildSilentTiming, buildDisplayCaptions, srtText };
