const assert = require('assert');
const path = require('path');
const { matchVisualBeatsToRenderers } = require('../server/services/creative-video/html-video/visualRouteMatcher');

const TEMPLATE_DIR = path.resolve(__dirname, '../server/templates/frame-glitch-title');

function template(id, maxSec = 8) {
  return {
    id,
    engine: 'hyperframes',
    source_entry: 'source/index.html',
    __dir: TEMPLATE_DIR,
    output: {
      resolution: { supported_aspects: ['16:9'] },
      duration: { min_sec: 3, max_sec: maxSec },
    },
    license: { spdx: 'Apache-2.0', commercial_use: true },
    inputs: {
      schema: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', maxLength: 80 },
          subtitle: { type: 'string', maxLength: 120 },
          duration_sec: { type: 'number', minimum: 3, maximum: maxSec },
        },
      },
    },
  };
}

const registry = {
  getTemplate: id => ({
    'frame-glitch-title': template('frame-glitch-title', 8),
  }[id] || null),
};

const plan = {
  beats: [
    {
      id: 'scene_01_b1',
      scene_id: 'scene_01',
      kind: 'text',
      duration_sec: 6,
      source_scene: { speech_duration_sec: 12, duration: 12 },
      visual_text: { headline: '概念开场' },
      narration_text: '先定义概念。',
    },
    {
      id: 'scene_02_b1',
      scene_id: 'scene_02',
      kind: 'text',
      duration_sec: 12,
      source_scene: { speech_duration_sec: 12, duration: 12 },
      visual_text: { headline: '过长段落' },
      narration_text: '这一段仍然太长。',
    },
  ],
};

const decisions = matchVisualBeatsToRenderers({
  visualPlan: plan,
  registry,
  renderTarget: { aspect_ratio: '16:9' },
});

assert.equal(decisions.get('scene_01_b1').source_mode, 'template_inputs');
assert.equal(decisions.get('scene_01_b1').duration_strategy, 'fit');
assert.ok(decisions.get('scene_01_b1').inputs.duration_sec <= 8, 'beat 时长应压过场景时长别名');
assert.equal(decisions.get('scene_02_b1').source_mode, 'raw_html');
assert.match(decisions.get('scene_02_b1').fallback_reason, /模板不支持目标时长/);

console.log('test-html-video-visual-route-matcher passed');
