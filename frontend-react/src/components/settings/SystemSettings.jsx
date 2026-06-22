import { useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { CleanupConfirmDialog } from './CleanupConfirmDialog.jsx';

const CLEANUP_ITEMS = [
  { target: 'creative-workflows', label: '创作任务记录', storageKey: 'creativeWorkflows' },
  { target: 'media-cache', label: '媒体素材缓存', storageKey: 'mediaCache' },
  { target: 'render-outputs', label: '渲染产物', storageKey: 'renderOutputs' },
  { target: 'browser-data', label: '浏览器数据', storageKey: 'browserData' },
  { target: 'cookies', label: 'Cookie', storageKey: 'cookies' },
];

function getStatusText(ok) {
  if (ok === undefined || ok === null) return '待检测';
  return ok ? '可用' : '需处理';
}

function getDiagnosticDetail(item) {
  return item?.detail || item?.path || '无更多诊断信息';
}

function getTemplateStatus(systemHealth) {
  const templates = systemHealth?.templates;
  const items = Array.isArray(templates?.items) ? templates.items : [];
  if (!templates) return '待检测';
  const compatibleCount = items.filter(item => item.compatible).length;
  return `共 ${items.length} 个模板，${compatibleCount} 个兼容当前默认配置`;
}

function getStorageEstimate(systemHealth, item) {
  return systemHealth?.storage?.[item.storageKey] || null;
}

export function SystemSettings({
  appSettings,
  systemHealth,
  disabled,
  saving,
  onChange,
  onSave,
  onRefresh,
}) {
  const [pendingCleanup, setPendingCleanup] = useState(null);
  const [cleanupLoading, setCleanupLoading] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState(null);
  const diagnostics = Array.isArray(systemHealth?.environment?.diagnostics)
    ? systemHealth.environment.diagnostics
    : [];
  const cleanupEstimate = useMemo(
    () => (pendingCleanup ? getStorageEstimate(systemHealth, pendingCleanup) : null),
    [pendingCleanup, systemHealth],
  );

  const updateSkipValidation = (value) => {
    if (!appSettings) return;
    onChange({
      ...appSettings,
      system: {
        ...(appSettings.system || {}),
        skipValidation: value,
      },
    });
  };

  const confirmCleanup = async () => {
    if (!pendingCleanup) return;
    const item = pendingCleanup;
    setCleanupLoading(item.target);
    setCleanupStatus({ type: 'loading', message: `正在清理${item.label}...` });
    try {
      await api.cleanupSystemData([item.target]);
      await onRefresh(true);
      setCleanupStatus({ type: 'success', message: `${item.label}已清理，系统状态已刷新` });
      setPendingCleanup(null);
    } catch (error) {
      setCleanupStatus({ type: 'error', message: `清理${item.label}失败：${error.message || '未知错误'}` });
    } finally {
      setCleanupLoading('');
    }
  };

  const refreshSystemHealth = async () => {
    setRefreshing(true);
    try {
      await onRefresh(true);
    } catch {
      // SettingsPage 已显示中文失败状态，这里只负责恢复按钮状态。
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section>
      <div className="settingsPanelHeader">
        <div>
          <h3>系统</h3>
          <p>管理质检、html-video 环境、模板状态和本地数据维护。</p>
        </div>
        <div className="settingsActions">
          <button
            className="btn secondary"
            type="button"
            disabled={disabled || refreshing}
            onClick={refreshSystemHealth}
          >
            {refreshing ? '正在重新检测...' : '重新检测'}
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={disabled || !appSettings}
            onClick={() => onSave(appSettings)}
          >
            {saving ? '正在保存系统设置...' : '保存系统设置'}
          </button>
        </div>
      </div>

      <div className="projectSettingsBody" style={{ display: 'grid', gap: 18 }}>
        <label className="switchControl">
          <input
            type="checkbox"
            checked={!!appSettings?.system?.skipValidation}
            disabled={disabled || !appSettings}
            onChange={event => updateSkipValidation(event.target.checked)}
          />
          <span className="switchTrack" aria-hidden="true">
            <span className="switchThumb" />
          </span>
          <div className="switchLabel">
            <span className="switchText">质检状态：{appSettings?.system?.skipValidation ? '已跳过' : '已启用'}</span>
            <span className="switchDesc">跳过质检后会直接进入渲染流程，请仅在确认素材和模板稳定时使用。</span>
          </div>
        </label>

        <section>
          <h4>html-video 环境</h4>
          <p>{getStatusText(systemHealth?.environment?.ok)}</p>
          <details>
            <summary>诊断详情</summary>
            {diagnostics.length ? (
              <ul>
                {diagnostics.map((item, index) => (
                  <li key={`${item.code || 'diagnostic'}-${index}`}>
                    <strong>{item.message || item.code || '诊断项'}：</strong>
                    <span>{getDiagnosticDetail(item)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>无更多诊断信息</p>
            )}
          </details>
        </section>

        <section>
          <h4>模板状态</h4>
          <p>{getTemplateStatus(systemHealth)}</p>
        </section>

        <section>
          <h4>数据维护</h4>
          <div className="settingsFormGrid">
            {CLEANUP_ITEMS.map(item => {
              const estimate = getStorageEstimate(systemHealth, item);
              const isLoading = cleanupLoading === item.target;
              return (
                <div key={item.target}>
                  <span>{item.label}</span>
                  <p>{estimate?.display || '待检测'}</p>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={disabled || !!cleanupLoading}
                    onClick={() => setPendingCleanup(item)}
                  >
                    {isLoading ? `正在清理${item.label}...` : `清理${item.label}`}
                  </button>
                </div>
              );
            })}
          </div>
          {cleanupStatus ? <p role="status">{cleanupStatus.message}</p> : null}
        </section>
      </div>

      <CleanupConfirmDialog
        target={pendingCleanup}
        open={!!pendingCleanup}
        loading={!!cleanupLoading}
        estimate={cleanupEstimate}
        onCancel={() => setPendingCleanup(null)}
        onConfirm={confirmCleanup}
      />
    </section>
  );
}
