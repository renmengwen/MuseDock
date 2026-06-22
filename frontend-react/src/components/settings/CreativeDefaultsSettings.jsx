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

function getTemplateId(template) {
  return typeof template?.id === 'string' ? template.id : '';
}

function isTemplateShownForAspect(template, aspectRatio) {
  const templateAspect = getTemplateAspect(template);
  return !templateAspect || templateAspect === aspectRatio;
}

function optionLabel(template) {
  return `${template.name || template.id}${template.compatible === false ? '（不兼容）' : ''}`;
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
                      disabled={template.compatible === false}
                    >
                      {optionLabel(template)}
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
