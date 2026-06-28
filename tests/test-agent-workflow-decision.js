const assert = require('assert');
const decision = require('../server/services/agent/agentWorkflowDecision');

function run() {
  assert.deepEqual(decision.decideNextAction({}).next_action, 'generate_storyboard_plan');

  assert.equal(decision.decideNextAction({
    storyboard_plan: { status: 'planned', scenes: [{ index: 1, narration_text: '测试' }] },
  }).next_action, 'synthesize_scene_tts');

  const overBudgetPlan = decision.decideNextAction({
    storyboard_plan: {
      status: 'planned',
      scenes: [{ index: 1, narration_text: '这是一段太长的口播' }],
      narration_budget: { status: 'too_long', over_budget_sec: 4.2 },
    },
  });
  assert.equal(overBudgetPlan.next_action, 'compress_scene_narration');
  assert.equal(overBudgetPlan.stage, 'needs_script_repair');
  assert.match(overBudgetPlan.message, /压缩|口播/);

  assert.equal(decision.decideNextAction({
    storyboard_plan: { status: 'planned', scenes: [{ index: 1, narration_text: '测试' }] },
    scene_tts: {
      status: 'done',
      timed_storyboard_plan: { status: 'timed', captions: [{ index: 1 }] },
    },
  }).next_action, 'generate_visual_storyboard');

  assert.equal(decision.decideNextAction({
    storyboard_plan: { status: 'planned', scenes: [{ index: 1 }] },
    scene_tts: {
      status: 'done',
      timed_storyboard_plan: { status: 'timed', captions: [{ index: 1 }] },
    },
    storyboard: { scenes: [{ index: 1 }] },
    storyboard_schema_validation: { success: false, errors: ['分镜 1 visual_scene.objects 包含不受支持的对象类型。'] },
  }).next_action, 'repair_visual_storyboard');

  assert.equal(decision.decideNextAction({
    storyboard_plan: { status: 'planned', scenes: [{ index: 1 }] },
    scene_tts: {
      status: 'done',
      timed_storyboard_plan: { status: 'timed', captions: [{ index: 1 }] },
    },
    storyboard: { scenes: [{ index: 1 }] },
    storyboard_schema_validation: { success: true, errors: [] },
  }).next_action, 'generate_video_project');

  const duration = decision.decideNextAction({
    video: {
      status: 'failed',
      video_quality_report: {
        pass: false,
        issues: [{ code: 'duration_too_long', severity: 'error', message: '太长' }],
      },
    },
  });
  assert.equal(duration.next_action, 'compress_scene_narration');
  assert.match(duration.message, /压缩/);
  assert.notEqual(duration.next_action, 'generate_visual_storyboard');

  assert.equal(decision.decideNextAction({
    video: {
      status: 'failed',
      video_quality_report: { issues: [{ code: 'unbound_visual_objects' }] },
    },
  }).next_action, 'repair_visual_storyboard');

  assert.equal(decision.decideNextAction({
    video: {
      status: 'failed',
      video_quality_report: { issues: [{ code: 'invalid_caption_sync' }] },
    },
  }).next_action, 'repair_visual_storyboard');

  assert.equal(decision.decideNextAction({
    video: { status: 'project_ready', project_dir: '/tmp/project' },
  }).next_action, 'render_video');

  assert.equal(decision.decideNextAction({
    video: { status: 'rendered', output_url: '/media/output.mp4' },
  }).next_action, 'done');

  assert.equal(decision.decideNextAction({
    storyboard_plan: { status: 'planned', scenes: [{ index: 1 }] },
    scene_tts: { status: 'failed' },
  }).next_action, 'retry_scene_tts');

  assert.equal(decision.decideNextAction({
    scene_tts: { status: 'done' },
    timed_storyboard_plan: { status: 'timed', captions: [{ index: 1 }] },
  }).next_action, 'generate_visual_storyboard');
}

run();
console.log('agent workflow decision tests passed');
