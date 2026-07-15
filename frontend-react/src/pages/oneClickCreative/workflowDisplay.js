export function getWorkflowDisplayMessage(workflow, fallback = '') {
  const stages = Array.isArray(workflow?.stages) ? workflow.stages : [];
  const failedStage = stages.find(stage => stage.status === 'failed');
  const activeStage = stages.find(stage => ['running', 'queued', 'pending'].includes(stage.status));
  if (workflow?.current_stage_message) return workflow.current_stage_message;
  if (workflow?.status === 'failed' && failedStage?.message) return failedStage.message;
  if (activeStage?.message) return activeStage.message;
  if (workflow?.status === 'running') {
    return workflow?.message
      || fallback
      || '创作任务已创建，正在生成视频...';
  }

  return workflow?.error?.message
    || workflow?.message
    || fallback
    || '创作任务已创建，正在生成视频...';
}

export function getWorkflowVideoUrl(workflow) {
  // 优先读后端归一的稳定字段；旧任务无此字段时回退到历史多版本嵌套结构。
  if (typeof workflow?.render_output_url === 'string' && workflow.render_output_url.trim()) {
    return workflow.render_output_url;
  }
  const renderResult = workflow?.stages?.find(stage => stage.id === 'render')?.result;
  const candidates = [
    workflow?.result?.video?.output_url,
    workflow?.result?.render?.output_url,
    workflow?.result?.hyperframes_freeform?.render?.output_url,
    workflow?.render?.output_url,
    workflow?.hyperframes_freeform?.render?.output_url,
    renderResult?.video?.output_url,
    renderResult?.render?.output_url,
    renderResult?.hyperframes_freeform?.render?.output_url,
    renderResult?.output_url,
  ];
  const directUrl = candidates.find(value => typeof value === 'string' && value.trim());
  if (directUrl) return directUrl;
  return '';
}

export function getWorkflowPayload(json) {
  return json?.data || json?.workflow || json || null;
}

export function getWorkflowId(json) {
  const workflow = getWorkflowPayload(json);
  return json?.workflow_id || workflow?.workflow_id || workflow?.id || '';
}

export function getErrorMessage(error, fallback) {
  return error?.data?.message || error?.message || fallback;
}

export function getTaskTitle(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '未命名创作任务';
  return trimmed.length > 22 ? `${trimmed.slice(0, 22)}...` : trimmed;
}

export function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

export function getWorkflowGeneratedTitle(workflow) {
  const sceneSpec = workflow?.result?.hyperframes_freeform?.project?.scene_spec
    || workflow?.result?.hyperframes_freeform?.scene_spec
    || workflow?.result?.scene_spec
    || workflow?.scene_spec
    || null;
  return firstText(
    sceneSpec?.title,
    workflow?.result?.hyperframes_freeform?.project?.title,
    workflow?.result?.hyperframes_freeform?.title,
  );
}

export function getTaskDisplayTitle(workflow, input, fallbackTitle = '') {
  return getWorkflowGeneratedTitle(workflow) || fallbackTitle || getTaskTitle(input);
}

export function getTaskTimeLabel(value) {
  if (!value) return '刚刚';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
