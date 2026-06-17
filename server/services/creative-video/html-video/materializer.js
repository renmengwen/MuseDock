const fs = require('fs/promises');
const path = require('path');

const { normalizeProject } = require('./projectSchema');
const { resolveSourceEntryPath } = require('./templateRegistry');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function safeFilePart(value, fallback) {
  const text = String(value || fallback || 'frame')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return text || fallback || 'frame';
}

function toPosixPath(value) {
  return value.replace(/\\/g, '/');
}

function resolveProjectPath(projectDir, relativePath) {
  const target = path.resolve(projectDir, relativePath);
  const relative = path.relative(projectDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('materializer 输出路径不能逃逸工程目录。');
  }
  return target;
}

function getFrameOverride(project, frame) {
  const htmlOverride = objectOrEmpty(objectOrEmpty(project.overrides).html);
  if (htmlOverride.enabled !== true) return null;
  const frameOverrides = objectOrEmpty(htmlOverride.frames);
  const override = objectOrEmpty(frameOverrides[frame.id] || frameOverrides[frame.scene_id]);
  if (override.enabled !== true) return null;
  return override;
}

function frameOutputPath(frame, index) {
  const frameId = safeFilePart(frame.scene_id || frame.id, `frame_${String(index + 1).padStart(2, '0')}`);
  return `frames/${String(index + 1).padStart(2, '0')}-${frameId}.html`;
}

function materializeTemplate(sourceHtml, vars, durationSec, sceneData = {}) {
  const replaced = sourceHtml.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return '';
    return htmlEscape(vars[key]);
  });

  const injection = `<script>window.__HV_VARS__ = ${safeJson(vars)}; window.__HV_DURATION__ = ${safeJson(durationSec)}; window.__HV_SCENE__ = ${safeJson(sceneData)};</script>`;
  if (/<head\b[^>]*>/i.test(replaced)) {
    return replaced.replace(/<head\b([^>]*)>/i, `<head$1>\n${injection}`);
  }
  if (/<html\b[^>]*>/i.test(replaced)) {
    return replaced.replace(/<html\b([^>]*)>/i, `<html$1>\n<head>${injection}</head>`);
  }
  return `${injection}\n${replaced}`;
}

async function materializeFrame({ projectDir, project, frame, index, templateRegistry }) {
  const diagnostics = [];
  const override = getFrameOverride(project, frame);
  if (override) {
    const overridePath = override.html_path || frame.html_path;
    if (overridePath) {
      frame.html_path = toPosixPath(overridePath);
    }
    diagnostics.push({
      code: 'html_override_active',
      frame_id: frame.id,
      message: '当前帧启用了 HTML 改写，materializer 已跳过自动生成。',
    });
    return diagnostics;
  }

  const templateId = frame.template_id || project.template_id;
  const manifest = templateRegistry && templateRegistry.getTemplate(templateId);
  if (!manifest) {
    diagnostics.push({
      code: 'template_not_found',
      frame_id: frame.id,
      template_id: templateId,
      message: '未找到帧对应的 html-video 模板。',
    });
    return diagnostics;
  }

  const sourcePath = resolveSourceEntryPath(manifest);
  if (!sourcePath) {
    diagnostics.push({
      code: 'template_source_invalid',
      frame_id: frame.id,
      template_id: templateId,
      message: '模板 source_entry 不合法。',
    });
    return diagnostics;
  }

  const vars = {
    ...objectOrEmpty(project.template_inputs),
    ...objectOrEmpty(frame.inputs),
  };
  const durationSec = Number(frame.duration_sec || vars.duration_sec || objectOrEmpty(manifest.output).duration || 6);
  vars.duration_sec = Number.isFinite(Number(vars.duration_sec)) ? Number(vars.duration_sec) : durationSec;

  const sourceHtml = await fs.readFile(sourcePath, 'utf8');
  const sceneData = {
    id: frame.scene_id || frame.id,
    narration_text: frame.narration_text || '',
    captions: Array.isArray(frame.captions) ? frame.captions : [],
    metadata: objectOrEmpty(frame.metadata),
  };
  const html = materializeTemplate(sourceHtml, vars, durationSec, sceneData);
  const relativePath = frameOutputPath(frame, index);
  const outputPath = resolveProjectPath(projectDir, relativePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, 'utf8');
  frame.html_path = relativePath;

  diagnostics.push({
    code: 'materialized',
    frame_id: frame.id,
    html_path: relativePath,
    message: '已生成帧 HTML。',
  });
  return diagnostics;
}

async function materializeProject({ projectDir, project, templateRegistry }) {
  if (!projectDir) {
    throw new Error('缺少 projectDir。');
  }
  if (!templateRegistry) {
    throw new Error('缺少 templateRegistry。');
  }

  const normalized = normalizeProject(project);
  const diagnostics = [];
  for (let index = 0; index < normalized.frames.length; index += 1) {
    const frameDiagnostics = await materializeFrame({
      projectDir,
      project: normalized,
      frame: normalized.frames[index],
      index,
      templateRegistry,
    });
    diagnostics.push(...frameDiagnostics);
  }

  return {
    project: normalized,
    diagnostics,
  };
}

module.exports = {
  materializeProject,
  materializeTemplate,
  htmlEscape,
  safeJson,
};
