import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button.jsx';
import {FormatDurationFields,ProductionSettingsFields} from '../creative/shared/ProductionSettingsFields.jsx';
import {PRODUCTION_DEFAULTS,productionError} from '../creative/shared/productionForm.js';

export function ProductionDefaultsSettings({appSettings,disabled,saving,onSave,onDirtyChange}) {
  const initial=appSettings?.productionDefaults||PRODUCTION_DEFAULTS;
  const [draft,setDraft]=useState(initial),[baseline,setBaseline]=useState(initial),lock=useRef(false);
  const dirty=JSON.stringify(draft)!==JSON.stringify(baseline);
  useEffect(()=>{if(!dirty){setDraft(initial);setBaseline(initial);}},[appSettings?.productionDefaults,dirty]);
  useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false);},[dirty,onDirtyChange]);
  return <div className="grid max-w-2xl gap-5 max-[760px]:[&_button]:min-h-11">
    <div><h3 className="m-0 text-lg font-semibold text-fg-1">共用制作默认值</h3><p className="mb-0 mt-2 text-sm leading-relaxed text-fg-3">用于之后新建的白板动画与旁白配图视频。已有任务保持自己的制作快照，任务内临时修改不会写回这里。</p></div>
    <FormatDurationFields value={draft} onChange={setDraft} disabled={disabled}/>
    <ProductionSettingsFields value={draft} onChange={setDraft} disabled={disabled} includeLanguage/>
    {productionError(draft)?<p role="alert" className="text-sm text-danger">{productionError(draft)}</p>:null}
    <div className="flex flex-wrap gap-2"><Button disabled={disabled||!dirty||!!productionError(draft)} onClick={async()=>{
      if(lock.current)return;lock.current=true;
      try{const saved=await onSave({productionDefaults:draft});if(saved){setDraft(saved.productionDefaults);setBaseline(saved.productionDefaults);}}
      finally{lock.current=false;}
    }}>{saving?'正在保存共用制作默认值...':'保存共用制作默认值'}</Button><Button variant="outline" disabled={disabled||!dirty} onClick={()=>setDraft(baseline)}>放弃修改</Button></div>
  </div>;
}
