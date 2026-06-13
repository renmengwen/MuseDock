import { useCallback, useEffect, useState } from 'react';

export function useCreativeVideoEditor({ workflowId, api }) {
  const [sceneSpec, setSceneSpec] = useState(null);
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedScene = sceneSpec?.scenes?.find(s => s.id === selectedSceneId) || null;

  const load = useCallback(async () => {
    if (!workflowId || !api) return;
    setLoading(true);
    setStatus('loading');
    setMessage('正在加载可编辑场景...');
    try {
      const result = await api.getCreativeWorkflowSceneSpec(workflowId);
      setSceneSpec(result.scene_spec);
      if (result.scene_spec?.scenes?.length > 0 && !selectedSceneId) {
        setSelectedSceneId(result.scene_spec.scenes[0].id);
      }
      setStatus('ready');
      setMessage('');
    } catch (error) {
      setStatus('error');
      setMessage(error.message || '加载场景规格失败');
    } finally {
      setLoading(false);
    }
  }, [workflowId, api, selectedSceneId]);

  useEffect(() => {
    load();
  }, [workflowId]);

  const selectScene = useCallback((sceneId) => {
    setSelectedSceneId(sceneId);
  }, []);

  const applyPatch = useCallback(async (edit) => {
    if (!workflowId || !api) return;
    setSaving(true);
    setStatus('saving');
    setMessage('正在保存编辑...');
    try {
      const result = await api.patchCreativeWorkflowSceneSpec(workflowId, edit);
      setSceneSpec(result.scene_spec);
      setStatus('ready');
      setMessage('编辑已保存');
    } catch (error) {
      setStatus('error');
      setMessage(error.message || '保存编辑失败');
    } finally {
      setSaving(false);
    }
  }, [workflowId, api]);

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
    const ids = sceneSpec.scenes.map(s => s.id);
    const index = ids.indexOf(sceneId);
    if (index < 0) return;
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= ids.length) return;
    const newIds = [...ids];
    [newIds[index], newIds[newIndex]] = [newIds[newIndex], newIds[index]];
    await applyPatch({ type: 'reorder_scenes', scene_ids: newIds });
  }, [sceneSpec, applyPatch]);

  const rewriteScene = useCallback(async (sceneId, payload) => {
    if (!workflowId || !api) return;
    setSaving(true);
    setStatus('rewriting');
    setMessage('正在重写本场景...');
    try {
      const result = await api.rewriteCreativeWorkflowScene(workflowId, sceneId, payload);
      setSceneSpec(result.scene_spec);
      setStatus('ready');
      setMessage('场景已重写');
    } catch (error) {
      setStatus('error');
      setMessage(error.message || '重写场景失败');
    } finally {
      setSaving(false);
    }
  }, [workflowId, api]);

  const ttsScene = useCallback(async (sceneId, payload) => {
    if (!workflowId || !api) return;
    setSaving(true);
    setStatus('tts');
    setMessage('正在重新配音本场景...');
    try {
      await api.ttsCreativeWorkflowScene(workflowId, sceneId, payload);
      setStatus('ready');
      setMessage('配音完成');
    } catch (error) {
      setStatus('error');
      setMessage(error.message || '重新配音失败');
    } finally {
      setSaving(false);
    }
  }, [workflowId, api]);

  const rerender = useCallback(async (payload) => {
    if (!workflowId || !api) return;
    setSaving(true);
    setStatus('rerendering');
    setMessage('正在重新渲染成片...');
    try {
      const result = await api.rerenderCreativeWorkflow(workflowId, payload);
      setStatus('ready');
      setMessage(result.message || '成片已重新渲染');
    } catch (error) {
      setStatus('error');
      setMessage(error.message || '重新渲染失败');
    } finally {
      setSaving(false);
    }
  }, [workflowId, api]);

  return {
    sceneSpec,
    selectedSceneId,
    selectedScene,
    status,
    message,
    loading,
    saving,
    load,
    selectScene,
    saveCaptionText,
    saveNarrationText,
    saveVisualText,
    saveDuration,
    moveScene,
    rewriteScene,
    ttsScene,
    rerender,
  };
}
