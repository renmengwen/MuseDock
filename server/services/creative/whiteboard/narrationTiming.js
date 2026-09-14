const { WhiteboardError, sha256 } = require('./contracts');

function letters(text) { return Array.from(String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')); }
function splitCaption(text, language = 'zh-CN', aspectRatio = '16:9') {
  const limit = language === 'zh-CN' ? (aspectRatio === '9:16' ? 32 : 48) : (aspectRatio === '9:16' ? 64 : 96);
  const parts = [];
  let rest = text;
  while (Array.from(rest).length > limit) {
    const chars = Array.from(rest);
    let cut = limit;
    for (let index = limit; index >= Math.floor(limit / 2); index -= 1) {
      if (/[，。！？；、,.!?;\s]/u.test(chars[index - 1])) { cut = index; break; }
    }
    if (language !== 'zh-CN') while (cut > 1 && /[a-z0-9]/i.test(chars[cut - 1]) && /[a-z0-9]/i.test(chars[cut])) cut -= 1;
    parts.push(chars.slice(0, cut).join(''));
    rest = chars.slice(cut).join('');
  }
  if (rest) parts.push(rest);
  return parts;
}

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

function buildNarrationTiming(artifact, evidence, durationMs) {
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
    for (const [index, text] of splitCaption(cue.text, artifact.narrationLanguage, artifact.aspectRatio).entries()) {
      const length = letters(text).length;
      if (!length) continue;
      captions.push({ id: `${cue.id}_${index + 1}`, sourceCueId: cue.id, text: text.trim(),
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
  return { schemaVersion: 1, timingKind: provider === 'disabled' ? 'source_srt' : 'provider_native_words', provider,
    durationMs, sourceTextSha256: sha256(artifact.narrationText), cues: cueTimings, captions, scenes };
}

function buildSilentTiming(artifact) {
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
    let cursor = 0;
    return splitCaption(cue.text, artifact.narrationLanguage, artifact.aspectRatio).map((text, index) => {
      const startMs = cue.startMs + Math.round((cue.endMs - cue.startMs) * cursor / cue.text.length);
      cursor += text.length;
      return { id: `${cue.id}_${index + 1}`, sourceCueId: cue.id, text: text.trim(), startMs,
        endMs: cue.startMs + Math.round((cue.endMs - cue.startMs) * cursor / cue.text.length) };
    });
  });
  if (captions.some(caption => caption.endMs <= caption.startMs)) {
    throw new WhiteboardError('TIMELINE_INVALID', '拆分后的字幕显示时间不足，请合并短句或增加时长后重新确认。');
  }
  if (planned && artifact.productionPlan?.burnSubtitles !== false) {
    // 只校验新计划的阅读预算，不改写用户提供的 SRT 或语音原生时间。
    const charactersPerSecond = artifact.narrationLanguage === 'zh-CN' ? 10 : 20;
    if (captions.some(caption => caption.endMs - caption.startMs < Math.max(500, Math.ceil(letters(caption.text).length * 1000 / charactersPerSecond)))) {
      throw new WhiteboardError('TIMELINE_INVALID', '计划字幕显示过快，请增加目标时长、合并短句或减少正文后重新确认。');
    }
  }
  const timing = materializeTiming(artifact, artifact.cues, captions, artifact.durationMs, 'disabled');
  if (planned) timing.timingKind = 'planned';
  return timing;
}

function srtText(captions) {
  const time = ms => `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  return captions.map((cue, index) => `${index + 1}\n${time(cue.startMs)} --> ${time(cue.endMs)}\n${cue.text}\n`).join('\n');
}

module.exports = { letters, splitCaption, buildNarrationTiming, buildSilentTiming, srtText };
