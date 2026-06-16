import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function getPayload(result) {
  return result?.project || result?.data?.project || result?.data || result || null;
}

function getExports(result) {
  const payload = getPayload(result);
  if (Array.isArray(result?.exports)) return result.exports;
  if (Array.isArray(payload?.exports)) return payload.exports;
  return [];
}

function getErrorCode(error) {
  return error?.data?.code || error?.data?.error_code || error?.code || '';
}

function getFailureStatus(error) {
  const code = getErrorCode(error);
  if (error?.status === 404 || code === 'NO_HTML_VIDEO_PROJECT') return 'legacy_fallback';
  if (code === 'HTML_VIDEO_NOT_CONFIGURED' || code === 'ENVIRONMENT_NOT_CONFIGURED' || code === 'environment_not_configured') {
    return 'not_configured';
  }
  if (code === 'NEEDS_VALIDATION' || code === 'PROJECT_NEEDS_VALIDATION') return 'needs_validation';
  return 'error';
}

const STATUS_MESSAGES = {
  idle: '等待加载可编辑成片工程。',
  loading: '正在加载可编辑成片工程...',
  ready: '可编辑成片工程已加载。',
  saving: '正在保存模板字段...',
  editing: '正在应用编辑...',
  materializing: '正在重新生成 HTML...',
  rendering: '正在渲染单帧预览...',
  exporting: '正在导出成片...',
  tts: '正在重新生成旁白...',
  error: '操作失败。',
  not_configured: '渲染环境未配置。',
  needs_validation: '工程需要验证。',
  legacy_fallback: '未找到 HtmlVideoProject，已切换旧版编辑器。',
};

