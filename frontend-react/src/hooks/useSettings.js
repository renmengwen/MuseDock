import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const MODEL_TYPES = ['asr', 'text', 'image', 'video', 'tts'];
const DEFAULT_MINIMAX_VOICE_ID = 'Chinese_deep_voiced_male_nv1';

const MODEL_TYPE_INFO = {
  asr:        { title: 'ASR 转写',   placeholder: 'whisper-1 / gpt-4o-transcribe' },
  text:       { title: '分析模型',   placeholder: 'gpt-4o-mini / deepseek-chat' },
  image:      { title: '图片生成',   placeholder: 'seedream-4-0 / gpt-image-2' },
  video:      { title: '视频生成',   placeholder: 'video-model-id' },
  tts:        { title: 'TTS 语音合成', placeholder: 'mimo-v2.5-tts' },
};

const MODEL_PROTOCOLS = [
  { id: 'openai-responses', label: 'OpenAI Responses（/v1/responses）' },
  { id: 'anthropic-messages', label: 'Anthropic Messages（/v1/messages）' },
];

function normalizeServerData(json) {
  const providers = {};
  const raw = json.providers || {};
  for (const [id, p] of Object.entries(raw)) {
    const models = {};
    for (const type of MODEL_TYPES) {
      const m = p.models?.[type] || {};
      models[type] = { enabled: !!m.enabled, modelId: m.modelId || '', note: m.note || '' };
      if (type === 'text') {
        models[type].supportsMultimodal = m.supportsMultimodal === true;
      }
      if (type === 'tts') {
        models[type].voiceId = m.voiceId || DEFAULT_MINIMAX_VOICE_ID;
        models[type].ttsConcurrency = m.ttsConcurrency ?? 1;
        models[type].ttsQueueIntervalMs = m.ttsQueueIntervalMs ?? 1800;
      }
    }
    providers[id] = {
      id,
      name: p.name || id,
      protocol: p.protocol || 'openai-responses',
      apiKey: '',
      apiKeyMasked: p.apiKeyMasked || '',
      hasApiKey: !!p.hasApiKey,
      baseUrl: p.baseUrl || '',
      models,
    };
  }
  return {
    providers,
    active: json.active || {},
    skipValidation: !!json.skipValidation,
  };
}

function toServerPayload(state) {
  const providers = {};
  for (const [id, p] of Object.entries(state.providers)) {
    const models = {};
    for (const type of MODEL_TYPES) {
      const m = p.models[type] || {};
      models[type] = { enabled: !!m.enabled, modelId: m.modelId || '', note: m.note || '' };
      if (type === 'text') {
        models[type].supportsMultimodal = m.supportsMultimodal === true;
      }
      if (type === 'tts') {
        models[type].voiceId = m.voiceId || DEFAULT_MINIMAX_VOICE_ID;
        models[type].ttsConcurrency = m.ttsConcurrency ?? 1;
        models[type].ttsQueueIntervalMs = m.ttsQueueIntervalMs ?? 1800;
      }
    }
    providers[id] = {
      name: p.name || id,
      protocol: p.protocol || 'openai-responses',
      apiKey: p.apiKey || '',
      baseUrl: p.baseUrl || '',
      models,
    };
  }
  return { providers, active: state.active, skipValidation: state.skipValidation };
}

export function useSettings() {
  const [state, setState] = useState({ providers: {}, active: {}, skipValidation: false });
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 页面草稿是否有未写入配置文件的改动（供应商/启用模型/跳过校验）
  const [dirty, setDirty] = useState(false);

  // 成功提示自动消失，避免“配置已加载”这类信息永久驻留
  useEffect(() => {
    if (status?.type !== 'success') return undefined;
    const timer = window.setTimeout(() => {
      setStatus(current => (current?.type === 'success' ? null : current));
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const providerList = useMemo(() => Object.values(state.providers), [state.providers]);

  const activeModels = useMemo(() => {
    const result = {};
    for (const type of MODEL_TYPES) {
      const ref = state.active[type];
      if (!ref) { result[type] = null; continue; }
      const [pid, mtype] = ref.split('/');
      const provider = state.providers[pid];
      if (!provider) { result[type] = null; continue; }
      const model = provider.models[mtype];
      result[type] = { providerId: pid, providerName: provider.name, ...model };
    }
    return result;
  }, [state]);

  const enabledCount = useMemo(() => {
    return MODEL_TYPES.filter(type => activeModels[type]?.enabled).length;
  }, [activeModels]);

  const load = useCallback(async () => {
    setLoading(true);
    setStatus({ type: 'loading', message: '正在读取配置...' });
    try {
      const json = await api.getAiModels();
      setState(normalizeServerData(json));
      setDirty(false);
      setStatus({ type: 'success', message: '配置已加载' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setStatus({ type: 'loading', message: '正在保存配置...' });
    try {
      const payload = toServerPayload(state);
      const json = await api.saveAiModels(payload);
      setState(normalizeServerData(json));
      setDirty(false);
      setStatus({ type: 'success', message: '配置已保存' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  }, [state]);

  const saveProvider = useCallback((provider) => {
    if (!provider?.id) return;
    setDirty(true);
    setState(prev => ({
      ...prev,
      providers: { ...prev.providers, [provider.id]: provider },
    }));
  }, []);

  const removeProvider = useCallback((providerId) => {
    setDirty(true);
    setState(prev => {
      const newProviders = { ...prev.providers };
      delete newProviders[providerId];
      const newActive = { ...prev.active };
      for (const type of MODEL_TYPES) {
        if (newActive[type]?.startsWith(providerId + '/')) {
          newActive[type] = '';
        }
      }
      return { ...prev, providers: newProviders, active: newActive };
    });
  }, []);

  const setActive = useCallback((modelType, providerId, modelTypeKey) => {
    setDirty(true);
    setState(prev => ({
      ...prev,
      active: {
        ...prev.active,
        [modelType]: providerId && modelTypeKey ? `${providerId}/${modelTypeKey}` : '',
      },
    }));
  }, []);

  const setSkipValidation = useCallback((value) => {
    setDirty(true);
    setState(prev => ({ ...prev, skipValidation: !!value }));
  }, []);

  useEffect(() => { load(); }, [load]);

  return {
    state, providerList, activeModels, enabledCount,
    status, loading, saving, dirty,
    load, save,
    saveProvider, removeProvider,
    setActive, setSkipValidation,
    MODEL_TYPES, MODEL_TYPE_INFO,
    MODEL_PROTOCOLS,
  };
}
