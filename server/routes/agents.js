const express = require('express');
const agentRuns = require('../services/agentRuns');
const agentTemplateOverrides = require('../services/agentTemplateOverrides');

const router = express.Router();
const { TEMPLATE_VIRAL_REWRITE } = agentRuns;

router.get('/templates', async (req, res) => {
  const result = await agentTemplateOverrides.listTaskAgentConfigs();
  return res.json(result);
});

router.get('/templates/:id', async (req, res) => {
  const result = await agentTemplateOverrides.getTaskAgentConfig(req.params.id);
  return res.status(result.success ? 200 : 404).json(result);
});

router.put('/templates/:id', async (req, res) => {
  const result = await agentTemplateOverrides.saveTaskAgentConfig(req.params.id, req.body || {});
  return res.status(result.success ? 200 : 400).json(result);
});

router.delete('/templates/:id/override', async (req, res) => {
  const result = await agentTemplateOverrides.clearTaskAgentOverride(req.params.id);
  return res.json(result);
});

router.get('/storyboard-template', async (req, res) => {
  const result = await agentTemplateOverrides.getStoryboardAgentConfig();
  return res.json(result);
});

router.put('/storyboard-template', async (req, res) => {
  const result = await agentTemplateOverrides.saveStoryboardAgentConfig(req.body || {});
  return res.status(result.success ? 200 : 400).json(result);
});

router.delete('/storyboard-template/override', async (req, res) => {
  const result = await agentTemplateOverrides.clearStoryboardAgentOverride();
  return res.json(result);
});

router.post('/douyin/:aweme_id/runs', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinAgentRun(req.params.aweme_id, {
      template: req.body?.template || TEMPLATE_VIRAL_REWRITE,
      promptOptions: req.body?.promptOptions || {},
      agentConfigOverride: req.body?.agentConfigOverride || null,
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
      storyboardConfigOverride: req.body?.storyboardConfigOverride || null,
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

router.put('/douyin/:aweme_id/runs/:run_id/storyboard', async (req, res) => {
  try {
    const result = await agentRuns.updateDouyinRunStoryboard(
      req.params.aweme_id,
      req.params.run_id,
      req.body?.storyboard || {},
    );
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '保存 AI 分镜接口异常，请稍后重试。',
    });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/hyperframes/project', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinRunHyperframesProject(req.params.aweme_id, req.params.run_id, {
      renderOptions: req.body?.renderOptions || {},
    });
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
