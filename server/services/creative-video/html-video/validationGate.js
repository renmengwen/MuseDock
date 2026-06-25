const fs = require('fs/promises');
const path = require('path');

const { createDiagnostic } = require('./diagnostics');
const { validateProject } = require('./projectSchema');
const { mappedEngine } = require('./templateRegistry');
const { validateTemplateInputs } = require('./templateInputAgent');
const { validateHtmlTargetResolution } = require('./frameHtmlAgent');
const { validateSceneSpecTimelineConsistency } = require('./timelineConsistency');

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

function resolveProjectPath(projectDir, relativePath) {
  const root = path.resolve(projectDir);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return target;
}

function add(diagnostics, code, stage, user_message, details = {}, fallback_allowed = true, extra = {}) {
  const inputDetails = objectOrEmpty(details);
  diagnostics.push({
    ...createDiagnostic({
      code,
      stage,
      sub_stage: extra.sub_stage || sub_stage_for_diagnostic(stage, code),
      frame_id: extra.frame_id || inputDetails.frame_id,
      retryable: extra.retryable,
      repair_action: extra.repair_action,
      user_message,
      details: inputDetails,
      fallback_allowed,
    }),
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => (
      !['sub_stage', 'frame_id', 'retryable', 'repair_action'].includes(key)
    ))),
  });
}

function sub_stage_for_diagnostic(stage, code) {
  if (stage === 'frame' || String(code || '').startsWith('raw_html_')) return 'frame_html';
  if (stage === 'timeline') return 'timeline_check';
  if (stage === 'template') return 'template_select';
  if (['environment', 'assets', 'overrides'].includes(stage)) return 'validate_project';
  return stage === 'project' ? 'validate_project' : '';
}

function isBlockingDiagnostic(diagnostic = {}) {
  const details = objectOrEmpty(diagnostic.details);
  if (details.blocking === false) return false;
  if (diagnostic.severity === 'warning') return false;
  return true;
}

function stripIgnoredHtmlRegions(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '');
}

function hasTextKey(html, key) {
  const cleaned = stripIgnoredHtmlRegions(html);
  const tags = cleaned.match(/<[A-Za-z][^>]*>/g) || [];
  const pattern = new RegExp(`\\bdata-text-key\\s*=\\s*(['"])${key}\\1`, 'i');
  return tags.some(tag => pattern.test(tag));
}

function warningDiagnostic(diagnostics, code, stage, user_message, details = {}) {
  add(diagnostics, code, stage, user_message, {
    ...details,
    blocking: false,
  }, true, { severity: 'warning' });
}

function validateTemplate({
  diagnostics,
  templateRegistry,
  templateId,
  inputs,
  ref,
  stage,
  options,
  validateInputs = true,
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
    }, false);
  }

  if (validateInputs) {
    const inputValidation = validateTemplateInputs(objectOrEmpty(inputs), manifest);
    if (!inputValidation.success) {
      add(diagnostics, 'template_inputs_invalid', stage, inputValidation.user_message || '模板字段校验失败。', {
        template_id: templateId,
        ref,
        diagnostics: inputValidation.diagnostics || [],
      });
    }
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

function collectMissingTextKeys(html) {
  const missing = [];
  for (const key of ['headline', 'subtitle', 'body']) {
    if (!hasTextKey(html, key)) {
      missing.push(key);
    }
  }
  return missing;
}

async function readFrameHtmlForValidation(projectDir, frame, diagnostics) {
  if (!projectDir || frame.source_mode !== 'raw_html' || !frame.html_path) return null;
  const htmlPath = resolveProjectPath(projectDir, frame.html_path);
  if (!htmlPath) {
    add(diagnostics, 'raw_html_path_invalid', 'frame', 'raw_html 帧 HTML 路径不合法。', {
      frame_id: frame.id,
      html_path: frame.html_path,
    }, true, {
      sub_stage: 'frame_html',
      frame_id: frame.id,
    });
    return null;
  }
  try {
    return await fs.readFile(htmlPath, 'utf8');
  } catch {
    return null;
  }
}

async function validateRawHtmlFrames({ diagnostics, projectDir, project, frames }) {
  const output = objectOrEmpty(project.output);
  const resolution = objectOrEmpty(output.resolution);
  for (const frame of frames) {
    const html = await readFrameHtmlForValidation(projectDir, frame, diagnostics);
    if (html == null) continue;
    const resolutionValidation = validateHtmlTargetResolution(html, { resolution });
    if (!resolutionValidation.success) {
      add(diagnostics, 'raw_html_resolution_mismatch', 'frame', resolutionValidation.message || 'raw_html 帧画幅尺寸不符合工程输出尺寸。', {
        frame_id: frame.id,
        html_path: frame.html_path,
        expected: resolutionValidation.expected,
        actual: resolutionValidation.actual,
      }, true, {
        sub_stage: 'frame_html',
        frame_id: frame.id,
      });
    }
    const missing = collectMissingTextKeys(html);
    if (missing.length) {
    warningDiagnostic(diagnostics, 'raw_html_text_keys_missing', 'frame', 'raw_html 帧缺少可编辑文本锚点。', {
      frame_id: frame.id,
      missing_keys: missing,
    });
    }
  }
}

async function validateHtmlVideoProject({
  project,
  projectDir,
  templateRegistry,
  environment,
  sceneSpec,
  mediaOptions = {},
  options = {},
} = {}) {
  const input = objectOrEmpty(project);
  const diagnostics = [];
  const frames = arrayOrEmpty(input.frames);

  validateTemplate({
    diagnostics,
    templateRegistry,
    templateId: input.template_id,
    inputs: input.template_inputs,
    ref: 'project',
    stage: 'template',
    options,
    validateInputs: frames.some(frame => frame.source_mode !== 'raw_html'),
  });

  frames.forEach(frame => {
    validateTemplate({
      diagnostics,
      templateRegistry,
      templateId: frame.template_id || input.template_id,
      inputs: { ...objectOrEmpty(input.template_inputs), ...objectOrEmpty(frame.inputs) },
      ref: frame.id || frame.scene_id,
      stage: 'frame',
      options,
      validateInputs: frame.source_mode !== 'raw_html',
    });

    if (frame.engine && !SUPPORTED_ENGINES.has(frame.engine) && !SUPPORTED_ENGINES.has(mappedEngine(frame.engine))) {
      add(diagnostics, 'unsupported_engine', 'frame', `帧 ${frame.id || ''} 使用的引擎暂不支持。`, {
        frame_id: frame.id,
        engine: frame.engine,
      });
    }
  });

  await validateRawHtmlFrames({ diagnostics, projectDir, project: input, frames });

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

  if (sceneSpec) {
    const timelineConsistency = validateSceneSpecTimelineConsistency({
      sceneSpec,
      project: input,
      audio: input.audio,
      mediaOptions,
    });
    diagnostics.push(...timelineConsistency.diagnostics);
  }

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
    ok: diagnostics.every(item => !isBlockingDiagnostic(item)),
    diagnostics,
  };
}

module.exports = {
  validateHtmlVideoProject,
  collectMissingTextKeys,
};
