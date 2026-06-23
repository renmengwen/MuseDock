import { CirclePlus, FileText, PanelLeft, Search, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
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
    <aside className="creativeTaskSidebar collapsed" aria-label="已收起的创作任务栏">
      <Button
        className="creativeCollapsedExpand"
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
    <aside className="creativeTaskSidebar">
      <div className="creativeSidebarBrand">
        <div className="creativeBrandMark"><Sparkles size={18} /></div>
        <strong>一键创作</strong>
        <div className="creativeSidebarTools">
          <Search size={17} aria-hidden="true" />
          <Button
            className="creativeSidebarToggle"
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

      <Button className="creativeNewTaskButton" type="button" onClick={onNewTask}>
        <CirclePlus size={16} />
        <span>开启新创作</span>
      </Button>

      <div className="creativeTaskListHeader">创作任务</div>
      <div className="creativeTaskList" aria-label="创作任务列表">
        {tasks.length ? tasks.map(task => (
          <div
            className={`creativeTaskItem ${task.workflow_id === selectedWorkflowId ? 'active' : ''}`}
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
            <div className="creativeTaskItemContent">
              <span>{task.title}</span>
              <small>{STATUS_TEXT[task.status] || task.status || '等待中'} · {task.timeLabel}</small>
            </div>
            <Button
              type="button"
              className="creativeTaskDeleteButton"
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
          <div className="creativeTaskEmpty">
            <FileText size={18} />
            <span>提交后，任务会出现在这里。</span>
          </div>
        )}
      </div>
    </aside>
  );
}
