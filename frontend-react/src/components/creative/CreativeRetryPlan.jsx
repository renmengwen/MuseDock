import { Link } from 'react-router-dom';
import { Loader2, RefreshCcw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { firstText } from './creativeDisplay.js';
import { RETRY_ACTION_TEXT, RETRY_CODE_TEXT, formatRetryItem, formatRetryList } from './creativeRetryDisplay.js';
import { CreativeVisualWarnings } from './CreativeVisualWarnings.jsx';

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function collectFailureDiagnostics(workflow) {
  const rawWorkflow = plainObject(workflow?.workflow);
  const lastFailure = plainObject(workflow?.last_failure || rawWorkflow.last_failure);
  const projectSubstages = [
    ...arrayOrEmpty(workflow?.project_substages),
    ...arrayOrEmpty(rawWorkflow.project_substages),
  ];
  return [
    ...arrayOrEmpty(workflow?.diagnostics),
    ...arrayOrEmpty(rawWorkflow.diagnostics),
    ...arrayOrEmpty(lastFailure.diagnostics),
    ...projectSubstages.flatMap(stage => arrayOrEmpty(stage?.diagnostics)),
  ].filter(item => item && typeof item === 'object');
}

function collectVisualIssues(workflow) {
  const rawWorkflow = plainObject(workflow?.workflow);
  const hyperframes = plainObject(workflow?.result?.hyperframes_freeform || rawWorkflow.result?.hyperframes_freeform);
  const visualInspect = plainObject(hyperframes.visual_inspect);
  const issues = [
    ...arrayOrEmpty(visualInspect.issues),
    ...collectFailureDiagnostics(workflow).flatMap(item => [
      ...arrayOrEmpty(item.issues),
      ...arrayOrEmpty(plainObject(item.details).issues),
    ]),
  ];
  const seen = new Set();
  return issues.filter(issue => {
    const key = [
      issue?.code,
      issue?.message,
      issue?.boundary_sec,
      arrayOrEmpty(issue?.times).join(','),
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return issue && typeof issue === 'object';
  });
}

function collectVisualMetrics(workflow) {
  const rawWorkflow = plainObject(workflow?.workflow);
  const hyperframes = plainObject(workflow?.result?.hyperframes_freeform || rawWorkflow.result?.hyperframes_freeform);
  const visualInspect = plainObject(hyperframes.visual_inspect);
  if (Object.keys(plainObject(visualInspect.metrics)).length) return plainObject(visualInspect.metrics);
  const diagnostic = collectFailureDiagnostics(workflow)
    .find(item => Object.keys(plainObject(plainObject(item.details).metrics)).length);
  return plainObject(plainObject(diagnostic?.details).metrics);
}

function formatSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${Number(number.toFixed(2))}s`;
}

function formatVisualIssue(issue = {}) {
  const message = firstText(issue.message, issue.user_message, issue.code, '检测到视觉问题。');
  const times = arrayOrEmpty(issue.times).map(formatSeconds).filter(Boolean);
  return times.length ? `${message}（${times.join('、')}）` : message;
}

function getFailureSummary(workflow, retryPlan, message) {
  const rawWorkflow = plainObject(workflow?.workflow);
  const lastFailure = plainObject(workflow?.last_failure || rawWorkflow.last_failure);
  const workflowError = plainObject(workflow?.error || rawWorkflow.error);
  const code = firstText(lastFailure.code, workflowError.code, retryPlan?.code);
  return {
    reason: firstText(lastFailure.message, workflowError.message, message, retryPlan?.user_message),
    code,
    typeText: RETRY_CODE_TEXT[code] || code || '未知失败',
    stageText: formatRetryItem(firstText(lastFailure.sub_stage, retryPlan?.retry_from, lastFailure.stage, workflowError.sub_stage, workflowError.stage)) || '未知阶段',
  };
}

export function CreativeRetryPlan({
  workflow,
  retryPlan,
  retryPlanStatus,
  retryPlanMessage,
  message = '',
  retrying,
  retryMode,
  onRetryWorkflow,
}) {
  const canRetry = retryPlanStatus === 'ready' && retryPlan?.can_retry === true;
  const cannotRetry = retryPlanStatus === 'ready' && retryPlan?.can_retry === false;
  const canIgnoreLayoutQa = canRetry && retryPlan?.code === 'frame_layout_qa_unresolved';
  const ignoringLayoutQa = retrying && retryMode === 'ignore_layout_qa';
  const failureSummary = getFailureSummary(workflow, retryPlan, message);
  const visualIssues = collectVisualIssues(workflow);
  const visualMetrics = collectVisualMetrics(workflow);
  const recoveryMessage = retryPlanMessage || retryPlan?.user_message || '系统会优先复用已完成内容，减少重复生成。';
  const metricSummary = [
    Number.isFinite(Number(visualMetrics.frame_count)) ? `抽样帧 ${visualMetrics.frame_count}` : '',
    Number.isFinite(Number(visualMetrics.blank_timed_sample_count)) ? `空白样本 ${visualMetrics.blank_timed_sample_count}` : '',
    Number.isFinite(Number(visualMetrics.sampled_boundary_count)) ? `镜头边界 ${visualMetrics.sampled_boundary_count}` : '',
  ].filter(Boolean).join(' / ');

  return (
    <section className="grid gap-3.5 rounded-lg border border-amber-200 bg-amber-50 p-4" aria-label="恢复建议">
      <div className="flex justify-between gap-3">
        <div>
          <h3 className="m-0 text-[15px] font-bold leading-snug text-[#111827]">恢复建议</h3>
          <div className="mt-1 grid gap-1 text-[13px] leading-relaxed text-[#6b7280]">
            {failureSummary.reason ? (
              <p className="m-0"><span className="font-bold text-[#92400e]">失败原因：</span>{failureSummary.reason}</p>
            ) : null}
            <p className="m-0"><span className="font-bold text-[#92400e]">恢复动作：</span>{recoveryMessage}</p>
          </div>
        </div>
      </div>

      {visualIssues.length ? (
        <div className="grid gap-2 border-l-2 border-amber-300 pl-3">
          <div className="text-[13px] font-bold leading-normal text-[#92400e]">视觉巡检问题</div>
          <ol className="m-0 grid list-decimal gap-1 pl-4 text-[13px] leading-relaxed text-[#4b5563]">
            {visualIssues.slice(0, 6).map((issue, index) => (
              <li key={`${issue.code || 'issue'}-${index}`}>{formatVisualIssue(issue)}</li>
            ))}
          </ol>
          {visualIssues.length > 6 ? (
            <div className="text-xs leading-normal text-[#8a6a20]">其余 {visualIssues.length - 6} 条可在错误日志中查看。</div>
          ) : null}
          {metricSummary ? (
            <div className="text-xs leading-normal text-[#8a6a20]">{metricSummary}</div>
          ) : null}
        </div>
      ) : null}

      <CreativeVisualWarnings workflow={workflow} />

      {retryPlanStatus === 'idle' || retryPlanStatus === 'loading' ? (
        <div className="inline-flex items-center gap-2 text-[13px] leading-normal text-amber-800">
          <Loader2 size={14} className="animate-spin" />
          <span>正在生成恢复计划...</span>
        </div>
      ) : null}

      {retryPlanStatus === 'failed' ? (
        <div className="text-[13px] leading-normal text-red-700">
          {retryPlanMessage || '恢复计划生成失败，请稍后重试。'}
        </div>
      ) : null}

      {cannotRetry ? (
        <div className="grid gap-2.5">
          {/* 错误详情已显示在上方描述行，这里只给结论和下一步，避免同一句话重复出现 */}
          <div className="text-[13px] leading-normal text-amber-800">当前失败暂不支持自动恢复。</div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#d9dde5] bg-white px-2.5 text-xs font-bold text-[#30343b] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#111827]"
              to="/settings?section=creative"
            >
              <Settings2 size={13} />
              <span>调整创作默认值</span>
            </Link>
            <span className="text-xs leading-normal text-[#8a93a2]">可调整目标时长等默认值后，重新发起创作。</span>
          </div>
        </div>
      ) : null}

      {canRetry ? (
        <>
          <dl className="m-0 grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">失败位置</dt>
              <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{failureSummary.stageText || formatRetryItem(retryPlan.retry_from) || '视频工程'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">失败类型</dt>
              <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{failureSummary.typeText || RETRY_CODE_TEXT[retryPlan.code] || retryPlan.user_message || retryPlan.code || '未知失败'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">处理方式</dt>
              <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{RETRY_ACTION_TEXT[retryPlan.repair_action] || '按最新恢复计划继续执行'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">将复用</dt>
              <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{formatRetryList(retryPlan.reuse)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">将重新执行</dt>
              <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{formatRetryList(retryPlan.discard)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="w-fit bg-[#111827] text-white hover:bg-[#020617]"
              disabled={retrying}
              onClick={() => onRetryWorkflow?.(false)}
            >
              {retrying && !ignoringLayoutQa ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
              <span>{retrying && !ignoringLayoutQa ? '正在修复并重试...' : '修复并重试'}</span>
            </Button>
            {canIgnoreLayoutQa ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={retrying}
                onClick={() => onRetryWorkflow?.(true)}
              >
                {ignoringLayoutQa ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                <span>{ignoringLayoutQa ? '正在忽略布局警告并继续...' : '忽略本次布局警告并继续'}</span>
              </Button>
            ) : null}
          </div>
          {canIgnoreLayoutQa ? (
            <p className="m-0 text-xs leading-normal text-fg-3">仅跳过本次失败帧的布局检查，后续仍会执行渲染和视觉巡检。</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
