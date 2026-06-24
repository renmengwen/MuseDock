const assert = require('assert/strict');

const {
  createEditPlan,
  runEditPlan,
  findEditPlan,
  acceptEditPlanDrafts,
  discardEditPlanDrafts,
  ensureEditSessions,
} = require('../server/services/creative-video/html-video/htmlVideoEditModeService');

(async () => {
  const project = {
    frames: [{ id: 'scene_01' }, { id: 'scene_02' }],
    edit_sessions: [],
  };
  assert.equal(ensureEditSessions(project), project.edit_sessions);

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

  const missingRunner = await runEditPlan({ project, planId: restyle.plan.id, confirm: true });
  assert.equal(missingRunner.success, false);
  assert.equal(missingRunner.code, 'EDIT_PLAN_ITERATE_SERVICE_MISSING');
  assert.equal(findEditPlan(project, restyle.plan.id).status, 'planned');

  const unconfirmed = await runEditPlan({
    project,
    planId: restyle.plan.id,
    confirm: false,
    iterateService: {
      iterateFrameHtml: async () => ({ success: true, draft: { id: 'draft_should_not_run', html_path: 'frames/.drafts/nope.html' } }),
    },
  });
  assert.equal(unconfirmed.success, false);
  assert.equal(unconfirmed.code, 'EDIT_PLAN_CONFIRM_REQUIRED');
  assert.equal(findEditPlan(project, restyle.plan.id).status, 'planned');

  const modelForwardProject = {
    frames: [{ id: 'scene_model', source_mode: 'raw_html', html_path: 'frames/scene_model.html' }],
    edit_sessions: [],
  };
  const modelForwardPlan = await createEditPlan({ project: modelForwardProject, instruction: '全片修复遮挡。' });
  const aiModel = { callTextModel: async () => ({ success: true, text: '<!doctype html><html></html>' }) };
  const modelForwardCalls = [];
  const modelForward = await runEditPlan({
    projectDir: '/tmp/html-video-project',
    project: modelForwardProject,
    planId: modelForwardPlan.plan.id,
    confirm: true,
    model: aiModel,
    iterateService: {
      iterateFrameHtml: async ({ model }) => {
        modelForwardCalls.push(model);
        return { success: true, draft: { id: 'draft_scene_model', html_path: 'frames/.drafts/scene_model/draft.html' } };
      },
    },
  });
  assert.equal(modelForward.success, true);
  assert.equal(modelForwardCalls[0], aiModel);

  const iterateCalls = [];
  const qaCalls = [];
  const executedProject = {
    output: { resolution: { width: 1280, height: 720 } },
    frames: [
      { id: 'scene_01', source_mode: 'raw_html', html_path: 'frames/scene_01.html', duration_sec: 2 },
      { id: 'scene_02', source_mode: 'raw_html', html_path: 'frames/scene_02.html', duration_sec: 3 },
    ],
    edit_sessions: [],
  };
  const planResult = await createEditPlan({ project: executedProject, instruction: '全片修复文字遮挡。' });
  const execution = await runEditPlan({
    projectDir: '/tmp/html-video-project',
    project: executedProject,
    planId: planResult.plan.id,
    confirm: true,
    runLayoutQa: false,
    iterateService: {
      iterateFrameHtml: async ({ frameId, instruction, mode, preserveText }) => {
        iterateCalls.push([frameId, instruction, mode, preserveText]);
        return {
          success: true,
          draft: {
            id: `draft_${frameId}`,
            html_path: `frames/.drafts/${frameId}/draft_${frameId}.html`,
          },
        };
      },
    },
    layoutQaService: {
      inspectFrameHtmlLayout: async ({ frame }) => {
        qaCalls.push(frame.id);
        return { success: true, issues: [], metrics: { frame_id: frame.id } };
      },
    },
  });
  assert.equal(execution.success, true);
  assert.equal(execution.plan.status, 'drafts_ready');
  assert.deepEqual(iterateCalls.map(call => call[0]), ['scene_01', 'scene_02']);
  assert.deepEqual(iterateCalls.map(call => call[3]), [true, true]);
  assert.deepEqual(qaCalls, []);
  assert.deepEqual(execution.plan.generated_drafts.map(item => item.draft_id), ['draft_scene_01', 'draft_scene_02']);

  const rerunAccepted = await runEditPlan({
    projectDir: '/tmp/html-video-project',
    project: executedProject,
    planId: planResult.plan.id,
    confirm: true,
    iterateService: {
      iterateFrameHtml: async () => ({ success: true, draft: { id: 'draft_should_not_rerun', html_path: 'frames/.drafts/nope.html' } }),
    },
  });
  assert.equal(rerunAccepted.success, false);
  assert.equal(rerunAccepted.code, 'EDIT_PLAN_ALREADY_RAN');

  const draftActions = [];
  const accept = await acceptEditPlanDrafts({
    projectDir: '/tmp/html-video-project',
    project: executedProject,
    planId: planResult.plan.id,
    frameHtmlEditService: {
      acceptFrameDraft: async ({ frameId, draftId }) => {
        draftActions.push(['accept', frameId, draftId]);
        return { success: true, frame_id: frameId, accepted_draft_id: draftId };
      },
    },
  });
  assert.equal(accept.success, true);
  assert.equal(accept.plan.status, 'accepted');
  assert.deepEqual(draftActions, [
    ['accept', 'scene_01', 'draft_scene_01'],
    ['accept', 'scene_02', 'draft_scene_02'],
  ]);

  const discardPlan = await createEditPlan({ project: executedProject, instruction: '全片修复标签遮挡。' });
  discardPlan.plan.generated_drafts = [{ frame_id: 'scene_01', draft_id: 'draft_discard_01' }];
  const discard = await discardEditPlanDrafts({
    project: executedProject,
    planId: discardPlan.plan.id,
    frameHtmlEditService: {
      discardFrameDraft: async ({ frameId, draftId }) => {
        draftActions.push(['discard', frameId, draftId]);
        return { success: true, frame_id: frameId, discarded_draft_id: draftId };
      },
    },
  });
  assert.equal(discard.success, true);
  assert.equal(discard.plan.status, 'discarded');
  assert.deepEqual(draftActions.slice(2), [
    ['discard', 'scene_01', 'draft_discard_01'],
  ]);

  const missing = await runEditPlan({ project, planId: 'missing' });
  assert.equal(missing.success, false);
  assert.equal(missing.code, 'EDIT_PLAN_NOT_FOUND');

  console.log('html-video edit plan service tests passed');
})();
