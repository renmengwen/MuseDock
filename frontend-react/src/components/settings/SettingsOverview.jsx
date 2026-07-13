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
  const environmentOk = systemHealth?.environment?.ok;

  const cards = [
    {
      title: '分析模型',
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
      title: '帧 HTML 并发',
      value: creativeDefaults.frameHtmlConcurrency || 1,
      action: 'creative',
    },
    {
      title: '质检状态',
      value: appSettings?.system?.skipValidation ? '已跳过' : '已启用',
      action: 'system',
    },
    {
      title: 'Pexels 补图',
      value: appSettings?.system?.pexelsApiKey ? '已配置' : '未配置',
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
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-lg font-bold">设置中心总览</h3>
          <p className="mt-1 text-[13px] text-[#69717e]">查看创作默认值、模型能力和本地系统状态。</p>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        {cards.map(card => (
          <button
            key={card.title}
            type="button"
            onClick={() => onNavigate(card.action)}
            className="min-w-0 rounded-lg border border-[#e7e9ee] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#cbd5e1] hover:shadow-[0_12px_28px_rgba(15,23,42,.08)]"
          >
            <span className="mb-2 block text-xs text-[#69717e]">{card.title}</span>
            <strong className="block text-base text-[#30343b]">{card.value}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
