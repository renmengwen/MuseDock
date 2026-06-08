const assert = require('assert');

const templates = require('./server/services/agentTemplates');

const all = templates.listAgentTemplates();
assert.ok(all.length >= 2);
assert.deepEqual(
  all.map(item => item.id),
  ['viral_rewrite', 'comment_insights'],
);
assert.equal(all[0].label, '爆款拆解 + 改写脚本');
assert.equal(all[1].label, '评论洞察');

const viral = templates.getAgentTemplate('viral_rewrite');
assert.equal(viral.id, 'viral_rewrite');
assert.equal(viral.requireTranscript, true);
assert.equal(viral.requireComments, false);
assert.deepEqual(viral.resultFields, ['summary', 'viral_points', 'audience', 'comment_insights', 'topics', 'rewrite_script', 'titles']);

const commentInsights = templates.getAgentTemplate('comment_insights');
assert.equal(commentInsights.id, 'comment_insights');
assert.equal(commentInsights.requireTranscript, false);
assert.equal(commentInsights.requireComments, true);
assert.deepEqual(commentInsights.resultFields, ['summary', 'pain_points', 'questions', 'sentiment', 'content_opportunities', 'reply_suggestions']);

assert.equal(templates.getAgentTemplate('missing'), null);

const normalized = commentInsights.normalizeResult({
  summary: '评论集中关注教程',
  pain_points: ['不会配置 API', '', null],
  questions: ['是否支持导出？'],
  sentiment: '期待但担心门槛',
  content_opportunities: ['做一条配置教程'],
  reply_suggestions: ['感谢反馈，我们会补教程'],
});
assert.deepEqual(normalized, {
  summary: '评论集中关注教程',
  pain_points: ['不会配置 API'],
  questions: ['是否支持导出？'],
  sentiment: '期待但担心门槛',
  content_opportunities: ['做一条配置教程'],
  reply_suggestions: ['感谢反馈，我们会补教程'],
});

const prompt = commentInsights.buildPrompt({
  analysisInput: {
    video: {
      title: '本地素材工作流',
      author: { nickname: 'Tester' },
      statistics: { comment_count: 2 },
    },
  },
  commentsText: '- 太需要教程了\n- API 怎么配置？',
  commentCount: 2,
});
assert.match(prompt[0].content, /summary, pain_points, questions, sentiment, content_opportunities, reply_suggestions/);
assert.match(prompt[1].content, /评论洞察/);
assert.match(prompt[1].content, /太需要教程了/);

const customPrompt = viral.buildPrompt({
  analysisInput: {
    video: {
      title: '测试视频',
      author: { nickname: '作者A' },
      statistics: { digg_count: 12, comment_count: 3, share_count: 1 },
    },
  },
  transcript: { text: '原始转写文本' },
  commentsText: '评论样本',
  commentCount: 1,
  promptOptions: {
    goal: '引流到私域',
    audience: '本地生活商家老板',
    accountPositioning: '短视频获客顾问',
    rewriteStyle: '专业可信，开头要有冲突感',
    forbidden: '不要承诺收益，不要夸大效果',
    extraRequirements: '脚本要适合 60 秒口播',
  },
});

assert.match(customPrompt[1].content, /用户补充创作 brief/);
assert.match(customPrompt[1].content, /引流到私域/);
assert.match(customPrompt[1].content, /本地生活商家老板/);
assert.match(customPrompt[1].content, /不要承诺收益/);
assert.match(customPrompt[0].content, /summary, viral_points, audience, comment_insights, topics, rewrite_script, titles/);

const cleanPrompt = viral.buildPrompt({
  promptOptions: {
    goal: 'x'.repeat(500),
    audience: '',
    forbidden: ['bad'],
  },
});
assert.ok(cleanPrompt[1].content.length < 12000);
assert.doesNotMatch(cleanPrompt[1].content, /bad/);

console.log('agent template tests passed');
