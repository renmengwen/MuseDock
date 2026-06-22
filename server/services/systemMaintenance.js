const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const defaultEnvironmentDoctor = require('./creative-video/html-video/environmentDoctor');
const defaultTemplateRegistry = require('./creative-video/html-video/templateRegistry');
const defaultAppSettings = require('./appSettings');
const defaultAiModelConfig = require('./aiModelConfig');

const HEALTH_CACHE_TTL_MS = 60 * 1000;
const STORAGE_CACHE_TTL_MS = 15 * 1000;

const environmentCache = new Map();
const storageCache = new Map();

const DIAGNOSTIC_MESSAGES = {
  ffmpeg_available: 'ffmpeg 可用。',
  ffmpeg_missing: 'ffmpeg 未配置或无法执行。',
  ffprobe_available: 'ffprobe 可用。',
  ffprobe_missing: 'ffprobe 未配置或无法执行。',
  playwright_available: 'Playwright 可用。',
  playwright_missing: 'Playwright 未安装或无法加载。',
  chromium_launchable: 'Playwright Chromium 可启动。',
  chromium_unavailable: 'Playwright Chromium 未配置，无法渲染 html-video 模板。',
  environment_check_failed: '运行环境检测失败。',
};

function nowFromOptions(options = {}) {
  return Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
}

function cacheKeyFromOptions(options = {}) {
  if (options.cacheKey) return String(options.cacheKey);
  return JSON.stringify({
    rootDir: options.rootDir || '',
    mediaRoot: options.mediaRoot || '',
    browserDataRoot: options.browserDataRoot || '',
    cookieFile: options.cookieFile || '',
  });
}

