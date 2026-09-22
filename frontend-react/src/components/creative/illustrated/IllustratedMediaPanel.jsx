import {useEffect,useRef,useState} from 'react';
import {Play,Upload,Shuffle,ImagePlus,Lock,Save} from 'lucide-react';
import {Button} from '@/components/ui/button.jsx';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog.jsx';
import {MotionFields} from './IllustratedSettings.jsx';
import {Pager} from './IllustratedPlanEditor.jsx';
import {durationLabel,TRACKS} from './illustratedForm.js';
import {cn} from '@/lib/utils.js';

const requestStatus={prepared:'排队中',requesting:'正在请求',done:'已完成',failed:'请求失败',local_failed:'本地处理失败',cancelled:'已取消',unknown_external_outcome:'结果待核实'};
export function IllustratedAudioPanel({workflow,busy,onAct,onConfirm}) {
  const s=workflow.illustrated,n=s.narration,enabled=s.settings.narrationMode==='enabled',audioRef=useRef(null);
  const [page,setPage]=useState(1),[partialPage,setPartialPage]=useState(1),segments=n?.segments||[],allowed=action=>s.allowedActions.includes(action);
  return <div className="grid gap-4">
    <div><h2 className="m-0 text-lg font-semibold text-fg-1">{enabled?'完整配音与实际时长':'无配音时间轴'}</h2>
      <p className="mb-0 mt-1 text-xs leading-relaxed text-fg-3">{enabled?'先完整试听，确认读音与实际时长后再生图。':'按目标时长和字幕阅读预算安排画面，不调用 TTS 或 ASR。'}</p></div>
    {n?<div className={cn('grid gap-3 rounded-md border p-4',s.narrationCurrent?'border-line-1 bg-surface-2':'border-warn')}>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">{s.narrationCurrent?'当前时间轴':'旧时间轴 · 需要更新'}</span><span className="font-mono text-xs text-fg-3">{durationLabel(n.actualDurationMs)}</span></div>
      <p className="m-0 text-xs text-fg-3">目标 {durationLabel(s.settings.targetDurationSeconds*1000)} · {n.timing.timingKind==='planned'?'计划分配（无配音）':n.timing.timingKind==='provider_native_words'?'同请求原生字幕时间点':'FunASR 句级时间点，长句显示时间单独分配'}</p>
      {enabled&&s.artifacts[n.audioId]?<audio ref={audioRef} controls className="w-full" src={s.artifacts[n.audioId].url} aria-label="完整旁白试听"/>:null}
      {enabled&&n.deviation>0.1?<p className="m-0 text-sm leading-relaxed text-warn">实际配音与目标偏差 {Math.round(n.deviation*100)}%。可以接受实际时长，或返回文稿／声音设置后重新生成。系统不会静默变速或截断。</p>:null}
      {segments.length?<details><summary className="cursor-pointer py-2 text-xs text-fg-2">按分段定位试听（{segments.length} 段）</summary>
        <div className="grid gap-2">{segments.slice((page-1)*6,page*6).map((segment,index)=>{
          const absolute=(page-1)*6+index,start=segments.slice(0,absolute).reduce((sum,item)=>sum+item.durationMs,0)/1000;
          return <Button key={segment.id} variant="outline" className="h-auto justify-start whitespace-normal py-2 text-left text-xs"
            onClick={()=>{if(audioRef.current){audioRef.current.currentTime=start;audioRef.current.play().catch(()=>{});}}}>第 {absolute+1} 段 · {durationLabel(segment.durationMs)} · {segment.text.slice(0,45)}</Button>;
        })}</div><Pager page={page} setPage={setPage} total={segments.length} label="分段"/>
      </details>:null}
    </div>:null}
    {enabled&&(s.pendingAudioTakes||s.pendingAudioChunkTakes)?<p className="m-0 text-sm text-fg-2">替代配音尚未完成。当前成功配音仍保留，可以继续未完成的分段。</p>:null}
    <div className="flex flex-wrap gap-2">
      {enabled&&s.narrationCurrent&&(s.pendingAudioTakes||s.pendingAudioChunkTakes)&&allowed('prepare_narration')?<Button disabled={busy} onClick={()=>onConfirm('继续未完成配音','成功分段将复用，只请求尚未完成或已明确授权的新分段。',()=>onAct('prepare_narration'))}>继续未完成配音</Button>:null}
      {allowed('prepare_narration')&&!s.narrationCurrent?<Button disabled={busy} onClick={()=>enabled
        ?onConfirm('生成完整配音','使用冻结的 '+(s.models.tts.modelId||'当前配音模型')+'，约 '+(s.narrationRequestCount||0)+' 段请求。成功分段会复用，图片稍后单独生成。',()=>onAct('prepare_narration'))
        :onAct('prepare_narration')}>{enabled?'生成完整配音':'建立无配音时间轴'}</Button>:null}
      {allowed('approve_audio')&&s.approvals.audio!==n?.identity?<Button disabled={busy} onClick={()=>onConfirm('确认配音与实际时长','请确认已经试听当前完整旁白。后续画面将以 '+durationLabel(n.actualDurationMs)+' 的实际时长安排。',()=>onAct('approve_audio',{identity:n.identity}))}>已试听，接受实际时长</Button>:null}
      {allowed('regenerate_narration')?<Button variant="outline" disabled={busy} onClick={()=>onConfirm('重新生成完整配音','会发送新的配音请求并重新确认声音，无关图片保留。若只需修复一幕，请在图片详情中选择重做该幕配音。',()=>onAct('regenerate_narration'))}>重新生成完整配音</Button>:null}
    </div>
    {s.narrationHistory?.length?<details><summary className="cursor-pointer py-2 text-xs text-fg-3">历史配音（{s.narrationHistory.length} 版）</summary>
      <div className="grid gap-3">{s.narrationHistory.slice(-5).toReversed().map(item=><div key={item.identity} className="grid gap-1"><p className="m-0 text-xs text-fg-3">旧版本 · {durationLabel(item.durationMs)}</p><audio controls className="w-full" preload="none" src={s.artifacts[item.audioId]?.url}/></div>)}</div>
    </details>:null}
    {enabled&&s.partialNarration?.length&&(!s.narrationCurrent||workflow.status==='failed'||workflow.status==='unknown_external_outcome')?<details>
      <summary className="cursor-pointer py-2 text-xs text-fg-3">已保留的配音分段（{s.partialNarration.length} 段）</summary>
      <div className="grid gap-3">{s.partialNarration.slice((partialPage-1)*6,partialPage*6).map((item,index)=><div key={item.id+index} className="grid gap-1 rounded-md border border-line-1 p-3">
        <p className="m-0 text-xs text-fg-2">{item.sceneId} · {item.verified?'音频与字幕已校验':'音频已保存，字幕待处理'}</p><p className="m-0 text-xs text-fg-3">{item.text?.slice(0,80)}</p>
        <audio controls preload="none" className="w-full" src={s.artifacts[item.audioId]?.url}/>
      </div>)}</div><Pager page={partialPage} setPage={setPartialPage} total={s.partialNarration.length} label="分段"/>
    </details>:null}
    {!allowed('prepare_narration')&&!s.narrationCurrent?<p className="m-0 text-sm text-fg-3">请先确认当前文稿与分镜。</p>:null}
  </div>;
}

