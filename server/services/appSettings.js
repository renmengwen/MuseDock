const fsp = require('fs/promises');
const path = require('path');

const aiModelConfig = require('./ai/aiModelConfig');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../data/config/app-settings.json');
const DEFAULT_AI_CONFIG_PATH = aiModelConfig.DEFAULT_CONFIG_PATH
  || path.join(__dirname, '../../data/config/ai-models.json');

const ALLOWED_ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5'];

const DEFAULT_CONFIG = {
  version: 1,
  creativeDefaults: {
    aspectRatio: '9:16',
    targetDurationSec: 60,
    templateByAspectRatio: {
      '9:16': 'news_signal_vertical',
      '16:9': 'bold_signal',
      '1:1': '',
      '4:5': '',
    },
    lockTemplate: false,
    useResearch: true,
    generateAudio: true,
    generateCaptions: true,
    emotionalVoice: false,
  },
  system: {
    skipValidation: false,
  },
};

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function normalizeDurationSec(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_CONFIG.creativeDefaults.targetDurationSec;
  return Math.min(180, Math.max(15, Math.round(number)));
}

function normalizeCreativeDefaults(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const templateSource = source.templateByAspectRatio && typeof source.templateByAspectRatio === 'object'
    ? source.templateByAspectRatio
    : {};
  const templateByAspectRatio = {};

  for (const ratio of ALLOWED_ASPECT_RATIOS) {
    if (Object.prototype.hasOwnProperty.call(templateSource, ratio)) {
      const value = templateSource[ratio];
      templateByAspectRatio[ratio] = typeof value === 'string' ? value.trim() : '';
    } else {
      templateByAspectRatio[ratio] = DEFAULT_CONFIG.creativeDefaults.templateByAspectRatio[ratio];
    }
  }

  return {
    aspectRatio: ALLOWED_ASPECT_RATIOS.includes(source.aspectRatio)
      ? source.aspectRatio
      : DEFAULT_CONFIG.creativeDefaults.aspectRatio,
    targetDurationSec: normalizeDurationSec(source.targetDurationSec),
    templateByAspectRatio,
    lockTemplate: source.lockTemplate === true,
    useResearch: typeof source.useResearch === 'boolean'
      ? source.useResearch
      : DEFAULT_CONFIG.creativeDefaults.useResearch,
    generateAudio: typeof source.generateAudio === 'boolean'
      ? source.generateAudio
      : DEFAULT_CONFIG.creativeDefaults.generateAudio,
    generateCaptions: typeof source.generateCaptions === 'boolean'
      ? source.generateCaptions
      : DEFAULT_CONFIG.creativeDefaults.generateCaptions,
    emotionalVoice: source.emotionalVoice === true,
  };
}

function normalizeSystemSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    skipValidation: source.skipValidation === true,
  };
}

function normalizeConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    version: 1,
    creativeDefaults: normalizeCreativeDefaults(source.creativeDefaults),
    system: normalizeSystemSettings(source.system),
  };
}

function resolveConfigPath(options = {}) {
  return options.configPath || DEFAULT_CONFIG_PATH;
}

function resolveAiConfigPath(options = {}) {
  return options.aiConfigPath || DEFAULT_AI_CONFIG_PATH;
}

async function hasConfig(options = {}) {
  try {
    await fsp.access(resolveConfigPath(options));
    return true;
  } catch {
    return false;
  }
}

async function readConfig(options = {}) {
  const configPath = resolveConfigPath(options);
  try {
    const raw = JSON.parse(await fsp.readFile(configPath, 'utf-8'));
    return normalizeConfig(raw);
  } catch {
    return cloneConfig(DEFAULT_CONFIG);
  }
}

async function getPublicConfig(options = {}) {
  return readConfig(options);
}

async function getCreativeDefaults(options = {}) {
  const config = await readConfig(options);
  return config.creativeDefaults;
}

async function getSystemSettings(options = {}) {
  const config = await readConfig(options);
  return config.system;
}

async function getEffectiveSystemSettings(options = {}) {
  if (await hasConfig(options)) {
    const system = await getSystemSettings(options);
    return { ...system, source: 'app-settings' };
  }

  try {
    const raw = JSON.parse(await fsp.readFile(resolveAiConfigPath(options), 'utf-8'));
    return {
      skipValidation: raw && raw.skipValidation === true,
      source: 'legacy-ai-models',
    };
  } catch {
    return {
      ...DEFAULT_CONFIG.system,
      source: 'default',
    };
  }
}

async function saveConfig(input = {}, options = {}) {
  const configPath = resolveConfigPath(options);
  const exists = await hasConfig(options);
  const effectiveSystem = exists ? null : await getEffectiveSystemSettings(options);
  const source = input && typeof input === 'object' ? input : {};
  const inputSystem = source.system && typeof source.system === 'object' ? source.system : {};
  const system = effectiveSystem && typeof inputSystem.skipValidation !== 'boolean'
    ? { ...inputSystem, skipValidation: effectiveSystem.skipValidation }
    : inputSystem;
  const config = normalizeConfig({ ...source, system });

  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_CONFIG,
  ALLOWED_ASPECT_RATIOS,
  normalizeConfig,
  normalizeCreativeDefaults,
  normalizeSystemSettings,
  hasConfig,
  getPublicConfig,
  saveConfig,
  getCreativeDefaults,
  getSystemSettings,
  getEffectiveSystemSettings,
};
