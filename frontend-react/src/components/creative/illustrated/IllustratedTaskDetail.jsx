import {useCallback,useEffect,useRef,useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {Download,Loader2,Settings2,Play,FileText} from 'lucide-react';
import {Button} from '@/components/ui/button.jsx';
import {Textarea} from '@/components/ui/textarea.jsx';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs.jsx';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog.jsx';
import {ConfirmDialog} from '@/components/ui/confirm-dialog.jsx';
import {productionError} from '../shared/productionForm.js';
import {IllustratedSettings} from './IllustratedSettings.jsx';
import {IllustratedPlanEditor,Pager} from './IllustratedPlanEditor.jsx';
import {IllustratedAudioPanel,IllustratedMediaPanel} from './IllustratedMediaPanel.jsx';
import {durationLabel,STYLES} from './illustratedForm.js';
import {cn} from '@/lib/utils.js';

const areaFor=stage=>['content_plan','plan_review'].includes(stage)?'plan':['narration','audio_review','images'].includes(stage)?'media':'preview';
const loadingText={save_plan:'正在保存并回读文稿与分镜...',save_settings:'正在保存并回读制作设置...',
  refresh:'正在重新读取服务器中的任务版本...',
  approve_plan:'正在确认当前方案...',prepare_narration:'正在启动配音与时间轴制作...',regenerate_narration:'正在准备新的配音版本...',
  approve_audio:'正在确认实际配音时长...',generate_images:'正在提交配图任务...',upload_image:'正在上传和检查图片...',
  select_image:'正在保存选图...',approve_images:'正在确认当前图片...',save_motion:'正在保存并回读运动参数...',
  rerandomize:'正在重新分配运动轨迹...',preview_scene:'正在启动运动片段渲染...',render_preview:'正在启动动态预览渲染...',
  export:'正在验证并导出当前视频...',authorize_retry:'正在登记新的请求授权...',
  generate_plan:'正在准备文稿与分镜...',cancel:'正在停止后续请求派发...'};

export function IllustratedTaskDetail({workflow,onAction,onDirtyChange=()=>{}}) {
  const s=workflow.illustrated,navigate=useNavigate(),lock=useRef(false),focusRef=useRef(null),revisionRef=useRef(s.revision);
  const [area,setArea]=useState(()=>{try{const saved=localStorage.getItem('illustrated:'+workflow.workflow_id+':area');return ['plan','media','preview'].includes(saved)?saved:areaFor(workflow.current_stage);}catch{return areaFor(workflow.current_stage);}});
  const [working,setWorking]=useState(''),[feedback,setFeedback]=useState(null),[confirmation,setConfirmation]=useState(null);
  const [readbackRequired,setReadbackRequired]=useState(false),[viewGeneration,setViewGeneration]=useState(0);
  const [settingsOpen,setSettingsOpen]=useState(false),[discardSettings,setDiscardSettings]=useState(false),[settingsDraft,setSettingsDraft]=useState(s.settings);
  const [revisionRequest,setRevisionRequest]=useState(''),[historyPage,setHistoryPage]=useState(1);
  const [planDirty,setPlanDirty]=useState(false),[motionDirty,setMotionDirty]=useState(false);
  const markPlanDirty=useCallback(value=>setPlanDirty(value),[]),markMotionDirty=useCallback(value=>setMotionDirty(value),[]);
  const settingsDirty=settingsOpen&&JSON.stringify(settingsDraft)!==JSON.stringify(s.settings);
  const settingsError=productionError(settingsDraft);
  const dirty=planDirty||motionDirty||settingsDirty;
  const running=['queued','running'].includes(workflow.status),busy=!!working||running||readbackRequired;
  const allowed=action=>s.allowedActions.includes(action);
  useEffect(()=>{
    if(feedback?.started && s.operation?.id===feedback.operationId && !['queued','running'].includes(s.operation.status)) setFeedback(null);
  },[feedback?.started,feedback?.operationId,s.operation?.id,s.operation?.status]);
  useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false);},[dirty,onDirtyChange]);
  useEffect(()=>{try{localStorage.setItem('illustrated:'+workflow.workflow_id+':area',area);}catch{}},[area,workflow.workflow_id]);
  useEffect(()=>{
    if(!dirty)return;
    const before=event=>{event.preventDefault();event.returnValue='';};
    const click=event=>{
      const anchor=event.target.closest?.('a[href]');
      if(!anchor||anchor.target==='_blank'||anchor.hasAttribute('download'))return;
      const url=new URL(anchor.href,window.location.href);
      if(url.origin!==window.location.origin||url.pathname===window.location.pathname||url.pathname.startsWith('/api/'))return;
      event.preventDefault();event.stopPropagation();
      setConfirmation({title:'放弃未保存修改并离开',description:'当前页面有尚未保存的修改，离开后将丢失。',run:async()=>navigate(url.pathname+url.search)});
    };
    window.addEventListener('beforeunload',before);document.addEventListener('click',click,true);
    return()=>{window.removeEventListener('beforeunload',before);document.removeEventListener('click',click,true);};
  },[dirty,navigate]);
  function confirm(title,description,run){setConfirmation({title,description,run});}
  async function send(action,extra={},throwError=false){
    if(lock.current)return null;
    lock.current=true;setWorking(action);setFeedback({error:false,text:loadingText[action]||'正在处理...'});
    try {
      const result=await onAction({action,expectedRevision:s.revision,requestId:crypto.randomUUID(),...extra});
      if(!result?.workflow)throw new Error('服务未返回更新后的任务，请刷新检查。');
      setFeedback({error:false,started:!!result.task_id,operationId:result.workflow.illustrated.operation?.id,
        text:result.task_id?'任务已启动，可在当前页面查看进度。':'操作已保存，已从服务器回读当前版本。'});
      if (action === 'approve_plan') setArea('media');
      if (action === 'approve_images') setArea('preview');
      return result;
    }catch(error){if(error.code==='READBACK_FAILED')setReadbackRequired(true);setFeedback({error:true,text:error.message||'操作失败，请检查服务后重试。'});if(throwError)throw error;return null;}
    finally{lock.current=false;setWorking('');}
  }
  async function refreshReadback(){
    const response=await send('refresh');
    if(!response)return;
    setReadbackRequired(false);setDiscardSettings(false);setSettingsOpen(false);
    setViewGeneration(value=>value+1);
  }
  async function upload(sceneId,file){
    const data=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('读取本地图片失败。'));reader.readAsDataURL(file);
    });
    return send('upload_image',{sceneId,data},true);
  }
  const openSettings=()=>{
    focusRef.current=document.activeElement;revisionRef.current=s.revision;
    setSettingsDraft(s.settings);setDiscardSettings(false);setSettingsOpen(true);
  };
  const closeSettings=()=>{
    if(discardSettings)return;
    if(settingsDirty)setDiscardSettings(true);
    else setSettingsOpen(false);
  };
  const changeArea=next=>{
    // 分镜草稿在切换区域时保留组件状态。
    setArea(next);
  };
  const preview=s.preview&&s.artifacts[s.preview.artifactId];
  return <div className="grid min-w-0 gap-5 text-fg-1 max-[760px]:[&_button]:min-h-11">
    <header className="grid gap-4 border-b border-line-1 pb-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="mb-2 mt-0 text-xs font-semibold tracking-wide text-fg-3">旁白配图视频 · {s.settings.aspectRatio} · 25 fps</p><h1 className="m-0 break-words text-2xl font-semibold leading-tight">{workflow.title}</h1></div>
        <Button variant="outline" disabled={busy||dirty} onClick={openSettings}><Settings2 size={16}/>本地任务参数</Button></div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-fg-2"><span>目标 {durationLabel(s.settings.targetDurationSeconds*1000)}</span>
        <span>{s.settings.narrationMode==='enabled'?'使用配音':'无配音'}</span><span>{s.settings.burnSubtitles?'烧录字幕':'不烧录字幕'}</span><span>{STYLES.find(style=>style.id===s.settings.stylePreset)?.label}</span>
        <span>制作版本 {s.revision}{dirty?' · 有未保存修改':''}</span></div>
    </header>
    <div role={workflow.status==='failed'||workflow.status==='unknown_external_outcome'?'alert':'status'} className={cn('sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 bg-surface-2',
      workflow.status==='failed'?'border-danger':workflow.status==='unknown_external_outcome'?'border-warn':'border-line-1')}>
      <div className="min-w-0 flex-1"><p className="m-0 flex items-start gap-2 text-sm leading-relaxed">{busy?<Loader2 className="mt-0.5 shrink-0 animate-spin" size={16}/>:null}{working?loadingText[working]:workflow.message}</p>
        {s.operation&&s.operation.type!=='plan'?<p className="mb-0 mt-1 text-xs text-fg-3">待处理 {s.operation.progress.queued} · 执行中 {s.operation.progress.running} · 成功 {s.operation.progress.success} · 失败 {s.operation.progress.failed} · 取消 {s.operation.progress.cancelled}{s.unknownAttempts.length?' · 待核实 '+s.unknownAttempts.length:''}</p>:null}
      </div>
      {running?<Button variant="outline" disabled={!!working||s.operation?.cancelRequested} onClick={()=>send('cancel')}>{s.operation?.cancelRequested?'正在停止后续派发':'取消后续制作'}</Button>:null}
    </div>
    {feedback?<div className="grid justify-items-start gap-2"><p role={feedback.error?'alert':'status'} className={cn('m-0 text-sm leading-relaxed',feedback.error?'text-danger':'text-fg-2')}>{feedback.text}</p>
      {readbackRequired?<Button variant="outline" disabled={!!working} onClick={refreshReadback}>{working==='refresh'?'正在重新读取...':'刷新检查已保存版本'}</Button>:null}</div>:null}
    {s.unknownAttempts.length?<div className="grid gap-3 rounded-md border border-warn p-4"><p className="m-0 text-sm">有 {s.unknownAttempts.length} 个请求结果待核实。请先查看 API 返回记录，避免重复计费。</p>
      {s.unknownAttempts.map(attempt=><div key={attempt.id} className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-fg-2">{attempt.sceneId||'内容方案'} · {attempt.message}</span>
        <Button variant="outline" disabled={busy} onClick={()=>confirm('核实后授权一个新请求','原请求可能已经执行或计费。确认后只解除这一项的保护；下一步仍由你明确开始制作。',()=>send('authorize_retry',{attemptId:attempt.id,authorizeNewRequest:true}))}>核实后允许重新请求</Button></div>)}
    </div>:null}
    <Tabs value={area} onValueChange={changeArea}>
      <TabsList className="grid h-auto w-full grid-cols-3 bg-surface-2 p-1" aria-label="旁白配图工作区域">
        {[['plan','文稿与分镜'],['media','媒体与审核'],['preview','预览与导出']].map(([id,label])=><TabsTrigger key={id} value={id} className="min-h-11 whitespace-normal px-1 text-xs">{label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
    <section style={{display:area==='plan'?'grid':'none'}} aria-label="文稿与分镜方案" className="grid gap-5">
      {s.plan?<IllustratedPlanEditor key={workflow.workflow_id+':'+viewGeneration} plan={s.plan} revision={s.revision} workflowId={workflow.workflow_id} busy={busy} onSave={extra=>send('save_plan',extra,true)} onDirtyChange={markPlanDirty}/>:null}
      <details><summary className="cursor-pointer py-2 text-sm font-semibold">{s.plan?'让模型生成修改版':'生成文稿与分镜'}</summary>
        <div className="grid gap-3 pt-2"><Textarea aria-label="方案修改要求" value={revisionRequest} maxLength={4000} disabled={busy} onChange={e=>setRevisionRequest(e.target.value)} placeholder="可选：描述希望怎样调整文稿或分镜。"/>
          <Button disabled={busy||dirty||!allowed('generate_plan')} className="justify-self-start" onClick={()=>confirm('生成文稿与分镜','将使用冻结的 '+(s.models.text.modelId||'分析模型')+' 请求一个新方案，已有媒体和版本历史保留。',()=>send('generate_plan',{revisionRequest}))}>生成文稿与分镜</Button></div>
      </details>
      {s.plan?<Button className="justify-self-start" disabled={busy||dirty||!allowed('approve_plan')||s.approvals.plan===s.planGate}
        onClick={()=>confirm('确认内容与制作方案',s.settings.narrationMode==='enabled'?'确认后可生成完整配音，试听通过后再生图。':'确认后按目标时长建立计划时间轴，不调用配音或转写。',()=>send('approve_plan'))}>{s.approvals.plan===s.planGate?'当前方案已确认':'确认当前文稿与制作方案'}</Button>:null}
      {s.planHistory.length?<details><summary className="cursor-pointer py-2 text-xs text-fg-3">历史方案（{s.planHistory.length} 个）</summary>{s.planHistory.slice(-5).reverse().map((item,index)=><p key={index} className="text-xs text-fg-3">{item.title} · {item.scenes.length} 幕 · {item.savedAt}</p>)}</details>:null}
    </section>
    <section style={{display:area==='media'?'grid':'none'}} aria-label="媒体制作与审核" className="grid gap-7">
      <IllustratedAudioPanel workflow={workflow} busy={busy||dirty} onAct={send} onConfirm={confirm}/>
      <div className="border-t border-line-1 pt-5"><IllustratedMediaPanel key={viewGeneration} workflow={workflow} busy={busy||planDirty} onAct={send} onUpload={upload} onConfirm={confirm} onDirtyChange={markMotionDirty} actionError={feedback?.error?feedback.text:''} actionMessage={working?loadingText[working]:running?workflow.message:''} refreshing={working==='refresh'} onRefresh={readbackRequired?refreshReadback:null}/></div>
    </section>
    <section style={{display:area==='preview'?'grid':'none'}} aria-label="动态预览与导出" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="m-0 text-lg font-semibold">整片动态预览</h2><p className="mb-0 mt-1 text-xs text-fg-3">播放检查运动、字幕、配音与音乐。确认后导出相同的已验证视频。</p></div>
        <Button disabled={busy||dirty||!allowed('render_preview')} onClick={()=>send('render_preview')}><Play size={16}/>{s.previewCurrent?'重新检查并生成预览':'生成当前动态预览'}</Button></div>
      {preview?<div className="grid gap-2"><video controls preload="metadata" className="max-h-[65vh] w-full rounded-md bg-ink" src={preview.url} aria-label="整片动态预览"/>
        <p className={cn('m-0 text-xs',s.previewCurrent?'text-fg-3':'text-warn')}>{s.previewCurrent?'当前预览':'旧预览 · 上游内容或设置已经变化，需要重新生成'} · {preview.width}×{preview.height} · {durationLabel(preview.durationMs)}</p></div>
        :<div className="flex min-h-52 items-center justify-center rounded-md border border-dashed border-line-2 bg-surface-2 p-5 text-center text-sm text-fg-3">确认方案、时间轴与选图后，在这里生成并播放动态预览。</div>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy||dirty||!allowed('export')} onClick={()=>confirm('确认预览并导出','请确认已经观看当前整片预览。导出将保留这一版视频、字幕和制作清单，后续修改会形成新版本。',()=>send('export',{identity:s.mediaIdentity}))}><Download size={16}/>已观看，确认并导出</Button>
        {s.previewCurrent&&s.preview.srtId?<Button asChild variant="outline"><a href={s.artifacts[s.preview.srtId].downloadUrl}><FileText size={14}/>下载当前字幕</a></Button>:null}</div>
      {s.exports.length?<div className="grid gap-3 border-t border-line-1 pt-4"><h3 className="m-0 text-sm font-semibold">导出记录</h3>
        {s.exports.toReversed().slice((historyPage-1)*6,historyPage*6).map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line-1 p-3">
          <div className="text-xs"><strong>{item.identity===s.mediaIdentity&&item.artifactId===s.preview?.artifactId?'当前版本':'历史版本'}</strong><span className="ml-2 text-fg-3">{new Date(item.createdAt).toLocaleString('zh-CN')}</span></div>
          <div className="flex gap-2"><Button asChild size="sm"><a href={s.artifacts[item.artifactId].downloadUrl}>下载 MP4</a></Button><Button asChild size="sm" variant="outline"><a href={s.artifacts[item.manifestId].downloadUrl}>制作清单</a></Button></div>
        </div>)}<Pager page={historyPage} setPage={setHistoryPage} total={s.exports.length} label="导出"/>
      </div>:null}
    </section>
    <footer className="flex flex-wrap justify-between gap-3 border-t border-line-1 pt-4 text-xs text-fg-3"><span>任务保存在 MuseDock 本地 · 失败时保留已成功的媒体</span><Link to={'/api-calls?workflow='+encodeURIComponent(workflow.workflow_id)} className="text-ink underline">API 返回记录</Link></footer>
    <Dialog open={settingsOpen} onOpenChange={value=>{if(!value&&!working&&!running)closeSettings();}}>
      <DialogContent className="grid h-[min(840px,calc(100dvh-32px))] w-[min(960px,calc(100vw-32px))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[960px] max-[760px]:[&_button]:min-h-11" showCloseButton={!discardSettings} onCloseAutoFocus={e=>{e.preventDefault();focusRef.current?.focus();}}>
        <DialogHeader className="border-b border-line-1 px-6 pb-4 pt-5 pr-12"><DialogTitle>本地任务参数</DialogTitle><DialogDescription>这里只调整本任务的制作设置，不修改创建时的输入与参考文本，也不会写回全局默认值。</DialogDescription></DialogHeader>
        <div className="min-h-0 overflow-y-auto p-6" aria-label="本地任务参数滚动内容"><IllustratedSettings value={settingsDraft} onChange={setSettingsDraft} disabled={busy||discardSettings}/></div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line-1 bg-surface-1 px-6 py-4">
          {feedback?.error?<p role="alert" className="m-0 w-full text-sm text-danger">{feedback.text}</p>:null}
          {settingsError?<p role="alert" className="m-0 w-full text-sm text-danger">{settingsError}</p>:null}
          {readbackRequired?<Button variant="outline" disabled={!!working} onClick={refreshReadback}>{working==='refresh'?'正在重新读取...':'刷新检查已保存版本'}</Button>:null}
          {discardSettings?<>
            <p className="m-0 w-full text-sm text-warn" role="alert">制作设置尚未保存，关闭后会放弃修改。</p>
            <Button variant="outline" onClick={()=>setDiscardSettings(false)}>继续编辑</Button>
            <Button variant="destructive" onClick={()=>{setDiscardSettings(false);setSettingsOpen(false);}}>放弃修改</Button>
          </>:<>
            <Button variant="outline" disabled={!!working||running} onClick={closeSettings}>关闭</Button>
            <Button disabled={busy||!settingsDirty||!!settingsError} onClick={async()=>{const result=await send('save_settings',{settings:settingsDraft,expectedRevision:revisionRef.current});if(result)setSettingsOpen(false);}}>保存并回读制作设置</Button>
          </>}
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={!!confirmation} onOpenChange={value=>{if(!value)setConfirmation(null);}} title={confirmation?.title||'确认操作'} description={confirmation?.description}
      loading={!!working} onConfirm={async()=>{if(!confirmation)return;try{const result=await confirmation.run();if(result!==null)setConfirmation(null);}catch(error){setFeedback({error:true,text:error.message});}}} confirmText="确认">
      {feedback?.error?<p className="m-0 text-sm text-danger" role="alert">{feedback.text}</p>:null}
    </ConfirmDialog>
  </div>;
}
