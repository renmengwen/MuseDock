const DEFAULT_FRAME_DURATION_SEC = 3;
const NODE_KINDS = new Set(['entity', 'data', 'text']);

function getNodes(graph) {
  return Array.isArray(graph && graph.nodes) ? graph.nodes : [];
}

function getEdges(graph) {
  return Array.isArray(graph && graph.edges) ? graph.edges : [];
}

function validate(graph) {
  const errors = [];
  const warnings = [];
  const nodes = getNodes(graph);
  const edges = getEdges(graph);

  if (nodes.length === 0) {
    errors.push({ code: 'empty-graph', message: 'Graph has no nodes' });
    return { ok: false, errors, warnings };
  }

  const ids = new Set();
  nodes.forEach(node => {
    const id = String((node && node.id) || '');
    if (ids.has(id)) {
      errors.push({
        code: 'duplicate-node-id',
        message: `Duplicate node id "${id}"`,
        ref: id,
      });
    }
    ids.add(id);
    const kind = String((node && node.kind) || '');
    if (!NODE_KINDS.has(kind)) {
      errors.push({
        code: 'invalid-kind',
        message: `Node "${id}" has unknown kind "${kind}"`,
        ref: id,
      });
    }
  });

  edges.forEach(edge => {
    const from = String((edge && edge.from) || '');
    const to = String((edge && edge.to) || '');
    if (from === to) {
      errors.push({
        code: 'self-edge',
        message: `Edge ${from} -> ${to} is a self-edge`,
        ref: `${from}->${to}`,
      });
    }
    if (!ids.has(from)) {
      errors.push({
        code: 'edge-from-unknown-node',
        message: `Edge from unknown node "${from}"`,
        ref: `${from}->${to}`,
      });
    }
    if (!ids.has(to)) {
      errors.push({
        code: 'edge-to-unknown-node',
        message: `Edge to unknown node "${to}"`,
        ref: `${from}->${to}`,
      });
    }
  });

  const cycleNode = findDependencyCycle({ nodes, edges });
  if (cycleNode) {
    errors.push({
      code: 'cycle',
      message: `Dependency cycle detected involving node "${cycleNode}"`,
      ref: cycleNode,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * 与 html-video/packages/content-graph/src/index.ts 对齐：
 * dependency edge 是硬顺序约束；sequence edge 只影响 ready 队列中的软排序；
 * 如果没有 sequence 偏好，按原始 nodes 数组顺序保持稳定输出。
 */
function topoSort(graph) {
  const nodes = getNodes(graph);
  const edges = getEdges(graph);
  const indeg = new Map();
  const deps = new Map();
  const nodeOrder = new Map();

  nodes.forEach((node, index) => {
    indeg.set(node.id, 0);
    deps.set(node.id, []);
    nodeOrder.set(node.id, index);
  });

  edges.forEach(edge => {
    if (edge.kind !== 'dependency') return;
    if (!indeg.has(edge.from) || !indeg.has(edge.to)) return;
    deps.get(edge.from).push(edge.to);
    indeg.set(edge.to, (indeg.get(edge.to) || 0) + 1);
  });

  const seqAfter = new Map();
  edges.forEach(edge => {
    if (edge.kind !== 'sequence') return;
    if (!indeg.has(edge.from) || !indeg.has(edge.to)) return;
    if (!seqAfter.has(edge.from)) {
      seqAfter.set(edge.from, new Set());
    }
    seqAfter.get(edge.from).add(edge.to);
  });

  const ready = [];
  indeg.forEach((degree, id) => {
    if (degree === 0) ready.push(id);
  });
  ready.sort((left, right) => (nodeOrder.get(left) || 0) - (nodeOrder.get(right) || 0));

  const output = [];
  while (ready.length > 0) {
    let pickIndex = 0;
    for (let index = 0; index < ready.length; index += 1) {
      const candidate = ready[index];
      const blockedBySequence = ready.some(other => other !== candidate && seqAfter.get(other) && seqAfter.get(other).has(candidate));
      if (!blockedBySequence) {
        pickIndex = index;
        break;
      }
    }

    const next = ready.splice(pickIndex, 1)[0];
    output.push(next);
    (deps.get(next) || []).forEach(successor => {
      indeg.set(successor, (indeg.get(successor) || 1) - 1);
      if (indeg.get(successor) === 0) {
        const successorOrder = nodeOrder.get(successor) || 0;
        let insertAt = ready.length;
        for (let index = 0; index < ready.length; index += 1) {
          if ((nodeOrder.get(ready[index]) || 0) > successorOrder) {
            insertAt = index;
            break;
          }
        }
        ready.splice(insertAt, 0, successor);
      }
    });
  }

  if (output.length !== nodes.length) {
    throw new Error(`topoSort: cycle detected (sorted ${output.length} of ${nodes.length} nodes)`);
  }
  return output;
}

function findDependencyCycle(graph) {
  const adj = new Map();
  getNodes(graph).forEach(node => adj.set(node.id, []));
  getEdges(graph).forEach(edge => {
    if (edge.kind !== 'dependency') return;
    if (!adj.has(edge.from) || !adj.has(edge.to)) return;
    adj.get(edge.from).push(edge.to);
  });

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  Array.from(adj.keys()).forEach(id => color.set(id, WHITE));

  for (const start of adj.keys()) {
    if (color.get(start) !== WHITE) continue;
    color.set(start, GRAY);
    const stack = [{ id: start, index: 0 }];
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const next = adj.get(top.id)[top.index];
      if (!next) {
        color.set(top.id, BLACK);
        stack.pop();
        continue;
      }
      top.index += 1;
      if (color.get(next) === GRAY) {
        return next;
      }
      if (color.get(next) === WHITE) {
        color.set(next, GRAY);
        stack.push({ id: next, index: 0 });
      }
    }
  }
  return null;
}

function getNode(graph, id) {
  return getNodes(graph).find(node => node.id === id);
}

function totalDurationSec(graph) {
  return topoSort(graph).reduce((total, id) => {
    const node = getNode(graph, id);
    return total + (Number.isFinite(node && node.durationSec) ? node.durationSec : DEFAULT_FRAME_DURATION_SEC);
  }, 0);
}

module.exports = {
  DEFAULT_FRAME_DURATION_SEC,
  validate,
  topoSort,
  totalDurationSec,
  getNode,
};
