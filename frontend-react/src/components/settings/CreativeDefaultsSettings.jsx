export const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5'];

const DEFAULT_CREATIVE_DEFAULTS = {
  aspectRatio: '9:16',
  targetDurationSec: 60,
  templateByAspectRatio: {
    '9:16': '',
    '16:9': '',
    '1:1': '',
    '4:5': '',
  },
  lockTemplate: false,
  useResearch: true,
};

const SELECT_CONTROL_STYLE = {
  width: '100%',
  height: 38,
  border: '1px solid #d9dde5',
  borderRadius: 8,
  padding: '0 10px',
  background: '#fff',
};

const TEMPLATE_NAME_ZH = {
  bold_signal: '信号卡片',
  glitch_title: '故障风格标题',
  news_signal_vertical: '竖屏财经信号',
  'frame-bold-poster': '醒目海报',
  'frame-bold-signal': '强信号卡片',
  'frame-build-minimal': '极简构建',
  'frame-creative-voltage': '创意电压',
  'frame-data-chart-nyt': '数据图表',
  'frame-data-rollup': '数据汇总',
  'frame-decision-tree': '决策树',
  'frame-electric-studio': '电光工作室',
  'frame-glitch-title': '故障标题',
  'frame-kinetic-type': '动态文字',
  'frame-light-leak-cinema': '漏光电影',
  'frame-liquid-bg-hero': '液态背景主视觉',
  'frame-logo-outro': 'Logo 片尾',
  'frame-nyt-graph': '新闻图表',
  'frame-pentagram-stat': '醒目数据',
  'frame-play-mode': '播放模式',
  'frame-product-promo': '产品推广',
  'frame-product-promo-30s': '产品推广 30 秒',
  'frame-swiss-grid': '瑞士网格',
  'frame-takram-organic': '有机视觉',
  'frame-vignelli': '维涅利版式',
  'frame-warm-grain': '暖色颗粒',
  'vfx-text-cursor': '文字光标特效',
};

function getCreativeDefaults(appSettings) {
  return {
    ...DEFAULT_CREATIVE_DEFAULTS,
    ...(appSettings?.creativeDefaults || {}),
    templateByAspectRatio: {
      ...DEFAULT_CREATIVE_DEFAULTS.templateByAspectRatio,
      ...(appSettings?.creativeDefaults?.templateByAspectRatio || {}),
    },
  };
}

function getTemplateAspect(template) {
  return template?.aspect_ratio || template?.aspectRatio || template?.aspect || '';
}

function getTemplateAspects(template) {
  const aspects = template?.supported_aspects || template?.supportedAspects;
  if (Array.isArray(aspects)) return aspects.map(item => String(item || '').trim()).filter(Boolean);
  const aspect = getTemplateAspect(template);
  return aspect ? [aspect] : [];
}

function getTemplateId(template) {
  return typeof template?.id === 'string' ? template.id : '';
}

function isTemplateShownForAspect(template, aspectRatio) {
  const aspects = getTemplateAspects(template);
  return !aspects.length || aspects.includes(aspectRatio);
}

function hasBlockingCompatibilityReason(template) {
  const reasons = Array.isArray(template?.compatibility_reasons) ? template.compatibility_reasons : [];
  return reasons.some(reason => reason?.code && reason.code !== 'unsupported-aspect');
}

function getTemplateDisplayName(template) {
  const id = getTemplateId(template);
  return TEMPLATE_NAME_ZH[id] || template?.name || id;
}

function optionLabel(template, aspectRatio) {
  const compatible = isTemplateShownForAspect(template, aspectRatio) && !hasBlockingCompatibilityReason(template);
  return `${getTemplateDisplayName(template)}${compatible ? '' : '（不兼容）'}`;
}

