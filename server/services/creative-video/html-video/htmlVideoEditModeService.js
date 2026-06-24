const path = require('path');

const { canonicalFrameId, findFrameByAnyId } = require('./frameIdentity');

function timestamp() {
  return new Date().toISOString();
}

function ensureEditSessions(project = {}) {
  if (!Array.isArray(project.edit_sessions)) project.edit_sessions = [];
  return project.edit_sessions;
}

function nextPlanId(project = {}) {
  const sessions = ensureEditSessions(project);
  return `edit_plan_${String(sessions.length + 1).padStart(4, '0')}`;
}

function frameIds(project = {}) {
  return (Array.isArray(project.frames) ? project.frames : [])
    .map(frame => canonicalFrameId(frame))
    .filter(Boolean);
}

function classifyInstruction(instruction = '', selectedFrameId = '') {
  const text = String(instruction || '');
  const hasSelectedFrame = Boolean(String(selectedFrameId || '').trim());
  const isProject = /整体|全片|每一帧|全局|全部/.test(text);

  if (/短一点|快一点|慢一点|节奏|时长|每帧/.test(text)) {
    return { scope: 'project', mode: 'project_iterate_format' };
  }
  if (/内容|主题|改成|换成讲|融资|重写文案/.test(text)) {
    return { scope: 'project', mode: 'project_iterate_content' };
  }
  if (/风格|视觉|高级|杂志/.test(text) || isProject) {
    return { scope: 'project', mode: 'project_restyle' };
  }
  if (hasSelectedFrame && /(这|当前|本).{0,4}帧/.test(text)) {
    return { scope: 'frame', mode: 'frame_layout_fix' };
  }
  if (hasSelectedFrame && /遮挡|错位|越界|标签|文字/.test(text)) {
    return { scope: 'frame', mode: 'frame_layout_fix' };
  }

  return {
    scope: hasSelectedFrame ? 'frame' : 'project',
    mode: hasSelectedFrame ? 'frame_layout_fix' : 'project_restyle',
    ambiguous: true,
  };
}

async function createEditPlan({ project, instruction = '', selectedFrameId = '' } = {}) {
  const sessions = ensureEditSessions(project);
  const classification = classifyInstruction(instruction, selectedFrameId);
  const affectedFrames = classification.scope === 'frame' && selectedFrameId
    ? [selectedFrameId]
    : frameIds(project);
  const now = timestamp();
  const plan = {
    id: nextPlanId(project),
    kind: 'edit_plan',
    scope: classification.scope,
    mode: classification.mode,
    instruction,
    status: 'planned',
    requires_confirmation: true,
    affected_frames: affectedFrames,
    ambiguous: classification.ambiguous === true,
    created_at: now,
    updated_at: now,
  };

  sessions.push(plan);
  return {
    success: true,
    plan,
    choices: classification.ambiguous ? [
      { mode: 'project_restyle', label: '只改风格', description: '保留文字和结构，重写视觉。' },
      { mode: 'project_iterate_content', label: '改内容', description: '重新规划每帧内容和文案。' },
      { mode: 'project_iterate_format', label: '调节奏', description: '调整帧数、时长和节奏。' },
    ] : [],
  };
}

function findEditPlan(project = {}, planId = '') {
  const id = String(planId || '').trim();
  return ensureEditSessions(project).find(session => session.kind === 'edit_plan' && session.id === id) || null;
}

function normalizeGeneratedDraft(result = {}, frameId = '') {
  const draft = result.draft && typeof result.draft === 'object' ? result.draft : {};
  const draftId = String(draft.id || result.draft_id || result.draftId || '').trim();
  if (!draftId) return null;
  return {
    frame_id: String(result.frame_id || result.resolved_frame_id || frameId || '').trim(),
    draft_id: draftId,
    html_path: String(draft.html_path || result.html_path || '').trim(),
    status: 'ready',
  };
}

function draftHtmlPath(projectDir = '', generatedDraft = {}) {
  const htmlPath = String(generatedDraft.html_path || generatedDraft.draft?.html_path || '').trim();
  if (!htmlPath) return '';
  return path.isAbsolute(htmlPath) ? htmlPath : path.join(projectDir || '', htmlPath);
}

