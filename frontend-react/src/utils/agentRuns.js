function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function getAgentResultSections(result = {}, template = 'viral_rewrite') {
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
