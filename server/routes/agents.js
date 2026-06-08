const express = require('express');
const agentRuns = require('../services/agentRuns');

const router = express.Router();
const { TEMPLATE_VIRAL_REWRITE } = agentRuns;

router.post('/douyin/:aweme_id/runs', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinAgentRun(req.params.aweme_id, {
      template: req.body?.template || TEMPLATE_VIRAL_REWRITE,
      promptOptions: req.body?.promptOptions || {},
    });
    return res.json(result);
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

router.post('/douyin/:aweme_id/runs/:run_id/tts', async (req, res) => {
  try {
    const result = await agentRuns.synthesizeDouyinRunTts(req.params.aweme_id, req.params.run_id, {
      voice: req.body?.voice,
      stylePrompt: req.body?.stylePrompt,
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: 'TTS 合成接口异常，请稍后重试。',
    });
  }
});

router.get('/douyin/:aweme_id/runs/:run_id/tts/:file_name', (req, res) => {
  try {
    const filePath = agentRuns.resolveDouyinRunTtsFile(req.params.aweme_id, req.params.run_id, req.params.file_name);
    return res.sendFile(filePath);
  } catch (error) {
    return res.status(400).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '未找到或非法的 TTS 音频文件。',
    });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/storyboard', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinRunStoryboard(req.params.aweme_id, req.params.run_id, {
      storyboardOptions: req.body?.storyboardOptions || {},
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: 'AI 分镜生成接口异常，请稍后重试。',
    });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/hyperframes/project', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinRunHyperframesProject(req.params.aweme_id, req.params.run_id);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '视频工程生成接口异常，请稍后重试。',
    });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/hyperframes/render', async (req, res) => {
  try {
    const result = await agentRuns.renderDouyinRunHyperframesVideo(req.params.aweme_id, req.params.run_id);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '视频渲染接口异常，请稍后重试。',
    });
  }
});

router.get('/douyin/:aweme_id/runs/:run_id/hyperframes/files/:file_name', (req, res) => {
  try {
    const filePath = agentRuns.resolveDouyinRunHyperframesFile(req.params.aweme_id, req.params.run_id, req.params.file_name);
    return res.sendFile(filePath);
  } catch (error) {
    return res.status(400).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '未找到或非法的视频文件。',
    });
  }
});

module.exports = router;
