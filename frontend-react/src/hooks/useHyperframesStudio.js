import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';

const DEFAULT_FILE = 'index.html';

export function makeStatus(type = 'idle', message = '') {
  return { type, message };
}

function getRunId(run) {
  return run?.run_id || run?.runId || '';
}

function getErrorMessage(error, fallback = '操作失败，请稍后重试。') {
  return error?.message || fallback;
}

function normalizeRunList(json) {
  return Array.isArray(json?.data) ? json.data : [];
}

export function useHyperframesStudio({ initialAwemeId = '', initialRunId = '' } = {}) {
  const [awemeId, setAwemeId] = useState(initialAwemeId);
  const [runId, setRunId] = useState(initialRunId);
  const [runs, setRuns] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [selectedFile, setSelectedFile] = useState(DEFAULT_FILE);
  const [fileContent, setFileContent] = useState('');
  const [status, setStatus] = useState(makeStatus('idle', '等待选择素材和运行记录。'));
  const [busyAction, setBusyAction] = useState('');
  const autoRefreshKeyRef = useRef('');

  const isBusy = Boolean(busyAction);
  const trimmedAwemeId = awemeId.trim();
  const trimmedRunId = runId.trim();

  const canUseRun = useMemo(() => Boolean(trimmedAwemeId && trimmedRunId), [trimmedAwemeId, trimmedRunId]);

  useEffect(() => {
    setAwemeId(initialAwemeId || '');
  }, [initialAwemeId]);

  useEffect(() => {
    setRunId(initialRunId || '');
  }, [initialRunId]);

  const selectRun = useCallback((run) => {
    const nextRunId = getRunId(run);
    setActiveRun(run || null);
    setRunId(nextRunId);
    setStatus(makeStatus('success', nextRunId ? `已切换到运行记录 ${nextRunId}` : '已清空运行记录选择。'));
  }, []);

  const mergeRun = useCallback((nextRun) => {
    if (!nextRun) return;
    const nextRunId = getRunId(nextRun);
    setActiveRun(nextRun);
    if (nextRunId) setRunId(nextRunId);
    setRuns(prev => {
      if (!nextRunId) return prev;
      const exists = prev.some(run => getRunId(run) === nextRunId);
      if (!exists) return [nextRun, ...prev];
      return prev.map(run => (getRunId(run) === nextRunId ? { ...run, ...nextRun } : run));
    });
  }, []);

  const refreshRuns = useCallback(async (nextAwemeId = trimmedAwemeId, preferredRunId = trimmedRunId) => {
    const value = String(nextAwemeId || '').trim();
    if (!value) {
      setStatus(makeStatus('error', '请输入抖音视频 aweme_id。'));
      return [];
    }
    if (busyAction) return runs;

    setBusyAction('refreshRuns');
    setStatus(makeStatus('loading', '正在加载 HyperFrames 运行记录...'));
    try {
      const json = await api.listDouyinAgentRuns(value);
      const runList = normalizeRunList(json);
      const nextActiveRun = runList.find(run => getRunId(run) === preferredRunId) || runList[0] || null;
      setRuns(runList);
      setActiveRun(nextActiveRun);
      setRunId(getRunId(nextActiveRun) || preferredRunId || '');
      setStatus(makeStatus('success', runList.length ? '运行记录已加载。' : '暂无运行记录。'));
      return runList;
    } catch (error) {
      setStatus(makeStatus('error', getErrorMessage(error, '运行记录加载失败。')));
      throw error;
    } finally {
      setBusyAction('');
    }
  }, [busyAction, runs, trimmedAwemeId, trimmedRunId]);

  useEffect(() => {
    if (!initialAwemeId) return;
    const autoRefreshKey = `${initialAwemeId}::${initialRunId}`;
    if (autoRefreshKeyRef.current === autoRefreshKey) return;

    autoRefreshKeyRef.current = autoRefreshKey;
    refreshRuns(initialAwemeId, initialRunId).catch(() => {});
  }, [initialAwemeId, initialRunId, refreshRuns]);

  const refreshActiveRun = useCallback(async (nextRunId = trimmedRunId) => {
    if (!trimmedAwemeId || !nextRunId) return null;
    const json = await api.getDouyinAgentRun(trimmedAwemeId, nextRunId);
    const nextRun = json?.data || json?.run || json;
    mergeRun(nextRun);
    return nextRun;
  }, [mergeRun, trimmedAwemeId, trimmedRunId]);

  const createFreeformRun = useCallback(async () => {
    if (busyAction) return null;
    if (!trimmedAwemeId) {
      setStatus(makeStatus('error', '请输入抖音视频 aweme_id。'));
      return null;
    }

    setBusyAction('createFreeformRun');
    setStatus(makeStatus('loading', '正在新建高级成片记录...'));
    try {
      const json = await api.createDouyinHyperframesFreeformRun(trimmedAwemeId);
      const nextRun = json?.run || json?.data || json;
      mergeRun(nextRun);
      await refreshRuns(trimmedAwemeId, getRunId(nextRun));
      setStatus(makeStatus(json?.success === false ? 'error' : 'success', json?.message || '高级成片记录已新建。'));
      return json;
    } catch (error) {
      setStatus(makeStatus('error', getErrorMessage(error, '高级成片记录创建失败。')));
      throw error;
    } finally {
      setBusyAction('');
    }
  }, [busyAction, mergeRun, refreshRuns, trimmedAwemeId]);

  const runStudioAction = useCallback(async ({
    action,
    loadingMessage,
    successMessage,
    missingMessage = '请先选择素材和运行记录。',
    request,
    afterSuccess,
  }) => {
    if (busyAction) return null;
    if (!canUseRun) {
      setStatus(makeStatus('error', missingMessage));
      return null;
    }

    setBusyAction(action);
    setStatus(makeStatus('loading', loadingMessage));
    try {
      const json = await request(trimmedAwemeId, trimmedRunId);
      if (typeof afterSuccess === 'function') {
        await afterSuccess(json);
      } else {
        await refreshActiveRun(trimmedRunId);
      }
      setStatus(makeStatus(json?.success === false ? 'error' : 'success', json?.message || successMessage));
      return json;
    } catch (error) {
      setStatus(makeStatus('error', getErrorMessage(error)));
      throw error;
    } finally {
      setBusyAction('');
    }
  }, [busyAction, canUseRun, refreshActiveRun, trimmedAwemeId, trimmedRunId]);

  const generateBrief = useCallback((payload = {}) => runStudioAction({
    action: 'generateBrief',
    loadingMessage: '正在生成导演策划...',
    successMessage: '导演策划已生成。',
    request: (nextAwemeId, nextRunId) => api.generateHyperframesFreeformBrief(nextAwemeId, nextRunId, payload),
  }), [runStudioAction]);

  const generateProject = useCallback((payload = {}) => runStudioAction({
    action: 'generateProject',
    loadingMessage: '正在生成 HyperFrames 工程...',
    successMessage: 'HyperFrames 工程已生成。',
    request: (nextAwemeId, nextRunId) => api.generateHyperframesFreeformProject(nextAwemeId, nextRunId, payload),
  }), [runStudioAction]);

  const checkProject = useCallback(() => runStudioAction({
    action: 'checkProject',
    loadingMessage: '正在校验动画工程...',
    successMessage: '动画工程校验完成。',
    request: (nextAwemeId, nextRunId) => api.checkHyperframesFreeformProject(nextAwemeId, nextRunId),
  }), [runStudioAction]);

  const renderVideo = useCallback((payload = {}) => runStudioAction({
    action: 'renderVideo',
    loadingMessage: '正在渲染视频...',
    successMessage: '视频渲染完成。',
    request: (nextAwemeId, nextRunId) => api.renderHyperframesFreeformProject(nextAwemeId, nextRunId, payload),
  }), [runStudioAction]);

  const inspectVideo = useCallback(() => runStudioAction({
    action: 'inspectVideo',
    loadingMessage: '正在抽帧质检...',
    successMessage: '抽帧质检完成。',
    request: (nextAwemeId, nextRunId) => api.inspectHyperframesFreeformVideo(nextAwemeId, nextRunId),
  }), [runStudioAction]);

  const loadFile = useCallback(async (fileName = selectedFile) => {
    const nextFile = String(fileName || '').trim();
    if (busyAction) return null;
    if (!canUseRun || !nextFile) {
      setStatus(makeStatus('error', '请先选择素材、运行记录和工程文件。'));
      return null;
    }

    setBusyAction('loadFile');
    setSelectedFile(nextFile);
    setStatus(makeStatus('loading', `正在加载工程文件 ${nextFile}...`));
    try {
      const response = await api.getHyperframesFreeformFile(awemeId, runId, nextFile);
      const text = await response.text();
      setFileContent(text);
      setStatus(makeStatus('success', `工程文件 ${nextFile} 已加载。`));
      return text;
    } catch (error) {
      setStatus(makeStatus('error', getErrorMessage(error, '工程文件加载失败。')));
      throw error;
    } finally {
      setBusyAction('');
    }
  }, [awemeId, busyAction, canUseRun, runId, selectedFile]);

  const saveFile = useCallback(async () => {
    if (busyAction) return null;
    if (!canUseRun || !selectedFile) {
      setStatus(makeStatus('error', '请先选择素材、运行记录和工程文件。'));
      return null;
    }

    setBusyAction('saveFile');
    setStatus(makeStatus('loading', `正在保存工程文件 ${selectedFile}...`));
    try {
      const json = await api.saveHyperframesFreeformFile(awemeId, runId, selectedFile, fileContent);
      setStatus(makeStatus(json?.success === false ? 'error' : 'success', json?.message || `工程文件 ${selectedFile} 已保存。`));
      return json;
    } catch (error) {
      setStatus(makeStatus('error', getErrorMessage(error, '工程文件保存失败。')));
      throw error;
    } finally {
      setBusyAction('');
    }
  }, [awemeId, busyAction, canUseRun, fileContent, runId, selectedFile]);

  return {
    awemeId,
    setAwemeId,
    runId,
    setRunId,
    runs,
    setRuns,
    activeRun,
    setActiveRun,
    selectedFile,
    setSelectedFile,
    fileContent,
    setFileContent,
    status,
    setStatus,
    busyAction,
    isBusy,
    canUseRun,
    selectRun,
    refreshRuns,
    refreshActiveRun,
    createFreeformRun,
    generateBrief,
    generateProject,
    checkProject,
    renderVideo,
    inspectVideo,
    loadFile,
    saveFile,
  };
}
