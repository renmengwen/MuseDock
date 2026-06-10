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
assert.deepEqual(viral.resultFields, ['summary', 'viral_points', 'audience', 'comment_insights', 'topics', 'rewrite_script', 'titles', 'video_brief']);

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
assert.match(customPrompt[0].content, /video_brief/);
assert.match(customPrompt[0].content, /target_duration_sec/);
assert.match(customPrompt[0].content, /beats/);
assert.match(customPrompt[0].content, /45-75/);
assert.match(customPrompt[0].content, /rewrite_script/);
assert.match(customPrompt[0].content, /HyperFrames 短视频成片策划 Agent/);
assert.match(customPrompt[0].content, /去除 AI 味/);
assert.match(customPrompt[0].content, /不要输出 visual_type/);
assert.match(customPrompt[0].content, /不要输出 visual_scene/);
assert.match(customPrompt[0].content, /第一句话直接进入冲突/);
assert.match(customPrompt[0].content, /不要写成公众号摘要/);
assert.match(customPrompt[0].content, /赋能、闭环、沉淀/);
assert.match(customPrompt[1].content, /不是复述原视频/);
assert.match(customPrompt[1].content, /不是做知识总结/);
assert.match(customPrompt[1].content, /原创图文动效短片/);
assert.match(customPrompt[1].content, /可 DOM\/GSAP 表达/);

const normalizedViral = viral.normalizeResult({
  summary: '摘要',
  viral_points: ['爆点'],
  audience: '普通用户',
  comment_insights: ['想看教程'],
  topics: ['主题'],
  rewrite_script: '第一句。第二句。',
  titles: ['标题'],
  video_brief: {
    target_duration_sec: 90,
    target_word_count: 400,
    tone: '知识科普',
    hook: '先抛误解',
    beats: [
      { purpose: 'hook', summary: '拆误解', duration_sec: 6, visual_intent: '强对比开场' },
    ],
  },
});
assert.equal(normalizedViral.video_brief.target_duration_sec, 90);
assert.equal(normalizedViral.video_brief.target_word_count, 400);
assert.equal(normalizedViral.video_brief.beats[0].purpose, 'hook');

const normalizedLongVideoBrief = viral.normalizeResult({
  video_brief: {
    tone: 'x'.repeat(500),
    hook: 'y'.repeat(500),
  },
});
assert.equal(normalizedLongVideoBrief.video_brief.tone.length, 120);
assert.equal(normalizedLongVideoBrief.video_brief.hook.length, 160);
assert.equal(normalizedViral.video_brief.beats[0].visual_intent, '强对比开场');

const emptyViral = viral.normalizeResult({});
assert.deepStrictEqual(emptyViral.video_brief, {
  target_duration_sec: 60,
  target_word_count: 220,
  tone: '',
  hook: '',
  beats: [],
});

const cleanPrompt = viral.buildPrompt({
  promptOptions: {
    goal: 'x'.repeat(500),
    audience: '',
    forbidden: ['bad'],
  },
});
assert.ok(cleanPrompt[1].content.length < 12000);
assert.doesNotMatch(cleanPrompt[1].content, /bad/);

const editableTemplates = templates.listEditableAgentTemplates();
assert.ok(Array.isArray(editableTemplates));
assert.ok(editableTemplates.length >= 2);

const editableViral = templates.getEditableAgentTemplate('viral_rewrite');
assert.equal(editableViral.id, 'viral_rewrite');
assert.equal(editableViral.label, '爆款拆解 + 改写脚本');
assert.ok(editableViral.systemPrompt.includes('MuseDock'));
assert.ok(editableViral.systemPrompt.includes('video_brief'));
assert.ok(editableViral.systemPrompt.includes('45-75'));
assert.ok(editableViral.systemPrompt.includes('HyperFrames 短视频成片策划 Agent'));
assert.ok(editableViral.systemPrompt.includes('去除 AI 味'));
assert.ok(editableViral.systemPrompt.includes('不要输出 visual_type'));
assert.ok(editableViral.systemPrompt.includes('不要输出 visual_scene'));
assert.ok(editableViral.userPromptTemplate.includes('{{transcriptText}}'));
assert.ok(editableViral.userPromptTemplate.includes('{{promptOptionsText}}'));
assert.ok(editableViral.userPromptTemplate.includes('原创图文动效短片'));
assert.deepEqual(editableViral.resultFields, [
  'summary',
  'viral_points',
  'audience',
  'comment_insights',
  'topics',
  'rewrite_script',
  'titles',
  'video_brief',
]);
assert.equal(editableViral.modelOptions.temperature, 0.4);
assert.equal(editableViral.modelOptions.stream, true);

const editableComment = templates.getEditableAgentTemplate('comment_insights');
assert.equal(editableComment.id, 'comment_insights');
assert.ok(editableComment.userPromptTemplate.includes('{{commentsText}}'));
assert.equal(templates.getEditableAgentTemplate('missing'), null);

console.log('agent template tests passed');
