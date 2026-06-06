const aiModelConfig = require('./aiModelConfig');

function normalizeBaseUrl(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getProviderError(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'object') return '';
  const error = rawResponse.error;
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  if (typeof rawResponse.message === 'string') return rawResponse.message;
  return '';
}

function sanitizeErrorDetail(detail, apiKey) {
  const text = normalizeString(detail);
  if (!text) return '';
  return apiKey ? text.split(apiKey).join('[已隐藏]') : text;
}

function sanitizeRawResponse(value, apiKey) {
  if (!apiKey || value == null) return value;
  if (typeof value === 'string') {
    return sanitizeErrorDetail(value, apiKey);
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeRawResponse(item, apiKey));
  }
  if (typeof value === 'object') {
    const sanitized = {};
    for (const [key, item] of Object.entries(value)) {
      sanitized[key] = sanitizeRawResponse(item, apiKey);
    }
    return sanitized;
  }
  return value;
}

function toModelInfo(provider, modelId) {
  return {
    provider,
    model_id: modelId,
  };
}

async function callTextModel(options = {}) {
  const {
    messages = [],
    configPath,
    fetchImpl = global.fetch,
    temperature = 0.4,
  } = options;

  const config = await aiModelConfig.getRuntimeConfig('text', { configPath });
  const provider = normalizeString(config && config.provider);
  const apiKey = normalizeString(config && config.apiKey);
  const baseUrl = normalizeBaseUrl(config && config.baseUrl);
  const modelId = normalizeString(config && config.modelId);

  if (!config || config.enabled !== true || !apiKey || !baseUrl || !modelId) {
    return {
      success: false,
      configured: false,
      message: '文本模型未配置，请先在 AI 模型配置中填写文本模型的 API Key、Base URL 和模型 ID。',
    };
  }

  if (typeof fetchImpl !== 'function') {
    return {
      success: false,
      configured: true,
      message: '文本模型请求失败：当前运行环境缺少 fetch 实现。',
      model: toModelInfo(provider, modelId),
    };
  }

  let response;
  try {
    response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature,
      }),
    });
  } catch (error) {
    const detail = sanitizeErrorDetail(error && error.message, apiKey) || '网络请求异常';
    return {
      success: false,
      configured: true,
      message: `文本模型调用失败：${detail}`,
      model: toModelInfo(provider, modelId),
    };
  }

  const rawResponse = sanitizeRawResponse(await readJsonResponse(response), apiKey);

  if (!response.ok) {
    const detail = sanitizeErrorDetail(getProviderError(rawResponse), apiKey) || `HTTP ${response.status}`;
    return {
      success: false,
      configured: true,
      message: `${provider || '文本模型'} 调用失败：${detail}`,
      model: toModelInfo(provider, modelId),
      raw_response: rawResponse,
    };
  }

  const text = rawResponse && rawResponse.choices && rawResponse.choices[0]
    && rawResponse.choices[0].message && rawResponse.choices[0].message.content;

  if (typeof text !== 'string') {
    return {
      success: false,
      configured: true,
      message: `${provider || '文本模型'} 返回结果缺少文本内容。`,
      model: toModelInfo(provider, modelId),
      raw_response: rawResponse,
    };
  }

  return {
    success: true,
    configured: true,
    text,
    model: toModelInfo(provider, modelId),
    raw_response: rawResponse,
  };
}

module.exports = {
  callTextModel,
};
