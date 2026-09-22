const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const contract=require('../server/services/creative/illustrated/contracts');
const workflow=require('../server/services/creative/illustrated/workflows');
const store=require('../server/services/creative/illustrated/storage');
const state=require('../server/services/creative/illustrated/state');
const timing=require('../server/services/creative/illustrated/timing');
const modelGateway=require('../server/services/creative/illustrated/models');
const tts=require('../server/services/ai/aiTtsModel');
const facade=require('../server/services/creative/creativeWorkflows');

const plan={title:'清晨的城市',summary:'以三个画面介绍清晨。',scenes:[
  {id:'scene_1',title:'窗边',text:'清晨，阳光照进窗边。',visualIntent:'安静的清晨',imagePrompt:'窗边植物与一束金色阳光，干净室内空间',negativePrompt:'水印',weight:1},
  {id:'scene_2',title:'街道',text:'街道逐渐热闹起来。',visualIntent:'城市苏醒',imagePrompt:'清晨街道人们步行，层次清晰的城市建筑',negativePrompt:'水印',weight:1},
  {id:'scene_3',title:'出发',text:'新的一天，从容出发。',visualIntent:'开始一天',imagePrompt:'背着背包的行人走向远方，清晨柔和光线',negativePrompt:'水印',weight:1},
]};
function configs() {
  return Object.fromEntries(['text','image','tts','asr'].map(type=>[type,{enabled:true,provider:type==='tts'?'minimax':'fixture',
    providerName:type==='tts'?'minimax':'fixture',protocol:'openai',apiKey:'fixture-only-not-a-secret',
    baseUrl:'http://127.0.0.1:1',modelId:type==='tts'?'speech-fixture':type+'-fixture',
    ...(type==='asr'?{backend:'funasr'}:{}),voiceId:'fixture',ttsQueueIntervalMs:0}]));
}
async function fixture(callback) {
  const rootDir=await fs.mkdtemp(path.join(os.tmpdir(),'musedock-illustrated-contract-'));
  const counters={text:0,tts:0,image:0,asr:0};const current=configs();
  const options={rootDir,services:{
    appSettings:{getProductionDefaults:async()=>contract.DEFAULT_PRODUCTION_SETTINGS},
    aiModelConfig:{getRuntimeConfig:async type=>structuredClone(current[type])},
    aiTtsModel:{resolveTtsRuntime:tts.resolveTtsRuntime,callTtsModel:async()=>{counters.tts++;throw new Error('unexpected TTS');}},
    aiTextModel:{callTextModel:async()=>{counters.text++;return {success:true,text:JSON.stringify(plan)};}},
  }};
  const create=async(settings={},input={})=>{
    const result=await workflow.create({input:{content:'清晨的城市',inputMode:'topic',useResearch:false,...input},
      settings:{targetDurationSeconds:15,narrationMode:'disabled',...settings}},options);
    assert.equal(result.creationModeId,contract.MODE);
    return result.workflow_id;
  };
  const read=id=>store.readWorkflow(id,rootDir);
  const act=async(id,action,data={})=>{
    const record=await read(id);
    return workflow.act(id,{requestId:randomUUID(),expectedRevision:record.illustrated.revision,action,...data},options);
  };
  try {await callback({rootDir,options,counters,current,create,read,act});}
  finally {await fs.rm(rootDir,{recursive:true,force:true});}
}

