import { useMemo } from 'react';
import { cn } from '@/lib/utils.js';
import { STATUS_TEXT, getStepState, normalizeWorkflowStages } from './creativeDisplay.js';

const DOT_CLASS = {
  done: 'border-[#16a34a] bg-[#16a34a] text-white',
  active: 'border-[#fe2c55] bg-white text-[#fe2c55] shadow-[0_0_0_5px_rgba(254,44,85,.10)]',
  failed: 'border-red-600 bg-red-50 text-red-600',
  waiting: 'border-[#d7dce3] bg-white text-[#8a93a2]',
  '': 'border-[#d7dce3] bg-white text-[#8a93a2]',
};

const CONNECTOR_CLASS = {
  done: 'bg-[#16a34a]',
  active: 'bg-[#16a34a]',
  failed: 'bg-red-300',
  waiting: 'bg-[#e4e8ef]',
  '': 'bg-[#e4e8ef]',
};

const STATUS_CLASS = {
  done: 'text-[#15803d]',
  active: 'text-[#fe2c55]',
  failed: 'text-red-700',
  waiting: 'text-[#8a93a2]',
  '': 'text-[#8a93a2]',
};

export function CreativeWorkflowStepper({ workflow }) {
  const stages = useMemo(() => normalizeWorkflowStages(workflow), [workflow]);

  return (
    <div className="grid w-full min-w-0 grid-cols-10 items-start overflow-x-auto px-1 pb-2 pt-5" aria-label="生成进度">
      {stages.map((stage, index) => {
        const stepState = getStepState(stage, index, stages);
        return (
          <div className="relative grid min-w-[72px] justify-items-center gap-2 text-center" key={stage.id || stage.label}>
            {index > 0 ? (
              <span
                className={cn('absolute right-[calc(50%+18px)] top-[13px] h-0.5 w-[calc(100%-36px)] rounded-full', CONNECTOR_CLASS[stepState])}
                aria-hidden="true"
              />
            ) : null}
            <span className={cn('relative z-10 inline-flex size-7 items-center justify-center rounded-full border-2 text-xs font-extrabold', DOT_CLASS[stepState])}>
              {index + 1}
            </span>
            <span className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs font-extrabold text-[#30343b]">{stage.label}</span>
            <small className={cn('text-[11px] font-bold leading-tight', STATUS_CLASS[stepState])}>
              {STATUS_TEXT[stage.status] || stage.status || '等待中'}
            </small>
          </div>
        );
      })}
    </div>
  );
}
