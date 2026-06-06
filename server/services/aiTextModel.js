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
    };
  }

  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
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

  const rawResponse = await readJsonResponse(response);

  if (!response.ok) {
    const detail = getProviderError(rawResponse) || `HTTP ${response.status}`;
    return {
      success: false,
      configured: true,
      message: `${provider || '文本模型'} 调用失败：${detail}`,
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
      raw_response: rawResponse,
    };
  }

  return {
    success: true,
    configured: true,
    text,
    model: {
      provider,
      model_id: modelId,
    },
    raw_response: rawResponse,
  };
}

module.exports = {
  callTextModel,
};
