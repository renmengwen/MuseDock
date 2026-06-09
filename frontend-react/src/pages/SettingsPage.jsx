import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { Status } from '../components/Status.jsx';

const MODEL_TYPES = [
  {
    key: 'asr',
    title: 'ASR 转写模型',
    description: '用于音频转文字、视频口播转写和后续字幕素材生成。',
    modelPlaceholder: 'whisper-1 / gpt-4o-transcribe',
  },
  {
    key: 'text',
    title: '文字大模型',
    description: '用于标题、脚本、评论洞察、内容改写和文案生成。',
    modelPlaceholder: 'gpt-4o-mini / deepseek-chat',
  },
  {
    key: 'image',
    title: '图片生成模型',
    description: '用于封面图、配图、分镜草图和视觉素材生成。',
    modelPlaceholder: 'gpt-image-1',
  },
  {
    key: 'video',
    title: '视频生成模型',
    description: '用于短视频片段、动态素材和镜头生成。',
    modelPlaceholder: 'video-model-id',
  },
  {
    key: 'multimodal',
    title: '多模态大模型',
    description: '用于理解图片、视频帧、文本和评论等混合素材。',
    modelPlaceholder: 'gpt-4o / qwen-vl',
  },
  {
    key: 'tts',
    title: 'TTS 语音合成模型',
    description: '用于把 AI 工作台生成的改写脚本合成为口播音频，当前支持 MiMo TTS v2.5。',
    modelPlaceholder: 'mimo-v2.5-tts',
  },
];

const DEFAULT_MODEL = {
  enabled: false,
  provider: '',
  apiKey: '',
  apiKeyMasked: '',
  hasApiKey: false,
  baseUrl: '',
  modelId: '',
  note: '',
  ttsConcurrency: 1,
  ttsQueueIntervalMs: 1800,
};

function createEmptyForm() {
  return MODEL_TYPES.reduce((acc, item) => {
    acc[item.key] = { ...DEFAULT_MODEL };
    return acc;
  }, {});
}

function normalizeIncoming(models = {}) {
  const form = createEmptyForm();
  for (const item of MODEL_TYPES) {
    form[item.key] = {
      ...DEFAULT_MODEL,
      ...(models[item.key] || {}),
      apiKey: '',
    };
  }
  return form;
}

