import assert from 'node:assert/strict';
import {
  getAgentConfigSourceLabel,
  getAgentResultSections,
  getAgentStepLabel,
  getDebugSections,
  getRunDisplayTime,
  getStoryboardSceneIssues,
  getValidationSummary,
  sanitizeStoryboardSceneText,
} from '../frontend-react/src/utils/agentRuns.js';

const sections = getAgentResultSections({
  summary: '这是一段内容摘要',
  viral_points: ['冲突感', '', null, '反差感'],
  audience: '新手创作者',
  comment_insights: ['用户关注价格', undefined, '用户需要教程'],
  topics: ['低成本拍摄方案'],
  rewrite_script: '大家好，今天聊聊...',
  titles: ['3 个拍摄技巧', false, '新手也能学会的脚本'],
});

assert.equal(sections.length, 7);
assert.deepEqual(
  sections.map((section) => section.title),
  [
    '内容摘要',
    '爆点拆解',
    '受众画像',
    '评论洞察',
    '可复用选题',
    '改写脚本',
    '标题建议',
  ],
);
assert.deepEqual(sections[1].items, ['冲突感', '反差感']);
assert.deepEqual(sections[3].items, ['用户关注价格', '用户需要教程']);
assert.deepEqual(sections[6].items, ['3 个拍摄技巧', '新手也能学会的脚本']);
assert.equal(sections[0].text, '这是一段内容摘要');
assert.equal(sections[2].text, '新手创作者');
assert.equal(sections[5].text, '大家好，今天聊聊...');

const commentSections = getAgentResultSections({
  summary: '评论集中关注教程',
  pain_points: ['配置门槛高'],
  questions: ['是否支持导出？'],
  sentiment: '期待但担心门槛',
  content_opportunities: ['做一条配置教程'],
  reply_suggestions: ['补充教程链接'],
}, 'comment_insights');
assert.deepEqual(
  commentSections.map((section) => section.title),
  ['洞察摘要', '用户痛点', '高频问题', '情绪倾向', '内容机会', '回复建议'],
);
assert.deepEqual(commentSections[1].items, ['配置门槛高']);
assert.equal(commentSections[3].text, '期待但担心门槛');

const emptySections = getAgentResultSections();
assert.equal(emptySections.length, 7);
assert.deepEqual(emptySections.map((section) => section.items), [[], [], [], [], [], [], []]);

assert.equal(getAgentStepLabel('done'), '已完成');
assert.equal(getAgentStepLabel('failed'), '失败');
assert.equal(getAgentStepLabel('running'), '执行中');
assert.equal(getAgentStepLabel('pending'), '等待中');
assert.equal(getAgentStepLabel('paused'), '未知');

assert.equal(getRunDisplayTime(), '-');
assert.equal(getRunDisplayTime(''), '-');
assert.equal(getRunDisplayTime('not-a-date'), 'not-a-date');
assert.equal(
  getRunDisplayTime('2026-06-07T08:09:10+08:00'),
  new Date('2026-06-07T08:09:10+08:00').toLocaleString('zh-CN', { hour12: false }),
);

assert.equal(getAgentConfigSourceLabel('default'), '默认模板');
assert.equal(getAgentConfigSourceLabel('override'), '已保存自定义');
assert.equal(getAgentConfigSourceLabel('request'), '本次临时编辑');

assert.deepEqual(getValidationSummary({ success: false, errors: ['字段缺失'] }), {
  type: 'error',
  message: '字段缺失',
});

const debugSections = getDebugSections({
  messages: [{ role: 'system', content: '系统' }],
  raw_output: '{"summary":"ok"}',
  parse: { success: true, error: '' },
  schema_validation: { success: true, errors: [] },
  result: { summary: 'ok' },
});
assert.equal(debugSections.length, 5);
assert.equal(debugSections[0].title, '最终 messages');

const storyboardIssues = getStoryboardSceneIssues({
  scenes: [
    {
      index: 1,
      headline: 'Vibe Coding',
      layout: '中心标题 ������',
      background_prompt: '������ 深色科技背景',
      emphasis_words: ['语法', '框架'],
    },
    {
      index: 2,
      headline: '流程',
      layout: 'center_focus',
      background_prompt: '干净背景',
      emphasis_words: ['正常', '������'],
    },
  ],
});
assert.deepEqual(storyboardIssues, {
  1: ['layout 包含乱码', 'background_prompt 包含乱码'],
  2: ['emphasis_words 2 包含乱码'],
});

assert.deepEqual(
  sanitizeStoryboardSceneText({
    layout: '中心标题 ������',
    background_prompt: '������ 深色科技背景',
    emphasis_words: ['语法', '������', '框架'],
  }),
  {
    layout: 'center_focus',
    background_prompt: '深色科技背景',
    emphasis_words: ['语法', '框架'],
  },
);

console.log('agent run utils tests passed');
