import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { STAGE_LABELS, getWorkflowStatusText, normalizeWorkflowStages } from './creativeDisplay.js';
import {
  formatWorkflowDurationLabel,
  normalizeWorkflowProgress,
  summarizeProgressEvent,
} from './creativeProgress.js';

function getActiveStage(workflow) {
  const stages = normalizeWorkflowStages(workflow);
  const stageById = new Map(stages.map(stage => [stage.id, stage]));
  const currentStage = stageById.get(workflow?.current_stage);
  if (workflow?.status === 'failed') {
    const failedStageId = workflow?.last_failure?.stage || workflow?.error?.stage || '';
    return stageById.get(failedStageId)
      || stages.find(stage => stage.status === 'failed')
      || currentStage
      || stages[0]
      || null;
  }
  return currentStage
    || stages.find(stage => ['running', 'queued', 'pending'].includes(stage.status))
    || stages.find(stage => stage.status === 'failed')
    || [...stages].reverse().find(stage => stage.status === 'done')
    || stages[0]
    || null;
}

export function CreativeProgressPanel({ workflow, status, message, progressEvents = [] }) {
  const [expanded, setExpanded] = useState(false);
  const activeStage = useMemo(() => getActiveStage(workflow), [workflow]);
  if (!workflow) return null;

  const stageId = workflow.status === 'failed'
    ? (workflow.last_failure?.stage || workflow.error?.stage || workflow.current_stage || activeStage?.id || '')
    : (workflow.current_stage || activeStage?.id || '');
  const stageLabel = STAGE_LABELS[stageId] || activeStage?.label || '创作任务';
  const progress = normalizeWorkflowProgress(workflow);
  const isActiveProgress = !['done', 'failed'].includes(workflow.status) && progress < 100;
  const durationLabel = formatWorkflowDurationLabel(workflow);
  const currentMessage = workflow.current_stage_message
    || activeStage?.message
    || message
    || '正在获取最新进度...';

  return (
    <section className="grid gap-3 rounded-lg border border-[#e7e9ee] bg-[#f8fafc] p-4" aria-label="当前进展">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-[15px] font-bold leading-snug text-[#111827]">当前进展</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[#4b5563]">{workflow.status === 'done' ? '创作任务已完成。' : currentMessage}</p>
        </div>
        <strong className="shrink-0 text-lg leading-tight text-[#111827]">{progress}%</strong>
      </div>
      <div
        className={`h-2 overflow-hidden rounded-full bg-[#e5e7eb] ${isActiveProgress ? 'motion-safe:animate-pulse ring-2 ring-[#111827]/10 motion-reduce:animate-none' : ''}`}
        aria-label={`总进度 ${progress}%`}
      >
        <span
          className={`block h-full rounded-full bg-[#111827] transition-[width] duration-200 ${isActiveProgress ? 'shadow-[0_0_0_4px_rgba(17,24,39,.12)]' : ''}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <dl className="m-0 grid grid-cols-3 gap-x-3 gap-y-2 max-[720px]:grid-cols-1">
        <div className="min-w-0 rounded-md border border-[#edf0f4] bg-white p-3">
          <dt className="mb-1 text-xs font-bold text-[#8a93a2]">当前阶段</dt>
          <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{stageLabel}</dd>
        </div>
        <div className="min-w-0 rounded-md border border-[#edf0f4] bg-white p-3">
          <dt className="mb-1 text-xs font-bold text-[#8a93a2]">当前状态</dt>
          <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{getWorkflowStatusText(workflow, status)}</dd>
        </div>
        {durationLabel ? (
          <div className="min-w-0 rounded-md border border-[#edf0f4] bg-white p-3">
            <dt className="mb-1 text-xs font-bold text-[#8a93a2]">最终用时</dt>
            <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{durationLabel}</dd>
          </div>
        ) : null}
      </dl>
      <button className="inline-flex w-fit items-center gap-1.5 border-0 bg-transparent p-0 text-[13px] font-bold text-[#30343b] transition hover:text-[#111827]" type="button" onClick={() => setExpanded(value => !value)}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{expanded ? '收起详细进度' : '展开详细进度'}</span>
      </button>
      {expanded ? (
        <div className="grid gap-2 border-t border-[#e7e9ee] pt-2.5">
          <dl className="m-0 grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">阶段 ID</dt>
              <dd className="m-0 break-words text-[13px] text-[#1f2937]">{stageId || '无'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">事件序号</dt>
              <dd className="m-0 break-words text-[13px] text-[#1f2937]">{workflow.last_event_seq || 0}</dd>
            </div>
          </dl>
          {progressEvents.length ? (
            <ol className="m-0 grid max-h-[220px] list-none gap-2 overflow-auto p-0">
              {progressEvents.map(event => (
                <li className="grid gap-1 rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-2" key={`${event.seq || 0}-${event.type}-${event.received_at || ''}`}>
                  <code className="break-all text-xs text-[#111827]">{event.type || 'unknown_event'}</code>
                  <span className="break-words text-xs leading-normal text-[#4b5563]">{summarizeProgressEvent(event)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="m-0 text-xs leading-normal text-[#4b5563]">暂无本次页面会话的详细事件。</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
