const fsp = require('fs/promises');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../data/config/ai-models.json');

const MODEL_TYPES = ['asr', 'text', 'image', 'video', 'tts'];

const MODEL_TYPE_LABELS = {
  asr: 'ASR 转写',
  text: '分析模型',
  image: '图片生成',
  video: '视频生成',
  tts: 'TTS 语音合成',
};

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value) {
  return normalizeString(value).replace(/\/+$/, '');
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
    if (type === 'text') {
      entry.supportsMultimodal = raw.supportsMultimodal === true;
    }
    if (type === 'tts') {
      entry.ttsConcurrency = normalizeInteger(raw.ttsConcurrency, 1, 1, 5);
      entry.ttsQueueIntervalMs = normalizeInteger(raw.ttsQueueIntervalMs, 1800, 0, 10000);
    }
    models[type] = entry;
  }
  return {
    id,
    name: normalizeString(input.name) || id,
    apiKey: normalizeString(input.apiKey),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    models,
  };
}

function normalizeActive(input = {}) {
  const active = {};
  for (const type of MODEL_TYPES) {
    const raw = normalizeString(input[type]);
    active[type] = raw;
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
  return { providers, active, skipValidation };
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
        firstProvider.models[type].ttsConcurrency = normalizeInteger(m.ttsConcurrency, 1, 1, 5);
        firstProvider.models[type].ttsQueueIntervalMs = normalizeInteger(m.ttsQueueIntervalMs, 1800, 0, 10000);
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
      if (type === 'text') {
        entry.supportsMultimodal = m.supportsMultimodal === true;
      }
      if (type === 'tts') {
        entry.ttsConcurrency = m.ttsConcurrency;
        entry.ttsQueueIntervalMs = m.ttsQueueIntervalMs;
      }
      publicModels[type] = entry;
    }
    publicProviders[id] = {
      name: provider.name,
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

  const parts = activeRef.split('/');
  if (parts.length !== 2) return null;
  const [providerId, modelType] = parts;

  const provider = config.providers[providerId];
  if (!provider) return null;

  const model = provider.models[modelType];
  if (!model || !model.enabled || !model.modelId) return null;

  const apiKey = provider.apiKey || envFallback(type, 'api_key', providerId);
  const baseUrl = provider.baseUrl || envFallback(type, 'base_url', providerId);

  const result = {
    enabled: true,
    provider: providerId,
    providerName: provider.name,
    apiKey,
    baseUrl,
    modelId: model.modelId,
    note: model.note,
  };
  if (modelType === 'text') {
    result.supportsMultimodal = model.supportsMultimodal === true;
  }
  if (modelType === 'tts') {
    result.ttsConcurrency = model.ttsConcurrency;
    result.ttsQueueIntervalMs = model.ttsQueueIntervalMs;
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

module.exports = {
  DEFAULT_CONFIG_PATH,
  MODEL_TYPES,
  MODEL_TYPE_LABELS,
  getPublicConfig,
  saveConfig,
  getRuntimeConfig,
  getSkipValidation,
  maskApiKey,
  normalizeStoredConfig,
  migrateOldConfig,
};
