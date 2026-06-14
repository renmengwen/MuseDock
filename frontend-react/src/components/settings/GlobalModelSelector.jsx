export function GlobalModelSelector({ modelTypes, modelTypeInfo, providerList, activeModels, onChange }) {
  return (
    <section className="settingsPanel">
      <div className="settingsPanelHeader">
        <div>
          <h3>全局模型选择</h3>
          <p>为每种功能选择使用哪个供应商的哪个模型。</p>
        </div>
      </div>
      <div className="globalSelectorGrid">
        {modelTypes.map(type => {
          const info = modelTypeInfo[type];
          const current = activeModels[type];
          const value = current ? `${current.providerId}/${type}` : '';
          return (
            <label className="globalSelectorRow" key={type}>
              <span className="globalSelectorLabel">{info.title}</span>
              <select
                className="globalSelectorSelect"
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
                <span className="globalSelectorHint">{current.providerName} / {current.modelId}</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </section>
  );
}
