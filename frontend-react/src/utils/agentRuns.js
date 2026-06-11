function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function formatPlanDuration(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '';
  return `${Math.round(number * 10) / 10}秒`;
}

export function getAgentResultSections(result = {}, template = 'viral_rewrite', run = {}) {
  if (template === 'storyboard_plan') {
    const plan = run?.storyboard_plan && typeof run.storyboard_plan === 'object' ? run.storyboard_plan : {};
    const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
    const budget = plan.narration_budget && typeof plan.narration_budget === 'object' ? plan.narration_budget : {};
    const budgetScenes = Array.isArray(budget.scenes) ? budget.scenes : [];
    const budgetByIndex = new Map(budgetScenes.map(item => [Number(item.index), item]));
    return [
      {
        key: 'storyboard_plan_summary',
        title: '导演分镜规划',
        text: [
          `目标时长：${Number(plan.target_duration_sec || 0) || 0} 秒`,
          `分镜数量：${scenes.length} 个`,
          budget.status ? `口播预算：${budget.status === 'too_long' ? '超时' : budget.status === 'warning' ? '接近上限' : '正常'}` : '',
          budget.estimated_total_duration_sec ? `预计口播：${budget.estimated_total_duration_sec} 秒 / 建议 ${budget.max_recommended_chars || 0} 字内` : '',
        ].join('\n'),
        items: [],
      },
      {
        key: 'storyboard_plan_narration',
        title: '分镜口播',
        text: '',
        items: scenes.map((scene, index) => {
          const sceneNumber = String(scene?.index || index + 1).padStart(2, '0');
          const duration = formatPlanDuration(scene?.target_duration_sec) || '未设时长';
          const headline = scene?.headline || '未命名分镜';
          const narration = scene?.narration_text || '暂无口播';
          const sceneBudget = budgetByIndex.get(Number(scene?.index || index + 1)) || {};
          const budgetText = sceneBudget.status
            ? `｜预算 ${sceneBudget.estimated_duration_sec || 0}s/${sceneBudget.target_duration_sec || 0}s，${sceneBudget.narration_char_count || 0}/${sceneBudget.max_recommended_chars || 0} 字，${sceneBudget.status === 'too_long' ? '超时' : sceneBudget.status === 'warning' ? '接近上限' : '正常'}`
            : '';
          return `${sceneNumber}｜${duration}｜${headline}${budgetText}｜${narration}`;
        }),
      },
      {
        key: 'storyboard_plan_visual',
        title: '画面意图',
        text: '',
        items: scenes.map((scene, index) => {
          const sceneNumber = String(scene?.index || index + 1).padStart(2, '0');
          const visualType = scene?.visual_type_hint || 'text_card';
          const intent = scene?.visual_intent || '暂无画面意图';
          return `${sceneNumber}｜${visualType}｜${intent}`;
        }),
      },
    ];
  }

  if (template === 'comment_insights') {
    return [
      { key: 'summary', title: '洞察摘要', text: result.summary || '', items: [] },
      { key: 'pain_points', title: '用户痛点', text: '', items: asArray(result.pain_points) },
      { key: 'questions', title: '高频问题', text: '', items: asArray(result.questions) },
      { key: 'sentiment', title: '情绪倾向', text: result.sentiment || '', items: [] },
      { key: 'content_opportunities', title: '内容机会', text: '', items: asArray(result.content_opportunities) },
      { key: 'reply_suggestions', title: '回复建议', text: '', items: asArray(result.reply_suggestions) },
    ];
  }

  return [
    { key: 'summary', title: '内容摘要', text: result.summary || '', items: [] },
    { key: 'viral_points', title: '爆点拆解', text: '', items: asArray(result.viral_points) },
    { key: 'audience', title: '受众画像', text: result.audience || '', items: [] },
    { key: 'comment_insights', title: '评论洞察', text: '', items: asArray(result.comment_insights) },
    { key: 'topics', title: '可复用选题', text: '', items: asArray(result.topics) },
    { key: 'rewrite_script', title: '改写脚本', text: result.rewrite_script || '', items: [] },
    { key: 'titles', title: '标题建议', text: '', items: asArray(result.titles) },
  ];
}

export function getAgentStepLabel(status) {
  const labels = {
    done: '已完成',
    failed: '失败',
    running: '执行中',
    pending: '等待中',
  };

  return labels[status] || '未知';
}

export function getWorkflowStageLabel(stage) {
  const labels = {
    empty: '未开始',
    storyboard_plan: '导演分镜',
    storyboard_plan_ready: '导演分镜已完成',
    scene_tts: '分段配音',
    tts_ready: '分段配音已完成',
    visual_storyboard: '视觉分镜',
    storyboard_ready: '视觉分镜已完成',
    visual_storyboard_failed: '视觉分镜失败',
    video_project: '视频工程',
    video_project_ready: '视频工程已完成',
    needs_script_repair: '需要修复脚本',
    needs_visual_repair: '需要修复视觉分镜',
    needs_storyboard_repair: '需要修复视觉分镜',
    done: '已完成',
  };

  return labels[stage] || '未知阶段';
}

