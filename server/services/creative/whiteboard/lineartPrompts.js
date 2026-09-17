const { WhiteboardError, sha256 } = require('./contracts');

function scenePrompt(media, scene, { includePending = true } = {}) {
  const pending = includePending && media.pendingLineartPrompts?.[scene.id];
  const imagePrompt = pending ? pending.imagePrompt : media.lineartPrompts?.[scene.id] ?? scene.imagePrompt;
  const revision = pending ? pending.revision : media.overrides?.[`lineart_generation:${scene.id}`] || '';
  return { imagePrompt, revision, pending: Boolean(pending),
    identity: sha256({ mediaId: media.id, planIdentity: media.planIdentity, sceneId: scene.id, imagePrompt, revision }) };
}

function validatePrompt(payload) {
  if (typeof payload.imagePrompt !== 'string' || payload.imagePrompt.trim().length < 8
    || payload.imagePrompt.length > 6000 || /同上|沿用上一幕|参见上一幕/.test(payload.imagePrompt)) {
    throw new WhiteboardError('INVALID_INPUT', '请输入独立、完整的线稿提示词，长度为 8–6000 个字符，不要引用上一幕。');
  }
  if (typeof payload.revision !== 'string' || payload.revision.length > 3000) {
    throw new WhiteboardError('INVALID_INPUT', '附加修改要求最多 3000 个字符，没有时请留空。');
  }
  return { imagePrompt: payload.imagePrompt.trim(), revision: payload.revision.trim() };
}

module.exports = { scenePrompt, validatePrompt };
