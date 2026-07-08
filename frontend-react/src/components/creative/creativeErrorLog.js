import { firstText } from './creativeDisplay.js';
import { RETRY_ACTION_TEXT, formatRetryItem, formatRetryList } from './creativeRetryDisplay.js';

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compactJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function collectUniqueArrays(...values) {
  const seen = new Set();
  return values
    .flatMap(value => (Array.isArray(value) ? value : []))
    .filter(item => {
      const key = compactJson(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function formatDiagnosticLine(item = {}, index) {
  const code = firstText(item.code, item.type, 'unknown');
  const where = [item.stage, item.sub_stage, item.frame_id ? `frame:${item.frame_id}` : '']
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' / ');
  const message = firstText(item.user_message, item.message, item.reason, '未提供错误说明。');
  return `${index + 1}. [${code}] ${where ? `${where} - ` : ''}${message}`;
}

export function buildWorkflowErrorLog({
  workflowId,
  workflow,
  retryPlan,
  retryPlanStatus,
  retryPlanMessage,
  status,
  message,
} = {}) {
  const rawWorkflow = plainObject(workflow?.workflow);
  const lastFailure = plainObject(workflow?.last_failure || rawWorkflow.last_failure);
  const workflowError = plainObject(workflow?.error || rawWorkflow.error);
  const projectSubstages = collectUniqueArrays(workflow?.project_substages, rawWorkflow.project_substages);
  const diagnostics = collectUniqueArrays(
    workflow?.diagnostics,
    rawWorkflow.diagnostics,
    lastFailure.diagnostics,
    ...projectSubstages.map(stage => stage?.diagnostics),
  );
  // ponytail: 只列最近 20 条模型失败，完整原始记录仍在 workflow JSON。
  const failedModelCalls = collectUniqueArrays(workflow?.model_calls, rawWorkflow.model_calls)
    .filter(call => call?.success === false || firstText(call?.error))
    .slice(-20);
  const lines = [
    'MuseDock 创作任务错误日志',
    `任务 ID：${firstText(workflowId, workflow?.workflow_id, rawWorkflow.workflow_id, '未知')}`,
    `任务状态：${firstText(workflow?.status, rawWorkflow.status, status, '未知')}`,
    `界面提示：${firstText(message, workflow?.message, rawWorkflow.message, '无')}`,
    '',
    '失败摘要',
    `阶段：${formatRetryItem(lastFailure.stage || workflowError.stage) || '未知'}`,
    `子阶段：${formatRetryItem(lastFailure.sub_stage || workflowError.sub_stage) || '未知'}`,
    `错误码：${firstText(lastFailure.code, workflowError.code, retryPlan?.code, '未知')}`,
    `失败镜头：${firstText(lastFailure.frame_id, workflowError.frame_id, '无')}`,
    `失败时间：${firstText(lastFailure.updated_at, workflowError.updated_at, workflow?.updated_at, rawWorkflow.updated_at, '未知')}`,
    `错误说明：${firstText(lastFailure.message, workflowError.message, retryPlan?.user_message, message, '未提供错误说明。')}`,
    '',
    '恢复判断',
    `恢复计划状态：${retryPlanStatus || 'idle'}`,
    `是否可自动恢复：${retryPlan?.can_retry === true ? '是' : retryPlan?.can_retry === false ? '否' : '未知'}`,
    `恢复建议：${firstText(retryPlanMessage, retryPlan?.user_message, '无')}`,
    `处理方式：${RETRY_ACTION_TEXT[retryPlan?.repair_action] || retryPlan?.repair_action || '无'}`,
    `将复用：${formatRetryList(retryPlan?.reuse)}`,
    `将重新执行：${formatRetryList(retryPlan?.discard)}`,
    '',
    '诊断信息',
    ...(diagnostics.length ? diagnostics.map(formatDiagnosticLine) : ['无']),
    '',
    '工程子阶段',
    ...(projectSubstages.length ? projectSubstages.map(stage => (
      `- ${formatRetryItem(stage?.id) || stage?.id || '未知'}：${stage?.status || '未知'}${stage?.message ? `，${stage.message}` : ''}`
    )) : ['无']),
    '',
    '模型调用失败',
    ...(failedModelCalls.length ? failedModelCalls.map((call, index) => (
      `${index + 1}. ${firstText(call.agent, call.stage, 'unknown')} / ${firstText(call.sub_stage, call.frame_id, '无子阶段')}：${firstText(call.error, '未提供错误信息')}（${firstText(call.model?.model_id, call.model_id, '未知模型')}）`
    )) : ['无']),
  ];

  if (diagnostics.some(item => Object.keys(plainObject(item.details)).length > 0)) {
    lines.push('', '诊断详情', compactJson(diagnostics.map(item => ({
      code: item.code,
      stage: item.stage,
      sub_stage: item.sub_stage,
      frame_id: item.frame_id,
      details: item.details,
    }))));
  }

  return lines.join('\n');
}
