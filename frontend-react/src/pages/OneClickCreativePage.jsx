import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUp,
  CirclePlus,
  FileText,
  Globe2,
  Loader2,
  PanelLeft,
  Search,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react';
import { api } from '../api/client.js';

const CREATIVE_TASKS_STORAGE_KEY = 'musedock.creative.tasks.v1';

const STAGE_LABELS = {
  source: '准备来源资料',
  research: '联网研究',
  assets: '素材分析',
  agent_run: '导演改写',
  brief: '成片策划',
  audio: '生成音频轨',
  project: '生成工程',
  check: '校验工程',
  render: '渲染视频',
  inspect: '巡检视频',
};

const DEFAULT_STAGES = Object.entries(STAGE_LABELS).map(([id, label]) => ({
  id,
  label,
  status: 'waiting',
}));

const STATUS_TEXT = {
  waiting: '等待中',
  pending: '排队中',
  queued: '排队中',
  running: '进行中',
  done: '已完成',
  failed: '失败',
};

function getStatusClass(status) {
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'queued' || status === 'pending' || status === 'running') return 'pending';
  return '';
}

function getStatusMessageClass(status) {
  if (status === 'creating' || status === 'polling') return 'loading';
  if (status === 'done') return 'success';
  if (status === 'failed') return 'error';
  return 'info';
}

function getWorkflowPayload(json) {
  return json?.data || json?.workflow || json || null;
}

function getWorkflowId(json) {
  const workflow = getWorkflowPayload(json);
  return json?.workflow_id || workflow?.workflow_id || workflow?.id || '';
}

function getErrorMessage(error, fallback) {
  return error?.data?.message || error?.message || fallback;
}

function getTaskTitle(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '未命名创作任务';
  return trimmed.length > 22 ? `${trimmed.slice(0, 22)}...` : trimmed;
}

function getTaskTimeLabel(value) {
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

function loadStoredTasks() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CREATIVE_TASKS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(task => task?.workflow_id).slice(0, 30) : [];
  } catch {
    return [];
  }
}

function saveStoredTasks(tasks) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CREATIVE_TASKS_STORAGE_KEY, JSON.stringify(tasks.slice(0, 30)));
}

function upsertTask(tasks, task) {
  const next = [task, ...tasks.filter(item => item.workflow_id !== task.workflow_id)];
  return next.slice(0, 30);
}

