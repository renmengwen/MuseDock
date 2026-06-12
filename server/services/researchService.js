function safeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function normalizeSource(source = {}, now = '') {
  return {
    title: safeString(source.title),
    url: safeString(source.url),
    published_at: safeString(source.published_at),
    retrieved_at: safeString(source.retrieved_at) || safeString(now),
    summary: safeString(source.summary),
    evidence: safeString(source.evidence),
  };
}

async function createResearchContext({
  enabled,
  query,
  now,
  provider,
} = {}) {
  const updatedAt = safeString(now);

  if (enabled !== true) {
    return {
      status: 'disabled',
      query: '',
      sources: [],
      summary: '',
      updated_at: updatedAt,
    };
  }

  const normalizedQuery = safeString(query);

  if (typeof provider !== 'function') {
    return {
      status: 'failed',
      query: normalizedQuery,
      sources: [],
      summary: '联网研究服务未配置，请关闭联网获取最新资料后重试。',
      updated_at: updatedAt,
    };
  }

  try {
    const result = await provider({ query: normalizedQuery });
    const sources = Array.isArray(result && result.sources)
      ? result.sources.map(source => normalizeSource(source, updatedAt))
      : [];

    return {
      status: 'ready',
      query: normalizedQuery,
      sources,
      summary: safeString(result && result.summary),
      updated_at: updatedAt,
    };
  } catch (error) {
    return {
      status: 'failed',
      query: normalizedQuery,
      sources: [],
      summary: `联网研究失败：${safeString(error && error.message) || '未知错误'}`,
      updated_at: updatedAt,
    };
  }
}

module.exports = {
  createResearchContext,
  normalizeSource,
};
