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

function normalizeEngine(engine) {
  return String(engine || '').trim();
}

function mappedEngine(engine) {
  return INTERNAL_ENGINE_MAP[normalizeEngine(engine)] || normalizeEngine(engine);
}

function isHtmlSourceEntry(sourceEntry) {
  return /\.html?$/i.test(String(sourceEntry || '').trim());
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
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    engines: Array.isArray(options.engines) ? options.engines : DEFAULT_OPTIONS.engines,
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
  const aspect = manifest.output && manifest.output.aspect;
  if (!aspect) return true;
  return options.aspects.includes(aspect);
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
  if (output.duration_sec === undefined || output.duration_sec === null) return true;
  return Number(output.duration_sec) === duration;
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
  } else if (!isHtmlSourceEntry(manifest.source_entry)) {
    reasons.push({
      field: 'source_entry',
      code: 'non-html-source-entry',
      message: 'source_entry 必须指向 HTML 文件',
    });
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
    duration_sec: manifest.output.duration_sec,
    inputs: {
      schema: manifest.inputs.schema,
    },
    license: manifest.license,
    attribution_required: manifest.license.attribution_required === true,
    assets_attribution: manifest.assets_attribution,
  };
}

function buildCompactIndex(rootDir, options = {}) {
  return scanTemplateManifests(rootDir)
    .filter(manifest => validateTemplateCompatibility(manifest, options).ok)
    .map(toCompactTemplate);
}

module.exports = {
  INTERNAL_ENGINE_MAP,
  scanTemplateManifests,
  buildCompactIndex,
  validateTemplateCompatibility,
  mappedEngine,
};
