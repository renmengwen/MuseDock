const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/douyin', (req, res) => {
  const { keyword } = req.query;
  const rows = keyword
    ? db.prepare('SELECT * FROM douyin_videos WHERE source_keyword = ? ORDER BY crawled_at DESC LIMIT 200').all(keyword)
    : db.prepare('SELECT * FROM douyin_videos ORDER BY crawled_at DESC LIMIT 200').all();
  res.json({ success: true, count: rows.length, data: rows });
});

router.get('/xhs', (req, res) => {
  const { keyword } = req.query;
  const rows = keyword
    ? db.prepare('SELECT * FROM xhs_notes WHERE source_keyword = ? ORDER BY crawled_at DESC LIMIT 200').all(keyword)
    : db.prepare('SELECT * FROM xhs_notes ORDER BY crawled_at DESC LIMIT 200').all();
  res.json({ success: true, count: rows.length, data: rows });
});

module.exports = router;
