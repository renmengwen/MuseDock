import { Status } from '../Status.jsx';
import { GlobalModelSelector } from './GlobalModelSelector.jsx';
import { ProviderList } from './ProviderList.jsx';

export function ModelSettings({ modelSettings }) {
  return (
    <>
      <Status status={modelSettings.status} />
      {modelSettings.loading || modelSettings.saving ? (
        <div className="pageLoading">
          {modelSettings.saving ? '正在保存模型配置...' : '正在加载模型配置...'}
        </div>
      ) : null}

      <div className="settingsActionBar">
        <button
          className="btn secondary"
          disabled={modelSettings.loading || modelSettings.saving}
          onClick={modelSettings.load}
        >
          重新加载模型配置
        </button>
        <button
          className="btn primary"
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
