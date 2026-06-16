const fs = require('fs');
const path = require('path');

const {
  MANIFEST_FILENAME,
  loadTemplateManifest,
  validateSourceEntry,
} = require('./templateManifestService');

const INTERNAL_ENGINE_MAP = {
  hyperframes: 'hyperframes-playwright',
  remotion: 'remotion-native',
  'hyperframes-playwright': 'hyperframes-playwright',
  'remotion-native': 'remotion-native',
};

const DEFAULT_OPTIONS = {
  engines: ['hyperframes'],
  commercialOnly: true,
};

const DEFAULT_ROOT_DIR = path.resolve(__dirname, '../../../../templates');

function normalizeEngine(engine) {
  return String(engine || '').trim();
}

function mappedEngine(engine) {
  return INTERNAL_ENGINE_MAP[normalizeEngine(engine)] || normalizeEngine(engine);
}

function isHtmlSourceEntry(sourceEntry) {
  return /\.html?$/i.test(String(sourceEntry || '').trim());
}

function resolveSourceEntryPath(manifest) {
  if (!manifest || !manifest.__dir || !manifest.source_entry) return '';
  const sourcePath = path.resolve(manifest.__dir, manifest.source_entry);
  const relative = path.relative(manifest.__dir, sourcePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return '';
  }
  return sourcePath;
}

function readTemplateDirs(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(rootDir, entry.name));
}

function scanTemplateManifests(rootDir) {
  const manifests = [];
  for (const templateDir of readTemplateDirs(rootDir)) {
    const manifestPath = path.join(templateDir, MANIFEST_FILENAME);
    if (!fs.existsSync(manifestPath)) continue;
    manifests.push(loadTemplateManifest(templateDir));
  }
  return manifests;
}

function normalizeOptions(options = {}) {
  const duration = options.durationSec ?? options.duration_sec ?? options.duration ?? options.target_duration_sec;
  const aspect = options.aspectRatio || options.aspect_ratio || options.aspect;
  const aspects = Array.isArray(options.aspects)
    ? options.aspects
    : (aspect ? [aspect] : []);
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    engines: Array.isArray(options.engines) ? options.engines : DEFAULT_OPTIONS.engines,
    aspects,
    durationSec: duration,
  };
}

function engineAllowed(manifest, options) {
  const engine = normalizeEngine(manifest.engine);
  return options.engines.some(item => {
    const allowed = normalizeEngine(item);
    return engine === allowed || mappedEngine(engine) === allowed || mappedEngine(allowed) === mappedEngine(engine);
  });
}

function aspectAllowed(manifest, options) {
  if (!Array.isArray(options.aspects) || options.aspects.length === 0) return true;
  const aspect = getManifestAspect(manifest);
  if (!aspect) return true;
  return options.aspects.includes(aspect);
}

function getManifestAspect(manifest) {
  const output = manifest.output || {};
  if (output.aspect || output.aspect_ratio) return output.aspect || output.aspect_ratio;
  const resolution = output.resolution || {};
  const width = Number(resolution.width);
  const height = Number(resolution.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '';
  }
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.01) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.01) return '9:16';
  if (Math.abs(ratio - 1) < 0.01) return '1:1';
  if (Math.abs(ratio - 4 / 5) < 0.01) return '4:5';
  return `${width}:${height}`;
}

function durationAllowed(manifest, options) {
  if (options.durationSec === undefined || options.durationSec === null) return true;
  const duration = Number(options.durationSec);
  const output = manifest.output || {};
  if (Array.isArray(output.duration_range_sec) && output.duration_range_sec.length >= 2) {
    return duration >= Number(output.duration_range_sec[0]) && duration <= Number(output.duration_range_sec[1]);
  }
  if (Array.isArray(output.duration_range) && output.duration_range.length >= 2) {
    return duration >= Number(output.duration_range[0]) && duration <= Number(output.duration_range[1]);
  }
  if (Array.isArray(output.duration) && output.duration.length >= 2) {
    return duration >= Number(output.duration[0]) && duration <= Number(output.duration[1]);
  }
  const manifestDuration = output.duration_sec ?? output.duration;
  if (manifestDuration === undefined || manifestDuration === null) return true;
  return Number(manifestDuration) === duration;
}

function licenseNameAllowed(manifest, options) {
  if (!Array.isArray(options.licenseAllow) || options.licenseAllow.length === 0) return true;
  const license = manifest.license || {};
  const name = license.name || license.id || license.type || '';
  return options.licenseAllow.includes(name);
}

