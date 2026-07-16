const assert = require('assert/strict');

const {
  unresolvedLayoutFailure,
} = require('../server/services/creative-video/html-video/frameHtmlPhase');

const failed = unresolvedLayoutFailure({
  htmlResult: { success: true, html: '<html><body>仍有遮挡</body></html>' },
  unresolved: [{ code: 'text_overlap', message: '文本互相遮挡', severity: 'error' }],
  index: 0,
  node: { id: 'frame_01' },
  sceneId: 'scene_01',
});

assert.equal(failed.success, false);
assert.equal(failed.failed_html, '<html><body>仍有遮挡</body></html>');
assert.match(failed.message, /自动修复后仍存在布局遮挡/);
assert.equal(failed.diagnostics.length, 1);
assert.equal(failed.diagnostics[0].code, 'frame_layout_qa_unresolved');
assert.equal(failed.diagnostics[0].severity, 'error');
assert.equal(failed.diagnostics[0].retryable, true);
assert.equal(failed.diagnostics[0].repair_action, 'retry_frame_html');
assert.equal(failed.diagnostics[0].fallback_allowed, false);
assert.equal(failed.diagnostics[0].frame_id, 'frame_01');

console.log('html-video unresolved layout blocking tests passed');
