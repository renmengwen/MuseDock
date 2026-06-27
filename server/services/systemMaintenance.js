const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const defaultEnvironmentDoctor = require('./creative-video/html-video/environmentDoctor');
const defaultTemplateRegistry = require('./creative-video/html-video/templateRegistry');
const defaultAppSettings = require('./appSettings');
const defaultAiModelConfig = require('./aiModelConfig');

const HEALTH_CACHE_TTL_MS = 60 * 1000;
const STORAGE_CACHE_TTL_MS = 15 * 1000;
const RUNNING_CREATIVE_STATUSES = new Set(['queued', 'running', 'processing']);
const CLEANUP_TARGETS = new Set(['creative-workflows', 'media-cache', 'render-outputs', 'browser-data', 'cookies']);
const CREATIVE_TASK_BLOCKED_TARGETS = new Set(['creative-workflows', 'media-cache', 'render-outputs']);

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
  const cookieFile = options.cookieFile || path.join(rootDir, 'douyin-cookies.json');
  return {
    creativeWorkflows: path.join(rootDir, 'data', 'creative-workflows'),
    mediaCache: path.join(mediaRoot, 'cache'),
    renderOutputs: path.join(rootDir, 'data', 'render-outputs'),
    browserData: browserDataRoot,
    cookies: cookieFile,
  };
}

