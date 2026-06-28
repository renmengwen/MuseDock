import { Status } from '../Status.jsx';
import { GlobalModelSelector } from './GlobalModelSelector.jsx';
import { ProviderList } from './ProviderList.jsx';

export function ModelSettings({ modelSettings }) {
  return (
    <>
      <Status status={modelSettings.status} />
      {modelSettings.loading || modelSettings.saving ? (
        <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-700">
          {modelSettings.saving ? '正在保存模型配置...' : '正在加载模型配置...'}
        </div>
      ) : null}

      <div className="mb-4 flex justify-end gap-2">
        <button
          className="min-h-9 rounded-lg border border-[#d9dde5] bg-white px-4 text-sm font-semibold text-[#30343b] transition hover:border-[#bfdbfe] hover:bg-[#eef4ff] hover:text-[#2563eb] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={modelSettings.loading || modelSettings.saving}
          onClick={modelSettings.load}
        >
          重新加载模型配置
        </button>
        <button
          className="min-h-9 rounded-lg bg-[#fe2c55] px-4 text-sm font-bold text-white transition hover:bg-[#f2214b] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={modelSettings.loading || modelSettings.saving}
          onClick={modelSettings.save}
        >
          保存模型配置
        </button>
      </div>

      <GlobalModelSelector
        modelTypes={modelSettings.MODEL_TYPES}
        modelTypeInfo={modelSettings.MODEL_TYPE_INFO}
        providerList={modelSettings.providerList}
        activeModels={modelSettings.activeModels}
        onChange={modelSettings.setActive}
      />

      <ProviderList
        providerList={modelSettings.providerList}
        modelTypes={modelSettings.MODEL_TYPES}
        modelTypeInfo={modelSettings.MODEL_TYPE_INFO}
        onUpdate={modelSettings.updateProvider}
        onUpdateModel={modelSettings.updateProviderModel}
        onAdd={modelSettings.addProvider}
        onRemove={modelSettings.removeProvider}
      />
    </>
  );
}
