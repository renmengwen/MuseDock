const AWEME_ID_PATTERN = /^\d{5,32}$/;

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

  const videoMatch = text.match(/\/video\/(\d{5,32})(?=\D|$)/);
  if (videoMatch && AWEME_ID_PATTERN.test(videoMatch[1])) {
    return videoMatch[1];
  }

  const queryMatch = text.match(/(?:^|[?&])(?:modal_id|aweme_id)=(\d{5,32})(?=\D|$)/);
  if (queryMatch && AWEME_ID_PATTERN.test(queryMatch[1])) {
    return queryMatch[1];
  }

  return '';
}

function createNormalizedData(overrides = {}) {
  return {
    mode: '',
    raw_text: '',
    aweme_id: '',
    douyin_url: '',
    use_research: false,
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

function isDouyinLink(input) {
  const text = safeString(input);
  if (!/^https?:\/\//i.test(text)) {
    return false;
  }

  try {
    const hostname = new URL(text).hostname.toLowerCase();
    return hostname === 'douyin.com' || hostname.endsWith('.douyin.com');
  } catch (error) {
    return false;
  }
}

function normalizeCreativeInput(payload = {}) {
  const assetIds = Array.isArray(payload.assetIds) ? [...payload.assetIds] : [];
  const useResearch = payload.useResearch === true;
  const skipValidation = payload.skipValidation === true;

  if (assetIds.length > 0) {
    return createFailureResponse('图片素材将在下一阶段开放。', {
      use_research: useResearch,
      asset_ids: [],
    });
  }

  const input = safeString(payload.input);
  if (!input) {
    return createFailureResponse('请输入视频方向、抖音 ID 或抖音链接。', {
      use_research: useResearch,
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

  if (isDouyinLink(input)) {
    return createFailureResponse('暂时无法从抖音链接中识别视频 ID。', {
      use_research: useResearch,
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
  createDisabledAssetContext,
  buildCreativeContext,
};
