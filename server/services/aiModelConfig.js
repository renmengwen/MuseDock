const fsp = require('fs/promises');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../data/config/ai-models.json');

const MODEL_TYPES = [
  'asr',
  'text',
  'image',
  'video',
  'multimodal',
];

function emptyModelConfig() {
  return {
    enabled: false,
    provider: '',
    apiKey: '',
    baseUrl: '',
    modelId: '',
    note: '',
  };
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value) {
  return normalizeString(value).replace(/\/+$/, '');
}

function maskApiKey(apiKey) {
  if (!apiKey) return '';
  const value = String(apiKey);
  if (value.startsWith('sk-') && value.length > 7) {
    return `sk-****${value.slice(-4)}`;
  }
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

function normalizeStoredConfig(input = {}, previous = {}) {
  const models = {};
  const inputModels = input.models && typeof input.models === 'object' ? input.models : {};
  const previousModels = previous.models && typeof previous.models === 'object' ? previous.models : {};

  for (const type of MODEL_TYPES) {
    const current = inputModels[type] && typeof inputModels[type] === 'object' ? inputModels[type] : {};
    const old = previousModels[type] && typeof previousModels[type] === 'object' ? previousModels[type] : {};
    const apiKey = normalizeString(current.apiKey);

    models[type] = {
      ...emptyModelConfig(),
      enabled: current.enabled === true,
      provider: normalizeString(current.provider),
      apiKey: apiKey || normalizeString(old.apiKey),
      baseUrl: normalizeBaseUrl(current.baseUrl),
      modelId: normalizeString(current.modelId),
      note: normalizeString(current.note),
    };
  }

  return { models };
}

function toPublicConfig(stored = {}) {
  const normalized = normalizeStoredConfig(stored, stored);
  const models = {};

  for (const type of MODEL_TYPES) {
    const model = normalized.models[type];
    models[type] = {
      enabled: model.enabled,
      provider: model.provider,
      baseUrl: model.baseUrl,
      modelId: model.modelId,
      note: model.note,
      hasApiKey: !!model.apiKey,
      apiKeyMasked: maskApiKey(model.apiKey),
    };
  }

  return { models };
}

async function readStoredConfig(options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  try {
    return JSON.parse(await fsp.readFile(configPath, 'utf-8'));
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
  const stored = normalizeStoredConfig(input, previous);
  await writeStoredConfig(stored, options);
  return toPublicConfig(stored);
}

async function getRuntimeConfig(type, options = {}) {
  if (!MODEL_TYPES.includes(type)) return null;
  const stored = normalizeStoredConfig(await readStoredConfig(options));
  return stored.models[type];
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  MODEL_TYPES,
  getPublicConfig,
  saveConfig,
  getRuntimeConfig,
  maskApiKey,
};
