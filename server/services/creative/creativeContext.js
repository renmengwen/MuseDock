const AWEME_ID_PATTERN = /^\d{5,32}$/;
const SOURCE_URL_PATTERN = /https?:\/\/[^\s<>"'`()\[\]{}，。；;、（）《》【】「」『』“”‘’]+/gi;
const SOURCE_URL_TRAILING_PUNCTUATION_PATTERN = /[.,;:!?，。；：！？、)\]}）】》」』”’]+$/;
const DOUYIN_SHORT_LINK_TIMEOUT_MS = 8000;
const DOUYIN_SHORT_LINK_MAX_REDIRECTS = 5;
const DOUYIN_SHORT_LINK_RESOLVE_FAILED_MESSAGE = '暂时无法解析抖音短链，请稍后重试，或粘贴跳转后的完整视频链接。';
const sourceFetch = require('../source/sourceFetch');
const { UPLOAD_ID_PATTERN } = require('./visualAssetUploads');

function safeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function extractAwemeId(input) {
  const text = safeString(input);
  if (!text) {
    return '';
  }

  if (AWEME_ID_PATTERN.test(text)) {
    return text;
  }

  const bareQueryId = extractAwemeIdFromBareQuery(text);
  if (bareQueryId) {
    return bareQueryId;
  }

  const urls = sourceFetch.extractUrls(text, Number.MAX_SAFE_INTEGER);
  const noProtocolDouyinCandidates = extractNoProtocolDouyinCandidates(text);
  const candidates = /^https?:\/\//i.test(text) || isDouyinLink(text)
    ? [text, ...urls, ...noProtocolDouyinCandidates]
    : [...urls, ...noProtocolDouyinCandidates];

  for (const candidate of candidates) {
    if (!isDouyinLink(candidate)) {
      continue;
    }

    try {
      const url = new URL(normalizeUrlForParsing(candidate));
      const videoMatch = url.pathname.match(/\/video\/(\d{5,32})(?=\D|$)/);
      if (videoMatch && AWEME_ID_PATTERN.test(videoMatch[1])) {
        return videoMatch[1];
      }

      const queryId = url.searchParams.get('modal_id') || url.searchParams.get('aweme_id');
      if (AWEME_ID_PATTERN.test(safeString(queryId))) {
        return queryId;
      }

      const fallbackMatch = safeString(candidate).match(/\/video\/(\d{5,32})(?=\D|$)/);
      if (fallbackMatch && AWEME_ID_PATTERN.test(fallbackMatch[1])) {
        return fallbackMatch[1];
      }
    } catch (error) {
      continue;
    }
  }

  return '';
}

function createNormalizedData(overrides = {}) {
  return {
    mode: '',
    raw_text: '',
    aweme_id: '',
    douyin_url: '',
    source_url: '',
    source_hint: '',
    ignored_url_count: 0,
    use_research: false,
    skip_validation: false,
    asset_ids: [],
    ...overrides,
  };
}

function createSuccessResponse(overrides = {}) {
  return {
    success: true,
    data: createNormalizedData(overrides),
  };
}

function createFailureResponse(message, overrides = {}) {
  return {
    success: false,
    message,
    data: createNormalizedData(overrides),
  };
}

function normalizeUrlForParsing(input) {
  const text = safeString(input);
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function extractAwemeIdFromBareQuery(input) {
  const text = safeString(input);
  if (!/^\??(?:modal_id|aweme_id)=/i.test(text)) {
    return '';
  }

  const query = text.startsWith('?') ? text.slice(1) : text;
  const params = new URLSearchParams(query);
  const queryId = params.get('modal_id') || params.get('aweme_id');
  return AWEME_ID_PATTERN.test(safeString(queryId)) ? queryId : '';
}

function extractNoProtocolDouyinCandidates(input) {
  const text = safeString(input);
  if (!text) {
    return [];
  }

  const candidates = [];
  const douyinHost = '(?:(?:www|v)\\.)?douyin\\.com';
  const path = '[^\\s\\u3002\\uff0c\\uff1b\\uff1a\\uff01\\uff1f\\u3001,;!?]+';
  const pattern = new RegExp(`(^|[^\\w:/.-])(${douyinHost}\\/${path})`, 'ig');

  for (const match of text.matchAll(pattern)) {
    const candidate = safeString(match[2]).replace(/[.。；;，,！？!?]+$/g, '');
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function isDouyinLink(input) {
  const text = safeString(input);
  if (!text || /^\//.test(text)) {
    return false;
  }

  try {
    const hostname = new URL(normalizeUrlForParsing(text)).hostname.toLowerCase();
    return hostname === 'douyin.com'
      || hostname.endsWith('.douyin.com')
      || hostname === 'iesdouyin.com'
      || hostname.endsWith('.iesdouyin.com');
  } catch (error) {
    return false;
  }
}

function isDouyinShortLink(input) {
  const text = safeString(input);
  if (!text || /^\//.test(text)) return false;
  try {
    return new URL(normalizeUrlForParsing(text)).hostname.toLowerCase() === 'v.douyin.com';
  } catch {
    return false;
  }
}

function extractDouyinShortLinkCandidates(input) {
  const urls = sourceFetch.extractUrls(input, Number.MAX_SAFE_INTEGER);
  const candidates = [...urls, ...extractNoProtocolDouyinCandidates(input)]
    .filter(isDouyinShortLink)
    .map(normalizeUrlForParsing);
  return [...new Set(candidates)];
}

function getHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return safeString(headers.get(name));
  return safeString(headers[name] || headers[name.toLowerCase()]);
}

async function resolveDouyinShortLink(shortUrl, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DOUYIN_SHORT_LINK_TIMEOUT_MS,
  maxRedirects = DOUYIN_SHORT_LINK_MAX_REDIRECTS,
} = {}) {
  if (typeof fetchImpl !== 'function') return '';

  let currentUrl = normalizeUrlForParsing(shortUrl);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller?.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        },
      });
      const location = Number(response?.status) >= 300 && Number(response?.status) < 400
        ? getHeader(response.headers, 'location')
        : '';
      if (!location) return safeString(response?.url) || currentUrl;

      currentUrl = new URL(location, currentUrl).href;
      if (extractAwemeId(currentUrl)) return currentUrl;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return currentUrl;
}

