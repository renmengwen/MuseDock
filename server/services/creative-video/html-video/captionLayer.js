const DEFAULT_CAPTION_DURATION_SEC = 3;
const MAX_CAPTION_TEXT_LENGTH = 34;
const { stripSpeechStageDirections } = require('../../speechText');
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const TEXT_ONLY_ELEMENTS = new Set(['script', 'style', 'title', 'textarea']);
const SKIPPED_CONTENT_ELEMENTS = new Set(['script', 'style', 'template', 'title', 'textarea']);

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function finitePositiveNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteNonNegativeNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function frameDurationSec(frame = {}) {
  return finitePositiveNumber(
    frame.duration_sec ?? frame.durationSec ?? frame.duration,
    DEFAULT_CAPTION_DURATION_SEC,
  );
}

function roundCaptionTime(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function splitLongText(text, maxLength = MAX_CAPTION_TEXT_LENGTH) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) return value ? [value] : [];

  const phrases = value.match(/[^，。！？；：,.!?;:]+[，。！？；：,.!?;:]?/g) || [value];
  const chunks = [];
  let current = '';

  const pushHardWrapped = chunk => {
    let rest = chunk;
    while (rest.length > maxLength) {
      chunks.push(rest.slice(0, maxLength));
      rest = rest.slice(maxLength);
    }
    current = rest;
  };

  for (const phrase of phrases) {
    if (!phrase) continue;
    const next = current + phrase;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    if (phrase.length > maxLength) {
      pushHardWrapped(phrase);
    } else {
      current = phrase;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitNormalizedCaption(caption) {
  const chunks = splitLongText(caption.text);
  if (chunks.length <= 1) return [caption];

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const duration = finitePositiveNumber(caption.end - caption.start, caption.duration || DEFAULT_CAPTION_DURATION_SEC);
  let cursor = caption.start;

  return chunks.map((text, index) => {
    const start = cursor;
    const end = index === chunks.length - 1
      ? caption.end
      : roundCaptionTime(start + (duration * text.length / totalLength));
    cursor = end;
    return {
      ...caption,
      id: `${caption.id}_${String(index + 1).padStart(2, '0')}`,
      start,
      end,
      duration: roundCaptionTime(end - start),
      text,
    };
  });
}

function normalizeCaption(caption = {}, frame = {}, index = 0) {
  const text = stripSpeechStageDirections(caption.text);
  if (!text) return null;

  const frameDuration = frameDurationSec(frame);
  const start = finiteNonNegativeNumber(caption.start ?? caption.start_sec, 0);
  const durationFromCaption = finitePositiveNumber(caption.duration ?? caption.duration_sec);
  const rawEnd = finitePositiveNumber(caption.end ?? caption.end_sec);
  const end = rawEnd && rawEnd > start
    ? rawEnd
    : start + (durationFromCaption || frameDuration);
  const duration = finitePositiveNumber(end - start, frameDuration);
  const frameId = frame.id || frame.scene_id || 'frame';

  return {
    ...caption,
    id: String(caption.id || `${frameId}_caption_${String(index + 1).padStart(2, '0')}`),
    start,
    end,
    duration,
    text,
  };
}

function normalizeCaptionsForFrame(frame = {}) {
  const sourceCaptions = Array.isArray(frame.captions) ? frame.captions : [];
  const captions = sourceCaptions
    .map((caption, index) => normalizeCaption(caption, frame, index))
    .filter(Boolean)
    .flatMap(splitNormalizedCaption);
  if (captions.length > 0) return captions;

  const text = stripSpeechStageDirections(frame.narration_text);
  if (!text) return [];

  const duration = frameDurationSec(frame);
  const frameId = frame.id || frame.scene_id || 'frame';
  return splitNormalizedCaption({
    id: `${frameId}_caption_01`,
    start: 0,
    end: duration,
    duration,
    text,
  });
}

function renderCaptionLayer(captions = [], options = {}) {
  const normalizedCaptions = Array.isArray(captions)
    ? captions
      .map((caption, index) => normalizeCaption(caption, {}, index))
      .filter(Boolean)
      .flatMap(splitNormalizedCaption)
    : [];
  if (normalizedCaptions.length === 0) return '';

  const className = options.className || 'hv-caption-layer';
  const items = normalizedCaptions.map((caption, index) => {
    const id = caption.id || `caption_${String(index + 1).padStart(2, '0')}`;
    const start = finiteNonNegativeNumber(caption.start ?? caption.start_sec, 0);
    const end = finitePositiveNumber(caption.end ?? caption.end_sec, start + finitePositiveNumber(caption.duration ?? caption.duration_sec, DEFAULT_CAPTION_DURATION_SEC));
    return [
      `<span class="hv-caption-item" data-role="subtitle-caption" data-caption-id="${htmlEscape(id)}" data-start="${htmlEscape(start)}" data-end="${htmlEscape(end)}">`,
      htmlEscape(String(caption.text || '').trim()),
      '</span>',
    ].join('');
  }).join('');

  return [
    '<style data-hv-layer-style="captions">',
    '.hv-caption-layer{position:absolute;left:50%;bottom:42px;transform:translateX(-50%);width:max-content;max-width:84%;z-index:9999;pointer-events:none;text-align:center;font:600 34px/1.28 "Noto Sans SC","Microsoft YaHei",Arial,sans-serif;letter-spacing:0;}',
    '.hv-caption-item{display:none;padding:14px 22px;border-radius:8px;background:rgba(0,0,0,.68);color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.55);white-space:normal;overflow-wrap:anywhere;}',
    '.hv-caption-item[data-hv-active="true"]{display:block;}',
    '</style>',
    `<div class="${htmlEscape(className)}" data-hv-layer="captions" data-hv-managed="true" data-role="subtitle-caption">`,
    items,
    '</div>',
    '<script data-hv-caption-clock="true">(function(){const script=document.currentScript;const layer=script&&script.previousElementSibling;if(!layer)return;const items=Array.from(layer.querySelectorAll(".hv-caption-item"));const start=performance.now();function tick(){const t=(performance.now()-start)/1000;for(const item of items){const a=Number(item.dataset.start||0);const b=Number(item.dataset.end||0);if(Number.isFinite(a)&&Number.isFinite(b)&&t>=a&&t<b){item.dataset.hvActive="true";}else{delete item.dataset.hvActive;}}requestAnimationFrame(tick);}tick();})();</script>',
  ].join('');
}

function isExplicitUnmanagedCaptionLayer(openingTag) {
  return getAttributeValue(openingTag, 'data-hv-managed') === 'false';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findTagEnd(text, start) {
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    }
  }
  return -1;
}

function tagNameFromOpeningTag(openingTag) {
  const match = String(openingTag || '').match(/^<\s*\/?\s*([A-Za-z][A-Za-z0-9:-]*)/);
  return match ? match[1].toLowerCase() : '';
}

function getAttributeValue(openingTag, name) {
  const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = String(openingTag || '').match(pattern);
  if (!match) return null;
  return String(match[1] ?? match[2] ?? match[3] ?? '').toLowerCase();
}

function hasClass(openingTag, className) {
  const classes = getAttributeValue(openingTag, 'class');
  return String(classes || '').split(/\s+/).includes(className.toLowerCase());
}

function findElementEnd(text, tagName, openingTagEnd) {
  const normalizedTagName = String(tagName || '').toLowerCase();
  const openingTag = text.slice(0, openingTagEnd + 1);
  if (!normalizedTagName || /\/\s*>$/.test(openingTag) || VOID_ELEMENTS.has(normalizedTagName)) {
    return openingTagEnd + 1;
  }
  if (TEXT_ONLY_ELEMENTS.has(normalizedTagName)) {
    const pattern = new RegExp(`<\\s*\\/\\s*${escapeRegExp(normalizedTagName)}\\s*>`, 'i');
    const match = pattern.exec(text.slice(openingTagEnd + 1));
    return match ? openingTagEnd + 1 + match.index + match[0].length : openingTagEnd + 1;
  }

  let depth = 1;
  let index = openingTagEnd + 1;
  while (index < text.length) {
    const nextTagStart = text.indexOf('<', index);
    if (nextTagStart < 0) break;
    if (text.startsWith('<!--', nextTagStart)) {
      index = findCommentEnd(text, nextTagStart);
      continue;
    }

    const tagEnd = findTagEnd(text, nextTagStart);
    if (tagEnd < 0) break;
    const tag = text.slice(nextTagStart, tagEnd + 1);
    const currentTagName = tagNameFromOpeningTag(tag);
    if (!currentTagName) {
      index = tagEnd + 1;
      continue;
    }

    const closingTag = /^<\s*\//.test(tag);
    if (closingTag) {
      if (currentTagName === normalizedTagName) {
        depth -= 1;
        if (depth === 0) return tagEnd + 1;
      }
      index = tagEnd + 1;
      continue;
    }

    const selfClosing = /\/\s*>$/.test(tag) || VOID_ELEMENTS.has(currentTagName);
    if (selfClosing) {
      index = tagEnd + 1;
      continue;
    }

    if (currentTagName === normalizedTagName) {
      depth += 1;
      index = tagEnd + 1;
      continue;
    }

    if (SKIPPED_CONTENT_ELEMENTS.has(currentTagName)) {
      index = findElementEnd(text.slice(nextTagStart), currentTagName, tagEnd - nextTagStart) + nextTagStart;
      continue;
    }

    index = tagEnd + 1;
  }
  return openingTagEnd + 1;
}

function findCommentEnd(text, start) {
  const end = text.indexOf('-->', start + 4);
  return end >= 0 ? end + 3 : text.length;
}

function isCaptionLayerTag(openingTag) {
  return getAttributeValue(openingTag, 'data-hv-layer') === 'captions';
}

function isManagedCaptionStyle(openingTag) {
  return getAttributeValue(openingTag, 'data-hv-layer-style') === 'captions'
    || getAttributeValue(openingTag, 'data-role') === 'subtitle-caption-style';
}

function isManagedCaptionClock(openingTag) {
  return getAttributeValue(openingTag, 'data-hv-caption-clock') === 'true';
}

function isLegacyCaptionOverlay(openingTag) {
  return tagNameFromOpeningTag(openingTag) === 'div'
    && hasClass(openingTag, 'hv-subtitle-caption')
    && getAttributeValue(openingTag, 'data-role') === 'subtitle-caption'
    && getAttributeValue(openingTag, 'data-text-key') === 'subtitle';
}

function scanCaptionLayerTags(html, visitor) {
  const text = String(html || '');
  let index = 0;
  while (index < text.length) {
    if (text.startsWith('<!--', index)) {
      index = findCommentEnd(text, index);
      continue;
    }
    if (text[index] !== '<') {
      index += 1;
      continue;
    }

    const tagEnd = findTagEnd(text, index);
    if (tagEnd < 0) break;
    const openingTag = text.slice(index, tagEnd + 1);
    if (/^<\s*\//.test(openingTag)) {
      index = tagEnd + 1;
      continue;
    }

    const tagName = tagNameFromOpeningTag(openingTag);
    const elementEnd = findElementEnd(text.slice(index), tagName, tagEnd - index) + index;
    visitor({ openingTag, tagName, start: index, tagEnd, end: elementEnd });

    if (SKIPPED_CONTENT_ELEMENTS.has(tagName)) {
      index = elementEnd;
    } else {
      index = tagEnd + 1;
    }
  }
}

function hasUnmanagedCaptionLayer(html) {
  let found = false;
  scanCaptionLayerTags(html, ({ openingTag, tagName }) => {
    if (found || SKIPPED_CONTENT_ELEMENTS.has(tagName)) return;
    if (isCaptionLayerTag(openingTag) && isExplicitUnmanagedCaptionLayer(openingTag)) {
      found = true;
    }
  });
  return found;
}

function removeExistingCaptionLayer(html) {
  const text = String(html || '');
  let output = '';
  let cursor = 0;
  scanCaptionLayerTags(text, ({ openingTag, tagName, start, end }) => {
    if (start < cursor) return;
    const remove = (tagName === 'style' && isManagedCaptionStyle(openingTag))
      || (tagName === 'script' && isManagedCaptionClock(openingTag))
      || (isCaptionLayerTag(openingTag) && !isExplicitUnmanagedCaptionLayer(openingTag))
      || isLegacyCaptionOverlay(openingTag);
    if (!remove) return;
    output += text.slice(cursor, start);
    cursor = end;
  });
  return output + text.slice(cursor);
}

function findClosingBodyOutsideSkippedRegions(html) {
  const text = String(html || '');
  let index = 0;
  while (index < text.length) {
    if (text.startsWith('<!--', index)) {
      index = findCommentEnd(text, index);
      continue;
    }
    if (text[index] !== '<') {
      index += 1;
      continue;
    }

    const tagEnd = findTagEnd(text, index);
    if (tagEnd < 0) return -1;
    const tag = text.slice(index, tagEnd + 1);
    const tagName = tagNameFromOpeningTag(tag);
    if (/^<\s*\//.test(tag) && tagName === 'body') {
      return index;
    }
    if (!/^<\s*\//.test(tag) && SKIPPED_CONTENT_ELEMENTS.has(tagName)) {
      index = findElementEnd(text.slice(index), tagName, tagEnd - index) + index;
      continue;
    }
    index = tagEnd + 1;
  }
  return -1;
}

function ensureCaptionLayer(html, captions = []) {
  const layer = renderCaptionLayer(captions);
  const withoutLayer = removeExistingCaptionLayer(html);
  if (!layer) return withoutLayer;
  const bodyCloseIndex = findClosingBodyOutsideSkippedRegions(withoutLayer);
  if (bodyCloseIndex >= 0) {
    return `${withoutLayer.slice(0, bodyCloseIndex)}${layer}${withoutLayer.slice(bodyCloseIndex)}`;
  }
  return `${withoutLayer}${layer}`;
}

module.exports = {
  ensureCaptionLayer,
  hasUnmanagedCaptionLayer,
  htmlEscape,
  normalizeCaptionsForFrame,
  renderCaptionLayer,
};
