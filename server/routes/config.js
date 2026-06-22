const express = require('express');
const storedCookies = require('../state/cookies');
const aiModelConfig = require('../services/aiModelConfig');
const appSettings = require('../services/appSettings');
const {
  DEFAULT_ROOT_DIR,
  scanTemplateManifests,
  validateTemplateCompatibility,
  mappedEngine,
  getManifestAspect,
} = require('../services/creative-video/html-video/templateRegistry');

const router = express.Router();

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

async function getConfigTemplatesRoute(req, res) {
  try {
    const defaults = await appSettings.getCreativeDefaults();
    const aspectRatio = defaults && defaults.aspectRatio;
    const manifests = scanTemplateManifests(DEFAULT_ROOT_DIR);
    const templates = manifests.map(manifest => {
      const output = manifest.output || {};
      const compatibility = validateTemplateCompatibility(manifest, { aspectRatio });

      return {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description || '',
        category: manifest.category || '',
        tags: Array.isArray(manifest.tags) ? manifest.tags : [],
        engine: manifest.engine,
        mapped_engine: mappedEngine(manifest.engine),
        aspect_ratio: getManifestAspect(manifest),
        duration_sec: output.duration_sec ?? output.duration,
        source_entry: manifest.source_entry,
        license: manifest.license,
        compatible: compatibility.ok,
        compatibility_reasons: compatibility.reasons,
      };
    });

    res.json({ success: true, data: templates });
  } catch (error) {
    res.status(500).json({ success: false, message: '读取视频模板失败。', error: error.message });
  }
}

router.get('/app-settings', getAppSettingsRoute);
router.post('/app-settings', saveAppSettingsRoute);
router.get('/templates', getConfigTemplatesRoute);

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
