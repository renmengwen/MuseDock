import { CirclePlus, FileText, PanelLeft, Search, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { cn } from '@/lib/utils.js';
import { STATUS_TEXT } from './creativeDisplay.js';

export function CreativeSidebar({
  tasks,
  selectedWorkflowId,
  sidebarCollapsed,
  onToggleSidebar,
  onNewTask,
  onSelectTask,
  onDeleteTask,
}) {
  return sidebarCollapsed ? (
    <aside className="bg-white pt-[18px] pl-[18px]" aria-label="已收起的创作任务栏">
      <Button
        className="size-[34px] rounded-lg bg-white text-[#1f2937] shadow-[0_8px_20px_rgba(15,23,42,.08)] transition hover:-translate-y-0.5 hover:bg-[#eef4ff] hover:text-[#2563eb] hover:shadow-[0_10px_24px_rgba(37,99,235,.14)]"
        type="button"
        variant="ghost"
        size="icon"
        aria-label="展开任务列表"
        aria-pressed="true"
        onClick={onToggleSidebar}
      >
        <PanelLeft size={17} aria-hidden="true" />
      </Button>
    </aside>
  ) : (
    <aside className="grid min-w-0 grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-[18px] border-r border-[#eef1f5] bg-[#f8fafc] px-3 pb-4 pt-5 transition-[background-color,padding] duration-200">
      <div className="grid min-w-0 grid-cols-[auto_1fr_auto] items-center gap-2 text-[#2563eb]">
        <div className="inline-flex size-7 items-center justify-center rounded-full bg-[#eef4ff]"><Sparkles size={18} /></div>
        <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xl leading-none">一键创作</strong>
        <div className="inline-flex gap-3 text-[#667085]">
          <Search size={17} aria-hidden="true" />
          <Button
            className="size-[22px] rounded-md bg-transparent p-0 text-inherit transition hover:bg-[#eef4ff] hover:text-[#2563eb]"
            type="button"
            variant="ghost"
            size="icon"
            aria-label="收起任务列表"
            aria-pressed="false"
            onClick={onToggleSidebar}
          >
            <PanelLeft size={17} aria-hidden="true" />
          </Button>
        </div>
      </div>

      <Button
        className="min-h-[42px] w-full rounded-full border border-[#e5e7eb] bg-white text-sm text-[#111827] shadow-[0_8px_22px_rgba(15,23,42,.06)] transition hover:border-[#bfdbfe] hover:bg-white hover:text-[#2563eb]"
        type="button"
        variant="outline"
        onClick={onNewTask}
      >
        <CirclePlus size={16} />
        <span>开启新创作</span>
      </Button>

      <div className="px-2.5 text-xs font-bold text-[#98a2b3]">创作任务</div>
      <div className="grid min-h-0 content-start gap-1 overflow-auto pr-0.5" aria-label="创作任务列表">
        {tasks.length ? tasks.map(task => (
          <div
            className={cn(
              'group flex min-h-11 w-full cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-2 text-left text-[#1f2937] transition-[background-color,border-color,color,transform] duration-150 hover:border-[#e5e7eb] hover:bg-white',
              task.workflow_id === selectedWorkflowId && 'border-[#bfdbfe] bg-[#eef4ff] text-[#1d4ed8]',
            )}
            key={task.workflow_id}
            role="button"
            tabIndex={0}
            onClick={() => onSelectTask(task)}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              if (event.key === ' ') event.preventDefault();
              onSelectTask(task);
            }}
          >
            <div className="grid min-w-0 flex-1 gap-1">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-snug">{task.title}</span>
              <small className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[#8a93a2]">{STATUS_TEXT[task.status] || task.status || '等待中'} · {task.timeLabel}</small>
            </div>
            <Button
              type="button"
              className="size-[26px] shrink-0 rounded-md bg-transparent p-0 text-[#98a2b3] opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100"
              variant="ghost"
              size="icon"
              aria-label={`删除任务 ${task.title}`}
              title="删除任务"
              onClick={event => { event.stopPropagation(); onDeleteTask(task); }}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        )) : (
          <div className="grid justify-items-start gap-2 px-2.5 py-4 text-[13px] leading-6 text-[#98a2b3]">
            <FileText size={18} />
            <span>提交后，任务会出现在这里。</span>
          </div>
        )}
      </div>
    </aside>
  );
}
