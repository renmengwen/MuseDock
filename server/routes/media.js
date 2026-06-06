const express = require('express');
const { getVideoDetail } = require('../scraper/douyin');
const mediaPipeline = require('../services/mediaPipeline');

const router = express.Router();

router.post('/douyin/:aweme_id/prepare', async (req, res) => {
  const awemeId = req.params.aweme_id;
  if (!awemeId) return res.status(400).json({ success: false, error: 'Missing aweme_id' });

  try {
    const force = req.query.force === 'true' || req.body?.force === true;
    const status = !force ? await mediaPipeline.getStatus(awemeId) : null;
    let metadata = status?.metadata?.aweme_id ? status.metadata : null;
    let detail = null;

    if (!metadata) {
      detail = await getVideoDetail(awemeId);
      if (!detail.success) return res.status(500).json(detail);
      if (detail.needLogin || detail.needVerify) return res.json(detail);
      metadata = detail.data;
    }

    if (!metadata?.aweme_id) {
      return res.status(502).json({
        success: false,
        aweme_id: awemeId,
        error: 'Douyin detail API did not return video metadata.',
        diagnostic: detail?.diagnostic,
      });
    }

    const result = await mediaPipeline.prepareDouyinMedia(awemeId, metadata, { force });
    return res.json({
      ...result,
      cache: { metadata: detail ? 'remote' : 'local', force },
      detail_diagnostic: detail?.diagnostic,
      elapsed: detail?.elapsed,
    });
  } catch (error) {
    return res.status(500).json({ success: false, aweme_id: awemeId, error: error.message });
  }
});

router.get('/douyin/:aweme_id/status', async (req, res) => {
  try {
    const result = await mediaPipeline.getStatus(req.params.aweme_id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, aweme_id: req.params.aweme_id, error: error.message });
  }
});

router.post('/douyin/:aweme_id/transcribe', async (req, res) => {
  try {
    const result = await mediaPipeline.transcribeAudio(req.params.aweme_id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, aweme_id: req.params.aweme_id, error: error.message });
  }
});

module.exports = router;