export function IllustratedMediaPanel({workflow,busy,onAct,onUpload,onConfirm,onDirtyChange,actionError,actionMessage,refreshing,onRefresh}) {
  const s=workflow.illustrated,[page,setPage]=useState(1),[activeId,setActiveId]=useState(''),[candidatePage,setCandidatePage]=useState(1);
  const [motion,setMotion]=useState(null),[savedMotion,setSavedMotion]=useState(null),[localError,setLocalError]=useState('');
  const motionRevision=useRef(s.revision),focusRef=useRef(null),inputRef=useRef(null);
  const active=s.scenes.find(scene=>scene.id===activeId),dirty=JSON.stringify(motion)!==JSON.stringify(savedMotion);
  const allowed=action=>s.allowedActions.includes(action);
  useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false);},[dirty,onDirtyChange]);
  useEffect(()=>{if(active&&!dirty){setMotion(active.motion);setSavedMotion(active.motion);motionRevision.current=s.revision;}},[active?.motion,s.revision,dirty]);
  const open=scene=>{focusRef.current=document.activeElement;setActiveId(scene.id);setMotion(scene.motion);setSavedMotion(scene.motion);motionRevision.current=s.revision;setCandidatePage(1);setLocalError('');};
  const close=()=>{
    if(dirty){onConfirm('放弃未保存的运动修改','当前轨迹修改尚未保存，离开详情会放弃这些修改。',async()=>{setMotion(savedMotion);setActiveId('');});}
    else setActiveId('');
  };
  const upload=async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(file.size>30*1024*1024){setLocalError('图片不能超过 30 MB。');return;}
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setLocalError('请选择 PNG、JPEG 或 WebP 图片。');return;}
    setLocalError('');
    try{await onUpload(active.id,file);}catch(e){setLocalError(e.message||'上传失败，请检查图片后重试。');}
  };
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="m-0 text-lg font-semibold text-fg-1">图片与运动</h2><p className="mb-0 mt-1 text-xs text-fg-3">缩略图用于选图。打开详情可播放实际运动片段、调整轨迹和选择历史候选。</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy||!allowed('rerandomize')} onClick={()=>onAct('rerandomize')}><Shuffle size={14}/>重新随机未锁定画面</Button>
        <Button disabled={busy||!allowed('generate_images')||s.missingImages===0} onClick={()=>onConfirm('生成全部缺失配图',
          '将使用 '+(s.models.image.modelId||'当前图片模型')+' 生成 '+s.missingImages+' 张缺失配图。成功候选会保留，失败项可单独处理。',()=>onAct('generate_images'))}><ImagePlus size={14}/>补齐缺失配图（{s.missingImages}）</Button>
      </div>
    </div>
    {!allowed('generate_images')?<p className="m-0 rounded-md bg-surface-2 p-3 text-xs text-fg-2">{s.settings.narrationMode==='enabled'?'先确认方案和完整配音的实际时长，再生成图片。可以提前上传本地候选。':'先确认方案并建立无配音时间轴，再生成图片。'}</p>:null}
    <div className="grid grid-cols-3 gap-3 max-[1100px]:grid-cols-2 max-[480px]:grid-cols-1">
      {s.scenes.slice((page-1)*6,page*6).map((scene,index)=>{
        const image=scene.selected&&s.artifacts[scene.selected.artifactId];
        return <div key={scene.id} className="overflow-hidden rounded-md border border-line-1 bg-surface-1">
          <button type="button" className="block w-full bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink" aria-label={'查看画面 '+scene.title} onClick={()=>open(scene)}>
            {image?<img src={image.url} alt={scene.title+'配图缩略图'} className="aspect-video w-full object-cover"/>:<div className="flex aspect-video items-center justify-center text-sm text-fg-3">等待配图</div>}
          </button>
          <div className="grid gap-2 p-3"><div className="flex justify-between gap-2"><h3 className="m-0 min-w-0 truncate text-sm font-semibold">{String((page-1)*6+index+1).padStart(2,'0')} {scene.title}</h3>{scene.motion.locked?<Lock size={14} aria-label="已锁定"/>:null}</div>
            <p className="m-0 text-xs text-fg-3">{s.settings.motion.mode==='off'?'运动已关闭':TRACKS.find(item=>item.id===scene.motion.track)?.label} · {scene.motion.amount}% · {scene.timing?durationLabel(scene.timing.endMs-scene.timing.startMs):'时间待定'}</p>
            <p className={cn('m-0 text-xs',scene.imageStatus.includes('failed')?'text-danger':'text-fg-3')}>{requestStatus[scene.imageStatus]|| (image?'已选图片':'缺少当前图片')} · {scene.candidates.length} 个候选</p>
            <Button variant="outline" size="sm" onClick={()=>open(scene)}>候选与运动详情</Button>
          </div>
        </div>;
      })}
    </div>
    <Pager page={page} setPage={setPage} total={s.scenes.length} label="画面"/>
    <Button className="justify-self-start" disabled={busy||!allowed('approve_images')||!s.imagesIdentity||s.approvals.images===s.imagesIdentity}
      onClick={()=>onConfirm('确认当前选图','请确认所有画面内容、构图和裁切安全。下一步将生成包含运动、字幕与声音的动态预览。',()=>onAct('approve_images',{identity:s.imagesIdentity}))}>{s.approvals.images&&s.approvals.images===s.imagesIdentity?'当前选图已确认':'确认当前全部选图'}</Button>
    <Dialog open={!!active} onOpenChange={value=>{if(!value&&(!busy||!dirty))close();}}>
      <DialogContent className="max-h-[calc(100dvh-32px)] w-[min(940px,calc(100vw-32px))] max-w-none overflow-y-auto max-[760px]:[&_button]:min-h-11" onCloseAutoFocus={e=>{e.preventDefault();focusRef.current?.focus();}}>
        <DialogHeader><DialogTitle>{active?.title} · 图片与运动</DialogTitle><DialogDescription>保存运动后再生成片段。片段展示真实时长、裁切与字幕，完整声音在整片预览中检查。</DialogDescription></DialogHeader>
        {actionMessage?<p role="status" className="m-0 text-sm text-fg-2">{actionMessage}</p>:null}
        {actionError?<p role="alert" className="m-0 text-sm text-danger">{actionError}</p>:null}
        {onRefresh?<Button variant="outline" disabled={refreshing} onClick={onRefresh}>{refreshing?'正在重新读取...':'刷新检查已保存版本'}</Button>:null}
        {active?<div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6 max-[760px]:grid-cols-1">
          <div className="grid min-w-0 gap-3">
            {active.preview&&s.artifacts[active.preview.artifactId]?<div className="grid gap-2"><video controls preload="metadata" className="max-h-96 w-full rounded-md bg-ink" src={s.artifacts[active.preview.artifactId].url} aria-label="当前画面运动片段"/><p className={cn('m-0 text-xs',active.previewCurrent?'text-fg-3':'text-warn')}>{active.previewCurrent?'当前运动片段（无混音）':'旧运动片段 · 修改后需要重新生成'}</p></div>
              :active.selected?<img src={s.artifacts[active.selected.artifactId]?.url} alt="当前选图（静态浏览）" className="max-h-96 w-full rounded-md object-contain"/>:<p className="text-sm text-fg-3">请生成或上传图片。</p>}
            {active.crop?.warning?<p className="m-0 text-xs text-warn">{active.crop.warning}</p>:null}
            <div className="flex flex-wrap gap-2"><Button disabled={busy||dirty||!active.selected||!allowed('preview_scene')} onClick={()=>onAct('preview_scene',{sceneId:active.id})}><Play size={14}/>生成运动片段</Button>
              <Button variant="outline" disabled={busy||dirty||!allowed('generate_images')} onClick={()=>onConfirm('为此画面生成新候选','将发送 1 次图片请求，使用 '+(s.models.image.modelId||'当前图片模型')+'。旧候选与其他画面保留。',()=>onAct('generate_images',{sceneId:active.id,regenerate:true}))}>生成新候选</Button>
              <Button variant="outline" disabled={busy||dirty||!allowed('upload_image')} onClick={()=>inputRef.current?.click()}><Upload size={14}/>上传图片</Button>
              <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={upload}/>
            </div>
            {localError?<p role="alert" className="text-sm text-danger">{localError}</p>:null}
            <h3 className="mb-0 text-sm font-semibold">图片候选（静态浏览）</h3>
            <div className="grid grid-cols-2 gap-2">{active.candidates.slice((candidatePage-1)*4,candidatePage*4).map(candidate=><div key={candidate.id} className={cn('grid gap-2 rounded-md border p-2',candidate.id===active.selected?.id?'border-ink':'border-line-1')}>
              <img src={s.artifacts[candidate.artifactId]?.url} alt={candidate.current?'可用图片候选':'旧版本图片候选'} className="aspect-video w-full rounded object-cover"/>
              <p className="m-0 text-xs text-fg-3">{candidate.source==='upload'?'本地上传':'模型生成'} · {candidate.current?'适用当前内容':'内容或风格已失效'}</p>
              <Button size="sm" variant={candidate.id===active.selected?.id?'default':'outline'} disabled={busy||dirty||!candidate.current||candidate.id===active.selected?.id}
                onClick={()=>onAct('select_image',{sceneId:active.id,candidateId:candidate.id})}>{candidate.id===active.selected?.id?'已选择':'选择这张'}</Button>
              <details className="text-xs text-fg-3"><summary className="cursor-pointer py-1">提示词与来源</summary><p className="break-words">{candidate.model?.modelId||'本地图片'}</p><p className="whitespace-pre-wrap break-words leading-relaxed">{candidate.prompt}</p></details>
            </div>)}</div>
            <Pager page={candidatePage} setPage={setCandidatePage} total={active.candidates.length} size={4} label="候选"/>
            {allowed('regenerate_narration')?<Button variant="outline" disabled={busy||dirty} onClick={()=>onConfirm('重做这一幕配音','只为这一幕发送新的配音请求，其他成功分段复用。需要重新试听完整旁白。',()=>onAct('regenerate_narration',{sceneId:active.id}))}>只重做这一幕配音</Button>:null}
          </div>
          <div className="grid min-w-0 gap-4">
            {s.settings.motion.mode==='off'?<p className="text-xs text-fg-3">全局运动已关闭。重新开启后可调整单张轨迹。</p>:null}
            {motion?<MotionFields single value={motion} onChange={setMotion} disabled={busy||s.settings.motion.mode==='off'}/>:null}
            <Button disabled={busy||!dirty} onClick={async()=>{
              setLocalError('');
              try{const response=await onAct('save_motion',{sceneId:active.id,motion,expectedRevision:motionRevision.current});
                if(!response)return; const saved=response.workflow.illustrated.motions[active.id];setMotion(saved);setSavedMotion(saved);motionRevision.current=response.workflow.illustrated.revision;
              }catch(e){setLocalError(e.message||'保存运动失败。');}
            }}><Save size={14}/>保存并回读运动</Button>
            <Button variant="outline" disabled={busy||dirty||motion?.locked} onClick={()=>onAct('rerandomize',{sceneId:active.id})}><Shuffle size={14}/>只重新随机这一张</Button>
            <p className="m-0 text-xs text-fg-3">{dirty?'运动有未保存修改。':'已保存的随机结果在刷新、重启与重新导出时保持不变。'}</p>
          </div>
        </div>:null}
      </DialogContent>
    </Dialog>
  </div>;
}
