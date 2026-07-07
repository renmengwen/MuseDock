const assert = require('assert/strict');

const planner = require('../server/services/creative-video/html-video/sfxPlannerAgent');

const prompt = planner.buildSfxPlanningPrompt({
  target: { duration_sec: 6, aspect_ratio: '9:16' },
  rules: { max_events_per_scene: 2, max_total_events: 4 },
  sfxLibrary: [{ id: 'mixkit-whoosh-fast-transition', tags: ['whoosh'], duration_sec: 1, default_volume_db: -16 }],
  scenes: [{
    scene_id: 'scene_01',
    frame_id: 'scene_01',
    order: 1,
    start_sec: 0,
    duration_sec: 6,
    narration_text: '先问一个问题',
    captions: [],
    visual_text: { headline: '先问一个问题' },
    motion_hints: ['headline fast in'],
    visual_type_hint: 'hook',
  }],
});

assert.match(prompt, /只能返回 JSON/);
assert.match(prompt, /mixkit-whoosh-fast-transition/);
assert.doesNotMatch(prompt, /<html/i);
assert.doesNotMatch(prompt, /https?:\/\//);

const parsed = planner.parseSfxPlanningResponse('```json\n{"sfx_events":[{"scene_id":"scene_01","time_sec":0.2,"sfx_id":"mixkit-whoosh-fast-transition","confidence":0.8}]}\n```');
assert.equal(parsed.success, true);
assert.equal(parsed.events.length, 1);

// 模型在 JSON 前多说一句话时也要能解析（容错剥离 fence）
const prosePrefixed = planner.parseSfxPlanningResponse('好的，以下是编排结果：\n```json\n{"sfx_events":[{"scene_id":"scene_01","time_sec":0.2,"sfx_id":"mixkit-whoosh-fast-transition","confidence":0.8}]}\n```');
assert.equal(prosePrefixed.success, true);
assert.equal(prosePrefixed.events.length, 1);

const bad = planner.parseSfxPlanningResponse('不是 JSON');
assert.equal(bad.success, false);
assert.equal(bad.code, 'sfx_ai_parse_failed');

// 模型调用失败要带诊断码；audit 元数据要传给 callTextModel
(async () => {
  const failed = await planner.planSfxEvents({
    model: { callTextModel: async () => ({ success: false, message: '超时' }) },
  });
  assert.equal(failed.success, false);
  assert.equal(failed.code, 'sfx_ai_failed');

  let auditSeen = null;
  await planner.planSfxEvents({
    model: {
      callTextModel: async request => {
        auditSeen = request.audit;
        return { success: true, text: '{"sfx_events":[]}' };
      },
    },
  });
  assert.equal(auditSeen.agent, 'sfx-planner');
  assert.equal(auditSeen.stage, 'audio');

  console.log('html-video sfx planner tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