const tests=[
 ['三种模式注册与旧任务快照兼容',async()=>{
   const modes=facade.listCreationModes();assert.equal(modes.modes.length,3);
   assert(modes.modes.some(item=>item.id===contract.MODE));
   assert.equal(require('../server/services/creative/creationModes').readModeSnapshot({}).creationModeId,'hyperframes-v1');
 }],
 ['无配音没有 TTS 配置也能进入图片阶段，任务 done 不覆盖审核',()=>fixture(async ctx=>{
   ctx.current.tts={enabled:false};
   const id=await ctx.create();const run=await workflow.run(id,ctx.options);
   assert.equal(run.status,'waiting_approval');assert.equal(run.current_stage,'plan_review');
   await facade.patchCreativeWorkflowTaskSummary(id,{task_status:'done',status:'done',current_progress:100},{rootDir:ctx.rootDir});
   assert.equal((await ctx.read(id)).status,'waiting_approval');
   await ctx.act(id,'approve_plan');await ctx.act(id,'prepare_narration');await workflow.run(id,ctx.options);
   const record=await ctx.read(id);
   assert.equal(record.current_stage,'images');assert.equal(record.illustrated.narration.timing.timingKind,'planned');
   assert.equal(record.illustrated.narration.timing.durationMs,15000);assert.equal(ctx.counters.tts,0);
   assert.equal(ctx.counters.text,1);assert.equal(ctx.counters.asr,0);
 })],
 ['冻结模型拒绝漂移，明确应用后才发送',()=>fixture(async ctx=>{
   const id=await ctx.create();ctx.current.text.modelId='text-changed';
   let result=await workflow.run(id,ctx.options);
   assert.equal(result.status,'failed');assert.equal(ctx.counters.text,0);
   await ctx.act(id,'apply_models');await ctx.act(id,'generate_plan');result=await workflow.run(id,ctx.options);
   assert.equal(result.status,'waiting_approval');assert.equal(ctx.counters.text,1);
   const stored=JSON.stringify(await ctx.read(id));assert(!stored.includes('fixture-only-not-a-secret'));assert(!stored.includes('127.0.0.1:1'));
 })],
 ['幂等操作、版本冲突与 A→B→A 运镜回读',()=>fixture(async ctx=>{
   const id=await ctx.create();await workflow.run(id,ctx.options);
   const initial=await ctx.read(id);const payload={requestId:randomUUID(),expectedRevision:initial.illustrated.revision,action:'save_motion',
     sceneId:'scene_1',motion:{track:'pan_up',amount:8}};
   const first=await workflow.act(id,payload,ctx.options),again=await workflow.act(id,payload,ctx.options);
   assert.equal(again.duplicate,true);assert.equal(first.workflow.illustrated.revision,again.workflow.illustrated.revision);
   await assert.rejects(workflow.act(id,{...payload,requestId:randomUUID()},ctx.options),/版本已变化/);
   await ctx.act(id,'save_motion',{sceneId:'scene_1',motion:{track:'pan_down',amount:10}});
   await ctx.act(id,'save_motion',{sceneId:'scene_1',motion:{track:'pan_up',amount:8}});
   assert.equal((await ctx.read(id)).illustrated.motions.scene_1.track,'pan_up');
   await ctx.act(id,'save_motion',{sceneId:'scene_1',motion:{track:'still',amount:0}});
   await ctx.act(id,'save_motion',{sceneId:'scene_1',motion:{track:'zoom_in',amount:0}});
   assert((await ctx.read(id)).illustrated.motions.scene_1.amount>0);
 })],
 ['随机持久化、锁定、单张随机都不请求模型',()=>fixture(async ctx=>{
   const id=await ctx.create();await workflow.run(id,ctx.options);
   await ctx.act(id,'save_motion',{sceneId:'scene_1',motion:{track:'pan_left',locked:true}});
   const before=await ctx.read(id);await ctx.act(id,'rerandomize');
   const after=await ctx.read(id);assert.deepEqual(after.illustrated.motions.scene_1,before.illustrated.motions.scene_1);
   await ctx.act(id,'rerandomize',{sceneId:'scene_2'});
   const final=await ctx.read(id);assert.deepEqual(final.illustrated.motions.scene_3,after.illustrated.motions.scene_3);
   assert.deepEqual(ctx.counters,{text:1,tts:0,image:0,asr:0});
 })],
 ['风格补充保留，字幕样式不改变音频时间身份',()=>fixture(async ctx=>{
   const id=await ctx.create({customStyle:'保持暖色光线'});await workflow.run(id,ctx.options);
   await ctx.act(id,'approve_plan');await ctx.act(id,'prepare_narration');await workflow.run(id,ctx.options);
   const before=await ctx.read(id);
   await ctx.act(id,'save_settings',{settings:{subtitleFontSize:72,subtitleColor:'#abcdef',burnSubtitles:false,stylePreset:'cinematic'}});
   const after=await ctx.read(id);
   assert.equal(after.illustrated.settings.customStyle,'保持暖色光线');assert.equal(after.illustrated.settings.subtitleColor,'#ABCDEF');
   assert.deepEqual(after.illustrated.narration,before.illustrated.narration);assert(state.currentNarration(after.illustrated));
   assert(contract.imagePrompt(after.illustrated.plan.scenes[0],after.illustrated.settings).includes('电影级'));
 })],
 ['重启后的已发送请求未知，普通重试不能绕过',()=>fixture(async ctx=>{
   const id=await ctx.create();
   await store.mutate(id,ctx.options,record=>{
     record.illustrated.operation.status='running';record.status='running';
     record.illustrated.attempts.push({id:'attempt_unknown',type:'text',stage:'content_plan',inputIdentity:'frozen',status:'requesting'});
     state.recoverInterruptedRecord(record);
   });
   const record=await ctx.read(id);assert.equal(record.status,'unknown_external_outcome');
   await assert.rejects(ctx.act(id,'generate_plan'),/当前阶段/);assert.equal(ctx.counters.text,0);
   await ctx.act(id,'authorize_retry',{attemptId:'attempt_unknown',authorizeNewRequest:true});
   await ctx.act(id,'generate_plan');await workflow.run(id,ctx.options);assert.equal(ctx.counters.text,1);
 })],
 ['超长无声正文触发阅读预算；合法三画幅和全轨迹合同',async()=>{
   for(const aspectRatio of ['16:9','9:16','4:3']) {
     const settings=contract.normalizeSettings({aspectRatio,targetDurationSeconds:15,narrationMode:'disabled'});
     assert.throws(()=>timing.plannedTiming({scenes:[{id:'s',text:'很长的正文'.repeat(100),weight:1}]},settings),/时长不足/);
     for(const track of contract.TRACKS) {
       const motion=contract.resolvedMotion({track:track.id,amount:6});assert(motion.start.zoom>=1 && motion.end.zoom>=1);
     }
   }
   assert.throws(()=>contract.normalizeSettings({subtitleFontSize:97}),/24–96/);
   assert.throws(()=>contract.normalizeSettings({targetDurationSeconds:601}),/15–600/);
   assert.throws(()=>contract.normalizeMotion({fadeMs:300}),/统一淡入淡出/);
 }],
];
async function main(){for(const [name,test] of tests){await test();console.log('PASS '+name);}console.log('旁白配图相关合同测试通过：'+tests.length+' 项');}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={fixture,plan,configs};
