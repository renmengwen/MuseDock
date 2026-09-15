import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client.js';

const LAST_TASK_KEY = 'musedock.transcription.last-task';
export const isTranscriptionRunning = job => ['queued', 'running'].includes(job?.status);

function lastTaskId() {
  try { return localStorage.getItem(LAST_TASK_KEY) || ''; } catch { return ''; }
}

function rememberId(id) {
  try {
    if (id) localStorage.setItem(LAST_TASK_KEY, id);
    else localStorage.removeItem(LAST_TASK_KEY);
  } catch {}
}

function summary(job) {
  return {
    id: job.id, title: job.title || job.source?.title || job.source?.url || '抖音转写',
    status: job.status, stage: job.stage, source: job.source,
    createdAt: job.createdAt, updatedAt: job.updatedAt, autoCorrect: job.autoCorrect,
    durationMs: job.result?.durationMs ?? job.source?.durationMs ?? null,
    sentenceCount: job.result?.sentenceCount ?? null,
    hasResult: !!job.result, hasCorrectedText: !!job.result?.correctedText,
  };
}

function mostRecent(previous, next) {
  return previous?.id === next.id && (Date.parse(previous.updatedAt) || 0) > (Date.parse(next.updatedAt) || 0) ? previous : next;
}

function mergeItem(items, next) {
  const previous = items.find(item => item.id === next.id);
  if (mostRecent(previous, next) === previous) return items;
  return [next, ...items.filter(item => item.id !== next.id)].sort((left, right) =>
    (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0) || right.id.localeCompare(left.id));
}

export function useTranscriptionHistory(open) {
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [skippedCount, setSkippedCount] = useState(0);
  const [job, setJob] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [pollError, setPollError] = useState('');
  const [pollVersion, setPollVersion] = useState(0);
  const openRef = useRef(open);
  const selectedIdRef = useRef('');
  const selectionVersion = useRef(0);
  const historyVersion = useRef(0);
  openRef.current = open;

  const updateHistory = useCallback(nextJob => {
    setHistory(items => mergeItem(items, summary(nextJob)));
  }, []);

  const selectJob = useCallback(async id => {
    const request = ++selectionVersion.current;
    selectedIdRef.current = id;
    setSelectedId(id);
    setJob(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const response = await api.getTranscription(id);
      if (!openRef.current || request !== selectionVersion.current) return;
      if (response.data?.id !== id) throw new Error('这条转写记录暂时无法读取，请刷新历史后重试。');
      setJob(current => mostRecent(current, response.data));
      updateHistory(response.data);
      rememberId(id);
    } catch (cause) {
      if (openRef.current && request === selectionVersion.current) setDetailError(cause.message);
    } finally {
      if (openRef.current && request === selectionVersion.current) setDetailLoading(false);
    }
  }, [updateHistory]);

  const rememberJob = useCallback(nextJob => {
    selectionVersion.current += 1;
    selectedIdRef.current = nextJob.id;
    setSelectedId(nextJob.id);
    setJob(nextJob);
    setDetailLoading(false);
    setDetailError('');
    setPollError('');
    updateHistory(nextJob);
    rememberId(nextJob.id);
  }, [updateHistory]);

  const clearJob = useCallback(() => {
    selectionVersion.current += 1;
    selectedIdRef.current = '';
    setSelectedId('');
    setJob(null);
    setDetailLoading(false);
    setDetailError('');
    rememberId('');
  }, []);

  const refreshHistory = useCallback(async (restoreSelection = false) => {
    const request = ++historyVersion.current;
    const selection = selectionVersion.current;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await api.listTranscriptions();
      if (!openRef.current || request !== historyVersion.current) return;
      if (!Array.isArray(response.data?.items)) throw new Error('转写历史响应无效，请重启 MuseDock 服务后重试。');
      const items = response.data.items;
      setHistory(current => {
        const previous = new Map(current.map(item => [item.id, item]));
        return items.map(item => mostRecent(previous.get(item.id), item));
      });
      setSkippedCount(response.data.skippedCount || 0);
      if (restoreSelection && selection === selectionVersion.current) {
        const savedId = selectedIdRef.current || lastTaskId();
        const id = items.some(item => item.id === savedId) ? savedId : items[0]?.id;
        if (id) void selectJob(id);
        else clearJob();
      }
    } catch (cause) {
      if (!openRef.current || request !== historyVersion.current) return;
      setHistoryError(cause.message || '无法加载转写历史，请重试。');
      const savedId = selectedIdRef.current || lastTaskId();
      if (restoreSelection && savedId && selection === selectionVersion.current) void selectJob(savedId);
    } finally {
      if (openRef.current && request === historyVersion.current) setHistoryLoading(false);
    }
  }, [clearJob, selectJob]);

  useEffect(() => {
    if (!open) return undefined;
    void refreshHistory(true);
    return () => {
      historyVersion.current += 1;
      selectionVersion.current += 1;
    };
  }, [open, refreshHistory]);

  // 轮询所有已知的运行任务，切换到旧记录不会停止后台任务的状态更新。
  const activeIds = history.filter(isTranscriptionRunning).map(item => item.id).sort().join(',');
  useEffect(() => {
    if (!open || !activeIds) {
      setPollError('');
      return undefined;
    }
    let cancelled = false;
    let timer;
    let failures = 0;
    setPollError('');
    const poll = async () => {
      const selection = selectionVersion.current;
      const results = await Promise.allSettled(activeIds.split(',').map(id => api.getTranscription(id)));
      if (cancelled) return;
      let failure = '';
      let stillRunning = false;
      for (const result of results) {
        if (result.status === 'rejected' || !result.value.data?.id) {
          failure = result.reason?.message || '无法读取任务状态。';
          stillRunning = true;
          continue;
        }
        const nextJob = result.value.data;
        updateHistory(nextJob);
        if (selection === selectionVersion.current && selectedIdRef.current === nextJob.id) {
          setJob(current => mostRecent(current, nextJob));
          setDetailError('');
        }
        if (isTranscriptionRunning(nextJob)) stillRunning = true;
      }
      failures = failure ? failures + 1 : 0;
      setPollError(failure ? `${failure} 任务状态暂时无法更新，请刷新状态。` : '');
      if (stillRunning && failures < 3) timer = window.setTimeout(poll, failure ? 3000 : 1500);
    };
    timer = window.setTimeout(poll, 500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, activeIds, pollVersion, updateHistory]);

  return {
    history, historyLoading, historyError, skippedCount, job, selectedId, detailLoading, detailError, pollError,
    activeJob: history.find(isTranscriptionRunning),
    selectJob, rememberJob, clearJob, refreshHistory,
    refreshStatus: () => setPollVersion(value => value + 1),
  };
}
