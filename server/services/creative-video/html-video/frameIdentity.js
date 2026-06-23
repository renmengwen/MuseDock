function normalizeId(value) {
  return String(value || '').trim();
}

function frameIds(frame = {}) {
  return [
    frame.id,
    frame.scene_id,
    frame.sceneId,
    frame.graph_node_id,
    frame.graphNodeId,
  ].map(normalizeId).filter(Boolean);
}

function findFrameByAnyId(project = {}, frameId) {
  const id = normalizeId(frameId);
  if (!id) return null;
  const frames = Array.isArray(project.frames) ? project.frames : [];
  return frames.find(frame => frameIds(frame).includes(id)) || null;
}

function canonicalFrameId(frame = {}) {
  return frameIds(frame)[0] || '';
}

function sanitizePathSegment(value) {
  const text = normalizeId(value);
  return text ? text.replace(/[^A-Za-z0-9_.-]/g, '_') : 'frame';
}

module.exports = {
  findFrameByAnyId,
  canonicalFrameId,
  sanitizePathSegment,
};
