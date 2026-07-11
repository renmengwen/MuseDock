const fs = require('fs/promises');
const path = require('path');

const { normalizeProject } = require('./projectSchema');
const { resolveSourceEntryPath } = require('./templateRegistry');
const { ensureCaptionLayer, hasUnmanagedCaptionLayer, normalizeCaptionsForFrame } = require('./captionLayer');

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

function frameBeatId(frame = {}) {
  return String(frame.beat_id || frame.beatId || '').trim();
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

const CAPTION_GUARD_STYLE = `<style data-hv-caption-guard>
.hv-caption-layer {
  z-index: 2147483647 !important;
  pointer-events: none !important;
}
.hv-caption-layer * { pointer-events: none !important; }
</style>`;

function injectCaptionLayerGuard(html = '', { visualStrategy = null } = {}) {
  if (visualStrategy !== 'asset_first') return html; // 硬约束：共享路径默认行为不变
  const text = String(html);
  if (text.includes('data-hv-caption-guard')) return text; // 幂等
  if (text.includes('</head>')) return text.replace('</head>', `${CAPTION_GUARD_STYLE}</head>`);
  if (text.includes('<body')) return text.replace(/<body([^>]*)>/, `<body$1>${CAPTION_GUARD_STYLE}`);
  return CAPTION_GUARD_STYLE + text;
}

function recordUnmanagedCaptionLayerDiagnostic(diagnostics, frame) {
  diagnostics.push({
    code: 'unmanaged_caption_layer_preserved',
    frame_id: frame.id,
    message: '检测到模板或第三方非受管字幕层，已保留并另行写入受管字幕层。',
  });
}

async function materializeFrame({ projectDir, project, frame, index, templateRegistry, rawHtmlPathCounts }) {
  const diagnostics = [];
  if (frame.source_mode === 'raw_html') {
    if (!frame.html_path) {
      diagnostics.push({
        code: 'raw_html_missing_path',
        frame_id: frame.id,
        message: 'raw_html 帧缺少 html_path。',
      });
      return diagnostics;
    }
    const originalHtmlPath = toPosixPath(frame.html_path);
    const sharedBeatRawHtml = frameBeatId(frame) && (rawHtmlPathCounts?.get(originalHtmlPath) || 0) > 1;
    const relativePath = sharedBeatRawHtml ? frameOutputPath(frame, index) : originalHtmlPath;
    const sourcePath = resolveProjectPath(projectDir, originalHtmlPath);
    const outputPath = resolveProjectPath(projectDir, relativePath);
    try {
      await fs.access(sourcePath);
      const html = await fs.readFile(sourcePath, 'utf8');
      const captions = normalizeCaptionsForFrame(frame);
      frame.captions = captions;
      const generateCaptions = frame.generate_captions !== false && frame.generateCaptions !== false;
      if (hasUnmanagedCaptionLayer(html)) {
        recordUnmanagedCaptionLayerDiagnostic(diagnostics, frame);
      }
      const nextHtml = injectCaptionLayerGuard(
        ensureCaptionLayer(html, captions, { generateCaptions }),
        { visualStrategy: project?.visual_strategy || null }
      );
      if (nextHtml !== html) {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, nextHtml, 'utf8');
        diagnostics.push({
          code: 'raw_html_caption_injected',
          frame_id: frame.id,
          html_path: toPosixPath(relativePath),
          message: 'raw_html 帧已补充字幕层。',
        });
      } else if (sharedBeatRawHtml && relativePath !== originalHtmlPath) {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, html, 'utf8');
      }
      frame.html_path = toPosixPath(relativePath);
      diagnostics.push({
        code: 'raw_html_preserved',
        frame_id: frame.id,
        html_path: frame.html_path,
        message: 'raw_html 帧已保留现有 HTML 文件。',
      });
    } catch {
      diagnostics.push({
        code: 'raw_html_missing_file',
        frame_id: frame.id,
        html_path: frame.html_path,
        message: 'raw_html 帧指向的 HTML 文件不存在。',
      });
    }
    return diagnostics;
  }

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

  const captions = normalizeCaptionsForFrame(frame);
  frame.captions = captions;
  const generateCaptions = frame.generate_captions !== false && frame.generateCaptions !== false;
  const sourceHtml = await fs.readFile(sourcePath, 'utf8');
  const sceneData = {
    id: frame.scene_id || frame.id,
    narration_text: frame.narration_text || '',
    captions,
    metadata: objectOrEmpty(frame.metadata),
  };
  const materializedHtml = materializeTemplate(sourceHtml, vars, durationSec, sceneData);
  if (hasUnmanagedCaptionLayer(materializedHtml)) {
    recordUnmanagedCaptionLayerDiagnostic(diagnostics, frame);
  }
  const html = injectCaptionLayerGuard(
    ensureCaptionLayer(materializedHtml, captions, { generateCaptions }),
    { visualStrategy: project?.visual_strategy || null }
  );
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
  const normalized = normalizeProject(project);
  const needsTemplateRegistry = normalized.frames.some(frame => frame.source_mode !== 'raw_html' && !getFrameOverride(normalized, frame));
  if (!templateRegistry && needsTemplateRegistry) {
    throw new Error('缺少 templateRegistry。');
  }
  const diagnostics = [];
  const rawHtmlPathCounts = new Map();
  for (const frame of normalized.frames) {
    if (frame.source_mode !== 'raw_html' || !frameBeatId(frame) || !frame.html_path) continue;
    const htmlPath = toPosixPath(frame.html_path);
    rawHtmlPathCounts.set(htmlPath, (rawHtmlPathCounts.get(htmlPath) || 0) + 1);
  }
  for (let index = 0; index < normalized.frames.length; index += 1) {
    const frameDiagnostics = await materializeFrame({
      projectDir,
      project: normalized,
      frame: normalized.frames[index],
      index,
      templateRegistry,
      rawHtmlPathCounts,
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
  injectCaptionLayerGuard,
  htmlEscape,
  safeJson,
};
