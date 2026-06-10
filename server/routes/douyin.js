const express = require('express');
const {
  searchNotes,
  startQrcodeLogin,
  checkLoginResult,
  checkLoginStatus,
  getComments,
  getVideosByIds,
  getCreatorVideos,
} = require('../scraper/douyin');
const storedCookies = require('../state/cookies');
const { getLocalDouyinComments, saveDouyinVideos, saveDouyinComments } = require('../services/douyinStore');
const { saveCrawlKeyword } = require('../services/crawlKeywords');

const router = express.Router();

function saveVideosSafely(items = [], label = 'Douyin videos') {
  try {
    return saveDouyinVideos(items || []);
  } catch (storeError) {
    console.error(`[API] ${label} store failed:`, storeError.message);
    return { saved: 0, error: storeError.message };
  }
}

function sendCrawlResult(res, result, fallbackMessage, storeLabel) {
  if (!result.success) {
    return res.status(500).json({
      success: false,
      error: result.error,
      diagnostic: result.diagnostic,
      message: fallbackMessage,
      needLogin: !!result.needLogin,
      needVerify: !!result.needVerify,
      data: result.data || [],
      count: result.count || 0,
      elapsed: result.elapsed,
    });
  }

  if (result.needLogin || result.needVerify) {
    return res.json({
      success: true,
      count: result.count || 0,
      data: result.data || [],
      needLogin: !!result.needLogin,
      needVerify: !!result.needVerify,
      message: result.message || fallbackMessage,
      diagnostic: result.diagnostic,
      elapsed: result.elapsed,
    });
  }

  const store = saveVideosSafely(result.data || [], storeLabel);
  if (storeLabel === 'Douyin search' && store.saved > 0) {
    saveCrawlKeyword('douyin', result.data?.[0]?.source_keyword || result.data?.[0]?.keyword);
  }
  return res.json({
    success: true,
    count: result.count || (result.data || []).length,
    data: result.data || [],
    elapsed: result.elapsed,
    diagnostic: result.diagnostic,
    store,
  });
}

router.post('/qrcode-login', async (req, res) => {
  console.log('\n[API] ====== Douyin QR login ======');
  try {
    const result = await startQrcodeLogin();

    if (result.needVerify) {
      return res.json({
        success: true,
        alreadyLoggedIn: false,
        needVerify: true,
        message: result.message || 'Douyin captcha page detected. Complete verification in the opened Chrome window.',
      });
    }

    if (result.alreadyLoggedIn) {
      return res.json({
        success: true,
        alreadyLoggedIn: true,
        message: 'Login state detected, no need to scan again',
      });
    }

    return res.json({
      success: true,
      alreadyLoggedIn: false,
      qrcode: result.qrcode,
      message: 'Please scan the QR code with Douyin App',
      hint: 'QR code is shown in the dialog',
    });
  } catch (err) {
    console.error('[API] Douyin QR login failed:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/login-status', async (req, res) => {
  try {
    const result = await checkLoginResult();
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/check-login', async (req, res) => {
  try {
    const status = await checkLoginStatus();
    return res.json({ success: true, ...status });
  } catch (err) {
    return res.json({ success: true, loggedIn: false, message: err.message });
  }
});

router.get('/search', async (req, res) => {
  const { keyword, max = 20 } = req.query;
  if (!keyword) return res.status(400).json({ error: 'Missing keyword' });

  console.log(`\n[API] ====== Douyin search: "${keyword}" ======`);
  try {
    const results = await searchNotes(keyword, parseInt(max, 10), storedCookies.douyin);

    return sendCrawlResult(res, results, 'Search failed. Please check whether the browser is running normally.', 'Douyin search');
  } catch (err) {
    console.error('[API] Douyin search failed:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
      message: 'Search failed. Please make sure QR login has been completed.',
      needLogin: false,
    });
  }
});

router.get('/aweme', async (req, res) => {
  const { ids, aweme_id } = req.query;
  const raw = ids || aweme_id;
  if (!raw) return res.status(400).json({ success: false, error: 'Missing aweme_id' });

  console.log(`\n[API] ====== Douyin aweme detail: "${raw}" ======`);
  try {
    const values = String(raw).split(/[\n,，\s]+/).map(item => item.trim()).filter(Boolean);
    const result = await getVideosByIds(values);
    return sendCrawlResult(res, result, 'Specified video crawl failed. Please check login and video ID.', 'Douyin aweme detail');
  } catch (err) {
    console.error('[API] Douyin aweme detail failed:', err.message);
    return res.status(500).json({ success: false, error: err.message, message: 'Specified video crawl failed.' });
  }
});

router.get('/creator', async (req, res) => {
  const { sec_uid, url, max = 20 } = req.query;
  const input = sec_uid || url;
  if (!input) return res.status(400).json({ success: false, error: 'Missing sec_uid' });

  console.log(`\n[API] ====== Douyin creator crawl: "${input}" ======`);
  try {
    const result = await getCreatorVideos(input, max);
    return sendCrawlResult(res, result, 'Creator crawl failed. Please check login and creator homepage.', 'Douyin creator');
  } catch (err) {
    console.error('[API] Douyin creator crawl failed:', err.message);
    return res.status(500).json({ success: false, error: err.message, message: 'Creator crawl failed.' });
  }
});

router.get('/comments', async (req, res) => {
  const { aweme_id, max = 50, includeReplies = 'true', maxReplies = 20 } = req.query;
  if (!aweme_id) return res.status(400).json({ success: false, error: 'Missing aweme_id' });

  try {
    const result = await getComments(aweme_id, {
      max,
      includeReplies: includeReplies !== 'false',
      maxReplies,
    });
    if (!result.success && (result.needLogin || result.needVerify)) return res.json(result);
    if (!result.success) return res.status(500).json(result);
    try {
      result.store = saveDouyinComments(aweme_id, result.data || []);
    } catch (storeError) {
      console.error('[API] Douyin comments store failed:', storeError.message);
      result.store = { saved: 0, error: storeError.message };
    }
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/comments/local', (req, res) => {
  const { aweme_id, max = 50, maxReplies = 20 } = req.query;
  if (!aweme_id) return res.status(400).json({ success: false, error: 'Missing aweme_id' });

  try {
    return res.json(getLocalDouyinComments(aweme_id, { max, maxReplies }));
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