function isPathInside(child, parent) {
  if (!child || !parent) return false;
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  const relative = path.relative(resolvedParent, resolvedChild);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function readJsonIfPossible(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function walkFiles(rootPath) {
  const files = [];
  let entries;
  try {
    entries = await fsp.readdir(rootPath, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function pushOutputPath(outputPaths, value) {
  if (typeof value === 'string' && value.trim()) {
    outputPaths.push(value.trim());
  }
}

function collectJsonOutputPaths(input) {
  const outputPaths = [];
  const seen = new Set();

  function visit(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);

    const hyperframesRender = value.result?.hyperframes_freeform?.render;
    if (hyperframesRender && typeof hyperframesRender === 'object') {
      pushOutputPath(outputPaths, hyperframesRender.output_path);
      if (Array.isArray(hyperframesRender.render_versions)) {
        for (const version of hyperframesRender.render_versions) {
          pushOutputPath(outputPaths, version?.output_path);
        }
      }
    }

    if (value.video && typeof value.video === 'object') {
      pushOutputPath(outputPaths, value.video.output_path);
      if (Array.isArray(value.video.render_versions)) {
        for (const version of value.video.render_versions) {
          pushOutputPath(outputPaths, version?.output_path);
        }
      }
    }

    pushOutputPath(outputPaths, value.visual_inspect?.output_path);

    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') {
        visit(child);
      }
    }
  }

  visit(input);
  return [...new Set(outputPaths)];
}

function renderOutputAllowedRoots(options = {}) {
  const rootDir = options.rootDir || defaultRootDir();
  const mediaRoot = options.mediaRoot || path.join(rootDir, 'data', 'media');
  return [
    path.join(rootDir, 'data', 'render-outputs'),
    mediaRoot,
  ].map(root => path.resolve(root));
}

function isAllowedRenderOutputPath(filePath, options = {}) {
  const resolvedPath = path.resolve(filePath);
  return renderOutputAllowedRoots(options).some(root => isPathInside(resolvedPath, root));
}

function allowedRenderOutputRoot(filePath, options = {}) {
  const resolvedPath = path.resolve(filePath);
  return renderOutputAllowedRoots(options).find(root => isPathInside(resolvedPath, root)) || '';
}

function isHtmlVideoProjectOutput(filePath, mediaRoot) {
  if (!isPathInside(filePath, mediaRoot)) return false;
  if (isNonRenderMetadataFile(filePath)) return false;
  const relative = path.relative(path.resolve(mediaRoot), path.resolve(filePath)).replace(/\\/g, '/');
  const segments = relative.split('/');
  if (segments.length < 2) return false;

  const fileName = segments[segments.length - 1];
  const parent = segments[segments.length - 2];
  const grandParent = segments[segments.length - 3];
  const ext = path.extname(fileName).toLowerCase();

  if (fileName === 'output.mp4') return true;
  if (parent === 'exports' && ['.mp4', '.webm', '.mov'].includes(ext)) return true;
  if (parent === 'frames' && ext === '.mp4') return true;
  return grandParent === 'inspect' && parent === 'previews' && ext === '.mp4';
}

function isNonRenderMetadataFile(filePath) {
  const fileName = path.basename(filePath).toLowerCase();
  return fileName === 'metadata.json' || fileName === 'transcript.json';
}

async function findRenderOutputs(options = {}) {
  const rootDir = options.rootDir || defaultRootDir();
  const mediaRoot = options.mediaRoot || path.join(rootDir, 'data', 'media');
  const workflowRoot = options.workflowRoot || path.join(rootDir, 'data', 'creative-workflows');
  const includeSkipped = options.includeSkipped === true;
  const byPath = new Map();

  function addCandidate(filePath, source) {
    const resolvedPath = path.resolve(filePath);
    if (byPath.has(resolvedPath)) return;
    if (isNonRenderMetadataFile(resolvedPath)) return;
    const allowed = isAllowedRenderOutputPath(resolvedPath, { rootDir, mediaRoot });
    if (allowed || includeSkipped) {
      byPath.set(resolvedPath, {
        path: resolvedPath,
        source,
        allowed,
        reason: allowed ? '' : '路径不在允许清理范围内。',
      });
    }
  }

  for (const jsonPath of await walkFiles(workflowRoot)) {
    if (path.extname(jsonPath).toLowerCase() !== '.json') continue;
    const json = await readJsonIfPossible(jsonPath);
    if (!json) continue;
    for (const outputPath of collectJsonOutputPaths(json)) {
      addCandidate(outputPath, jsonPath);
    }
  }

  for (const filePath of await walkFiles(mediaRoot)) {
    if (isHtmlVideoProjectOutput(filePath, mediaRoot)) {
      addCandidate(filePath, 'html-video-project');
    }
  }

  return [...byPath.values()].filter(item => includeSkipped || item.allowed);
}

async function defaultHasRunningCreativeTasks(options = {}) {
  const rootDir = options.rootDir || defaultRootDir();
  const workflowRoot = options.workflowRoot || path.join(rootDir, 'data', 'creative-workflows');
  for (const jsonPath of await walkFiles(workflowRoot)) {
    if (path.extname(jsonPath).toLowerCase() !== '.json') continue;
    const json = await readJsonIfPossible(jsonPath);
    if (!json || typeof json !== 'object') continue;
    const status = normalizeString(json.status).toLowerCase();
    const taskStatus = normalizeString(json.task_status).toLowerCase();
    if (RUNNING_CREATIVE_STATUSES.has(status) || RUNNING_CREATIVE_STATUSES.has(taskStatus)) {
      return true;
    }
  }
  return false;
}

async function deleteCandidate(candidatePath, allowedRoot, result) {
  const resolvedPath = path.resolve(candidatePath);
  const resolvedRoot = path.resolve(allowedRoot);
  if (!isPathInside(resolvedPath, resolvedRoot) || resolvedPath === resolvedRoot) {
    result.skipped.push({ path: resolvedPath, reason: '路径不在允许清理范围内。' });
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(resolvedPath);
  } catch {
    return;
  }

  const bytes = stat.isDirectory() ? await getDirectorySize(resolvedPath) : stat.size;
  try {
    await fsp.rm(resolvedPath, { recursive: true, force: true });
    result.deleted.push({ path: resolvedPath, bytes });
    result.freedBytes += bytes;
  } catch (error) {
    result.skipped.push({ path: resolvedPath, reason: error.message || '删除失败。' });
  }
}

async function deleteDirectoryContents(rootPath, result) {
  const resolvedRoot = path.resolve(rootPath);
  let entries;
  try {
    entries = await fsp.readdir(resolvedRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    await deleteCandidate(path.join(resolvedRoot, entry.name), resolvedRoot, result);
  }
}

async function cleanupRenderOutputs(options, result) {
  const rootDir = options.rootDir || defaultRootDir();
  const mediaRoot = options.mediaRoot || path.join(rootDir, 'data', 'media');
  const outputs = await findRenderOutputs({ ...options, rootDir, mediaRoot, includeSkipped: true });
  for (const output of outputs) {
    if (!output.allowed) {
      result.skipped.push({ path: output.path, reason: output.reason || '路径不在允许清理范围内。' });
      continue;
    }
    if (path.resolve(output.path) === path.resolve(mediaRoot)) {
      result.skipped.push({ path: output.path, reason: 'render-outputs 不允许删除整个媒体目录。' });
      continue;
    }
    let stat;
    try {
      stat = await fsp.stat(output.path);
    } catch {
      continue;
    }
    if (!stat.isFile()) {
      result.skipped.push({ path: output.path, reason: 'render-outputs 只清理识别出的产物文件。' });
      continue;
    }
    await deleteCandidate(output.path, allowedRenderOutputRoot(output.path, { rootDir, mediaRoot }), result);
  }
}

async function cleanupCookies(options, result) {
  if (options.storedCookies && typeof options.storedCookies === 'object') {
    options.storedCookies.douyin = '';
    options.storedCookies.xhs = '';
  }

  const rootDir = options.rootDir || defaultRootDir();
  const cookieFile = options.cookieFile || path.join(rootDir, 'douyin-cookies.json');
  if (!cookieFile) return;
  const allowedRoot = path.dirname(path.resolve(cookieFile));
  await deleteCandidate(cookieFile, allowedRoot, result);
}

function normalizeTargets(targets) {
  return Array.isArray(targets)
    ? [...new Set(targets.map(target => normalizeString(target)).filter(Boolean))]
    : [];
}

function cleanupMessage(result) {
  result.freedDisplay = formatBytes(result.freedBytes);
  if (!result.success) return result.message;
  if (result.skipped.length > 0) {
    return `清理部分完成，释放 ${result.freedDisplay}，${result.skipped.length} 个项目未清理。`;
  }
  return `清理完成，已释放 ${result.freedDisplay}。`;
}

async function cleanupTargets(options = {}) {
  const targets = normalizeTargets(options.targets);
  const result = {
    success: true,
    message: '',
    deleted: [],
    skipped: [],
    freedBytes: 0,
    freedDisplay: '0 B',
  };

  if (targets.length === 0) {
    return {
      ...result,
      success: false,
      message: '请选择要清理的类型。',
    };
  }
  if (targets.some(target => !CLEANUP_TARGETS.has(target))) {
    return {
      ...result,
      success: false,
      message: '不支持的清理类型。',
    };
  }

  const hasBlockedTarget = targets.some(target => CREATIVE_TASK_BLOCKED_TARGETS.has(target));
  if (hasBlockedTarget) {
    const checker = typeof options.hasRunningCreativeTasks === 'function'
      ? options.hasRunningCreativeTasks
      : defaultHasRunningCreativeTasks;
    if (await checker(options)) {
      return {
        ...result,
        success: false,
        message: '当前有创作任务正在运行，请等待任务结束后再清理相关数据。',
      };
    }
  }

  const rootDir = options.rootDir || defaultRootDir();
  const mediaRoot = options.mediaRoot || path.join(rootDir, 'data', 'media');
  const browserDataRoot = options.browserDataRoot || path.join(rootDir, 'data', 'browser-data');
  const paths = resolveStoragePaths({ ...options, rootDir, mediaRoot, browserDataRoot });

  for (const target of targets) {
    try {
      if (target === 'creative-workflows') {
        await deleteDirectoryContents(paths.creativeWorkflows, result);
      } else if (target === 'media-cache') {
        await deleteDirectoryContents(paths.mediaCache, result);
      } else if (target === 'render-outputs') {
        await cleanupRenderOutputs({ ...options, rootDir, mediaRoot }, result);
      } else if (target === 'browser-data') {
        await deleteDirectoryContents(paths.browserData, result);
      } else if (target === 'cookies') {
        await cleanupCookies({ ...options, rootDir }, result);
      }
    } catch (error) {
      result.skipped.push({ path: target, reason: error.message || '清理失败。' });
    }
  }

  result.message = cleanupMessage(result);
  return result;
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
  const templateRoot = options.templateRoot
    || registry.DEFAULT_ROOT_DIRS
    || registry.DEFAULT_ROOT_DIR
    || defaultTemplateRegistry.DEFAULT_ROOT_DIRS
    || defaultTemplateRegistry.DEFAULT_ROOT_DIR;
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
  const result = {
    configured: model?.enabled === true && !!model?.modelId,
    provider: provider?.name || providerId || '',
    providerId: providerId || '',
    modelId: model?.modelId || '',
  };
  if (modelType === 'text') {
    result.supportsMultimodal = model?.supportsMultimodal === true;
  }
  return result;
}

async function getModelOverview(options = {}) {
  const services = options.services || {};
  const modelConfig = services.aiModelConfig || defaultAiModelConfig;
  const publicConfig = await modelConfig.getPublicConfig();
  return {
    analysis: resolveActiveModel(publicConfig, 'text'),
    tts: resolveActiveModel(publicConfig, 'tts'),
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
  isPathInside,
  collectJsonOutputPaths,
  findRenderOutputs,
  cleanupTargets,
};