export function SettingsPage() {
  const [form, setForm] = useState(() => createEmptyForm());
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const enabledCount = useMemo(() => {
    return MODEL_TYPES.filter(item => form[item.key]?.enabled).length;
  }, [form]);

  useEffect(() => {
    loadConfig().catch(() => {});
  }, []);

  async function loadConfig() {
    setLoading(true);
    setStatus({ type: 'loading', message: '正在读取模型配置...' });
    try {
      const json = await api.getAiModels();
      setForm(normalizeIncoming(json.models));
      setStatus({ type: 'success', message: '模型配置已加载' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  }

  function updateModel(type, field, value) {
    setForm(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        [field]: value,
      },
    }));
  }

  async function saveConfig() {
    setSaving(true);
    setStatus({ type: 'loading', message: '正在保存模型配置...' });
    try {
      const payload = {
        models: MODEL_TYPES.reduce((acc, item) => {
          const model = form[item.key] || DEFAULT_MODEL;
          acc[item.key] = {
            enabled: !!model.enabled,
            provider: model.provider,
            apiKey: model.apiKey,
            baseUrl: model.baseUrl,
            modelId: model.modelId,
            note: model.note,
          };
          if (item.key === 'tts') {
            acc[item.key].ttsConcurrency = Number(model.ttsConcurrency) || 1;
            acc[item.key].ttsQueueIntervalMs = Number(model.ttsQueueIntervalMs) || 0;
          }
          return acc;
        }, {}),
      };
      const json = await api.saveAiModels(payload);
      setForm(normalizeIncoming(json.models));
      setStatus({ type: 'success', message: '模型配置已保存' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="container">
      <div className="workspaceIntro">
        <div>
          <h2>设置</h2>
          <p>配置本地工作流使用的大模型能力，不同用途可以绑定不同供应商、Base URL 和模型 ID。</p>
        </div>
        <div className="settingsSummary">
          <strong>{enabledCount}</strong>
          <span>已启用</span>
        </div>
      </div>

      <Status status={status} />
      {loading || saving ? <div className="pageLoading">{saving ? '正在写入配置...' : '正在加载配置...'}</div> : null}

      <section className="settingsPanel">
        <div className="settingsPanelHeader">
          <div>
            <h3>大模型配置</h3>
            <p>API Key 保存到本地配置文件；再次编辑时留空表示保留原 Key。</p>
          </div>
          <div className="settingsActions">
            <button className="btn secondary" disabled={loading || saving} onClick={loadConfig}>重新加载</button>
            <button className="btn primary" disabled={loading || saving} onClick={saveConfig}>保存配置</button>
          </div>
        </div>

        <div className="modelConfigGrid">
          {MODEL_TYPES.map(item => {
            const model = form[item.key] || DEFAULT_MODEL;
            return (
              <article className="modelConfigCard" key={item.key}>
                <div className="modelConfigHeader">
                  <div>
                    <h4>{item.title}</h4>
                    <p>{item.description}</p>
                  </div>
                  <label className="switchControl">
                    <input
                      type="checkbox"
                      checked={!!model.enabled}
                      onChange={event => updateModel(item.key, 'enabled', event.target.checked)}
                    />
                    <span className="switchTrack" aria-hidden="true">
                      <span className="switchThumb" />
                    </span>
                    <span className="switchText">{model.enabled ? '已启用' : '已停用'}</span>
                  </label>
                </div>

                <div className="settingsFormGrid">
                  <label>
                    <span>供应商</span>
                    <input
                      value={model.provider}
                      onChange={event => updateModel(item.key, 'provider', event.target.value)}
                      placeholder="OpenAI / DeepSeek / 自定义"
                    />
                  </label>
                  <label>
                    <span>模型 ID</span>
                    <input
                      value={model.modelId}
                      onChange={event => updateModel(item.key, 'modelId', event.target.value)}
                      placeholder={item.modelPlaceholder}
                    />
                  </label>
                  <label className="settingsWideField">
                    <span>Base URL</span>
                    <input
                      value={model.baseUrl}
                      onChange={event => updateModel(item.key, 'baseUrl', event.target.value)}
                      placeholder="https://api.example.com/v1"
                    />
                  </label>
                  <label className="settingsWideField">
                    <span>API Key</span>
                    <input
                      type="password"
                      value={model.apiKey}
                      onChange={event => updateModel(item.key, 'apiKey', event.target.value)}
                      placeholder={model.hasApiKey ? `已保存 ${model.apiKeyMasked}` : '请输入 API Key'}
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="settingsWideField">
                    <span>备注</span>
                    <input
                      value={model.note}
                      onChange={event => updateModel(item.key, 'note', event.target.value)}
                      placeholder="例如：用于本地素材分析 / 高质量生成 / 备用通道"
                    />
                  </label>
                  {item.key === 'tts' ? (
                    <>
                      <label>
                        <span>TTS 并发数</span>
                        <input
                          type="number"
                          min="1"
                          max="5"
                          step="1"
                          value={model.ttsConcurrency}
                          onChange={event => updateModel(item.key, 'ttsConcurrency', event.target.value)}
                          placeholder="1"
                        />
                      </label>
                      <label>
                        <span>TTS 请求间隔（毫秒）</span>
                        <input
                          type="number"
                          min="0"
                          max="10000"
                          step="100"
                          value={model.ttsQueueIntervalMs}
                          onChange={event => updateModel(item.key, 'ttsQueueIntervalMs', event.target.value)}
                          placeholder="1800"
                        />
                      </label>
                    </>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
