function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function getAgentResultSections(result = {}) {
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
