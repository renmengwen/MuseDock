const { canonicalFrameId } = require('./frameIdentity');

function timestamp() {
  return new Date().toISOString();
}

function ensureSessions(project = {}) {
  if (!Array.isArray(project.edit_sessions)) project.edit_sessions = [];
  return project.edit_sessions;
}

function nextPlanId(project = {}) {
  const sessions = ensureSessions(project);
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
  const sessions = ensureSessions(project);
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
  return ensureSessions(project).find(session => session.kind === 'edit_plan' && session.id === id) || null;
}

async function runEditPlan({ project, planId } = {}) {
  const plan = findEditPlan(project, planId);
  if (!plan) {
    return { success: false, code: 'EDIT_PLAN_NOT_FOUND', message: '未找到编辑计划。' };
  }

  plan.status = 'running';
  plan.updated_at = timestamp();
  return { success: true, plan, message: '编辑计划已开始执行。' };
}

module.exports = {
  timestamp,
  nextPlanId,
  ensureSessions,
  frameIds,
  classifyInstruction,
  createEditPlan,
  findEditPlan,
  runEditPlan,
};
