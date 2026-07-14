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
  const text = normalizeAssetToken(value).split(/[?#]/)[0];
  try {
    return decodeURIComponent(text);
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
  ].filter(Boolean))];
}

function extractHtmlAssetReferences(html = '') {
  const references = new Set();
  const searchable = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const attrPattern = /\b(?:src|href|poster|data-src)=["']([^"']+)["']/gi;
  for (const match of searchable.matchAll(attrPattern)) {
    const value = normalizeHtmlAssetReference(match[1]);
    if (value) references.add(value);
  }
  const cssPattern = /url\(["']?([^"')]+)["']?\)/gi;
  for (const match of searchable.matchAll(cssPattern)) {
    const value = normalizeHtmlAssetReference(match[1]);
    if (value) references.add(value);
  }
  return references;
}

function htmlReferencesAsset(referenceSet, tokens = []) {
  for (const rawToken of tokens) {
    const token = normalizeHtmlAssetReference(rawToken);
    if (!token) continue;
    for (const ref of referenceSet) {
      if (ref === token || ref.endsWith(`/${token.replace(/^\.\.\//, '')}`)) return true;
    }
  }
  return false;
}

function resolveExpectedFrameAsset(node = {}, creativeContext = {}) {
  const ref = (Array.isArray(node.asset_refs) ? node.asset_refs : []).find(item => item && item.asset_id);
  if (!ref) return null;
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
  const asset = assets.find(item => String(item?.id || item?.asset_id || '') === String(ref.asset_id || ''));
  if (!asset) return null;
  return { ref, asset };
}

function validateFrameAssetUsage(html = '', { node = {}, creativeContext = {} } = {}) {
  const references = extractHtmlAssetReferences(html);
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
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

  const expected = resolveExpectedFrameAsset(node, creativeContext);
  if (!expected) return { success: true };
  const tokens = assetReferenceTokens(expected.asset);
  if (htmlReferencesAsset(references, tokens)) return { success: true };
  const missingLabel = expected.asset.source === 'generated' ? '本帧推荐生成图片' : '本帧推荐来源图片';
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
  resolveExpectedFrameAsset,
  validateFrameAssetUsage,
  resolveSceneForFrame,
  overlapExpectedTexts,
  primaryExpectedText,
  validateHtmlContentQuality,
  extractHtmlDocument,
};
