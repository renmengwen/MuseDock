const { subtitleStyleFor } = require('./productionSettings');

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

function srtText(captions) {
  const time = ms => `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  return captions.map((cue, index) => `${index + 1}\n${time(cue.startMs)} --> ${time(cue.endMs)}\n${cue.text}\n`).join('\n');
}

module.exports = { CAPTION_LAYOUT_VERSION, letters, splitCaption, srtText };
