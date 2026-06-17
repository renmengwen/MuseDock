import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  Trash2,
  Zap,
} from 'lucide-react';
import { api } from '../api/client.js';
import { CreativeVideoEditor } from '../components/creative-video-editor/CreativeVideoEditor.jsx';

const CREATIVE_TASKS_STORAGE_KEY = 'musedock.creative.tasks.v1';
const ACTIVE_CREATIVE_TASK_STORAGE_KEY = 'musedock.creative.activeTask.v1';

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
  skipped: '已跳过',
  failed: '失败',
};

function getStatusClass(status) {
  if (status === 'done' || status === 'skipped') return 'done';
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

function getWorkflowStatusText(workflow, fallbackStatus = 'idle') {
  const nextStatus = workflow?.status || fallbackStatus;
  if (!workflow && fallbackStatus === 'idle') return '等待输入';
  return STATUS_TEXT[nextStatus] || nextStatus || '等待中';
}

function getWorkflowDisplayMessage(workflow, fallback = '') {
  const stages = Array.isArray(workflow?.stages) ? workflow.stages : [];
  const failedStage = stages.find(stage => stage.status === 'failed');
  if (failedStage?.message) return failedStage.message;

  const activeStage = stages.find(stage => ['running', 'queued', 'pending'].includes(stage.status));
  if (activeStage?.message) return activeStage.message;

  return workflow?.error?.message
    || workflow?.message
    || fallback
    || '创作任务已创建，正在生成视频...';
}

function getWorkflowVideoUrl(workflow) {
  const renderResult = workflow?.stages?.find(stage => stage.id === 'render')?.result;
  const candidates = [
    workflow?.result?.video?.output_url,
    workflow?.result?.render?.output_url,
    workflow?.result?.hyperframes_freeform?.render?.output_url,
    workflow?.render?.output_url,
    workflow?.hyperframes_freeform?.render?.output_url,
    renderResult?.video?.output_url,
    renderResult?.render?.output_url,
    renderResult?.hyperframes_freeform?.render?.output_url,
    renderResult?.output_url,
  ];
  const directUrl = candidates.find(value => typeof value === 'string' && value.trim());
  if (directUrl) return directUrl;
  if (workflow?.aweme_id && workflow?.run_id) {
    return [
      '/api/agents/douyin',
      encodeURIComponent(String(workflow.aweme_id)),
      'runs',
      encodeURIComponent(String(workflow.run_id)),
      'hyperframes-freeform/files',
      'output.mp4',
    ].join('/');
  }
  return '';
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

function saveActiveCreativeTask(value) {
  if (typeof window === 'undefined') return;
  if (!value?.workflow_id || !value?.task_id) {
    window.localStorage.removeItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY, JSON.stringify({
    workflow_id: value.workflow_id,
    task_id: value.task_id,
    last_seq: Number(value.last_seq || 0),
    updated_at: new Date().toISOString(),
  }));
}

function loadActiveCreativeTask() {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY) || 'null');
    return parsed?.workflow_id && parsed?.task_id ? parsed : null;
  } catch {
    return null;
  }
}

function upsertTask(tasks, task) {
  const next = [task, ...tasks.filter(item => item.workflow_id !== task.workflow_id)];
  return next.slice(0, 30);
}

function CreativeTaskSidebar({ tasks, selectedWorkflowId, sidebarCollapsed, onToggleSidebar, onNewTask, onSelectTask, onDeleteTask }) {
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
          <div
            className={`creativeTaskItem ${task.workflow_id === selectedWorkflowId ? 'active' : ''}`}
            key={task.workflow_id}
            role="button"
            tabIndex={0}
            onClick={() => onSelectTask(task)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onSelectTask(task); }}
          >
            <div className="creativeTaskItemContent">
              <span>{task.title}</span>
              <small>{STATUS_TEXT[task.status] || task.status || '等待中'} · {getTaskTimeLabel(task.updated_at || task.created_at)}</small>
            </div>
            <button
              type="button"
              className="creativeTaskDeleteButton"
              aria-label={`删除任务 ${task.title}`}
              title="删除任务"
              onClick={event => { event.stopPropagation(); onDeleteTask(task); }}
            >
              <Trash2 size={14} />
            </button>
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

