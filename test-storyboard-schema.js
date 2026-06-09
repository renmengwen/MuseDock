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

  const visualDsl = schema.normalizeStoryboard({
    storyboard: {
      template: 'ai_storyboard_cards',
      scenes: [
        {
          caption_indexes: [1],
          headline: '传统开发链路',
          visual_type: 'workflow',
          layout: 'vertical_flow',
          background_prompt: '原创流程背景',
          emphasis_words: ['产品需求'],
          visual_scene: {
            composition: 'vertical_flow',
            objects: [
              { id: 'node-1', type: 'node', text: '产品需求', role: 'primary' },
              { id: 'node-2', type: 'node', text: '设计界面', role: 'primary' },
              { id: 'bad', type: 'unknown', text: '应该被丢弃' },
            ],
            motion: [
              { target: 'node', effect: 'stagger_reveal', delay: 0.1 },
              { target: 'bad', effect: 'explode', delay: 999 },
            ],
            focus: { text: '流程太重', style: 'warning_pulse' },
          },
        },
      ],
    },
    captions,
  });
  assert.equal(visualDsl.scenes[0].visual_type, 'workflow');
  assert.equal(visualDsl.scenes[0].visual_scene.composition, 'vertical_flow');
  assert.equal(visualDsl.scenes[0].visual_scene.objects.length, 2);
  assert.equal(visualDsl.scenes[0].visual_scene.objects[0].type, 'node');
  assert.equal(visualDsl.scenes[0].visual_scene.motion.length, 1);
  assert.equal(visualDsl.scenes[0].visual_scene.motion[0].effect, 'stagger_reveal');
  assert.equal(visualDsl.scenes[0].visual_scene.focus.text, '流程太重');

  const fallbackVisual = schema.normalizeStoryboard({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: '未知类型',
          visual_type: 'imaginary_camera_scene',
          layout: 'center_focus',
          background_prompt: '原创背景',
          emphasis_words: ['重点一', '重点二'],
        },
      ],
    },
    captions,
  });
  assert.equal(fallbackVisual.scenes[0].visual_type, 'quote_burst');
  assert.equal(fallbackVisual.scenes[0].visual_scene.composition, 'burst_center');
  assert.ok(fallbackVisual.scenes[0].visual_scene.objects.length >= 2);

  const fallback = schema.normalizeStoryboard({
    storyboard: { scenes: [] },
    captions: [
      ...captions,
      {
        index: 4,
        start: 5,
        end: 17,
        duration: 12,
        text: '你可以不懂代码开始，但如果你想真正上线、处理用户数据、保证安全和稳定，还是需要理解一些基础概念，比如数据库、部署、权限、接口、测试。',
      },
    ],
  });
  assert.equal(fallback.status, 'done');
  assert.equal(fallback.scenes.length, 4);
  assert.deepStrictEqual(fallback.scenes[0].caption_indexes, [1]);
  assert.deepStrictEqual(fallback.scenes[1].caption_indexes, [2]);
  assert.deepStrictEqual(fallback.scenes[2].caption_indexes, [3]);
  assert.deepStrictEqual(fallback.scenes[3].caption_indexes, [4]);
  assert.notEqual(fallback.scenes[3].headline, fallback.scenes[3].captions[0].text);
  assert.ok(fallback.scenes[3].headline.length <= 18);
  assert.ok(fallback.scenes[3].emphasis_words.length >= 3);
  assert.ok(fallback.scenes[3].emphasis_words.includes('数据库'));
  assert.ok(fallback.scenes[3].emphasis_words.includes('部署'));
  assert.ok(fallback.scenes[3].emphasis_words.includes('权限'));

  const listFallback = schema.normalizeStoryboard({
    storyboard: { scenes: [] },
    captions: [
      {
        index: 1,
        start: 0,
        end: 6,
        duration: 6,
        text: '以前写代码，你要先懂语法、懂框架、懂前端后端、懂报错、懂部署。',
      },
    ],
  });
  assert.deepStrictEqual(listFallback.scenes[0].emphasis_words.slice(0, 5), ['语法', '框架', '前端后端', '报错', '部署']);
  assert.ok(!listFallback.scenes[0].emphasis_words.includes('以前写代码'));
  assert.ok(!listFallback.scenes[0].emphasis_words.includes('你要先懂语法'));
  assert.ok(!listFallback.scenes[0].emphasis_words.includes('懂框架'));

  const validation = schema.validateStoryboardEditableInput({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: '第一屏',
          visual_type: 'text_card',
          layout: 'center_focus',
          background_prompt: '原创背景',
          emphasis_words: ['重点'],
        },
        {
          caption_indexes: [1],
          headline: '重复',
          visual_type: 'text_card',
          layout: 'center_focus',
          background_prompt: '原创背景',
          emphasis_words: [],
        },
      ],
    },
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: '字幕一' },
    ],
  });
  assert.equal(validation.success, false);
  assert.ok(validation.errors.some(item => item.includes('重复')));

  const valid = schema.validateStoryboardEditableInput({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: '第一屏',
          visual_type: 'text_card',
          layout: 'center_focus',
          background_prompt: '原创背景',
          emphasis_words: ['重点'],
        },
      ],
    },
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: '字幕一' },
    ],
  });
  assert.equal(valid.success, true);

  const visualValidation = schema.validateStoryboardEditableInput({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: '视觉 DSL',
          visual_type: 'workflow',
          layout: 'vertical_flow',
          background_prompt: '原创背景',
          emphasis_words: ['重点'],
          visual_scene: {
            composition: 'vertical_flow',
            objects: [{ type: 'node', text: '节点' }],
            motion: [{ target: 'node', effect: 'stagger_reveal' }],
          },
        },
      ],
    },
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: '字幕一' },
    ],
  });
  assert.equal(visualValidation.success, true);
}

try {
  run();
  console.log('storyboard schema tests passed');
} catch (error) {
  console.error(error);
  process.exit(1);
}