export function useHtmlVideoProject({ workflowId, api }) {
  const [project, setProject] = useState(null);
  const [exportsList, setExportsList] = useState([]);
  const [selectedFrameId, setSelectedFrameId] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [dirtyRequiresRender, setDirtyRequiresRender] = useState(false);
  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const mutatingRef = useRef(false);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const frames = useMemo(() => (
    Array.isArray(project?.frames) ? project.frames : []
  ), [project]);

  const selectedFrame = useMemo(() => (
    frames.find(frame => String(frame.id) === String(selectedFrameId)) || frames[0] || null
  ), [frames, selectedFrameId]);

  const applyProjectResult = useCallback((result = {}) => {
    const nextProject = getPayload(result);
    if (nextProject) setProject(nextProject);
    const nextExports = getExports(result);
    if (nextExports.length || Array.isArray(result?.exports) || Array.isArray(nextProject?.exports)) {
      setExportsList(nextExports);
    }
    if (result?.requires_render !== undefined) {
      setDirtyRequiresRender(Boolean(result.requires_render));
    }
  }, []);

  const setFailure = useCallback((error, fallbackMessage = '操作失败。') => {
    const nextStatus = getFailureStatus(error);
    setStatus(nextStatus);
    if (nextStatus === 'not_configured') {
      setMessage(error?.message || '渲染环境未配置。请检查 Playwright Chromium 和 ffmpeg。');
      return nextStatus;
    }
    if (nextStatus === 'needs_validation') {
      setMessage(error?.message || '工程需要验证。请先完成工程校验后再继续。');
      return nextStatus;
    }
    if (nextStatus === 'legacy_fallback') {
      setMessage('未找到 HtmlVideoProject，已切换旧版编辑器。');
      return nextStatus;
    }
    setMessage(error?.data?.message || error?.message || fallbackMessage);
    return nextStatus;
  }, []);

  const load = useCallback(async () => {
    if (!workflowId || !api?.getHtmlVideoProject || loadingRef.current) return null;
    loadingRef.current = true;
    setLoading(true);
    setStatus('loading');
    setMessage(STATUS_MESSAGES.loading);
    try {
      const result = await api.getHtmlVideoProject(workflowId);
      if (!mountedRef.current) return null;
      applyProjectResult(result);
      setStatus('ready');
      setMessage(STATUS_MESSAGES.ready);
      return result;
    } catch (error) {
      if (!mountedRef.current) return null;
      setFailure(error, '加载可编辑成片工程失败。');
      return null;
    } finally {
      loadingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [workflowId, api, applyProjectResult, setFailure]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (frames.length > 0 && !selectedFrameId) {
      setSelectedFrameId(frames[0].id);
    }
  }, [frames, selectedFrameId]);

  const runMutatingAction = useCallback(async ({ nextStatus, loadingMessage, successMessage, action, fallbackMessage }) => {
    if (!workflowId || !api || mutatingRef.current || loadingRef.current) return null;
    mutatingRef.current = true;
    setIsMutating(true);
    setStatus(nextStatus);
    setMessage(loadingMessage);
    try {
      const result = await action();
      if (!mountedRef.current) return null;
      applyProjectResult(result);
      setStatus('ready');
      setMessage(result?.message || successMessage);
      return result;
    } catch (error) {
      if (!mountedRef.current) return null;
      setFailure(error, fallbackMessage);
      return null;
    } finally {
      mutatingRef.current = false;
      if (mountedRef.current) setIsMutating(false);
    }
  }, [workflowId, api, applyProjectResult, setFailure]);

  const saveTemplateInputs = useCallback((payload) => (
    runMutatingAction({
      nextStatus: 'saving',
      loadingMessage: STATUS_MESSAGES.saving,
      successMessage: '模板字段已保存，需要重新导出后才会更新成片。',
      fallbackMessage: '保存模板字段失败。',
      action: () => api.patchHtmlVideoProjectInputs(workflowId, payload),
    })
  ), [api, workflowId, runMutatingAction]);

  const saveFrame = useCallback((frameId, payload) => (
    runMutatingAction({
      nextStatus: 'saving',
      loadingMessage: '正在保存帧字段...',
      successMessage: '帧字段已保存，需要重新导出后才会更新成片。',
      fallbackMessage: '保存帧字段失败。',
      action: () => api.patchHtmlVideoProjectFrame(workflowId, frameId, payload),
    })
  ), [api, workflowId, runMutatingAction]);

  const applyNaturalLanguageEdit = useCallback((instruction) => (
    runMutatingAction({
      nextStatus: 'editing',
      loadingMessage: STATUS_MESSAGES.editing,
      successMessage: '编辑已应用，需要重新渲染。',
      fallbackMessage: '应用编辑失败。',
      action: () => api.editHtmlVideoProject(workflowId, { instruction }),
    })
  ), [api, workflowId, runMutatingAction]);

  const materializeProject = useCallback((payload = {}) => (
    runMutatingAction({
      nextStatus: 'materializing',
      loadingMessage: STATUS_MESSAGES.materializing,
      successMessage: 'HTML 已重新生成，需要导出后更新成片。',
      fallbackMessage: '重新生成 HTML 失败。',
      action: () => api.renderHtmlVideoProject(workflowId, { ...payload, mode: 'materialize' }),
    })
  ), [api, workflowId, runMutatingAction]);

  const renderFramePreview = useCallback((frameId) => (
    runMutatingAction({
      nextStatus: 'rendering',
      loadingMessage: STATUS_MESSAGES.rendering,
      successMessage: '单帧预览已渲染。',
      fallbackMessage: '渲染单帧预览失败。',
      action: () => api.renderHtmlVideoProject(workflowId, { mode: 'frame', frame_id: frameId }),
    })
  ), [api, workflowId, runMutatingAction]);

  const regenerateNarration = useCallback((payload = {}) => (
    runMutatingAction({
      nextStatus: 'tts',
      loadingMessage: STATUS_MESSAGES.tts,
      successMessage: '旁白已重新生成，需要重新导出。',
      fallbackMessage: '重新生成旁白失败。',
      action: () => api.editHtmlVideoProject(workflowId, { type: 'tts', ...payload }),
    })
  ), [api, workflowId, runMutatingAction]);

  const refreshExports = useCallback(async () => {
    if (!workflowId || !api?.listHtmlVideoProjectExports || loadingRef.current) return null;
    loadingRef.current = true;
    setLoading(true);
    setStatus('loading');
    setMessage('正在加载导出记录...');
    try {
      const result = await api.listHtmlVideoProjectExports(workflowId);
      if (!mountedRef.current) return null;
      setExportsList(getExports(result));
      setStatus('ready');
      setMessage('导出记录已刷新。');
      return result;
    } catch (error) {
      if (!mountedRef.current) return null;
      setFailure(error, '加载导出记录失败。');
      return null;
    } finally {
      loadingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [workflowId, api, setFailure]);

  const exportProject = useCallback((payload = {}) => (
    runMutatingAction({
      nextStatus: 'exporting',
      loadingMessage: STATUS_MESSAGES.exporting,
      successMessage: '成片已导出。',
      fallbackMessage: '导出成片失败。',
      action: async () => {
        const result = await api.exportHtmlVideoProject(workflowId, payload);
        if (api.listHtmlVideoProjectExports) {
          const exportResult = await api.listHtmlVideoProjectExports(workflowId);
          return { ...result, exports: getExports(exportResult) };
        }
        return result;
      },
    })
  ), [api, workflowId, runMutatingAction]);

  return {
    project,
    frames,
    exportsList,
    selectedFrame,
    selectedFrameId,
    status,
    message,
    loading,
    isMutating,
    disabled: loading || isMutating,
    dirtyRequiresRender,
    load,
    selectFrame: setSelectedFrameId,
    saveTemplateInputs,
    saveFrame,
    applyNaturalLanguageEdit,
    materializeProject,
    renderFramePreview,
    regenerateNarration,
    exportProject,
    refreshExports,
  };
}
