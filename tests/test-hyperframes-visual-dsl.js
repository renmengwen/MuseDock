const assert = require('assert');
const visualDsl = require('../server/services/hyperframesVisualDsl');
const animations = require('../server/services/hyperframesAnimations');

function run() {
  const scene = {
    index: 1,
    headline: '传统开发链路',
    visual_type: 'workflow',
    emphasis_words: ['产品需求', '设计界面'],
    visual_scene: {
      composition: 'vertical_flow',
      objects: [
        { id: 'node-1', type: 'node', text: '产品需求' },
        { id: 'node-2', type: 'node', text: '设计界面' },
      ],
      motion: [{ target: 'node', effect: 'stagger_reveal', delay: 0.1 }],
      beats: [
        { at: 0.2, duration: 0.4, target: 'node-1', effect: 'slide_up_reveal', emphasis: 'primary', caption_block_id: 'cap-1-p1' },
      ],
      caption_sync: [{ caption_index: 1, caption_block_id: 'cap-1-p1', target: 'node-1', effect: 'highlight' }],
      focus: { text: '流程太重', style: 'warning_pulse' },
    },
  };

  const normalized = visualDsl.prepareSceneDsl(scene);
  assert.equal(normalized.visualType, 'workflow');
  assert.equal(normalized.composition, 'vertical_flow');
  assert.equal(normalized.objects.length, 2);
  assert.equal(normalized.motion[0].effect, 'stagger_reveal');
  assert.equal(normalized.beats[0].effect, 'slide_up_reveal');
  assert.equal(normalized.beats[0].caption_block_id, 'cap-1-p1');
  assert.equal(normalized.caption_sync[0].target, 'node-1');
  assert.equal(normalized.caption_sync[0].caption_block_id, 'cap-1-p1');

  const syncedAnimation = animations.buildSceneAnimation({
    start: 4.8,
    duration: 4.48,
    phrase_captions: [
      { id: 'cap-2-p1', start: 4.8, end: 6.293 },
      { id: 'cap-2-p2', start: 6.293, end: 7.787 },
      { id: 'cap-2-p3', start: 7.787, end: 9.28 },
    ],
    prepared_visual_scene: {
      beats: [
        { at: 0, duration: 0.32, target: 'syntax-card', effect: 'slide_up_reveal', caption_block_id: 'cap-2-p1' },
        { at: 0, duration: 0.32, target: 'env-card', effect: 'slide_up_reveal', caption_block_id: 'cap-2-p2' },
        { at: 0, duration: 0.32, target: 'tutorial-card', effect: 'slide_up_reveal', caption_block_id: 'cap-2-p3' },
      ],
    },
  }, 1, 1, { captionMode: 'phrase_kinetic' });

  assert.match(syncedAnimation, /\[data-visual-object='syntax-card'\][\s\S]*4\.800/);
  assert.match(syncedAnimation, /\[data-visual-object='env-card'\][\s\S]*6\.293/);
  assert.match(syncedAnimation, /\[data-visual-object='tutorial-card'\][\s\S]*7\.787/);
  assert.doesNotMatch(syncedAnimation, /tl\.set\("#scene-2 \[data-visual-object\]"/);
  assert.match(syncedAnimation, /tl\.set\("#scene-2 \[data-visual-object='syntax-card'\]"/);
  assert.equal(normalized.focus.text, '流程太重');

  const fallback = visualDsl.prepareSceneDsl({
    index: 2,
    headline: '一句话定义',
    visual_type: 'missing_type',
    emphasis_words: ['自然语言', '指挥 AI'],
  });
  assert.equal(fallback.visualType, 'quote_burst');
  assert.equal(fallback.objects[0].type, 'keyword');
  assert.equal(fallback.objects[0].text, '自然语言');
  assert.doesNotThrow(() => visualDsl.prepareSceneDsl(null));
  assert.doesNotThrow(() => visualDsl.prepareSceneDsl('bad'));
  assert.deepStrictEqual(visualDsl.prepareScenes(null), []);
  assert.deepStrictEqual(visualDsl.prepareScenes({}), []);
  assert.equal(visualDsl.prepareScenes([null]).length, 1);
  const original = { headline: '原始', visual_type: 'quote_burst', emphasis_words: ['一'] };
  const snapshot = JSON.parse(JSON.stringify(original));
  const prepared = visualDsl.prepareScenes([original]);
  assert.deepStrictEqual(original, snapshot);
  assert.ok(prepared[0].prepared_visual_scene);
}

try {
  run();
  console.log('hyperframes visual dsl tests passed');
} catch (error) {
  console.error(error);
  process.exit(1);
}