function removeUrlFromText(text, url) {
  const sourceText = safeString(text);
  const sourceUrl = safeString(url);
  if (!sourceText || !sourceUrl) {
    return sourceText;
  }

  const punctuation = '[\\s\\u3002\\uff0c\\uff1b\\uff1a\\uff01\\uff1f\\u3001,.;:!?]*';
  const escapedUrl = sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const urlWithNoise = new RegExp(`${punctuation}${escapedUrl}${punctuation}`);
  return sourceText.replace(urlWithNoise, ' ').replace(/\s+/g, ' ').trim();
}

function countRemainingSourceUrls(text) {
  return countSourceUrlOccurrences(text);
}

function countSourceUrlOccurrences(text) {
  const remaining = safeString(text);
  if (!remaining) {
    return 0;
  }

  let count = 0;
  SOURCE_URL_PATTERN.lastIndex = 0;

  for (const match of remaining.matchAll(SOURCE_URL_PATTERN)) {
    const url = match[0].replace(SOURCE_URL_TRAILING_PUNCTUATION_PATTERN, '');
    if (url) {
      count += 1;
    }
  }

  return count;
}

function normalizeUploadAssetIds(value) {
  if (value === undefined || value === null) return { success: true, assetIds: [] };
  if (!Array.isArray(value)) return { success: false, message: '上传素材 ID 列表无效。' };
  const assetIds = [];
  const seen = new Set();
  for (const item of value) {
    const id = safeString(item);
    if (!UPLOAD_ID_PATTERN.test(id)) return { success: false, message: `上传素材 ID 无效：${id || '空值'}。` };
    if (!seen.has(id)) {
      seen.add(id);
      assetIds.push(id);
    }
  }
  return { success: true, assetIds };
}

function normalizeCreativeInput(payload = {}) {
  const useResearch = payload.useResearch === true;
  const skipValidation = payload.skipValidation === true;
  const normalizedAssetIds = normalizeUploadAssetIds(payload.assetIds);
  if (!normalizedAssetIds.success) {
    return createFailureResponse(normalizedAssetIds.message, {
      use_research: useResearch,
      skip_validation: skipValidation,
      asset_ids: [],
    });
  }
  const assetIds = normalizedAssetIds.assetIds;

  const input = safeString(payload.input);
  if (!input) {
    return createFailureResponse('请输入视频方向、抖音 ID 或抖音链接。', {
      use_research: useResearch,
      skip_validation: skipValidation,
      asset_ids: assetIds,
    });
  }

  const awemeId = extractAwemeId(input);
  if (awemeId) {
    return createSuccessResponse({
      mode: 'douyin',
      raw_text: input,
      aweme_id: awemeId,
      douyin_url: /^https?:\/\//i.test(input) ? input : '',
      use_research: useResearch,
      skip_validation: skipValidation,
      asset_ids: assetIds,
    });
  }

  const urls = sourceFetch.extractUrls(input, Number.MAX_SAFE_INTEGER);
  const noProtocolDouyinCandidates = extractNoProtocolDouyinCandidates(input);
  const hasUnrecognizedDouyinUrl =
    isDouyinLink(input) ||
    urls.some(isDouyinLink) ||
    noProtocolDouyinCandidates.some(isDouyinLink);
  if (hasUnrecognizedDouyinUrl) {
    return createFailureResponse('暂时无法从抖音链接中识别视频 ID。', {
      use_research: useResearch,
      skip_validation: skipValidation,
      asset_ids: assetIds,
    });
  }

  const sourceUrls = sourceFetch.extractUrls(input, 3);
  if (sourceUrls.length > 0) {
    const sourceUrl = sourceUrls[0];
    const sourceHint = removeUrlFromText(input, sourceUrl);
    return createSuccessResponse({
      mode: 'source_url',
      raw_text: input,
      source_url: sourceUrl,
      source_hint: sourceHint,
      ignored_url_count: countRemainingSourceUrls(sourceHint),
      use_research: useResearch,
      skip_validation: skipValidation,
      asset_ids: assetIds,
    });
  }

  return createSuccessResponse({
    mode: 'text',
    raw_text: input,
    use_research: useResearch,
    skip_validation: skipValidation,
    asset_ids: assetIds,
  });
}

