const fs = require('fs/promises');
const path = require('path');
const defaultDb = require('../db');
const mediaPipeline = require('./mediaPipeline');

function normalizeIds(ids) {
  const values = Array.isArray(ids) ? ids : [ids];
  return [...new Set(values.map(id => String(id || '').trim()).filter(Boolean))];
}

function assertSafeDouyinId(id) {
  mediaPipeline.getMediaDir(id);
}

async function removeDouyinMediaDir(id, mediaRoot) {
  const dir = mediaPipeline.getMediaDir(id, mediaRoot);
  await fs.rm(dir, { recursive: true, force: true });
  return dir;
}

function cleanupUnusedKeywords(platform, keywords, db) {
  const values = normalizeIds(keywords);
  if (!values.length) return { removed: 0 };
  const table = platform === 'xhs' ? 'xhs_notes' : 'douyin_videos';
  const existsStmt = db.prepare(`SELECT 1 FROM ${table} WHERE source_keyword = ? LIMIT 1`);
  const deleteStmt = db.prepare('DELETE FROM crawl_keywords WHERE platform = ? AND keyword = ?');
  let removed = 0;
  for (const keyword of values) {
    if (!existsStmt.get(keyword)) {
      removed += deleteStmt.run(platform, keyword).changes;
    }
  }
  return { removed };
}

async function deleteDouyin(ids, options = {}) {
  const db = options.db || defaultDb;
  const normalizedIds = normalizeIds(ids);
  normalizedIds.forEach(assertSafeDouyinId);
  const rowsBeforeDelete = normalizedIds.length
    ? db.prepare(`SELECT aweme_id, source_keyword FROM douyin_videos WHERE aweme_id IN (${normalizedIds.map(() => '?').join(',')})`).all(...normalizedIds)
    : [];
  const keywords = rowsBeforeDelete.map(row => row.source_keyword).filter(Boolean);

  const deleteRows = db.transaction((values) => {
    const deleteComments = db.prepare('DELETE FROM douyin_comments WHERE aweme_id = ?');
    const deleteVideos = db.prepare('DELETE FROM douyin_videos WHERE aweme_id = ?');
    return values.map((id) => ({
      id,
      comments: deleteComments.run(id).changes,
      records: deleteVideos.run(id).changes,
    }));
  });

  const rows = deleteRows(normalizedIds);
  const keywordCleanup = cleanupUnusedKeywords('douyin', keywords, db);
  const media = [];
  for (const id of normalizedIds) {
    media.push({ id, dir: await removeDouyinMediaDir(id, options.mediaRoot) });
  }

  return {
    success: true,
    platform: 'douyin',
    requested_ids: normalizedIds,
    deleted_ids: normalizedIds,
    deleted: rows,
    keyword_cleanup: keywordCleanup,
    media,
  };
}

async function deleteXhs(ids, options = {}) {
  const db = options.db || defaultDb;
  const normalizedIds = normalizeIds(ids);
  const rowsBeforeDelete = normalizedIds.length
    ? db.prepare(`SELECT note_id, source_keyword FROM xhs_notes WHERE note_id IN (${normalizedIds.map(() => '?').join(',')})`).all(...normalizedIds)
    : [];
  const keywords = rowsBeforeDelete.map(row => row.source_keyword).filter(Boolean);
  const deleteRows = db.transaction((values) => {
    const deleteComments = db.prepare('DELETE FROM xhs_comments WHERE note_id = ?');
    const deleteNotes = db.prepare('DELETE FROM xhs_notes WHERE note_id = ?');
    return values.map((id) => ({
      id,
      comments: deleteComments.run(id).changes,
      records: deleteNotes.run(id).changes,
    }));
  });

  return {
    success: true,
    platform: 'xhs',
    requested_ids: normalizedIds,
    deleted_ids: normalizedIds,
    deleted: deleteRows(normalizedIds),
    keyword_cleanup: cleanupUnusedKeywords('xhs', keywords, db),
    media: [],
  };
}

async function deleteHistoryItems(platform, ids, options = {}) {
  const normalizedPlatform = platform === 'xhs' ? 'xhs' : 'douyin';
  const normalizedIds = normalizeIds(ids);
  if (!normalizedIds.length) {
    return {
      success: false,
      platform: normalizedPlatform,
      message: '请选择要删除的记录。',
      deleted_ids: [],
    };
  }

  if (normalizedPlatform === 'xhs') {
    return deleteXhs(normalizedIds, options);
  }
  return deleteDouyin(normalizedIds, options);
}

module.exports = {
  deleteHistoryItems,
  normalizeIds,
};
