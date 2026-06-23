import { Plus } from 'lucide-react';
import { ProviderCard } from './ProviderCard.jsx';

export function ProviderList({ providerList, modelTypes, modelTypeInfo, onUpdate, onUpdateModel, onAdd, onRemove }) {
  return (
    <section className="settingsPanel">
      <div className="settingsPanelHeader">
        <div>
          <h3>供应商配置</h3>
          <p>配置各供应商的 API Key、Base URL 和模型 ID。</p>
        </div>
        <button className="btn secondary" onClick={onAdd}>
          <Plus size={14} />
          <span>添加供应商</span>
        </button>
      </div>

      {providerList.length === 0 ? (
        <div className="providerEmpty">暂无供应商，点击上方添加。</div>
      ) : (
        <div className="providerList">
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
