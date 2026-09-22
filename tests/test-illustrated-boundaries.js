const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {fixture,plan}=require('./test-illustrated-narration');
const {wav,nativeFixture,markerImage}=require('./test-illustrated-media');
const workflow=require('../server/services/creative/illustrated/workflows');
const store=require('../server/services/creative/illustrated/storage');
const state=require('../server/services/creative/illustrated/state');
const contract=require('../server/services/creative/illustrated/contracts');
const media=require('../server/services/creative/illustrated/media');
const imageService=require('../server/services/ai/aiImageModel');
async function ready(ctx,settings={}) {
  const id=await ctx.create(settings);await workflow.run(id,ctx.options);await ctx.act(id,'approve_plan');
  await ctx.act(id,'prepare_narration');const result=await workflow.run(id,ctx.options);assert.notEqual(result.status,'failed',result.message);
  if(settings.narrationMode==='enabled')await ctx.act(id,'approve_audio',{identity:(await ctx.read(id)).illustrated.narration.identity});
  return id;
}
function setTts(ctx) {
  ctx.options.services.aiTtsModel.callTtsModel=async request=>{ctx.counters.tts++;return {success:true,format:'wav',audioBuffer:wav(2000),nativeSubtitles:nativeFixture(request.text,2000)};};
}
const tests=[
 ['豆包慢语速缩短分段，为 120 秒单次上限留出余量',async()=>{
   const text='这是用于验证慢速旁白预算的完整正文。'.repeat(40);
   const parts=require('../server/services/creative/illustrated/timing').chunkText({id:'scene_1',text},'zh-CN',{provider:'doubao',doubao:{speechRate:-50}});
   assert.equal(parts.map(part=>part.text).join(''),text);assert(parts.every(part=>part.text.length<=140));
 }],
 ['旧渲染或同输入的新视频文件不能冒充当前已导出版本',()=>fixture(async ctx=>{
   const id=await ready(ctx);await store.mutate(id,ctx.options,record=>{
     const s=record.illustrated;
     for(const scene of s.plan.scenes){s.candidates[scene.id]=[{id:scene.id,artifactId:'fixture_image',dependency:contract.imageIdentity(scene,s.settings)}];s.selections[scene.id]=scene.id;}
     s.approvals.images=state.imagesIdentity(s);
     s.preview={identity:'old_renderer_identity',artifactId:'old_video'};
     s.exports=[{identity:'old_renderer_identity',artifactId:'old_video'}];
     record.status='done';record.current_stage='export';record.message='当前版本已导出。';
     record.result={render:{output_url:'/old.mp4'}};record.render_output_url='/old.mp4';
   });
   let record=await ctx.read(id);const before=JSON.stringify(record),view=state.view(record);
   assert.equal(view.status,'waiting_approval');assert.equal(view.current_stage,'preview');assert.equal(view.render_output_url,'');
   assert.equal(require('../server/services/creative/creativeWorkflowDto').normalizeCreativeWorkflowSummary(record).output_url,'');
   assert.equal(JSON.stringify(record),before,'只读视图不得改写保存的原记录');
   record.illustrated.preview={identity:state.mediaIdentity(record.illustrated),artifactId:'new_video'};
   record.illustrated.exports=[{identity:state.mediaIdentity(record.illustrated),artifactId:'old_video'}];
   assert.equal(state.view(record).status,'waiting_approval');assert.equal(state.view(record).current_stage,'export');
 })],
 ['不兼容模式版本明确拒绝读取/更新，启动恢复不改写文件',()=>fixture(async ctx=>{
   const id=await ctx.create();
   await store.mutate(id,ctx.options,record=>{record.creationModeContractVersion=2;});
   const facade=require('../server/services/creative/creativeWorkflows');
   const response=await facade.getCreativeWorkflow(id,{rootDir:ctx.rootDir});assert.equal(response.code,'CONTRACT_UNSUPPORTED');
   const before=await fs.readFile(store.getWorkflowPath(id,ctx.rootDir),'utf8');
   const patch=await facade.patchCreativeWorkflowTaskSummary(id,{task_status:'failed',fail_running_stages:true},{rootDir:ctx.rootDir});
   assert.equal(patch.code,'CONTRACT_UNSUPPORTED');assert.equal(await fs.readFile(store.getWorkflowPath(id,ctx.rootDir),'utf8'),before);
   const futureRoot=path.join(ctx.rootDir,'data','creative-workflows');await fs.mkdir(futureRoot,{recursive:true});
   const futureFile=path.join(futureRoot,id+'.json');await fs.writeFile(futureFile,before);
   const unknown={...JSON.parse(before),workflow_id:id+'1',creationModeId:'future-creative-v9',creationModeContractVersion:9,created_at:'2000-01-01T00:00:00Z'};
   const unknownFile=path.join(futureRoot,unknown.workflow_id+'.json'),unknownText=JSON.stringify(unknown);
   await fs.writeFile(unknownFile,unknownText);
   require('node:child_process').execFileSync(process.execPath,['-e',"require('./server/services/creative/creativeWorkflows').recoverStaleWorkflowsOnStartup().catch(e=>{console.error(e.message);process.exitCode=1})"],
     {cwd:path.resolve(__dirname,'..'),env:{...process.env,MUSEDOCK_DATA_DIR:ctx.rootDir},stdio:'pipe'});
   assert.equal(await fs.readFile(futureFile,'utf8'),before);
   assert.equal(await fs.readFile(unknownFile,'utf8'),unknownText);
 })],
 ['模型插入分镜并重新编号时保留未改动画面的身份',async()=>{
   const original=contract.normalizePlan(plan,{});
   const changed=structuredClone(plan);
   changed.scenes=changed.scenes.map((scene,index)=>({...scene,id:'scene_'+(index+2)}));
   changed.scenes.unshift({...plan.scenes[0],id:'scene_1',text:'这是新增加的开场。',imagePrompt:'城市清晨的远景，屋顶与街道层次分明'});
   const aligned=state.alignSceneIds(original,contract.normalizePlan(changed,{}));
   assert.notEqual(aligned.scenes[0].id,'scene_1');assert.deepEqual(aligned.scenes.slice(1).map(scene=>scene.id),['scene_1','scene_2','scene_3']);
 }],
 ['短配音尾段不受白板落墨时长限制',async()=>{
   const chunk={id:'short_tail',sceneId:'scene_1',text:'好了。'};
   const timed=require('../server/services/creative/illustrated/timing').nativeSegmentTiming(chunk,nativeFixture(chunk.text,500),500,contract.normalizeSettings());
   assert.equal(timed.durationMs,500);assert.equal(timed.captions[0].text,'好了。');
 }],
 ['取消在线性化派发之前生效，不再调用模型',()=>fixture(async ctx=>{
   const id=await ctx.create(),original=store.mutate;let armed=true;
   store.mutate=async(workflowId,options,callback)=>{
     const record=await ctx.read(workflowId);
     if(armed&&record.illustrated.attempts.at(-1)?.status==='prepared'){armed=false;await ctx.act(id,'cancel');}
     return original(workflowId,options,callback);
   };
   try{await workflow.run(id,ctx.options);}finally{store.mutate=original;}
   const record=await ctx.read(id);assert.equal(ctx.counters.text,0);assert.equal(record.illustrated.operation.status,'cancelled');
   assert.equal(record.illustrated.attempts.at(-1).status,'cancelled');
 })],
 ['工作目录准备失败落为失败终态',()=>fixture(async ctx=>{
   const id=await ctx.create(),directory=store.mediaRoot(id,ctx.rootDir);
   await fs.mkdir(path.dirname(directory),{recursive:true});await fs.writeFile(directory,'directory blocked by fixture');
   const result=await workflow.run(id,ctx.options);
   assert.equal(result.status,'failed');assert.equal(result.illustrated.operation.status,'failed');assert.equal(ctx.counters.text,0);
   assert(result.illustrated.allowedActions.includes('generate_plan'));
 })],
 ['重配音排队后取消保留成功音频和审核，成功替代后保留历史',()=>fixture(async ctx=>{
   setTts(ctx);const id=await ready(ctx,{narrationMode:'enabled'});const before=await ctx.read(id),count=ctx.counters.tts;
   await ctx.act(id,'regenerate_narration');
   assert.deepEqual((await ctx.read(id)).illustrated.narration,before.illustrated.narration);
   await ctx.act(id,'cancel');await workflow.run(id,ctx.options);
   let record=await ctx.read(id);
   assert.deepEqual(record.illustrated.narration,before.illustrated.narration);assert.equal(record.illustrated.approvals.audio,before.illustrated.approvals.audio);
   assert.equal(ctx.counters.tts,count);
   await ctx.act(id,'prepare_narration');await workflow.run(id,ctx.options);
   record=await ctx.read(id);assert.equal(ctx.counters.tts,count+3);
   assert.equal(record.illustrated.narrationHistory[0].identity,before.illustrated.narration.identity);assert.equal(record.illustrated.approvals.audio,'');
 })],
 ['成功图片下载后读取失败保留重发保护',()=>fixture(async ctx=>{
   const id=await ready(ctx),original=imageService.downloadGeneratedImages;
   ctx.options.services.aiImageModel={generateImages:async()=>{ctx.counters.image++;return {success:true,images:[{b64_json:'unused'}]};}};
   imageService.downloadGeneratedImages=async()=>({success:true,files:[{local_path:path.join(ctx.rootDir,'missing-image.png')}]});
   try{
     await ctx.act(id,'generate_images',{sceneId:'scene_1'});
     const result=await workflow.run(id,ctx.options);assert.equal(result.status,'unknown_external_outcome');
     await assert.rejects(ctx.act(id,'generate_images',{sceneId:'scene_1'}),/当前阶段/);assert.equal(ctx.counters.image,1);
   }finally{imageService.downloadGeneratedImages=original;}
 })],
 ['外部结果返回后媒体落盘异常不开放普通重发',()=>fixture(async ctx=>{
   const image=await markerImage(ctx.rootDir,{width:640,height:480},await media.preflight()),bytes=await fs.readFile(image);
   const id=await ready(ctx),original=store.putBuffer;
   ctx.options.services.aiImageModel={generateImages:async()=>{ctx.counters.image++;return {success:true,images:[{b64_json:bytes.toString('base64'),mime:'image/png'}]};}};
   store.putBuffer=async(record,buffer,metadata,...rest)=>{if(metadata.kind==='image_raw'){const error=new Error('fixture disk failure');error.code='EIO';throw error;}return original(record,buffer,metadata,...rest);};
   try{
     await ctx.act(id,'generate_images',{sceneId:'scene_1'});const result=await workflow.run(id,ctx.options);
     assert.equal(result.status,'unknown_external_outcome');assert.equal(ctx.counters.image,1);
   }finally{store.putBuffer=original;}
 })],
 ['只授权未知配音分段，复用同幕已成功分段',()=>fixture(async ctx=>{
   const source=structuredClone(plan);source.scenes[0].text=Array.from({length:65},(_,i)=>'第'+i+'句话描述长旁白分段和恢复的行为。').join('');
   ctx.options.services.aiTextModel.callTextModel=async()=>({success:true,text:JSON.stringify(source)});
   const calls=[];let failOnce=true;
   ctx.options.services.aiTtsModel.callTtsModel=async request=>{
     calls.push(request.text);ctx.counters.tts++;
     if(calls.length===2&&failOnce){failOnce=false;return {success:false,code:'UNKNOWN_EXTERNAL_OUTCOME',status:'unknown_external_outcome'};}
     return {success:true,format:'wav',audioBuffer:wav(2000),nativeSubtitles:nativeFixture(request.text,2000)};
   };
   const id=await ctx.create({narrationMode:'enabled',targetDurationSeconds:600});await workflow.run(id,ctx.options);await ctx.act(id,'approve_plan');
   await ctx.act(id,'prepare_narration');let result=await workflow.run(id,ctx.options);assert.equal(result.status,'unknown_external_outcome');
   const record=await ctx.read(id),attempt=state.pendingUnknown(record.illustrated)[0],firstText=calls[0];
   assert(attempt.requestInput.chunkId);
   await ctx.act(id,'authorize_retry',{attemptId:attempt.id,authorizeNewRequest:true});await ctx.act(id,'prepare_narration');
   result=await workflow.run(id,ctx.options);assert.equal(result.current_stage,'audio_review');
   assert.equal(calls.filter(text=>text===firstText).length,1,'同幕成功分段不得因其他分段授权而重复合成');
 })],
 ['改标题也使方案审核失效，旧预览不能绕过确认',()=>fixture(async ctx=>{
   const id=await ready(ctx);
   await store.mutate(id,ctx.options,record=>{
     const s=record.illustrated;
     for(const scene of s.plan.scenes){s.candidates[scene.id]=[{id:scene.id,artifactId:'fixture_image',dependency:contract.imageIdentity(scene,s.settings)}];s.selections[scene.id]=scene.id;}
     s.approvals.images=state.imagesIdentity(s);s.preview={identity:state.mediaIdentity(s),artifactId:'fixture_video'};
   });
   const record=await ctx.read(id);assert(state.actionsFor(record).includes('export'));
   const edited={...record.illustrated.plan,title:'新的作品标题'};
   await ctx.act(id,'save_plan',{plan:edited});
   await assert.rejects(ctx.act(id,'render_preview'),/当前阶段/);
   await assert.rejects(ctx.act(id,'export',{identity:record.illustrated.preview.identity}),/当前阶段/);
 })],
];
(async()=>{for(const[name,test]of tests){await test();console.log('PASS '+name);}console.log('边界回归：'+tests.length+' 项通过，真实模型请求 0。');})().catch(error=>{console.error(error.message);console.error(error.stack);process.exitCode=1;});
