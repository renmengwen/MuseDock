const fs = require('fs/promises');
const path = require('path');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assertInside(rootDir, targetPath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('raw_html 文本同步路径不能逃逸工程目录。');
  }
  return target;
}

function resolveProjectPath(projectDir, relativePath) {
  const text = String(relativePath || '');
  if (!text || path.isAbsolute(text)) {
    throw new Error('raw_html 文本同步路径无效。');
  }
  return assertInside(projectDir, path.resolve(projectDir, text));
}

function findFrame(project, frameId) {
  const id = String(frameId || '').trim();
  return (Array.isArray(project?.frames) ? project.frames : [])
    .find(frame => frame?.id === id || frame?.scene_id === id);
}

function normalizeTextValue(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean).join(' / ');
  if (value && typeof value === 'object') return Object.values(value).map(item => String(item || '').trim()).filter(Boolean).join(' / ');
  return String(value ?? '').trim();
}

function visualTextEntries(visualText = {}) {
  return Object.entries(objectOrEmpty(visualText))
    .map(([key, value]) => [key, normalizeTextValue(value)])
    .filter(([, value]) => value);
}

function replaceDataTextKey(html, key, value) {
  const escapedKey = escapeRegExp(key);
  const pattern = new RegExp(`(<([A-Za-z][A-Za-z0-9:-]*)(?=[^>]*\\bdata-text-key=["']${escapedKey}["'])[^>]*>)([\\s\\S]*?)(<\\/\\2>)`, 'i');
  if (!pattern.test(html)) {
    return { html, updated: false };
  }
  return {
    html: html.replace(pattern, `$1${htmlEscape(value)}$4`),
    updated: true,
  };
}

async function syncRawHtmlFrameTextPatch({ projectDir, project, editPatch } = {}) {
  const patch = objectOrEmpty(editPatch);
  if (patch.type !== 'frame_patch') {
    return { updated: false, updated_keys: [] };
  }
  const visualText = objectOrEmpty(objectOrEmpty(patch.metadata_patch).visual_text);
  const entries = visualTextEntries(visualText);
  if (!entries.length) {
    return { updated: false, updated_keys: [] };
  }
  const frame = findFrame(project, patch.frame_id);
  if (!frame || frame.source_mode !== 'raw_html' || !frame.html_path) {
    return { updated: false, updated_keys: [] };
  }

  const htmlPath = resolveProjectPath(projectDir, frame.html_path);
  let html = await fs.readFile(htmlPath, 'utf8');
  const updatedKeys = [];
  for (const [key, value] of entries) {
    const next = replaceDataTextKey(html, key, value);
    if (next.updated) {
      html = next.html;
      updatedKeys.push(key);
    }
  }
  if (!updatedKeys.length) {
    return { updated: false, updated_keys: [] };
  }
  await fs.writeFile(htmlPath, html, 'utf8');
  return { updated: true, updated_keys: updatedKeys };
}

module.exports = {
  syncRawHtmlFrameTextPatch,
  replaceDataTextKey,
};
