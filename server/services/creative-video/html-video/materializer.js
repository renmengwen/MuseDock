const fs = require('fs/promises');
const path = require('path');

const { normalizeProject } = require('./projectSchema');
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

const CAPTION_GUARD_STYLE = `<style data-hv-caption-guard>
.hv-caption-layer {
  z-index: 2147483647 !important;
  pointer-events: none !important;
}
.hv-caption-layer * { pointer-events: none !important; }
</style>`;

function injectCaptionLayerGuard(html = '') {
  const text = String(html);
  if (text.includes('data-hv-caption-guard')) return text; // 幂等
  if (/<\/head>/i.test(text)) return text.replace(/<\/head>/i, `${CAPTION_GUARD_STYLE}</head>`);
  if (/<body\b/i.test(text)) return text.replace(/<body\b([^>]*)>/i, `<body$1>${CAPTION_GUARD_STYLE}`);
  return CAPTION_GUARD_STYLE + text;
}

function recordUnmanagedCaptionLayerDiagnostic(diagnostics, frame) {
  diagnostics.push({
    code: 'unmanaged_caption_layer_preserved',
    frame_id: frame.id,
    message: '检测到模板或第三方非受管字幕层，已保留并另行写入受管字幕层。',
  });
}

async function materializeFrame({ projectDir, project, frame, index, rawHtmlPathCounts }) {
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
        ensureCaptionLayer(html, captions, { generateCaptions })
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

  // 模板物化路径已删除（asset_first 收敛）：非 raw_html 且无 override 的帧只可能来自旧工程，
  // 统一按模板不可用诊断处理，不再尝试物化。
  diagnostics.push({
    code: 'template_not_found',
    frame_id: frame.id,
    message: '未找到帧对应的 html-video 模板。',
  });
  return diagnostics;
}

async function materializeProject({ projectDir, project }) {
  if (!projectDir) {
    throw new Error('缺少 projectDir。');
  }
  const normalized = normalizeProject(project);
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
  injectCaptionLayerGuard,
  htmlEscape,
};
