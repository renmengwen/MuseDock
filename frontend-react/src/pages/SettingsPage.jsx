import { Status } from '../components/Status.jsx';
import { GlobalModelSelector } from '../components/settings/GlobalModelSelector.jsx';
import { ProviderList } from '../components/settings/ProviderList.jsx';
import { ProjectSettings } from '../components/settings/ProjectSettings.jsx';
import { useSettings } from '../hooks/useSettings.js';

export function SettingsPage() {
  const settings = useSettings();

  return (
    <main className="container">
      <div className="workspaceIntro">
        <div>
          <h2>设置</h2>
          <p>配置供应商、模型和工程行为。API Key 保存到本地配置文件。</p>
        </div>
        <div className="settingsSummary">
          <strong>{settings.enabledCount}</strong>
          <span>已启用</span>
        </div>
      </div>

      <Status status={settings.status} />
      {settings.loading || settings.saving
        ? <div className="pageLoading">{settings.saving ? '正在写入配置...' : '正在加载配置...'}</div>
        : null}

      <div className="settingsActionBar">
        <button className="btn secondary" disabled={settings.loading || settings.saving} onClick={settings.load}>重新加载</button>
        <button className="btn primary" disabled={settings.loading || settings.saving} onClick={settings.save}>保存配置</button>
      </div>

      <GlobalModelSelector
        modelTypes={settings.MODEL_TYPES}
        modelTypeInfo={settings.MODEL_TYPE_INFO}
        providerList={settings.providerList}
        activeModels={settings.activeModels}
        onChange={settings.setActive}
      />

      <ProjectSettings
        skipValidation={settings.state.skipValidation}
        onChange={settings.setSkipValidation}
      />

      <ProviderList
        providerList={settings.providerList}
        modelTypes={settings.MODEL_TYPES}
        modelTypeInfo={settings.MODEL_TYPE_INFO}
        onUpdate={settings.updateProvider}
        onUpdateModel={settings.updateProviderModel}
        onAdd={settings.addProvider}
        onRemove={settings.removeProvider}
      />
    </main>
  );
}
