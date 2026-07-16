const path = require('path');

const { isGeneratedVisualAsset } = require('../../creative/visualAssetContract');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compactText(value, maxLength = 1000) {
  let raw = value;
  if (Array.isArray(value)) {
    raw = value.map(item => compactText(item, 120)).filter(Boolean).join(' / ');
  } else if (value && typeof value === 'object') {
    raw = value.title || value.label || value.name || value.text || value.headline || value.summary || value.description || '';
  }
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text || /^\[object Object\]$/i.test(text)) return '';
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

function normalizeAssetToken(value = '') {
  return String(value || '').replace(/\\/g, '/').trim();
}

function normalizeHtmlAssetReference(value = '') {
  const text = decodeBasicHtmlEntities(normalizeAssetToken(value)).split(/[?#]/)[0];
  try {
    const decoded = decodeURIComponent(text);
    if (!decoded || decoded.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(decoded)) return decoded;
    return path.posix.normalize(decoded);
  } catch {
    return text;
  }
}

function assetReferenceTokens(asset = {}) {
  const assetPath = normalizeAssetToken(asset.path);
  return [...new Set([
    normalizeAssetToken(asset.frame_src),
    assetPath,
    assetPath ? `../${assetPath}` : '',
    normalizeAssetToken(asset.url),
  ].filter(Boolean))];
}

function referenceVariants(value = '') {
  const normalized = normalizeHtmlAssetReference(value);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  if (!normalized.startsWith('../') && !normalized.startsWith('/') && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(normalized)) {
    variants.add(`../${normalized}`);
  }
  return [...variants];
}

function parseAttributes(text = '') {
  const attributes = new Map();
  const pattern = /([^\s"'<>\/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of String(text || '').matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function parseSrcset(value = '') {
  const candidates = [];
  const text = String(value || '');
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /[\s,]/.test(text[index])) index += 1;
    if (index >= text.length) break;
    const start = index;
    if (/^data:/i.test(text.slice(index))) {
      let commas = 0;
      while (index < text.length && !/\s/.test(text[index])) {
        if (text[index] === ',') {
          commas += 1;
          if (commas > 1) break;
        }
        index += 1;
      }
    } else {
      while (index < text.length && !/[\s,]/.test(text[index])) index += 1;
    }
    const candidate = text.slice(start, index).replace(/,$/, '');
    if (candidate) candidates.push(candidate);
    while (index < text.length && text[index] !== ',') index += 1;
    if (text[index] === ',') index += 1;
  }
  return candidates;
}

function scanHtmlTags(html = '') {
  const tags = [];
  const text = String(html || '');
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('<', cursor);
    if (start < 0) break;
    let index = start + 1;
    while (/\s/.test(text[index] || '')) index += 1;
    const closing = text[index] === '/';
    if (closing) index += 1;
    while (/\s/.test(text[index] || '')) index += 1;
    const nameStart = index;
    while (/[a-z0-9:_-]/i.test(text[index] || '')) index += 1;
    const name = text.slice(nameStart, index).toLowerCase();
    if (!name) {
      cursor = start + 1;
      continue;
    }
    const attributesStart = index;
    let quote = '';
    for (; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (char === quote && text[index - 1] !== '\\') quote = '';
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        break;
      }
    }
    if (index >= text.length) break;
    tags.push({ closing, name, attributes: text.slice(attributesStart, index) });
    cursor = index + 1;
  }
  return tags;
}