function validateTemplateCompatibility(manifest, options = {}) {
  const normalized = normalizeOptions(options);
  const reasons = [];

  if (!engineAllowed(manifest, normalized)) {
    reasons.push({
      field: 'engine',
      code: 'unsupported-engine',
      message: `当前不支持该模板引擎：${manifest.engine || '未配置'}`,
    });
  }

  const sourceValidation = validateSourceEntry(manifest.source_entry);
  if (!sourceValidation.ok) {
    reasons.push({
      field: 'source_entry',
      code: 'unsafe-source-entry',
      message: sourceValidation.reason,
    });
  } else if (mappedEngine(manifest.engine) === 'hyperframes-playwright' && !isHtmlSourceEntry(manifest.source_entry)) {
    reasons.push({
      field: 'source_entry',
      code: 'non-html-source-entry',
      message: 'source_entry 必须指向 HTML 文件',
    });
  } else {
    const sourcePath = resolveSourceEntryPath(manifest);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      reasons.push({
        field: 'source_entry',
        code: 'source-entry-not-found',
        message: 'source_entry 指向的文件不存在或不在模板目录内',
      });
    }
  }

  if (normalized.commercialOnly && !(manifest.license && manifest.license.commercial_use === true)) {
    reasons.push({
      field: 'license',
      code: 'commercial-use-not-allowed',
      message: '模板授权不允许商业使用',
    });
  }

  if (!licenseNameAllowed(manifest, normalized)) {
    reasons.push({
      field: 'license',
      code: 'license-not-allowed',
      message: '模板授权不在允许列表中',
    });
  }

  if (!aspectAllowed(manifest, normalized)) {
    reasons.push({
      field: 'aspect',
      code: 'unsupported-aspect',
      message: '模板不支持目标画幅',
    });
  }

  if (!durationAllowed(manifest, normalized)) {
    reasons.push({
      field: 'duration',
      code: 'unsupported-duration',
      message: '模板不支持目标时长',
    });
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

function toCompactTemplate(manifest) {
  const output = manifest.output || {};
  const durationSec = output.duration_sec ?? output.duration;
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description || '',
    category: manifest.category || '',
    tags: Array.isArray(manifest.tags) ? manifest.tags : [],
    engine: manifest.engine,
    mapped_engine: mappedEngine(manifest.engine),
    source_entry: manifest.source_entry,
    output: manifest.output,
    aspect_ratio: getManifestAspect(manifest),
    duration_sec: durationSec,
    inputs: {
      schema: manifest.inputs.schema,
    },
    license: manifest.license,
    attribution_required: manifest.license.attribution_required === true,
    assets_attribution: manifest.assets_attribution,
  };
}

function resolveRootAndOptions(rootDirOrOptions, maybeOptions) {
  if (typeof rootDirOrOptions === 'string') {
    return { rootDir: rootDirOrOptions, options: maybeOptions || {} };
  }
  return { rootDir: DEFAULT_ROOT_DIR, options: rootDirOrOptions || {} };
}

function buildCompactIndex(rootDirOrOptions, maybeOptions = {}) {
  const { rootDir, options } = resolveRootAndOptions(rootDirOrOptions, maybeOptions);
  return scanTemplateManifests(rootDir)
    .filter(manifest => validateTemplateCompatibility(manifest, options).ok)
    .map(toCompactTemplate);
}

function createTemplateRegistry({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  let manifests = [];
  function scanTemplates(nextRootDir = rootDir) {
    rootDir = nextRootDir;
    manifests = scanTemplateManifests(rootDir);
    return manifests;
  }
  function ensureScanned() {
    if (!manifests.length) scanTemplates(rootDir);
  }
  function listTemplates(options = {}) {
    ensureScanned();
    return manifests
      .filter(manifest => validateTemplateCompatibility(manifest, options).ok);
  }
  function getTemplate(templateId) {
    ensureScanned();
    return manifests.find(manifest => manifest.id === templateId) || null;
  }
  function hasTemplate(templateId, options = {}) {
    const template = getTemplate(templateId);
    return Boolean(template && validateTemplateCompatibility(template, options).ok);
  }
  return {
    scanTemplates,
    listTemplates,
    getTemplate,
    hasTemplate,
    buildCompactIndex: options => buildCompactIndex(rootDir, options),
  };
}

module.exports = {
  INTERNAL_ENGINE_MAP,
  DEFAULT_ROOT_DIR,
  scanTemplateManifests,
  buildCompactIndex,
  createTemplateRegistry,
  validateTemplateCompatibility,
  mappedEngine,
  getManifestAspect,
  resolveSourceEntryPath,
};
