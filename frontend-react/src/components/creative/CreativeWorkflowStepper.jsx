import { useMemo } from 'react';
import { cn } from '@/lib/utils.js';
import { STATUS_TEXT, getStepState, normalizeWorkflowStages } from './creativeDisplay.js';

const DOT_CLASS = {
  done: 'border-[#111827] bg-[#f8fafc] text-[#111827]',
  active: 'border-[#111827] bg-[#111827] text-white shadow-[0_0_0_6px_rgba(17,24,39,.12)]',
  failed: 'border-red-600 bg-red-50 text-red-600',
  queued: 'border-[#cbd5e1] bg-[#f8fafc] text-[#475569]',
  waiting: 'border-[#d7dce3] bg-white text-[#8a93a2]',
  '': 'border-[#d7dce3] bg-white text-[#8a93a2]',
};

const CONNECTOR_CLASS = {
  done: 'bg-[#111827]',
  active: 'bg-[#111827]',
  failed: 'bg-red-300',
  queued: 'bg-[#e4e8ef]',
  waiting: 'bg-[#e4e8ef]',
  '': 'bg-[#e4e8ef]',
};

const STATUS_CLASS = {
  done: 'text-[#4b5563]',
  active: 'rounded-full bg-[#111827] px-2 py-0.5 text-white',
  failed: 'text-red-700',
  queued: 'text-[#64748b]',
  waiting: 'text-[#8a93a2]',
  '': 'text-[#8a93a2]',
};

const STEP_CLASS = {
  active: 'bg-white ring-2 ring-[#111827] shadow-[0_12px_28px_rgba(15,23,42,.12)]',
  failed: 'bg-red-50 ring-1 ring-red-200',
};

const LABEL_CLASS = {
  active: 'text-[#111827]',
  queued: 'text-[#475569]',
  waiting: 'text-[#69717e]',
  '': 'text-[#69717e]',
};

const ACTIVE_OUTLINE_CLASS = "before:pointer-events-none before:absolute before:inset-[-5px] before:rounded-[12px] before:border-[3px] before:border-[#111827]/70 before:bg-[#111827]/[0.04] before:shadow-[0_0_0_5px_rgba(17,24,39,.08)] before:content-[''] before:animate-pulse motion-reduce:before:animate-none";

export function CreativeWorkflowStepper({ workflow }) {
  const stages = useMemo(() => normalizeWorkflowStages(workflow), [workflow]);

  return (
    <div className="grid w-full min-w-0 grid-cols-[repeat(10,minmax(72px,1fr))] items-start overflow-x-auto px-1 pb-2.5 pt-[22px] max-[760px]:min-w-[780px]" aria-label="生成进度">
      {stages.map((stage, index) => {
        const stepState = getStepState(stage, index, stages);
        return (
          <div
            className={cn(
              'relative grid min-h-[88px] min-w-[72px] justify-items-center gap-2 rounded-lg px-2 py-2 text-center transition-[box-shadow,background-color] duration-150',
              STEP_CLASS[stepState],
              stepState === 'active' && ACTIVE_OUTLINE_CLASS,
            )}
            key={stage.id || stage.label}
            aria-current={stepState === 'active' ? 'step' : undefined}
          >
            {index > 0 ? (
              <span
                className={cn('absolute right-[calc(50%+18px)] top-[13px] h-0.5 w-[calc(100%-36px)] rounded-full', CONNECTOR_CLASS[stepState])}
                aria-hidden="true"
              />
            ) : null}
            <span className={cn('relative z-10 inline-flex size-7 items-center justify-center rounded-full border-2 text-xs font-extrabold', DOT_CLASS[stepState])}>
              {index + 1}
            </span>
            <span className={cn('w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs font-extrabold text-[#30343b]', LABEL_CLASS[stepState])}>{stage.label}</span>
            <small className={cn('min-h-[18px] text-[11px] font-bold leading-tight', STATUS_CLASS[stepState])}>
              {STATUS_TEXT[stage.status] || stage.status || '等待中'}
            </small>
          </div>
        );
      })}
    </div>
  );
}
