const MAX_TRANSCRIPT_CHARS = 8000;
const MAX_COMMENTS_CHARS = 4000;

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
    : [];
}

function normalizeViralRewriteResult(value = {}) {
  const result = value && typeof value === 'object' ? value : {};
  return {
    summary: typeof result.summary === 'string' ? result.summary : '',
    viral_points: normalizeStringArray(result.viral_points),
    audience: typeof result.audience === 'string' ? result.audience : '',
    comment_insights: normalizeStringArray(result.comment_insights),
    topics: normalizeStringArray(result.topics),
    rewrite_script: typeof result.rewrite_script === 'string' ? result.rewrite_script : '',
    titles: normalizeStringArray(result.titles),
  };
}

function normalizeCommentInsightsResult(value = {}) {
  const result = value && typeof value === 'object' ? value : {};
  return {
    summary: typeof result.summary === 'string' ? result.summary : '',
    pain_points: normalizeStringArray(result.pain_points),
    questions: normalizeStringArray(result.questions),
    sentiment: typeof result.sentiment === 'string' ? result.sentiment : '',
    content_opportunities: normalizeStringArray(result.content_opportunities),
    reply_suggestions: normalizeStringArray(result.reply_suggestions),
  };
}

function buildViralRewritePrompt({ analysisInput = {}, transcript = {}, commentsText = '', commentCount = 0 } = {}) {
  const video = analysisInput.video || {};
  const statistics = video.statistics || {};
  const transcriptText = typeof transcript.text === 'string' ? transcript.text : '';
  const transcriptTruncated = transcriptText.length > MAX_TRANSCRIPT_CHARS;
  const promptTranscript = transcriptTruncated
    ? transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)
    : transcriptText;
  const transcriptNote = transcriptTruncated
    ? `转写文本已截断，仅保留前 ${MAX_TRANSCRIPT_CHARS} 字。`
    : '转写文本未截断。';
  const commentsNote = commentCount > 0
    ? `本地评论缓存共 ${commentCount} 条，以下是抽样评论：\n${commentsText}`
    : '暂无本地评论缓存。评论洞察需要基于视频内容谨慎推断，并在结果中说明依据不足。';

  return [
    {
      role: 'system',
      content: [
        '你是 MuseDock 的受控内容创作 Agent。',
        '请只输出 JSON，不要输出 Markdown、解释或代码块。',
        'JSON 字段必须包含 summary, viral_points, audience, comment_insights, topics, rewrite_script, titles。',
        'viral_points, comment_insights, topics, titles 必须是字符串数组。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '任务：爆款拆解 + 改写脚本。',
        `视频标题：${video.title || ''}`,
        `作者：${video.author?.nickname || ''}`,
        `链接：${video.aweme_url || ''}`,
        `统计：点赞 ${statistics.digg_count || statistics.liked_count || 0}，评论 ${statistics.comment_count || 0}，分享 ${statistics.share_count || 0}`,
        '',
        '转写文本：',
        transcriptNote,
        promptTranscript,
        '',
        '评论信息：',
        commentsNote,
      ].join('\n'),
    },
  ];
}

function buildCommentInsightsPrompt({ analysisInput = {}, commentsText = '', commentCount = 0 } = {}) {
  const video = analysisInput.video || {};
  const statistics = video.statistics || {};
  return [
    {
      role: 'system',
      content: [
        '你是 MuseDock 的评论研究 Agent。',
        '请只输出 JSON，不要输出 Markdown、解释或代码块。',
        'JSON 字段必须包含 summary, pain_points, questions, sentiment, content_opportunities, reply_suggestions。',
        'pain_points, questions, content_opportunities, reply_suggestions 必须是字符串数组。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '任务：评论洞察。',
        `视频标题：${video.title || ''}`,
        `作者：${video.author?.nickname || ''}`,
        `统计：评论 ${statistics.comment_count || commentCount || 0}，点赞 ${statistics.digg_count || statistics.liked_count || 0}`,
        '',
        `本地评论缓存共 ${commentCount} 条。请从评论里提炼用户痛点、高频问题、整体情绪、可转化为内容的机会，以及适合运营回复的建议。`,
        '',
        '评论样本：',
        commentsText || '暂无评论样本。',
      ].join('\n'),
    },
  ];
}

const templates = [
  {
    id: 'viral_rewrite',
    label: '爆款拆解 + 改写脚本',
    description: '基于素材、转写和评论生成爆点拆解、受众画像、改写脚本和标题建议。',
    requireTranscript: true,
    requireComments: false,
    resultFields: ['summary', 'viral_points', 'audience', 'comment_insights', 'topics', 'rewrite_script', 'titles'],
    normalizeResult: normalizeViralRewriteResult,
    buildPrompt: buildViralRewritePrompt,
  },
  {
    id: 'comment_insights',
    label: '评论洞察',
    description: '从本地评论缓存中提炼用户痛点、高频问题、情绪倾向和内容机会。',
    requireTranscript: false,
    requireComments: true,
    resultFields: ['summary', 'pain_points', 'questions', 'sentiment', 'content_opportunities', 'reply_suggestions'],
    normalizeResult: normalizeCommentInsightsResult,
    buildPrompt: buildCommentInsightsPrompt,
  },
];

function getAgentTemplate(id) {
  const value = typeof id === 'string' ? id.trim() : '';
  return templates.find(template => template.id === value) || null;
}

function listAgentTemplates() {
  return templates.map(({ id, label, description, requireTranscript, requireComments, resultFields }) => ({
    id,
    label,
    description,
    requireTranscript,
    requireComments,
    resultFields,
  }));
}

module.exports = {
  MAX_TRANSCRIPT_CHARS,
  MAX_COMMENTS_CHARS,
  getAgentTemplate,
  listAgentTemplates,
  normalizeStringArray,
};
