import { Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
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

function ProviderDetail({ provider, modelTypes, modelTypeInfo, onUpdate, onUpdateModel, onRemove }) {
  const p = provider;
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

      <div className="flex justify-end border-t border-[#e7e9ee] pt-3">
        <button
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 text-sm font-semibold text-red-600 transition hover:bg-red-100"
          type="button"
          onClick={onRemove}
        >
          删除供应商
        </button>
      </div>
    </div>
  );
}

export function ProviderList({ providerList, modelTypes, modelTypeInfo, onUpdate, onUpdateModel, onAdd, onRemove }) {
  return (
    <section className="rounded-lg border border-[#e7e9ee] bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-lg font-bold">供应商配置</h3>
          <p className="mt-1 text-[13px] text-[#69717e]">列表保留关键状态，点击后编辑 API Key、Base URL 和模型 ID。</p>
        </div>
        <button className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#d9dde5] bg-white px-3 text-sm font-semibold text-[#30343b] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#111827]" onClick={onAdd}>
          <Plus size={14} />
          <span>添加供应商</span>
        </button>
      </div>

      {providerList.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#d9dde5] p-6 text-center text-sm text-[#69717e]">暂无供应商，点击上方添加。</div>
      ) : (
        <div className="grid gap-2">
          {providerList.map(p => (
            <Dialog key={p.id}>
              <div className="flex min-h-[62px] items-center justify-between gap-3 rounded-lg border border-[#edf0f4] bg-[#fafbfc] px-3 py-2.5">
                <div className="min-w-0">
                  <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm text-[#30343b]">{p.name || p.id}</strong>
                  <span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold text-[#69717e]">
                    {enabledModelSummary(p, modelTypes, modelTypeInfo)}
                  </span>
                </div>
                <DialogTrigger asChild>
                  <button className="min-h-8 shrink-0 rounded-md border border-[#d9dde5] bg-white px-3 text-xs font-bold text-[#30343b] transition hover:border-[#cbd5e1] hover:bg-white hover:text-[#111827]" type="button">
                    查看 / 编辑
                  </button>
                </DialogTrigger>
              </div>
              <DialogContent className="max-h-[86vh] overflow-auto sm:max-w-4xl">
                <DialogHeader>
                  <DialogTitle>{p.name || p.id}</DialogTitle>
                </DialogHeader>
                <ProviderDetail
                  provider={p}
                  modelTypes={modelTypes}
                  modelTypeInfo={modelTypeInfo}
                  onUpdate={(field, value) => onUpdate(p.id, field, value)}
                  onUpdateModel={(type, field, value) => onUpdateModel(p.id, type, field, value)}
                  onRemove={() => onRemove(p.id)}
                />
              </DialogContent>
            </Dialog>
          ))}
        </div>
      )}
    </section>
  );
}
