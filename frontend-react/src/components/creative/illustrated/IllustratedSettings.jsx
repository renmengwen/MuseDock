import {Button} from '@/components/ui/button.jsx';
import {Input} from '@/components/ui/input.jsx';
import {Textarea} from '@/components/ui/textarea.jsx';
import {LabeledSelect,ProductionSettingsFields,FormatDurationFields} from '../shared/ProductionSettingsFields.jsx';
import {STYLES,TRACKS,MOTION_DEFAULTS} from './illustratedForm.js';
import {cn} from '@/lib/utils.js';
import './illustrated.css';

export function MotionDemo({trackId}) {
  const track=TRACKS.find(item=>item.id===trackId)||TRACKS[0];
  const start=track.id==='zoom_out'?'scale(1.2)':track.kind==='pan'?'translate('+(-track.dx*6)+'px,'+(-track.dy*6)+'px) scale(1.2)':'scale(1)';
  const end=track.id==='zoom_in'?'scale(1.2)':track.kind==='pan'?'translate('+(track.dx*6)+'px,'+(track.dy*6)+'px) scale(1.2)':'scale(1)';
  return <span className="illustrated-motion-demo" style={{'--motion-start':start,'--motion-end':end}} aria-hidden="true"><span><i/></span></span>;
}
export function StyleFields({value,onChange,disabled=false}) {
  return <div className="grid gap-3">
    <LabeledSelect label="生图风格" value={value.stylePreset} disabled={disabled} options={STYLES} onChange={stylePreset=>onChange({...value,stylePreset})}/>
    <p className="m-0 text-xs text-fg-3">{STYLES.find(item=>item.id===value.stylePreset)?.description||'画面由内容与自定义要求决定，首次不强制画风。'}</p>
    <label className="grid gap-1.5 text-xs font-semibold text-fg-2">自定义画面要求
      <Textarea aria-label="自定义画面要求" value={value.customStyle} maxLength={4000} disabled={disabled} rows={3}
        placeholder="例如：低饱和暖色，主体完整，避免画内文字。切换风格会保留这里的补充。"
        onChange={e=>onChange({...value,customStyle:e.target.value})}/>
    </label>
  </div>;
}
export function MotionFields({value,onChange,disabled=false,single=false}) {
  const motion={...MOTION_DEFAULTS,...value},change=patch=>onChange({...motion,...patch});
  return <div className="grid gap-4">
    {!single?<LabeledSelect label="图片运动方式" value={motion.mode} onChange={mode=>change({mode})} disabled={disabled}
      options={[{id:'off',label:'关闭运动'},{id:'uniform',label:'统一轨迹'},{id:'random',label:'每张图片随机'}]}/>:null}
    {single||motion.mode!=='off'?<>
      <div className="grid gap-2" role="group" aria-label="运动轨迹">
        <p className="m-0 text-xs text-fg-3">{!single&&motion.mode==='random'?'选择参与随机的轨迹，可选多项。':'选择轨迹。'}小图为轨迹示意，实际效果请播放运动片段。</p>
        <div className="grid grid-cols-3 gap-2 max-[440px]:grid-cols-2">
          {TRACKS.filter(item=>single||item.id!=='still').map(track=>{
            const pool=!single&&motion.mode==='random';
            const selected=pool?motion.pool.includes(track.id):motion.track===track.id;
            return <Button key={track.id} disabled={disabled||(pool&&selected&&motion.pool.length===1)} variant="outline"
              className={cn('h-auto min-h-20 flex-col gap-1 px-2 py-2 text-xs',selected&&'border-ink bg-surface-hover')} aria-pressed={selected}
              onClick={()=>pool?change({pool:selected?motion.pool.filter(id=>id!==track.id):[...motion.pool,track.id]}):change({track:track.id,amount:motion.amount>0?motion.amount:6})}>
              <MotionDemo trackId={track.id}/><span>{track.label}</span>
            </Button>;
          })}
        </div>
      </div>
      <div className="grid gap-2">
        <span className="text-xs font-semibold text-fg-2">运动幅度</span>
        <div className="flex flex-wrap gap-2">{[[6,'轻微'],[10,'标准'],[16,'明显']].map(([amount,label])=><Button key={amount} variant="outline" size="sm" disabled={disabled}
          aria-pressed={motion.amount===amount} onClick={()=>change({amount})}>{label} {amount}%</Button>)}</div>
        <Input aria-label="运动幅度（百分比）" type="number" min={0} max={20} step={1} value={motion.amount} disabled={disabled} onChange={e=>change({amount:Number(e.target.value)})}/>
        <p className="m-0 text-xs text-fg-3">幅度越大，边缘裁切越多。长镜头可适当提高幅度，请检查主体安全区。</p>
      </div>
      <LabeledSelect label="运动节奏" value={motion.easing} disabled={disabled} onChange={easing=>change({easing})}
        options={[{id:'smooth',label:'缓入缓出'},{id:'linear',label:'匀速'}]}/>
    </>:<p className="m-0 text-xs text-fg-3">保留幅度与轨迹设置，重新开启时沿用。所有画面均保持静止，单张设置会保留到重新开启。</p>}
    {!single?<LabeledSelect label="统一淡入淡出" value={String(motion.fadeMs)} disabled={disabled} onChange={value=>change({fadeMs:Number(value)})}
      options={[{id:'0',label:'关闭淡入淡出'},{id:'250',label:'短淡入淡出 · 250 毫秒'},{id:'500',label:'柔和淡入淡出 · 500 毫秒'}]}/>:<Button variant={motion.locked?'default':'outline'} aria-pressed={!!motion.locked} disabled={disabled} onClick={()=>change({locked:!motion.locked})}>{motion.locked?'已锁定：全局随机不影响本图':'锁定本图运动'}</Button>}
  </div>;
}
export function IllustratedSettings({value,onChange,disabled=false}) {
  return <div className="grid gap-6">
    <FormatDurationFields value={value} onChange={onChange} disabled={disabled}/>
    <ProductionSettingsFields value={value} onChange={onChange} disabled={disabled} includeLanguage/>
    <div className="border-t border-line-1 pt-4"><StyleFields value={value} onChange={onChange} disabled={disabled}/></div>
    <LabeledSelect label="画面密度" value={value.density} disabled={disabled} onChange={density=>onChange({...value,density})}
      options={[{id:'relaxed',label:'舒缓 · 较少画面，充分停留'},{id:'standard',label:'标准 · 按叙事自然换图'},{id:'compact',label:'紧凑 · 更多画面，信息密集'}]}/>
    <div className="border-t border-line-1 pt-4"><MotionFields value={value.motion} onChange={motion=>onChange({...value,motion})} disabled={disabled}/></div>
  </div>;
}