export function getWorkflowActionLabel(action) {
  const labels = {
    generate_storyboard_plan: '生成导演分镜',
    synthesize_scene_tts: '生成分段配音',
    retry_scene_tts: '重新生成分段配音',
    generate_visual_storyboard: '生成视觉分镜',
    repair_visual_storyboard: '修复视觉分镜',
    generate_video_project: '生成视频工程',
    render_video: '渲染视频',
    compress_scene_narration: '压缩超时分镜并重新配音',
    done: '已完成',
  };

  return labels[action] || '继续处理';
}

export function isLegacyAgentRun(run) {
  return !!(run?.result?.rewrite_script && !run?.storyboard_plan);
}

export function getRunDisplayTime(value) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('zh-CN', { hour12: false });
}

export function getAgentConfigSourceLabel(source) {
  const labels = {
    default: '默认模板',
    override: '已保存自定义',
    request: '本次临时编辑',
  };
  return labels[source] || '未知来源';
}

export function getValidationSummary(validation = {}) {
  if (validation.success) {
    return { type: 'success', message: '校验通过' };
  }

  const errors = Array.isArray(validation.errors) ? validation.errors.filter(Boolean) : [];
  return {
    type: 'error',
    message: errors[0] || validation.error || '校验失败',
  };
}

function stringifyDebug(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value || {}, null, 2);
}

function hasReplacementGlyph(value) {
  return String(value || '').includes('\uFFFD');
}

function stripReplacementGlyphText(value) {
  return String(value || '')
    .replace(/\uFFFD+/g, ' ')
    .replace(/^[\s:：,，;；、。.-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getStoryboardSceneIssues(storyboard = {}) {
  const scenes = Array.isArray(storyboard.scenes) ? storyboard.scenes : [];
  return scenes.reduce((result, scene, sceneIndex) => {
    const sceneNumber = Number(scene?.index || sceneIndex + 1);
    const issues = [];
    ['headline', 'layout', 'background_prompt'].forEach(field => {
      if (hasReplacementGlyph(scene?.[field])) issues.push(`${field} 包含乱码`);
    });
    const words = Array.isArray(scene?.emphasis_words) ? scene.emphasis_words : [];
    words.forEach((word, wordIndex) => {
      if (hasReplacementGlyph(word)) issues.push(`emphasis_words ${wordIndex + 1} 包含乱码`);
    });
    if (issues.length) result[sceneNumber] = issues;
    return result;
  }, {});
}

export function sanitizeStoryboardSceneText(scene = {}) {
  const cleaned = {};
  if (hasReplacementGlyph(scene.layout)) {
    cleaned.layout = 'center_focus';
  }
  if (hasReplacementGlyph(scene.background_prompt)) {
    cleaned.background_prompt = stripReplacementGlyphText(scene.background_prompt);
  }
  if (hasReplacementGlyph(scene.headline)) {
    cleaned.headline = stripReplacementGlyphText(scene.headline);
  }
  if (Array.isArray(scene.emphasis_words)) {
    const words = scene.emphasis_words
      .map(word => stripReplacementGlyphText(word))
      .filter(Boolean);
    if (words.length !== scene.emphasis_words.length || scene.emphasis_words.some(hasReplacementGlyph)) {
      cleaned.emphasis_words = words;
    }
  }
  return cleaned;
}

export function getDebugSections(run = {}) {
  return [
    { key: 'messages', title: '最终 messages', text: stringifyDebug(run.messages || []) },
    { key: 'raw_output', title: '模型原始输出', text: run.raw_output || run.raw_text || '' },
    { key: 'parse', title: 'JSON 解析状态', text: stringifyDebug(run.parse || {}) },
    { key: 'schema_validation', title: 'schema 校验结果', text: stringifyDebug(run.schema_validation || {}) },
    { key: 'normalized_result', title: '归一化结果', text: stringifyDebug(run.result || {}) },
  ];
}

export function getStoryboardDebugSections(run = {}) {
  return [
    { key: 'storyboard_messages', title: '分镜 messages', text: stringifyDebug(run.storyboard_messages || []) },
    { key: 'storyboard_raw_output', title: '分镜原始输出', text: run.storyboard_raw_output || '' },
    { key: 'storyboard_parse', title: '分镜 JSON 解析状态', text: stringifyDebug(run.storyboard_parse || {}) },
    { key: 'storyboard_schema_validation', title: '分镜 schema 校验结果', text: stringifyDebug(run.storyboard_schema_validation || {}) },
    { key: 'storyboard', title: '归一化分镜', text: stringifyDebug(run.storyboard || {}) },
  ];
}
