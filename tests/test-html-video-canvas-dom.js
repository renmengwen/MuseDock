const assert = require('assert');
const {
  clamp,
  createDraftSummary,
  editableSelector,
  excludedSelector,
  formatElementLabel,
  nextEditId,
  parsePx,
} = require('../frontend-react/src/components/creative-video-editor/htmlVideoCanvasDom.js');

assert.equal(clamp(5, 1, 4), 4);
assert.equal(clamp(-2, 1, 4), 1);
assert.equal(clamp(3, 1, 4), 3);

assert.equal(parsePx('12px'), 12);
assert.equal(parsePx(''), 0);
assert.equal(parsePx('auto'), 0);
assert.equal(parsePx('3.5px'), 3.5);

assert.ok(editableSelector.includes('[data-text-key]'));
assert.ok(editableSelector.includes('[data-role]'));
assert.ok(excludedSelector.includes('.hv-caption-layer'));
assert.ok(excludedSelector.includes('[data-hv-managed="true"]'));

assert.equal(formatElementLabel({
  textKey: 'headline',
  role: 'title',
  editId: 'hv_edit_001',
  className: 'card-title',
  tagName: 'h1',
}), 'headline');

assert.equal(formatElementLabel({
  textKey: '',
  role: 'complaint',
  editId: 'hv_edit_001',
  className: 'complaint',
  tagName: 'div',
}), 'complaint');

assert.equal(formatElementLabel({
  textKey: '',
  role: '',
  editId: '',
  className: 'card-title primary',
  tagName: 'h1',
}), '.card-title');

assert.equal(nextEditId(new Set()), 'hv_edit_001');
assert.equal(nextEditId(new Set(['hv_edit_001', 'hv_edit_002'])), 'hv_edit_003');
assert.equal(createDraftSummary('太重'), '画布调整：太重');
assert.equal(createDraftSummary(''), '画布调整：元素位置');

console.log('test-html-video-canvas-dom passed');
