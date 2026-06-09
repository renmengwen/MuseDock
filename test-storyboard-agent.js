const assert = require('assert');
const storyboardAgent = require('./server/services/storyboardAgent');

async function run() {
  const messages = storyboardAgent.buildStoryboardMessages({
    rewriteScript: 'test script',
    captions: [{ index: 1, start: 0, end: 2, duration: 2, text: 'first line' }],
    storyboardOptions: {
      visualStyle: 'business style',
      pacing: 'fast',
      captionStyle: 'large captions',
      backgroundDirection: 'abstract data background',
      primaryColor: '#fe2c55',
      forbidden: 'no real people, no original video frames',
      extraRequirements: 'short headlines',
    },
  });

  assert.match(messages[1].content, /AI_STORYBOARD_MAX_SCENES=12/);
  assert.match(messages[1].content, /AI_STORYBOARD_BACKEND_FILL=true/);
  assert.match(messages[1].content, /Frame Profile：tech_neon/);
  assert.match(messages[1].content, /完整 Frame\.md 参考/);
  assert.match(messages[1].content, /不要让连续场景全部使用同一种居中卡片结构/);
  assert.match(messages[1].content, /text_card.*核心观点/);
  assert.match(messages[1].content, /contrast_card.*对比/);
  assert.match(messages[1].content, /不要输出像网页按钮或后台卡片一样的 UI/);
  assert.match(messages[1].content, /所有 timeline 必须是 paused GSAP timeline/);
  assert.match(messages[1].content, /showCaptionBar=false/);
  assert.match(messages[1].content, /Frame\.md 只能作为视觉设计参考/);
  assert.match(messages[1].content, /business style/);
  assert.match(messages[1].content, /abstract data background/);
  assert.match(messages[1].content, /no real people/);
  assert.match(messages[1].content, /"index": 1/);
  assert.match(messages[1].content, /"text": "first line"/);
  assert.doesNotMatch(messages[1].content, /"start"/);
  assert.doesNotMatch(messages[1].content, /"end"/);
  assert.doesNotMatch(messages[1].content, /"duration"/);
  assert.match(messages[0].content, /start/);

  const calls = [];
  const result = await storyboardAgent.createStoryboard({
    rewriteScript: 'first line. second line.',
    captions: [
      { index: 1, start: 0, end: 1.25, duration: 1.25, text: 'first line.' },
      { index: 2, start: 1.25, end: 3.75, duration: 2.5, text: 'second line.' },
    ],
    aiTextModel: {
      callTextModel: async options => {
        calls.push(options);
        assert.equal(options.stream, true);
        return {
          success: true,
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          text: JSON.stringify({
            template: 'ai_storyboard_cards',
            style: { visual_tone: 'professional' },
            scenes: [
              {
                caption_indexes: [1, 2],
                headline: 'Core idea',
                visual_type: 'text_card',
                layout: 'center_focus',
                background_prompt: 'original abstract background',
                emphasis_words: ['idea'],
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
  assert.match(calls[0].messages[0].content, /start/);
  assert.match(calls[0].messages[1].content, /AI_STORYBOARD_MAX_SCENES=12/);
  assert.match(calls[0].messages[1].content, /AI_STORYBOARD_BACKEND_FILL=true/);
  assert.match(calls[0].messages[1].content, /Frame Profile：tech_neon/);

  const malformed = await storyboardAgent.createStoryboard({
    rewriteScript: 'first line. second line.',
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: 'first line.' },
      { index: 2, start: 1, end: 2, duration: 1, text: 'second line.' },
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
