function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function makeWorkflow(stage, nextAction, message) {
  return {
    stage,
    next_action: nextAction,
    message,
    updated_at: new Date().toISOString(),
  };
}

function getQualityIssue(run = {}) {
  const qualityReport = run.video?.video_quality_report || run.video_quality_report || {};
  const issues = Array.isArray(qualityReport.issues) ? qualityReport.issues : [];

  if (issues.some((issue) => issue && issue.code === 'duration_too_long')) {
    return 'duration_too_long';
  }
  if (issues.some((issue) => issue && issue.code === 'unbound_visual_objects')) {
    return 'unbound_visual_objects';
  }
  if (issues.some((issue) => issue && issue.code === 'invalid_caption_sync')) {
    return 'invalid_caption_sync';
  }

  return null;
}

function decideNextAction(run = {}) {
  const qualityIssue = getQualityIssue(run);
  if (qualityIssue === 'duration_too_long') {
    return makeWorkflow(
      'needs_script_repair',
      'compress_scene_narration',
      '视频时长过长，需要压缩场景旁白并重新配音。'
    );
  }
  if (qualityIssue === 'unbound_visual_objects' || qualityIssue === 'invalid_caption_sync') {
    return makeWorkflow(
      'needs_storyboard_repair',
      'repair_visual_storyboard',
      '画面分镜存在质量问题，需要修复视觉分镜。'
    );
  }

  const video = run.video || {};
  if (video.status === 'rendered' && video.output_url) {
    return makeWorkflow('done', 'done', '视频已渲染完成。');
  }
  if (video.status === 'project_ready' && video.project_dir) {
    return makeWorkflow('video_project_ready', 'render_video', '视频项目已准备完成，下一步渲染视频。');
  }

  const storyboard = run.storyboard || {};
  const storyboardHasScenes = hasItems(storyboard.scenes);
  const schemaValidation = run.storyboard_schema_validation || {};
  if (storyboardHasScenes && schemaValidation.success === false) {
    return makeWorkflow('needs_storyboard_repair', 'repair_visual_storyboard', '分镜结构校验失败，需要修复视觉分镜。');
  }
  if (storyboardHasScenes) {
    return makeWorkflow('storyboard_ready', 'generate_video_project', '视觉分镜已准备完成，下一步生成视频项目。');
  }

  const sceneTts = run.scene_tts || {};
  if (sceneTts.status === 'failed') {
    return makeWorkflow('tts_failed', 'retry_scene_tts', '场景配音失败，需要重新尝试配音。');
  }

  const timedPlan = sceneTts.timed_storyboard_plan || run.timed_storyboard_plan || {};
  if (sceneTts.status === 'done' && timedPlan.status === 'timed' && hasItems(timedPlan.captions)) {
    return makeWorkflow('tts_ready', 'generate_visual_storyboard', '配音和字幕时间轴已完成，下一步生成视觉分镜。');
  }

  const storyboardPlan = run.storyboard_plan || {};
  if (storyboardPlan.status === 'planned' && hasItems(storyboardPlan.scenes)) {
    if (storyboardPlan.narration_budget?.status === 'too_long') {
      return makeWorkflow('needs_script_repair', 'compress_scene_narration', '口播文本超出目标时长，需要先压缩分镜口播再生成配音。');
    }
    return makeWorkflow('storyboard_plan_ready', 'synthesize_scene_tts', '故事板计划已完成，下一步合成场景配音。');
  }

  return makeWorkflow('needs_storyboard_plan', 'generate_storyboard_plan', '需要先生成故事板计划。');
}

module.exports = {
  decideNextAction,
  getQualityIssue,
  makeWorkflow,
};
