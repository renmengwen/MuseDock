import { useState } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { ModelConfigForm } from './ModelConfigForm.jsx';

export function ProviderCard({ provider, modelTypes, modelTypeInfo, onUpdate, onUpdateModel, onRemove }) {
  const [expanded, setExpanded] = useState(true);
  const p = provider;

  return (
    <article className="overflow-hidden rounded-lg border border-[#edf0f4] bg-[#fafbfc]">
      <div className="flex cursor-pointer select-none items-center justify-between bg-[#f5f6f8] px-4 py-3.5 transition hover:bg-[#eef0f4]" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <input
            className="h-8 min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm font-bold text-[#30343b] outline-none transition focus:border-[#fe2c55] focus:bg-white focus:ring-2 focus:ring-[#fe2c55]/15"
            value={p.name}
            onClick={e => e.stopPropagation()}
            onChange={e => onUpdate('name', e.target.value)}
            placeholder="供应商名称"
          />
        </div>
        <button
          className="inline-flex size-8 items-center justify-center rounded-md border border-red-100 bg-red-50 text-red-600 transition hover:bg-red-100"
          title="删除供应商"
          onClick={e => { e.stopPropagation(); onRemove(); }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {expanded ? (
        <div className="grid gap-4 p-4">
          <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#5f6876]">Base URL</span>
              <input
                className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#fe2c55] focus:ring-2 focus:ring-[#fe2c55]/15"
                value={p.baseUrl}
                onChange={e => onUpdate('baseUrl', e.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#5f6876]">API Key</span>
              <input
                type="password"
                className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#fe2c55] focus:ring-2 focus:ring-[#fe2c55]/15"
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
        </div>
      ) : null}
    </article>
  );
}