async function runEditPlan({
  projectDir = '',
  project,
  planId,
  confirm = false,
  runLayoutQa = true,
  iterateService,
  layoutQaService,
  model,
} = {}) {
  const plan = findEditPlan(project, planId);
  if (!plan) {
    return { success: false, code: 'EDIT_PLAN_NOT_FOUND', message: '未找到编辑计划。' };
  }
  if (plan.requires_confirmation !== false && confirm !== true) {
    return { success: false, code: 'EDIT_PLAN_CONFIRM_REQUIRED', message: '请先确认编辑计划后再执行。' };
  }
  if (plan.status !== 'planned') {
    return { success: false, code: 'EDIT_PLAN_ALREADY_RAN', message: '该编辑计划已执行过，请重新生成计划。' };
  }
  if (!iterateService || typeof iterateService.iterateFrameHtml !== 'function') {
    return {
      success: false,
      code: 'EDIT_PLAN_ITERATE_SERVICE_MISSING',
      message: '缺少执行编辑计划所需的帧重写服务。',
    };
  }

  plan.status = 'running';
  plan.generated_drafts = [];
  plan.execution_errors = [];
  plan.layout_qa_reports = [];
  plan.updated_at = timestamp();

  const affectedFrames = Array.isArray(plan.affected_frames) ? plan.affected_frames : [];
  for (const frameId of affectedFrames) {
    const result = await iterateService.iterateFrameHtml({
      projectDir,
      project,
      frameId,
      instruction: plan.instruction,
      mode: plan.mode,
      preserveText: true,
      model,
    });
    if (!result || result.success === false) {
      plan.execution_errors.push({
        frame_id: frameId,
        code: result?.code || 'EDIT_PLAN_FRAME_ITERATE_FAILED',
        message: result?.message || '当前帧草稿生成失败。',
      });
      continue;
    }

    const generatedDraft = normalizeGeneratedDraft(result, frameId);
    if (generatedDraft) plan.generated_drafts.push(generatedDraft);

    if (runLayoutQa !== false && layoutQaService && typeof layoutQaService.inspectFrameHtmlLayout === 'function' && generatedDraft?.html_path) {
      const frame = findFrameByAnyId(project, frameId) || { id: frameId };
      const htmlPath = draftHtmlPath(projectDir, generatedDraft);
      if (htmlPath) {
        const report = await layoutQaService.inspectFrameHtmlLayout({
          htmlPath,
          frame: { ...frame, html_path: generatedDraft.html_path },
          resolution: project?.output?.resolution || { width: 1920, height: 1080 },
          durationSec: frame.duration_sec,
        });
        plan.layout_qa_reports.push({
          frame_id: canonicalFrameId(frame) || frameId,
          draft_id: generatedDraft.draft_id,
          report,
        });
      }
    }
  }

  plan.status = plan.execution_errors.length > 0 ? 'failed' : 'drafts_ready';
  plan.updated_at = timestamp();
  return {
    success: plan.status === 'drafts_ready',
    plan,
    plan_id: plan.id,
    generated_drafts: plan.generated_drafts,
    layout_qa_reports: plan.layout_qa_reports,
    execution_errors: plan.execution_errors,
    message: plan.status === 'drafts_ready' ? '编辑计划已生成批量草稿。' : '编辑计划执行失败，请查看失败帧。',
  };
}

function generatedDrafts(plan = {}) {
  return (Array.isArray(plan.generated_drafts) ? plan.generated_drafts : [])
    .filter(item => item && item.frame_id && item.draft_id);
}