function CreativeHeroHeader({ mode }) {
  return (
    <div className="creativeHeroHeader">
      <div className="creativeHeroTitle">
        <Sparkles size={30} />
        <h1>嘿，今天我们来做点什么？</h1>
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
        placeholder="在这里输入你的创意"
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

function getStepState(stage, index, stages) {
  if (stage.status === 'done') return 'done';
  if (stage.status === 'skipped') return 'done';
  if (stage.status === 'failed') return 'failed';
  if (stage.status === 'running' || stage.status === 'queued' || stage.status === 'pending') return 'active';
  const hasActiveBefore = stages.slice(0, index).some(item => (
    item.status === 'running'
    || item.status === 'queued'
    || item.status === 'pending'
    || item.status === 'failed'
  ));
  return hasActiveBefore ? 'waiting' : '';
}

function WorkflowStepProgress({ workflow }) {
  const stages = useMemo(() => {
    const source = Array.isArray(workflow?.stages) && workflow.stages.length ? workflow.stages : DEFAULT_STAGES;
    return source.map(stage => ({
      ...stage,
      label: stage.label || STAGE_LABELS[stage.id] || stage.id || '未命名阶段',
      status: stage.status || 'waiting',
    }));
  }, [workflow]);

  return (
    <div className="creativeWorkflowStepper" aria-label="生成进度">
      {stages.map((stage, index) => {
        const stepState = getStepState(stage, index, stages);
        return (
          <div className={`creativeWorkflowStep ${stepState}`} key={stage.id || stage.label}>
            {index > 0 ? <span className="creativeWorkflowStepConnector" aria-hidden="true" /> : null}
            <span className="creativeWorkflowStepDot">{index + 1}</span>
            <span className="creativeWorkflowStepLabel">{stage.label}</span>
            <small>{STATUS_TEXT[stage.status] || stage.status || '等待中'}</small>
          </div>
        );
      })}
    </div>
  );
}

function CreativeVideoPreview({ videoUrl }) {
  return (
    <section className="creativeVideoStage" aria-label="生成视频预览">
      <video className="creativeResultVideo" src={videoUrl} controls playsInline preload="metadata">
        当前浏览器不支持直接播放视频。
      </video>
    </section>
  );
}

function CreativeTaskDetail({ status, message, workflowId, workflow, deletingWorkflowId, onStopAndDelete }) {
  const [editorOpen, setEditorOpen] = useState(false);
  if (!workflowId && !workflow) return null;
  const videoUrl = getWorkflowVideoUrl(workflow);
  const canStopAndDelete = workflowId && workflow?.status !== 'done';

  return (
    <div className={`creativeTaskDetail ${workflow?.status === 'done' && videoUrl ? 'hasVideo' : ''}`}>
      <div className="creativeDetailMeta">
        <div>
          <span>任务 ID</span>
          <strong>{workflowId || '尚未创建'}</strong>
        </div>
        <strong className={`stepBadge ${getStatusClass(workflow?.status)}`}>
          {getWorkflowStatusText(workflow, status)}
        </strong>
        {canStopAndDelete ? (
          <button
            className="creativeStopDeleteButton"
            type="button"
            disabled={deletingWorkflowId === workflowId}
            onClick={() => onStopAndDelete(workflowId)}
          >
            {deletingWorkflowId === workflowId ? <Loader2 size={14} className="spinIcon" /> : <Trash2 size={14} />}
            <span>{deletingWorkflowId === workflowId ? '正在删除' : '停止并删除'}</span>
          </button>
        ) : null}
      </div>
      <WorkflowStepProgress workflow={workflow} />
      {workflow?.status === 'done' && videoUrl ? (
        <>
          <CreativeVideoPreview videoUrl={videoUrl} />
          <button className="editorToggle" onClick={() => setEditorOpen(!editorOpen)}>
            {editorOpen ? '关闭编辑器' : '编辑成片'}
          </button>
          {editorOpen && <CreativeVideoEditor workflowId={workflowId} api={api} onRendered={() => setEditorOpen(false)} />}
        </>
      ) : (
        <div className={`creativeDetailMessage ${getStatusMessageClass(status)}`} aria-live="polite">
          {message || '创作任务已打开，正在获取最新进度...'}
        </div>
      )}
    </div>
  );
}

export function OneClickCreativePage() {
  const navigate = useNavigate();
  const params = useParams();
  const routeWorkflowId = params.workflowId || '';
  const isDetailRoute = Boolean(routeWorkflowId);
  const activeStreamRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const lastSeqRef = useRef(0);
  const activeTaskRef = useRef(null);
  const streamClosedNormallyRef = useRef(false);
  const streamGenerationRef = useRef(0);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('quick');
  const [useResearch, setUseResearch] = useState(true);
  const [workflow, setWorkflow] = useState(null);
  const [workflowId, setWorkflowId] = useState('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tasks, setTasks] = useState(() => loadStoredTasks());
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [deletingWorkflowId, setDeletingWorkflowId] = useState('');
  const [, setActiveTask] = useState(null);
  const isBusy = status === 'creating' || status === 'polling' || status === 'deleting';
  const submitDisabled = isBusy || mode === 'expert' || !input.trim();

  function persistTasks(updater) {
    setTasks(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveStoredTasks(next);
      return next;
    });
  }

  function stopTaskStream({ clearStorage = false } = {}) {
    streamGenerationRef.current += 1;
    streamClosedNormallyRef.current = true;
    if (activeStreamRef.current) activeStreamRef.current.abort();
    window.clearTimeout(reconnectTimerRef.current);
    activeStreamRef.current = null;
    activeTaskRef.current = null;
    setActiveTask(null);
    if (clearStorage) {
      lastSeqRef.current = 0;
      saveActiveCreativeTask(null);
    }
  }

  function applyTaskEvent(event) {
    const expectedWorkflowId = activeTaskRef.current?.workflow_id || workflowId;
    const expectedTaskId = activeTaskRef.current?.task_id;
    if (!event || (expectedWorkflowId && event.workflow_id !== expectedWorkflowId)) return;
    if (event.task_id && expectedTaskId && event.task_id !== expectedTaskId) return;
    const currentWorkflowId = routeWorkflowId || workflowId || selectedWorkflowId;
    if (currentWorkflowId && event.workflow_id !== currentWorkflowId) return;
    if (Number(event.seq) > 0) {
      lastSeqRef.current = Number(event.seq);
      saveActiveCreativeTask({ workflow_id: event.workflow_id, task_id: event.task_id, last_seq: lastSeqRef.current });
    }
    if (event.message) setMessage(event.message);
    if (event.type === 'stage_progress' || event.type?.startsWith('html_video_')) {
      setStatus('polling');
    }
    if (event.type === 'task_failed') {
      setStatus('failed');
      setMessage(event.message || '创作任务失败。');
    }
    if (event.type === 'task_done') {
      setStatus('done');
      setMessage(event.message || '创作任务已完成。');
    }
    if (event.type === 'task_stream_closed') {
      stopTaskStream({ clearStorage: true });
      if (event.status === 'done') setStatus('done');
      if (event.status === 'failed') setStatus('failed');
      if (event.status === 'deleted') setStatus('idle');
    }
  }

  function subscribeTaskEvents(nextTask, { sinceSeq } = {}) {
    if (!nextTask?.workflow_id || !nextTask?.task_id || !api?.streamCreativeWorkflowEvents) return;
    const isSameTask = activeTaskRef.current?.workflow_id === nextTask.workflow_id
      && activeTaskRef.current?.task_id === nextTask.task_id;
    if (isSameTask && activeStreamRef.current) return;
    const isDifferentTask = !isSameTask;
    if (isDifferentTask) {
      stopTaskStream();
      lastSeqRef.current = Number(sinceSeq ?? 0);
    } else if (sinceSeq !== undefined) {
      lastSeqRef.current = Number(sinceSeq || 0);
    }
    window.clearTimeout(reconnectTimerRef.current);
    streamClosedNormallyRef.current = false;
    activeTaskRef.current = nextTask;
    setActiveTask(nextTask);
    saveActiveCreativeTask({ ...nextTask, last_seq: lastSeqRef.current });
    streamGenerationRef.current += 1;
    const streamGeneration = streamGenerationRef.current;
    activeStreamRef.current = api.streamCreativeWorkflowEvents(nextTask.workflow_id, {
      task_id: nextTask.task_id,
      since_seq: lastSeqRef.current,
    }, {
      onEvent: event => {
        if (streamGenerationRef.current !== streamGeneration) return;
        applyTaskEvent(event);
      },
      onClose: () => {
        if (streamGenerationRef.current !== streamGeneration) return;
        activeStreamRef.current = null;
      },
      onError: () => {
        if (streamGenerationRef.current !== streamGeneration) return;
        activeStreamRef.current = null;
        if (streamClosedNormallyRef.current) return;
        reconnectTimerRef.current = window.setTimeout(() => {
          if (streamGenerationRef.current !== streamGeneration) return;
          subscribeTaskEvents(nextTask);
        }, 1500);
      },
    });
  }

  function startNewTask() {
    navigate('/creative');
    stopTaskStream({ clearStorage: true });
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
    if (activeTaskRef.current?.workflow_id && activeTaskRef.current.workflow_id !== task.workflow_id) {
      stopTaskStream({ clearStorage: true });
    }
    navigate(`/creative/${encodeURIComponent(task.workflow_id)}`);
    setWorkflowId(task.workflow_id);
    setSelectedWorkflowId(task.workflow_id);
    setWorkflow(task.workflow || null);
    setStatus(task.status === 'done' ? 'done' : 'polling');
    setMessage(task.message || '正在打开任务详情...');
  }

  async function deleteTask(task) {
    const confirmed = window.confirm(`确定删除任务「${task.title}」吗？此操作不可恢复。`);
    if (!confirmed) return;

    setDeletingWorkflowId(task.workflow_id);
    try {
      await api.deleteCreativeWorkflow(task.workflow_id);
    } catch {
      // 即使后端删除失败也继续清理前端状态
    } finally {
      setDeletingWorkflowId('');
    }

    persistTasks(prev => prev.filter(item => item.workflow_id !== task.workflow_id));

    if (selectedWorkflowId === task.workflow_id) {
      startNewTask();
    }
  }

  async function stopAndDeleteTask(targetWorkflowId) {
    const id = String(targetWorkflowId || '').trim();
    if (!id || deletingWorkflowId) return;

    const confirmed = window.confirm('确定停止并删除当前任务吗？任务记录和已生成资源都会被删除，此操作不可恢复。');
    if (!confirmed) return;

    setDeletingWorkflowId(id);
    setStatus('deleting');
    setMessage('正在停止并删除任务...');
    try {
      await api.deleteCreativeWorkflow(id);
    } catch {
      // 删除中的任务可能已经被后台清理，前端仍按停止删除完成处理。
    } finally {
      setDeletingWorkflowId('');
    }

    persistTasks(prev => prev.filter(item => item.workflow_id !== id));
    if (selectedWorkflowId === id || workflowId === id) {
      startNewTask();
    }
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
        useResearch: useResearch,
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
      navigate(`/creative/${encodeURIComponent(nextWorkflowId)}`);
      if (json.task_id) {
        const nextTask = { workflow_id: nextWorkflowId, task_id: json.task_id };
        saveActiveCreativeTask({ ...nextTask, last_seq: 0 });
        subscribeTaskEvents(nextTask, { sinceSeq: 0 });
      }
    } catch (error) {
      setStatus('failed');
      setMessage(getErrorMessage(error, '创建创作任务失败，请稍后重试。'));
    }
  }

  useEffect(() => {
    if (!routeWorkflowId) {
      setSelectedWorkflowId('');
      if (workflowId && status !== 'creating') {
        stopTaskStream({ clearStorage: true });
        setWorkflowId('');
        setWorkflow(null);
        setStatus('idle');
        setMessage('');
      } else if (!workflowId && !selectedWorkflowId) {
        stopTaskStream({ clearStorage: true });
      }
      return;
    }

    if (activeTaskRef.current?.workflow_id && activeTaskRef.current.workflow_id !== routeWorkflowId) {
      stopTaskStream({ clearStorage: true });
    }

    if (routeWorkflowId === selectedWorkflowId) return;

    const storedTask = tasks.find(task => task.workflow_id === routeWorkflowId);
    if (storedTask) {
      setWorkflowId(storedTask.workflow_id);
      setSelectedWorkflowId(storedTask.workflow_id);
      setWorkflow(storedTask.workflow || null);
      setStatus(storedTask.status === 'done' ? 'done' : 'polling');
      setMessage(storedTask.message || '正在打开任务详情...');
      return;
    }

    setWorkflowId(routeWorkflowId);
    setSelectedWorkflowId(routeWorkflowId);
    setWorkflow(null);
    setStatus('polling');
    setMessage('正在打开任务详情...');
  }, [routeWorkflowId, selectedWorkflowId, tasks, workflowId, status]);

  useEffect(() => {
    const stored = loadActiveCreativeTask();
    if (!stored?.workflow_id || !stored?.task_id) return undefined;
    const currentWorkflowId = routeWorkflowId || workflowId || selectedWorkflowId;
    if (!currentWorkflowId) return undefined;
    if (currentWorkflowId !== stored.workflow_id) {
      stopTaskStream({ clearStorage: true });
      return undefined;
    }
    subscribeTaskEvents(
      { workflow_id: stored.workflow_id, task_id: stored.task_id },
      { sinceSeq: Number(stored.last_seq || 0) },
    );
    return undefined;
  }, [workflowId, routeWorkflowId, selectedWorkflowId]);

  useEffect(() => {
    if (status !== 'polling' || !workflowId) return undefined;
    let cancelled = false;

    async function pollWorkflow() {
      try {
        const json = await api.getCreativeWorkflow(workflowId);
        if (cancelled) return;

        const nextWorkflow = getWorkflowPayload(json);
        setWorkflow(nextWorkflow);
        if (nextWorkflow?.active_task?.task_id && nextWorkflow.workflow_id) {
          const nextTask = { workflow_id: nextWorkflow.workflow_id, task_id: nextWorkflow.active_task.task_id };
          const isCurrentWorkflowTask = nextTask.workflow_id === workflowId;
          const isNewTask = activeTaskRef.current?.workflow_id !== nextTask.workflow_id
            || activeTaskRef.current?.task_id !== nextTask.task_id;
          if (isCurrentWorkflowTask && isNewTask) subscribeTaskEvents(nextTask, { sinceSeq: 0 });
        }
        const nextStatus = nextWorkflow?.status || (json?.success === false ? 'failed' : 'running');
        const nextMessage = getWorkflowDisplayMessage(nextWorkflow, json?.message);

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

  useEffect(() => () => {
    stopTaskStream();
  }, []);

  return (
    <main className={`creativeChatShell ${sidebarCollapsed ? 'sidebarCollapsed' : ''}`}>
      <CreativeTaskSidebar
        tasks={tasks}
        selectedWorkflowId={selectedWorkflowId}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(value => !value)}
        onNewTask={startNewTask}
        onSelectTask={selectTask}
        onDeleteTask={deleteTask}
      />

      <section className="creativeChatMain">
        <div className={`creativeChatCenter ${selectedWorkflowId ? 'hasDetail' : ''}`}>
          {!isDetailRoute && (
            <>
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
            </>
          )}
          <CreativeTaskDetail
            status={status}
            message={message}
            workflowId={selectedWorkflowId}
            workflow={workflow}
            deletingWorkflowId={deletingWorkflowId}
            onStopAndDelete={stopAndDeleteTask}
          />
        </div>
      </section>
    </main>
  );
}
