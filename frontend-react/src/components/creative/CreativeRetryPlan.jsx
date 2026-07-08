import { Loader2, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { RETRY_ACTION_TEXT, RETRY_CODE_TEXT, formatRetryItem, formatRetryList } from './creativeRetryDisplay.js';

export function CreativeRetryPlan({
  retryPlan,
  retryPlanStatus,
  retryPlanMessage,
  retrying,
  onRetryWorkflow,
}) {
  const canRetry = retryPlanStatus === 'ready' && retryPlan?.can_retry === true;
  const cannotRetry = retryPlanStatus === 'ready' && retryPlan?.can_retry === false;

  return (
    <section className="grid gap-3.5 rounded-lg border border-amber-200 bg-amber-50 p-4" aria-label="恢复建议">
      <div className="flex justify-between gap-3">
        <div>
          <h3 className="m-0 text-[15px] font-bold leading-snug text-[#111827]">恢复建议</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6b7280]">{retryPlanMessage || retryPlan?.user_message || '系统会优先复用已完成内容，减少重复生成。'}</p>
        </div>
      </div>

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
        <div className="text-[13px] leading-normal text-amber-800">
          {retryPlan?.user_message || retryPlanMessage || '当前失败暂不支持自动恢复。'}
        </div>
      ) : null}

      {canRetry ? (
        <>
          <dl className="m-0 grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">失败位置</dt>
              <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{formatRetryItem(retryPlan.retry_from) || '视频工程'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">失败类型</dt>
              <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{RETRY_CODE_TEXT[retryPlan.code] || retryPlan.user_message || retryPlan.code || '未知失败'}</dd>
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
          <Button
            type="button"
            size="sm"
            className="w-fit bg-[#111827] text-white hover:bg-[#020617]"
            disabled={retrying}
            onClick={onRetryWorkflow}
          >
            {retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
            <span>{retrying ? '正在修复并重试...' : '修复并重试'}</span>
          </Button>
        </>
      ) : null}
    </section>
  );
}
