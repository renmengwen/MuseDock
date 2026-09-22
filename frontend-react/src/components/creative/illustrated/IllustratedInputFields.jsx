import {useRef,useState} from 'react';
import {Settings2} from 'lucide-react';
import {Button} from '@/components/ui/button.jsx';
import {Input} from '@/components/ui/input.jsx';
import {Textarea} from '@/components/ui/textarea.jsx';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs.jsx';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog.jsx';
import {LabeledSelect,FormatDurationFields} from '../shared/ProductionSettingsFields.jsx';
import {IllustratedSettings,StyleFields} from './IllustratedSettings.jsx';
import {validateIllustratedDraft} from './illustratedForm.js';
import {productionError} from '../shared/productionForm.js';

export function IllustratedInputFields({draft,onChange,disabled=false}) {
  const [open,setOpen]=useState(false),trigger=useRef(null);
  const change=patch=>onChange({...draft,...patch});
  const settings=draft.settings,error=draft.contents[draft.inputMode].trim()?validateIllustratedDraft(draft):'';
  return <div className="grid min-w-0 gap-4">
    <p className="m-0 text-sm leading-relaxed text-fg-2">先把故事讲清楚，再让图片动起来。确认文稿后制作完整配音，也可以关闭配音。</p>
    <Tabs value={draft.inputMode} onValueChange={inputMode=>change({inputMode})}>
      <TabsList aria-label="旁白配图输入类型"><TabsTrigger value="topic" disabled={disabled} className="min-h-11">主题</TabsTrigger><TabsTrigger value="text" disabled={disabled} className="min-h-11">正文</TabsTrigger></TabsList>
    </Tabs>
    <Textarea aria-label={'旁白配图'+(draft.inputMode==='topic'?'主题':'正文')} value={draft.contents[draft.inputMode]} disabled={disabled} rows={5} maxLength={50000}
      className="min-h-32 resize-y text-base" placeholder={draft.inputMode==='topic'?'例如：用一分钟讲述，城市清晨里那些温柔的瞬间。':'粘贴已有文案，可选择保留原文或润色口播。'}
      onChange={e=>change({contents:{...draft.contents,[draft.inputMode]:e.target.value}})}/>
    {draft.inputMode==='text'?<LabeledSelect label="正文处理" value={draft.rewritePolicy} disabled={disabled}
      onChange={rewritePolicy=>change({rewritePolicy})} options={[{id:'preserve',label:'保留原文，仅分段'},{id:'polish',label:'保留事实，润色口播'}]}/>:null}
    <details className="rounded-md border border-line-1 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-fg-2">标题与参考文本（可选）</summary>
      <div className="mt-3 grid gap-3">
        <label className="grid gap-1.5 text-xs text-fg-2">作品标题<Input aria-label="作品标题" value={draft.title} maxLength={120} disabled={disabled} onChange={e=>change({title:e.target.value})}/></label>
        <LabeledSelect label="参考文本用途" value={draft.referenceRole} disabled={disabled} onChange={referenceRole=>change({referenceRole})}
          options={[{id:'facts',label:'内容资料：可作为事实依据'},{id:'expression',label:'表达参考：只借鉴表达方式'}]}/>
        <Textarea aria-label="参考文本" value={draft.referenceText} rows={4} maxLength={40000} disabled={disabled} onChange={e=>change({referenceText:e.target.value})} placeholder="补充背景资料或表达参考，不会静默混用来源角色。"/>
      </div>
    </details>
    <div className="grid grid-cols-2 gap-5 max-[580px]:grid-cols-1">
      <FormatDurationFields value={settings} disabled={disabled} onChange={settings=>change({settings})}/>
      <div className="grid content-start gap-4">
        <LabeledSelect label="配音" value={settings.narrationMode} disabled={disabled} onChange={narrationMode=>change({settings:{...settings,narrationMode}})}
          options={[{id:'enabled',label:'开启 · 先配音后生图'},{id:'disabled',label:'关闭 · 使用计划时间轴'}]}/>
        <StyleFields value={settings} disabled={disabled} onChange={settings=>change({settings})}/>
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-1 pt-3">
      <Button variant="outline" className="min-h-11" aria-pressed={draft.useResearch} disabled={disabled} onClick={()=>change({useResearch:!draft.useResearch})}>{draft.useResearch?'联网资料：已开启':'联网资料：已关闭'}</Button>
      <Button ref={trigger} variant="ghost" className="min-h-11" disabled={disabled} onClick={()=>setOpen(true)}><Settings2 size={16}/>字幕、音乐与运动设置</Button>
    </div>
    <p className="m-0 text-xs text-fg-3">{settings.narrationMode==='disabled'?'无需 TTS 配置，按目标时长分配字幕与画面。':'实际配音时长会单独展示，确认后再生图。'}当前设置仅用于本次任务。</p>
    {error?<p className="m-0 text-xs text-danger" role="alert">{error}</p>:null}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="grid h-[min(840px,calc(100dvh-32px))] w-[min(600px,calc(100vw-32px))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0" onCloseAutoFocus={e=>{e.preventDefault();trigger.current?.focus();}}>
        <DialogHeader className="border-b border-line-1 px-6 pb-4 pt-5 pr-12"><DialogTitle>旁白配图制作设置</DialogTitle><DialogDescription>共用字幕、画幅与声音规则。新任务冻结这些选项，以后的全局修改不会改变本任务。</DialogDescription></DialogHeader>
        <div className="min-h-0 overflow-y-auto p-6"><IllustratedSettings value={settings} onChange={settings=>change({settings})} disabled={disabled}/></div>
        <div className="border-t border-line-1 px-6 py-4"><Button disabled={disabled||!!productionError(settings)} className="min-h-11 w-full" onClick={()=>setOpen(false)}>完成设置</Button></div>
      </DialogContent>
    </Dialog>
  </div>;
}
