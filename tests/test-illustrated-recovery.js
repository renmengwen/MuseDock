const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {fixture,plan}=require('./test-illustrated-narration');
const {wav,nativeFixture,markerImage}=require('./test-illustrated-media');
const workflow=require('../server/services/creative/illustrated/workflows');
const store=require('../server/services/creative/illustrated/storage');
const state=require('../server/services/creative/illustrated/state');
const contract=require('../server/services/creative/illustrated/contracts');
const media=require('../server/services/creative/illustrated/media');
const facade=require('../server/services/creative/creativeWorkflows');

async function ready(ctx,settings={}) {
  const id=await ctx.create(settings);await workflow.run(id,ctx.options);await ctx.act(id,'approve_plan');
  await ctx.act(id,'prepare_narration');const result=await workflow.run(id,ctx.options);
  assert.notEqual(result.status,'failed',result.message);
  const record=await ctx.read(id);
  if(settings.narrationMode==='enabled')await ctx.act(id,'approve_audio',{identity:record.illustrated.narration.identity});
  return id;
}
function ttsFixture(ctx) {
  ctx.options.services.aiTtsModel.callTtsModel=async request=>{
    ctx.counters.tts++;assert.deepEqual(request.env,{});assert.equal(request.maxRetries,0);
    assert(request.durationSeconds<=80);
    return {success:true,audioBuffer:wav(2000),format:'wav',nativeSubtitles:nativeFixture(request.text,2000)};
  };
}
const tests=[
 ['取消只停止后续派发，已经收到的图片保留',()=>fixture(async ctx=>{
   const image=await markerImage(ctx.rootDir,{width:640,height:480},await media.preflight()),bytes=await fs.readFile(image);
   let release,entered;const waiting=new Promise(resolve=>{entered=resolve;});
   ctx.options.services.aiImageModel={generateImages:async()=>{ctx.counters.image++;entered();await new Promise(resolve=>{release=resolve;});return {success:true,images:[{b64_json:bytes.toString('base64'),mime:'image/png'}]};}};
   const id=await ready(ctx);await ctx.act(id,'generate_images');const pending=workflow.run(id,ctx.options);await waiting;
   await assert.rejects(ctx.act(id,'save_settings',{settings:{subtitleFontSize:72}}),/当前阶段/);
   await ctx.act(id,'cancel');release();await pending;
   const record=await ctx.read(id);assert.equal(ctx.counters.image,1);assert.equal(record.illustrated.candidates.scene_1.length,1);
   assert.equal(record.illustrated.operation.status,'cancelled');assert.equal(record.illustrated.candidates.scene_2,undefined);
   assert.equal(record.illustrated.operation.progress.success,1);assert.equal(record.illustrated.operation.progress.cancelled,2);assert.equal(record.illustrated.operation.progress.running,0);
 })],
 ['部分失败不清空成功结果，未知结果不能因改稿绕过',()=>fixture(async ctx=>{
   const image=await markerImage(ctx.rootDir,{width:640,height:480},await media.preflight()),bytes=await fs.readFile(image);
   ctx.options.services.aiImageModel={generateImages:async()=>{
     ctx.counters.image++;return ctx.counters.image===1?{success:true,images:[{b64_json:bytes.toString('base64'),mime:'image/png'}]}:{success:false,configured:true};
   }};
   const id=await ready(ctx);await ctx.act(id,'generate_images');let result=await workflow.run(id,ctx.options);
   assert.equal(result.status,'unknown_external_outcome');assert.equal(ctx.counters.image,2);
   let record=await ctx.read(id);assert.equal(record.illustrated.candidates.scene_1.length,1);
   assert.equal(record.illustrated.operation.progress.running,0);assert.equal(record.illustrated.operation.progress.success,1);assert.equal(record.illustrated.operation.progress.cancelled,1);
   const edited=structuredClone(record.illustrated.plan);edited.scenes[1].imagePrompt+='，柔和光线';
   await ctx.act(id,'save_plan',{plan:edited});await assert.rejects(ctx.act(id,'generate_images',{sceneId:'scene_2'}),/当前阶段/);
   record=await ctx.read(id);const attempt=state.pendingUnknown(record.illustrated)[0];
   assert(attempt.model.hash&&attempt.settings.style&&attempt.input.text,'请求必须保留输入与模型快照');
   await ctx.act(id,'authorize_retry',{attemptId:attempt.id,authorizeNewRequest:true});
   assert.equal(ctx.counters.image,2,'登记授权不能自动发送请求');
   assert.equal((await ctx.read(id)).illustrated.candidates.scene_1.length,1);
 })],
 ['长配音分段及成功缓存恢复，改一幕只重做相关音频',()=>fixture(async ctx=>{
   ttsFixture(ctx);
   const longPlan=structuredClone(plan);longPlan.scenes[0].text='这是一段用于检查长旁白分段与恢复的中文正文。'.repeat(30);
   ctx.options.services.aiTextModel.callTextModel=async()=>{ctx.counters.text++;return {success:true,text:JSON.stringify(longPlan)};};
   const id=await ready(ctx,{narrationMode:'enabled',targetDurationSeconds:600});
   let record=await ctx.read(id),count=ctx.counters.tts;
   assert(count>3);assert(record.illustrated.narration.segments.every(item=>item.text.length<=260));
   await ctx.act(id,'prepare_narration');await workflow.run(id,ctx.options);assert.equal(ctx.counters.tts,count);
   const edited=structuredClone(record.illustrated.plan);edited.scenes[1].text='街道热闹起来，新的旅程开始了。';
   await ctx.act(id,'save_plan',{plan:edited});await ctx.act(id,'approve_plan');await ctx.act(id,'prepare_narration');await workflow.run(id,ctx.options);
   assert.equal(ctx.counters.tts,count+1);
   record=await ctx.read(id);assert.notEqual(record.illustrated.narration.actualDurationMs,600000,'实际时长不能冒充目标时长');
   assert.equal(record.current_stage,'audio_review');
 })],
 ['MiMo 明确使用句级 FunASR，缺配置先阻止 TTS',()=>fixture(async ctx=>{
   ctx.current.tts={...ctx.current.tts,provider:'mimo',providerName:'mimo',modelId:'mimo-fixture'};
   ctx.current.asr={enabled:false};
   ctx.options.services.aiTtsModel.callTtsModel=async request=>{
     ctx.counters.tts++;assert.equal(request.nativeWordSubtitles,false);return {success:true,audioBuffer:wav(2200),format:'wav'};
   };
   const id=await ctx.create({narrationMode:'enabled'});await workflow.run(id,ctx.options);await ctx.act(id,'approve_plan');
   await ctx.act(id,'prepare_narration');let result=await workflow.run(id,ctx.options);
   assert.equal(result.status,'failed');assert.equal(ctx.counters.tts,0);
   ctx.current.asr={enabled:true,provider:'fixture',baseUrl:'http://127.0.0.1:1',modelId:'funasr-fixture',backend:'funasr'};
   let next=0;
   ctx.options.services.transcribeFunasrAudio=async()=>{ctx.counters.asr++;return {provider:'funasr',timingSource:'funasr_sentence_info',
     sentences:[{text:plan.scenes[next++].text,startMs:100,endMs:2100}]};};
   await ctx.act(id,'apply_models');await ctx.act(id,'prepare_narration');result=await workflow.run(id,ctx.options);
   assert.equal(result.current_stage,'audio_review');assert.equal(result.illustrated.narration.timing.timingKind,'asr_sentences');
   assert.equal(ctx.counters.tts,3);assert.equal(ctx.counters.asr,3);
 })],
 ['全局关闭运动覆盖锁定和单张设置，重新开启仍保留锁定方案',()=>fixture(async ctx=>{
   const id=await ctx.create();await workflow.run(id,ctx.options);
   await ctx.act(id,'save_motion',{sceneId:'scene_1',motion:{track:'pan_up',amount:10,locked:true}});
   const before=(await ctx.read(id)).illustrated.motions.scene_1;
   await ctx.act(id,'save_settings',{settings:{motion:{mode:'off'}}});
   let record=await ctx.read(id);assert.equal(state.effectiveMotion(record.illustrated,'scene_1').track,'still');
   assert.deepEqual(record.illustrated.motions.scene_1,before);
   await ctx.act(id,'save_settings',{settings:{motion:{mode:'random'}}});
   record=await ctx.read(id);assert.deepEqual(state.effectiveMotion(record.illustrated,'scene_1'),before);
 })],
 ['删除运行任务后晚到结果不会重建任务或媒体',()=>fixture(async ctx=>{
   let release,entered;const started=new Promise(resolve=>{entered=resolve;});
   ctx.options.services.aiTextModel.callTextModel=async()=>{entered();await new Promise(resolve=>{release=resolve;});return {success:true,text:JSON.stringify(plan)};};
   const id=await ctx.create(),pending=workflow.run(id,ctx.options);await started;
   await facade.deleteCreativeWorkflow(id,{rootDir:ctx.rootDir,mediaRoot:ctx.rootDir+'/media'});
   release();const result=await pending;
   assert.equal(result.status,'deleted');assert.equal(await store.workflowFileExists(id,ctx.rootDir),false);
   assert.equal(await fs.access(store.mediaRoot(id,ctx.rootDir)).then(()=>true,()=>false),false);
 })],
];
(async()=>{for(const [name,test]of tests){await test();console.log('PASS '+name);}console.log('旁白配图恢复专项：'+tests.length+' 项通过，真实模型请求 0。');})().catch(error=>{console.error(error.message);console.error(error.stack);process.exitCode=1;});
