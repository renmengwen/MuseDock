const express = require('express');
const db = require('../db');
const mediaPipeline = require('../services/mediaPipeline');

const router = express.Router();

function getDouyinCommentCacheMap(rows) {
  const ids = rows.map(row => row.aweme_id).filter(Boolean);
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const commentRows = db.prepare(`
    SELECT aweme_id, COUNT(*) AS count
    FROM douyin_comments
    WHERE aweme_id IN (${placeholders})
    GROUP BY aweme_id
  `).all(...ids);
  return new Map(commentRows.map(row => [String(row.aweme_id), Number(row.count) || 0]));
}

async function attachDouyinMediaStatus(rows) {
  const commentCacheMap = getDouyinCommentCacheMap(rows);
  return Promise.all(rows.map(async (row) => {
    if (!row.aweme_id) return row;
    const cachedCommentCount = commentCacheMap.get(String(row.aweme_id)) || 0;
    try {
      const status = await mediaPipeline.getStatus(row.aweme_id);
      const steps = status.steps || {};
      const framesReady = steps.frames?.status === 'done';
      const audioReady = steps.audio?.status === 'done';
      const videoReady = steps.video?.status === 'done';
      const transcriptDone = status.transcript?.status === 'done' || steps.transcript?.status === 'done';
      return {
        ...row,
        media_status: {
          ready: videoReady && audioReady && framesReady,
          transcript_done: transcriptDone,
          dir: status.dir,
          steps,
          transcript_path: status.transcript?.transcript_path || status.transcript?.path || '',
        },
        comment_cache: {
          cached: cachedCommentCount > 0,
          count: cachedCommentCount,
        },
      };
    } catch (error) {
      return {
        ...row,
        media_status: {
          ready: false,
          transcript_done: false,
          error: error.message,
        },
        comment_cache: {
          cached: cachedCommentCount > 0,
          count: cachedCommentCount,
        },
      };
    }
  }));
}

router.get('/douyin', async (req, res) => {
  const { keyword } = req.query;
  const rows = keyword
    ? db.prepare('SELECT * FROM douyin_videos WHERE source_keyword = ? ORDER BY crawled_at DESC LIMIT 200').all(keyword)
    : db.prepare('SELECT * FROM douyin_videos ORDER BY crawled_at DESC LIMIT 200').all();
  const data = await attachDouyinMediaStatus(rows);
  res.json({ success: true, count: rows.length, data });
});

router.get('/xhs', (req, res) => {
  const { keyword } = req.query;
  const rows = keyword
    ? db.prepare('SELECT * FROM xhs_notes WHERE source_keyword = ? ORDER BY crawled_at DESC LIMIT 200').all(keyword)
    : db.prepare('SELECT * FROM xhs_notes ORDER BY crawled_at DESC LIMIT 200').all();
  res.json({ success: true, count: rows.length, data: rows });
});

module.exports = router;
