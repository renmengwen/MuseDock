const assert = require('assert');

const agent = require('../server/services/hyperframes/hyperframesFreeformAgent');

async function run() {
  const briefMessages = agent.buildFreeformBriefMessages({
    run: { result: { rewrite_script: '测试口播' } },
    skillContext: 'Use HyperFrames.',
    options: {
      creative_context: {
        input: { raw_text: '严格 8 个 Scene，S02 旁白必须包含“文本输入框”。' },
      },
    },
  });
  assert.match(briefMessages[1].content, /严格 8 个 Scene，S02 旁白必须包含“文本输入框”/);
  assert.match(briefMessages[1].content, /用户原始要求.*优先于运行摘要/);
  assert.match(briefMessages[1].content, /audio_direction/);
  assert.match(briefMessages[1].content, /voice/);
  assert.match(briefMessages[1].content, /style_prompt/);
  assert.match(briefMessages[1].content, /narration 不要输出完整口播/);
  assert.match(briefMessages[1].content, /storyboard\.scenes\[\]\.narration_text 承载实际配音文本/);
  assert.match(briefMessages[1].content, /紧张|深呼吸|语速|停顿|长叹/);
  assert.doesNotMatch(briefMessages[1].content, /narration_text 可以.*括号标签/);
  assert.match(briefMessages[1].content, /narration_text 和 captions\.text 只能包含观众可见、可朗读的正文/);
  assert.match(briefMessages[1].content, /visual_text 承载画面文字素材/);
  assert.match(briefMessages[1].content, /keywords\/cards 禁止照抄 narration_text 原句/);
  assert.match(briefMessages[1].content, /"keywords"/);
  assert.match(briefMessages[1].content, /"cards"/);

  const requiredRaw = [
    '普通说明“这不是旁白合同”。',
    'S01 使用首页。旁白必须包含“这里是 MuseDock 仓库首页。”；继续。',
    'S02 使用截图。旁白必须完整包含“镜头聚焦文本输入框。”；继续。',
    'S03 旁白必须包含“任务信息卡片展示当前进度。”。',
    'S04 旁白必须包含“主视频画布承载编辑预览。”。',
    'S05 旁白必须包含“顶部橙色过山车轨道保持完整可见。”。',
    'S06 旁白必须包含“站在界面前的人物保持完整。”。',
  ].join(' ');
  const required = agent.extractRequiredNarrationLiterals(requiredRaw);
  assert.equal(required.length, 6);
  assert.deepEqual(required[0], { scene_id: 'S01', literal: '这里是 MuseDock 仓库首页。' });
  assert.equal(required.some(item => item.literal === '这不是旁白合同'), false);
  assert.equal(agent.extractRequiredNarrationLiterals('S01 标题是“普通引号”，旁白自由发挥。').length, 0);
  assert.equal(agent.validateRequiredNarrationLiterals([
    { id: 'scene_01', narration_text: `开场，${required[0].literal}继续介绍。` },
  ], [required[0]]).ok, true);

  const parsed = agent.parseFreeformBriefResponse(JSON.stringify({ title: '测试短片' }));
  assert.equal(parsed.success, true);
  assert.equal(parsed.brief.title, '测试短片');

  const failed = agent.parseFreeformBriefResponse('not json');
  assert.equal(failed.success, false);
  assert.match(failed.message, /解析/);

  const longMessages = agent.buildFreeformBriefMessages({
    run: { huge: 'a'.repeat(30000) },
  });
  const truncatedBlocks = longMessages[1].content.match(/\{\n  "truncated": true,[\s\S]*?\n\}/g) || [];
  assert.ok(truncatedBlocks.length >= 1);
  const value = JSON.parse(truncatedBlocks[0]);
  assert.equal(value.truncated, true);
  assert.equal(typeof value.preview, 'string');
  assert.ok(value.preview.length < 12000);
}

run().then(() => {
  console.log('hyperframes freeform agent tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