function stripCssBlocks(css = '', namePattern = /@font-face\b/gi) {
  const text = String(css || '');
  let result = '';
  let cursor = 0;
  for (const match of text.matchAll(namePattern)) {
    if (match.index < cursor) continue;
    const open = text.indexOf('{', match.index + match[0].length);
    if (open < 0) continue;
    let depth = 1;
    let quote = '';
    let index = open + 1;
    for (; index < text.length && depth > 0; index += 1) {
      const char = text[index];
      if (quote) {
        if (char === quote && text[index - 1] !== '\\') quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
    }
    result += text.slice(cursor, match.index);
    cursor = index;
  }
  return result + text.slice(cursor);
}

function functionArguments(text, pattern) {
  const results = [];
  for (const match of text.matchAll(pattern)) {
    let depth = 1;
    let quote = '';
    let index = match.index + match[0].length;
    const start = index;
    for (; index < text.length && depth > 0; index += 1) {
      const char = text[index];
      if (quote) {
        if (char === quote && text[index - 1] !== '\\') quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
    }
    if (depth === 0) results.push(text.slice(start, index - 1));
  }
  return results;
}

function splitCssCandidates(value = '') {
  const candidates = [];
  let start = 0;
  let quote = '';
  let depth = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if ((char === ',' || index === value.length) && depth === 0) {
      candidates.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  return candidates;
}

function extractCssVisualReferences(css = '', add) {
  const text = stripCssBlocks(css).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const url of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi)) {
    add(url[1] ?? url[2] ?? url[3] ?? '', 'css');
  }
  for (const imageSet of functionArguments(text, /(?:-webkit-)?image-set\s*\(/gi)) {
    for (const candidate of splitCssCandidates(imageSet)) {
      if (/^url\s*\(/i.test(candidate)) continue;
      const match = candidate.match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
      if (match) add(match[1] ?? match[2] ?? match[3] ?? '', 'css-image-set');
    }
  }
}

function extractVisualAssetReferences(html = '') {
  const entries = [];
  const seen = new Set();
  const searchable = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const add = (rawValue, context) => {
    const reference = normalizeHtmlAssetReference(rawValue);
    if (!reference || reference.startsWith('#')) return;
    const key = `${context}\0${reference}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ reference, context });
  };
  const addAttribute = (attributes, name, context) => {
    if (attributes.has(name)) add(attributes.get(name), context);
  };
  const addSrcset = (attributes, context) => {
    if (!attributes.has('srcset')) return;
    parseSrcset(attributes.get('srcset')).forEach(candidate => add(candidate, context));
  };
  let pictureDepth = 0;
  const tagSearchable = searchable.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  for (const tag of scanHtmlTags(tagSearchable)) {
    const { closing, name } = tag;
    if (closing) {
      if (name === 'picture' && pictureDepth > 0) pictureDepth -= 1;
      continue;
    }
    const attributes = parseAttributes(tag.attributes);
    if (name === 'picture') pictureDepth += 1;
    if (name === 'img') {
      addAttribute(attributes, 'src', 'img');
      addAttribute(attributes, 'data-src', 'img');
      addSrcset(attributes, 'img-srcset');
    } else if (name === 'source' && pictureDepth > 0) {
      addAttribute(attributes, 'src', 'picture-source');
      addSrcset(attributes, 'picture-srcset');
    } else if (name === 'video') {
      addAttribute(attributes, 'poster', 'video-poster');
    } else if (name === 'input' && String(attributes.get('type') || '').toLowerCase() === 'image') {
      addAttribute(attributes, 'src', 'input-image');
    } else if (name === 'image') {
      addAttribute(attributes, 'href', 'svg-image');
      addAttribute(attributes, 'xlink:href', 'svg-image');
    } else if (name === 'link' && String(attributes.get('rel') || '').toLowerCase().split(/\s+/).includes('stylesheet')) {
      addAttribute(attributes, 'href', 'stylesheet');
    }
    if (attributes.has('style')) extractCssVisualReferences(attributes.get('style'), add);
  }
  for (const style of searchable.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    extractCssVisualReferences(style[1], add);
  }
  return entries;
}

function visualReferenceSet(html = '') {
  return new Set(extractVisualAssetReferences(html).map(item => item.reference));
}

function unregisteredVisualAssetReferences(references = [], assets = []) {
  const registered = new Set(assets.flatMap(assetReferenceTokens).flatMap(referenceVariants));
  const result = [];
  for (const item of references) {
    const reference = typeof item === 'string' ? normalizeHtmlAssetReference(item) : item?.reference;
    if (!reference) continue;
    const failClosed = item?.context === 'stylesheet' || /^(?:https?:|file:|blob:|data:|\/\/)/i.test(reference);
    if (!failClosed && referenceVariants(reference).some(variant => registered.has(variant))) continue;
    if (!result.includes(reference)) result.push(reference);
  }
  return result;
}

function htmlReferencesAsset(referenceSet, tokens = []) {
  const references = new Set([...referenceSet].flatMap(referenceVariants));
  return tokens.flatMap(referenceVariants).some(token => references.has(token));
}

function resolveExpectedFrameAsset(node = {}, creativeContext = {}) {
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
  const byId = new Map(assets.map(asset => [String(asset?.id || asset?.asset_id || ''), asset]));
  let first = null;
  for (const ref of (Array.isArray(node.asset_refs) ? node.asset_refs : [])) {
    const asset = byId.get(String(ref?.asset_id || ref?.id || ''));
    if (!asset) continue;
    if (asset.requirement === 'required') return { ref, asset };
    if (!first) first = { ref, asset };
  }
  return first;
}

function resolveRequiredFrameAssets(node = {}, creativeContext = {}) {
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
  const byId = new Map(assets.map(asset => [String(asset?.id || asset?.asset_id || ''), asset]));
  const required = [];
  for (const ref of (Array.isArray(node.asset_refs) ? node.asset_refs : [])) {
    const asset = byId.get(String(ref?.asset_id || ref?.id || ''));
    if (asset?.requirement === 'required') required.push({ ref, asset });
  }
  return required;
}

function resolveRequiredFrameAsset(node = {}, creativeContext = {}) {
  return resolveRequiredFrameAssets(node, creativeContext)[0] || null;
}

function validateFrameAssetUsage(html = '', { node = {}, creativeContext = {} } = {}) {
  const visualReferences = extractVisualAssetReferences(html);
  const references = new Set(visualReferences.map(item => item.reference));
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
  const [unregisteredReference] = unregisteredVisualAssetReferences(visualReferences, assets);
  if (unregisteredReference) {
    return {
      success: false,
      code: 'frame_html_unregistered_visual_asset',
      message: `HTML 引用了未登记的视觉素材：${unregisteredReference}。请先登记素材后再生成画面。`,
      details: { offending_reference: unregisteredReference },
    };
  }
  const blockedAsset = assets.find(asset => objectOrEmpty(asset.image_analysis).should_use === false
    && htmlReferencesAsset(references, assetReferenceTokens(asset)));
  if (blockedAsset) {
    return {
      success: false,
      code: 'frame_html_blocked_source_asset_used',
      message: `HTML 引用了不建议用于成片的来源图片：${blockedAsset.id || blockedAsset.asset_id || blockedAsset.path || ''}。`,
      details: {
        asset_id: blockedAsset.id || blockedAsset.asset_id || '',
        path: blockedAsset.path || '',
        avoid_reason: blockedAsset.image_analysis?.avoid_reason || '',
      },
    };
  }

  const expected = resolveRequiredFrameAssets(node, creativeContext)
    .find(item => !htmlReferencesAsset(references, assetReferenceTokens(item.asset)));
  if (!expected) return { success: true };
  const tokens = assetReferenceTokens(expected.asset);
  const missingLabel = isGeneratedVisualAsset(expected.asset) ? '本帧推荐生成图片' : '本帧推荐来源图片';
  return {
    success: false,
    code: 'frame_html_required_source_asset_missing',
    message: `HTML 未引用${missingLabel}：${expected.ref.asset_id}。`,
    details: {
      asset_id: expected.ref.asset_id,
      required_src: expected.asset.frame_src || expected.asset.path || '',
      accepted_refs: tokens,
      reason: expected.ref.reason || '',
    },
  };
}

function decodeBasicHtmlEntities(text = '') {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    });
}

function htmlVisibleSegments(html = '') {
  const withoutHidden = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  return decodeBasicHtmlEntities(withoutHidden.replace(/<[^>]+>/g, '\n'))
    .split(/\r?\n/)
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function visibleHtmlText(html = '') {
  return htmlVisibleSegments(html).join(' ').replace(/\s+/g, ' ').trim();
}

function normalizedComparableText(value = '') {
  return decodeBasicHtmlEntities(value)
    .replace(/\s+/g, '')
    .replace(/[“”‘’"']/g, '')
    .trim()
    .toLowerCase();
}

function flattenTextValues(value, output = []) {
  if (value === null || value === undefined) return output;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = compactText(value, 600);
    if (text) output.push(text);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => flattenTextValues(item, output));
    return output;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      if (/^(id|scene_id|frame_id|kind|type|status|path|url|html_path|mp4_path)$/i.test(key)) return;
      flattenTextValues(item, output);
    });
  }
  return output;
}

function resolveSceneForFrame(sceneSpec = {}, node = {}, frameId = '') {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const candidates = [
    node?.metadata?.scene_id,
    node?.scene_id,
    node?.sceneId,
    frameId,
    node?.id,
  ].map(item => String(item || '').trim()).filter(Boolean);
  return scenes.find(scene => candidates.includes(String(scene?.id || '').trim()))
    || (scenes.length === 1 ? scenes[0] : {});
}

// 画面内容匹配打分只用提炼素材（headline/keywords/cards/label），避免奖励画面照抄旁白。
function overlapExpectedTexts(args = {}) {
  const scene = resolveSceneForFrame(args.sceneSpec || {}, args.node || {}, args.frameId || args.node?.id || '');
  const values = [];
  flattenTextValues(scene?.visual_text, values);
  flattenTextValues(scene?.title, values);
  flattenTextValues(args.node?.label, values);
  return [...new Set(values.map(item => compactText(item, 600)).filter(Boolean))];
}

function primaryExpectedText(args = {}) {
  const scene = resolveSceneForFrame(args.sceneSpec || {}, args.node || {}, args.frameId || args.node?.id || '');
  return compactText(
    scene?.visual_text?.headline
      || scene?.headline
      || args.node?.label
      || args.node?.text
      || scene?.title
      || '',
    180,
  );
}

function textLengthScore(text = '') {
  const value = String(text || '');
  const chinese = (value.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (value.match(/[A-Za-z0-9]/g) || []).length;
  return chinese + latin;
}

function contentOverlapScore(htmlComparable, expectedTexts) {
  const tokens = new Set();
  for (const text of expectedTexts) {
    const raw = String(text || '');
    for (const match of raw.matchAll(/[A-Za-z][A-Za-z0-9_-]{2,}/g)) {
      tokens.add(match[0].toLowerCase());
    }
    for (const match of raw.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
      const chunk = match[0];
      if (chunk.length <= 6) {
        tokens.add(chunk);
      } else {
        for (let index = 0; index <= chunk.length - 4; index += 2) {
          tokens.add(chunk.slice(index, index + 4));
        }
      }
    }
  }
  return [...tokens]
    .filter(token => textLengthScore(token) >= 3 && htmlComparable.includes(normalizedComparableText(token)))
    .length;
}

function validateHtmlContentQuality(html, args = {}) {
  const htmlComparable = normalizedComparableText(visibleHtmlText(html));

  const primary = primaryExpectedText(args);
  const primaryComparable = normalizedComparableText(primary);
  if (primaryComparable && !htmlComparable.includes(primaryComparable)) {
    const overlap = contentOverlapScore(htmlComparable, overlapExpectedTexts(args));
    if (overlap < 2) {
      return {
        success: true,
        diagnostics: [{
          code: 'frame_html_content_mismatch',
          severity: 'warning',
          stage: 'ai-frame-html',
          sub_stage: 'frame_html',
          frame_id: args.node?.id || '',
          retryable: false,
          repair_action: '',
          user_message: `HTML 主画面文案没有匹配当前镜头内容，缺少核心标题或足够关键词：${primary}。`,
          details: {
            expected_headline: primary,
            overlap_score: overlap,
          },
        }],
        code: 'frame_html_content_mismatch',
        message: `HTML 主画面文案没有匹配当前镜头内容，缺少核心标题或足够关键词：${primary}。`,
      };
    }
  }

  return { success: true };
}

function extractHtmlDocument(text) {
  const raw = String(text || '').trim();
  if (!raw) return { success: false, code: 'provider_missing_text', message: 'AI 返回为空，未返回 HTML 内容。' };
  const fenced = raw.match(/```html\s*([\s\S]*?)```/i);
  const html = fenced ? fenced[1].trim() : extractRawHtmlDocument(raw);
  if (!/(<!doctype\s+html|<html[\s>])/i.test(html) || !/<\/html>/i.test(html)) {
    return { success: false, code: 'html_document_extract_failed', message: 'AI 未返回完整 HTML document。' };
  }
  return { success: true, html };
}

function extractRawHtmlDocument(raw) {
  const doctypeMatch = raw.match(/<!doctype\s+html[\s\S]*?<\/html>/i);
  if (doctypeMatch) return doctypeMatch[0].trim();
  const htmlMatch = raw.match(/<html[\s\S]*?<\/html>/i);
  if (htmlMatch) return htmlMatch[0].trim();
  return raw.trim();
}

module.exports = {
  objectOrEmpty,
  compactText,
  normalizeHtmlAssetReference,
  assetReferenceTokens,
  referenceVariants,
  extractVisualAssetReferences,
  unregisteredVisualAssetReferences,
  visualReferenceSet,
  htmlReferencesAsset,
  resolveExpectedFrameAsset,
  resolveRequiredFrameAsset,
  validateFrameAssetUsage,
  resolveSceneForFrame,
  overlapExpectedTexts,
  primaryExpectedText,
  validateHtmlContentQuality,
  extractHtmlDocument,
};
