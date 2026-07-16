import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { CreativeComposer } from '../components/creative/CreativeComposer.jsx';
import { CreativeSidebar } from '../components/creative/CreativeSidebar.jsx';
import { CreativeTaskDetail } from '../components/creative/CreativeTaskDetail.jsx';
import { ConfirmDialog } from '../components/ui/confirm-dialog.jsx';
import {
  appendWorkflowProgressEvent,
  applyWorkflowStageEvent,
  getSidebarTaskTimeSource,
  removeWorkflowProgressEvents,
} from '../components/creative/creativeProgress.js';
import {
  loadActiveCreativeTask,
  loadStoredTasks,
  mergeServerTasks,
  normalizeLastSeq,
  saveActiveCreativeTask,
  saveStoredTasks,
  updateTask,
  upsertTask,
} from './oneClickCreative/creativeTaskStorage.js';
import {
  getErrorMessage,
  getTaskDisplayTitle,
  getTaskTimeLabel,
  getTaskTitle,
  getWorkflowDisplayMessage,
  getWorkflowId,
  getWorkflowPayload,
  getWorkflowVideoUrl,
} from './oneClickCreative/workflowDisplay.js';

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
  const useResearchTouchedRef = useRef(false);
  const retryPlanRequestRef = useRef({ workflowId: '', inFlight: false });
  const retryPlanLoadedRef = useRef('');
  const retryPlanSeqRef = useRef(0);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('quick');
  const [useResearch, setUseResearch] = useState(true);
  const [useResearchTouched, setUseResearchTouched] = useState(false);
  const [workflow, setWorkflow] = useState(null);
  const [workflowId, setWorkflowId] = useState('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tasks, setTasks] = useState(() => loadStoredTasks());
  const [progressEventsByWorkflow, setProgressEventsByWorkflow] = useState({});
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [deletingWorkflowId, setDeletingWorkflowId] = useState('');
  // { kind: 'delete-task', task } | { kind: 'stop-delete', id }
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [confirmError, setConfirmError] = useState('');
  const [retryPlan, setRetryPlan] = useState(null);
  const [retryPlanStatus, setRetryPlanStatus] = useState('idle');
  const [retryPlanMessage, setRetryPlanMessage] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [retryMode, setRetryMode] = useState('');
  // activeTaskRef holds the value; this state only forces stream connect/stop rerenders.
  const [, setActiveTask] = useState(null);
  const isBusy = status === 'creating' || status === 'polling' || status === 'deleting';
  const submitDisabled = isBusy || !input.trim();
  const sidebarTasks = useMemo(() => tasks.map(task => ({
    ...task,
    timeLabel: getTaskTimeLabel(getSidebarTaskTimeSource(task)),
  })), [tasks]);

  useEffect(() => {
    let cancelled = false;
    async function loadCreativeDefaults() {
      try {
        const json = await api.getAppSettings();
        const config = json?.data || json;
        if (!cancelled && !useResearchTouchedRef.current) {
          setUseResearch(config?.creativeDefaults?.useResearch !== false);
        }
      } catch {
        if (!cancelled && !useResearchTouchedRef.current) {
          setUseResearch(true);
        }
      }
    }
    loadCreativeDefaults();
    return () => { cancelled = true; };
  }, []);

  const persistTasks = useCallback((updater) => {
    setTasks(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveStoredTasks(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadServerTasks() {
      try {
        const json = await api.listCreativeWorkflows();
        const items = json?.workflows || json?.items || json?.data?.workflows || [];
        if (cancelled || !Array.isArray(items) || !items.length) return;
        persistTasks(prev => mergeServerTasks(prev, items));
      } catch {
        // 拉取后端任务列表失败时保留本地缓存，不打断首页加载。
      }
    }
    loadServerTasks();
    return () => { cancelled = true; };
  }, [persistTasks]);

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

  const resetRetryPlan = useCallback(() => {
    retryPlanSeqRef.current += 1;
    retryPlanRequestRef.current = { workflowId: '', inFlight: false };
    retryPlanLoadedRef.current = '';
    setRetryPlan(null);
    setRetryPlanStatus('idle');
    setRetryPlanMessage('');
    setRetrying(false);
    setRetryMode('');
  }, []);

  const appendProgressEvent = useCallback((event) => {
    setProgressEventsByWorkflow(prev => appendWorkflowProgressEvent(prev, event));
  }, []);

  const loadRetryPlan = useCallback(async (targetWorkflowId, { force = false, message: nextMessage = '', cacheKey = '' } = {}) => {
    const id = String(targetWorkflowId || '').trim();
    if (!id) return;
    const requestKey = cacheKey || id;
    if (!force && retryPlanRequestRef.current.workflowId === requestKey && retryPlanRequestRef.current.inFlight) return;

    const seq = retryPlanSeqRef.current + 1;
    retryPlanSeqRef.current = seq;
    retryPlanRequestRef.current = { workflowId: requestKey, inFlight: true };
    if (force) retryPlanLoadedRef.current = '';
    setRetryPlanStatus('loading');
    setRetryPlanMessage(nextMessage || '正在生成恢复计划...');
    try {
      const json = await api.getCreativeWorkflowRetryPlan(id);
      if (retryPlanSeqRef.current !== seq) return;
      const plan = json?.plan || json?.data?.plan || null;
      setRetryPlan(plan);
      setRetryPlanStatus('ready');
      setRetryPlanMessage(nextMessage || plan?.user_message || json?.message || '恢复计划已生成。');
      retryPlanLoadedRef.current = requestKey;
    } catch (error) {
      if (retryPlanSeqRef.current !== seq) return;
      setRetryPlan(null);
      setRetryPlanStatus('failed');
      setRetryPlanMessage(getErrorMessage(error, '生成恢复计划失败，请稍后重试。'));
      retryPlanLoadedRef.current = '';
    } finally {
      if (retryPlanSeqRef.current === seq) {
        retryPlanRequestRef.current = { workflowId: '', inFlight: false };
      }
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
        title: getTaskDisplayTitle(nextWorkflow, nextWorkflow?.creative_context?.input?.raw_text, prev.find(task => task.workflow_id === targetWorkflowId)?.title),
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

  const refreshWorkflowSnapshot = useCallback(async ({ workflowId: nextWorkflowId, taskId: expectedTaskId = '', message: fallbackMessage = '' } = {}) => {
    const targetWorkflowId = String(nextWorkflowId || '').trim();
    if (!targetWorkflowId) return;
    const expectedGeneration = streamGenerationRef.current;
    try {
      const json = await api.getCreativeWorkflow(targetWorkflowId);
      const currentWorkflowId = currentWorkflowRef.current.routeWorkflowId
        || currentWorkflowRef.current.workflowId
        || currentWorkflowRef.current.selectedWorkflowId;
      const activeTaskMatches = activeTaskRef.current?.workflow_id === targetWorkflowId
        && (!expectedTaskId || activeTaskRef.current?.task_id === expectedTaskId);
      if (currentWorkflowId !== targetWorkflowId && !activeTaskMatches) return;
      if (streamGenerationRef.current !== expectedGeneration && !activeTaskMatches) return;

      const nextWorkflow = getWorkflowPayload(json);
      const nextStatus = nextWorkflow?.status || (json?.success === false ? 'failed' : 'running');
      const nextMessage = getWorkflowDisplayMessage(nextWorkflow, json?.message || fallbackMessage);
      setWorkflow(nextWorkflow);
      setStatus(nextStatus === 'done' ? 'done' : nextStatus === 'failed' ? 'failed' : 'polling');
      setMessage(nextMessage);
      persistTasks(prev => updateTask(prev, {
        workflow_id: targetWorkflowId,
        title: getTaskDisplayTitle(nextWorkflow, nextWorkflow?.creative_context?.input?.raw_text, prev.find(task => task.workflow_id === targetWorkflowId)?.title),
        input: prev.find(task => task.workflow_id === targetWorkflowId)?.input || nextWorkflow?.creative_context?.input?.raw_text || '',
        status: nextStatus,
        message: nextMessage,
        workflow: nextWorkflow,
        created_at: prev.find(task => task.workflow_id === targetWorkflowId)?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
    } catch {
      if (fallbackMessage) setMessage(fallbackMessage);
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
    appendProgressEvent(event);
    if (Number(event.seq) > 0) {
      lastSeqRef.current = Number(event.seq);
      saveActiveCreativeTask({ workflow_id: event.workflow_id, task_id: event.task_id, last_seq: lastSeqRef.current });
    }
    if (event.message) setMessage(event.message);
    // SSE 活跃期间不轮询 workflow 记录，这里把事件同步进 workflow，
    // 否则“当前进展”面板会停在上次快照、与底部实时消息脱节。
    setWorkflow(prev => {
      if (!prev) return prev;
      if (prev.workflow_id && event.workflow_id && prev.workflow_id !== event.workflow_id) return prev;
      if (prev.status === 'done' || prev.status === 'failed') return prev;
      const seq = Number(event.seq);
      if (Number.isFinite(seq) && seq > 0 && Number(prev.last_event_seq) >= seq) return prev;
      return applyWorkflowStageEvent({
        ...prev,
        ...(event.stage ? { current_stage: event.stage } : {}),
        ...(event.message ? { current_stage_message: event.message } : {}),
        ...(Number.isFinite(event.progress) && event.progress > 0 ? { current_progress: event.progress } : {}),
        ...(Number.isFinite(seq) && seq > 0 ? { last_event_seq: seq } : {}),
      }, event);
    });
    if (event.type === 'stage_progress' || event.type?.startsWith('html_video_')) {
      setStatus('polling');
    }
    if (event.type === 'stage_done' && ['assets', 'project'].includes(event.stage)) {
      refreshWorkflowSnapshot({
        workflowId: event.workflow_id,
        taskId: event.task_id,
        message: event.message,
      });
    }
    if (event.type === 'task_failed') {
      setRetrying(false);
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
      setRetrying(false);
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
        setRetrying(false);
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
        setRetrying(false);
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
        setRetrying(false);
        finalWorkflowRefreshRef.current = null;
        setProgressEventsByWorkflow(prev => removeWorkflowProgressEvents(prev, event.workflow_id));
        persistTasks(prev => prev.filter(item => item.workflow_id !== event.workflow_id));
        setWorkflow(null);
        setWorkflowId('');
        setSelectedWorkflowId('');
        setStatus('idle');
        setMessage('任务已删除。');
        navigate('/creative');
      }
    }
  }, [fetchFinalWorkflow, refreshWorkflowSnapshot, appendProgressEvent, navigate, persistTasks, stopTaskStream]);

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
    useResearchTouchedRef.current = false;
    setUseResearchTouched(false);
    setWorkflow(null);
    setWorkflowId('');
    setSelectedWorkflowId('');
    setProgressEventsByWorkflow({});
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

  function requestDeleteTask(task) {
    setConfirmError('');
    setPendingConfirm({ kind: 'delete-task', task });
  }

  async function performDeleteTask(task) {
    setDeletingWorkflowId(task.workflow_id);
    let deleteOk = false;
    try {
      const result = await api.deleteCreativeWorkflow(task.workflow_id);
      deleteOk = result?.success !== false;
    } catch (error) {
      deleteOk = error?.status === 404; // 后端已不存在，视为删除成功
    } finally {
      setDeletingWorkflowId('');
    }

    if (!deleteOk) {
      setConfirmError('删除任务失败，请稍后重试。该任务仍保留在列表中。');
      return;
    }

    setPendingConfirm(null);
    persistTasks(prev => prev.filter(item => item.workflow_id !== task.workflow_id));
    setProgressEventsByWorkflow(prev => removeWorkflowProgressEvents(prev, task.workflow_id));

    if (selectedWorkflowId === task.workflow_id) {
      startNewTask();
    }
  }

  function requestStopAndDeleteTask(targetWorkflowId) {
    const id = String(targetWorkflowId || '').trim();
    if (!id || deletingWorkflowId) return;
    setConfirmError('');
    setPendingConfirm({ kind: 'stop-delete', id });
  }

  async function performStopAndDeleteTask(id) {
    setDeletingWorkflowId(id);
    setStatus('deleting');
    setMessage('正在停止并删除任务...');
    let deleteOk = false;
    try {
      const result = await api.deleteCreativeWorkflow(id);
      deleteOk = result?.success !== false;
    } catch (error) {
      deleteOk = error?.status === 404; // 已不存在，视为删除成功
    } finally {
      setDeletingWorkflowId('');
    }

    setPendingConfirm(null);
    if (!deleteOk) {
      setStatus('failed');
      setMessage('停止并删除任务失败，请稍后重试。');
      return;
    }

    persistTasks(prev => prev.filter(item => item.workflow_id !== id));
    setProgressEventsByWorkflow(prev => removeWorkflowProgressEvents(prev, id));
    if (selectedWorkflowId === id || workflowId === id) {
      startNewTask();
    }
  }

  async function handleRetryWorkflow(ignoreLayoutQaOnce = false) {
    const targetWorkflowId = String(workflow?.workflow_id || selectedWorkflowId || workflowId || '').trim();
    if (!targetWorkflowId) {
      setRetryPlanStatus('failed');
      setRetryPlanMessage('缺少创作任务 ID，无法重试。');
      return;
    }
    if (!retryPlan || retryPlan.can_retry !== true) {
      setRetryPlanMessage(retryPlan?.user_message || '当前失败暂不支持自动恢复。');
      return;
    }
    if (retrying) return;

    const actionMessage = ignoreLayoutQaOnce
      ? '正在忽略布局警告并继续...'
      : '正在修复并重试...';
    setRetrying(true);
    setRetryMode(ignoreLayoutQaOnce ? 'ignore_layout_qa' : 'repair');
    setStatus('polling');
    setMessage(actionMessage);
    persistTasks(prev => updateTask(prev, {
      workflow_id: targetWorkflowId,
      status: 'running',
      message: actionMessage,
      updated_at: new Date().toISOString(),
    }));

    try {
      const json = await api.retryCreativeWorkflow(targetWorkflowId, {
        mode: 'repair_and_resume',
        confirm_plan_code: retryPlan.code,
        ignore_layout_qa_once: ignoreLayoutQaOnce,
      });
      const nextWorkflowId = json?.workflow_id || targetWorkflowId;
      const taskId = json?.task_id || json?.active_task?.task_id || '';
      if (!taskId) {
        const noTaskMessage = '恢复重试已启动，但未返回任务 ID，请稍后刷新任务。';
        setRetrying(false);
        setRetryMode('');
        setStatus('failed');
        setMessage(noTaskMessage);
        persistTasks(prev => updateTask(prev, {
          workflow_id: targetWorkflowId,
          status: 'failed',
          message: noTaskMessage,
          updated_at: new Date().toISOString(),
        }));
        return;
      }
      const nextTask = { workflow_id: nextWorkflowId, task_id: taskId };
      saveActiveCreativeTask({ ...nextTask, last_seq: 0 });
      subscribeTaskEvents(nextTask, { sinceSeq: 0 });
      setWorkflowId(nextWorkflowId);
      setSelectedWorkflowId(nextWorkflowId);
      setMessage(actionMessage);
      persistTasks(prev => updateTask(prev, {
        workflow_id: nextWorkflowId,
        status: 'running',
        message: actionMessage,
        updated_at: new Date().toISOString(),
      }));
    } catch (error) {
      const errorMessage = getErrorMessage(error, '启动恢复重试失败，请稍后重试。');
      const planChanged = error?.data?.code === 'RETRY_PLAN_CODE_CHANGED' || errorMessage.includes('恢复计划已变化');
      setRetrying(false);
      setRetryMode('');
      setStatus('failed');
      setMessage(errorMessage);
      persistTasks(prev => updateTask(prev, {
        workflow_id: targetWorkflowId,
        status: 'failed',
        message: errorMessage,
        updated_at: new Date().toISOString(),
      }));
      if (planChanged) {
        const changedMessage = '恢复计划已变化，请确认最新建议后再重试。';
        await loadRetryPlan(targetWorkflowId, {
          force: true,
          message: changedMessage,
          cacheKey: `${targetWorkflowId}:plan-changed:${Date.now()}`,
        });
        return;
      }
      setRetryPlanMessage(errorMessage);
    }
  }

  async function submitCreativeWorkflow(event) {
    event.preventDefault();
    if (submitDisabled) return;

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
      const overrideEntries = {
        ...(useResearchTouched ? { useResearch } : {}),
      };
      const requestPayload = {
        input: trimmed,
        assetIds: [],
        renderOptions: {},
        workflowOptions: {},
        ...(Object.keys(overrideEntries).length ? { creativeDefaultsOverride: overrideEntries } : {}),
      };
      const json = await api.createCreativeWorkflow(requestPayload);
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
      setStatus('polling');
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
      { sinceSeq: 0 },
    );
    return undefined;
  }, [workflowId, routeWorkflowId, selectedWorkflowId, stopTaskStream, subscribeTaskEvents]);

  useEffect(() => {
    if (status !== 'polling' || !workflowId) return undefined;
    let cancelled = false;

    async function pollWorkflow() {
      // SSE 已连接时由事件流驱动状态；轮询仅作为断线兜底，避免与 SSE 双写打架。
      if (activeStreamRef.current && workflow?.workflow_id === workflowId) return;
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
          title: getTaskDisplayTitle(nextWorkflow, nextWorkflow?.creative_context?.input?.raw_text, prev.find(task => task.workflow_id === workflowId)?.title),
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
        if (cancelled) return;
        if (error?.status === 404) {
          setStatus('failed');
          setMessage(getErrorMessage(error, '未找到创作任务。'));
          return;
        }
        // 网络抖动/服务临时不可用：后台任务可能仍在运行，保持轮询，不误判为失败。
        setMessage('任务状态刷新失败，正在重试...');
      }
    }

    pollWorkflow();
    const timer = window.setInterval(pollWorkflow, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status, workflowId, workflow?.workflow_id, persistTasks, stopTaskStream, subscribeTaskEvents]);

  useEffect(() => {
    const targetWorkflowId = String(workflow?.workflow_id || selectedWorkflowId || workflowId || '').trim();
    if (workflow?.status !== 'failed' || !targetWorkflowId) {
      resetRetryPlan();
      return undefined;
    }
    const failureKey = [
      targetWorkflowId,
      workflow?.last_failure?.code || workflow?.retry?.latest_plan?.code || '',
      workflow?.last_failure?.updated_at || workflow?.updated_at || '',
    ].join(':');
    loadRetryPlan(targetWorkflowId, { cacheKey: failureKey });
    return undefined;
  }, [
    workflow?.status,
    workflow?.workflow_id,
    workflow?.last_failure?.code,
    workflow?.last_failure?.updated_at,
    workflow?.retry?.latest_plan?.code,
    workflow?.updated_at,
    selectedWorkflowId,
    workflowId,
    loadRetryPlan,
    resetRetryPlan,
  ]);

  useEffect(() => () => {
    stopTaskStream();
  }, [stopTaskStream]);

  return (
    <main className={`grid h-screen min-h-screen overflow-hidden bg-white transition-[grid-template-columns] duration-200 max-[760px]:h-auto max-[760px]:min-h-0 max-[760px]:grid-cols-1 max-[760px]:overflow-visible ${sidebarCollapsed ? 'grid-cols-[76px_minmax(0,1fr)]' : 'grid-cols-[260px_minmax(0,1fr)]'}`}>
      <CreativeSidebar
        tasks={sidebarTasks}
        selectedWorkflowId={selectedWorkflowId}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(value => !value)}
        onNewTask={startNewTask}
        onSelectTask={selectTask}
        onDeleteTask={requestDeleteTask}
      />

      <section className="min-h-0 min-w-0 overflow-auto bg-white">
        <div className={selectedWorkflowId
          ? 'mx-auto grid min-h-screen w-full max-w-[1120px] content-start justify-stretch gap-[22px] px-8 py-[42px]'
          : 'mx-auto grid min-h-screen w-full max-w-[920px] content-center justify-items-center gap-[22px] px-8 py-14'}
        >
          {!isDetailRoute && (
            <>
              <CreativeComposer
                input={input}
                setInput={setInput}
                mode={mode}
                setMode={setMode}
                useResearch={useResearch}
                setUseResearch={(value) => {
                  useResearchTouchedRef.current = true;
                  setUseResearchTouched(true);
                  setUseResearch(value);
                }}
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
            retryPlan={retryPlan}
            retryPlanStatus={retryPlanStatus}
            retryPlanMessage={retryPlanMessage}
            retrying={retrying}
            retryMode={retryMode}
            progressEvents={progressEventsByWorkflow[selectedWorkflowId] || []}
            onStopAndDelete={requestStopAndDeleteTask}
            onContinueEdit={continueEdit}
            onRetryWorkflow={handleRetryWorkflow}
            getWorkflowVideoUrl={getWorkflowVideoUrl}
          />
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        onOpenChange={value => {
          if (!value) {
            setPendingConfirm(null);
            setConfirmError('');
          }
        }}
        title={pendingConfirm?.kind === 'stop-delete'
          ? '停止并删除当前任务'
          : `删除任务「${pendingConfirm?.task?.title || ''}」`}
        description={pendingConfirm?.kind === 'stop-delete'
          ? '任务记录和已生成资源都会被删除，此操作不可恢复。'
          : '此操作不可恢复。'}
        destructive
        loading={Boolean(deletingWorkflowId)}
        confirmText={pendingConfirm?.kind === 'stop-delete' ? '停止并删除' : '删除任务'}
        onConfirm={() => {
          if (!pendingConfirm) return;
          if (pendingConfirm.kind === 'stop-delete') performStopAndDeleteTask(pendingConfirm.id);
          else performDeleteTask(pendingConfirm.task);
        }}
      >
        {confirmError ? <p className="m-0 text-sm font-semibold text-danger">{confirmError}</p> : null}
      </ConfirmDialog>
    </main>
  );
}
