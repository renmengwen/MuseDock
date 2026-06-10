const assert = require('assert');
const schema = require('../server/services/storyboardSchema');

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
              { id: 'node-1', type: 'node', text: '产品需求', role: 'primary', stage: 'intro', accent: 'hot' },
              { id: 'node-2', type: 'node', text: '设计界面', role: 'primary' },
              { id: 'bad', type: 'unknown', text: '应该被丢弃' },
            ],
            motion: [
              { target: 'node', effect: 'stagger_reveal', delay: 0.1 },
              { target: 'bad', effect: 'explode', delay: 999 },
            ],
            beats: [
              { at: 0.15, duration: 0.45, target: 'node-1', effect: 'slide_up_reveal', emphasis: 'primary', caption_block_id: 'cap-1-p1' },
              { at: 1.1, duration: 0.3, target: 'node-2', effect: 'glow_focus', emphasis: 'supporting' },
              { at: 9, duration: 5, target: 'bad', effect: 'explode' },
            ],
            caption_sync: [{ caption_index: 1, caption_block_id: 'cap-1-p1', target: 'node-1', effect: 'highlight' }],
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
  assert.equal(visualDsl.scenes[0].visual_scene.objects[0].stage, 'intro');
  assert.equal(visualDsl.scenes[0].visual_scene.objects[0].accent, 'hot');
  assert.equal(visualDsl.scenes[0].visual_scene.motion.length, 1);
  assert.equal(visualDsl.scenes[0].visual_scene.motion[0].effect, 'stagger_reveal');
  assert.equal(visualDsl.scenes[0].visual_scene.beats.length, 2);
  assert.equal(visualDsl.scenes[0].visual_scene.beats[0].effect, 'slide_up_reveal');
  assert.equal(visualDsl.scenes[0].visual_scene.beats[0].caption_block_id, 'cap-1-p1');
  assert.equal(visualDsl.scenes[0].visual_scene.beats[1].duration, 0.3);
  assert.equal(visualDsl.scenes[0].visual_scene.caption_sync[0].caption_index, 1);
  assert.equal(visualDsl.scenes[0].visual_scene.caption_sync[0].caption_block_id, 'cap-1-p1');
  assert.equal(visualDsl.scenes[0].visual_scene.focus.text, '流程太重');

  const semanticObjects = schema.normalizeStoryboard({
    storyboard: {
      scenes: [{
        caption_indexes: [1],
        headline: '概念路径',
        visual_type: 'concept_map',
        layout: 'map',
        background_prompt: '原创背景',
        emphasis_words: ['核心'],
        visual_scene: {
          composition: 'radial_map',
          objects: [
            { id: 'center-1', type: 'center', text: '核心概念' },
            { id: 'step-1', type: 'step', text: '第一步' },
          ],
          motion: [{ target: 'center', effect: 'pulse', delay: 0.1 }],
        },
      }],
    },
    captions,
  });
  assert.deepStrictEqual(semanticObjects.scenes[0].visual_scene.objects.map(item => item.type), ['center', 'step']);
  assert.equal(schema.normalizeVisualObject({ id: 'x1', type: 'card', text: '卡片' }).type, 'panel');
  assert.equal(schema.normalizeVisualObject({ id: 'x2', type: 'chip', text: '标签' }).type, 'badge');
  assert.equal(schema.normalizeVisualObject({ id: 'x3', type: 'line_arrow', text: '连接' }).type, 'connector');

  const objectsKeptWhenMotionFallback = schema.normalizeStoryboard({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: 'keep objects',
          visual_type: 'workflow',
          layout: 'vertical_flow',
          background_prompt: 'abstract background',
          emphasis_words: ['fallback word'],
          visual_scene: {
            composition: 'vertical_flow',
            objects: [{ id: 'node-keep', type: 'node', text: 'Keep Node' }],
            motion: [{ target: 'node-keep', effect: 'unknown_effect', delay: 0.1 }],
          },
        },
      ],
    },
    captions,
  });
  assert.equal(objectsKeptWhenMotionFallback.scenes[0].visual_scene.objects.length, 1);
  assert.equal(objectsKeptWhenMotionFallback.scenes[0].visual_scene.objects[0].id, 'node-keep');
  assert.equal(objectsKeptWhenMotionFallback.scenes[0].visual_scene.motion.length, 2);
  assert.equal(objectsKeptWhenMotionFallback.scenes[0].visual_scene.motion[0].effect, 'stagger_reveal');

  const objectsKeptWhenMotionEmpty = schema.normalizeStoryboard({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: 'empty motion',
          visual_type: 'workflow',
          layout: 'vertical_flow',
          background_prompt: 'abstract background',
          emphasis_words: ['fallback word'],
          visual_scene: {
            composition: 'vertical_flow',
            objects: [{ id: 'node-empty-motion', type: 'node', text: 'Still Keep' }],
            motion: [],
          },
        },
      ],
    },
    captions,
  });
  assert.equal(objectsKeptWhenMotionEmpty.scenes[0].visual_scene.objects.length, 1);
  assert.equal(objectsKeptWhenMotionEmpty.scenes[0].visual_scene.objects[0].id, 'node-empty-motion');
  assert.equal(objectsKeptWhenMotionEmpty.scenes[0].visual_scene.motion[0].effect, 'stagger_reveal');

  const motionKeptWhenObjectsFallback = schema.normalizeStoryboard({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: 'keep motion',
          visual_type: 'workflow',
          layout: 'vertical_flow',
          background_prompt: 'abstract background',
          emphasis_words: ['fallback word'],
          visual_scene: {
            composition: 'vertical_flow',
            objects: [{ id: 'bad-object', type: 'unknown', text: 'Drop Object' }],
            motion: [{ target: 'focus', effect: 'pulse', delay: 0.4 }],
          },
        },
      ],
    },
    captions,
  });
  assert.equal(motionKeptWhenObjectsFallback.scenes[0].visual_scene.objects[0].type, 'keyword');
  assert.equal(motionKeptWhenObjectsFallback.scenes[0].visual_scene.motion.length, 1);
  assert.equal(motionKeptWhenObjectsFallback.scenes[0].visual_scene.motion[0].effect, 'pulse');
  assert.equal(motionKeptWhenObjectsFallback.scenes[0].visual_scene.motion[0].delay, 0.4);

  const motionKeptWhenObjectsEmpty = schema.normalizeStoryboard({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: 'empty objects',
          visual_type: 'workflow',
          layout: 'vertical_flow',
          background_prompt: 'abstract background',
          emphasis_words: ['fallback word'],
          visual_scene: {
            composition: 'vertical_flow',
            objects: [],
            motion: [{ target: 'focus', effect: 'pulse', delay: 0.4 }],
          },
        },
      ],
    },
    captions,
  });
  assert.equal(motionKeptWhenObjectsEmpty.scenes[0].visual_scene.objects[0].type, 'keyword');
  assert.equal(motionKeptWhenObjectsEmpty.scenes[0].visual_scene.motion.length, 1);
  assert.equal(motionKeptWhenObjectsEmpty.scenes[0].visual_scene.motion[0].effect, 'pulse');

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
            beats: [{ at: 0.2, duration: 0.4, target: 'node', effect: 'slide_up_reveal' }],
          },
        },
      ],
    },
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: '字幕一' },
    ],
  });
  assert.equal(visualValidation.success, true);

  const aliasedVisualValidation = schema.validateStoryboardEditableInput({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: '别名对象',
          visual_type: 'workflow',
          layout: 'vertical_flow',
          background_prompt: '原创背景',
          visual_scene: {
            composition: 'process_flow',
            objects: [
              { id: 'keyword-card-1', type: 'keyword_card', text: '关键词' },
              { id: 'connector-line-1', type: 'connector_line', from: 'keyword-card-1', to: 'typed-prompt-1' },
              { id: 'typed-prompt-1', type: 'typed_prompt', text: '输入提示' },
            ],
            motion: [],
            beats: [{ target: 'keyword-card-1', effect: 'highlight', caption_block_id: 'cap-1-p1' }],
          },
        },
      ],
    },
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: '字幕一' },
    ],
  });
  assert.equal(aliasedVisualValidation.success, true);

  const normalizedWithObjectBeatFallback = schema.normalizeStoryboard({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: '补齐对象',
          visual_type: 'workflow',
          layout: 'vertical_flow',
          background_prompt: '原创背景',
          visual_scene: {
            composition: 'process_flow',
            objects: [
              { id: 'step-1', type: 'step', text: '第一步' },
              { id: 'step-2', type: 'step', text: '第二步' },
              { id: 'step-3', type: 'step', text: '第三步' },
            ],
            motion: [{ target: 'step-1', effect: 'stagger_reveal' }],
            beats: [{ target: 'step-1', effect: 'slide_up_reveal', caption_block_id: 'cap-1-p1' }],
          },
        },
      ],
    },
    captions: [
      { index: 1, start: 0, end: 3, duration: 3, text: '第一步，第二步，第三步。' },
    ],
    phraseCaptions: [
      { id: 'cap-1-p1', caption_index: 1, start: 0, end: 1, text: '第一步' },
      { id: 'cap-1-p2', caption_index: 1, start: 1, end: 2, text: '第二步' },
      { id: 'cap-1-p3', caption_index: 1, start: 2, end: 3, text: '第三步' },
    ],
  });
  const fallbackBeats = normalizedWithObjectBeatFallback.scenes[0].visual_scene.beats;
  assert.ok(fallbackBeats.some(beat => beat.target === 'step-2' && beat.caption_block_id === 'cap-1-p2'));
  assert.ok(fallbackBeats.some(beat => beat.target === 'step-3' && beat.caption_block_id === 'cap-1-p3'));
  assert.equal(new Set(fallbackBeats.map(beat => beat.target)).has('step-1'), true);

  const invalidVisualType = schema.validateStoryboardEditableInput({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: '非法类型',
          visual_type: 'camera_flythrough',
          layout: 'center_focus',
          background_prompt: '原创背景',
        },
      ],
    },
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: '字幕一' },
    ],
  });
  assert.equal(invalidVisualType.success, false);
  assert.ok(invalidVisualType.errors.some(item => item.includes('画面类型不受支持')));

  const missingVisualScene = schema.validateStoryboardEditableInput({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: '缺少 DSL',
          visual_type: 'workflow',
          layout: 'vertical_flow',
          background_prompt: '原创背景',
        },
      ],
    },
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: '字幕一' },
    ],
  });
  assert.equal(missingVisualScene.success, false);

  const unknownObjectType = schema.validateStoryboardEditableInput({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: '未知对象',
          visual_type: 'workflow',
          layout: 'vertical_flow',
          background_prompt: '原创背景',
          visual_scene: {
            composition: 'vertical_flow',
            objects: [{ type: 'unknown_object', text: '未知' }],
            motion: [{ target: 'node', effect: 'stagger_reveal' }],
          },
        },
      ],
    },
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: '字幕一' },
    ],
  });
  assert.equal(unknownObjectType.success, false);
  assert.ok(unknownObjectType.errors.some(item => item.includes('visual_scene.objects 包含不受支持的对象类型')));

  const unknownMotionEffect = schema.validateStoryboardEditableInput({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: '未知动效',
          visual_type: 'workflow',
          layout: 'vertical_flow',
          background_prompt: '原创背景',
          visual_scene: {
            composition: 'vertical_flow',
            objects: [{ type: 'node', text: '节点' }],
            motion: [{ target: 'node', effect: 'explode' }],
          },
        },
      ],
    },
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: '字幕一' },
    ],
  });
  assert.equal(unknownMotionEffect.success, false);
  assert.ok(unknownMotionEffect.errors.some(item => item.includes('visual_scene.motion 包含不受支持的动效')));

  const unknownBeatEffect = schema.validateStoryboardEditableInput({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: '未知编排',
          visual_type: 'workflow',
          layout: 'vertical_flow',
          background_prompt: '原创背景',
          visual_scene: {
            composition: 'process_flow',
            objects: [{ type: 'node', text: '节点' }],
            motion: [{ target: 'node', effect: 'stagger_reveal' }],
            beats: [{ target: 'node', effect: 'explode' }],
          },
        },
      ],
    },
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: '字幕一' },
    ],
  });
  assert.equal(unknownBeatEffect.success, false);
  assert.ok(unknownBeatEffect.errors.some(item => item.includes('visual_scene.beats 包含不受支持的编排动效')));

  const legacyTextCardWithoutVisualScene = schema.validateStoryboardEditableInput({
    storyboard: {
      scenes: [
        {
          caption_indexes: [1],
          headline: '旧卡片',
          visual_type: 'text_card',
          layout: 'center_focus',
          background_prompt: '原创背景',
        },
      ],
    },
    captions: [
      { index: 1, start: 0, end: 1, duration: 1, text: '字幕一' },
    ],
  });
  assert.equal(legacyTextCardWithoutVisualScene.success, true);
}

try {
  run();
  console.log('storyboard schema tests passed');
} catch (error) {
  console.error(error);
  process.exit(1);
}
