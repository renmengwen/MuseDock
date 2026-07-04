const editableParts = [
  '[data-text-key]',
  '[data-role]',
  '.headline',
  '.subtitle',
  '.body-text',
  '.body-copy',
  '.card-title',
  '.complaint',
  '.badge',
  '.chip',
  '.output',
  '.card',
  '.panel',
  '.visual',
  '.media',
  '.asset',
  '.shape',
  '.background',
  '[data-asset-id]',
  '[data-hv-editable]',
  'img',
  'video',
  'svg',
  'canvas',
  'figure',
  'section',
  'article',
  'h1',
  'h2',
  'h3',
  'p',
  'li',
];

const excludedParts = [
  'html',
  'body',
  'head',
  'style',
  'script',
  'link',
  'meta',
  '.hv-caption-layer',
  '.hv-caption-item',
  '[data-hv-canvas]',
  '[data-hv-editor-overlay]',
  '[data-hv-editor-handle]',
  '[data-hv-managed="true"]',
  '[data-role="subtitle-caption"]',
];

export const editableSelector = editableParts.join(',');
export const excludedSelector = excludedParts.join(',');

export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function parsePx(value) {
  const number = Number(String(value || '').replace(/px$/i, ''));
  return Number.isFinite(number) ? number : 0;
}

export function formatElementLabel(info = {}) {
  if (info.textKey) return String(info.textKey);
  if (info.role) return String(info.role);
  if (info.assetId) return String(info.assetId);
  if (info.editId) return String(info.editId);
  const firstClass = String(info.className || '').trim().split(/\s+/).filter(Boolean)[0];
  if (firstClass) return `.${firstClass}`;
  return String(info.tagName || 'element').toLowerCase();
}

export function nextEditId(existingIds = new Set()) {
  let index = 1;
  while (existingIds.has(`hv_edit_${String(index).padStart(3, '0')}`)) {
    index += 1;
  }
  return `hv_edit_${String(index).padStart(3, '0')}`;
}

export function createDraftSummary(label = '') {
  const safe = String(label || '').trim();
  return `画布调整：${safe || '元素位置'}`;
}

const textlessTags = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'AUDIO', 'IFRAME', 'HR', 'BR', 'INPUT']);

// 文案编辑把整段文本写进第一个文本节点：若后代元素自带文本（如选中 section），
// 会造成内容整份复制。只有全部可见文本都在自身文本节点里的元素才允许改文案。
export function canEditText(element) {
  if (!element || textlessTags.has(String(element.tagName || '').toUpperCase())) return false;
  return !Array.from(element.children || []).some(child => (child.textContent || '').trim());
}

export function previewAspectRatio(project = {}) {
  const resolution = project?.output?.resolution || project?.resolution || {};
  const width = Number(resolution.width ?? project?.width);
  const height = Number(resolution.height ?? project?.height);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? width / height
    : 16 / 9;
}

export function fitPreviewBox(size = {}, aspectRatio = 16 / 9) {
  const width = Math.max(0, Number(size.width) || 0);
  const height = Math.max(0, Number(size.height) || 0);
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9;
  if (!width || !height) return { width: 0, height: 0 };
  const byWidth = { width, height: width / ratio };
  const fitted = byWidth.height <= height
    ? byWidth
    : { width: height * ratio, height };
  return {
    width: Math.floor(fitted.width),
    height: Math.floor(fitted.height),
  };
}
