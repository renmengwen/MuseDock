const express = require('express');
const agentRuns = require('../services/agentRuns');

const router = express.Router();

router.post('/douyin/:aweme_id/runs', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinAgentRun(req.params.aweme_id, {
      template: req.body?.template || agentRuns.TEMPLATE_VIRAL_REWRITE,
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      status: 'failed',
      message: error.message,
    });
  }
});

router.get('/douyin/:aweme_id/runs', async (req, res) => {
  try {
    const result = await agentRuns.listDouyinAgentRuns(req.params.aweme_id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      message: error.message,
    });
  }
});

router.get('/douyin/:aweme_id/runs/:run_id', async (req, res) => {
  try {
    const result = await agentRuns.getDouyinAgentRun(req.params.aweme_id, req.params.run_id);
    return res.status(result.success ? 200 : 404).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: error.message,
    });
  }
});

module.exports = router;
