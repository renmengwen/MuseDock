const express = require('express');
const storedCookies = require('../state/cookies');
const aiModelConfig = require('../services/ai/aiModelConfig');
const appSettings = require('../services/appSettings');
const { cleanupTargets, getSystemHealth } = require('../services/systemMaintenance');

const router = express.Router();
const SUPPORTED_CLEANUP_TARGETS = new Set(['creative-workflows', 'media-cache', 'render-outputs', 'browser-data', 'cookies']);

async function getAppSettingsRoute(req, res) {
  try {
    const config = await appSettings.getPublicConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: '读取应用设置失败。', error: error.message });
  }
}

async function saveAppSettingsRoute(req, res) {
  try {
    const config = await appSettings.saveConfig(req.body || {});
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: '保存应用设置失败。', error: error.message });
  }
}

async function getConfigSystemHealthRoute(req, res) {
  try {
    const health = await getSystemHealth({ refresh: req.query?.refresh === '1' });
    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({ success: false, message: '读取系统状态失败。', error: error.message });
  }
}

async function cleanupConfigDataRoute(req, res) {
  const targets = Array.isArray(req.body?.targets)
    ? req.body.targets.map(target => String(target || '').trim()).filter(Boolean)
    : [];

  if (targets.length === 0) {
    return res.status(400).json({ success: false, message: '请选择要清理的类型。' });
  }
  if (targets.some(target => !SUPPORTED_CLEANUP_TARGETS.has(target))) {
    return res.status(400).json({ success: false, message: '不支持的清理类型。' });
  }

  try {
    const result = await cleanupTargets({
      targets,
      storedCookies,
    });
    return res.status(result.success ? 200 : 409).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: '清理维护数据失败。', error: error.message });
  }
}

router.get('/app-settings', getAppSettingsRoute);
router.post('/app-settings', saveAppSettingsRoute);
router.get('/system-health', getConfigSystemHealthRoute);
router.post('/maintenance/cleanup', cleanupConfigDataRoute);

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
module.exports.cleanupConfigDataRoute = cleanupConfigDataRoute;
