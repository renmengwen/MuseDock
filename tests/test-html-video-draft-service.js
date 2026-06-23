const assert = require('assert/strict');

const {
  createDraftEntry,
  findDraft,
  markDraftAccepted,
  markDraftDiscarded,
} = require('../server/services/creative-video/html-video/htmlVideoDraftService');

const project = {
  frames: [{
    id: 'scene_06',
    source_mode: 'raw_html',
    html_path: 'frames/06-scene_06.html',
    drafts: [],
  }],
};

const draft = createDraftEntry({
  project,
  frameId: 'scene_06',
  kind: 'manual_source',
  summary: '修复遮挡',
});

assert.match(draft.id, /^draft_\d{8}_\d{6}_\d{3}_\d{4}$/);
assert.equal(draft.kind, 'manual_source');
assert.equal(draft.status, 'ready');
assert.equal(draft.summary, '修复遮挡');
assert.equal(draft.html_path, `frames/.drafts/scene_06/${draft.id}.html`);
assert.equal(project.frames[0].active_draft_id, draft.id);
assert.equal(project.frames[0].drafts.length, 1);
assert.equal(findDraft(project, 'scene_06', draft.id), draft);

const sameMoment = new Date('2026-01-02T03:04:05.006Z');
const sameMomentProject = {
  frames: [{
    id: 'scene_same_moment',
    source_mode: 'raw_html',
    html_path: 'frames/same-moment.html',
    drafts: [],
  }],
};
const firstSameMomentDraft = createDraftEntry({
  project: sameMomentProject,
  frameId: 'scene_same_moment',
  now: sameMoment,
});
const secondSameMomentDraft = createDraftEntry({
  project: sameMomentProject,
  frameId: 'scene_same_moment',
  now: sameMoment,
});
assert.notEqual(firstSameMomentDraft.id, secondSameMomentDraft.id);
assert.match(firstSameMomentDraft.id, /_0001$/);
assert.match(secondSameMomentDraft.id, /_0002$/);

const legacyProject = {
  frames: [{
    id: 'legacy_frame',
    source_mode: 'raw_html',
    html_path: 'frames/legacy.html',
  }],
};
assert.equal(findDraft(legacyProject, 'legacy_frame', 'missing'), null);
assert.equal(Object.hasOwn(legacyProject.frames[0], 'drafts'), false);
const legacyDraft = createDraftEntry({ project: legacyProject, frameId: 'legacy_frame' });
assert.equal(Array.isArray(legacyProject.frames[0].drafts), true);
assert.equal(legacyProject.frames[0].drafts[0], legacyDraft);

const aliasProject = {
  frames: [{
    id: 'canonical_scene',
    scene_id: 'scene_alias',
    sceneId: 'sceneCamelAlias',
    graph_node_id: 'graph_alias',
    graphNodeId: 'graphCamelAlias',
    source_mode: 'raw_html',
    html_path: 'frames/canonical.html',
  }],
};
const sceneAliasDraft = createDraftEntry({ project: aliasProject, frameId: 'scene_alias' });
assert.equal(sceneAliasDraft.html_path, `frames/.drafts/canonical_scene/${sceneAliasDraft.id}.html`);
assert.equal(findDraft(aliasProject, 'sceneCamelAlias', sceneAliasDraft.id), sceneAliasDraft);
assert.equal(findDraft(aliasProject, 'graph_alias', sceneAliasDraft.id), sceneAliasDraft);
assert.equal(findDraft(aliasProject, 'graphCamelAlias', sceneAliasDraft.id), sceneAliasDraft);

markDraftAccepted(project, 'scene_06', draft.id);
assert.equal(draft.status, 'accepted');
assert.equal(project.frames[0].active_draft_id, '');

const second = createDraftEntry({ project, frameId: 'scene_06', kind: 'ai_iterate' });
markDraftDiscarded(project, 'scene_06', second.id);
assert.equal(second.status, 'discarded');
assert.equal(project.frames[0].active_draft_id, '');

assert.equal(findDraft(project, 'missing', second.id), null);
assert.throws(() => createDraftEntry({ project, frameId: 'missing' }), /未找到帧/);

console.log('html-video draft service tests passed');
