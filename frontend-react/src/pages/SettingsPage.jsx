import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { Status } from '../components/Status.jsx';
import { CreativeDefaultsSettings } from '../components/settings/CreativeDefaultsSettings.jsx';
import { ModelSettings } from '../components/settings/ModelSettings.jsx';
import { SettingsOverview } from '../components/settings/SettingsOverview.jsx';
import { SystemSettings } from '../components/settings/SystemSettings.jsx';
import { useSettings } from '../hooks/useSettings.js';

const SECTIONS = [
  { id: 'overview', label: '总览' },
  { id: 'creative', label: '创作默认值' },
  { id: 'models', label: '模型配置' },
  { id: 'system', label: '系统' },
];

function unwrapData(response) {
  return response?.data ?? response;
}

function getFailureMessage(label, result) {
  return `${label}加载失败：${result.reason?.message || '未知错误'}`;
}

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState('overview');
  const [appSettings, setAppSettings] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [systemHealth, setSystemHealth] = useState(null);
  const [loadingApp, setLoadingApp] = useState(true);
  const [savingApp, setSavingApp] = useState(false);
  const [status, setStatus] = useState(null);
  const modelSettings = useSettings();

  const loadSystemHealth = useCallback(async (refresh = false) => {
    setStatus({
      type: 'loading',
      message: refresh ? '正在重新检测系统状态...' : '正在加载系统状态...',
    });
    try {
      const response = await api.getSystemHealth(refresh);
      const nextHealth = unwrapData(response);
      setSystemHealth(nextHealth);
      setStatus({
        type: 'success',
        message: refresh ? '系统状态已刷新' : '系统状态已加载',
      });
      return nextHealth;
    } catch (error) {
      setStatus({ type: 'error', message: `系统状态加载失败：${error.message || '未知错误'}` });
      throw error;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadSettingsCenter() {
      setLoadingApp(true);
      setStatus({ type: 'loading', message: '正在加载设置中心...' });
      const [appResult, templatesResult, healthResult] = await Promise.allSettled([
        api.getAppSettings(),
        api.getConfigTemplates(),
        api.getSystemHealth(),
      ]);
      if (!mounted) return;

      if (appResult.status === 'fulfilled') setAppSettings(unwrapData(appResult.value));
      if (templatesResult.status === 'fulfilled') setTemplates(unwrapData(templatesResult.value) || []);
      if (healthResult.status === 'fulfilled') setSystemHealth(unwrapData(healthResult.value));

      const failures = [];
      if (appResult.status === 'rejected') failures.push(getFailureMessage('应用配置', appResult));
      if (templatesResult.status === 'rejected') failures.push(getFailureMessage('模板列表', templatesResult));
      if (healthResult.status === 'rejected') failures.push(getFailureMessage('系统状态', healthResult));

      setStatus(failures.length
        ? { type: 'error', message: failures.join('；') }
        : { type: 'success', message: '设置中心已加载' });
      setLoadingApp(false);
    }

    loadSettingsCenter();
    return () => { mounted = false; };
  }, []);

  const saveAppSettings = useCallback(async (nextSettings) => {
    const isCreativeSection = activeSection === 'creative';
    const isSystemSection = activeSection === 'system';
    const savingMessage = isCreativeSection
      ? '正在保存创作默认值...'
      : isSystemSection
        ? '正在保存系统设置...'
        : '正在保存应用配置...';
    const successMessage = isCreativeSection
      ? '创作默认值已保存'
      : isSystemSection
        ? '系统设置已保存'
        : '应用配置已保存';
    const failurePrefix = isCreativeSection
      ? '创作默认值保存失败'
      : isSystemSection
        ? '系统设置保存失败'
        : '应用配置保存失败';

    setSavingApp(true);
    setStatus({ type: 'loading', message: savingMessage });
    try {
      const response = await api.saveAppSettings(nextSettings);
      setAppSettings(unwrapData(response));
      setStatus({ type: 'success', message: successMessage });
    } catch (error) {
      setStatus({ type: 'error', message: `${failurePrefix}：${error.message || '未知错误'}` });
    } finally {
      setSavingApp(false);
    }
  }, [activeSection]);

  const renderSection = () => {
    if (activeSection === 'overview') {
      return (
        <SettingsOverview
          appSettings={appSettings}
          modelSettings={modelSettings}
          systemHealth={systemHealth}
          onNavigate={setActiveSection}
        />
      );
    }

    if (activeSection === 'creative') {
      return (
        <CreativeDefaultsSettings
          appSettings={appSettings}
          templates={templates}
          disabled={loadingApp || savingApp}
          saving={savingApp}
          onChange={setAppSettings}
          onSave={saveAppSettings}
        />
      );
    }

    if (activeSection === 'models') {
      return <ModelSettings modelSettings={modelSettings} />;
    }

    return (
      <SystemSettings
        appSettings={appSettings}
        systemHealth={systemHealth}
        disabled={loadingApp || savingApp}
        saving={savingApp}
        onChange={setAppSettings}
        onSave={saveAppSettings}
        onRefresh={loadSystemHealth}
      />
    );
  };

  return (
    <main className="container">
      <div className="workspaceIntro">
        <div>
          <h2>设置中心</h2>
          <p>管理创作默认值、模型配置和本地系统状态。</p>
        </div>
        <div className="settingsSummary">
          <strong>{modelSettings.enabledCount}</strong>
          <span>已启用</span>
        </div>
      </div>

      <Status status={status} />
      {loadingApp ? <div className="pageLoading">正在加载设置中心...</div> : null}

      <div className="settingsCenterLayout">
        <nav className="settingsCenterNav" aria-label="设置中心导航">
          {SECTIONS.map(section => (
            <button
              key={section.id}
              type="button"
              className={activeSection === section.id ? 'active' : ''}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>
        <div className="settingsPanel">
          {renderSection()}
        </div>
      </div>
    </main>
  );
}
