import { Status } from '../Status.jsx';
import { GlobalModelSelector } from './GlobalModelSelector.jsx';
import { ProviderList } from './ProviderList.jsx';

export function ModelSettings({ modelSettings }) {
  return (
    <>
      <Status status={modelSettings.status} />
      {modelSettings.loading || modelSettings.saving ? (
        <div className="mb-4 rounded-lg border border-[#d9dde5] bg-[#f8fafc] px-4 py-3 text-[13px] font-semibold text-[#30343b]">
          {modelSettings.saving ? '正在保存模型配置...' : '正在加载模型配置...'}
        </div>
      ) : null}

      <div className="mb-4 flex justify-end gap-2">
        <button
          className="min-h-9 rounded-lg border border-[#d9dde5] bg-white px-4 text-sm font-semibold text-[#30343b] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={modelSettings.loading || modelSettings.saving}
          onClick={modelSettings.load}
        >
          重新加载模型配置
        </button>
        <button
          className="min-h-9 rounded-lg bg-[#111827] px-4 text-sm font-bold text-white transition hover:bg-[#020617] disabled:cursor-not-allowed disabled:opacity-55"
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
        modelProtocols={modelSettings.MODEL_PROTOCOLS}
        onSaveProvider={modelSettings.saveProvider}
        onRemove={modelSettings.removeProvider}
      />
    </>
  );
}
