import { useId } from 'react';
import { Textarea } from '@/components/ui/textarea.jsx';
import { LabeledSelect } from './ProductionSettingsFields.jsx';
import { validateOpening } from './openingForm.js';

export function QuestionOpeningFields({ value = { mode: 'disabled', question: '' }, onChange, disabled = false, allowEmpty = true, silent = false,
  playbackMode = 'before-body', onPlaybackModeChange }) {
  const id = useId();
  const error = validateOpening(value, { allowEmpty });
  return <div className="grid gap-3">
    <LabeledSelect label="视频开头" value={value.mode} disabled={disabled} onChange={mode => onChange({ ...value, mode })}
      options={[{ id: 'disabled', label: '直接开始正文' }, { id: 'question', label: '提问模式 · 卡片叠放' }, { id: 'image-montage', label: '图片汇总 · 无新增文字' }]} />
    {value.mode === 'image-montage' ? <>
      <p className="m-0 text-xs leading-6 text-fg-3">用全部成品图制作 3 秒开头：快速切图后汇成图片墙。不添加文字或开场配音，保留图片自身的文字。</p>
      {onPlaybackModeChange ? <>
        <LabeledSelect label="正文开始方式" value={playbackMode} disabled={disabled} onChange={onPlaybackModeChange}
          options={[{ id: 'before-body', label: '开头结束后开始绘制' }, { id: 'overlay-body', label: '从一开始绘制，开头覆盖在上层' }]} />
        <p className="m-0 text-xs leading-6 text-fg-3">{playbackMode === 'overlay-body'
          ? `正文绘制${silent ? '' : '和旁白'}从第 0 秒开始，前 3 秒由开头遮挡，结束后露出当时的绘制进度。开启的正文字幕显示在开头上方；正文不足 3 秒时，开头随正文结束。`
          : `先完整播放 3 秒开头，再开始正文绘制、字幕${silent ? '' : '和旁白'}；成片额外增加 3 秒。`}</p>
      </> : null}
    </> : null}
    {value.mode === 'question' ? <>
      <div className="grid gap-1.5 text-xs font-semibold text-fg-2">
        <label htmlFor={id}>开场问题{allowEmpty ? '（可选）' : ''}</label>
        <Textarea id={id} value={value.question || ''} disabled={disabled} maxLength={160} rows={2}
          placeholder={allowEmpty ? '留空后根据正文拟定，也可以写下你想问的问题。' : '填写开场问题，正文内容保持不变。'}
          aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
          onChange={event => onChange({ ...value, question: event.target.value })} />
      </div>
      <p className="m-0 text-xs leading-6 text-fg-3">{silent ? '开场显示问题，按阅读时长依次叠放全部成品图，再进入正文；不生成配音。' : '提问时依次叠放全部成品图，问题讲完后进入正文。开场额外计时，与正文一起确认和配音。'}开场始终显示提问文字。</p>
      {error ? <p id={`${id}-error`} role="alert" className="m-0 text-xs text-danger">{error}</p> : null}
    </> : null}
  </div>;
}
