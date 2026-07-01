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
  '[data-hv-managed="true"]',
  '[data-role="subtitle-caption"]',
];

const editableSelector = editableParts.join(',');
const excludedSelector = excludedParts.join(',');

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function parsePx(value) {
  const number = Number(String(value || '').replace(/px$/i, ''));
  return Number.isFinite(number) ? number : 0;
}

function formatElementLabel(info = {}) {
  if (info.textKey) return String(info.textKey);
  if (info.role) return String(info.role);
  if (info.editId) return String(info.editId);
  const firstClass = String(info.className || '').trim().split(/\s+/).filter(Boolean)[0];
  if (firstClass) return `.${firstClass}`;
  return String(info.tagName || 'element').toLowerCase();
}

function nextEditId(existingIds = new Set()) {
  let index = 1;
  while (existingIds.has(`hv_edit_${String(index).padStart(3, '0')}`)) {
    index += 1;
  }
  return `hv_edit_${String(index).padStart(3, '0')}`;
}

function createDraftSummary(label = '') {
  const safe = String(label || '').trim();
  return `画布调整：${safe || '元素位置'}`;
}

module.exports = {
  clamp,
  createDraftSummary,
  editableSelector,
  excludedSelector,
  formatElementLabel,
  nextEditId,
  parsePx,
};
