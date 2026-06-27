import assert from 'node:assert/strict';

const { resolveSavedDraftId } = await import('../frontend-react/src/components/creative-video-editor/draftResultPayload.mjs');

// 从 html_video_project.frames[].active_draft_id 解析
assert.equal(
  resolveSavedDraftId({ html_video_project: { frames: [{ id: 'frame_01', active_draft_id: 'draft_a' }] } }, 'frame_01'),
  'draft_a',
);
// scene_id 也能匹配
assert.equal(
  resolveSavedDraftId({ project: { frames: [{ scene_id: 'scene_02', active_draft_id: 'draft_b' }] } }, 'scene_02'),
  'draft_b',
);
// 嵌套 data.project
assert.equal(
  resolveSavedDraftId({ data: { project: { frames: [{ id: 'frame_03', active_draft_id: 'draft_c' }] } } }, 'frame_03'),
  'draft_c',
);
// 回退到顶层 draft_id / draft.id
assert.equal(resolveSavedDraftId({ draft_id: 'draft_d' }, 'frame_x'), 'draft_d');
assert.equal(resolveSavedDraftId({ draft: { id: 'draft_e' } }, 'frame_x'), 'draft_e');
// 找不到返回空串
assert.equal(resolveSavedDraftId(null, 'frame_x'), '');
assert.equal(resolveSavedDraftId({ html_video_project: { frames: [] } }, 'frame_x'), '');

console.log('html-video draft result payload tests passed');
