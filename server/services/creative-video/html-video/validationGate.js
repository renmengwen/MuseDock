const path = require('path');

const { createDiagnostic } = require('./diagnostics');
const { validateProject } = require('./projectSchema');
const { mappedEngine } = require('./templateRegistry');
const { validateTemplateInputs } = require('./templateInputAgent');

const SUPPORTED_ENGINES = new Set(['hyperframes', 'hyperframes-playwright']);

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function isHtmlEntry(value) {
  return /\.html?$/i.test(String(value || '').trim());
}

function isSafeRelativePath(value) {
  const text = String(value || '').replace(/\\/g, '/');
  if (!text || path.isAbsolute(text)) return false;
  return !text.split('/').some(part => part === '..');
}

function add(diagnostics, code, stage, userMessage, details = {}, fallbackAllowed = true) {
  diagnostics.push(createDiagnostic({
    code,
    stage,
    user_message: userMessage,
    details,
    fallback_allowed: fallbackAllowed,
  }));
}

function validateTemplate({
  diagnostics,
  templateRegistry,
  templateId,
  inputs,
  ref,
  stage,
  options,
}) {
  const manifest = templateRegistry && templateRegistry.getTemplate(templateId);
  if (!manifest) {
    add(diagnostics, 'template_missing', stage, `未找到 html-video 模板：${templateId || '未指定'}。`, { template_id: templateId, ref });
    return null;
  }

  const engine = manifest.engine || '';
  if (!SUPPORTED_ENGINES.has(engine) && !SUPPORTED_ENGINES.has(mappedEngine(engine))) {
    add(diagnostics, 'unsupported_engine', stage, `模板 ${templateId} 使用的引擎暂不支持。`, { template_id: templateId, engine, ref });
  }

  if (mappedEngine(engine) === 'hyperframes-playwright' && !isHtmlEntry(manifest.source_entry)) {
    add(diagnostics, 'source_entry_not_html', stage, `模板 ${templateId} 的入口不是 HTML 文件。`, {
      template_id: templateId,
      source_entry: manifest.source_entry,
      ref,
    });
  }

  if (options.commercialOnly !== false && !(manifest.license && manifest.license.commercial_use === true)) {
    add(diagnostics, 'license_not_allowed', stage, `模板 ${templateId} 授权不允许本次使用。`, {
      template_id: templateId,
      license: manifest.license || {},
      ref,
    });
  }

  const inputValidation = validateTemplateInputs(objectOrEmpty(inputs), manifest);
  if (!inputValidation.success) {
    add(diagnostics, 'template_inputs_invalid', stage, inputValidation.user_message || '模板字段校验失败。', {
      template_id: templateId,
      ref,
      diagnostics: inputValidation.diagnostics || [],
    });
  }

  return manifest;
}

function validateEnvironment(diagnostics, environment) {
  if (!environment || environment.ok === true) return;
  const items = arrayOrEmpty(environment.diagnostics);
  const hasPlaywright = items.some(item => /playwright|chromium/i.test(String(item.code || item.message || '')) && item.ok === false);
  const hasFfmpeg = items.some(item => /ffmpeg/i.test(String(item.code || item.message || '')) && item.ok === false);
  if (hasPlaywright) {
    add(diagnostics, 'playwright_not_configured', 'environment', 'Playwright Chromium 未配置，无法渲染 html-video。', { environment });
  }
  if (hasFfmpeg) {
    add(diagnostics, 'ffmpeg_not_configured', 'environment', 'ffmpeg 未配置，无法合成 html-video。', { environment });
  }
}

async function validateHtmlVideoProject({
  project,
  templateRegistry,
  environment,
  options = {},
} = {}) {
  const input = objectOrEmpty(project);
  const diagnostics = [];

  validateTemplate({
    diagnostics,
    templateRegistry,
    templateId: input.template_id,
    inputs: input.template_inputs,
    ref: 'project',
    stage: 'template',
    options,
  });

  arrayOrEmpty(input.frames).forEach(frame => {
    validateTemplate({
      diagnostics,
      templateRegistry,
      templateId: frame.template_id || input.template_id,
      inputs: { ...objectOrEmpty(input.template_inputs), ...objectOrEmpty(frame.inputs) },
      ref: frame.id || frame.scene_id,
      stage: 'frame',
      options,
    });

    if (frame.engine && !SUPPORTED_ENGINES.has(frame.engine) && !SUPPORTED_ENGINES.has(mappedEngine(frame.engine))) {
      add(diagnostics, 'unsupported_engine', 'frame', `帧 ${frame.id || ''} 使用的引擎暂不支持。`, {
        frame_id: frame.id,
        engine: frame.engine,
      });
    }
  });

  const schemaValidation = validateProject(input);
  for (const error of schemaValidation.errors || []) {
    if (error.code === 'timeline-item-kind-unsupported') {
      add(diagnostics, 'timeline_item_kind_unsupported', 'timeline', error.message || '首版时间线只支持 frame 类型条目。', error);
    }
    if (error.code === 'asset-path-absolute' || error.code === 'asset-path-escape') {
      add(diagnostics, 'asset_path_invalid', 'assets', error.message || '素材路径不合法。', error);
    }
  }

  arrayOrEmpty(input.assets).forEach(asset => {
    if (asset && asset.path && !isSafeRelativePath(asset.path)) {
      const exists = diagnostics.some(item => item.code === 'asset_path_invalid' && item.details.ref === asset.id);
      if (!exists) {
        add(diagnostics, 'asset_path_invalid', 'assets', '素材路径不合法。', { ref: asset.id, path: asset.path });
      }
    }
  });

  const htmlOverride = objectOrEmpty(objectOrEmpty(input.overrides).html);
  if (htmlOverride.enabled === true) {
    const frames = objectOrEmpty(htmlOverride.frames);
    const active = Object.entries(frames).filter(([, value]) => objectOrEmpty(value).enabled === true);
    if (active.length) {
      add(diagnostics, 'html_override_active', 'overrides', '当前工程启用了 HTML 改写。', {
        frames: active.map(([key]) => key),
      });
    }
  }

  validateEnvironment(diagnostics, environment);

  return {
    ok: diagnostics.length === 0,
    diagnostics,
  };
}

module.exports = {
  validateHtmlVideoProject,
};
