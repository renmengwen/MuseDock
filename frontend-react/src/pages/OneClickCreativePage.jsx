import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowUp,
  CirclePlus,
  Eye,
  FileText,
  Globe2,
  Loader2,
  PanelLeft,
  Search,
  Shield,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../api/client.js';
import {
  STATUS_TEXT,
  getStatusClass,
  getStatusMessageClass,
  getStepState,
  getWorkflowStatusText,
  normalizeWorkflowStages,
} from '../components/creative/creativeDisplay.js';

const CREATIVE_TASKS_STORAGE_KEY = 'musedock.creative.tasks.v1';
const ACTIVE_CREATIVE_TASK_STORAGE_KEY = 'musedock.creative.activeTask.v1';

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

function normalizeLastSeq(value) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue) || nextValue < 0) return 0;
  return Math.floor(nextValue);
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
    last_seq: normalizeLastSeq(value.last_seq),
    updated_at: new Date().toISOString(),
  }));
}

function loadActiveCreativeTask() {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY) || 'null');
    if (!parsed?.workflow_id || !parsed?.task_id) {
      window.localStorage.removeItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY);
      return null;
    }
    return {
      workflow_id: parsed.workflow_id,
      task_id: parsed.task_id,
      last_seq: normalizeLastSeq(parsed.last_seq),
    };
  } catch {
    window.localStorage.removeItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY);
    return null;
  }
}

function upsertTask(tasks, task) {
  const next = [task, ...tasks.filter(item => item.workflow_id !== task.workflow_id)];
  return next.slice(0, 30);
}

