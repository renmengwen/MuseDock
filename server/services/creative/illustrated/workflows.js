const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs/promises');
const appSettings = require('../../appSettings');
const { createModeSnapshot } = require('../creationModes');
const contract = require('./contracts');
const models = require('./models');
const store = require('./storage');
const state = require('./state');
const media = require('./media');

function operation(record, type, details = {}) {
  const stages = { plan:'content_plan', narration:'narration', images:'images', scene_preview:'preview', preview:'preview' };
  record.illustrated.operation = { id:randomUUID(), type, stage:stages[type], ...details, status:'queued', cancelRequested:false,
    createdAt:new Date().toISOString(), settings:structuredClone(record.illustrated.settings),
    models:structuredClone(record.illustrated.models), progress:{queued:0,running:0,success:0,failed:0,cancelled:0} };
  record.illustrated.lastError = null;
  record.message = ({plan:'正在排队准备文稿与分镜...',narration:'正在排队准备完整配音与时间轴...',images:'正在排队准备图片...',scene_preview:'正在准备运动片段...',preview:'正在准备整片动态预览...'})[type];
  state.refresh(record);
}
async function create(payload, options = {}) {
  const defaults = await (options.services?.appSettings || appSettings).getProductionDefaults?.(options) || {};
  const input = contract.normalizeInput(payload.input);
  const settings = contract.normalizeSettings({...defaults,...payload.settings});
  const frozen = await models.freezeModels(options);
  const now = store.getNow(options.services), id = String(options.services?.idFactory?.() || store.makeId(now));
  const record = { ...createModeSnapshot(contract.MODE), workflow_id:id, aweme_id:'', title:input.title || (input.inputMode==='topic'?input.content.slice(0,80):'旁白配图视频'),
    input, stages:[], created_at:now, updated_at:now, active_task_id:'',active_operation_id:'',task_status:'',last_event_seq:0,
    illustrated:{schemaVersion:1,revision:1,settings,models:frozen,plan:null,planHistory:[],research:{enabled:false,sources:[]},
      approvals:{plan:'',audio:'',images:''},narration:null,narrationHistory:[],audioCache:{},audioTakes:{},audioChunkTakes:{},
      pendingAudioTakes:null,pendingAudioChunkTakes:null,candidates:{},selections:{},motions:{},
      artifacts:{},fragments:{},scenePreviews:{},preview:null,exports:[],attempts:[],events:[],receipts:[],operation:null,lastError:null} };
  operation(record,'plan');
  await store.withWorkflowFileQueue(store.getWorkflowPath(id,options.rootDir),async()=>{
    if(await store.workflowFileExists(id,options.rootDir)) throw new contract.ErrorType('WORKFLOW_EXISTS','任务标识重复，请重新创建。',409);
    await store.persistWorkflowUnlocked(record,options.rootDir);
  });
  return {success:true,...state.view(record)};
}
function expected(record,payload) {
  if(payload.expectedRevision !== record.illustrated.revision) throw new contract.ErrorType('STALE_REVISION','任务版本已变化，请刷新后检查当前内容再操作。',409);
}
function requireAction(record,action) {
  if(!state.actionsFor(record).includes(action)) throw new contract.ErrorType('ACTION_NOT_ALLOWED','当前阶段不能执行此操作，请先完成前面的确认或等待请求结束。',409);
}
function requireScene(record,id) {
  const scene=record.illustrated.plan?.scenes.find(item=>item.id===id);
  if(!scene) throw new contract.ErrorType('SCENE_NOT_FOUND','分镜不存在，请刷新后重试。',404);
  return scene;
}
async function act(workflowId,payload={},options={}) {
  const action=payload.action;
  // 运行时配置只读；只有明确的任务操作才采用新的非秘密模型快照。
  const latestModels=action==='apply_models'?await models.freezeModels(options):null;
  const result=await store.mutate(workflowId,options,async record=>{
    const s=record.illustrated;
    if(typeof payload.requestId!=='string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(payload.requestId)) throw new contract.ErrorType('INVALID_REQUEST','操作标识无效，请刷新后重试。');
    const receipt=s.receipts.find(item=>(typeof item==='string'?item:item.id)===payload.requestId);
    if(receipt) {
      if(typeof receipt==='object' && receipt.payloadIdentity!==contract.hash(payload)) throw new contract.ErrorType('REQUEST_ID_CONFLICT','同一操作标识不能用于不同输入，请刷新后重试。',409);
      return {startTask:false,duplicate:true};
    }
    expected(record,payload);
    requireAction(record,action);
    let startTask=false;
    if(action==='cancel') {
      s.operation.cancelRequested=true;
      record.message='正在停止后续派发；已发送请求会接收结果并保留成功媒体。';
    } else if(action==='save_plan') {
      state.replacePlan(record,contract.normalizePlan(payload.plan,record.input));
      s.lastError=null;
    } else if(action==='save_input') {
      record.input=contract.normalizeInput({...record.input,...payload.input});
      s.approvals.plan=''; s.lastError=null;
      // 输入变化需要新方案，保留当前版本供比较。
      if(s.plan) { s.planHistory.push({...s.plan,savedAt:new Date().toISOString()});s.plan=null; }
    } else if(action==='save_settings') {
      const previous=s.settings;
      s.settings=contract.normalizeSettings({...previous,...payload.settings,
        motion:{...previous.motion,...payload.settings?.motion}});
      if (s.settings.stylePreset === previous.stylePreset) s.settings.style = previous.style;
      if (s.settings.targetDurationSeconds !== previous.targetDurationSeconds) s.approvals.audio = '';
      if(s.settings.motion.mode!=='off' && contract.hash(previous.motion)!==contract.hash(s.settings.motion)) {
        let previousTrack='';
        for(const scene of s.plan?.scenes || []) {
          const old=s.motions[scene.id];
          // 锁定/单张覆盖保留；关闭与恢复只影响其余画面，不抹掉原幅度。
          s.motions[scene.id]=(old?.locked || old?.override)?old:contract.assignMotion(s.settings.motion,old,{force:true,previousTrack});
          previousTrack=s.motions[scene.id].track;
        }
      }
      s.lastError=null;
    } else if(action==='apply_models') {
      s.models=latestModels;
      s.lastError=null;
    } else if(action==='approve_plan') {
      if(!s.plan) contract.fail('请先准备文稿与分镜。');
      s.approvals.plan=state.planGate(s);s.lastError=null;
    } else if(action==='generate_plan') {
      operation(record,'plan',{revisionRequest:contract.text(payload.revisionRequest??'','修改要求',4000,true)});
      startTask=true;
    } else if(action==='prepare_narration' || action==='regenerate_narration') {
      if(action==='regenerate_narration') {
        const sceneIds=payload.sceneId?[requireScene(record,payload.sceneId).id]:s.plan.scenes.map(scene=>scene.id);
        const takes={...(s.pendingAudioTakes||s.audioTakes)};
        sceneIds.forEach(id=>{takes[id]=(takes[id]||0)+1;});
        s.pendingAudioTakes=takes;
      }
      operation(record,'narration',{audioTakes:structuredClone(s.pendingAudioTakes||s.audioTakes),
        audioChunkTakes:structuredClone(s.pendingAudioChunkTakes||s.audioChunkTakes||{})});startTask=true;
    } else if(action==='approve_audio') {
      if(payload.identity!==s.narration?.identity || !state.currentNarration(s)) throw new contract.ErrorType('STALE_IDENTITY','配音版本已经变化，请试听当前版本后确认。',409);
      s.approvals.audio=s.narration.identity;s.lastError=null;
    } else if(action==='generate_images') {
      const sceneIds=payload.sceneId?[requireScene(record,payload.sceneId).id]:s.plan.scenes.filter(scene=>!state.selectedCandidate(s,scene)).map(scene=>scene.id);
      if(!sceneIds.length) contract.fail('当前没有缺失图片；如需新候选，请选择单张重新生成。');
      operation(record,'images',{sceneIds,regenerate:payload.regenerate===true});s.operation.progress.queued=sceneIds.length;startTask=true;
    } else if(action==='select_image') {
      const scene=requireScene(record,payload.sceneId);
      const candidate=(s.candidates[scene.id]||[]).find(item=>item.id===payload.candidateId);
      if(!candidate) contract.fail('图片候选不存在。');
      if(candidate.dependency!==contract.imageIdentity(scene,s.settings)) throw new contract.ErrorType('STALE_IMAGE','这张图片属于旧内容或旧风格，请生成新候选，或明确重新上传适用图片。',409);
      await store.mediaFile(record,candidate.artifactId,options.rootDir,{checkHash:true});
      s.selections[scene.id]=candidate.id;s.lastError=null;
    } else if(action==='approve_images') {
      const identity=state.imagesIdentity(s);
      if(!identity || payload.identity!==identity) throw new contract.ErrorType('STALE_IMAGE','请补齐并检查当前所有选图后再确认。',409);
      for(const scene of s.plan.scenes) await store.mediaFile(record,state.selectedCandidate(s,scene).artifactId,options.rootDir,{checkHash:true});
      s.approvals.images=identity;s.lastError=null;
    } else if(action==='save_motion') {
      const scene=requireScene(record,payload.sceneId);
      s.motions[scene.id]=contract.resolvedMotion({...payload.motion,override:true},s.motions[scene.id]);
      s.lastError=null;
    } else if(action==='rerandomize') {
      const targets=payload.sceneId?[requireScene(record,payload.sceneId)]:s.plan?.scenes || [];
      let previousTrack='';
      for(const scene of targets) {
        s.motions[scene.id]=contract.assignMotion({...s.settings.motion,mode:'random'},s.motions[scene.id],{force:true,previousTrack});
        previousTrack=s.motions[scene.id].track;
      }
      s.lastError=null;
    } else if(action==='preview_scene') {
      const scene=requireScene(record,payload.sceneId);
      if(!state.selectedCandidate(s,scene)) contract.fail('请先为这张画面选择有效图片。');
      operation(record,'scene_preview',{sceneIds:[scene.id]});startTask=true;
    } else if(action==='render_preview') {
      operation(record,'preview');startTask=true;
    } else if(action==='export') {
      const identity=state.mediaIdentity(s);
      if(payload.identity!==identity || s.preview?.identity!==identity) throw new contract.ErrorType('STALE_PREVIEW','预览版本已变化，请播放最新预览后再导出。',409);
      await store.mediaFile(record,s.preview.artifactId,options.rootDir,{checkHash:true});
      const manifest={schemaVersion:1,mode:contract.MODE,renderer:contract.RENDER_VERSION,fps:contract.FPS,
        identity,settings:s.settings,models:Object.fromEntries(Object.entries(s.models).map(([key,value])=>[key,models.publicSnapshot(value)])),
        planIdentity:s.plan.identity,narration:s.narration.identity,timing:s.narration.timing,
        scenes:s.plan.scenes.map(scene=>({id:scene.id,image:state.selectedCandidate(s,scene),
          motion:state.effectiveMotion(s,scene.id),assignedMotion:s.motions[scene.id]})),
        video:s.artifacts[s.preview.artifactId],subtitle:s.preview.srtId,validation:s.preview.validation,
        renderRuntimeIdentity:s.preview.runtimeIdentity,bgm:s.preview.bgm};
      const artifact=await store.putBuffer(record,Buffer.from(JSON.stringify(manifest,null,2)),{kind:'manifest',ext:'json',mime:'application/json'},options.rootDir);
      s.exports.push({id:randomUUID(),identity,artifactId:s.preview.artifactId,srtId:s.preview.srtId,manifestId:artifact.id,createdAt:new Date().toISOString()});
      s.lastError=null;
    } else if(action==='authorize_retry') {
      const attempt=s.attempts.find(item=>item.id===payload.attemptId && item.status==='unknown_external_outcome' && !item.resolution);
      if(!attempt || payload.authorizeNewRequest!==true) contract.fail('请先核实指定请求，并明确授权可能再次计费的新请求。');
      attempt.resolution={kind:'new_request_authorized',at:new Date().toISOString()};
      if(attempt.type==='tts' && attempt.sceneId) {
        const chunkId=attempt.requestInput?.chunkId||s.audioCache[attempt.inputIdentity]?.id;
        if(!chunkId) throw new contract.ErrorType('REQUEST_IDENTITY_MISSING','该请求缺少分段身份，请先检查保存的请求记录。',409);
        const takes={...(s.pendingAudioChunkTakes||s.audioChunkTakes||{})};
        takes[chunkId]=(takes[chunkId]||0)+1;s.pendingAudioChunkTakes=takes;
      }
      if(attempt.type==='asr' && s.audioCache[attempt.inputIdentity]) delete s.audioCache[attempt.inputIdentity].evidenceId;
      s.lastError=null;
    } else if(action==='upload_image') {
      contract.fail('请使用图片上传入口。');
    } else contract.fail('不支持的旁白配图操作。');
    s.receipts.push({id:payload.requestId,payloadIdentity:contract.hash(payload)});s.receipts=s.receipts.slice(-300);
    store.revision(record,action);
    state.refresh(record,action==='cancel'?record.message:undefined);
    return {startTask};
  });
  return {success:true,workflow_id:workflowId,workflow:state.view(result.record),...result.result};
}
async function upload(workflowId,payload,options={}) {
  if(typeof payload.data!=='string' || payload.data.length>42*1024*1024) contract.fail('图片不能超过 30 MB。');
  const buffer=Buffer.from(payload.data,'base64');
  if(!buffer.length || buffer.length>30*1024*1024) contract.fail('图片内容无效或超过 30 MB。');
  media.imageMime(buffer);
  const initial=await store.readWorkflow(workflowId,options.rootDir);
  store.assertContract(initial);expected(initial,payload);requireAction(initial,'upload_image');requireScene(initial,payload.sceneId);
  const runtime=await media.preflight(options.mediaOptions);
  const directory=path.join(store.mediaRoot(workflowId,options.rootDir),'work',randomUUID());
  await fs.mkdir(directory,{recursive:true});
  const source=path.join(directory,'upload.bin'),normalized=path.join(directory,'normalized.png');
  await fs.writeFile(source,buffer,{flag:'wx'});
  const size=await media.normalizeImage(source,normalized,runtime);
  const {record}=await store.mutate(workflowId,options,async record=>{
    expected(record,payload);requireAction(record,'upload_image');
    const scene=requireScene(record,payload.sceneId),s=record.illustrated;
    const artifact=await store.putFile(record,normalized,{kind:'image',ext:'png',mime:'image/png',...size},options.rootDir);
    const candidate={id:randomUUID(),artifactId:artifact.id,source:'upload',dependency:contract.imageIdentity(scene,s.settings),
      prompt:contract.imagePrompt(scene,s.settings),style:structuredClone(s.settings.style),customStyle:s.settings.customStyle,
      aspectRatio:s.settings.aspectRatio,createdAt:new Date().toISOString()};
    (s.candidates[scene.id] ||= []).push(candidate);s.selections[scene.id]=candidate.id;
    store.revision(record,'upload_image');s.lastError=null;state.refresh(record);
  });
  return {success:true,workflow_id:workflowId,workflow:state.view(record),startTask:false};
}
async function getView(record) { store.assertContract(record);return state.view(record); }
async function run(workflowId,options) { return require('./runner').run(workflowId,options); }

module.exports={create,act,upload,run,getView,operation,assertContract:store.assertContract,recoverInterruptedRecord:state.recoverInterruptedRecord,mediaFile:store.mediaFile};