export function CreativeDefaultsSettings({
  appSettings,
  templates,
  disabled,
  saving,
  onChange,
  onSave,
}) {
  const creativeDefaults = getCreativeDefaults(appSettings);
  const safeTemplates = Array.isArray(templates) ? templates : [];

  function updateCreativeDefaults(nextCreativeDefaults) {
    onChange({
      ...(appSettings || {}),
      creativeDefaults: {
        ...creativeDefaults,
        ...nextCreativeDefaults,
      },
    });
  }

  function updateTemplate(aspectRatio, templateId) {
    updateCreativeDefaults({
      templateByAspectRatio: {
        ...creativeDefaults.templateByAspectRatio,
        [aspectRatio]: typeof templateId === 'string' ? templateId : '',
      },
    });
  }

  function handleSave() {
    onSave({
      ...(appSettings || {}),
      creativeDefaults,
    });
  }

  return (
    <section>
      <div className="settingsPanelHeader">
        <div>
          <h3>创作默认值</h3>
          <p>设置一键创作默认使用的画面比例、目标时长、模板策略和联网研究开关。</p>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={disabled || saving || !appSettings}
          onClick={handleSave}
        >
          {saving ? '正在保存创作默认值...' : '保存创作默认值'}
        </button>
      </div>

      <div className="settingsFormGrid">
        <label>
          <span>默认画面比例</span>
          <select
            value={creativeDefaults.aspectRatio}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ aspectRatio: event.target.value })}
            style={SELECT_CONTROL_STYLE}
          >
            {ASPECT_RATIOS.map(aspectRatio => (
              <option key={aspectRatio} value={aspectRatio}>{aspectRatio}</option>
            ))}
          </select>
        </label>

        <label>
          <span>默认目标时长</span>
          <input
            type="number"
            min="15"
            max="180"
            step="1"
            value={creativeDefaults.targetDurationSec}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({
              targetDurationSec: event.target.value === '' ? '' : Number(event.target.value),
            })}
          />
        </label>

        <div className="settingsWideField" style={{ display: 'grid', gap: 10 }}>
          <span style={{ color: '#5f6876', fontSize: 12, fontWeight: 600 }}>按比例默认模板</span>
          {ASPECT_RATIOS.map(aspectRatio => {
            const value = typeof creativeDefaults.templateByAspectRatio?.[aspectRatio] === 'string'
              ? creativeDefaults.templateByAspectRatio[aspectRatio]
              : '';
            const aspectTemplates = safeTemplates.filter(template => (
              getTemplateId(template) && isTemplateShownForAspect(template, aspectRatio)
            ));

            return (
              <label
                key={aspectRatio}
                style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', alignItems: 'center', gap: 10 }}
              >
                <span>{aspectRatio}</span>
                <select
                  value={value}
                  disabled={disabled}
                  onChange={event => updateTemplate(aspectRatio, event.target.value)}
                  style={SELECT_CONTROL_STYLE}
                >
                  <option value="">不指定模板</option>
                  {aspectTemplates.map(template => (
                    <option
                      key={`${aspectRatio}-${getTemplateId(template)}`}
                      value={getTemplateId(template)}
                      disabled={!isTemplateShownForAspect(template, aspectRatio) || hasBlockingCompatibilityReason(template)}
                    >
                      {optionLabel(template, aspectRatio)}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>

        <label className="switchControl">
          <input
            type="checkbox"
            checked={creativeDefaults.lockTemplate === true}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ lockTemplate: event.target.checked })}
          />
          <span className="switchTrack" aria-hidden="true">
            <span className="switchThumb" />
          </span>
          <span className="switchText">{creativeDefaults.lockTemplate ? '已锁定' : '未锁定'}</span>
          <span>锁定模板</span>
        </label>

        <label className="switchControl">
          <input
            type="checkbox"
            checked={creativeDefaults.useResearch === true}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ useResearch: event.target.checked })}
          />
          <span className="switchTrack" aria-hidden="true">
            <span className="switchThumb" />
          </span>
          <span className="switchText">{creativeDefaults.useResearch ? '已开启' : '已关闭'}</span>
          <span>联网研究默认开启</span>
        </label>
      </div>
    </section>
  );
}
