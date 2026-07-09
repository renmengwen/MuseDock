const assert = require('assert');
const { buildVisualPlan } = require('../server/services/creative-video/html-video/visualPlanService');

const sceneSpec = {
  title: 'UI/UE/UX',
  aspect_ratio: '16:9',
  scenes: [
    {
      id: 'scene_01',
      kind: 'text',
      speech_duration_sec: 18,
      narration_text: 'UI 是界面的样子。UE 是使用过程。UX 是整体体验。',
      visual_text: { headline: '三个概念', cards: ['UI', 'UE', 'UX'] },
    },
    {
      id: 'scene_02',
      kind: 'steps',
      speech_duration_sec: 6,
      narration_text: '第一步观察，第二步优化。',
      visual_text: { headline: '两个步骤', cards: ['观察', '优化'] },
    },
  ],
};

const plan = buildVisualPlan({ sceneSpec, workflowId: '20260709000000000000' });

assert.equal(plan.version, 1);
assert.ok(plan.style_profile.id);
assert.equal(plan.beats.filter(beat => beat.scene_id === 'scene_01').length, 3);
assert.equal(plan.beats.filter(beat => beat.scene_id === 'scene_02').length, 1);
assert.ok(plan.beats.every(beat => beat.duration_sec >= 3 && beat.duration_sec <= 8));
assert.deepEqual(plan.beats.map(beat => beat.order), [1, 2, 3, 4]);
assert.equal(plan.beats[0].intent, 'definition');
assert.equal(plan.beats[3].intent, 'steps');

console.log('test-html-video-visual-plan passed');
