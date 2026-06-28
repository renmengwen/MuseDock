const PHRASE_SPLIT_RE = /[，、；;。：:。？！?!锛屻€侊紱銆傦細:,\n]+/g;
const TRAILING_PUNCTUATION_RE = /[，、；;。：:。？！?!锛屻€侊紱銆傦細:,\s]+$/g;

function roundTime(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function splitLongPhrase(text, maxChars = 14) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if ([...clean].length <= maxChars) return [clean];

  const chars = [...clean];
  const result = [];
  for (let index = 0; index < chars.length; index += maxChars) {
    result.push(chars.slice(index, index + maxChars).join('').trim());
  }
  return result.filter(Boolean);
}

function splitChineseCaptionIntoPhrases(text, options = {}) {
  const maxChars = Number(options.maxChars || 14);
  return String(text || '')
    .split(PHRASE_SPLIT_RE)
    .flatMap(part => splitLongPhrase(part, maxChars))
    .map(part => part.replace(TRAILING_PUNCTUATION_RE, '').trim())
    .filter(Boolean);
}

function buildPhraseBlocksFromCaptions(captions = [], options = {}) {
  const safeCaptions = Array.isArray(captions) ? captions : [];
  return safeCaptions.flatMap((caption, captionIndex) => {
    const captionNumber = Number(caption?.index || captionIndex + 1);
    const start = Number(caption?.start || 0);
    const end = Number(caption?.end || start);
    const duration = Math.max(0, end - start);
    const phrases = splitChineseCaptionIntoPhrases(caption?.text || '', options);
    if (!phrases.length) return [];

    const slot = duration / phrases.length;
    return phrases.map((text, index) => {
      const phraseStart = start + slot * index;
      const phraseEnd = index === phrases.length - 1 ? end : start + slot * (index + 1);
      return {
        id: `cap-${captionNumber}-p${index + 1}`,
        caption_index: captionNumber,
        phrase_index: index + 1,
        text,
        start: roundTime(phraseStart),
        end: roundTime(phraseEnd),
        duration: roundTime(phraseEnd - phraseStart),
      };
    });
  });
}

module.exports = {
  splitChineseCaptionIntoPhrases,
  buildPhraseBlocksFromCaptions,
};
