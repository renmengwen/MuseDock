const assert = require('assert');

const {
  resolveNodeSceneId,
  validateGraphMatchesSceneSpec,
} = require('../server/services/creative-video/html-video/sceneGraphBinding');

function spec() {
  return {
    scenes: [
      { id: 'scene_01', order: 1 },
      { id: 'scene_02', order: 2 },
      { id: 'scene_03', order: 3 },
    ],
  };
}

function graph(ids) {
  return {
    nodes: ids.map(id => ({ id })),
    edges: ids.slice(0, -1).map((id, index) => ({ from: id, to: ids[index + 1], kind: 'sequence' })),
  };
}

{
  assert.equal(resolveNodeSceneId({ id: 'node_a', scene_id: 'scene_01' }), 'scene_01');
  assert.equal(resolveNodeSceneId({ id: 'scene_02' }), 'scene_02');
  assert.equal(resolveNodeSceneId(null), '');
  assert.equal(resolveNodeSceneId([]), '');
  assert.equal(resolveNodeSceneId('x'), '');
  assert.equal(resolveNodeSceneId({ id: 'node', sceneId: 'scene_02' }), 'scene_02');
  assert.equal(resolveNodeSceneId({ id: 'node', metadata: { scene_id: 'scene_03' } }), 'scene_03');
  assert.equal(resolveNodeSceneId({ id: 'scene_04', scene_id: '   ' }), '');
}

{
  const result = validateGraphMatchesSceneSpec(graph(['scene_01', 'scene_02', 'scene_03']), spec());
  assert.equal(result.ok, true);
  assert.deepEqual(result.scene_ids, ['scene_01', 'scene_02', 'scene_03']);
}

{
  const result = validateGraphMatchesSceneSpec({
    nodes: [
      { id: 'node_a', scene_id: 'scene_01' },
      { id: 'node_b', scene_id: 'scene_02' },
      { id: 'node_c', scene_id: 'scene_03' },
    ],
    edges: [],
  }, spec());
  assert.equal(result.ok, true);
  assert.deepEqual(result.scene_ids, ['scene_01', 'scene_02', 'scene_03']);
}

{
  const result = validateGraphMatchesSceneSpec(graph(['scene_01', 'scene_02', 'scene_03', 'scene_04']), spec());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'node_count_mismatch');
}

{
  const result = validateGraphMatchesSceneSpec(graph(['scene_01', 'scene_03']), spec());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'node_count_mismatch');
}

{
  const result = validateGraphMatchesSceneSpec(graph(['scene_02', 'scene_01', 'scene_03']), spec());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'scene_order_mismatch');
  assert.equal(result.index, 0);
}

{
  const result = validateGraphMatchesSceneSpec({
    nodes: [
      { id: 'scene_01' },
      { id: 'scene_02' },
      { id: 'scene_03' },
    ],
    edges: [
      { from: 'scene_02', to: 'scene_01', kind: 'dependency' },
    ],
  }, spec());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'scene_order_mismatch');
  assert.equal(result.index, 0);
  assert.deepEqual(result.actual_scene_ids, ['scene_02', 'scene_01', 'scene_03']);
}

{
  const result = validateGraphMatchesSceneSpec({}, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'scene_spec_empty');
  assert.equal(result.expected_count, 0);
}

{
  const result = validateGraphMatchesSceneSpec({ nodes: [null], edges: [] }, spec());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_graph');
  assert.ok(result.message);
  assert.deepEqual(result.expected_scene_ids, ['scene_01', 'scene_02', 'scene_03']);
}

{
  const result = validateGraphMatchesSceneSpec({
    nodes: [
      { id: 'scene_01' },
      { id: 'scene_02' },
    ],
    edges: [
      { from: 'scene_01', to: 'scene_02', kind: 'dependency' },
      { from: 'scene_02', to: 'scene_01', kind: 'dependency' },
    ],
  }, {
    scenes: [
      { id: 'scene_01', order: 1 },
      { id: 'scene_02', order: 2 },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_graph');
  assert.ok(result.message);
  assert.deepEqual(result.expected_scene_ids, ['scene_01', 'scene_02']);
}
