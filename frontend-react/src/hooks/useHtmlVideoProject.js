import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveSavedDraftId } from '../components/creative-video-editor/draftResultPayload.mjs';

function getPayload(result) {
  return result?.html_video_project
    || result?.project
    || result?.data?.html_video_project
    || result?.data?.project
    || result?.data
    || result
    || null;
}

function getExports(result) {
  const payload = getPayload(result);
  if (Array.isArray(result?.exports)) return result.exports;
  if (Array.isArray(result?.html_video_project?.exports)) return result.html_video_project.exports;
  if (Array.isArray(payload?.exports)) return payload.exports;
  return [];
}

function getFrameHtml(result) {
  return result?.html || result?.data?.html || '';
}

function getLayoutQa(result) {
  return result?.layout_qa
    || result?.layoutQa
    || result?.data?.layout_qa
    || result?.data?.layoutQa
    || null;
}

function getEditPlan(result) {
  return result?.plan
    || result?.edit_plan
    || result?.editPlan
    || result?.data?.plan
    || result?.data?.edit_plan
    || result?.data?.editPlan
    || null;
}

function getLatestEditPlan(project) {
  const sessions = Array.isArray(project?.edit_sessions) ? project.edit_sessions : [];
  return [...sessions].reverse().find(session => session?.kind === 'edit_plan') || null;
}

function hasExplicitProjectResult(result) {
  return Boolean(result?.html_video_project || result?.project || result?.data?.html_video_project || result?.data?.project);
}

function getErrorCode(error) {
  return error?.data?.code || error?.data?.error_code || error?.code || '';
}

function getFailureStatus(error) {
  const code = getErrorCode(error);
  if (code === 'NO_HTML_VIDEO_PROJECT') return 'no_html_video_project';
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
  exporting: '正在导出成片（合成较慢，请保持页面打开）...',
  tts: '正在重新生成旁白...',
  loading_source: '正在加载当前帧源码...',
  saving_source: '正在保存帧源码草稿...',
  accepting_draft: '正在接受草稿...',
  discarding_draft: '正在放弃草稿...',
  layout_qa: '正在运行布局检查...',
  iterating_frame: '正在重写当前帧 HTML...',
  planning_edit: '正在生成全片编辑计划...',
  running_edit_plan: '正在执行全片编辑计划...',
  accepting_plan: '正在接受计划草稿...',
  discarding_plan: '正在放弃计划草稿...',
  error: '操作失败。',
  not_configured: '渲染环境未配置。',
  needs_validation: '工程需要验证。',
  no_html_video_project: '未找到 html-video 工程。',
};

