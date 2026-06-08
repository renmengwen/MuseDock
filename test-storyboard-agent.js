const assert = require('assert');
const storyboardAgent = require('./server/services/storyboardAgent');

async function run() {
  const messages = storyboardAgent.buildStoryboardMessages({
    rewriteScript: '测试脚本',
    captions: [{ index: 1, start: 0, end: 2, text: '第一句' }],
    storyboardOptions: {
      visualStyle: '商业质感',
      pacing: '快节奏',
      captionStyle: '大字报',
      backgroundDirection: '数据感抽象背景',
      primaryColor: '#fe2c55',
      forbidden: '不要真人，不要原视频画面',
      extraRequirements: '每个分镜标题要短',
    },
  });
  assert.match(messages[1].content, /AI 分镜视觉 brief/);
  assert.match(messages[1].content, /商业质感/);
  assert.match(messages[1].content, /数据感抽象背景/);
  assert.match(messages[1].content, /不要真人/);
  assert.match(messages[0].content, /不要引用原视频/);

  const calls = [];
  const result = await storyboardAgent.createStoryboard({
    rewriteScript: '第一句。第二句。',
    captions: [
      { index: 1, start: 0, end: 1.25, duration: 1.25, text: '第一句。' },
      { index: 2, start: 1.25, end: 3.75, duration: 2.5, text: '第二句。' },
    ],
    aiTextModel: {
      callTextModel: async options => {
        calls.push(options);
        return {
          success: true,
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          text: JSON.stringify({
            template: 'ai_storyboard_cards',
            style: { visual_tone: '专业' },
            scenes: [
              {
                caption_indexes: [1, 2],
                headline: '核心观点',
                visual_type: 'text_card',
                layout: 'center_focus',
                background_prompt: '原创抽象背景',
                emphasis_words: ['观点'],
                start: 999,
              },
            ],
          }),
        };
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.storyboard.status, 'done');
  assert.equal(result.storyboard.scenes[0].start, 0);
  assert.equal(result.storyboard.scenes[0].end, 3.75);
  assert.equal(result.raw.scenes.length, 1);
  assert.match(calls[0].messages[0].content, /不要输出 start/);
  assert.match(calls[0].messages[0].content, /不要引用原视频/);
  assert.match(calls[0].messages[1].content, /优先每 1 条字幕生成 1 个分镜/);

  const malformed = await storyboardAgent.createStoryboard({
    rewriteScript: '第一句。第二句。',
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: '第一句。' },
      { index: 2, start: 1, end: 2, duration: 1, text: '第二句。' },
    ],
    aiTextModel: {
      callTextModel: async () => ({ success: true, text: 'not json' }),
    },
  });
  assert.equal(malformed.success, true);
  assert.equal(malformed.storyboard.scenes.length, 2);
  assert.equal(malformed.raw_parse_failed, true);
}

run().then(() => {
  console.log('storyboard agent tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
