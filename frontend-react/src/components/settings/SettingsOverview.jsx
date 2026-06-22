function getActiveModelLabel(model) {
  if (!model?.enabled || !model?.modelId) return '未配置';
  return `${model.providerName || model.provider || model.providerId || '供应商'} / ${model.modelId}`;
}

function getStorageDisplay(storage = {}) {
  const entries = Object.values(storage).filter(Boolean);
  if (!entries.length) return '暂无数据';
  const totalBytes = entries.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
  const firstDisplay = entries.find(item => item.display)?.display;
  return totalBytes > 0 ? `${entries.length} 类数据，约 ${firstDisplay || `${totalBytes} B`}` : '暂无数据';
}

export function SettingsOverview({ appSettings, modelSettings, systemHealth, onNavigate }) {
  const creativeDefaults = appSettings?.creativeDefaults || {};
  const templateMap = creativeDefaults.templateByAspectRatio || {};
  const activeTemplate = templateMap[creativeDefaults.aspectRatio] || '';
  const environmentOk = systemHealth?.environment?.ok;

  const cards = [
    {
      title: '文字模型',
      value: getActiveModelLabel(modelSettings.activeModels?.text),
      action: 'models',
    },
    {
      title: 'TTS',
      value: getActiveModelLabel(modelSettings.activeModels?.tts),
      action: 'models',
    },
    {
      title: '默认画面比例',
      value: creativeDefaults.aspectRatio || '未设置',
      action: 'creative',
    },
    {
      title: '默认模板策略',
      value: creativeDefaults.lockTemplate
        ? `锁定 ${activeTemplate || '未选择模板'}`
        : activeTemplate || '按画幅自动选择',
      action: 'creative',
    },
    {
      title: '质检状态',
      value: appSettings?.system?.skipValidation ? '已跳过' : '已启用',
      action: 'system',
    },
    {
      title: '渲染环境',
      value: environmentOk === undefined ? '待检测' : environmentOk ? '可用' : '需处理',
      action: 'system',
    },
    {
      title: '数据占用',
      value: getStorageDisplay(systemHealth?.storage),
      action: 'system',
    },
  ];

  return (
    <section>
      <div className="settingsPanelHeader">
        <div>
          <h3>设置中心总览</h3>
          <p>查看创作默认值、模型能力和本地系统状态。</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {cards.map(card => (
          <button
            key={card.title}
            type="button"
            onClick={() => onNavigate(card.action)}
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              border: '1px solid #e7e9ee',
              borderRadius: 8,
              background: '#fff',
              padding: 16,
            }}
          >
            <span style={{ display: 'block', color: '#69717e', fontSize: 12, marginBottom: 8 }}>{card.title}</span>
            <strong style={{ display: 'block', color: '#30343b', fontSize: 16 }}>{card.value}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
