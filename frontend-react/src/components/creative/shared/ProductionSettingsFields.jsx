import {useId} from 'react';
import {Input} from '@/components/ui/input.jsx';
import {Button} from '@/components/ui/button.jsx';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select.jsx';
import {subtitleStyle,validateSubtitleSettings,CANVAS_FORMATS,LANGUAGES} from './productionForm.js';
import {cn} from '@/lib/utils.js';

export function LabeledSelect({label,value,onChange,options,disabled=false}) {
  return <div className="grid min-w-0 gap-1.5">
    <span className="text-xs font-semibold text-fg-2">{label}</span>
    <Select value={String(value)} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className="min-w-0 bg-surface-1 max-[760px]:min-h-11"><SelectValue/></SelectTrigger>
      <SelectContent>{options.map(option=><SelectItem key={option.id} value={String(option.id)} className="max-[760px]:min-h-11">{option.label||option.displayName}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}
export function FormatDurationFields({value,onChange,disabled=false}) {
  return <div className="grid gap-4">
    <div role="group" aria-label="视频画幅" className="grid gap-2">
      <span className="text-xs font-semibold text-fg-2">视频画幅</span>
      <div className="grid grid-cols-3 gap-2">
        {CANVAS_FORMATS.map(format=><Button key={format.id} variant="outline" className={cn('min-h-11 px-1',value.aspectRatio===format.id&&'border-ink bg-surface-hover')}
          disabled={disabled} aria-pressed={value.aspectRatio===format.id} onClick={()=>onChange({...value,aspectRatio:format.id})}>{format.id}</Button>)}
      </div>
    </div>
    <div className="grid gap-2">
      <label className="text-xs font-semibold text-fg-2">目标时长（秒）
        <Input aria-label="目标时长（秒）" type="number" min={15} max={600} step={1} className="mt-1.5 max-[760px]:min-h-11"
          value={value.targetDurationSeconds} disabled={disabled} onChange={e=>onChange({...value,targetDurationSeconds:e.target.value===''?'':Number(e.target.value)})}/>
      </label>
      <div className="flex flex-wrap gap-1.5">{[15,30,60,180,300,600].map(seconds=><Button key={seconds} size="sm" variant="outline" className="max-[760px]:min-h-11"
        disabled={disabled} aria-pressed={Number(value.targetDurationSeconds)===seconds} onClick={()=>onChange({...value,targetDurationSeconds:seconds})}>{seconds<60?seconds+' 秒':seconds/60+' 分钟'}</Button>)}</div>
    </div>
  </div>;
}
export function ProductionSettingsFields({value,onChange,disabled=false,aspectRatio=value.aspectRatio||'16:9',includeLanguage=false}) {
  const id=useId(),style=subtitleStyle(value,aspectRatio),defaultSize=subtitleStyle({},aspectRatio).fontSize;
  const error=validateSubtitleSettings(value),change=(key,next)=>onChange({...value,[key]:next});
  return <div className="grid gap-4">
    <LabeledSelect label="旁白方式" value={value.narrationMode||'enabled'} onChange={v=>change('narrationMode',v)} disabled={disabled}
      options={[{id:'enabled',label:'使用设置中的完整旁白服务'},{id:'disabled',label:'不使用旁白'}]}/>
    <p className="m-0 text-xs leading-relaxed text-fg-3">{value.narrationMode==='disabled'
      ?'按目标时长安排字幕与画面，不调用配音或转写。关闭背景音乐可制作完全静音视频。'
      :'先生成完整旁白，试听并确认实际时长，再准备图片。完整旁白试听不含背景音乐。'}</p>
    {includeLanguage?<LabeledSelect label="旁白与字幕语言" value={value.narrationLanguage} onChange={v=>change('narrationLanguage',v)} disabled={disabled} options={LANGUAGES}/>:null}
    <LabeledSelect label="背景音乐" value={value.bgmMode||'disabled'} onChange={v=>change('bgmMode',v)} disabled={disabled}
      options={[{id:'disabled',label:'不使用 BGM'},{id:'enabled',label:'使用 BGM'}]}/>
    <p className="m-0 text-xs leading-relaxed text-fg-3">背景音乐独立控制，低音量播放并首尾淡入淡出。</p>
    <LabeledSelect label="成片字幕" value={String(value.burnSubtitles)} onChange={v=>change('burnSubtitles',v==='true')} disabled={disabled}
      options={[{id:'true',label:'烧录字幕'},{id:'false',label:'不烧录字幕'}]}/>
    <div role="group" aria-label="字幕样式" className="grid gap-3 border-t border-line-1 pt-3">
      <div className="grid grid-cols-2 gap-3">
        <label htmlFor={id+'-color'} className="grid content-start gap-1.5 text-xs font-semibold text-fg-2">字幕颜色
          <div className="flex min-w-0 items-center gap-2"><Input id={id+'-color'} aria-label="字幕颜色" type="color" value={style.color} disabled={disabled||!value.burnSubtitles}
            className="w-12 shrink-0 p-1 max-[760px]:min-h-11" onChange={e=>change('subtitleColor',e.target.value.toUpperCase())}/><span className="font-mono text-xs text-fg-3">{style.color}</span></div>
        </label>
        <label htmlFor={id+'-size'} className="grid content-start gap-1.5 text-xs font-semibold text-fg-2">字幕字号（px）
          <Input id={id+'-size'} aria-label="字幕字号" type="number" min={24} max={96} step={1} value={value.subtitleFontSize??''} placeholder={'默认 '+defaultSize}
            disabled={disabled||!value.burnSubtitles} aria-invalid={!!error} className="max-[760px]:min-h-11" onChange={e=>change('subtitleFontSize',e.target.value===''?null:Number(e.target.value))}/>
        </label>
      </div>
      <p className="m-0 text-xs text-fg-3">{value.burnSubtitles?'字号 24–96，留空使用默认 '+defaultSize+' px。字幕按短句单行显示。':'已选颜色与字号会保留，字幕文件仍可下载。'}</p>
      {error?<p role="alert" className="text-xs text-danger">{error}</p>:null}
      <div aria-label="字幕样式预览" className={cn('flex min-h-20 items-center justify-center rounded-md bg-ink p-3',!value.burnSubtitles&&'opacity-40')}>
        <span style={{color:style.color,fontSize:style.fontSize/2,WebkitTextStroke:'1px var(--fg-1)',paintOrder:'stroke fill'}} className="whitespace-nowrap leading-tight">单行字幕</span>
      </div>
    </div>
  </div>;
}