export function useHtmlVideoProject({ workflowId, api }) {
  const [project, setProject] = useState(null);
  const [exportsList, setExportsList] = useState([]);
  const [selectedFrameId, setSelectedFrameId] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [frameHtml, setFrameHtml] = useState('');
  const [layoutQa, setLayoutQa] = useState(null);
  const [editPlan, setEditPlan] = useState(null);
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

  const applySecondaryResult = useCallback((result = {}) => {
    if (hasExplicitProjectResult(result)) applyProjectResult(result);
    if (result?.requires_render !== undefined) {
      setDirtyRequiresRender(Boolean(result.requires_render));
    }
  }, [applyProjectResult]);

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
    if (nextStatus === 'no_html_video_project') {
      setMessage(STATUS_MESSAGES.no_html_video_project);
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

  useEffect(() => {
    const latestPlan = getLatestEditPlan(project);
    if (latestPlan && !editPlan) setEditPlan(latestPlan);
  }, [project, editPlan]);

  const runMutatingAction = useCallback(async ({
    nextStatus,
    loadingMessage,
    successMessage,
    action,
    fallbackMessage,
    applyResult = true,
    onSuccess,
  }) => {
    if (!workflowId || !api) return null;
    if (mutatingRef.current || loadingRef.current) {
      setMessage('正在处理其他操作，请稍候…');
      return null;
    }
    mutatingRef.current = true;
    setIsMutating(true);
    setStatus(nextStatus);
    setMessage(loadingMessage);
    try {
      const result = await action();
      if (!mountedRef.current) return null;
      if (applyResult) applyProjectResult(result);
      if (typeof onSuccess === 'function') onSuccess(result);
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

  const loadFrameHtml = useCallback((frameId) => (
    runMutatingAction({
      nextStatus: 'loading_source',
      loadingMessage: STATUS_MESSAGES.loading_source,
      successMessage: '当前帧源码已加载。',
      fallbackMessage: '加载当前帧源码失败。',
      applyResult: false,
      action: () => api.getHtmlVideoProjectFrameHtml(workflowId, frameId),
      onSuccess: (result) => {
        applySecondaryResult(result);
        setFrameHtml(getFrameHtml(result));
      },
    })
  ), [api, workflowId, runMutatingAction, applySecondaryResult]);

  const saveFrameHtmlDraft = useCallback((frameId, payload) => (
    runMutatingAction({
      nextStatus: 'saving_source',
      loadingMessage: STATUS_MESSAGES.saving_source,
      successMessage: '帧源码草稿已保存，可渲染单帧预览。',
      fallbackMessage: '保存帧源码草稿失败。',
      applyResult: false,
      action: () => api.saveHtmlVideoProjectFrameHtml(workflowId, frameId, payload),
      onSuccess: applySecondaryResult,
    })
  ), [api, workflowId, runMutatingAction, applySecondaryResult]);

  const acceptFrameDraft = useCallback((frameId, draftId) => (
    runMutatingAction({
      nextStatus: 'accepting_draft',
      loadingMessage: STATUS_MESSAGES.accepting_draft,
      successMessage: '草稿已接受，需要重新导出成片。',
      fallbackMessage: '接受草稿失败。',
      applyResult: false,
      action: () => api.acceptHtmlVideoProjectFrameDraft(workflowId, frameId, draftId),
      onSuccess: applySecondaryResult,
    })
  ), [api, workflowId, runMutatingAction, applySecondaryResult]);

  const saveAndAcceptFrameEdit = useCallback(async (frameId, payload) => {
    // 画布所见即所得：存草稿 + 立即接受，对用户合并成「保存修改」一步。
    const saved = await saveFrameHtmlDraft(frameId, payload);
    if (!saved || saved.success === false) return saved;
    const draftId = resolveSavedDraftId(saved, frameId);
    if (!draftId) {
      setFailure(new Error('保存修改失败：未获取到草稿 id。'), '保存修改失败。');
      return null;
    }
    const accepted = await acceptFrameDraft(frameId, draftId);
    if (!accepted || accepted.success === false) {
      // 草稿已写入但应用失败，明确告知用户处于中间态，避免误以为改动全部丢失。
      setMessage('修改已保存为草稿，但应用到成片失败，请重试“保存修改”。');
    }
    return accepted;
  }, [saveFrameHtmlDraft, acceptFrameDraft, setFailure]);

  const discardFrameDraft = useCallback((frameId, draftId) => (
    runMutatingAction({
      nextStatus: 'discarding_draft',
      loadingMessage: STATUS_MESSAGES.discarding_draft,
      successMessage: '草稿已放弃。',
      fallbackMessage: '放弃草稿失败。',
      applyResult: false,
      action: () => api.discardHtmlVideoProjectFrameDraft(workflowId, frameId, draftId),
      onSuccess: applySecondaryResult,
    })
  ), [api, workflowId, runMutatingAction, applySecondaryResult]);

  const inspectLayout = useCallback((payload = {}) => {
    const nextPayload = typeof payload === 'string' ? { frame_id: payload } : payload;
    return runMutatingAction({
      nextStatus: 'layout_qa',
      loadingMessage: STATUS_MESSAGES.layout_qa,
      successMessage: '布局检查完成。',
      fallbackMessage: '布局检查失败。',
      applyResult: false,
      action: () => api.inspectHtmlVideoProjectLayout(workflowId, nextPayload),
      onSuccess: (result) => {
        applySecondaryResult(result);
        setLayoutQa(getLayoutQa(result));
      },
    });
  }, [api, workflowId, runMutatingAction, applySecondaryResult]);

  const iterateFrame = useCallback((frameId, payload) => (
    runMutatingAction({
      nextStatus: 'iterating_frame',
      loadingMessage: STATUS_MESSAGES.iterating_frame,
      successMessage: '当前帧草稿已生成。',
      fallbackMessage: '重写当前帧 HTML 失败。',
      applyResult: false,
      action: () => api.iterateHtmlVideoProjectFrame(workflowId, frameId, payload),
      onSuccess: (result) => {
        applySecondaryResult(result);
        setLayoutQa(getLayoutQa(result));
        if (getFrameHtml(result)) setFrameHtml(getFrameHtml(result));
      },
    })
  ), [api, workflowId, runMutatingAction, applySecondaryResult]);

  const createEditPlan = useCallback((payload) => (
    runMutatingAction({
      nextStatus: 'planning_edit',
      loadingMessage: STATUS_MESSAGES.planning_edit,
      successMessage: '全片编辑计划已生成，请确认后执行。',
      fallbackMessage: '生成全片编辑计划失败。',
      applyResult: false,
      action: () => api.createHtmlVideoProjectEditPlan(workflowId, payload),
      onSuccess: (result) => {
        applySecondaryResult(result);
        setEditPlan(getEditPlan(result));
      },
    })
  ), [api, workflowId, runMutatingAction, applySecondaryResult]);

  const runEditPlan = useCallback((planId, payload) => (
    runMutatingAction({
      nextStatus: 'running_edit_plan',
      loadingMessage: STATUS_MESSAGES.running_edit_plan,
      successMessage: '全片编辑计划已执行，草稿已生成。',
      fallbackMessage: '执行全片编辑计划失败。',
      applyResult: false,
      action: () => api.runHtmlVideoProjectEditPlan(workflowId, planId, payload),
      onSuccess: (result) => {
        applySecondaryResult(result);
        setEditPlan(getEditPlan(result));
        setLayoutQa(getLayoutQa(result));
      },
    })
  ), [api, workflowId, runMutatingAction, applySecondaryResult]);

  const acceptEditPlan = useCallback((planId) => (
    runMutatingAction({
      nextStatus: 'accepting_plan',
      loadingMessage: STATUS_MESSAGES.accepting_plan,
      successMessage: '计划草稿已接受，需要重新导出成片。',
      fallbackMessage: '接受计划草稿失败。',
      applyResult: false,
      action: () => api.acceptHtmlVideoProjectEditPlan(workflowId, planId),
      onSuccess: (result) => {
        applySecondaryResult(result);
        setEditPlan(getEditPlan(result));
      },
    })
  ), [api, workflowId, runMutatingAction, applySecondaryResult]);

  const discardEditPlan = useCallback((planId) => (
    runMutatingAction({
      nextStatus: 'discarding_plan',
      loadingMessage: STATUS_MESSAGES.discarding_plan,
      successMessage: '计划草稿已放弃。',
      fallbackMessage: '放弃计划草稿失败。',
      applyResult: false,
      action: () => api.discardHtmlVideoProjectEditPlan(workflowId, planId),
      onSuccess: (result) => {
        applySecondaryResult(result);
        setEditPlan(getEditPlan(result));
      },
    })
  ), [api, workflowId, runMutatingAction, applySecondaryResult]);

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

  const renderFramePreview = useCallback((frameId, payload = {}) => (
    runMutatingAction({
      nextStatus: 'rendering',
      loadingMessage: STATUS_MESSAGES.rendering,
      successMessage: '单帧预览已渲染。',
      fallbackMessage: '渲染单帧预览失败。',
      action: () => api.renderHtmlVideoProject(workflowId, { ...payload, mode: 'frame', frame_id: frameId }),
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

  const getExportPlaybackUrl = useCallback((exportItem) => {
    const directUrl = exportItem?.url || exportItem?.output_url || exportItem?.playback_url || '';
    if (directUrl) return directUrl;
    const exportId = exportItem?.id;
    if (!workflowId || !exportId || !api?.getHtmlVideoProjectExportFileUrl) return '';
    return api.getHtmlVideoProjectExportFileUrl(workflowId, exportId);
  }, [api, workflowId]);

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
    workflowId,
    frames,
    exportsList,
    selectedFrame,
    selectedFrameId,
    status,
    message,
    loading,
    isMutating,
    frameHtml,
    layoutQa,
    editPlan,
    disabled: loading || isMutating,
    dirtyRequiresRender,
    load,
    selectFrame: setSelectedFrameId,
    loadFrameHtml,
    saveFrameHtmlDraft,
    saveAndAcceptFrameEdit,
    acceptFrameDraft,
    discardFrameDraft,
    inspectLayout,
    iterateFrame,
    createEditPlan,
    runEditPlan,
    acceptEditPlan,
    discardEditPlan,
    saveTemplateInputs,
    saveFrame,
    applyNaturalLanguageEdit,
    materializeProject,
    renderFramePreview,
    regenerateNarration,
    exportProject,
    refreshExports,
    getExportPlaybackUrl,
  };
}
