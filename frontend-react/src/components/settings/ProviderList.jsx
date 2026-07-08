import { useEffect, useState } from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ModelConfigForm } from './ModelConfigForm.jsx';

function enabledModelSummary(provider, modelTypes, modelTypeInfo) {
  const enabled = modelTypes
    .map(type => {
      const model = provider.models?.[type];
      if (!model?.enabled || !model?.modelId) return null;
      return `${modelTypeInfo[type]?.title || type}：${model.modelId}`;
    })
    .filter(Boolean);
  return enabled.length ? enabled.join(' · ') : '未启用模型';
}

function emptyProvider(id, modelTypes) {
  const models = {};
  for (const type of modelTypes) {
    models[type] = { enabled: false, modelId: '', note: '' };
    if (type === 'text') models[type].supportsMultimodal = false;
    if (type === 'tts') {
      models[type].ttsConcurrency = 1;
      models[type].ttsQueueIntervalMs = 1800;
    }
  }
  return { id, name: '', protocol: 'openai-responses', apiKey: '', baseUrl: '', models };
}

function protocolLabel(provider, modelProtocols) {
  return modelProtocols.find(item => item.id === provider.protocol)?.label || 'OpenAI Responses（/v1/responses）';
}

function ProviderDetail({ provider, modelTypes, modelTypeInfo, modelProtocols = [], onUpdate, onUpdateModel }) {
  const p = provider;
  const setProtocol = (protocol) => {
    onUpdate('protocol', protocol);
    if (!p.baseUrl) {
      onUpdate('baseUrl', protocol === 'anthropic-messages' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1');
    }
  };
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#5f6876]">供应商名称</span>
          <input
            className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15"
            value={p.name}
            onChange={e => onUpdate('name', e.target.value)}
            placeholder="供应商名称"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#5f6876]">分析模型协议</span>
          <select
            className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15"
            value={p.protocol || 'openai-responses'}
            onChange={e => setProtocol(e.target.value)}
          >
            {modelProtocols.map(protocol => (
              <option key={protocol.id} value={protocol.id}>{protocol.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#5f6876]">Base URL</span>
          <input
            className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15"
            value={p.baseUrl}
            onChange={e => onUpdate('baseUrl', e.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </label>
        <label className="grid gap-1.5 max-[720px]:col-span-1 md:col-span-2">
          <span className="text-xs font-semibold text-[#5f6876]">API Key</span>
          <input
            type="password"
            className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15"
            value={p.apiKey}
            onChange={e => onUpdate('apiKey', e.target.value)}
            placeholder={p.hasApiKey ? `已保存 ${p.apiKeyMasked}` : '请输入 API Key'}
            autoComplete="new-password"
          />
        </label>
      </div>
      <p className="m-0 text-xs font-semibold text-[#69717e]">协议仅影响分析模型；ASR、TTS 等语音接口仍按各自供应商配置调用。</p>

      <div className="grid grid-cols-2 gap-3 max-[1100px]:grid-cols-1">
        {modelTypes.map(type => (
          <ModelConfigForm
            key={type}
            type={type}
            info={modelTypeInfo[type]}
            model={p.models[type]}
            onChange={(field, value) => onUpdateModel(type, field, value)}
          />
        ))}
      </div>
    </div>
  );
}

export function ProviderList({ providerList, modelTypes, modelTypeInfo, modelProtocols = [], onSaveProvider, onRemove }) {
  const [draft, setDraft] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openAddDialog = () => {
    setDraft(emptyProvider('provider_' + Date.now(), modelTypes));
    setDialogOpen(true);
  };

  const openEditDialog = (provider) => {
    setDraft(structuredClone(provider));
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setDraft(null);
  };

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      setToast('请先填写供应商名称，再保存到当前页面。');
      return;
    }
    onSaveProvider({ ...draft, name });
    closeDialog();
    setToast('已保存到当前页面。点击顶部「保存模型配置」后，才会真正写入配置。');
  };

  const removeProvider = (provider) => {
    const name = provider.name || provider.id;
    if (!window.confirm(`确认删除「${name}」吗？删除后仍需点击顶部「保存模型配置」才会真正写入配置。`)) return;
    onRemove(provider.id);
  };
  const dialogTitle = draft && providerList.some(p => p.id === draft.id)
    ? draft.name || draft.id
    : '新增供应商';

  return (
    <section className="rounded-lg border border-[#e7e9ee] bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-lg font-bold">供应商配置</h3>
          <p className="mt-1 text-[13px] text-[#69717e]">列表保留关键状态，点击后编辑 API Key、Base URL 和模型 ID。</p>
        </div>
        <button className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#d9dde5] bg-white px-3 text-sm font-semibold text-[#30343b] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#111827]" onClick={openAddDialog}>
          <Plus size={14} />
          <span>添加供应商</span>
        </button>
      </div>

      {providerList.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#d9dde5] p-6 text-center text-sm text-[#69717e]">暂无供应商，点击上方添加。</div>
      ) : (
        <div className="grid gap-2">
          {providerList.map(p => (
            <div key={p.id} className="flex min-h-[62px] items-center justify-between gap-3 rounded-lg border border-[#edf0f4] bg-[#fafbfc] px-3 py-2.5">
              <div className="min-w-0">
                <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm text-[#30343b]">{p.name || p.id}</strong>
                <span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold text-[#69717e]">
                  {protocolLabel(p, modelProtocols)} · {enabledModelSummary(p, modelTypes, modelTypeInfo)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#d9dde5] bg-white px-3 text-xs font-bold text-[#30343b] transition hover:border-[#cbd5e1] hover:bg-white hover:text-[#111827]"
                  type="button"
                  onClick={() => openEditDialog(p)}
                >
                  <Edit3 size={13} />
                  <span>编辑</span>
                </button>
                <button
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-red-100 bg-red-50 px-3 text-xs font-bold text-red-600 transition hover:bg-red-100"
                  type="button"
                  onClick={() => removeProvider(p)}
                >
                  <Trash2 size={13} />
                  <span>删除</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) setDraft(null);
      }}>
        <DialogContent className="max-h-[86vh] overflow-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <ProviderDetail
              provider={draft}
              modelTypes={modelTypes}
              modelTypeInfo={modelTypeInfo}
              modelProtocols={modelProtocols}
              onUpdate={(field, value) => setDraft(prev => ({ ...prev, [field]: value }))}
              onUpdateModel={(type, field, value) => setDraft(prev => ({
                ...prev,
                models: {
                  ...prev.models,
                  [type]: { ...prev.models[type], [field]: value },
                },
              }))}
            />
          ) : null}
          <DialogFooter>
            <button
              className="min-h-9 rounded-lg border border-[#d9dde5] bg-white px-4 text-sm font-semibold text-[#30343b] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc]"
              type="button"
              onClick={closeDialog}
            >
              取消
            </button>
            <button
              className="min-h-9 rounded-lg bg-[#111827] px-4 text-sm font-bold text-white transition hover:bg-[#020617]"
              type="button"
              onClick={saveDraft}
            >
              保存
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast ? (
        <div
          className="fixed bottom-5 right-5 z-[60] max-w-sm rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 shadow-lg"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      ) : null}
    </section>
  );
}
