const { createHash } = require('node:crypto');
const { letters } = require('../creative/shared/captionLayout');

// 仅生成待听审的文字差异，不把 ASR 猜测改写成已确认发音，也不生成合格字幕。
function buildNarrationReview(result, sourceText, durationMs, audioSha256) {
  const words = Array.isArray(result.words) ? result.words : [];
  const expected = letters(sourceText);
  const recognized = words.flatMap(word => letters(word.text).map(character => ({ character, word })));
  const actual = recognized.map(item => item.character);
  const differences = [];
  const available = expected.length * actual.length <= 4000000;
  if (available) {
    const rows = Array.from({ length: expected.length + 1 }, () => new Uint16Array(actual.length + 1));
    for (let i = expected.length - 1; i >= 0; i--) for (let j = actual.length - 1; j >= 0; j--) {
      rows[i][j] = expected[i] === actual[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
    let i = 0, j = 0, pending;
    const flush = () => { if (pending) differences.push(pending); pending = null; };
    while (i < expected.length || j < actual.length) {
      if (i < expected.length && j < actual.length && expected[i] === actual[j]) { flush(); i++; j++; continue; }
      if (!pending) {
        const neighbor = recognized[j]?.word || recognized[j - 1]?.word;
        pending = { expected: '', recognized: '', sourceContext: expected.slice(Math.max(0, i - 8), Math.min(expected.length, i + 18)).join(''),
          startMs: Number.isFinite(neighbor?.startMs) ? neighbor.startMs : null,
          endMs: Number.isFinite(neighbor?.endMs) ? neighbor.endMs : null, positionBasis: 'nearby_asr_word' };
      }
      if (j < actual.length && (i === expected.length || rows[i][j + 1] >= rows[i + 1][j])) {
        pending.recognized += actual[j]; pending.endMs = recognized[j].word.endMs; j++;
      } else { pending.expected += expected[i]; i++; }
    }
    flush();
  }
  return { schemaVersion: 1, kind: 'narration_review', status: 'unverified', audioSha256, durationMs,
    sourceTextSha256: createHash('sha256').update(sourceText).digest('hex'), sourceText,
    recognizedText: result.text || words.map(word => word.text).join(''),
    provider: result.provider || '', timingSource: result.timingSource || '', words,
    comparisonAvailable: available, differences,
    lowConfidenceWordCount: words.filter(word => Number.isFinite(word.confidence) && word.confidence < .1).length,
    humanAudioReview: 'pending' };
}
module.exports = { buildNarrationReview };