function clearCaches() {
  environmentCache.clear();
  storageCache.clear();
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function diagnosticMessage(code, fallback) {
  return DIAGNOSTIC_MESSAGES[code] || normalizeString(fallback) || '状态未知。';
}

function diagnosticDetail(source, message) {
  if (source && typeof source.detail === 'string') return source.detail;
  if (source && source.error instanceof Error) return source.error.message;
  if (source && typeof source.error === 'string') return source.error;

  const text = normalizeString(message);
  for (const prefix of [
    'ffmpeg 未配置或无法执行：',
    'ffprobe 未配置或无法执行：',
    'Playwright 未安装或无法加载：',
  ]) {
    if (text.startsWith(prefix)) return text.slice(prefix.length).trim();
  }
  if (text.startsWith('Playwright Chromium 未配置，无法渲染 html-video 模板。')) {
    return text.slice('Playwright Chromium 未配置，无法渲染 html-video 模板。'.length).trim();
  }
  if (source && source.ok === false && DIAGNOSTIC_MESSAGES[source.code] && text && text !== DIAGNOSTIC_MESSAGES[source.code]) {
    return text;
  }
  return '';
}

function normalizeDiagnostic(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const code = normalizeString(source.code) || 'diagnostic_unknown';
  return {
    ok: source.ok === true,
    code,
    message: diagnosticMessage(code, source.message),
    detail: diagnosticDetail(source, source.message),
    path: normalizeString(source.path),
  };
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) return `${Math.round(amount)} ${units[unitIndex]}`;
  const rounded = Math.round(amount * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ${units[unitIndex]}`;
}

async function getDirectorySize(targetPath) {
  if (!targetPath) return 0;
  let stat;
  try {
    stat = await fsp.stat(targetPath);
  } catch {
    return 0;
  }

  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;

  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(targetPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    total += await getDirectorySize(path.join(targetPath, entry.name));
  }
  return total;
}

function storageItem(bytes) {
  return {
    bytes,
    display: formatBytes(bytes),
  };
}

function defaultRootDir() {
  return path.resolve(__dirname, '../..');
}

function resolveStoragePaths(options = {}) {
  const rootDir = options.rootDir || defaultRootDir();
  const mediaRoot = options.mediaRoot || path.join(rootDir, 'data', 'media');
  const browserDataRoot = options.browserDataRoot || path.join(rootDir, 'data', 'browser-data');
  const cookieFile = options.cookieFile || path.join(rootDir, 'data', 'cookies.json');
  return {
    creativeWorkflows: path.join(rootDir, 'data', 'creative-workflows'),
    mediaCache: path.join(mediaRoot, 'cache'),
    renderOutputs: path.join(rootDir, 'data', 'render-outputs'),
    browserData: browserDataRoot,
    cookies: cookieFile,
  };
}

async function getStorageOverview(options = {}) {
  const paths = resolveStoragePaths(options);
  const entries = await Promise.all(Object.entries(paths).map(async ([key, targetPath]) => {
    const bytes = await getDirectorySize(targetPath);
    return [key, storageItem(bytes)];
  }));
  return Object.fromEntries(entries);
}

async function getCachedStorage(options = {}) {
  const nowMs = nowFromOptions(options);
  const key = cacheKeyFromOptions(options);
  const cached = storageCache.get(key);
  if (!options.refresh && cached && nowMs - cached.createdAt < STORAGE_CACHE_TTL_MS) {
    return cached.value;
  }
  const value = await getStorageOverview(options);
  storageCache.set(key, { createdAt: nowMs, value });
  return value;
}

async function runEnvironmentDoctor(options = {}) {
  const services = options.services || {};
  const doctor = services.environmentDoctor || defaultEnvironmentDoctor.diagnoseEnvironment;
  const raw = await doctor(options.environmentOptions || {});
  const rawDiagnostics = Array.isArray(raw) ? raw : raw?.diagnostics;
  const diagnostics = Array.isArray(rawDiagnostics)
    ? rawDiagnostics.map(normalizeDiagnostic)
    : [];
  const ok = Array.isArray(raw) ? diagnostics.every(item => item.ok) : (typeof raw?.ok === 'boolean' ? raw.ok : diagnostics.every(item => item.ok));
  return {
    ok,
    code: normalizeString(raw?.code) || (ok ? 'ok' : 'environment_not_configured'),
    message: normalizeString(raw?.message) || (ok ? '运行环境检测通过。' : '运行环境检测未通过。'),
    diagnostics,
  };
}

async function getCachedEnvironment(options = {}) {
  const nowMs = nowFromOptions(options);
  const key = cacheKeyFromOptions(options);
  const cached = environmentCache.get(key);
  if (!options.refresh && cached && nowMs - cached.createdAt < HEALTH_CACHE_TTL_MS) {
    return cached.value;
  }

  let value;
  try {
    value = await runEnvironmentDoctor(options);
  } catch (error) {
    value = {
      ok: false,
      code: 'environment_check_failed',
      message: '运行环境检测失败。',
      diagnostics: [
        normalizeDiagnostic({
          ok: false,
          code: 'environment_check_failed',
          message: '运行环境检测失败。',
          detail: error && error.message ? error.message : String(error),
          path: '',
        }),
      ],
    };
  }
  environmentCache.set(key, { createdAt: nowMs, value });
  return value;
}

function compactTemplate(manifest, compatibility) {
  const output = manifest.output || {};
  return {
    id: manifest.id,
    name: manifest.name || manifest.id,
    description: manifest.description || '',
    category: manifest.category || '',
    tags: Array.isArray(manifest.tags) ? manifest.tags : [],
    engine: manifest.engine || '',
    source_entry: manifest.source_entry || '',
    output,
    compatible: compatibility.ok,
    compatibility_reasons: Array.isArray(compatibility.reasons) ? compatibility.reasons : [],
  };
}

async function getTemplateOverview(options = {}) {
  const services = options.services || {};
  const settings = services.appSettings || defaultAppSettings;
  const registry = services.templateRegistry || defaultTemplateRegistry;
  const defaults = await settings.getCreativeDefaults();
  const templateRoot = options.templateRoot || registry.DEFAULT_ROOT_DIR || defaultTemplateRegistry.DEFAULT_ROOT_DIR;
  const manifests = typeof registry.scanTemplateManifests === 'function'
    ? registry.scanTemplateManifests(templateRoot)
    : [];
  const compatibilityOptions = {
    aspectRatio: defaults?.aspectRatio,
    durationSec: defaults?.targetDurationSec,
  };

  return {
    defaults,
    items: manifests.map(manifest => {
      const compatibility = typeof registry.validateTemplateCompatibility === 'function'
        ? registry.validateTemplateCompatibility(manifest, compatibilityOptions)
        : { ok: true, reasons: [] };
      return compactTemplate(manifest, compatibility);
    }),
  };
}

function resolveActiveModel(publicConfig, type) {
  const activeRef = publicConfig?.active?.[type] || '';
  const [providerId, modelType = type] = String(activeRef).split('/');
  const provider = providerId ? publicConfig?.providers?.[providerId] : null;
  const model = provider?.models?.[modelType] || null;
  return {
    configured: model?.enabled === true && !!model?.modelId,
    provider: provider?.name || providerId || '',
    providerId: providerId || '',
    modelId: model?.modelId || '',
  };
}

async function getModelOverview(options = {}) {
  const services = options.services || {};
  const modelConfig = services.aiModelConfig || defaultAiModelConfig;
  const publicConfig = await modelConfig.getPublicConfig();
  return {
    text: resolveActiveModel(publicConfig, 'text'),
    tts: resolveActiveModel(publicConfig, 'tts'),
    multimodal: resolveActiveModel(publicConfig, 'multimodal'),
  };
}

async function getSystemHealth(options = {}) {
  const [environment, templates, models, storage] = await Promise.all([
    getCachedEnvironment(options),
    getTemplateOverview(options),
    getModelOverview(options),
    getCachedStorage(options),
  ]);

  return {
    environment,
    templates,
    models,
    storage,
  };
}

module.exports = {
  HEALTH_CACHE_TTL_MS,
  STORAGE_CACHE_TTL_MS,
  clearCaches,
  normalizeDiagnostic,
  formatBytes,
  getDirectorySize,
  getStorageOverview,
  getSystemHealth,
};
