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

function createBaseNormalizedInput(overrides = {}) {
  return {
    success: true,
    message: '',
    mode: '',
    raw_text: '',
    aweme_id: '',
    douyin_url: '',
    use_research: false,
    asset_ids: [],
    ...overrides,
  };
}

function normalizeCreativeInput(payload = {}) {
  const assetIds = Array.isArray(payload.assetIds) ? [...payload.assetIds] : [];
  const useResearch = payload.useResearch === true;

  if (assetIds.length > 0) {
    return createBaseNormalizedInput({
      success: false,
      message: '图片素材将在下一阶段开放。',
      use_research: useResearch,
      asset_ids: [],
      data: {
        asset_ids: [],
      },
    });
  }

  const input = safeString(payload.input);
  if (!input) {
    return createBaseNormalizedInput({
      success: false,
      message: '请输入视频方向、抖音 ID 或抖音链接。',
      use_research: useResearch,
      asset_ids: assetIds,
    });
  }

  const awemeId = extractAwemeId(input);
  if (awemeId) {
    return createBaseNormalizedInput({
      mode: 'douyin',
      aweme_id: awemeId,
      douyin_url: /^https?:\/\//i.test(input) ? input : '',
      use_research: useResearch,
      asset_ids: assetIds,
    });
  }

  return createBaseNormalizedInput({
    mode: 'text',
    raw_text: input,
    use_research: useResearch,
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

function buildCreativeContext({
  input,
  sourceContext,
  researchContext,
  assetContext,
  now,
} = {}) {
  const createdAt = now || '';
  const normalizedInput = {
    ...(input || {}),
    created_at: createdAt,
  };

  return {
    input: normalizedInput,
    source_context: sourceContext || createTextSourceContext(normalizedInput.raw_text),
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
