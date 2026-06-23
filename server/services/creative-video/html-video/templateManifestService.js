const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const MANIFEST_FILENAME = 'template.html-video.yaml';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isAbsoluteLike(value) {
  return path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\');
}

function validateSourceEntry(sourceEntry) {
  const value = String(sourceEntry || '').trim();
  if (!value) {
    return { ok: false, reason: 'source_entry 不能为空' };
  }
  if (isAbsoluteLike(value)) {
    return { ok: false, reason: 'source_entry 必须是相对路径，不能是绝对路径' };
  }

  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.includes('..')) {
    return { ok: false, reason: 'source_entry 不能包含 .. 路径片段' };
  }

  return { ok: true, source_entry: normalized };
}

function normalizeOutput(rawOutput) {
  const output = asObject(rawOutput);
  const resolution = asObject(output.resolution);
  const defaultResolution = asObject(resolution.default);
  const fps = asObject(output.fps);
  const duration = asObject(output.duration);
  return {
    ...output,
    ...(duration.default_sec !== undefined && output.duration_sec === undefined ? { duration_sec: duration.default_sec } : {}),
    ...(fps.default !== undefined ? { fps: fps.default } : {}),
    resolution: {
      ...resolution,
      ...(resolution.width === undefined && defaultResolution.width !== undefined ? { width: defaultResolution.width } : {}),
      ...(resolution.height === undefined && defaultResolution.height !== undefined ? { height: defaultResolution.height } : {}),
    },
  };
}

function resolveManifestPath(templateDirOrManifestPath) {
  const inputPath = path.resolve(templateDirOrManifestPath);
  if (path.basename(inputPath) === MANIFEST_FILENAME) {
    return inputPath;
  }
  return path.join(inputPath, MANIFEST_FILENAME);
}

function normalizeTemplateManifest(rawManifest, options = {}) {
  const raw = asObject(rawManifest);
  const sourceValidation = validateSourceEntry(raw.source_entry);
  if (!sourceValidation.ok) {
    throw new Error(`source_entry 不合法：${sourceValidation.reason}`);
  }

  const templateDir = options.templateDir ? path.resolve(options.templateDir) : undefined;
  const license = asObject(raw.license);
  const inputs = asObject(raw.inputs);

  return {
    ...raw,
    id: String(raw.id || '').trim(),
    name: String(raw.name || raw.id || '').trim(),
    engine: String(raw.engine || '').trim(),
    source_entry: sourceValidation.source_entry,
    output: normalizeOutput(raw.output),
    inputs: {
      ...inputs,
      schema: asObject(inputs.schema),
    },
    license: {
      ...license,
      commercial_use: license.commercial_use === true,
      attribution_required: license.attribution_required === true,
    },
    assets_attribution: asArray(raw.assets_attribution),
    preview: asObject(raw.preview),
    __dir: templateDir,
  };
}

function loadTemplateManifest(templateDirOrManifestPath) {
  const manifestPath = resolveManifestPath(templateDirOrManifestPath);
  const content = fs.readFileSync(manifestPath, 'utf8');
  const parsed = YAML.parse(content) || {};
  return normalizeTemplateManifest(parsed, {
    templateDir: path.dirname(manifestPath),
    manifestPath,
  });
}

module.exports = {
  MANIFEST_FILENAME,
  loadTemplateManifest,
  normalizeTemplateManifest,
  validateSourceEntry,
};
