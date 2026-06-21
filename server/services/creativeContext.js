const AWEME_ID_PATTERN = /^\d{5,32}$/;
const sourceFetch = require('./sourceFetch');

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
    return hostname === 'douyin.com' || hostname.endsWith('.douyin.com');
  } catch (error) {
    return false;
  }
}

function removeUrlFromText(text, url) {
  const sourceText = safeString(text);
  const sourceUrl = safeString(url);
  if (!sourceText || !sourceUrl) {
    return sourceText;
  }

  const punctuation = '[\\s\\u3002\\uff0c\\uff1b\\uff1a\\uff01\\uff1f\\u3001,.;:!?]*';
  const escapedUrl = sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const urlWithNoise = new RegExp(`${punctuation}${escapedUrl}${punctuation}`, 'g');
  return sourceText.replace(urlWithNoise, ' ').replace(/\s+/g, ' ').trim();
}

function extractUrlOccurrences(text) {
  const raw = String(text || '');
  const matches = raw.match(/https?:\/\/[^\s<>"'`)\]}，。；;]+/gi) || [];
  return matches
    .map(match => match.replace(/[.,;:!?，。；：！？]+$/, ''))
    .filter(Boolean);
}

function normalizeCreativeInput(payload = {}) {
  const assetIds = Array.isArray(payload.assetIds) ? [...payload.assetIds] : [];
  const useResearch = payload.useResearch === true;
  const skipValidation = payload.skipValidation === true;

  if (assetIds.length > 0) {
    return createFailureResponse('图片素材将在下一阶段开放。', {
      use_research: useResearch,
      skip_validation: skipValidation,
      asset_ids: [],
    });
  }

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
    const urlOccurrences = extractUrlOccurrences(input);
    return createSuccessResponse({
      mode: 'source_url',
      raw_text: input,
      source_url: sourceUrl,
      source_hint: removeUrlFromText(input, sourceUrl),
      ignored_url_count: Math.max(0, urlOccurrences.length - 1),
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
  extractAwemeId,
  createTextSourceContext,
  createDisabledResearchContext,
  createPendingResearchContext,
  createDisabledAssetContext,
  buildCreativeContext,
};
