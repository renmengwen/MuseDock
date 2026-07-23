import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils.js';
import { Switch } from './Switch.jsx';

export const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5'];

const DEFAULT_CREATIVE_DEFAULTS = {
  aspectRatio: '9:16',
  targetDurationSec: 60,
  maxAiGeneratedImages: 6,
  pexelsBackfillEnabled: false,
  useResearch: true,
  generateAudio: true,
  autoSfxEnabled: true,
  generateCaptions: true,
  emotionalVoice: false,
  sourceImageAnalysisEnabled: false,
  extractDouyinFrames: false,
  frameHtmlConcurrency: 1,
};

function getCreativeDefaults(appSettings) {
  return {
    ...DEFAULT_CREATIVE_DEFAULTS,
    ...(appSettings?.creativeDefaults || {}),
  };
}

export function CreativeDefaultsSettings({
  appSettings,
  activeModels,
  modelSettingsLoading = false,
  disabled,
  saving,
  onChange,
  onSave,
}) {
  const [sourceImageAnalysisMessage, setSourceImageAnalysisMessage] = useState('');
  const creativeDefaults = getCreativeDefaults(appSettings);
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
          <p className="mt-1 text-[13px] text-[#69717e]">设置一键创作默认使用的画面比例、目标时长、AI 生图数量和联网研究开关。</p>
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
            max="600"
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
          <span className="text-xs font-semibold text-[#5f6876]">单个视频最多 AI 生图数量</span>
          <input
            type="number"
            min="1"
            max="20"
            step="1"
            value={creativeDefaults.maxAiGeneratedImages}
            disabled={disabled}
            className="h-[38px] w-full rounded-lg border border-[#d9dde5] bg-white px-2.5 text-[13px] text-[#30343b] outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/15 disabled:cursor-not-allowed disabled:opacity-60"
            onChange={event => updateCreativeDefaults({
              maxAiGeneratedImages: event.target.value === '' ? '' : Number(event.target.value),
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

        <label className="inline-flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] font-semibold text-[#30343b]">
          <Switch
            checked={creativeDefaults.pexelsBackfillEnabled === true}
            disabled={disabled}
            onChange={event => updateCreativeDefaults({ pexelsBackfillEnabled: event.target.checked })}
          />
          <span className={cn('min-w-[42px]', creativeDefaults.pexelsBackfillEnabled ? 'text-[#111827]' : 'text-[#69717e]')}>{creativeDefaults.pexelsBackfillEnabled ? '已开启' : '已关闭'}</span>
          <span>Pexels 补图</span>
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
