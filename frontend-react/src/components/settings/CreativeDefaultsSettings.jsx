import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils.js';
import { Switch } from './Switch.jsx';

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
  generateAudio: true,
  autoSfxEnabled: true,
  generateCaptions: true,
  emotionalVoice: false,
  sourceImageAnalysisEnabled: false,
  extractDouyinFrames: false,
  frameHtmlConcurrency: 1,
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
  activeModels,
  modelSettingsLoading = false,
  templates,
  disabled,
  saving,
  onChange,
  onSave,
}) {
  const [sourceImageAnalysisMessage, setSourceImageAnalysisMessage] = useState('');
  const creativeDefaults = getCreativeDefaults(appSettings);
  const safeTemplates = Array.isArray(templates) ? templates : [];
  const sourceImageAnalysisEnabled = creativeDefaults.sourceImageAnalysisEnabled === true;
  const canUseSourceImageAnalysis = activeModels?.text?.enabled === true
    && activeModels?.text?.modelId
    && activeModels?.text?.supportsMultimodal === true;
  const sourceImageAnalysisUnavailable = modelSettingsLoading !== true && !canUseSourceImageAnalysis;
  const sourceImageAnalysisUnsupported = sourceImageAnalysisEnabled && sourceImageAnalysisUnavailable;
  const sourceImageAnalysisWarning = sourceImageAnalysisUnsupported
    ? '来源图片多模态分析已开启，但当前分析模型不支持图片输入。请切换到支持多模态的分析模型，或先关闭该开关。'
    : sourceImageAnalysisUnavailable
      ? '当前分析模型未标记为支持多模态输入，无法开启来源图片多模态分析。'
      : sourceImageAnalysisMessage;

  useEffect(() => {
    if (modelSettingsLoading || canUseSourceImageAnalysis) {
      setSourceImageAnalysisMessage('');
    }
  }, [canUseSourceImageAnalysis, modelSettingsLoading]);

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

  function handleSourceImageAnalysisChange(checked) {
    if (checked && sourceImageAnalysisUnavailable) {
      setSourceImageAnalysisMessage('当前分析模型未标记为支持多模态输入，无法开启来源图片多模态分析。');
      return;
    }
    setSourceImageAnalysisMessage('');
    updateCreativeDefaults({ sourceImageAnalysisEnabled: checked });
  }

  return (
    <section>
      <div className="mb-4 flex items-start justify-between gap-3 max-[520px]:flex-col">
        <div>
          <h3 className="m-0 text-lg font-bold">创作默认值</h3>
          <p className="mt-1 text-[13px] text-[#69717e]">设置一键创作默认使用的画面比例、目标时长、模板策略和联网研究开关。</p>
        </div>
        <button
          type="button"
          className="min-h-9 rounded-lg bg-[#111827] px-4 text-sm font-bold text-white transition hover:bg-[#020617] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={disabled || saving || !appSettings}
          onClick={handleSave}
        >
          {saving ? '正在保存创作默认值...' : '保存创作默认值'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#5f6876]">默认画面比例</span>
          <select
            value={creativeDefaults.aspectRatio}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ aspectRatio: event.target.value })}
            className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {ASPECT_RATIOS.map(aspectRatio => (
              <option key={aspectRatio} value={aspectRatio}>{aspectRatio}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#5f6876]">默认目标时长</span>
          <input
            type="number"
            min="15"
            max="180"
            step="1"
            value={creativeDefaults.targetDurationSec}
            disabled={disabled}
            className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15 disabled:cursor-not-allowed disabled:opacity-60"
            onChange={event => updateCreativeDefaults({
              targetDurationSec: event.target.value === '' ? '' : Number(event.target.value),
            })}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#5f6876]">帧 HTML 并发上限</span>
          <input
            type="number"
            min="1"
            max="5"
            step="1"
            value={creativeDefaults.frameHtmlConcurrency}
            disabled={disabled}
            className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15 disabled:cursor-not-allowed disabled:opacity-60"
            onChange={event => updateCreativeDefaults({
              frameHtmlConcurrency: event.target.value === '' ? '' : Number(event.target.value),
            })}
          />
        </label>

        <div className="grid gap-2.5 md:col-span-2">
          <span className="text-xs font-semibold text-[#5f6876]">按比例默认模板</span>
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
                className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2.5"
              >
                <span className="text-xs font-semibold text-[#5f6876]">{aspectRatio}</span>
                <select
                  value={value}
                  disabled={disabled}
                  onChange={event => updateTemplate(aspectRatio, event.target.value)}
                  className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15 disabled:cursor-not-allowed disabled:opacity-60"
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

        <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] font-semibold text-[#30343b]">
          <Switch
            checked={creativeDefaults.lockTemplate === true}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ lockTemplate: event.target.checked })}
          />
          <span className={cn('min-w-[42px]', creativeDefaults.lockTemplate ? 'text-[#111827]' : 'text-[#69717e]')}>{creativeDefaults.lockTemplate ? '已锁定' : '未锁定'}</span>
          <span>锁定模板</span>
        </label>

        <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] font-semibold text-[#30343b]">
          <Switch
            checked={creativeDefaults.useResearch === true}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ useResearch: event.target.checked })}
          />
          <span className={cn('min-w-[42px]', creativeDefaults.useResearch ? 'text-[#111827]' : 'text-[#69717e]')}>{creativeDefaults.useResearch ? '已开启' : '已关闭'}</span>
          <span>联网研究默认开启</span>
        </label>

        <div className={`rounded-lg border p-3 ${sourceImageAnalysisUnsupported ? 'border-amber-200 bg-amber-50' : 'border-[#edf0f4] bg-[#fafbfc]'}`}>
          <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 text-[13px] font-semibold text-[#30343b]">
            <Switch
              checked={sourceImageAnalysisEnabled}
              disabled={disabled || (!sourceImageAnalysisEnabled && sourceImageAnalysisUnavailable)}
              onChange={event => handleSourceImageAnalysisChange(event.target.checked)}
            />
            <span className={cn('min-w-[42px]', sourceImageAnalysisEnabled ? 'text-[#111827]' : 'text-[#69717e]')}>{sourceImageAnalysisEnabled ? '已开启' : '已关闭'}</span>
            <span>来源图片多模态分析</span>
          </label>
          <p className="mt-2 whitespace-normal text-xs font-normal leading-relaxed text-[#69717e]">
            关闭后仍会提取文章/GitHub 图片，但只基于图片说明、URL 和上下文进行轻量匹配。
          </p>
          {sourceImageAnalysisWarning ? (
            <p className="mt-2 whitespace-normal text-xs font-semibold leading-relaxed text-[#b45309]" role="status">{sourceImageAnalysisWarning}</p>
          ) : null}
        </div>

        <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] font-semibold text-[#30343b]">
          <Switch
            checked={creativeDefaults.extractDouyinFrames === true}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ extractDouyinFrames: event.target.checked })}
          />
          <span className={cn('min-w-[42px]', creativeDefaults.extractDouyinFrames ? 'text-[#111827]' : 'text-[#69717e]')}>{creativeDefaults.extractDouyinFrames ? '已开启' : '已关闭'}</span>
          <span>抖音视频抽帧</span>
        </label>

        <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] font-semibold text-[#30343b]">
          <Switch
            checked={creativeDefaults.generateAudio !== false}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ generateAudio: event.target.checked })}
          />
          <span className={cn('min-w-[42px]', creativeDefaults.generateAudio !== false ? 'text-[#111827]' : 'text-[#69717e]')}>{creativeDefaults.generateAudio !== false ? '已开启' : '已关闭'}</span>
          <span>生成旁白音频</span>
        </label>

        <div className="rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3">
          <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 text-[13px] font-semibold text-[#30343b]">
            <Switch
              checked={creativeDefaults.autoSfxEnabled !== false}
              disabled={disabled}
              onChange={event => updateCreativeDefaults({ autoSfxEnabled: event.target.checked })}
            />
            <span className={cn('min-w-[42px]', creativeDefaults.autoSfxEnabled !== false ? 'text-[#111827]' : 'text-[#69717e]')}>
              {creativeDefaults.autoSfxEnabled !== false ? '已开启' : '已关闭'}
            </span>
            <span>自动音效增强</span>
          </label>
          <p className="mt-2 whitespace-normal text-xs font-normal leading-relaxed text-[#69717e]">
            生成视频时自动为文字入场、重点提示、转场、打字效果和结论强调添加短音效。关闭旁白音频后不会添加自动音效，开启后可能会略微增加生成时间。
          </p>
        </div>

        <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] font-semibold text-[#30343b]">
          <Switch
            checked={creativeDefaults.emotionalVoice === true}
            disabled={disabled || creativeDefaults.generateAudio === false}
            onChange={event => updateCreativeDefaults({ emotionalVoice: event.target.checked })}
          />
          <span className={cn('min-w-[42px]', creativeDefaults.emotionalVoice ? 'text-[#111827]' : 'text-[#69717e]')}>{creativeDefaults.emotionalVoice ? '已开启' : '已关闭'}</span>
          <span>情绪化配音</span>
        </label>

        <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] font-semibold text-[#30343b]">
          <Switch
            checked={creativeDefaults.generateCaptions !== false}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ generateCaptions: event.target.checked })}
          />
          <span className={cn('min-w-[42px]', creativeDefaults.generateCaptions !== false ? 'text-[#111827]' : 'text-[#69717e]')}>{creativeDefaults.generateCaptions !== false ? '已开启' : '已关闭'}</span>
          <span>生成字幕</span>
        </label>
      </div>
    </section>
  );
}
