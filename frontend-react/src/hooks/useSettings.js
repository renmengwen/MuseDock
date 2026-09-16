import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { BUILTIN_FUNASR_REF, DEFAULT_FUNASR_BASE_URL } from '../components/settings/modelDefaults.js';

const MODEL_TYPES = ['asr', 'text', 'image', 'video', 'tts'];
const DEFAULT_MINIMAX_VOICE_ID = 'Chinese_deep_voiced_male_nv1';

const MODEL_TYPE_INFO = {
  asr:        { title: 'ASR 转写' },
  text:       { title: '分析模型' },
  image:      { title: '图片生成' },
  video:      { title: '视频生成' },
  tts:        { title: 'TTS 语音合成' },
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
      if (type === 'asr') models[type].backend = m.backend || 'mimo';
      if (type === 'text') {
        models[type].supportsMultimodal = m.supportsMultimodal === true;
      }
      if (type === 'tts') {
        models[type].voiceId = m.voiceId || DEFAULT_MINIMAX_VOICE_ID;
        models[type].ttsConcurrency = m.ttsConcurrency ?? 1;
        models[type].ttsQueueIntervalMs = m.ttsQueueIntervalMs ?? 1800;
        models[type].doubao = { ...m.doubao };
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
    active: { ...json.active, asr: json.active?.asr || BUILTIN_FUNASR_REF },
    skipValidation: !!json.skipValidation,
    localAsr: { baseUrl: json.localAsr?.baseUrl || DEFAULT_FUNASR_BASE_URL,
      pythonPath: json.localAsr?.pythonPath || '', modelCache: json.localAsr?.modelCache || '' },
  };
}

function toServerPayload(state) {
  const providers = {};
  for (const [id, p] of Object.entries(state.providers)) {
    const models = {};
    for (const type of MODEL_TYPES) {
      const m = p.models[type] || {};
      models[type] = { enabled: !!m.enabled, modelId: m.modelId || '', note: m.note || '' };
      if (type === 'asr') models[type].backend = m.backend || 'mimo';
      if (type === 'text') {
        models[type].supportsMultimodal = m.supportsMultimodal === true;
      }
      if (type === 'tts') {
        models[type].voiceId = m.voiceId || DEFAULT_MINIMAX_VOICE_ID;
        models[type].ttsConcurrency = m.ttsConcurrency ?? 1;
        models[type].ttsQueueIntervalMs = m.ttsQueueIntervalMs ?? 1800;
        models[type].doubao = { ...m.doubao };
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
  return { providers, active: state.active, skipValidation: state.skipValidation, localAsr: state.localAsr };
}

export function useSettings() {
  const [state, setState] = useState({ providers: {}, active: { asr: BUILTIN_FUNASR_REF }, skipValidation: false,
    localAsr: { baseUrl: DEFAULT_FUNASR_BASE_URL, pythonPath: '', modelCache: '' } });
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
      if (type === 'asr' && ref === BUILTIN_FUNASR_REF) {
        result[type] = { ref, builtin: true, providerId: 'builtin', providerName: 'FunASR（本地）',
          enabled: true, modelId: 'paraformer', backend: 'funasr' };
        continue;
      }
      if (!ref) { result[type] = null; continue; }
      const [pid, mtype] = ref.split('/');
      const provider = state.providers[pid];
      if (!provider) { result[type] = null; continue; }
      const model = provider.models[mtype];
      result[type] = { ref, providerId: pid, providerName: provider.name, ...model };
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
          newActive[type] = type === 'asr' ? BUILTIN_FUNASR_REF : '';
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
        [modelType]: providerId && modelTypeKey ? `${providerId}/${modelTypeKey}` : modelType === 'asr' ? BUILTIN_FUNASR_REF : '',
      },
    }));
  }, []);

  const setSkipValidation = useCallback((value) => {
    setDirty(true);
    setState(prev => ({ ...prev, skipValidation: !!value }));
  }, []);

  const setLocalAsrBaseUrl = useCallback((baseUrl) => {
    setDirty(true);
    setState(prev => ({ ...prev, localAsr: { ...prev.localAsr, baseUrl } }));
  }, []);

  const setLocalAsrPythonPath = useCallback((pythonPath) => {
    setDirty(true);
    setState(prev => ({ ...prev, localAsr: { ...prev.localAsr, pythonPath } }));
  }, []);

  const setLocalAsrModelCache = useCallback((modelCache) => {
    setDirty(true);
    setState(prev => ({ ...prev, localAsr: { ...prev.localAsr, modelCache } }));
  }, []);

  useEffect(() => { load(); }, [load]);

  return {
    state, providerList, activeModels, enabledCount,
    status, loading, saving, dirty,
    load, save,
    saveProvider, removeProvider,
    setActive, setSkipValidation, setLocalAsrBaseUrl, setLocalAsrPythonPath, setLocalAsrModelCache,
    MODEL_TYPES, MODEL_TYPE_INFO,
    MODEL_PROTOCOLS,
  };
}
