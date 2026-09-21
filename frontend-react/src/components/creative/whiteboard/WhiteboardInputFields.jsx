import { useId, useState } from 'react';
import { Monitor, Settings2, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs.jsx';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog.jsx';
import { validateWhiteboardDraft, validateSubtitleSettings, whiteboardSubtitleStyle, WHITEBOARD_CANVAS_FORMATS } from './whiteboardForm.js';
import { cn } from '@/lib/utils.js';

export function LabeledSelect({ label, value, onChange, options, disabled = false }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-xs font-semibold text-fg-2">{label}</span>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label={label} className="bg-surface-1 max-[760px]:min-h-11"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(option => <SelectItem key={option.id} value={option.id} className="max-[760px]:min-h-11">{option.label || option.displayName}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

export function ProductionPlanFields({ value, onChange, disabled = false, aspectRatio = '16:9' }) {
  const id = useId();
  const change = (key, next) => onChange({ ...value, [key]: next });
  const subtitleStyle = whiteboardSubtitleStyle(value, aspectRatio);
  const defaultSize = whiteboardSubtitleStyle({}, aspectRatio).fontSize;
  const subtitleError = validateSubtitleSettings(value);
  const subtitlesDisabled = disabled || value.burnSubtitles === false;
  return (
    <div className="grid gap-4">
      <LabeledSelect label="旁白方式" value={value.narrationMode || 'enabled'} disabled={disabled} onChange={next => change('narrationMode', next)} options={[{ id: 'enabled', label: '使用设置中的完整旁白服务' }, { id: 'disabled', label: '不使用旁白' }]} />
      {value.narrationMode === 'disabled' ? <p className="m-0 text-xs leading-relaxed text-fg-3">主题和正文按目标时长安排字幕与分镜；SRT 保留输入时间轴。关闭背景音乐可制作完全静音的视频。</p> : null}
      <div className="grid gap-1.5">
        <LabeledSelect label="背景音乐" value={value.bgmMode || 'disabled'} disabled={disabled} onChange={next => change('bgmMode', next)} options={[{ id: 'disabled', label: '不使用 BGM' }, { id: 'enabled', label: '使用 BGM' }]} />
        <p className="m-0 text-xs leading-relaxed text-fg-3">开启后，成片加入内置轻钢琴音乐，低音量播放并首尾淡入淡出。完整旁白试听不含背景音乐。</p>
      </div>
      <LabeledSelect label="画笔显示" value={value.handDisplayMode} disabled={disabled} onChange={next => change('handDisplayMode', next)} options={[{ id: 'show', label: '显示画笔' }, { id: 'hide', label: '隐藏画笔' }]} />
      <LabeledSelect label="成片字幕" value={String(value.burnSubtitles)} disabled={disabled} onChange={next => change('burnSubtitles', next === 'true')} options={[{ id: 'true', label: '烧录字幕' }, { id: 'false', label: '不烧录字幕' }]} />
      <div className="grid gap-3 rounded-lg border border-line-1 p-3" role="group" aria-label="字幕样式">
        <div className="grid grid-cols-2 gap-3">
          <div className="grid content-start gap-1.5">
            <label htmlFor={`${id}-subtitle-color`} className="text-xs font-semibold text-fg-2">字幕颜色</label>
            <div className="flex min-w-0 items-center gap-2">
              <Input id={`${id}-subtitle-color`} aria-label="字幕颜色" type="color" value={subtitleStyle.color} disabled={subtitlesDisabled}
                className="w-12 shrink-0 cursor-pointer p-1 max-[760px]:min-h-11" onChange={event => change('subtitleColor', event.target.value.toUpperCase())} />
              <span className="min-w-0 font-mono text-xs text-fg-3">{subtitleStyle.color}</span>
            </div>
          </div>
          <div className="grid content-start gap-1.5">
            <label htmlFor={`${id}-subtitle-size`} className="text-xs font-semibold text-fg-2">字幕字号（px）</label>
            <Input id={`${id}-subtitle-size`} aria-label="字幕字号" type="number" min={24} max={96} step={1} inputMode="numeric"
              value={value.subtitleFontSize ?? ''} placeholder={`默认 ${defaultSize}`} disabled={subtitlesDisabled}
              aria-invalid={Boolean(subtitleError)} aria-describedby={subtitleError ? `${id}-subtitle-error` : `${id}-subtitle-help`}
              className="max-[760px]:min-h-11" onChange={event => change('subtitleFontSize', event.target.value === '' ? null : Number(event.target.value))} />
          </div>
        </div>
        <p id={`${id}-subtitle-help`} className="m-0 text-xs leading-relaxed text-fg-3">{value.burnSubtitles === false
          ? '开启成片字幕后可调整样式，已选颜色和字号会保留。'
          : `字号可填 24–96，留空使用默认 ${defaultSize} px。字幕始终按短句单行显示。`}</p>
        {subtitleError ? <p id={`${id}-subtitle-error`} className="m-0 text-xs text-danger" role="alert">{subtitleError}</p> : null}
        <div className={cn('flex min-h-20 items-center justify-center rounded-md bg-[#F5EBD7] px-3 py-3', value.burnSubtitles === false && 'opacity-40')} aria-label="字幕样式预览">
          <span className="whitespace-nowrap leading-tight" style={{ color: subtitleStyle.color, fontSize: `${subtitleStyle.fontSize / 2}px`,
            WebkitTextStroke: '1px #000000', paintOrder: 'stroke fill' }}>单行字幕</span>
        </div>
      </div>
      <LabeledSelect label="后续确认方式" value={String(value.agentApprovalEnabled)} disabled={disabled} onChange={next => change('agentApprovalEnabled', next === 'true')} options={[{ id: 'false', label: '由我逐阶段确认' }, { id: 'true', label: '授权 AI 在允许范围内推进' }]} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-line-1 pt-3 text-xs text-fg-2">
        <dt>生图方式</dt><dd>逐幕独立生成</dd>
        <dt>旁白服务</dt><dd>{value.narrationMode === 'disabled' ? '无需配置旁白服务' : '后续使用设置中启用的服务'}</dd>
      </dl>
      <p className="m-0 text-xs leading-relaxed text-fg-3">{value.narrationMode === 'disabled' ? '这些选项会随制作方案一起确认。确认后先检查字幕与分镜时长，再制作连续落墨动画与成片。' : '这些选项会随制作方案一起确认。确认后可制作完整旁白、连续落墨动画与成片；豆包完整旁白支持 120 秒以内方案。'}</p>
    </div>
  );
}

const INPUTS = [
  { id: 'topic', label: '主题', placeholder: '例如：用一分钟解释，为什么我们总把重要的事拖到明天？' },
  { id: 'text', label: '正文', placeholder: '粘贴已有文案。可以保留原文，或让 Agent 在保留事实的基础上润色。' },
  { id: 'srt', label: 'SRT 字幕', placeholder: '1\n00:00:00,000 --> 00:00:05,000\n粘贴已有的 SRT 字幕，保留原文和时间轴。' },
];

export function WhiteboardInputFields({ draft, onChange, catalog, disabled }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const active = INPUTS.find(item => item.id === draft.inputMode);
  const value = draft.contents[draft.inputMode];
  const validation = value.trim() ? validateWhiteboardDraft(draft) : '';
  const canvasFormats = catalog?.canvasFormats || WHITEBOARD_CANVAS_FORMATS;
  const selectedPreset = catalog?.visualPresets?.find(preset => preset.id === draft.visualStylePreset);
  const change = patch => onChange({ ...draft, ...patch });
  return (
    <div className="grid gap-4">
      <Tabs value={draft.inputMode} onValueChange={inputMode => change({ inputMode })}>
        <TabsList className="h-9 border-0 bg-surface-2 max-[760px]:h-14" aria-label="白板输入类型">
          {INPUTS.map(item => <TabsTrigger key={item.id} value={item.id} disabled={disabled} className="max-[760px]:min-h-11">{item.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value={draft.inputMode} className="mt-2">
          <label htmlFor="whiteboard-content" className="sr-only">白板{active.label}内容</label>
          <Textarea id="whiteboard-content" value={value} disabled={disabled} maxLength={50000} rows={5}
            className="min-h-[140px] resize-y border-0 px-1 text-base shadow-none focus-visible:ring-0"
            placeholder={active.placeholder} aria-invalid={Boolean(validation)} aria-describedby={validation ? 'whiteboard-input-error' : undefined}
            onChange={event => change({ contents: { ...draft.contents, [draft.inputMode]: event.target.value } })} />
        </TabsContent>
      </Tabs>
      {validation ? <p id="whiteboard-input-error" className="m-0 text-xs text-danger" role="alert">{validation}</p> : null}
      <div className="grid gap-2" role="group" aria-label="白板视频画幅">
        <span className="text-xs font-semibold text-fg-2">视频画幅</span>
        <div className="grid grid-cols-3 gap-2 max-[440px]:grid-cols-1">
          {canvasFormats.map(format => {
            const selected = (draft.aspectRatio || '16:9') === format.id;
            const Icon = format.height > format.width ? Smartphone : Monitor;
            return <Button key={format.id} type="button" variant="outline" disabled={disabled} aria-pressed={selected} aria-label={format.label}
              className={cn('h-auto min-w-0 justify-start gap-2 px-3 py-3 text-left shadow-none', selected ? 'border-ink bg-surface-2 text-ink' : 'border-line-1 text-fg-2')}
              onClick={() => change({ aspectRatio: format.id })}>
              <Icon size={20} className="shrink-0 max-[420px]:hidden" />
              <span className="grid min-w-0 gap-1"><span className="text-sm font-semibold">{format.label}</span><span className="text-xs font-normal text-fg-3">{format.width} × {format.height}</span></span>
            </Button>;
          })}
        </div>
      </div>
      {draft.inputMode === 'text' ? <LabeledSelect label="正文处理" value={draft.rewritePolicy} disabled={disabled} onChange={rewritePolicy => change({ rewritePolicy })} options={[{ id: 'preserve', label: '保留原文，仅安排分镜' }, { id: 'polish', label: '保留事实，润色口播' }]} /> : null}
      <div className="grid grid-cols-[0.8fr_1fr_1.5fr] gap-3 max-[560px]:grid-cols-1">
        {draft.inputMode === 'srt' ? <div className="grid content-start gap-1.5 text-xs"><span className="font-semibold text-fg-2">时长</span><span className="flex h-9 items-center text-fg-3">使用 SRT 时间轴</span></div> : (
          <label className="grid gap-1.5 text-xs font-semibold text-fg-2" htmlFor="whiteboard-duration">
            目标时长（秒）
            <Input id="whiteboard-duration" type="number" min={15} max={600} step={1} value={draft.targetDurationSeconds} disabled={disabled} className="max-[760px]:min-h-11" onChange={event => change({ targetDurationSeconds: event.target.value })} />
          </label>
        )}
        <LabeledSelect label={draft.productionPlan.narrationMode === 'disabled' ? '正文与字幕语言' : '旁白语言'} value={draft.narrationLanguage} disabled={disabled} onChange={narrationLanguage => change({ narrationLanguage })} options={catalog?.languages || []} />
        <LabeledSelect label="视觉模板" value={draft.visualStylePreset} disabled={disabled} onChange={visualStylePreset => change({ visualStylePreset })} options={catalog?.visualPresets || []} />
      </div>
      {selectedPreset?.description ? <p className="m-0 text-xs leading-6 text-fg-3">{selectedPreset.description}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-1 pt-3">
        <p className="m-0 text-xs text-fg-3">先确认方案，再进入制作。两种模式的草稿分别保留。</p>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} className="max-[760px]:min-h-11" onClick={() => setSettingsOpen(true)}><Settings2 size={14} />制作设置</Button>
      </div>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[calc(100dvh-32px)] w-[min(480px,calc(100vw-32px))] overflow-y-auto" showCloseButton>
          <DialogHeader><DialogTitle>白板制作设置</DialogTitle><DialogDescription>先保存为方案选项，在内容与制作方案中一起确认。</DialogDescription></DialogHeader>
          <ProductionPlanFields value={draft.productionPlan} aspectRatio={draft.aspectRatio} disabled={disabled} onChange={productionPlan => change({ productionPlan })} />
          <Button type="button" disabled={disabled || Boolean(validateSubtitleSettings(draft.productionPlan))} className="max-[760px]:min-h-11" onClick={() => setSettingsOpen(false)}>完成设置</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