function CreativeTaskSidebar({ tasks, selectedWorkflowId, sidebarCollapsed, onToggleSidebar, onNewTask, onSelectTask }) {
  if (sidebarCollapsed) {
    return (
      <aside className="creativeTaskSidebar collapsed" aria-label="已收起的创作任务栏">
        <button
          className="creativeCollapsedExpand"
          type="button"
          aria-label="展开任务列表"
          aria-pressed="true"
          onClick={onToggleSidebar}
        >
          <PanelLeft size={17} aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="creativeTaskSidebar">
      <div className="creativeSidebarBrand">
        <div className="creativeBrandMark"><Sparkles size={18} /></div>
        <strong>一键创作</strong>
        <div className="creativeSidebarTools">
          <Search size={17} aria-hidden="true" />
          <button
            className="creativeSidebarToggle"
            type="button"
            aria-label="收起任务列表"
            aria-pressed="false"
            onClick={onToggleSidebar}
          >
            <PanelLeft size={17} aria-hidden="true" />
          </button>
        </div>
      </div>

      <button className="creativeNewTaskButton" type="button" onClick={onNewTask}>
        <CirclePlus size={16} />
        <span>开启新创作</span>
      </button>

      <div className="creativeTaskListHeader">创作任务</div>
      <div className="creativeTaskList" aria-label="创作任务列表">
        {tasks.length ? tasks.map(task => (
          <button
            type="button"
            className={`creativeTaskItem ${task.workflow_id === selectedWorkflowId ? 'active' : ''}`}
            key={task.workflow_id}
            onClick={() => onSelectTask(task)}
          >
            <span>{task.title}</span>
            <small>{STATUS_TEXT[task.status] || task.status || '等待中'} · {getTaskTimeLabel(task.updated_at || task.created_at)}</small>
          </button>
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

function CreativeHeroHeader({ mode }) {
  return (
    <div className="creativeHeroHeader">
      <div className="creativeHeroTitle">
        <Sparkles size={30} />
        <h1>使用{mode === 'expert' ? '专家模式' : '快速模式'}开始对话</h1>
      </div>
    </div>
  );
}

function CreativeModeSwitch({ mode, setMode, disabled }) {
  return (
    <div className="creativeModeSwitch" role="tablist" aria-label="创作模式" data-mode={mode}>
      <span className="creativeModeThumb" aria-hidden="true" />
      <button
        type="button"
        className={mode === 'quick' ? 'active' : ''}
        disabled={disabled}
        onClick={() => setMode('quick')}
      >
        <Zap size={15} />
        <span>快速模式</span>
      </button>
      <button
        type="button"
        className={mode === 'expert' ? 'active' : ''}
        disabled={disabled}
        onClick={() => setMode('expert')}
      >
        <Shield size={15} />
        <span>专家模式</span>
      </button>
    </div>
  );
}

function CreativePromptComposer({
  input,
  setInput,
  mode,
  useResearch,
  setUseResearch,
  isBusy,
  submitDisabled,
  onSubmit,
}) {
  return (
    <form className="creativePromptComposer" onSubmit={onSubmit}>
      <label className="creativePromptLabel" htmlFor="creative-input">
        输入视频方向、抖音 ID 或抖音链接
      </label>
      <textarea
        id="creative-input"
        value={input}
        onChange={event => setInput(event.target.value)}
        disabled={isBusy}
        placeholder="给一键创作发送消息"
        rows={4}
      />

      <div className="creativeComposerFooter">
        <div className="creativeQuickActions">
          <button
            type="button"
            className={`creativeResearchToggle ${useResearch ? 'active' : ''}`}
            disabled={isBusy}
            onClick={() => setUseResearch(!useResearch)}
          >
            <Globe2 size={15} />
            <span>联网获取最新资料</span>
          </button>
        </div>

        <button className="creativeSubmitButton" type="submit" disabled={submitDisabled} aria-label="一键生成视频">
          {isBusy ? <Loader2 size={18} className="spinIcon" /> : <ArrowUp size={19} />}
        </button>
      </div>

      {mode === 'expert' ? (
        <div className="creativeExpertSlot">
            <div className="creativeExpertHint">专家模式正在开发中，请先使用快速模式创建任务。</div>
        </div>
      ) : null}
      <input type="hidden" value={mode} readOnly />
    </form>
  );
}

function CreativeInputForm(props) {
  return <CreativePromptComposer {...props} />;
}

function WorkflowStatusPanel({ status, message, workflowId, workflow }) {
  const statusClass = getStatusMessageClass(status);
  const workflowStatus = workflow?.status ? (STATUS_TEXT[workflow.status] || workflow.status) : '等待输入';

  return (
    <section className="creativeDetailCard">
      <div className="creativeDetailCardHeader">
        <h3>当前任务</h3>
        <strong className={`stepBadge ${getStatusClass(workflow?.status)}`}>{workflowStatus}</strong>
      </div>
      <div className={`status ${statusClass}`} aria-live="polite">
        {message || '填写方向或抖音来源后，即可创建视频生成任务。'}
      </div>
      <ul className="agentStatusList">
        <li>
          <span>任务状态</span>
          <strong className={`stepBadge ${getStatusClass(workflow?.status)}`}>{workflowStatus}</strong>
          {workflowId ? <small>任务 ID：{workflowId}</small> : <small>尚未创建创作任务</small>}
        </li>
      </ul>
    </section>
  );
}

function WorkflowStageList({ workflow }) {
  const stages = useMemo(() => {
    const source = Array.isArray(workflow?.stages) && workflow.stages.length ? workflow.stages : DEFAULT_STAGES;
    return source.map(stage => ({
      ...stage,
      label: stage.label || STAGE_LABELS[stage.id] || stage.id || '未命名阶段',
      status: stage.status || 'waiting',
    }));
  }, [workflow]);

  return (
    <section className="creativeDetailCard creativeStagePanel">
      <div className="creativeDetailCardHeader">
        <h3>生成进度</h3>
        <span>任务详情</span>
      </div>
      <div className="agentSteps compact">
        {stages.map(stage => (
          <div className="agentStep" key={stage.id || stage.label}>
            <span>{stage.label}</span>
            <strong className={`stepBadge ${getStatusClass(stage.status)}`}>
              {STATUS_TEXT[stage.status] || stage.status || '等待中'}
            </strong>
            {stage.message ? <small>{stage.message}</small> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function CreativeTaskDetail({ status, message, workflowId, workflow }) {
  if (!workflowId && !workflow) return null;

  return (
    <div className="creativeTaskDetail">
      <WorkflowStatusPanel status={status} message={message} workflowId={workflowId} workflow={workflow} />
      <WorkflowStageList workflow={workflow} />
    </div>
  );
}

export function OneClickCreativePage() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('quick');
  const [useResearch, setUseResearch] = useState(false);
  const [workflow, setWorkflow] = useState(null);
  const [workflowId, setWorkflowId] = useState('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tasks, setTasks] = useState(() => loadStoredTasks());
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const isBusy = status === 'creating' || status === 'polling';
  const submitDisabled = isBusy || mode === 'expert';

  function persistTasks(updater) {
    setTasks(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveStoredTasks(next);
      return next;
    });
  }

  function startNewTask() {
    setInput('');
    setMode('quick');
    setUseResearch(false);
    setWorkflow(null);
    setWorkflowId('');
    setSelectedWorkflowId('');
    setStatus('idle');
    setMessage('');
  }

  function selectTask(task) {
    setWorkflowId(task.workflow_id);
    setSelectedWorkflowId(task.workflow_id);
    setWorkflow(task.workflow || null);
    setStatus(task.status === 'done' ? 'done' : 'polling');
    setMessage(task.message || '正在打开任务详情...');
  }

  async function submitCreativeWorkflow(event) {
    event.preventDefault();
    if (submitDisabled) {
      if (mode === 'expert') {
        setStatus('idle');
        setMessage('专家模式正在开发中，请先使用快速模式创建任务。');
      }
      return;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      setStatus('failed');
      setMessage('请输入视频方向、抖音 ID 或抖音链接');
      return;
    }

    setStatus('creating');
    setMessage('正在创建创作任务...');
    setWorkflow(null);
    setWorkflowId('');

    try {
      const json = await api.createCreativeWorkflow({
        input: trimmed,
        useResearch: mode === 'expert' ? useResearch : false,
        assetIds: [],
        renderOptions: {},
        workflowOptions: {},
      });
      const nextWorkflow = getWorkflowPayload(json);
      const nextWorkflowId = getWorkflowId(json);
      setWorkflow(nextWorkflow);
      if (!nextWorkflowId) {
        setStatus('failed');
        setMessage('创作任务已创建，但未返回任务 ID，请稍后在后端日志中检查。');
        return;
      }

      const task = {
        workflow_id: nextWorkflowId,
        title: getTaskTitle(trimmed),
        input: trimmed,
        status: nextWorkflow?.status || json?.status || 'queued',
        message: json?.message || nextWorkflow?.message || '创作任务已创建，正在生成视频...',
        workflow: nextWorkflow,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      persistTasks(prev => upsertTask(prev, task));
      setWorkflowId(nextWorkflowId);
      setSelectedWorkflowId(nextWorkflowId);
      setStatus('polling');
      setMessage(task.message);
    } catch (error) {
      setStatus('failed');
      setMessage(getErrorMessage(error, '创建创作任务失败，请稍后重试。'));
    }
  }

  useEffect(() => {
    if (status !== 'polling' || !workflowId) return undefined;
    let cancelled = false;

    async function pollWorkflow() {
      try {
        const json = await api.getCreativeWorkflow(workflowId);
        if (cancelled) return;

        const nextWorkflow = getWorkflowPayload(json);
        setWorkflow(nextWorkflow);
        const nextStatus = nextWorkflow?.status || (json?.success === false ? 'failed' : 'running');
        const nextMessage = nextWorkflow?.error?.message
          || nextWorkflow?.message
          || json?.message
          || '创作任务已创建，正在生成视频...';

        persistTasks(prev => upsertTask(prev, {
          workflow_id: workflowId,
          title: prev.find(task => task.workflow_id === workflowId)?.title || getTaskTitle(nextWorkflow?.creative_context?.input?.raw_text),
          status: nextStatus,
          message: nextMessage,
          workflow: nextWorkflow,
          created_at: prev.find(task => task.workflow_id === workflowId)?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

        if (nextWorkflow?.status === 'done') {
          setStatus('done');
          setMessage('视频生成完成。');
          return;
        }

        if (nextWorkflow?.status === 'failed' || json?.success === false) {
          setStatus('failed');
          setMessage(nextMessage || '视频生成失败，请查看任务详情。');
          return;
        }

        setMessage(nextMessage);
      } catch (error) {
        if (!cancelled) {
          setStatus('failed');
          setMessage(getErrorMessage(error, '获取创作任务状态失败，请稍后重试。'));
        }
      }
    }

    pollWorkflow();
    const timer = window.setInterval(pollWorkflow, 1800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status, workflowId]);

  return (
    <main className={`creativeChatShell ${sidebarCollapsed ? 'sidebarCollapsed' : ''}`}>
      <CreativeTaskSidebar
        tasks={tasks}
        selectedWorkflowId={selectedWorkflowId}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(value => !value)}
        onNewTask={startNewTask}
        onSelectTask={selectTask}
      />

      <section className="creativeChatMain">
        <div className={`creativeChatCenter ${selectedWorkflowId ? 'hasDetail' : ''}`}>
          <CreativeHeroHeader mode={mode} />
          <CreativeModeSwitch mode={mode} setMode={setMode} disabled={isBusy} />
          <CreativeInputForm
            input={input}
            setInput={setInput}
            mode={mode}
            useResearch={useResearch}
            setUseResearch={setUseResearch}
            isBusy={isBusy}
            submitDisabled={submitDisabled}
            onSubmit={submitCreativeWorkflow}
          />
          <CreativeTaskDetail status={status} message={message} workflowId={selectedWorkflowId} workflow={workflow} />
        </div>
      </section>
    </main>
  );
}
