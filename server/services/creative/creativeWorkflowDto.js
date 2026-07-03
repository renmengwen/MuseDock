function isPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeString(value) {
  return String(value ?? '').trim();
}

function firstString(...values) {
  return values.map(safeString).find(Boolean) || '';
}

function firstObject(...values) {
  return values.find(isPlainObject) || null;
}

function firstArray(...values) {
  return values.find(Array.isArray) || [];
}

function getHyperframes(workflow = {}) {
  return firstObject(workflow.result?.hyperframes_freeform, workflow.hyperframes_freeform) || {};
}

function getRenderStageOutputUrl(workflow = {}) {
  if (!Array.isArray(workflow.stages)) {
    return '';
  }
  const renderStage = workflow.stages.find(stage => stage?.id === 'render');
  return firstString(
    renderStage?.result?.video?.output_url,
    renderStage?.result?.render?.output_url,
    renderStage?.result?.hyperframes_freeform?.render?.output_url,
    renderStage?.result?.output_url,
  );
}

function getWorkflowOutputUrl(workflow = {}) {
  const hyperframes = getHyperframes(workflow);
  return firstString(
    workflow.render_output_url,
    workflow.result?.render?.output_url,
    workflow.result?.video?.output_url,
    hyperframes.render?.output_url,
    workflow.render?.output_url,
    workflow.hyperframes_freeform?.render?.output_url,
    workflow.result?.output_url,
    getRenderStageOutputUrl(workflow),
  );
}

function normalizeRender(workflow = {}) {
  const hyperframes = getHyperframes(workflow);
  const render = firstObject(
    workflow?.result?.render,
    workflow?.result?.video,
    hyperframes?.render,
    workflow?.render,
  ) || {};

  return {
    output_url: getWorkflowOutputUrl(workflow),
    output_path: firstString(render.output_path, render.outputPath),
    exports: firstArray(render.exports, workflow?.exports, hyperframes?.exports),
  };
}

function normalizeCreativeWorkflowDto(workflow) {
  if (!isPlainObject(workflow)) {
    return { success: false, message: '创作任务不存在。' };
  }

  const hyperframes = getHyperframes(workflow);
  const project = firstObject(
    hyperframes?.project,
    workflow?.result?.html_video_project,
    workflow?.html_video_project,
  ) || {};

  return {
    success: true,
    workflow_id: safeString(workflow.workflow_id),
    status: safeString(workflow.status),
    message: safeString(workflow.message),
    title: firstString(project.title, hyperframes.title, workflow.title),
    input: firstString(workflow.creative_context?.input?.raw_text, workflow.input),
    created_at: safeString(workflow.created_at),
    updated_at: safeString(workflow.updated_at),
    active_task: workflow.active_task ?? null,
    result: {
      render: normalizeRender(workflow),
      html_video_project: firstObject(
        project?.html_video_project,
        workflow?.result?.html_video_project,
        workflow?.html_video_project,
      ),
      scene_spec: firstObject(project?.scene_spec, hyperframes?.scene_spec, workflow?.result?.scene_spec),
      layout_qa: firstObject(project?.layout_qa, hyperframes?.layout_qa, workflow?.result?.layout_qa),
    },
    workflow,
  };
}

function normalizeCreativeWorkflowSummary(workflow) {
  const dto = normalizeCreativeWorkflowDto(workflow);

  return {
    workflow_id: dto.workflow_id || safeString(workflow?.workflow_id),
    status: dto.status || safeString(workflow?.status),
    message: dto.message || safeString(workflow?.message),
    title: dto.title || safeString(workflow?.title),
    input: dto.input || safeString(workflow?.input),
    created_at: dto.created_at || safeString(workflow?.created_at),
    updated_at: dto.updated_at || safeString(workflow?.updated_at),
    output_url: dto.result?.render?.output_url || '',
    active_task: dto.active_task ?? workflow?.active_task ?? null,
  };
}

module.exports = {
  getWorkflowOutputUrl,
  normalizeCreativeWorkflowDto,
  normalizeCreativeWorkflowSummary,
};
