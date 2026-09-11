import { useState } from 'react';
import { Monitor, Settings2, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs.jsx';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog.jsx';
import { validateWhiteboardDraft } from './whiteboardForm.js';
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

export function ProductionPlanFields({ value, onChange, disabled = false }) {
  const change = (key, next) => onChange({ ...value, [key]: next });
  return (
    <div className="grid gap-4">
      <LabeledSelect label="旁白方式" value={value.narrationMode || 'enabled'} disabled={disabled} onChange={next => change('narrationMode', next)} options={[{ id: 'enabled', label: '使用设置中的完整旁白服务' }, { id: 'disabled', label: '静音（仅 SRT 输入）' }]} />
      <LabeledSelect label="画笔显示" value={value.handDisplayMode} disabled={disabled} onChange={next => change('handDisplayMode', next)} options={[{ id: 'show', label: '显示画笔' }, { id: 'hide', label: '隐藏画笔' }]} />
      <LabeledSelect label="成片字幕" value={String(value.burnSubtitles)} disabled={disabled} onChange={next => change('burnSubtitles', next === 'true')} options={[{ id: 'true', label: '烧录字幕' }, { id: 'false', label: '不烧录字幕' }]} />
      <LabeledSelect label="后续确认方式" value={String(value.agentApprovalEnabled)} disabled={disabled} onChange={next => change('agentApprovalEnabled', next === 'true')} options={[{ id: 'false', label: '由我逐阶段确认' }, { id: 'true', label: '授权 AI 在允许范围内推进' }]} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-line-1 pt-3 text-xs text-fg-2">
        <dt>背景音乐</dt><dd>不使用 BGM</dd>
        <dt>生图方式</dt><dd>逐幕独立生成</dd>
        <dt>旁白服务</dt><dd>后续使用设置中启用的服务</dd>
      </dl>
      <p className="m-0 text-xs leading-relaxed text-fg-3">这些选项会随制作方案一起确认。确认后可制作完整旁白、连续落墨动画与成片；豆包完整旁白支持 120 秒以内方案。</p>
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
  const canvasFormats = catalog?.canvasFormats || [
    { id: '16:9', label: '横屏 16:9', width: 1920, height: 1080 },
    { id: '9:16', label: '竖屏 9:16', width: 1080, height: 1920 },
  ];
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
        <div className="grid grid-cols-2 gap-2">
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
        <LabeledSelect label="旁白语言" value={draft.narrationLanguage} disabled={disabled} onChange={narrationLanguage => change({ narrationLanguage })} options={catalog?.languages || []} />
        <LabeledSelect label="视觉模板" value={draft.visualStylePreset} disabled={disabled} onChange={visualStylePreset => change({ visualStylePreset })} options={catalog?.visualPresets || []} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-1 pt-3">
        <p className="m-0 text-xs text-fg-3">先确认方案，再进入制作。两种模式的草稿分别保留。</p>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} className="max-[760px]:min-h-11" onClick={() => setSettingsOpen(true)}><Settings2 size={14} />制作设置</Button>
      </div>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="w-[min(480px,calc(100vw-32px))]" showCloseButton>
          <DialogHeader><DialogTitle>白板制作设置</DialogTitle><DialogDescription>先保存为方案选项，在内容与制作方案中一起确认。</DialogDescription></DialogHeader>
          <ProductionPlanFields value={draft.productionPlan} disabled={disabled} onChange={productionPlan => change({ productionPlan })} />
          <Button type="button" className="max-[760px]:min-h-11" onClick={() => setSettingsOpen(false)}>完成设置</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
