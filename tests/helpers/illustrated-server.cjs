const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const express=require('express');
const workflows=require('../../server/services/creative/creativeWorkflows');
const router=require('../../server/routes/creativeWorkflows');
const {createCreativeTaskRegistry}=require('../../server/services/creative/creativeTaskRegistry');
const appSettings=require('../../server/services/appSettings');
const contract=require('../../server/services/creative/illustrated/contracts');
const {plan,configs}=require('../test-illustrated-narration');
const {wav,nativeFixture,markerImage}=require('../test-illustrated-media');
const media=require('../../server/services/creative/illustrated/media');
const tts=require('../../server/services/ai/aiTtsModel');

async function startFixtureServer({rootDir:requestedRoot}={}) {
  const rootDir=requestedRoot||await fs.mkdtemp(path.join(os.tmpdir(),'musedock-illustrated-browser-'));
  await fs.mkdir(rootDir,{recursive:true});
  const runtime=await media.preflight(),imagePath=await markerImage(rootDir,{width:1440,height:1080},runtime);
  const imageBytes=await fs.readFile(imagePath),current=configs(),counts={text:0,image:0,tts:0,asr:0};
  let settings=appSettings.normalizeConfig({creativeDefaults:{useResearch:false}});
  const options={rootDir,mediaRoot:path.join(rootDir,'media'),apiCallLogDirectory:path.join(rootDir,'api-logs'),services:{
    appSettings:{getProductionDefaults:async()=>settings.productionDefaults,getCreativeDefaults:async()=>settings.creativeDefaults},
    aiModelConfig:{getRuntimeConfig:async type=>structuredClone(current[type])},
    fetchImpl:async()=>{throw new Error('离线 UI 验证禁止访问外部服务');},
    aiTextModel:{callTextModel:async()=>{
      counts.text++;await new Promise(resolve=>setTimeout(resolve,120));
      return {success:true,text:JSON.stringify(plan)};
    }},
    aiImageModel:{generateImages:async()=>{
      counts.image++;await new Promise(resolve=>setTimeout(resolve,120));
      return {success:true,images:[{b64_json:imageBytes.toString('base64'),mime:'image/png'}]};
    }},
    aiTtsModel:{resolveTtsRuntime:tts.resolveTtsRuntime,callTtsModel:async({text})=>{
      counts.tts++;return {success:true,format:'wav',audioBuffer:wav(2500),nativeSubtitles:nativeFixture(text,2500)};
    }},
  }};
  const bound={
    ...workflows,
    createCreativeWorkflow:(payload,params)=>workflows.createCreativeWorkflow(payload,{...params,...options}),
    runCreativeWorkflow:(id,params)=>workflows.runCreativeWorkflow(id,{...params,...options}),
    getCreativeWorkflow:(id,params)=>workflows.getCreativeWorkflow(id,{...params,...options}),
    listCreativeWorkflowRecords:()=>workflows.listCreativeWorkflowRecords(options),
    patchCreativeWorkflowTaskSummary:(id,patch)=>workflows.patchCreativeWorkflowTaskSummary(id,patch,options),
    actOnIllustratedWorkflow:(id,payload)=>workflows.actOnIllustratedWorkflow(id,payload,options),
    uploadIllustratedImage:(id,payload)=>workflows.uploadIllustratedImage(id,payload,options),
    getIllustratedMediaFile:(id,artifact)=>workflows.getIllustratedMediaFile(id,artifact,options),
    actOnWhiteboardWorkflow:(id,payload)=>workflows.actOnWhiteboardWorkflow(id,payload,options),
    deleteCreativeWorkflow:id=>workflows.deleteCreativeWorkflow(id,options),
  };
  const app=express(),registry=createCreativeTaskRegistry();
  app.use(express.json({limit:'42mb'}));
  app.locals.creativeWorkflows=bound;app.locals.creativeTaskRegistry=registry;
  app.get('/api/config/app-settings',(_req,res)=>res.json({success:true,data:settings}));
  app.post('/api/config/app-settings',(req,res)=>{settings=appSettings.normalizeConfig({...settings,...req.body});res.json({success:true,data:settings});});
  app.get('/api/config/ai-models',(_req,res)=>res.json({providers:{},active:{}}));
  app.get('/api/config/system-health',(_req,res)=>res.json({success:true,data:{components:[],summary:{}}}));
  app.get('/api/api-call-logs',(_req,res)=>res.json({success:true,data:{records:[],nextCursor:null}}));
  app.use('/api/creative-workflows',router);
  const projectRoot=path.resolve(__dirname,'../..');
  app.use(express.static(path.join(projectRoot,'frontend-dist')));
  app.get('*',(_req,res)=>res.sendFile(path.join(projectRoot,'frontend-dist/index.html')));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  return {origin,rootDir,imagePath,counts,options,app,registry,bound,
    close:async({keep=false}={})=>{
      await new Promise(resolve=>server.close(resolve));
      if(!keep&&!requestedRoot){assert.equal(path.dirname(rootDir),path.resolve(os.tmpdir()));assert(path.basename(rootDir).startsWith('musedock-illustrated-browser-'));await fs.rm(rootDir,{recursive:true,force:true});}
    }};
}
module.exports={startFixtureServer};
