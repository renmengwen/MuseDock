const { normalizeSceneSpec } = require('../sceneSpecService');
const { topoSort, getNode } = require('./contentGraph');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resolveNodeSceneId(node = {}) {
  const input = objectOrEmpty(node);
  return String(input.scene_id || input.sceneId || input.metadata?.scene_id || input.id || '').trim();
}

function sceneIdsFromSpec(sceneSpec = {}) {
  const normalized = normalizeSceneSpec(sceneSpec || {});
  return (normalized.scenes || []).map(scene => String(scene.id || '').trim());
}

function orderedNodes(graph = {}) {
  return topoSort(graph).map(nodeId => getNode(graph, nodeId) || { id: nodeId });
}

function graphNodeCount(graph = {}) {
  return Array.isArray(graph && graph.nodes) ? graph.nodes.length : 0;
}

function validateGraphMatchesSceneSpec(graph = {}, sceneSpec = {}) {
  const expected = sceneIdsFromSpec(sceneSpec);
  if (expected.length === 0) {
    return {
      ok: false,
      reason: 'scene_spec_empty',
      expected_count: 0,
      actual_count: graphNodeCount(graph),
      expected_scene_ids: expected,
    };
  }

  let nodes;
  try {
    nodes = orderedNodes(graph);
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid_graph',
      message: error && error.message ? error.message : String(error),
      details: {
        name: error && error.name ? error.name : 'Error',
      },
      expected_scene_ids: expected,
    };
  }

  const actual = nodes.map(resolveNodeSceneId);

  if (actual.length !== expected.length) {
    return {
      ok: false,
      reason: 'node_count_mismatch',
      expected_count: expected.length,
      actual_count: actual.length,
      expected_scene_ids: expected,
      actual_scene_ids: actual,
    };
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      return {
        ok: false,
        reason: 'scene_order_mismatch',
        index,
        expected_scene_id: expected[index],
        actual_scene_id: actual[index],
        expected_scene_ids: expected,
        actual_scene_ids: actual,
      };
    }
  }

  return {
    ok: true,
    scene_ids: actual,
  };
}

module.exports = {
  resolveNodeSceneId,
  validateGraphMatchesSceneSpec,
};
