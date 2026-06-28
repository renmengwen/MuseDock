import { Plus } from 'lucide-react';
import { ProviderCard } from './ProviderCard.jsx';

export function ProviderList({ providerList, modelTypes, modelTypeInfo, onUpdate, onUpdateModel, onAdd, onRemove }) {
  return (
    <section className="rounded-lg border border-[#e7e9ee] bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-lg font-bold">供应商配置</h3>
          <p className="mt-1 text-[13px] text-[#69717e]">配置各供应商的 API Key、Base URL 和模型 ID。</p>
        </div>
        <button className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#d9dde5] bg-white px-3 text-sm font-semibold text-[#30343b] transition hover:border-[#ffd6df] hover:bg-[#fff8fa] hover:text-[#fe2c55]" onClick={onAdd}>
          <Plus size={14} />
          <span>添加供应商</span>
        </button>
      </div>

      {providerList.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#d9dde5] p-6 text-center text-sm text-[#69717e]">暂无供应商，点击上方添加。</div>
      ) : (
        <div className="grid gap-3">
          {providerList.map(p => (
            <ProviderCard
              key={p.id}
              provider={p}
              modelTypes={modelTypes}
              modelTypeInfo={modelTypeInfo}
              onUpdate={(field, value) => onUpdate(p.id, field, value)}
              onUpdateModel={(type, field, value) => onUpdateModel(p.id, type, field, value)}
              onRemove={() => onRemove(p.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
