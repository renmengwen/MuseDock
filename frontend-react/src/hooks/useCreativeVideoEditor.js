import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function useCreativeVideoEditor({ workflowId, api }) {
  const [sceneSpec, setSceneSpec] = useState(null);
  const [frameSpecs, setFrameSpecs] = useState({ frames: [] });
  const [renderVersions, setRenderVersions] = useState([]);
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [selectedFrameId, setSelectedFrameId] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirtyRequiresRender, setDirtyRequiresRender] = useState(false);
  const mountedRef = useRef(true);
  const loadingRef = useRef(false);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const selectedScene = useMemo(
    () => sceneSpec?.scenes?.find(scene => scene.id === selectedSceneId) || null,
    [sceneSpec, selectedSceneId],
  );
  const selectedFrame = useMemo(
    () => frameSpecs?.frames?.find(frame => frame.id === selectedFrameId) || null,
    [frameSpecs, selectedFrameId],
  );

  const applySpecResult = useCallback((result = {}) => {
    if (result.scene_spec) setSceneSpec(result.scene_spec);
    if (result.frame_specs) setFrameSpecs(result.frame_specs);
    if (Array.isArray(result.render_versions)) setRenderVersions(result.render_versions);
  }, []);

  const load = useCallback(async () => {
    if (!workflowId || !api || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setStatus('loading');
    setMessage('正在加载可编辑工程...');
    try {
      const result = api.getCreativeVideoSpec
        ? await api.getCreativeVideoSpec(workflowId)
        : await api.getCreativeWorkflowSceneSpec(workflowId);
      if (!mountedRef.current) return;
      applySpecResult(result);
      setStatus('ready');
      setMessage('可编辑工程已加载。');
    } catch (error) {
      if (!mountedRef.current) return;
      setStatus('error');
      setMessage(error.message || '加载可编辑工程失败。');
    } finally {
      loadingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [workflowId, api, applySpecResult]);

  useEffect(() => {
    load();
  }, [workflowId, load]);

  useEffect(() => {
    if (sceneSpec?.scenes?.length > 0 && !selectedSceneId) {
      setSelectedSceneId(sceneSpec.scenes[0].id);
    }
  }, [sceneSpec, selectedSceneId]);

  useEffect(() => {
    if (frameSpecs?.frames?.length > 0 && !selectedFrameId) {
      setSelectedFrameId(frameSpecs.frames[0].id);
    }
  }, [frameSpecs, selectedFrameId]);

  const selectScene = useCallback((sceneId) => {
    setSelectedSceneId(sceneId);
    const firstFrame = frameSpecs?.frames?.find(frame => frame.scene_id === sceneId);
    if (firstFrame) setSelectedFrameId(firstFrame.id);
  }, [frameSpecs]);

  const selectFrame = useCallback((frameId) => {
    setSelectedFrameId(frameId);
    const frame = frameSpecs?.frames?.find(item => item.id === frameId);
    if (frame?.scene_id) setSelectedSceneId(frame.scene_id);
  }, [frameSpecs]);

  const saveVideoSpec = useCallback(async (payload) => {
    if (!workflowId || !api || saving || loading) return null;
    setSaving(true);
    setStatus('saving');
    setMessage('正在保存编辑...');
    try {
      const result = api.patchCreativeVideoSpec
        ? await api.patchCreativeVideoSpec(workflowId, payload)
        : await api.patchCreativeWorkflowSceneSpec(workflowId, payload);
      if (!mountedRef.current) return null;
      applySpecResult(result);
      const requiresRender = result.requires_render !== false;
      setDirtyRequiresRender(requiresRender);
      setStatus('ready');
      setMessage(requiresRender ? '内容已修改，需要重新渲染后才会更新成片。' : '编辑已保存。');
      return result;
    } catch (error) {
      if (!mountedRef.current) return null;
      setStatus('error');
      setMessage(error.message || '保存编辑失败。');
      return null;
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [workflowId, api, saving, loading, applySpecResult]);

  const saveSceneEdit = useCallback(async (sceneId, patch) => {
    const scenes = (sceneSpec?.scenes || []).map(scene => (
      scene.id === sceneId ? { ...scene, ...patch } : scene
    ));
    return saveVideoSpec({
      scene_spec: { ...(sceneSpec || {}), scenes },
      frame_specs: frameSpecs,
    });
  }, [sceneSpec, frameSpecs, saveVideoSpec]);

  const saveFrameEdit = useCallback(async (frameId, patch) => {
    const frames = (frameSpecs?.frames || []).map(frame => (
      frame.id === frameId ? { ...frame, ...patch } : frame
    ));
    return saveVideoSpec({
      scene_spec: sceneSpec,
      frame_specs: { ...(frameSpecs || {}), frames },
    });
  }, [sceneSpec, frameSpecs, saveVideoSpec]);

  const applyPatch = useCallback(async (edit) => {
    if (api?.patchCreativeVideoSpec) {
      return saveVideoSpec({ edit, scene_spec: sceneSpec, frame_specs: frameSpecs });
    }
    return saveVideoSpec(edit);
  }, [api, sceneSpec, frameSpecs, saveVideoSpec]);

  const saveCaptionText = useCallback(async (sceneId, captionId, text) => {
    await applyPatch({ type: 'caption_text', scene_id: sceneId, caption_id: captionId, text });
  }, [applyPatch]);

  const saveNarrationText = useCallback(async (sceneId, text) => {
    await applyPatch({ type: 'narration_text', scene_id: sceneId, text });
  }, [applyPatch]);

  const saveVisualText = useCallback(async (sceneId, visual_text) => {
    await applyPatch({ type: 'visual_text', scene_id: sceneId, visual_text });
  }, [applyPatch]);

  const saveDuration = useCallback(async (sceneId, duration) => {
    await applyPatch({ type: 'duration', scene_id: sceneId, duration });
  }, [applyPatch]);

  const moveScene = useCallback(async (sceneId, direction) => {
    if (!sceneSpec?.scenes) return;
    const ids = sceneSpec.scenes.map(scene => scene.id);
    const index = ids.indexOf(sceneId);
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || newIndex < 0 || newIndex >= ids.length) return;
    const nextIds = [...ids];
    [nextIds[index], nextIds[newIndex]] = [nextIds[newIndex], nextIds[index]];
    await applyPatch({ type: 'reorder_scenes', scene_ids: nextIds });
  }, [sceneSpec, applyPatch]);

  const rewriteScene = useCallback(async (sceneId, payload) => {
    if (!workflowId || !api || saving || loading) return;
    setSaving(true);
    setStatus('rewriting');
    setMessage('正在重写本场景...');
    try {
      const result = await api.rewriteCreativeWorkflowScene(workflowId, sceneId, payload);
      if (!mountedRef.current) return;
      applySpecResult(result);
      setDirtyRequiresRender(result.requires_render !== false);
      setStatus('ready');
      setMessage('场景已重写，内容已修改，需要重新渲染后才会更新成片。');
    } catch (error) {
      if (!mountedRef.current) return;
      setStatus('error');
      setMessage(error.message || '重写场景失败。');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [workflowId, api, saving, loading, applySpecResult]);

  const ttsScene = useCallback(async (sceneId, payload) => {
    if (!workflowId || !api || saving || loading) return;
    setSaving(true);
    setStatus('tts');
    setMessage('正在重新配音本场景...');
    try {
      const result = await api.ttsCreativeWorkflowScene(workflowId, sceneId, payload);
      if (!mountedRef.current) return;
      applySpecResult(result);
      setStatus('ready');
      setMessage('配音完成。');
    } catch (error) {
      if (!mountedRef.current) return;
      setStatus('error');
      setMessage(error.message || '重新配音失败。');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [workflowId, api, saving, loading, applySpecResult]);

  const rerender = useCallback(async (payload) => {
    if (!workflowId || !api || saving || loading) return;
    setSaving(true);
    setStatus('rerendering');
    setMessage('正在重新渲染...');
    try {
      const result = api.rerenderCreativeVideo
        ? await api.rerenderCreativeVideo(workflowId, payload)
        : await api.rerenderCreativeWorkflow(workflowId, payload);
      if (!mountedRef.current) return;
      applySpecResult(result);
      setDirtyRequiresRender(false);
      setStatus('ready');
      setMessage(result.message || '成片已重新渲染。');
    } catch (error) {
      if (!mountedRef.current) return;
      setStatus('error');
      setMessage(error.message || '重新渲染失败。');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [workflowId, api, saving, loading, applySpecResult]);

  const remix = useCallback(async (payload) => {
    if (!workflowId || !api || saving || loading) return null;
    setSaving(true);
    setStatus('remixing');
    setMessage('正在创建二创版本...');
    try {
      const result = await api.remixCreativeVideo(workflowId, payload);
      if (!mountedRef.current) return null;
      setStatus('ready');
      setMessage(result.message || '二创版本已创建。');
      return result;
    } catch (error) {
      if (!mountedRef.current) return null;
      setStatus('error');
      setMessage(error.message || '创建二创版本失败。');
      return null;
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [workflowId, api, saving, loading]);

  return {
    sceneSpec,
    frameSpecs,
    renderVersions,
    selectedSceneId,
    selectedFrameId,
    selectedScene,
    selectedFrame,
    status,
    message,
    loading,
    saving,
    load,
    selectScene,
    selectFrame,
    saveSceneEdit,
    saveFrameEdit,
    saveCaptionText,
    saveNarrationText,
    saveVisualText,
    saveDuration,
    moveScene,
    rewriteScene,
    ttsScene,
    rerender,
    remix,
    dirtyRequiresRender,
  };
}
