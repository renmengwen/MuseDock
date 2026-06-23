const assert = require('assert/strict');

const {
  createEditPlan,
  runEditPlan,
  findEditPlan,
} = require('../server/services/creative-video/html-video/htmlVideoEditModeService');

(async () => {
  const project = {
    frames: [{ id: 'scene_01' }, { id: 'scene_02' }],
    edit_sessions: [],
  };

  const restyle = await createEditPlan({ project, instruction: '整体换成更高级的财经杂志风，文案不变。' });
  assert.equal(restyle.success, true);
  assert.equal(restyle.plan.scope, 'project');
  assert.equal(restyle.plan.mode, 'project_restyle');
  assert.equal(project.edit_sessions.length, 1);
  assert.equal(findEditPlan(project, restyle.plan.id).id, restyle.plan.id);

  const frameFix = await createEditPlan({ project, instruction: '这一帧标签遮挡了，修一下。', selectedFrameId: 'scene_02' });
  assert.equal(frameFix.plan.scope, 'frame');
  assert.equal(frameFix.plan.mode, 'frame_layout_fix');
  assert.deepEqual(frameFix.plan.affected_frames, ['scene_02']);

  const projectLayoutSweep = await createEditPlan({ project, instruction: '整体每一帧都检查遮挡和标签错位。', selectedFrameId: 'scene_02' });
  assert.equal(projectLayoutSweep.plan.scope, 'project');
  assert.equal(projectLayoutSweep.plan.mode, 'project_restyle');
  assert.deepEqual(projectLayoutSweep.plan.affected_frames, ['scene_01', 'scene_02']);

  const format = await createEditPlan({ project, instruction: '每帧短一点，节奏快一点。' });
  assert.equal(format.plan.mode, 'project_iterate_format');

  const content = await createEditPlan({ project, instruction: '把内容改成讲融资。' });
  assert.equal(content.plan.mode, 'project_iterate_content');

  const run = await runEditPlan({ project, planId: restyle.plan.id });
  assert.equal(run.success, true);
  assert.equal(findEditPlan(project, restyle.plan.id).status, 'running');

  const missing = await runEditPlan({ project, planId: 'missing' });
  assert.equal(missing.success, false);
  assert.equal(missing.code, 'EDIT_PLAN_NOT_FOUND');

  console.log('html-video edit plan service tests passed');
})();
