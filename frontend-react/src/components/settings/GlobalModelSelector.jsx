export function GlobalModelSelector({ modelTypes, modelTypeInfo, providerList, activeModels, onChange }) {
  return (
    <section className="mb-4 rounded-lg border border-[#e7e9ee] bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-lg font-bold">全局模型选择</h3>
          <p className="mt-1 text-[13px] text-[#69717e]">为每种功能选择使用哪个供应商的哪个模型。</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
        {modelTypes.map(type => {
          const info = modelTypeInfo[type];
          const current = activeModels[type];
          const value = current ? `${current.providerId}/${type}` : '';
          return (
            <label className="grid gap-1.5 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3" key={type}>
              <span className="text-xs font-semibold text-[#5f6876]">{info.title}</span>
              <select
                className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15"
                value={value}
                onChange={event => {
                  const val = event.target.value;
                  if (!val) { onChange(type, '', ''); return; }
                  const [pid] = val.split('/');
                  onChange(type, pid, type);
                }}
              >
                <option value="">未选择</option>
                {providerList.map(p => {
                  const m = p.models[type];
                  const disabled = !m?.enabled || !m?.modelId;
                  return (
                    <option key={p.id} value={`${p.id}/${type}`} disabled={disabled}>
                      {p.name || p.id} — {m?.modelId || '(未配置)'}
                    </option>
                  );
                })}
              </select>
              {current ? (
                <span className="text-xs text-[#69717e]">{current.providerName} / {current.modelId}</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </section>
  );
}
