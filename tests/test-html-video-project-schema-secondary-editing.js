const assert = require('assert/strict');

const { normalizeProject } = require('../server/services/creative-video/html-video/projectSchema');
const {
  findFrameByAnyId,
  canonicalFrameId,
  sanitizePathSegment,
} = require('../server/services/creative-video/html-video/frameIdentity');

{
  const project = normalizeProject({
    frames: [{
      id: 'frame_primary',
      scene_id: 'scene_legacy',
      graph_node_id: 'graph_node',
      source_mode: 'raw_html',
      html_path: 'frames/frame.html',
      drafts: [{ id: 'draft_0001', html_path: 'frames/.drafts/frame_primary/draft_0001.html' }],
      active_draft_id: 'draft_0001',
    }],
    edit_sessions: [{ id: 'edit_plan_0001', kind: 'edit_plan', status: 'planned' }],
    layout_qa_reports: [{ id: 'layout_qa_0001', success: true, issues: [] }],
  });

  assert.deepEqual(project.frames[0].drafts, [{ id: 'draft_0001', html_path: 'frames/.drafts/frame_primary/draft_0001.html' }]);
  assert.equal(project.frames[0].active_draft_id, 'draft_0001');
  assert.deepEqual(project.edit_sessions, [{ id: 'edit_plan_0001', kind: 'edit_plan', status: 'planned' }]);
  assert.deepEqual(project.layout_qa_reports, [{ id: 'layout_qa_0001', success: true, issues: [] }]);
}

{
  const project = normalizeProject({
    frames: [{
      id: 'frame_primary',
      scene_id: 'scene_legacy',
      graph_node_id: 'graph_node',
      source_mode: 'raw_html',
      html_path: 'frames/frame.html',
    }],
  });

  assert.equal(findFrameByAnyId(project, 'frame_primary').id, 'frame_primary');
  assert.equal(findFrameByAnyId(project, 'scene_legacy').id, 'frame_primary');
  assert.equal(findFrameByAnyId(project, 'graph_node').id, 'frame_primary');
  assert.equal(findFrameByAnyId(project, 'missing'), null);
  assert.equal(canonicalFrameId(project.frames[0]), 'frame_primary');
  assert.equal(sanitizePathSegment('scene/06:报价'), 'scene_06___');
  assert.deepEqual(project.frames[0].drafts, []);
  assert.equal(project.frames[0].active_draft_id, '');
  assert.deepEqual(project.edit_sessions, []);
  assert.deepEqual(project.layout_qa_reports, []);
}

{
  const project = normalizeProject({
    frames: [{
      id: 'frame_camel',
      sceneId: 'scene_camel',
      graphNodeId: 'graph_camel',
      source_mode: 'raw_html',
      html_path: 'frames/camel.html',
    }],
  });

  assert.equal(findFrameByAnyId(project, 'scene_camel').id, 'frame_camel');
  assert.equal(findFrameByAnyId(project, 'graph_camel').id, 'frame_camel');
}

console.log('html-video secondary editing schema tests passed');