async function acceptEditPlanDrafts({
  projectDir = '',
  project,
  planId,
  frameHtmlEditService,
} = {}) {
  const plan = findEditPlan(project, planId);
  if (!plan) {
    return { success: false, code: 'EDIT_PLAN_NOT_FOUND', message: '未找到编辑计划。' };
  }
  if (!frameHtmlEditService || typeof frameHtmlEditService.acceptFrameDraft !== 'function') {
    return { success: false, code: 'EDIT_PLAN_DRAFT_SERVICE_MISSING', plan, message: '帧源码草稿服务未配置，无法接受编辑计划草稿。' };
  }

  const accepted_drafts = [];
  const execution_errors = [];
  for (const draft of generatedDrafts(plan)) {
    const result = await frameHtmlEditService.acceptFrameDraft({
      projectDir,
      project,
      frameId: draft.frame_id,
      draftId: draft.draft_id,
    });
    if (!result || result.success === false) {
      execution_errors.push({
        frame_id: draft.frame_id,
        draft_id: draft.draft_id,
        code: result?.code || 'EDIT_PLAN_DRAFT_ACCEPT_FAILED',
        message: result?.message || '接受帧源码草稿失败。',
      });
      plan.status = 'failed';
      plan.execution_errors = execution_errors;
      plan.accepted_drafts = accepted_drafts;
      plan.updated_at = timestamp();
      return { ...(result || { success: false, code: 'EDIT_PLAN_DRAFT_ACCEPT_FAILED', message: '接受帧源码草稿失败。' }), plan, accepted_drafts, execution_errors };
    }
    accepted_drafts.push({ frame_id: draft.frame_id, draft_id: draft.draft_id, result });
  }

  plan.status = execution_errors.length > 0 ? 'failed' : 'accepted';
  plan.execution_errors = execution_errors;
  plan.accepted_drafts = accepted_drafts;
  plan.updated_at = timestamp();
  return {
    success: execution_errors.length === 0,
    plan,
    plan_id: plan.id,
    accepted_drafts,
    execution_errors,
    requires_render: execution_errors.length === 0,
    message: execution_errors.length === 0 ? '编辑计划草稿已批量接受。' : '接受编辑计划草稿失败。',
  };
}

async function discardEditPlanDrafts({
  project,
  planId,
  frameHtmlEditService,
} = {}) {
  const plan = findEditPlan(project, planId);
  if (!plan) {
    return { success: false, code: 'EDIT_PLAN_NOT_FOUND', message: '未找到编辑计划。' };
  }
  if (!frameHtmlEditService || typeof frameHtmlEditService.discardFrameDraft !== 'function') {
    return { success: false, code: 'EDIT_PLAN_DRAFT_SERVICE_MISSING', plan, message: '帧源码草稿服务未配置，无法放弃编辑计划草稿。' };
  }

  const discarded_drafts = [];
  const execution_errors = [];
  for (const draft of generatedDrafts(plan)) {
    const result = await frameHtmlEditService.discardFrameDraft({
      project,
      frameId: draft.frame_id,
      draftId: draft.draft_id,
    });
    if (!result || result.success === false) {
      execution_errors.push({
        frame_id: draft.frame_id,
        draft_id: draft.draft_id,
        code: result?.code || 'EDIT_PLAN_DRAFT_DISCARD_FAILED',
        message: result?.message || '放弃帧源码草稿失败。',
      });
      plan.status = 'failed';
      plan.execution_errors = execution_errors;
      plan.discarded_drafts = discarded_drafts;
      plan.updated_at = timestamp();
      return { ...(result || { success: false, code: 'EDIT_PLAN_DRAFT_DISCARD_FAILED', message: '放弃帧源码草稿失败。' }), plan, discarded_drafts, execution_errors };
    }
    discarded_drafts.push({ frame_id: draft.frame_id, draft_id: draft.draft_id, result });
  }

  plan.status = execution_errors.length > 0 ? 'failed' : 'discarded';
  plan.execution_errors = execution_errors;
  plan.discarded_drafts = discarded_drafts;
  plan.updated_at = timestamp();
  return {
    success: execution_errors.length === 0,
    plan,
    plan_id: plan.id,
    discarded_drafts,
    execution_errors,
    message: execution_errors.length === 0 ? '编辑计划草稿已批量放弃。' : '放弃编辑计划草稿失败。',
  };
}

module.exports = {
  timestamp,
  nextPlanId,
  ensureEditSessions,
  frameIds,
  classifyInstruction,
  createEditPlan,
  findEditPlan,
  normalizeGeneratedDraft,
  runEditPlan,
  acceptEditPlanDrafts,
  discardEditPlanDrafts,
};
