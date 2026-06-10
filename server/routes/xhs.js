const express = require('express');
const { searchNotes: searchXhsNotes, getNoteDetail } = require('../scraper/xhs');
const storedCookies = require('../state/cookies');
const { saveCrawlKeyword } = require('../services/crawlKeywords');
const { saveXhsNotes } = require('../services/xhsStore');

const router = express.Router();

router.get('/search', async (req, res) => {
  const { keyword, max = 20 } = req.query;
  if (!keyword) return res.status(400).json({ error: 'Missing keyword' });

  console.log(`[API] XHS search: ${keyword}`);
  try {
    const results = await searchXhsNotes(keyword, parseInt(max, 10), storedCookies.xhs);
    const store = saveXhsNotes(results);
    if (store.saved > 0) {
      saveCrawlKeyword('xhs', keyword);
    }
    return res.json({ success: true, count: results.length, data: results, store });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/detail', async (req, res) => {
  const { note_id } = req.query;
  if (!note_id) return res.status(400).json({ error: 'Missing note_id' });

  try {
    const detail = await getNoteDetail(note_id);
    return res.json({ success: true, data: detail });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
