const aiModelConfig = require('./aiModelConfig');

const DEFAULT_MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1';
const DEFAULT_MIMO_TTS_MODEL = 'mimo-v2.5-tts';
const DEFAULT_MIMO_VOICE = 'mimo_default';
const DEFAULT_AUDIO_FORMAT = 'wav';

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
  if (typeof fetchImpl !== 'function') {
    return {
      success: false,
      status: 'failed',
      message: 'TTS 合成失败：当前运行环境缺少 fetch 实现。',
      model,
    };
  }

  let payload = null;
  try {
    const response = await fetchImpl(`${runtime.baseUrl}/chat/completions`, {
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
    });
    payload = await response.json().catch(() => null);

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
    return {
      success: false,
      status: 'failed',
      message: `TTS 合成失败：${error.message}`,
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
  callTtsModel,
  resolveTtsRuntime,
};
