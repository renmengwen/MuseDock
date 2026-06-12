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

router.post('/messages/preview', async (req, res) => {
  const result = agentTemplateOverrides.createPreviewMessages(req.body?.config || {}, req.body?.values || {});
  return res.status(result.success ? 200 : 400).json(result);
});

router.post('/storyboard-messages/preview', async (req, res) => {
  const result = agentTemplateOverrides.createStoryboardPreviewMessages(req.body?.config || {}, req.body?.values || {});
  return res.status(result.success ? 200 : 400).json(result);
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

router.post('/douyin/:aweme_id/storyboard-plan-runs', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinStoryboardPlanRun(req.params.aweme_id, {
      promptOptions: req.body?.promptOptions || {},
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      status: 'failed',
      message: '导演分镜生成接口异常，请稍后重试。',
    });
  }
});

router.post('/douyin/:aweme_id/hyperframes-freeform-runs', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinHyperframesFreeformRun(req.params.aweme_id);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      status: 'failed',
      message: '高级成片记录创建接口异常，请稍后重试。',
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

router.get('/douyin/:aweme_id/runs/:run_id/next-action', async (req, res) => {
  try {
    const result = await agentRuns.getDouyinAgentRun(req.params.aweme_id, req.params.run_id);
    if (!result.success) {
      return res.status(404).json(result);
    }
    return res.json({
      success: true,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      workflow: agentRuns.decideNextAction(result.data),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '读取下一步动作失败，请稍后重试。',
    });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/tts', async (req, res) => {
  try {
    const result = await agentRuns.synthesizeDouyinRunTts(req.params.aweme_id, req.params.run_id, {
      voice: req.body?.voice,
      stylePrompt: req.body?.stylePrompt,
      maxRetries: req.body?.maxRetries,
      retryDelayMs: req.body?.retryDelayMs,
      ttsConcurrency: req.body?.ttsConcurrency,
      ttsQueueIntervalMs: req.body?.ttsQueueIntervalMs,
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

router.post('/douyin/:aweme_id/runs/:run_id/scene-tts', async (req, res) => {
  try {
    const result = await agentRuns.synthesizeDouyinRunSceneTts(
      req.params.aweme_id,
      req.params.run_id,
      req.body || {},
    );
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '分段配音接口异常，请稍后重试。',
    });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/compress-narration', async (req, res) => {
  try {
    const result = await agentRuns.compressDouyinRunSceneNarration(
      req.params.aweme_id,
      req.params.run_id,
      req.body || {},
    );
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '压缩分镜口播接口异常，请稍后重试。',
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

router.post('/douyin/:aweme_id/runs/:run_id/visual-storyboard', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinRunVisualStoryboard(req.params.aweme_id, req.params.run_id, {
      storyboardOptions: req.body?.storyboardOptions || {},
      storyboardConfigOverride: req.body?.storyboardConfigOverride || null,
      frameProfileId: req.body?.frameProfileId || '',
      qualityFeedback: req.body?.qualityFeedback || null,
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '视觉分镜生成接口异常，请稍后重试。',
    });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/storyboard', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinRunStoryboard(req.params.aweme_id, req.params.run_id, {
      storyboardOptions: req.body?.storyboardOptions || {},
      storyboardConfigOverride: req.body?.storyboardConfigOverride || null,
      frameProfileId: req.body?.frameProfileId || '',
      qualityFeedback: req.body?.qualityFeedback || null,
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

router.post('/douyin/:aweme_id/runs/:run_id/hyperframes-freeform/brief', async (req, res) => {
  try {
    const result = await agentRuns.generateDouyinRunHyperframesFreeformBrief(req.params.aweme_id, req.params.run_id, {
      briefOptions: req.body || {},
      logger: console,
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: 'HyperFrames 自由导演策划接口异常，请稍后重试。',
    });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/hyperframes-freeform/audio', async (req, res) => {
  try {
    const result = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(req.params.aweme_id, req.params.run_id, {
      voice: req.body?.voice,
      stylePrompt: req.body?.stylePrompt,
      maxRetries: req.body?.maxRetries,
      retryDelayMs: req.body?.retryDelayMs,
      ttsConcurrency: req.body?.ttsConcurrency,
      ttsQueueIntervalMs: req.body?.ttsQueueIntervalMs,
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '高级成片音频生成接口异常，请稍后重试。',
    });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/hyperframes-freeform/project', async (req, res) => {
  try {
    const result = await agentRuns.generateDouyinRunHyperframesFreeformProject(req.params.aweme_id, req.params.run_id, {
      projectOptions: req.body || {},
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: 'HyperFrames 自由工程生成接口异常，请稍后重试。',
    });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/hyperframes-freeform/check', async (req, res) => {
  try {
    const result = await agentRuns.checkDouyinRunHyperframesFreeformProject(req.params.aweme_id, req.params.run_id);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: 'HyperFrames 自由工程校验接口异常，请稍后重试。',
    });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/hyperframes-freeform/render', async (req, res) => {
  try {
    const result = await agentRuns.renderDouyinRunHyperframesFreeformVideo(req.params.aweme_id, req.params.run_id, {
      renderOptions: req.body || {},
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: 'HyperFrames 自由视频渲染接口异常，请稍后重试。',
    });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/hyperframes-freeform/inspect', async (req, res) => {
  try {
    const result = await agentRuns.inspectDouyinRunHyperframesFreeformVideo(req.params.aweme_id, req.params.run_id);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: 'HyperFrames 自由视频巡检接口异常，请稍后重试。',
    });
  }
});

router.get('/douyin/:aweme_id/runs/:run_id/hyperframes-freeform/files/:file_name', (req, res) => {
  if (typeof agentRuns.resolveDouyinRunHyperframesFreeformFile !== 'function') {
    return res.status(501).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: 'HyperFrames 自由工程文件读取接口尚未实现。',
    });
  }

  try {
    const filePath = agentRuns.resolveDouyinRunHyperframesFreeformFile(
      req.params.aweme_id,
      req.params.run_id,
      req.params.file_name,
    );
    return res.sendFile(filePath);
  } catch (error) {
    return res.status(400).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '未找到或非法的 HyperFrames 自由工程文件。',
    });
  }
});

router.put('/douyin/:aweme_id/runs/:run_id/hyperframes-freeform/files/:file_name', async (req, res) => {
  if (typeof agentRuns.saveDouyinRunHyperframesFreeformFile !== 'function') {
    return res.status(501).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: 'HyperFrames 自由工程文件保存接口尚未实现。',
    });
  }

  try {
    const result = await agentRuns.saveDouyinRunHyperframesFreeformFile(
      req.params.aweme_id,
      req.params.run_id,
      req.params.file_name,
      req.body || {},
    );
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: 'HyperFrames 自由工程文件保存接口异常，请稍后重试。',
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
