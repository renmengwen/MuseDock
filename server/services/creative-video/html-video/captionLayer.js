const DEFAULT_CAPTION_DURATION_SEC = 3;
const MAX_CAPTION_TEXT_LENGTH = 34;
const { stripSpeechStageDirections } = require('../../tts/speechText');
const { buildPlaybackClockSource } = require('./playbackClock');
const LEADING_PUNCTUATION_RE = /^[，。！？；：,.!?;:]/;
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

// 懒加载破环：focusCuePlanner → visualPlanService → captionLayer 存在 require 环，
// 顶层 require 会让 visualPlanService 拿到尚未初始化完成的 captionLayer 导出。
function plannerKeywordOccurrence(text, term) {
  return require('./focusCuePlanner').keywordOccurrence(text, term);
}

// 在 caption 原文中定位 cue keyword 的首个可接受出现位置（找不到返回 -1）。
// 候选位置按大小写不敏感顺序枚举，逐个用 planner 的 keywordOccurrence 做唯一边界语义判定：
// 判定窗口取「候选位置左右各保留一个真实字符」，窗口内该位置的邻接字符（或真实端点）与全文
// 完全一致，因此接受/拒绝结果与 planner 全文扫描逐位一致（防 "star" 误定位进 "restart"）。
function locateFocusKeyword(captionText, keyword) {
  const text = String(captionText || '');
  const term = String(keyword || '');
  if (!term) return -1;
  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  let from = 0;
  while (from + needle.length <= haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return -1;
    const window = text.slice(Math.max(0, index - 1), index + needle.length + 1);
    if (plannerKeywordOccurrence(window, term)) return index;
    from = index + 1;
  }
  return -1;
}

// 收集 node（或与其同构的 { metadata } 对象）上全部 focus_cues 的 caption_id → keyword 映射。
// beat_mp4 分支读 metadata.visual_beat，scene_html 分支读 metadata.visual_beats[]；
// camera_zoom 与 highlight_only 的 cue 都参与字幕高亮；新 cue 按 caption 取原文关键词，旧 cue 回退单 keyword；
// planner 保证每条 caption 至多一个 cue，重复时首个生效。
function focusKeywordsByCaptionId(node) {
  const metadata = node?.metadata && typeof node.metadata === 'object' ? node.metadata : {};
  const beats = Array.isArray(metadata.visual_beats)
    ? metadata.visual_beats
    : [metadata.visual_beat].filter(Boolean);
  const keywordByCaptionId = new Map();
  for (const beat of beats) {
    const shots = Array.isArray(beat?.visual_base?.shots) ? beat.visual_base.shots : [];
    for (const shot of shots) {
      const cues = Array.isArray(shot?.camera?.focus_cues) ? shot.camera.focus_cues : [];
      for (const cue of cues) {
        const fallbackKeyword = typeof cue?.keyword === 'string' ? cue.keyword.trim() : '';
        const keywordsByCaptionId = cue?.keywords_by_caption_id && typeof cue.keywords_by_caption_id === 'object'
          && !Array.isArray(cue.keywords_by_caption_id) ? cue.keywords_by_caption_id : {};
        for (const rawCaptionId of Array.isArray(cue.caption_ids) ? cue.caption_ids : []) {
          const captionId = String(rawCaptionId || '').trim();
          const captionKeyword = typeof keywordsByCaptionId[captionId] === 'string'
            ? keywordsByCaptionId[captionId].trim()
            : fallbackKeyword;
          if (captionId && captionKeyword && !keywordByCaptionId.has(captionId)) {
            keywordByCaptionId.set(captionId, captionKeyword);
          }
        }
      }
    }
  }
  return keywordByCaptionId;
}

// 按 caption_id → keyword 映射为字幕注记高亮关键词（focus_keyword）。
// 空映射时原样返回同一数组（无 cue 路径零改动），命中的 caption 拷贝注记、其余保持原对象。
function applyFocusKeywords(captions = [], keywordByCaptionId = new Map()) {
  const source = Array.isArray(captions) ? captions : [];
  if (!(keywordByCaptionId instanceof Map) || keywordByCaptionId.size === 0) return source;
  return source.map(caption => {
    const keyword = caption && typeof caption === 'object'
      ? keywordByCaptionId.get(String(caption.id || '').trim())
      : null;
    return keyword ? { ...caption, focus_keyword: keyword } : caption;
  });
}

