const path = require('path');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toPosixPath(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function firstNonBlank(entries) {
  for (const entry of entries) {
    const value = entry?.value;
    const normalized = value == null ? '' : String(value).trim();
    if (normalized) {
      return {
        value: normalized,
        source: entry.source,
      };
    }
  }
  return { value: '', source: null };
}

function resolveProjectPath(projectDir, pathInfo) {
  const normalized = toPosixPath(pathInfo.value);
  if (path.isAbsolute(normalized)) {
    if (pathInfo.source !== 'sourcePath') {
      throw new Error('frame 渲染路径不能逃逸工程目录。');
    }
    return path.resolve(normalized);
  }
  if (!projectDir) {
    throw new Error('frame 渲染相对路径需要 projectDir。');
  }
  const target = path.resolve(projectDir, normalized);
  const relative = path.relative(projectDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('frame 渲染路径不能逃逸工程目录。');
  }
  return target;
}

function getFrameHtmlPath(frame) {
  return firstNonBlank([
    { value: frame.html_path, source: 'html_path' },
    { value: frame.htmlPath, source: 'htmlPath' },
    { value: frame.sourcePath, source: 'sourcePath' },
  ]);
}

function resolveFrameRenderSource({ projectDir, project = {}, frame = {} } = {}) {
  if (!frame || typeof frame !== 'object') throw new Error('缺少 frame。');

  if (frame.source_mode !== 'raw_html') {
    const error = new Error('旧版模板帧不支持再编辑或重渲染，请重新发起任务。');
    error.code = 'legacy_template_frame';
    throw error;
  }

  const duration = Number(frame.duration_sec || frame.durationSec || 3);
  const durationSec = Number.isFinite(duration) && duration > 0 ? duration : 3;
  const engine = frame.engine || 'hyperframes-playwright';
  const variables = objectOrEmpty(frame.inputs);
  const frameHtmlPath = getFrameHtmlPath(frame);

  if (!frameHtmlPath.value) throw new Error(`raw_html 帧 ${frame.id || ''} 缺少 html_path。`);
  const htmlPath = toPosixPath(frameHtmlPath.value);
  return {
    frame_id: frame.id || frame.scene_id || null,
    source_mode: 'raw_html',
    engine,
    html_path: htmlPath,
    absolute_html_path: resolveProjectPath(projectDir, frameHtmlPath),
    duration_sec: durationSec,
    variables,
  };
}

module.exports = { resolveFrameRenderSource };
