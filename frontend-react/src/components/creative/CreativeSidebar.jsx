import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CirclePlus, FileText, PanelLeft, Search, Settings2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.jsx';
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const filteredTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return tasks;
    return tasks.filter(task => [
      task.title,
      task.input,
      task.workflow_id,
      STATUS_TEXT[task.status],
      task.status,
    ].some(value => String(value || '').toLowerCase().includes(query)));
  }, [searchQuery, tasks]);

  function selectSearchTask(task) {
    onSelectTask(task);
    setSearchOpen(false);
    setSearchQuery('');
  }

  return sidebarCollapsed ? (
    <aside className="relative block min-w-0 overflow-hidden border-r border-[#eef1f5] bg-white pl-[18px] pt-[18px] max-[760px]:max-h-[280px] max-[760px]:border-b max-[760px]:border-b-[#eef1f5] max-[760px]:border-r-0" aria-label="已收起的创作任务栏">
      <Button
        className="size-[34px] rounded-lg bg-white text-[#1f2937] shadow-[0_8px_20px_rgba(15,23,42,.08)] transition hover:-translate-y-px hover:bg-surface-hover hover:text-fg-1 hover:shadow-[0_10px_24px_rgba(15,23,42,.12)]"
        type="button"
        variant="ghost"
        size="icon"
        aria-label="展开任务列表"
        aria-pressed="true"
        onClick={onToggleSidebar}
      >
        <PanelLeft size={17} aria-hidden="true" />
      </Button>
      <Link
        className="inline-flex size-[34px] items-center justify-center rounded-lg bg-white text-[#4b5563] shadow-[0_8px_20px_rgba(15,23,42,.08)] transition hover:bg-[#f3f4f6] hover:text-[#111827]"
        to="/settings"
        aria-label="打开设置"
      >
        <Settings2 size={16} aria-hidden="true" />
      </Link>
    </aside>
  ) : (
    <aside className="relative grid min-h-0 min-w-0 grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] gap-[18px] overflow-hidden border-r border-[#eef1f5] bg-[#f8fafc] px-3 pb-4 pt-5 transition-[padding,background-color] duration-[240ms] max-[760px]:max-h-[280px] max-[760px]:border-b max-[760px]:border-b-[#eef1f5] max-[760px]:border-r-0">
      <div className="grid min-w-0 grid-cols-[auto_1fr_auto] items-center gap-2 text-[#111827]">
        <div className="inline-flex size-7 items-center justify-center rounded-md border border-[#d9dde5] bg-white text-[10px] font-black">MD</div>
        <div className="min-w-0">
          <strong className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-lg leading-none">一键创作</strong>
          <span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold text-[#69717e]">MuseDock 本地视频生产控制台</span>
        </div>
        <div className="inline-flex items-center gap-1 text-[#667085]">
          <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
            <DialogTrigger asChild>
              <Button
                className="size-8 rounded-md bg-transparent p-0 text-[#667085] hover:bg-[#eef0f4] hover:text-[#111827]"
                type="button"
                variant="ghost"
                size="icon"
                aria-label="搜索创作任务"
                title="搜索创作任务"
              >
                <Search size={17} aria-hidden="true" />
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[min(560px,calc(100vw-32px))]" showCloseButton>
              <DialogHeader>
                <DialogTitle>搜索创作任务</DialogTitle>
                <DialogDescription>按标题、输入内容、任务 ID 或状态筛选任务。</DialogDescription>
              </DialogHeader>
              <input
                className="h-10 w-full rounded-lg border border-[#d9dde5] bg-white px-3 text-sm text-[#111827] outline-none focus:border-[#111827] focus:shadow-[0_0_0_3px_rgba(37,244,238,.18)]"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="输入关键词搜索任务"
                autoFocus
              />
              <div className="grid max-h-[min(54vh,420px)] gap-1.5 overflow-auto" aria-label="搜索结果">
                {filteredTasks.length ? filteredTasks.map(task => (
                  <button
                    type="button"
                    className={cn(
                      'grid w-full min-w-0 cursor-pointer gap-1 rounded-lg border border-[#edf0f4] bg-white px-3 py-2.5 text-left text-[#111827] hover:border-[#111827] hover:bg-[#f8fafc]',
                      task.workflow_id === selectedWorkflowId && 'border-[#111827] bg-[#f8fafc]',
                    )}
                    key={task.workflow_id}
                    onClick={() => selectSearchTask(task)}
                  >
                    <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{task.title}</strong>
                    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[#69717e]">{STATUS_TEXT[task.status] || task.status || '等待中'} · {task.timeLabel}</span>
                    <small className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[#69717e]">{task.workflow_id}</small>
                  </button>
                )) : (
                  <div className="rounded-lg border border-dashed border-[#d9dde5] p-[18px] text-center text-[13px] text-[#69717e]">没有匹配的任务。</div>
                )}
              </div>
            </DialogContent>
          </Dialog>
          <Button
            className="size-8 rounded-md bg-transparent text-inherit transition hover:bg-surface-hover hover:text-fg-1"
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
        className="min-h-[42px] w-full rounded-lg border border-[#111827] bg-[#111827] text-sm text-white shadow-[0_8px_22px_rgba(15,23,42,.10)] transition hover:bg-[#020617] hover:text-white"
        type="button"
        variant="outline"
        onClick={onNewTask}
      >
        <CirclePlus size={16} />
        <span>开启新创作</span>
      </Button>

      <div className="px-2.5 text-xs font-bold text-[#98a2b3]">创作任务</div>
      <div className="grid min-h-0 content-start gap-2 overflow-auto pr-0.5" aria-label="创作任务列表">
        {tasks.length ? tasks.map(task => (
          <div
            className={cn(
              'group grid w-full cursor-pointer gap-2 rounded-lg border border-[#e7e9ee] bg-white/70 px-3 py-2.5 text-left text-[#1f2937] transition-[background-color,border-color,color,box-shadow] duration-150 hover:border-[#cfd6e2] hover:bg-white hover:shadow-[0_8px_20px_rgba(15,23,42,.06)]',
              task.workflow_id === selectedWorkflowId && 'border-[#111827] bg-white text-[#111827] shadow-[inset_3px_0_0_#111827,0_10px_24px_rgba(15,23,42,.08)]',
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
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
              <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-snug">{task.title}</strong>
              <span className="shrink-0 rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-bold leading-5 text-[#475569] ring-1 ring-[#e2e8f0]">
                {STATUS_TEXT[task.status] || task.status || '等待中'}
              </span>
            </div>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <small className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-[#8a93a2]">{task.workflow_id}</small>
              <div className="inline-flex items-center gap-1.5">
                <small className="whitespace-nowrap text-xs text-[#8a93a2]">{task.timeLabel}</small>
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
            </div>
          </div>
        )) : (
          <div className="grid justify-items-start gap-2 px-2.5 py-4 text-[13px] leading-6 text-[#98a2b3]">
            <FileText size={18} />
            <span>提交后，任务会出现在这里。</span>
          </div>
        )}
      </div>
      <div className="border-t border-[#e7e9ee] pt-3">
        <Link
          className="grid min-h-11 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-lg px-2.5 py-2 text-[#30343b] transition hover:bg-white hover:text-[#111827]"
          to="/settings"
        >
          <Settings2 size={16} aria-hidden="true" />
          <span className="grid min-w-0 gap-0.5">
            <strong className="text-sm leading-none">设置</strong>
            <small className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold text-[#8a93a2]">模型、默认值、本地状态</small>
          </span>
        </Link>
      </div>
    </aside>
  );
}
