const assert = require('assert');

const contentGraph = require('../server/services/creative-video/html-video/contentGraph');

function graph(overrides = {}) {
  return {
    schemaVersion: 1,
    intent: 'promo',
    synopsis: '测试图',
    nodes: [
      { id: 'a', kind: 'text', text: 'A', durationSec: 2 },
      { id: 'b', kind: 'data', data: { value: 1 } },
      { id: 'c', kind: 'entity', props: { name: 'C' }, durationSec: 4 },
    ],
    edges: [],
    ...overrides,
  };
}

function assertValidationError(input, code, ref) {
  const result = contentGraph.validate(input);
  assert.equal(result.ok, false);
  const error = result.errors.find(item => item.code === code);
  assert.ok(error, `expected validation error ${code}`);
  if (ref) {
    assert.equal(error.ref, ref);
  }
}

assertValidationError(graph({ nodes: [] }), 'empty-graph');
assertValidationError(
  graph({ nodes: [{ id: 'a', kind: 'text', text: 'A' }, { id: 'a', kind: 'data', data: {} }] }),
  'duplicate-node-id',
  'a'
);
assertValidationError(graph({ edges: [{ from: 'missing', to: 'a', kind: 'dependency' }] }), 'edge-from-unknown-node', 'missing->a');
assertValidationError(graph({ edges: [{ from: 'a', to: 'missing', kind: 'dependency' }] }), 'edge-to-unknown-node', 'a->missing');
assertValidationError(graph({ edges: [{ from: 'a', to: 'a', kind: 'dependency' }] }), 'self-edge', 'a->a');
assertValidationError(graph({ nodes: [{ id: 'bad', kind: 'unknown' }], edges: [] }), 'invalid-kind', 'bad');
assertValidationError(
  graph({ edges: [{ from: 'a', to: 'b', kind: 'dependency' }, { from: 'b', to: 'a', kind: 'dependency' }] }),
  'cycle'
);

assert.deepEqual(
  contentGraph.topoSort(graph({ nodes: [{ id: 'only', kind: 'text', text: 'Only' }] })),
  ['only']
);

assert.deepEqual(
  contentGraph.topoSort(graph({
    nodes: [
      { id: 'final', kind: 'text', text: 'Final' },
      { id: 'setup', kind: 'text', text: 'Setup' },
      { id: 'proof', kind: 'text', text: 'Proof' },
    ],
    edges: [
      { from: 'setup', to: 'final', kind: 'dependency' },
      { from: 'proof', to: 'final', kind: 'dependency' },
    ],
  })),
  ['setup', 'proof', 'final']
);

assert.deepEqual(
  contentGraph.topoSort(graph({
    nodes: [
      { id: 'b', kind: 'text', text: 'B' },
      { id: 'a', kind: 'text', text: 'A' },
      { id: 'c', kind: 'text', text: 'C' },
    ],
    edges: [
      { from: 'a', to: 'b', kind: 'sequence' },
      { from: 'b', to: 'c', kind: 'sequence' },
    ],
  })),
  ['a', 'b', 'c']
);

assert.deepEqual(
  contentGraph.topoSort(graph({
    nodes: [
      { id: 'b', kind: 'text', text: 'B' },
      { id: 'a', kind: 'text', text: 'A' },
      { id: 'c', kind: 'text', text: 'C' },
    ],
    edges: [],
  })),
  ['b', 'a', 'c']
);

assert.throws(
  () => contentGraph.topoSort(graph({
    edges: [
      { from: 'a', to: 'b', kind: 'dependency' },
      { from: 'b', to: 'a', kind: 'dependency' },
    ],
  })),
  /cycle/i
);

assert.equal(contentGraph.DEFAULT_FRAME_DURATION_SEC, 3);
assert.equal(
  contentGraph.totalDurationSec(graph({
    nodes: [
      { id: 'b', kind: 'text', text: 'B' },
      { id: 'a', kind: 'text', text: 'A', durationSec: 1.5 },
      { id: 'c', kind: 'text', text: 'C', durationSec: 2 },
    ],
    edges: [{ from: 'a', to: 'b', kind: 'sequence' }],
  })),
  6.5
);

assert.deepEqual(contentGraph.getNode(graph(), 'b'), { id: 'b', kind: 'data', data: { value: 1 } });

console.log('html-video content graph tests passed');