// frame 自带 cue 元数据（项目帧的 metadata.visual_beat[s] 直挂与 metadata.graph_node 内嵌两种形态）合并成映射。
function frameFocusKeywords(frame = {}) {
  const metadata = frame?.metadata && typeof frame.metadata === 'object' ? frame.metadata : {};
  const keywordByCaptionId = focusKeywordsByCaptionId({ metadata });
  for (const [captionId, keyword] of focusKeywordsByCaptionId(metadata.graph_node)) {
    if (!keywordByCaptionId.has(captionId)) keywordByCaptionId.set(captionId, keyword);
  }
  return keywordByCaptionId;
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
      let cut = maxLength;
      if (LEADING_PUNCTUATION_RE.test(rest.slice(cut, cut + 1))) {
        cut = Math.max(1, cut - 1);
      }
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
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
  const chunks = splitLongText(caption.text)
    .map(chunk => String(chunk || '').trim())
    .filter(Boolean);
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

function captionsDisabled(frame = {}) {
  return frame.generate_captions === false
    || frame.generateCaptions === false
    || frame.media_options?.generateCaptions === false
    || frame.mediaOptions?.generateCaptions === false;
}

function normalizeCaptionsForFrame(frame = {}) {
  if (captionsDisabled(frame)) return [];
  // focus_keyword 是派生态：每次都先剥离入参里的旧注记，再按 frame 自带 cue 元数据重注记。
  // 这保证无元数据的比较态（如 timelineConsistency 的 frame vs scene 字幕比较）永远拿到干净字幕。
  const keywordByCaptionId = frameFocusKeywords(frame);
  const finalize = captions => applyFocusKeywords(
    captions.map(({ focus_keyword: _staleFocusKeyword, ...caption }) => caption),
    keywordByCaptionId,
  );
  const sourceCaptions = Array.isArray(frame.captions) ? frame.captions : [];
  const captions = sourceCaptions
    .map((caption, index) => normalizeCaption(caption, frame, index))
    .filter(Boolean)
    .flatMap(splitNormalizedCaption);
  if (captions.length > 0) return finalize(captions);

  const text = stripSpeechStageDirections(frame.narration_text);
  if (!text) return [];

  const duration = frameDurationSec(frame);
  const frameId = frame.id || frame.scene_id || 'frame';
  return finalize(splitNormalizedCaption({
    id: `${frameId}_caption_01`,
    start: 0,
    end: duration,
    duration,
    text,
  }));
}

const CAPTION_WINDOW_EPSILON_SEC = 0.001;

/**
 * 把场景级字幕切到 [offsetSec, offsetSec + durationSec) 窗口内，并平移为窗口局部时间。
 * 跨窗口边界的字幕段会被裁剪到窗口内（同一段字幕可能在相邻窗口各出现一次，时间上不重叠）。
 */
function sliceCaptionsToWindow(captions = [], offsetSec = 0, durationSec = 0) {
  const windowStart = finiteNonNegativeNumber(offsetSec, 0);
  const windowDuration = finitePositiveNumber(durationSec, 0);
  if (!windowDuration) return [];
  const windowEnd = windowStart + windowDuration;
  const sliced = [];
  for (const caption of Array.isArray(captions) ? captions : []) {
    if (!caption || typeof caption !== 'object') continue;
    const start = finiteNonNegativeNumber(caption.start ?? caption.start_sec, 0);
    const rawEnd = Number(caption.end ?? caption.end_sec);
    const end = Number.isFinite(rawEnd)
      ? rawEnd
      : start + finitePositiveNumber(caption.duration ?? caption.duration_sec, 0);
    if (end <= windowStart + CAPTION_WINDOW_EPSILON_SEC) continue;
    if (start >= windowEnd - CAPTION_WINDOW_EPSILON_SEC) continue;
    const localStart = roundCaptionTime(Math.max(start, windowStart) - windowStart);
    const localEnd = roundCaptionTime(Math.min(end, windowEnd) - windowStart);
    if (localEnd - localStart <= CAPTION_WINDOW_EPSILON_SEC) continue;
    const next = {
      ...caption,
      start: localStart,
      end: localEnd,
      duration: roundCaptionTime(localEnd - localStart),
    };
    delete next.start_sec;
    delete next.end_sec;
    delete next.duration_sec;
    sliced.push(next);
  }
  return sliced;
}

// 高亮样式只挂在 active 态选择器下；用 inline-block + transform 放大，不改变行盒排版尺寸，
// 激活瞬间不触发字幕布局回流（非 active 态 DOM 结构相同且整条隐藏，无样式差异可见）。
const CAPTION_KEYWORD_STYLE = '.hv-caption-item[data-hv-active="true"] .hv-caption-kw{color:#FFD54A;font-weight:800;display:inline-block;transform:scale(1.08);}';

// caption 文本渲染：带 focus_keyword 注记时先在原文定位（planner 同语义），再按 前段/keyword/后段
// 分别 htmlEscape 后包裹，保证含 &、<、>、引号的文本不错位、不双重转义；找不到关键词时输出与既有实现逐字节一致。
function captionItemHtml(caption) {
  const text = String(caption.text || '').trim();
  const keyword = typeof caption.focus_keyword === 'string' ? caption.focus_keyword.trim() : '';
  if (keyword) {
    const index = locateFocusKeyword(text, keyword);
    if (index >= 0) {
      return {
        highlighted: true,
        html: [
          htmlEscape(text.slice(0, index)),
          `<span class="hv-caption-kw">${htmlEscape(text.slice(index, index + keyword.length))}</span>`,
          htmlEscape(text.slice(index + keyword.length)),
        ].join(''),
      };
    }
  }
  return { highlighted: false, html: htmlEscape(text) };
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
  let hasKeywordHighlight = false;
  const items = normalizedCaptions.map((caption, index) => {
    const id = caption.id || `caption_${String(index + 1).padStart(2, '0')}`;
    const start = finiteNonNegativeNumber(caption.start ?? caption.start_sec, 0);
    const end = finitePositiveNumber(caption.end ?? caption.end_sec, start + finitePositiveNumber(caption.duration ?? caption.duration_sec, DEFAULT_CAPTION_DURATION_SEC));
    const item = captionItemHtml(caption);
    if (item.highlighted) hasKeywordHighlight = true;
    return [
      `<span class="hv-caption-item" data-role="subtitle-caption" data-caption-id="${htmlEscape(id)}" data-start="${htmlEscape(start)}" data-end="${htmlEscape(end)}">`,
      item.html,
      '</span>',
    ].join('');
  }).join('');

  return [
    '<style data-hv-layer-style="captions">',
    '.hv-caption-layer{position:absolute;left:50%;bottom:42px;transform:translateX(-50%);width:max-content;max-width:84%;z-index:9999;pointer-events:none;text-align:center;font:600 34px/1.28 "Noto Sans SC","Microsoft YaHei",Arial,sans-serif;letter-spacing:0;}',
    '.hv-caption-item{display:none;padding:14px 22px;border-radius:8px;background:rgba(0,0,0,.68);color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.55);white-space:normal;overflow-wrap:anywhere;}',
    '.hv-caption-item[data-hv-active="true"]{display:block;}',
    ...(hasKeywordHighlight ? [CAPTION_KEYWORD_STYLE] : []),
    '</style>',
    `<div class="${htmlEscape(className)}" data-hv-layer="captions" data-hv-managed="true" data-role="subtitle-caption">`,
    items,
    '</div>',
    `<script data-hv-caption-clock="true">${buildPlaybackClockSource()}(function(){const script=document.currentScript;const layer=script&&script.previousElementSibling;if(!layer)return;const items=Array.from(layer.querySelectorAll(".hv-caption-item"));window.__hvPlaybackClock.subscribe(function(t){for(const item of items){const a=Number(item.dataset.start||0);const b=Number(item.dataset.end||0);if(Number.isFinite(a)&&Number.isFinite(b)&&t>=a&&t<b){item.dataset.hvActive="true";}else{delete item.dataset.hvActive;}}});})();</script>`,
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

function isGeneratedCaptionOverlay(openingTag) {
  if (isExplicitUnmanagedCaptionLayer(openingTag)) return false;
  const tagName = tagNameFromOpeningTag(openingTag);
  return (tagName === 'div' || tagName === 'span')
    && (
      hasClass(openingTag, 'caption-bar')
      || hasClass(openingTag, 'subtitle-caption')
      || getAttributeValue(openingTag, 'data-role') === 'subtitle-caption'
    );
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
      || isLegacyCaptionOverlay(openingTag)
      || isGeneratedCaptionOverlay(openingTag);
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

function ensureCaptionLayer(html, captions = [], options = {}) {
  if (options.generateCaptions === false) return removeExistingCaptionLayer(html);
  const layer = renderCaptionLayer(captions);
  const withoutLayer = removeExistingCaptionLayer(html);
  if (!layer) return withoutLayer;
  const bodyCloseIndex = findClosingBodyOutsideSkippedRegions(withoutLayer);
  if (bodyCloseIndex >= 0) {
    return `${withoutLayer.slice(0, bodyCloseIndex)}${layer}${withoutLayer.slice(bodyCloseIndex)}`;
  }
  return `${withoutLayer}${layer}`;
}

const applyCaptionLayer = ensureCaptionLayer;

module.exports = {
  applyCaptionLayer,
  applyFocusKeywords,
  ensureCaptionLayer,
  focusKeywordsByCaptionId,
  hasUnmanagedCaptionLayer,
  htmlEscape,
  normalizeCaptionsForFrame,
  renderCaptionLayer,
  sliceCaptionsToWindow,
};
