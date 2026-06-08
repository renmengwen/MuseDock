const aiModelConfig = require('./aiModelConfig');

function normalizeBaseUrl(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function readJsonResponse(response, apiKey) {
  if (response && typeof response.text === 'function') {
    try {
      const text = await response.text();
      try {
        return {
          data: JSON.parse(text),
          parseError: '',
          rawText: '',
          contentType: response.headers?.get?.('content-type') || '',
        };
      } catch (error) {
        return {
          data: null,
          parseError: error?.message || '响应不是有效 JSON',
          rawText: sanitizeErrorDetail(text, apiKey),
          contentType: response.headers?.get?.('content-type') || '',
        };
      }
    } catch {
      // Fall through to response.json() for fetch-compatible test doubles.
    }
  }

  try {
    return {
      data: await response.json(),
      parseError: '',
      rawText: '',
      contentType: response?.headers?.get?.('content-type') || '',
    };
  } catch (error) {
    return {
      data: null,
      parseError: error?.message || '响应不是有效 JSON',
      rawText: '',
      contentType: response?.headers?.get?.('content-type') || '',
    };
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

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetryStatus(status) {
  return [502, 503, 504].includes(Number(status));
}

async function callTextModel(options = {}) {
  const {
    messages = [],
    configPath,
    fetchImpl = global.fetch,
    temperature = 0.4,
    textConfig,
    maxRetries = 1,
    retryDelayMs = 1200,
  } = options;

  const config = textConfig || await aiModelConfig.getRuntimeConfig('text', { configPath });
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
  let attempt = 0;
  const retryLimit = Math.max(0, Number(maxRetries) || 0);
  while (attempt <= retryLimit) {
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

    if (!shouldRetryStatus(response.status) || attempt >= retryLimit) break;
    await wait(retryDelayMs * (attempt + 1));
    attempt += 1;
  }

  const parsedResponse = await readJsonResponse(response, apiKey);
  const rawResponse = sanitizeRawResponse(parsedResponse.data, apiKey);

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

  if (parsedResponse.parseError && parsedResponse.rawText) {
    return {
      success: false,
      configured: true,
      message: `${provider || '文本模型'} 返回了非 JSON 响应，请检查 Base URL 是否指向兼容接口地址。`,
      model: toModelInfo(provider, modelId),
      raw_response: {
        content_type: parsedResponse.contentType,
        parse_error: sanitizeErrorDetail(parsedResponse.parseError, apiKey),
        preview: parsedResponse.rawText.slice(0, 500),
      },
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
