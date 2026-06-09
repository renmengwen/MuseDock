const assert = require('assert');
const visualDsl = require('./server/services/hyperframesVisualDsl');

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
      focus: { text: '流程太重', style: 'warning_pulse' },
    },
  };

  const normalized = visualDsl.prepareSceneDsl(scene);
  assert.equal(normalized.visualType, 'workflow');
  assert.equal(normalized.composition, 'vertical_flow');
  assert.equal(normalized.objects.length, 2);
  assert.equal(normalized.motion[0].effect, 'stagger_reveal');
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
