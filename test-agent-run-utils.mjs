import assert from 'node:assert/strict';
import {
  getAgentResultSections,
  getAgentStepLabel,
  getRunDisplayTime,
} from './frontend-react/src/utils/agentRuns.js';

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

console.log('agent run utils tests passed');
