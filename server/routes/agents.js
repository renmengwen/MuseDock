const express = require('express');
const agentRuns = require('../services/agentRuns');

const router = express.Router();
const { TEMPLATE_VIRAL_REWRITE } = agentRuns;

router.post('/douyin/:aweme_id/runs', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinAgentRun(req.params.aweme_id, {
      template: req.body?.template || TEMPLATE_VIRAL_REWRITE,
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      status: 'failed',
      message: 'Agent 执行接口异常，请稍后重试。',
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
      message: '读取 Agent 运行记录失败，请稍后重试。',
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
      message: '读取 Agent 运行详情失败，请稍后重试。',
    });
  }
});

module.exports = router;
