const aiModelConfig = require('./aiModelConfig');

const DEFAULT_MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1';
const DEFAULT_MIMO_TTS_MODEL = 'mimo-v2.5-tts';
const DEFAULT_MIMO_VOICE = 'mimo_default';
const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimaxi.com/v1';
const DEFAULT_MINIMAX_TTS_MODEL = 'speech-2.8-hd';
const DEFAULT_MINIMAX_VOICE = 'Chinese_deep_voiced_male_nv1';
const DEFAULT_AUDIO_FORMAT = 'wav';
const DEFAULT_TTS_CONCURRENCY = 1;
const DEFAULT_TTS_QUEUE_INTERVAL_MS = 1800;
const DEFAULT_TTS_REQUEST_TIMEOUT_MS = 60000;
const ttsQueues = new Map();

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProvider(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeBaseUrl(value) {
  return normalizeString(value).replace(/\/+$/, '');
}

function toModelInfo(provider, modelId) {
  return {
    provider: provider || '',
    model_id: modelId || '',
  };
}

function isMimoProvider(value) {
  const provider = normalizeProvider(value);
  return provider === 'mimo' || provider === 'xiaomi' || provider === 'xiaomimimo';
}

function isMiniMaxProvider(value) {
  const provider = normalizeProvider(value);
  return provider === 'minimax' || provider === 'minimaxi' || provider === 'mini-max';
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetryStatus(status) {
  return [429, 502, 503, 504].includes(Number(status));
}

function normalizeInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function enqueueTtsRequest(task, options = {}) {
  const waitImpl = typeof options.waitImpl === 'function' ? options.waitImpl : wait;
  const concurrency = normalizeInteger(options.concurrency, DEFAULT_TTS_CONCURRENCY, 1, 5);
  const intervalMs = Math.max(0, Number(options.intervalMs ?? DEFAULT_TTS_QUEUE_INTERVAL_MS) || 0);
  const queueKey = String(options.queueKey || 'default');
  let queue = ttsQueues.get(queueKey);
  if (!queue || queue.concurrency !== concurrency) {
    queue = {
      concurrency,
      tails: Array.from({ length: concurrency }, () => Promise.resolve()),
      nextIndex: 0,
    };
    ttsQueues.set(queueKey, queue);
  }

  const index = queue.nextIndex;
  queue.nextIndex = (queue.nextIndex + 1) % queue.concurrency;
  const queued = queue.tails[index].then(async () => {
    const result = await task();
    if (intervalMs > 0) {
      await waitImpl(intervalMs);
    }
    return result;
  });
  queue.tails[index] = queued.catch(() => {});
  return queued;
}

function extractAudioData(payload, provider) {
  if (!payload || typeof payload !== 'object') return '';
  if (provider === 'minimax') {
    return payload.data?.audio || payload.audio || '';
  }
  return payload.choices?.[0]?.message?.audio?.data
    || payload.choices?.[0]?.message?.audio?.audio
    || payload.choices?.[0]?.audio?.data
    || payload.choices?.[0]?.audio?.audio
    || payload.audio?.data
    || payload.audio?.audio
    || payload.audio_data
    || payload.audioContent
    || payload.data;
}

async function resolveTtsRuntime(options = {}) {
  const env = options.env || process.env;
  const storedConfig = options.ttsConfig || await aiModelConfig.getRuntimeConfig('tts', {
    configPath: options.configPath,
  });
  const storedEnabled = storedConfig?.enabled === true && !!storedConfig.apiKey;
  const provider = normalizeProvider(env.TTS_PROVIDER || (storedEnabled ? storedConfig.provider : ''));
  const providerName = normalizeProvider(storedConfig?.providerName);
  const requestedModelId = env.MINIMAX_TTS_MODEL || env.MIMO_TTS_MODEL || env.TTS_MODEL || storedConfig?.modelId || '';
  const isMiniMax = isMiniMaxProvider(provider) || isMiniMaxProvider(providerName)
    || requestedModelId.toLowerCase().startsWith('speech-');
  const isMimo = !isMiniMax && (isMimoProvider(provider) || isMimoProvider(providerName)
    || requestedModelId.toLowerCase().startsWith('mimo'));
  const resolvedProvider = isMiniMax ? 'minimax' : (isMimo ? 'mimo' : (provider || providerName));
  const envApiKey = resolvedProvider === 'minimax'
    ? (env.MINIMAX_API_KEY || env.TTS_API_KEY)
    : (env.MIMO_API_KEY || env.TTS_API_KEY);
  const envBaseUrl = resolvedProvider === 'minimax'
    ? (env.MINIMAX_BASE_URL || env.TTS_BASE_URL)
    : (env.MIMO_BASE_URL || env.TTS_BASE_URL);

  return {
    configured: !!(envApiKey || (storedEnabled ? storedConfig.apiKey : '')),
    provider: resolvedProvider,
    apiKey: envApiKey || (storedEnabled ? storedConfig.apiKey : ''),
    baseUrl: normalizeBaseUrl(
      envBaseUrl
      || storedConfig?.baseUrl
      || (resolvedProvider === 'minimax' ? DEFAULT_MINIMAX_BASE_URL : DEFAULT_MIMO_BASE_URL)
    ),
    modelId: requestedModelId || (resolvedProvider === 'minimax' ? DEFAULT_MINIMAX_TTS_MODEL : DEFAULT_MIMO_TTS_MODEL),
    voiceId: normalizeString(storedConfig?.voiceId) || DEFAULT_MINIMAX_VOICE,
    ttsConcurrency: storedConfig?.ttsConcurrency,
    ttsQueueIntervalMs: storedConfig?.ttsQueueIntervalMs,
  };
}

async function callTtsModel(options = {}) {
  const text = normalizeString(options.text);
  const stylePrompt = normalizeString(options.stylePrompt) || '请使用自然、清晰、适合短视频口播的语气。';
  const format = normalizeString(options.format) || DEFAULT_AUDIO_FORMAT;
  const runtime = await resolveTtsRuntime(options);
  const requestedVoice = normalizeString(options.voice);
  const voice = runtime.provider === 'minimax'
    ? (requestedVoice && requestedVoice !== DEFAULT_MIMO_VOICE ? requestedVoice : runtime.voiceId)
    : (requestedVoice || DEFAULT_MIMO_VOICE);
  const model = toModelInfo(runtime.provider, runtime.modelId);

  if (!text) {
    return {
      success: false,
      status: 'failed',
      message: 'TTS 合成失败：改写脚本为空。',
      model,
    };
  }

  if (!runtime.configured || !['mimo', 'minimax'].includes(runtime.provider) || !runtime.baseUrl || !runtime.modelId) {
    return {
      success: false,
      status: 'not_configured',
      message: 'TTS 语音合成模型未配置。请到设置页启用 TTS 模型，并填写 API Key、Base URL 和模型 ID。',
      model,
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const waitImpl = typeof options.waitImpl === 'function' ? options.waitImpl : wait;
  const retryLimit = Math.max(0, Number(options.maxRetries ?? 2) || 0);
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 1500) || 0);
  const ttsConcurrency = normalizeInteger(options.ttsConcurrency ?? runtime.ttsConcurrency, DEFAULT_TTS_CONCURRENCY, 1, 5);
  const ttsQueueIntervalMs = Math.max(0, Number(options.ttsQueueIntervalMs ?? runtime.ttsQueueIntervalMs ?? DEFAULT_TTS_QUEUE_INTERVAL_MS) || 0);
  if (typeof fetchImpl !== 'function') {
    return {
      success: false,
      status: 'failed',
      message: 'TTS 合成失败：当前运行环境缺少 fetch 实现。',
      model,
    };
  }

  let payload = null;
  let response = null;
  let lastAttempt = 0;
  const requestTimeoutMs = normalizeInteger(options.requestTimeoutMs ?? DEFAULT_TTS_REQUEST_TIMEOUT_MS, DEFAULT_TTS_REQUEST_TIMEOUT_MS, 5000, 300000);
  try {
    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      lastAttempt = attempt;
      response = await enqueueTtsRequest(() => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
        const isMiniMax = runtime.provider === 'minimax';
        return fetchImpl(`${runtime.baseUrl}${isMiniMax ? '/t2a_v2' : '/chat/completions'}`, {
          method: 'POST',
          headers: isMiniMax ? {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${runtime.apiKey}`,
          } : {
            'Content-Type': 'application/json',
            'api-key': runtime.apiKey,
          },
          body: JSON.stringify(isMiniMax ? {
            model: runtime.modelId,
            text,
            stream: false,
            output_format: 'hex',
            voice_setting: {
              voice_id: voice,
              speed: 1,
              vol: 1,
              pitch: 0,
            },
            audio_setting: {
              sample_rate: 32000,
              bitrate: 128000,
              format,
              channel: 1,
            },
            subtitle_enable: false,
          } : {
              model: runtime.modelId,
              messages: [
                {
                  role: 'user',
                  content: stylePrompt,
                },
                {
                  role: 'assistant',
                  content: text,
                },
              ],
              modalities: ['text', 'audio'],
              audio: {
                format,
                voice,
              },
            }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
      }, {
          waitImpl,
          concurrency: ttsConcurrency,
          intervalMs: ttsQueueIntervalMs,
          queueKey: `${runtime.provider}:${runtime.baseUrl}:${runtime.modelId}`,
        });
      payload = await response.json().catch(() => null);

      if (!shouldRetryStatus(response.status) || attempt >= retryLimit) break;
      // 对 502/503/504 使用指数退避
      const isServerError = [502, 503, 504].includes(Number(response.status));
      const delay = isServerError
        ? retryDelayMs * Math.pow(2, attempt)
        : retryDelayMs * (attempt + 1);
      console.warn(`[TTS] HTTP ${response.status}，${attempt + 1}/${retryLimit + 1} 次尝试，${delay}ms 后重试...`);
      await waitImpl(delay);
    }

    if (!response.ok) {
      const detail = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
      const requestPath = runtime.provider === 'minimax' ? '/t2a_v2' : '/chat/completions';
      const hint = response.status === 502
        ? 'TTS 服务暂时不可用（502 Bad Gateway），请稍后重试。如持续出现，请检查 Base URL 配置是否正确。'
        : response.status === 429
          ? '请求过于频繁，请稍后重试。'
          : '';
      console.error(`[TTS] 请求失败: HTTP ${response.status}`, {
        url: `${runtime.baseUrl}${requestPath}`,
        model: runtime.modelId,
        textLength: text.length,
        attempt: lastAttempt + 1,
        maxRetries: retryLimit,
        error: detail,
      });
      return {
        success: false,
        status: 'failed',
        message: `TTS 合成失败：${detail}${hint ? '\n' + hint : ''}`,
        model,
        raw_response: payload,
        http_status: response.status,
      };
    }

    if (runtime.provider === 'minimax' && Number(payload?.base_resp?.status_code || 0) !== 0) {
      const detail = payload?.base_resp?.status_msg || `MiniMax 错误码 ${payload?.base_resp?.status_code}`;
      return {
        success: false,
        status: 'failed',
        message: `TTS 合成失败：${detail}`,
        model,
        raw_response: payload,
        http_status: response.status,
      };
    }
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    return {
      success: false,
      status: 'failed',
      message: isTimeout
        ? `TTS 合成失败：请求超时（${requestTimeoutMs / 1000}秒），TTS API 未响应。`
        : `TTS 合成失败：${error.message}`,
      model,
    };
  }

  const audioData = extractAudioData(payload, runtime.provider);
  if (!audioData || typeof audioData !== 'string') {
    console.error('[TTS] 未返回有效音频数据，payload 结构:', JSON.stringify(payload, (key, value) => {
      if (key === 'data' && typeof value === 'string' && value.length > 100) return `[audio ${value.length} chars]`;
      return value;
    }, 2));
    return {
      success: false,
      status: 'failed',
      message: 'TTS 合成失败：接口未返回有效音频数据。',
      model,
      raw_response: payload,
    };
  }

  return {
    success: true,
    status: 'done',
    message: 'TTS 语音合成完成。',
    audioBuffer: Buffer.from(audioData, runtime.provider === 'minimax' ? 'hex' : 'base64'),
    format,
    voice,
    model,
    raw_response: payload,
  };
}

module.exports = {
  DEFAULT_MIMO_BASE_URL,
  DEFAULT_MIMO_TTS_MODEL,
  DEFAULT_MIMO_VOICE,
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_MINIMAX_TTS_MODEL,
  DEFAULT_MINIMAX_VOICE,
  DEFAULT_AUDIO_FORMAT,
  DEFAULT_TTS_CONCURRENCY,
  DEFAULT_TTS_QUEUE_INTERVAL_MS,
  DEFAULT_TTS_REQUEST_TIMEOUT_MS,
  callTtsModel,
  enqueueTtsRequest,
  resolveTtsRuntime,
  shouldRetryStatus,
};
