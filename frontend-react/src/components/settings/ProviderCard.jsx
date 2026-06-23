import { useState } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { ModelConfigForm } from './ModelConfigForm.jsx';

export function ProviderCard({ provider, modelTypes, modelTypeInfo, onUpdate, onUpdateModel, onRemove }) {
  const [expanded, setExpanded] = useState(true);
  const p = provider;

  return (
    <article className="providerCard">
      <div className="providerCardHeader" onClick={() => setExpanded(!expanded)}>
        <div className="providerCardTitle">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <input
            className="providerNameInput"
            value={p.name}
            onClick={e => e.stopPropagation()}
            onChange={e => onUpdate('name', e.target.value)}
            placeholder="供应商名称"
          />
        </div>
        <button
          className="btn icon danger"
          title="删除供应商"
          onClick={e => { e.stopPropagation(); onRemove(); }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {expanded ? (
        <div className="providerCardBody">
          <div className="providerConnectionRow">
            <label>
              <span>Base URL</span>
              <input
                value={p.baseUrl}
                onChange={e => onUpdate('baseUrl', e.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </label>
            <label>
              <span>API Key</span>
              <input
                type="password"
                value={p.apiKey}
                onChange={e => onUpdate('apiKey', e.target.value)}
                placeholder={p.hasApiKey ? `已保存 ${p.apiKeyMasked}` : '请输入 API Key'}
                autoComplete="new-password"
              />
            </label>
          </div>

          <div className="providerModelsGrid">
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