function updateTask(tasks, task) {
  if (!tasks.some(item => item.workflow_id === task.workflow_id)) {
    return upsertTask(tasks, task);
  }
  return tasks.map(item => item.workflow_id === task.workflow_id ? { ...item, ...task } : item);
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
        输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接
      </label>
      <textarea
        id="creative-input"
        value={input}
        onChange={event => setInput(event.target.value)}
        disabled={isBusy}
        placeholder="粘贴文章/GitHub 链接，或输入你想生成的视频方向"
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
        {message || '填写方向、抖音来源或外部资料链接后，即可创建视频生成任务。'}
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

function WorkflowStepProgress({ workflow }) {
  const stages = useMemo(() => normalizeWorkflowStages(workflow), [workflow]);

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

function CreativeVideoPreview({ videoUrl, onEdit, disabled, title }) {
  return (
    <section className="creativeVideoStage" aria-label="生成视频预览">
      <video className="creativeResultVideo" src={videoUrl} controls playsInline preload="metadata">
        当前浏览器不支持直接播放视频。
      </video>
      <button className="editorToggle" type="button" onClick={onEdit} disabled={disabled} title={title}>
        继续编辑
      </button>
    </section>
  );
}

function CreativeTaskDetail({ status, message, workflowId, workflow, deletingWorkflowId, onStopAndDelete, onContinueEdit }) {
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  if (!workflowId && !workflow) return null;
  const videoUrl = getWorkflowVideoUrl(workflow);
  const canStopAndDelete = workflowId && workflow?.status !== 'done';
  const promptText = workflow?.creative_context?.input?.raw_text?.trim() || '';
  const editableWorkflowId = workflowId || workflow?.workflow_id || workflow?.id || '';

  function continueEdit() {
    onContinueEdit?.(editableWorkflowId);
  }

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
        <div className="creativeTaskActions">
          <button
            className="creativePromptViewButton"
            type="button"
            onClick={() => setPromptModalOpen(true)}
          >
            <Eye size={14} />
            <span>查看提示词</span>
          </button>
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
      </div>
      {promptModalOpen ? (
        <div className="creativePromptModalOverlay" role="presentation" onClick={() => setPromptModalOpen(false)}>
          <div
            className="creativePromptModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="creative-prompt-modal-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="creativePromptModalHeader">
              <h3 id="creative-prompt-modal-title">当前任务提示词</h3>
              <button
                className="creativePromptModalClose"
                type="button"
                aria-label="关闭提示词弹框"
                onClick={() => setPromptModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <pre className="creativePromptModalText">{promptText || '暂无可显示的提示词。'}</pre>
          </div>
        </div>
      ) : null}
      <WorkflowStepProgress workflow={workflow} />
      {workflow?.status === 'done' && videoUrl ? (
        <>
          <CreativeVideoPreview
            videoUrl={videoUrl}
            onEdit={continueEdit}
            disabled={!editableWorkflowId}
            title={editableWorkflowId ? '继续编辑视频' : '缺少创作任务 ID，无法进入编辑器。'}
          />
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
  const currentWorkflowRef = useRef({ routeWorkflowId: '', workflowId: '', selectedWorkflowId: '' });
  const finalWorkflowRefreshRef = useRef(null);
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
  // activeTaskRef holds the value; this state only forces stream connect/stop rerenders.
  const [, setActiveTask] = useState(null);
  const isBusy = status === 'creating' || status === 'polling' || status === 'deleting';
  const submitDisabled = isBusy || mode === 'expert' || !input.trim();

  const persistTasks = useCallback((updater) => {
    setTasks(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveStoredTasks(next);
      return next;
    });
  }, []);

  const stopTaskStream = useCallback(({ clearStorage = false } = {}) => {
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
  }, []);

  const fetchFinalWorkflow = useCallback(async ({
    workflowId: nextWorkflowId,
    taskId: expectedTaskId = '',
    generation: expectedGeneration,
    closedGeneration = null,
    closedByStream = false,
    status: terminalStatus = 'done',
    message: terminalMessage = '',
  } = {}) => {
    const targetWorkflowId = String(nextWorkflowId || '').trim();
    if (!targetWorkflowId || terminalStatus === 'deleted') return;
    const expectedWorkflowId = targetWorkflowId;
    const refreshKey = `${targetWorkflowId}:${expectedTaskId || ''}`;
    const closedGenerationNumber = Number(closedGeneration);
    const hasClosedGeneration = closedGeneration !== null
      && closedGeneration !== undefined
      && Number.isFinite(Number(closedGeneration));
    const terminalGeneration = hasClosedGeneration
      ? closedGenerationNumber
      : (closedByStream ? expectedGeneration : null);
    if (finalWorkflowRefreshRef.current?.key === refreshKey
      && (finalWorkflowRefreshRef.current.inFlight || finalWorkflowRefreshRef.current.settled)) {
      if (closedByStream) {
        finalWorkflowRefreshRef.current = {
          ...finalWorkflowRefreshRef.current,
          closedByStream: true,
          closedGeneration: terminalGeneration,
        };
      }
      return;
    }
    finalWorkflowRefreshRef.current = {
      key: refreshKey,
      workflowId: expectedWorkflowId,
      taskId: expectedTaskId,
      generation: expectedGeneration,
      closedGeneration: closedByStream ? terminalGeneration : null,
      closedByStream,
      terminalStatus,
      inFlight: false,
      settled: false,
    };

    const isStaleFinalFetch = () => {
      if (finalWorkflowRefreshRef.current?.key !== refreshKey) return true;
      const refreshToken = finalWorkflowRefreshRef.current;
      if (refreshToken.workflowId !== targetWorkflowId) return true;
      if (expectedTaskId && refreshToken.taskId !== expectedTaskId) return true;
      const isAllowedClosedGeneration = Boolean(
        refreshToken.closedByStream
        && refreshToken.closedGeneration === streamGenerationRef.current
        && refreshToken.workflowId === targetWorkflowId
        && (!expectedTaskId || refreshToken.taskId === expectedTaskId),
      );
      const activeWorkflowMatches = activeTaskRef.current?.workflow_id === targetWorkflowId;
      const activeTaskMatches = !expectedTaskId || activeTaskRef.current?.task_id === expectedTaskId;
      const isSameActiveTaskGeneration = activeWorkflowMatches && activeTaskMatches;
      if (streamGenerationRef.current !== expectedGeneration && !(isAllowedClosedGeneration || isSameActiveTaskGeneration)) return true;
      if (activeTaskRef.current?.workflow_id && activeTaskRef.current?.workflow_id !== targetWorkflowId) return true;
      if (expectedTaskId && activeTaskRef.current?.task_id && activeTaskRef.current?.task_id !== expectedTaskId) return true;
      const currentWorkflowId = currentWorkflowRef.current.routeWorkflowId
        || currentWorkflowRef.current.workflowId
        || currentWorkflowRef.current.selectedWorkflowId;
      if (!currentWorkflowId) return !isAllowedClosedGeneration;
      return currentWorkflowId !== targetWorkflowId;
    };

    const fallbackMessage = terminalMessage
      || (terminalStatus === 'failed' ? '视频生成失败，请查看任务详情。' : '视频生成完成。');
    try {
      if (isStaleFinalFetch()) {
        if (finalWorkflowRefreshRef.current?.key === refreshKey) {
          finalWorkflowRefreshRef.current = {
            ...finalWorkflowRefreshRef.current,
            inFlight: false,
          };
        }
        return;
      }
      if (finalWorkflowRefreshRef.current?.key === refreshKey) {
        finalWorkflowRefreshRef.current = {
          ...finalWorkflowRefreshRef.current,
          inFlight: true,
        };
      }
      const json = await api.getCreativeWorkflow(targetWorkflowId);
      if (isStaleFinalFetch()) {
        if (finalWorkflowRefreshRef.current?.key === refreshKey) {
          finalWorkflowRefreshRef.current = {
            ...finalWorkflowRefreshRef.current,
            inFlight: false,
          };
        }
        return;
      }

      const nextWorkflow = getWorkflowPayload(json);
      const nextStatus = nextWorkflow?.status || (json?.success === false ? 'failed' : terminalStatus);
      const nextMessage = getWorkflowDisplayMessage(nextWorkflow, json?.message || fallbackMessage);
      setWorkflow(nextWorkflow);
      persistTasks(prev => updateTask(prev, {
        workflow_id: targetWorkflowId,
        title: prev.find(task => task.workflow_id === targetWorkflowId)?.title || getTaskTitle(nextWorkflow?.creative_context?.input?.raw_text),
        input: prev.find(task => task.workflow_id === targetWorkflowId)?.input || nextWorkflow?.creative_context?.input?.raw_text || '',
        status: nextStatus,
        message: nextMessage,
        workflow: nextWorkflow,
        created_at: prev.find(task => task.workflow_id === targetWorkflowId)?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      if (finalWorkflowRefreshRef.current?.key === refreshKey) {
        finalWorkflowRefreshRef.current = {
          ...finalWorkflowRefreshRef.current,
          inFlight: false,
          settled: true,
        };
      }

      if (nextStatus === 'failed' || terminalStatus === 'failed') {
        setStatus('failed');
        setMessage(nextMessage || '视频生成失败，请查看任务详情。');
        return;
      }
      if (nextStatus === 'done' || terminalStatus === 'done') {
        setStatus('done');
        setMessage(nextMessage || '视频生成完成。');
        return;
      }
      setMessage(nextMessage);
    } catch {
      if (isStaleFinalFetch()) {
        if (finalWorkflowRefreshRef.current?.key === refreshKey) {
          finalWorkflowRefreshRef.current = {
            ...finalWorkflowRefreshRef.current,
            inFlight: false,
          };
        }
        return;
      }
      if (finalWorkflowRefreshRef.current?.key === refreshKey) {
        finalWorkflowRefreshRef.current = {
          ...finalWorkflowRefreshRef.current,
          inFlight: false,
          settled: true,
        };
      }
      setStatus(terminalStatus === 'failed' ? 'failed' : 'done');
      setMessage('终态详情暂时未刷新，请稍后重新打开任务。');
    }
  }, [persistTasks]);

  const applyTaskEvent = useCallback((event) => {
    if (!event) return;
    const currentWorkflowId = currentWorkflowRef.current.routeWorkflowId
      || currentWorkflowRef.current.workflowId
      || currentWorkflowRef.current.selectedWorkflowId;
    const expectedWorkflowId = activeTaskRef.current?.workflow_id || currentWorkflowId;
    const expectedTaskId = activeTaskRef.current?.task_id;
    if (expectedWorkflowId && event.workflow_id !== expectedWorkflowId) return;
    if (event.task_id && expectedTaskId && event.task_id !== expectedTaskId) return;
    if (currentWorkflowId && event.workflow_id !== currentWorkflowId) return;
    if (!currentWorkflowId && activeTaskRef.current?.workflow_id !== event.workflow_id) return;
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
      fetchFinalWorkflow({
        workflowId: event.workflow_id,
        taskId: event.task_id,
        generation: streamGenerationRef.current,
        status: 'failed',
        message: event.message,
      });
    }
    if (event.type === 'task_done') {
      setStatus('done');
      setMessage(event.message || '创作任务已完成。');
      fetchFinalWorkflow({
        workflowId: event.workflow_id,
        taskId: event.task_id,
        generation: streamGenerationRef.current,
        status: 'done',
        message: event.message,
      });
    }
    if (event.type === 'task_stream_closed') {
      const terminalGeneration = streamGenerationRef.current + 1;
      stopTaskStream({ clearStorage: true });
      if (event.status === 'done') {
        setStatus('done');
        setMessage(event.message || '创作任务已完成。');
        fetchFinalWorkflow({
          workflowId: event.workflow_id,
          taskId: event.task_id,
          generation: terminalGeneration,
          closedGeneration: terminalGeneration,
          closedByStream: true,
          status: event.status,
          message: event.message,
        });
      }
      if (event.status === 'failed') {
        setStatus('failed');
        setMessage(event.message || '创作任务失败。');
        fetchFinalWorkflow({
          workflowId: event.workflow_id,
          taskId: event.task_id,
          generation: terminalGeneration,
          closedGeneration: terminalGeneration,
          closedByStream: true,
          status: event.status,
          message: event.message,
        });
      }
      if (event.status === 'deleted') {
        finalWorkflowRefreshRef.current = null;
        persistTasks(prev => prev.filter(item => item.workflow_id !== event.workflow_id));
        setWorkflow(null);
        setWorkflowId('');
        setSelectedWorkflowId('');
        setStatus('idle');
        setMessage('任务已删除。');
        navigate('/creative');
      }
    }
  }, [fetchFinalWorkflow, navigate, persistTasks, stopTaskStream]);

  useEffect(() => {
    currentWorkflowRef.current = { routeWorkflowId, workflowId, selectedWorkflowId };
  }, [routeWorkflowId, workflowId, selectedWorkflowId]);

  const subscribeTaskEvents = useCallback((nextTask, { sinceSeq } = {}) => {
    if (!nextTask?.workflow_id || !nextTask?.task_id || !api?.streamCreativeWorkflowEvents) return;
    const isSameTask = activeTaskRef.current?.workflow_id === nextTask.workflow_id
      && activeTaskRef.current?.task_id === nextTask.task_id;
    if (isSameTask && activeStreamRef.current) return;
    const isDifferentTask = !isSameTask;
    if (isDifferentTask) {
      stopTaskStream();
      finalWorkflowRefreshRef.current = null;
      lastSeqRef.current = normalizeLastSeq(sinceSeq);
    } else if (sinceSeq !== undefined) {
      lastSeqRef.current = normalizeLastSeq(sinceSeq);
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
        if (streamClosedNormallyRef.current) return;
        reconnectTimerRef.current = window.setTimeout(() => {
          if (streamGenerationRef.current !== streamGeneration) return;
          subscribeTaskEvents(nextTask);
        }, 1500);
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
  }, [applyTaskEvent, stopTaskStream]);

  function startNewTask() {
    finalWorkflowRefreshRef.current = null;
    navigate('/creative');
    stopTaskStream({ clearStorage: true });
    setInput('');
    setMode('quick');
    setUseResearch(true);
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
    if (selectedWorkflowId && selectedWorkflowId !== task.workflow_id) {
      finalWorkflowRefreshRef.current = null;
    }
    navigate(`/creative/${encodeURIComponent(task.workflow_id)}`);
    setWorkflowId(task.workflow_id);
    setSelectedWorkflowId(task.workflow_id);
    setWorkflow(task.workflow || null);
    setStatus(task.status === 'done' ? 'done' : 'polling');
    setMessage(task.message || '正在打开任务详情...');
  }

  function continueEdit(targetWorkflowId) {
    const id = String(targetWorkflowId || '').trim();
    if (!id) return;
    navigate(`/editor/${encodeURIComponent(id)}`);
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
      setMessage('请输入视频方向、抖音链接、文章链接或 GitHub 仓库链接');
      return;
    }

    setStatus('creating');
    setMessage('正在创建创作任务...');
    setWorkflow(null);
    setWorkflowId('');
    finalWorkflowRefreshRef.current = null;

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
      finalWorkflowRefreshRef.current = null;
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
  }, [routeWorkflowId, selectedWorkflowId, tasks, workflowId, status, stopTaskStream]);

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
      { sinceSeq: normalizeLastSeq(stored.last_seq) },
    );
    return undefined;
  }, [workflowId, routeWorkflowId, selectedWorkflowId, stopTaskStream, subscribeTaskEvents]);

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

        persistTasks(prev => updateTask(prev, {
          workflow_id: workflowId,
          title: prev.find(task => task.workflow_id === workflowId)?.title || getTaskTitle(nextWorkflow?.creative_context?.input?.raw_text),
          status: nextStatus,
          message: nextMessage,
          workflow: nextWorkflow,
          created_at: prev.find(task => task.workflow_id === workflowId)?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

        if (nextWorkflow?.status === 'done') {
          if (activeTaskRef.current?.workflow_id === workflowId) {
            stopTaskStream({ clearStorage: true });
          }
          setStatus('done');
          setMessage('视频生成完成。');
          return;
        }

        if (nextWorkflow?.status === 'failed' || json?.success === false) {
          if (activeTaskRef.current?.workflow_id === workflowId) {
            stopTaskStream({ clearStorage: true });
          }
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
  }, [status, workflowId, persistTasks, stopTaskStream, subscribeTaskEvents]);

  useEffect(() => () => {
    stopTaskStream();
  }, [stopTaskStream]);

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
            onContinueEdit={continueEdit}
          />
        </div>
      </section>
    </main>
  );
}
