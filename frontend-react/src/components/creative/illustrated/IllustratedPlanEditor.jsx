import {useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,Plus,Scissors,Save,Trash2,Merge} from 'lucide-react';
import {Button} from '@/components/ui/button.jsx';
import {Input} from '@/components/ui/input.jsx';
import {Textarea} from '@/components/ui/textarea.jsx';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog.jsx';
import {ConfirmDialog} from '@/components/ui/confirm-dialog.jsx';

export function Pager({page,setPage,total,size=6,label='记录'}) {
  const pages=Math.max(1,Math.ceil(total/size));
  return <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
    <span className="text-xs text-fg-3">共 {total} 条{label} · {Math.min(page,pages)} / {pages} 页</span>
    <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page<=1} onClick={()=>setPage(page-1)}>上一页</Button><Button size="sm" variant="outline" disabled={page>=pages} onClick={()=>setPage(page+1)}>下一页</Button></div>
  </div>;
}
export function IllustratedPlanEditor({plan,revision,workflowId,busy,onSave,onDirtyChange}) {
  const [draft,setDraft]=useState(plan),[saved,setSaved]=useState(plan),[editing,setEditing]=useState(''),[page,setPage]=useState(()=>{
    try{return Number(localStorage.getItem('illustrated:'+workflowId+':plan-page'))||1;}catch{return 1;}
  });
  const [deleteId,setDeleteId]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const baseRevision=useRef(revision),focusRef=useRef(null),textRef=useRef(null),lock=useRef(false);
  const dirty=JSON.stringify(draft)!==JSON.stringify(saved);
  useEffect(()=>{if(!dirty){setDraft(plan);setSaved(plan);baseRevision.current=revision;}},[plan,revision,dirty]);
  useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false);},[dirty,onDirtyChange]);
  useEffect(()=>{try{localStorage.setItem('illustrated:'+workflowId+':plan-page',String(page));}catch{}},[page,workflowId]);
  useEffect(()=>{if(draft?.scenes.length)setPage(value=>Math.min(value,Math.ceil(draft.scenes.length/6)));},[draft?.scenes.length]);
  if(!draft)return <p className="text-sm text-fg-3">文稿与分镜准备后可在这里编辑和确认。</p>;
  const active=draft.scenes.find(scene=>scene.id===editing),activeIndex=draft.scenes.findIndex(scene=>scene.id===editing);
  const changeScene=patch=>setDraft(current=>({...current,scenes:current.scenes.map(scene=>scene.id===editing?{...scene,...patch}:scene)}));
  const newId=()=>'scene_'+crypto.randomUUID().replaceAll('-','').slice(0,16);
  const open=id=>{focusRef.current=document.activeElement;setEditing(id);};
  const move=(id,direction)=>setDraft(current=>{
    const list=[...current.scenes],from=list.findIndex(scene=>scene.id===id),to=from+direction;
    if(to<0||to>=list.length)return current;
    [list[from],list[to]]=[list[to],list[from]];
    return {...current,scenes:list};
  });
  async function save(){
    if(lock.current)return;lock.current=true;setSaving(true);setError('');
    try{
      const result=await onSave({plan:draft,expectedRevision:baseRevision.current});
      const next=result.workflow.illustrated.plan;
      setDraft(next);setSaved(next);baseRevision.current=result.workflow.illustrated.revision;
    }catch(e){setError(e.message||'文稿保存失败，请检查内容后重试。');}
    finally{lock.current=false;setSaving(false);}
  }
  const split=()=>{
    const at=textRef.current?.selectionStart??0;
    if(at<=0||at>=active.text.length){setError('请把光标放在文稿中间的自然停顿处，再拆分画面。');return;}
    const list=[...draft.scenes],second={...active,id:newId(),title:active.title+'（后半）',text:active.text.slice(at).trim()};
    list.splice(activeIndex,1,{...active,text:active.text.slice(0,at).trim()},second);setDraft({...draft,scenes:list});
  };
  const merge=()=>{
    const next=draft.scenes[activeIndex+1];if(!next)return;
    const list=[...draft.scenes];list.splice(activeIndex,2,{...active,text:active.text+'\n'+next.text,
      visualIntent:[active.visualIntent,next.visualIntent].filter(Boolean).join('；'),imagePrompt:active.imagePrompt+'；'+next.imagePrompt});
    setDraft({...draft,scenes:list});
  };
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="m-0 text-lg font-semibold text-fg-1">文稿与分镜</h2><p className="mb-0 mt-1 text-xs text-fg-3">{dirty?'有未保存修改，保存后需要重新确认方案。':'修改正文会更新相关配音和语义配图；调整提示词只影响相应画面。'}</p></div>
      <div className="flex flex-wrap gap-2">
        {dirty?<Button variant="outline" disabled={busy||saving} onClick={()=>{setDraft(plan);setSaved(plan);baseRevision.current=revision;}}>放弃草稿修改</Button>:null}
        <Button disabled={busy||saving||!dirty} onClick={save}><Save size={14}/>{saving?'正在保存并回读文稿...':'保存文稿与分镜'}</Button>
      </div>
    </div>
    {error?<p role="alert" className="text-sm text-danger">{error}</p>:null}
    <label className="grid gap-1.5 text-xs font-semibold text-fg-2">作品标题<Input aria-label="文稿作品标题" value={draft.title} maxLength={120} disabled={busy||saving} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
    <details className="text-xs text-fg-3"><summary className="cursor-pointer py-2">叙事摘要与安排</summary><Textarea aria-label="叙事摘要" value={draft.summary} maxLength={4000} rows={3} disabled={busy||saving} onChange={e=>setDraft({...draft,summary:e.target.value})}/></details>
    <div className="divide-y divide-line-1 rounded-md border border-line-1">
      {draft.scenes.slice((page-1)*6,page*6).map((scene,index)=><div key={scene.id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-3 p-3 max-[480px]:grid-cols-[24px_minmax(0,1fr)]">
        <span className="pt-1 font-mono text-xs text-fg-3">{String((page-1)*6+index+1).padStart(2,'0')}</span>
        <div className="min-w-0"><p className="m-0 text-sm font-semibold text-fg-1">{scene.title}</p><p className="mb-0 mt-1 line-clamp-2 text-sm leading-relaxed text-fg-2">{scene.text}</p></div>
        <div className="flex gap-1 max-[480px]:col-start-2"><Button variant="outline" size="sm" disabled={busy||saving} onClick={()=>open(scene.id)}>查看与编辑</Button>
          <Button variant="ghost" size="icon" aria-label={'上移 '+scene.title} disabled={busy||saving||draft.scenes[0].id===scene.id} onClick={()=>move(scene.id,-1)}><ArrowUp size={14}/></Button>
          <Button variant="ghost" size="icon" aria-label={'下移 '+scene.title} disabled={busy||saving||draft.scenes.at(-1).id===scene.id} onClick={()=>move(scene.id,1)}><ArrowDown size={14}/></Button>
        </div>
      </div>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="outline" disabled={busy||saving||draft.scenes.length>=80} onClick={()=>{
        const scene={id:newId(),title:'新画面',text:'',visualIntent:'',imagePrompt:'',negativePrompt:'',weight:1};
        setDraft({...draft,scenes:[...draft.scenes,scene]});open(scene.id);
      }}><Plus size={14}/>添加画面</Button>
      <Pager page={page} setPage={setPage} total={draft.scenes.length} label="分镜"/>
    </div>
    <Dialog open={!!active} onOpenChange={open=>{if(!open&&!saving)setEditing('');}}>
      <DialogContent className="max-h-[calc(100dvh-32px)] w-[min(680px,calc(100vw-32px))] overflow-y-auto max-[760px]:[&_button]:min-h-11" onCloseAutoFocus={e=>{e.preventDefault();focusRef.current?.focus();}}>
        <DialogHeader><DialogTitle>编辑分镜：{active?.title}</DialogTitle><DialogDescription>关闭详情会保留页面草稿。点击“保存文稿与分镜”才会保存到任务，不会启动模型请求。</DialogDescription></DialogHeader>
        {active?<div className="grid gap-4">
          <label className="grid gap-1.5 text-xs text-fg-2">分镜标题<Input aria-label="分镜标题" value={active.title} disabled={busy||saving} maxLength={120} onChange={e=>changeScene({title:e.target.value})}/></label>
          <label className="grid gap-1.5 text-xs text-fg-2">旁白／字幕文稿<Textarea ref={textRef} aria-label="分镜文稿" value={active.text} disabled={busy||saving} rows={5} maxLength={10000} onChange={e=>changeScene({text:e.target.value})}/></label>
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy||saving||active.text.length<2} onClick={split}><Scissors size={14}/>在光标处拆分</Button><Button variant="outline" disabled={busy||saving||activeIndex===draft.scenes.length-1} onClick={merge}><Merge size={14}/>与下一幕合并</Button></div>
          <label className="grid gap-1.5 text-xs text-fg-2">画面意图<Textarea aria-label="画面意图" value={active.visualIntent} disabled={busy||saving} rows={2} maxLength={2000} onChange={e=>changeScene({visualIntent:e.target.value})}/></label>
          <label className="grid gap-1.5 text-xs text-fg-2">图片提示词<Textarea aria-label="图片提示词" value={active.imagePrompt} disabled={busy||saving} rows={4} maxLength={6000} onChange={e=>changeScene({imagePrompt:e.target.value})}/></label>
          <label className="grid gap-1.5 text-xs text-fg-2">负向要求<Textarea aria-label="负向要求" value={active.negativePrompt} disabled={busy||saving} rows={2} maxLength={3000} onChange={e=>changeScene({negativePrompt:e.target.value})}/></label>
          <label className="grid gap-1.5 text-xs text-fg-2">无配音时长权重（0.25–4）<Input aria-label="画面时长权重" type="number" min={0.25} max={4} step={0.25} value={active.weight} disabled={busy||saving} onChange={e=>changeScene({weight:Number(e.target.value)})}/></label>
          <div className="flex justify-between gap-2"><Button variant="ghost" className="text-danger" disabled={busy||saving||draft.scenes.length===1} onClick={()=>setDeleteId(active.id)}><Trash2 size={14}/>删除此画面</Button><Button onClick={()=>setEditing('')}>返回分镜列表</Button></div>
        </div>:null}
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={!!deleteId} onOpenChange={open=>{if(!open)setDeleteId('');}} title="从草稿删除此画面" description="文稿与画面一起从草稿移除，已有媒体历史保留。保存后需要重新确认方案。" destructive confirmText="从草稿删除" onConfirm={()=>{setDraft({...draft,scenes:draft.scenes.filter(scene=>scene.id!==deleteId)});setDeleteId('');setEditing('');}}/>
  </div>;
}
