const fsp = require('fs/promises');
const path = require('path');
const { normalizeDoubaoSettings } = require('./doubaoTts');
const { BUILTIN_INDEXTTS_REF, normalizeIndexTts } = require('./indexTtsSettings');

const DEFAULT_CONFIG_PATH = path.join(require('../../dataRoot'), 'data/config/ai-models.json');

const MODEL_TYPES = ['asr', 'text', 'image', 'video', 'tts'];

const MODEL_TYPE_LABELS = {
  asr: 'ASR 转写',
  text: '分析模型',
  image: '图片生成',
  video: '视频生成',
  tts: 'TTS 语音合成',
};

const MODEL_PROTOCOLS = ['openai-responses', 'openai-chat-completions', 'anthropic-messages'];
const DEFAULT_MODEL_PROTOCOL = 'openai-responses';
const DEFAULT_MINIMAX_VOICE_ID = 'Chinese_deep_voiced_male_nv1';
const BUILTIN_FUNASR_REF = 'builtin/funasr';
const DEFAULT_FUNASR_BASE_URL = 'http://127.0.0.1:8000/v1';
const BUILTIN_FIRERED_REF = 'builtin/firered';
const DEFAULT_FIRERED_BASE_URL = 'http://127.0.0.1:8001/v1';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value) {
  return normalizeString(value).replace(/\/+$/, '');
}

function normalizeProtocol(value) {
  const protocol = normalizeString(value);
  return MODEL_PROTOCOLS.includes(protocol) ? protocol : DEFAULT_MODEL_PROTOCOL;
}

function normalizeInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function maskApiKey(apiKey) {
  if (!apiKey) return '';
  const value = String(apiKey);
  if (value.startsWith('sk-') && value.length > 7) return `sk-****${value.slice(-4)}`;
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

function emptyModelEntry() {
  return { enabled: false, modelId: '', note: '' };
}

function normalizeProvider(id, input = {}) {
  const models = {};
  const inputModels = input.models && typeof input.models === 'object' ? input.models : {};
  for (const type of MODEL_TYPES) {
    const raw = inputModels[type] && typeof inputModels[type] === 'object' ? inputModels[type] : {};
    const entry = {
      enabled: raw.enabled === true,
      modelId: normalizeString(raw.modelId),
      note: normalizeString(raw.note),
    };
    if (type === 'asr') {
      entry.backend = ['funasr', 'firered'].includes(raw.backend) ? raw.backend : 'mimo';
    }
    if (type === 'text') {
      entry.supportsMultimodal = raw.supportsMultimodal === true;
    }
    if (type === 'tts') {
      entry.voiceId = normalizeString(raw.voiceId) || DEFAULT_MINIMAX_VOICE_ID;
      entry.ttsConcurrency = normalizeInteger(raw.ttsConcurrency, 1, 1, 5);
      entry.ttsQueueIntervalMs = normalizeInteger(raw.ttsQueueIntervalMs, 1800, 0, 10000);
      entry.doubao = normalizeDoubaoSettings(raw.doubao);
    }
    models[type] = entry;
  }
  return {
    id,
    name: normalizeString(input.name) || id,
    protocol: normalizeProtocol(input.protocol),
    apiKey: normalizeString(input.apiKey),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    models,
  };
}

function normalizeActive(input = {}) {
  const active = {};
  for (const type of MODEL_TYPES) {
    const raw = normalizeString(input[type]);
    active[type] = type === 'asr' && (!raw || raw === BUILTIN_FUNASR_REF) ? BUILTIN_FIRERED_REF
      : type === 'tts' && !raw ? BUILTIN_INDEXTTS_REF : raw;
  }
  return active;
}

function normalizeStoredConfig(input = {}, previous = {}) {
  const providers = {};
  const inputProviders = input.providers && typeof input.providers === 'object' ? input.providers : {};
  const prevProviders = previous.providers && typeof previous.providers === 'object' ? previous.providers : {};
  for (const [id, raw] of Object.entries(inputProviders)) {
    if (raw && typeof raw === 'object') {
      const normalized = normalizeProvider(id, raw);
      if (!normalized.apiKey && prevProviders[id]?.apiKey) {
        normalized.apiKey = prevProviders[id].apiKey;
      }
      providers[id] = normalized;
    }
  }
  const active = normalizeActive(input.active);
  const skipValidation = input.skipValidation === true;
  const analysisStreaming = (input.analysisStreaming ?? previous.analysisStreaming) === true;
  const localAsrInput = input.localAsr ?? previous.localAsr;
  const localAsr = {
    baseUrl: normalizeBaseUrl(localAsrInput?.baseUrl) || DEFAULT_FUNASR_BASE_URL,
    pythonPath: normalizeString(localAsrInput?.pythonPath ?? previous.localAsr?.pythonPath),
    modelCache: normalizeString(localAsrInput?.modelCache ?? previous.localAsr?.modelCache),
  };
  // 新默认不继承旧 FunASR 环境、端口或 ModelScope 缓存。
  const fireRedInput = input.localFireRed ?? previous.localFireRed;
  const localFireRed = {
    baseUrl: normalizeBaseUrl(fireRedInput?.baseUrl) || DEFAULT_FIRERED_BASE_URL,
    pythonPath: normalizeString(fireRedInput?.pythonPath ?? previous.localFireRed?.pythonPath),
    modelCache: normalizeString(fireRedInput?.modelCache ?? previous.localFireRed?.modelCache),
  };
  const localIndexTts = normalizeIndexTts(input.localIndexTts, previous.localIndexTts);
  return { providers, active, skipValidation, analysisStreaming, localAsr, localFireRed, localIndexTts };
}

function migrateOldConfig(old) {
  if (!old || typeof old !== 'object') return normalizeStoredConfig();
  if (old.providers) return normalizeStoredConfig(old);
  if (!old.models || typeof old.models !== 'object') return normalizeStoredConfig();

  const firstModel = Object.values(old.models).find(model => model && typeof model === 'object') || {};
  const providerId = normalizeString(firstModel.provider) || 'default';
  const firstProvider = { id: providerId, name: providerId === 'default' ? '默认' : providerId, apiKey: '', baseUrl: '', models: {} };
  const active = {};

  for (const type of MODEL_TYPES) {
    const m = old.models[type];
    if (m && typeof m === 'object') {
      firstProvider.apiKey = firstProvider.apiKey || normalizeString(m.apiKey);
      firstProvider.baseUrl = firstProvider.baseUrl || normalizeBaseUrl(m.baseUrl);
      firstProvider.models[type] = {
        enabled: m.enabled === true,
        modelId: normalizeString(m.modelId),
        note: normalizeString(m.note),
      };
      if (type === 'tts') {
        firstProvider.models[type].voiceId = normalizeString(m.voiceId) || DEFAULT_MINIMAX_VOICE_ID;
        firstProvider.models[type].ttsConcurrency = normalizeInteger(m.ttsConcurrency, 1, 1, 5);
        firstProvider.models[type].ttsQueueIntervalMs = normalizeInteger(m.ttsQueueIntervalMs, 1800, 0, 10000);
        firstProvider.models[type].doubao = normalizeDoubaoSettings(m.doubao);
      }
      if (m.enabled && m.modelId) {
        active[type] = `${providerId}/${type}`;
      }
    }
  }

  const providerName = normalizeString(firstProvider.models.text?.modelId || '').startsWith('mimo')
    ? '小米 MiMo' : '默认';

  return normalizeStoredConfig({
    providers: { [firstProvider.id]: { ...firstProvider, name: providerName } },
    active,
    skipValidation: false,
  });
}

function toPublicConfig(stored) {
  const config = normalizeStoredConfig(stored);
  const publicProviders = {};

  for (const [id, provider] of Object.entries(config.providers)) {
    const publicModels = {};
    for (const type of MODEL_TYPES) {
      const m = provider.models[type] || emptyModelEntry();
      const entry = { enabled: m.enabled, modelId: m.modelId, note: m.note };
      if (type === 'asr') entry.backend = m.backend;
      if (type === 'text') {
        entry.supportsMultimodal = m.supportsMultimodal === true;
      }
      if (type === 'tts') {
        entry.voiceId = m.voiceId;
        entry.ttsConcurrency = m.ttsConcurrency;
        entry.ttsQueueIntervalMs = m.ttsQueueIntervalMs;
        entry.doubao = m.doubao;
      }
      publicModels[type] = entry;
    }
    publicProviders[id] = {
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      hasApiKey: !!provider.apiKey,
      apiKeyMasked: maskApiKey(provider.apiKey),
      models: publicModels,
    };
  }

  return {
    providers: publicProviders,
    active: config.active,
    skipValidation: config.skipValidation,
    analysisStreaming: config.analysisStreaming,
    localAsr: config.localAsr,
    localFireRed: config.localFireRed,
    localIndexTts: config.localIndexTts,
  };
}

function envFallback(type, field, providerId) {
  const env = process.env;
  const providerUpper = (providerId || '').toUpperCase();
  const typeUpper = type.toUpperCase();
  const keys = [
    `${providerUpper}_${typeUpper}_${field.toUpperCase()}`,
    `${providerUpper}_${field.toUpperCase()}`,
    `${typeUpper}_${field.toUpperCase()}`,
    `MIMO_${field.toUpperCase()}`,
    field.toUpperCase(),
  ];
  for (const key of keys) {
    const val = env[key];
    if (val && typeof val === 'string' && val.trim()) return val.trim();
  }
  return '';
}

function resolveActiveConfig(type, stored) {
  const config = normalizeStoredConfig(stored);
  const activeRef = config.active[type];
  if (!activeRef) return null;
  if (type === 'tts' && activeRef === BUILTIN_INDEXTTS_REF) {
    return { enabled: true, builtin: true, provider: 'indextts', providerName: 'IndexTTS 2.5（本地）',
      protocol: 'local-process', modelId: 'IndexTTS-2.5', apiKey: '', baseUrl: 'local://indextts',
      voiceId: 'reference_audio', localIndexTts: config.localIndexTts,
      alignmentConfig: { ...config.localFireRed, enabled: true, builtin: true, provider: 'firered', backend: 'firered',
        modelId: 'fireredasr2-aed', apiKey: '' }, ttsConcurrency: 1, ttsQueueIntervalMs: 0 };
  }
  if (type === 'asr' && activeRef === BUILTIN_FIRERED_REF) {
    return {
      enabled: true, builtin: true, provider: 'firered', providerName: 'FireRed（本地）',
      backend: 'firered', protocol: 'openai-transcription', modelId: 'fireredasr2-aed',
      baseUrl: config.localFireRed.baseUrl, pythonPath: config.localFireRed.pythonPath,
      modelCache: config.localFireRed.modelCache,
      apiKey: '', note: '本地 AED 识别及 CTC 字词对齐，无需 API Key。',
    };
  }

  const parts = activeRef.split('/');
  if (parts.length !== 2) return null;
  const [providerId, modelType] = parts;

  const provider = config.providers[providerId];
  if (!provider) return null;

  const model = provider.models[modelType];
  if (!model || !model.enabled || !model.modelId) return null;

  const isFunasr = modelType === 'asr' && ['funasr', 'firered'].includes(model.backend);
  const prefix = model.backend === 'firered' ? 'FIRERED' : 'FUNASR';
  const apiKey = provider.apiKey || (isFunasr
    ? normalizeString(process.env[`${prefix}_API_KEY`] || process.env.ASR_API_KEY)
    : envFallback(type, 'api_key', providerId));
  const baseUrl = provider.baseUrl || (isFunasr
    ? normalizeBaseUrl(process.env[`${prefix}_BASE_URL`] || process.env.ASR_BASE_URL)
    : envFallback(type, 'base_url', providerId));

  const result = {
    enabled: true,
    provider: providerId,
    providerName: provider.name,
    protocol: provider.protocol,
    apiKey,
    baseUrl,
    modelId: model.modelId,
    note: model.note,
  };
  if (modelType === 'asr') result.backend = model.backend;
  if (modelType === 'text') {
    result.supportsMultimodal = model.supportsMultimodal === true;
    result.analysisStreaming = config.analysisStreaming;
  }
  if (modelType === 'tts') {
    result.voiceId = model.voiceId;
    result.ttsConcurrency = model.ttsConcurrency;
    result.ttsQueueIntervalMs = model.ttsQueueIntervalMs;
    result.doubao = model.doubao;
  }
  return result;
}

async function readStoredConfig(options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  try {
    const raw = JSON.parse(await fsp.readFile(configPath, 'utf-8'));
    if (raw && raw.providers) return raw;
    return migrateOldConfig(raw);
  } catch {
    return normalizeStoredConfig();
  }
}

async function writeStoredConfig(config, options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

async function getPublicConfig(options = {}) {
  const stored = await readStoredConfig(options);
  return toPublicConfig(stored);
}

// 仅用于服务端诊断；沿用已保存密钥时绑定原供应商地址，草稿不会写入配置。
async function resolveProviderDraft(input = {}, options = {}) {
  const id = normalizeString(input.id);
  const stored = await readStoredConfig(options);
  const previous = Object.hasOwn(stored.providers || {}, id) ? stored.providers[id] : null;
  const apiKey = normalizeString(input.apiKey);
  const provider = normalizeProvider(id || 'draft', {
    ...previous,
    ...input,
    apiKey: apiKey || previous?.apiKey,
  });
  return {
    ...provider,
    savedKeyBaseUrl: !apiKey && previous?.apiKey ? normalizeBaseUrl(previous.baseUrl) : null,
  };
}

async function saveConfig(input, options = {}) {
  const previous = await readStoredConfig(options);
  const stored = input && input.providers
    ? normalizeStoredConfig(input, previous)
    : migrateOldConfig(input);
  await writeStoredConfig(stored, options);
  return toPublicConfig(stored);
}

async function getRuntimeConfig(type, options = {}) {
  if (!MODEL_TYPES.includes(type)) return null;
  const stored = await readStoredConfig(options);
  return resolveActiveConfig(type, stored);
}

async function getSkipValidation(options = {}) {
  const stored = await readStoredConfig(options);
  return stored.skipValidation === true;
}

async function getAnalysisStreaming(options = {}) {
  const stored = await readStoredConfig(options);
  return stored.analysisStreaming === true;
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  MODEL_TYPES,
  MODEL_TYPE_LABELS,
  MODEL_PROTOCOLS,
  DEFAULT_MODEL_PROTOCOL,
  DEFAULT_MINIMAX_VOICE_ID,
  BUILTIN_FUNASR_REF,
  DEFAULT_FUNASR_BASE_URL,
  BUILTIN_FIRERED_REF,
  BUILTIN_INDEXTTS_REF,
  DEFAULT_FIRERED_BASE_URL,
  getPublicConfig,
  resolveProviderDraft,
  saveConfig,
  getRuntimeConfig,
  getSkipValidation,
  getAnalysisStreaming,
  maskApiKey,
  normalizeStoredConfig,
  migrateOldConfig,
};