async function normalizeCreativeInputWithDouyinShortLink(payload = {}, options = {}) {
  const normalized = normalizeCreativeInput(payload);
  if (normalized.success || normalized.message !== '暂时无法从抖音链接中识别视频 ID。') {
    return normalized;
  }

  const shortLinks = extractDouyinShortLinkCandidates(payload.input);
  if (shortLinks.length === 0) return normalized;

  for (const shortLink of shortLinks) {
    try {
      const resolvedUrl = await resolveDouyinShortLink(shortLink, options);
      const awemeId = extractAwemeId(resolvedUrl);
      if (awemeId) {
        return createSuccessResponse({
          mode: 'douyin',
          raw_text: safeString(payload.input),
          aweme_id: awemeId,
          douyin_url: resolvedUrl || shortLink,
          use_research: payload.useResearch === true,
          skip_validation: payload.skipValidation === true,
          asset_ids: normalized.data.asset_ids,
        });
      }
    } catch {}
  }

  return createFailureResponse(DOUYIN_SHORT_LINK_RESOLVE_FAILED_MESSAGE, {
    use_research: payload.useResearch === true,
    skip_validation: payload.skipValidation === true,
    asset_ids: normalized.data.asset_ids,
  });
}

function createTextSourceContext(text) {
  const normalizedText = safeString(text);
  return {
    status: 'ready',
    kind: 'text',
    summary: normalizedText,
    transcript: normalizedText,
    comments_summary: '',
    douyin_metadata: {},
    diagnostics: {
      source_type: 'creative_text',
    },
  };
}

function createDisabledResearchContext({ now } = {}) {
  return {
    status: 'disabled',
    query: '',
    sources: [],
    summary: '',
    updated_at: now || '',
  };
}

function createPendingResearchContext({ query, now } = {}) {
  return {
    status: 'pending',
    query: safeString(query),
    sources: [],
    summary: '联网研究将在后台任务中执行。',
    updated_at: now || '',
  };
}

function createDisabledAssetContext({ now } = {}) {
  return {
    status: 'disabled',
    assets: [],
    updated_at: now || '',
  };
}

function createClaimedAssetContext({ assets, now } = {}) {
  const claimedAssets = Array.isArray(assets) ? assets : [];
  if (claimedAssets.length === 0) return createDisabledAssetContext({ now });
  return {
    status: 'ready',
    assets: claimedAssets,
    summary: `已认领 ${claimedAssets.length} 张用户上传图片。`,
    diagnostics: [],
    updated_at: now || '',
  };
}

function createPendingDouyinSourceContext(input = {}) {
  return {
    status: 'pending',
    kind: 'douyin',
    summary: '',
    transcript: '',
    comments_summary: '',
    douyin_metadata: {
      aweme_id: safeString(input.aweme_id),
      douyin_url: safeString(input.douyin_url),
    },
    diagnostics: {},
  };
}

function createStableCreativeInput(input = {}, now = '') {
  return {
    ...createNormalizedData(input || {}),
    use_research: input && input.use_research === true,
    asset_ids: Array.isArray(input && input.asset_ids) ? [...input.asset_ids] : [],
    created_at: now || '',
  };
}

function createDefaultSourceContext(input = {}) {
  if (input.mode === 'douyin') {
    return createPendingDouyinSourceContext(input);
  }

  return createTextSourceContext(input.raw_text);
}

function buildCreativeContext({
  input,
  sourceContext,
  researchContext,
  assetContext,
  now,
} = {}) {
  const createdAt = now || '';
  const normalizedInput = createStableCreativeInput(input, createdAt);

  return {
    input: normalizedInput,
    source_context: sourceContext || createDefaultSourceContext(normalizedInput),
    research_context: researchContext || createDisabledResearchContext({ now: createdAt }),
    asset_context: assetContext || createDisabledAssetContext({ now: createdAt }),
  };
}

module.exports = {
  AWEME_ID_PATTERN,
  normalizeCreativeInput,
  normalizeCreativeInputWithDouyinShortLink,
  extractAwemeId,
  createTextSourceContext,
  createDisabledResearchContext,
  createPendingResearchContext,
  createDisabledAssetContext,
  createClaimedAssetContext,
  buildCreativeContext,
};
