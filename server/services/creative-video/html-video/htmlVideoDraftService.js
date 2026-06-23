const { findFrameByAnyId, canonicalFrameId, sanitizePathSegment } = require('./frameIdentity');

function pad(value, size) {
  return String(value).padStart(size, '0');
}

function makeDraftId(now = new Date(), sequence = 1) {
  return [
    'draft',
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}`,
    `${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}`,
    pad(now.getUTCMilliseconds(), 3),
    pad(sequence, 4),
  ].join('_');
}

function timestamp(now = new Date()) {
  return now.toISOString();
}

function ensureDrafts(frame) {
  if (!Array.isArray(frame.drafts)) frame.drafts = [];
  return frame.drafts;
}

function createDraftEntry({ project, frameId, kind = 'manual_source', summary = '', instruction = '', now = new Date() } = {}) {
  const frame = findFrameByAnyId(project, frameId);
  if (!frame) throw new Error(`未找到帧 ${frameId || ''}。`);
  const safeFrameId = sanitizePathSegment(canonicalFrameId(frame) || frameId);
  const drafts = ensureDrafts(frame);
  let sequence = drafts.length + 1;
  let id = makeDraftId(now, sequence);
  while (drafts.some(draft => draft.id === id)) {
    sequence += 1;
    id = makeDraftId(now, sequence);
  }
  const entry = {
    id,
    kind,
    status: 'ready',
    html_path: `frames/.drafts/${safeFrameId}/${id}.html`,
    created_at: timestamp(now),
    updated_at: timestamp(now),
    summary,
    instruction,
  };
  drafts.push(entry);
  frame.active_draft_id = id;
  return entry;
}

function findDraft(project, frameId, draftId) {
  const frame = findFrameByAnyId(project, frameId);
  if (!frame) return null;
  const id = String(draftId || '').trim();
  const drafts = Array.isArray(frame.drafts) ? frame.drafts : [];
  return drafts.find(draft => draft.id === id) || null;
}

function markDraftAccepted(project, frameId, draftId, now = new Date()) {
  const draft = findDraft(project, frameId, draftId);
  if (!draft) throw new Error(`未找到草稿 ${draftId || ''}。`);
  const frame = findFrameByAnyId(project, frameId);
  draft.status = 'accepted';
  draft.updated_at = timestamp(now);
  if (frame.active_draft_id === draft.id) frame.active_draft_id = '';
  return draft;
}

function markDraftDiscarded(project, frameId, draftId, now = new Date()) {
  const draft = findDraft(project, frameId, draftId);
  if (!draft) throw new Error(`未找到草稿 ${draftId || ''}。`);
  const frame = findFrameByAnyId(project, frameId);
  draft.status = 'discarded';
  draft.updated_at = timestamp(now);
  if (frame.active_draft_id === draft.id) frame.active_draft_id = '';
  return draft;
}

module.exports = {
  createDraftEntry,
  findDraft,
  markDraftAccepted,
  markDraftDiscarded,
};
