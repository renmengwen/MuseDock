const aiModelConfig = require('./aiModelConfig');

const DEFAULT_MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1';
const DEFAULT_MIMO_TTS_MODEL = 'mimo-v2.5-tts';
const DEFAULT_MIMO_VOICE = 'mimo_default';
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

function extractAudioData(payload) {
  return payload?.choices?.[0]?.message?.audio?.data
    || payload?.choices?.[0]?.message?.audio?.audio
    || payload?.audio?.data
    || payload?.data;
}

async function resolveTtsRuntime(options = {}) {
  const env = options.env || process.env;
  const storedConfig = options.ttsConfig || await aiModelConfig.getRuntimeConfig('tts', {
    configPath: options.configPath,
  });
  const storedEnabled = storedConfig?.enabled === true && !!storedConfig.apiKey;
  const provider = normalizeProvider(env.TTS_PROVIDER || (storedEnabled ? storedConfig.provider : ''));
  const isMimo = provider === 'mimo' || provider === 'xiaomi' || provider === 'xiaomimimo';

  return {
    configured: !!(env.MIMO_API_KEY || env.TTS_API_KEY || (storedEnabled ? storedConfig.apiKey : '')),
    provider: isMimo ? 'mimo' : (provider || normalizeProvider(storedConfig?.provider)),
    apiKey: env.MIMO_API_KEY || env.TTS_API_KEY || (storedEnabled ? storedConfig.apiKey : ''),
    baseUrl: normalizeBaseUrl(env.MIMO_BASE_URL || env.TTS_BASE_URL || storedConfig?.baseUrl || DEFAULT_MIMO_BASE_URL),
    modelId: env.MIMO_TTS_MODEL || env.TTS_MODEL || storedConfig?.modelId || DEFAULT_MIMO_TTS_MODEL,
    ttsConcurrency: storedConfig?.ttsConcurrency,
    ttsQueueIntervalMs: storedConfig?.ttsQueueIntervalMs,
  };
}

async function callTtsModel(options = {}) {
  const text = normalizeString(options.text);
  const voice = normalizeString(options.voice) || DEFAULT_MIMO_VOICE;
  const stylePrompt = normalizeString(options.stylePrompt) || '请使用自然、清晰、适合短视频口播的语气。';
  const format = normalizeString(options.format) || DEFAULT_AUDIO_FORMAT;
  const runtime = await resolveTtsRuntime(options);
  const model = toModelInfo(runtime.provider, runtime.modelId);

  if (!text) {
    return {
      success: false,
      status: 'failed',
      message: 'TTS 合成失败：改写脚本为空。',
      model,
    };
  }

  if (!runtime.configured || runtime.provider !== 'mimo' || !runtime.baseUrl || !runtime.modelId) {
    return {
      success: false,
      status: 'not_configured',
      message: 'TTS 语音合成模型未配置。请到设置页启用 TTS 模型，并填写 MiMo API Key、Base URL 和模型 ID。',
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
  const requestTimeoutMs = normalizeInteger(options.requestTimeoutMs ?? DEFAULT_TTS_REQUEST_TIMEOUT_MS, DEFAULT_TTS_REQUEST_TIMEOUT_MS, 5000, 300000);
  try {
    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      response = await enqueueTtsRequest(() => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
        return fetchImpl(`${runtime.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': runtime.apiKey,
          },
          body: JSON.stringify({
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
      await waitImpl(retryDelayMs * (attempt + 1));
    }

    if (!response.ok) {
      const detail = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
      return {
        success: false,
        status: 'failed',
        message: `TTS 合成失败：${detail}`,
        model,
        raw_response: payload,
      };
    }
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    return {
      success: false,
      status: 'failed',
      message: isTimeout
        ? `TTS 合成失败：请求超时（${requestTimeoutMs / 1000}秒），MiMo API 未响应。`
        : `TTS 合成失败：${error.message}`,
      model,
    };
  }

  const audioData = extractAudioData(payload);
  if (!audioData || typeof audioData !== 'string') {
    return {
      success: false,
      status: 'failed',
      message: 'TTS 合成失败：MiMo 未返回有效音频数据。',
      model,
      raw_response: payload,
    };
  }

  return {
    success: true,
    status: 'done',
    message: 'TTS 语音合成完成。',
    audioBuffer: Buffer.from(audioData, 'base64'),
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
  DEFAULT_AUDIO_FORMAT,
  DEFAULT_TTS_CONCURRENCY,
  DEFAULT_TTS_QUEUE_INTERVAL_MS,
  DEFAULT_TTS_REQUEST_TIMEOUT_MS,
  callTtsModel,
  enqueueTtsRequest,
  resolveTtsRuntime,
  shouldRetryStatus,
};
