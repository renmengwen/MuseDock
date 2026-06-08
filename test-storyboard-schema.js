const assert = require('assert');
const schema = require('./server/services/storyboardSchema');

function run() {
  const captions = [
    { index: 1, start: 0, end: 1.25, duration: 1.25, text: '第一句。' },
    { index: 2, start: 1.25, end: 3.75, duration: 2.5, text: '第二句。' },
    { index: 3, start: 3.75, end: 5, duration: 1.25, text: '第三句。' },
  ];

  const normalized = schema.normalizeStoryboard({
    storyboard: {
      template: 'ai_storyboard_cards',
      style: {
        visual_tone: '专业',
        palette: ['#101216', '#fe2c55'],
        motion: '轻微推进',
      },
      scenes: [
        {
          index: 1,
          caption_indexes: [1, 2],
          headline: '抓住冲突',
          visual_type: 'text_card',
          layout: 'center_focus',
          background_prompt: '原创抽象背景',
          emphasis_words: ['冲突'],
          start: 999,
          end: 1000,
        },
        {
          index: 2,
          caption_indexes: [99],
          headline: '非法引用',
        },
      ],
    },
    captions,
  });

  assert.equal(normalized.status, 'done');
  assert.equal(normalized.template, 'ai_storyboard_cards');
  assert.equal(normalized.scenes.length, 2);
  assert.deepStrictEqual(normalized.scenes[0].caption_indexes, [1, 2]);
  assert.equal(normalized.scenes[0].start, 0);
  assert.equal(normalized.scenes[0].end, 3.75);
  assert.equal(normalized.scenes[0].duration, 3.75);
  assert.equal(normalized.scenes[0].captions.length, 2);
  assert.deepStrictEqual(normalized.scenes[1].caption_indexes, [3]);
  assert.equal(normalized.scenes[1].start, 3.75);
  assert.equal(normalized.scenes[1].end, 5);

  const fallback = schema.normalizeStoryboard({
    storyboard: { scenes: [] },
    captions,
  });
  assert.equal(fallback.status, 'done');
  assert.equal(fallback.scenes.length, 3);
  assert.deepStrictEqual(fallback.scenes[0].caption_indexes, [1]);
  assert.deepStrictEqual(fallback.scenes[1].caption_indexes, [2]);
  assert.deepStrictEqual(fallback.scenes[2].caption_indexes, [3]);
}

try {
  run();
  console.log('storyboard schema tests passed');
} catch (error) {
  console.error(error);
  process.exit(1);
}
