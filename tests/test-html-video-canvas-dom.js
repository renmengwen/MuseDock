const assert = require('assert');

(async () => {
  const dom = await import('../frontend-react/src/components/creative-video-editor/htmlVideoCanvasDom.mjs');
  const {
    clamp,
    createDraftSummary,
    editableSelector,
    excludedSelector,
    formatElementLabel,
    nextEditId,
    parsePx,
  } = dom;

  assert.strictEqual(clamp(5, 1, 4), 4);
  assert.strictEqual(clamp(-2, 1, 4), 1);
  assert.strictEqual(clamp(3, 1, 4), 3);

  assert.strictEqual(parsePx('12px'), 12);
  assert.strictEqual(parsePx(''), 0);
  assert.strictEqual(parsePx('auto'), 0);
  assert.strictEqual(parsePx('3.5px'), 3.5);

  assert.ok(editableSelector.includes('[data-text-key]'));
  assert.ok(editableSelector.includes('[data-role]'));
  assert.ok(editableSelector.includes('.output'));
  assert.ok(excludedSelector.includes('.hv-caption-layer'));
  assert.ok(excludedSelector.includes('[data-hv-managed="true"]'));

  assert.strictEqual(formatElementLabel({
    textKey: 'headline',
    role: 'title',
    editId: 'hv_edit_001',
    className: 'card-title',
    tagName: 'h1',
  }), 'headline');

  assert.strictEqual(formatElementLabel({
    textKey: '',
    role: 'complaint',
    editId: 'hv_edit_001',
    className: 'complaint',
    tagName: 'div',
  }), 'complaint');

  assert.strictEqual(formatElementLabel({
    textKey: '',
    role: '',
    editId: '',
    className: 'card-title primary',
    tagName: 'h1',
  }), '.card-title');

  assert.strictEqual(nextEditId(new Set()), 'hv_edit_001');
  assert.strictEqual(nextEditId(new Set(['hv_edit_001', 'hv_edit_002'])), 'hv_edit_003');
  assert.strictEqual(createDraftSummary('太重'), '画布调整：太重');
  assert.strictEqual(createDraftSummary(''), '画布调整：元素位置');

  console.log('test-html-video-canvas-dom passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
