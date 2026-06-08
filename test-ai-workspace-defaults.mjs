import assert from 'node:assert/strict';
import {
  DEFAULT_PROMPT_OPTIONS,
  DEFAULT_STORYBOARD_OPTIONS,
} from './frontend-react/src/utils/aiWorkspaceDefaults.js';

assert.equal(DEFAULT_PROMPT_OPTIONS.goal, '涨粉');
assert.equal(
  DEFAULT_PROMPT_OPTIONS.audience,
  'AI 技术爱好者、寻求效率提升的职场人士、内容创作者、编程初学者以及对自动化工具感兴趣的人群',
);
assert.equal(DEFAULT_PROMPT_OPTIONS.accountPositioning, 'AI科普账号');

assert.equal(DEFAULT_STORYBOARD_OPTIONS.visualStyle, '知识科普、情绪冲击');
assert.equal(DEFAULT_STORYBOARD_OPTIONS.pacing, '具有强烈的视觉冲击但动画不夸张');

console.log('ai workspace defaults tests passed');
