const express = require('express');
const storedCookies = require('../state/cookies');
const aiModelConfig = require('../services/aiModelConfig');

const router = express.Router();

router.get('/cookies', (req, res) => {
  res.json({ douyin: storedCookies.douyin, xhs: storedCookies.xhs });
});

router.post('/cookies', (req, res) => {
  const { douyin, xhs } = req.body;
  storedCookies.douyin = douyin || '';
  storedCookies.xhs = xhs || '';
  console.log('[config] Cookies saved: douyin=' + (douyin ? douyin.length + ' chars' : 'empty') + ', xhs=' + (xhs ? xhs.length + ' chars' : 'empty'));
  res.json({ success: true });
});

router.get('/ai-models', async (req, res) => {
  try {
    const config = await aiModelConfig.getPublicConfig();
    res.json({ success: true, ...config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/ai-models', async (req, res) => {
  try {
    const config = await aiModelConfig.saveConfig(req.body || {});
    res.json({ success: true, ...config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
