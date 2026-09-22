const { hash, MODE, STAGES, RENDER_VERSION, FPS, assignMotion, imageIdentity, motionIdentity, subtitleStyleFor } = require('./contracts');
const { publicSnapshot } = require('./models');
const store = require('./storage');
const { cropInfo } = require('./media');

function planGate(state) {
  return state.plan ? hash({ plan:state.plan.identity, duration:state.settings.targetDurationSeconds,
    language:state.settings.narrationLanguage, narrationMode:state.settings.narrationMode }) : '';
}
function narrationSignature(state) {
  if (!state.plan) return '';
  const silent = state.settings.narrationMode === 'disabled';
  return hash({ scenes:state.plan.scenes.map(scene => ({id:scene.id,text:scene.text, ...(silent ? {weight:scene.weight} : {})})),
    mode:state.settings.narrationMode, language:state.settings.narrationLanguage,
    ...(silent ? { duration:state.settings.targetDurationSeconds } : { tts:state.models.tts.hash, asr:state.models.tts.provider === 'mimo' ? state.models.asr.hash : null }) });
}
function currentNarration(state) { return !!state.narration && state.narration.signature === narrationSignature(state); }
function selectedCandidate(state, scene) {
  const candidate = (state.candidates[scene.id] || []).find(item => item.id === state.selections[scene.id]);
  return candidate && candidate.dependency === imageIdentity(scene, state.settings) ? candidate : null;
}
function imagesIdentity(state) {
  if (!state.plan || !currentNarration(state)) return '';
  const images = state.plan.scenes.map(scene => ({scene:scene.id,candidate:selectedCandidate(state,scene)}));
  if (images.some(item => !item.candidate)) return '';
  return hash({ images:images.map(item => ({scene:item.scene, artifact:item.candidate.artifactId, dependency:item.candidate.dependency})), aspectRatio:state.settings.aspectRatio });
}
function effectiveMotion(state, sceneId) {
  const saved=state.motions[sceneId];
  return state.settings.motion.mode==='off'
    ? require('./contracts').resolvedMotion({track:'still',amount:0},saved) : saved;
}
function mediaIdentity(state) {
  const images = imagesIdentity(state);
  if (!images) return '';
  return hash({ renderer:RENDER_VERSION, plan:planGate(state), images, timing:state.narration.timing.identity,
    narration:state.settings.narrationMode === 'enabled' ? state.narration.audioId : '',
    motions:state.plan.scenes.map(scene => ({scene:scene.id,motion:motionIdentity(effectiveMotion(state,scene.id))})),
    subtitles:subtitleStyleFor(state.settings,state.settings.aspectRatio), burnSubtitles:state.settings.burnSubtitles,
    bgm:state.settings.bgmMode, fadeMs:state.settings.motion.fadeMs, fps:FPS });
}
function ensureMotions(state) {
  let previousTrack = '';
  for (const scene of state.plan?.scenes || []) {
    state.motions[scene.id] = assignMotion(state.settings.motion, state.motions[scene.id], {previousTrack});
    previousTrack = state.motions[scene.id].track;
  }
}
function replacePlan(record, plan) {
  const state = record.illustrated;
  if (state.plan?.identity === plan.identity) return;
  if (state.plan) state.planHistory.push({ ...state.plan, savedAt:new Date().toISOString() });
  state.planHistory = state.planHistory.slice(-40);
  state.plan = plan;
  record.title = plan.title;
  state.approvals.plan = '';
  ensureMotions(state);
}
function alignSceneIds(previous, candidate) {
  if(!previous)return candidate;
  const {sceneContentIdentity,normalizePlan}=require('./contracts');
  const claimed=new Set(),matches=new Map();
  for(const scene of candidate.scenes) {
    const old=previous.scenes.find(item=>item.id===scene.id&&sceneContentIdentity(item)===sceneContentIdentity(scene));
    if(old&&!claimed.has(old.id)){matches.set(scene.id,old.id);claimed.add(old.id);}
  }
  for(const scene of candidate.scenes) {
    if(matches.has(scene.id))continue;
    const old=previous.scenes.find(item=>!claimed.has(item.id)&&sceneContentIdentity(item)===sceneContentIdentity(scene));
    if(old){matches.set(scene.id,old.id);claimed.add(old.id);}
  }
  const used=new Set(claimed);
  const scenes=candidate.scenes.map(scene=>{
    if(matches.has(scene.id))return {...scene,id:matches.get(scene.id)};
    let id=scene.id;
    if(used.has(id))id='scene_'+require('crypto').randomUUID().replaceAll('-','').slice(0,20);
    used.add(id);return {...scene,id};
  });
  return normalizePlan({...candidate,scenes},{},{generated:false});
}
function pendingUnknown(state) { return state.attempts.filter(attempt => attempt.status === 'unknown_external_outcome' && !attempt.resolution); }
function refresh(record, message) {
  const state = record.illustrated;
  const current = mediaIdentity(state);
  const output = state.approvals.plan===planGate(state) && currentNarration(state)
    && (state.settings.narrationMode==='disabled' || state.approvals.audio===state.narration.identity)
    ? state.exports.findLast(item => item.identity === current && item.artifactId === state.preview?.artifactId) : null;
  record.result = output ? {render:{output_url:store.url(record,output.artifactId),exports:[{format:'mp4',url:store.url(record,output.artifactId,true)}]}} : null;
  record.render_output_url = output ? store.url(record,output.artifactId) : '';
  let stage, description, status = 'waiting_approval';
  if (state.operation && ['queued','running'].includes(state.operation.status)) {
    stage = state.operation.stage; description = record.message; status = state.operation.status;
  } else if (pendingUnknown(state).length) {
    stage = state.attempts.findLast(item => item.status === 'unknown_external_outcome' && !item.resolution).stage;
    description = '外部请求结果待核实。已完成媒体保留，普通重试不会重复发送。'; status = 'unknown_external_outcome';
  } else if (state.lastError) {
    stage = state.lastError.stage; description = state.lastError.message; status = 'failed';
  } else if (!state.plan) {
    stage = 'content_plan'; description = '请生成或整理文稿与分镜。';
  } else if (state.approvals.plan !== planGate(state)) {
    stage = 'plan_review'; description = '请检查并确认当前文稿与分镜，保存草稿不会启动媒体生产。';
  } else if (!currentNarration(state)) {
    stage = 'narration'; description = state.settings.narrationMode === 'disabled' ? '请建立无配音计划时间轴。' : '请生成完整配音，确认实际时长后再准备图片。';
  } else if (state.settings.narrationMode === 'enabled' && state.approvals.audio !== state.narration.identity) {
    stage = 'audio_review'; description = '完整配音已准备，请试听并确认实际时长。';
  } else if (!imagesIdentity(state) || state.approvals.images !== imagesIdentity(state)) {
    stage = 'images'; description = '请补齐图片并确认选图；轨迹会按画面保存。';
  } else if (!state.preview || state.preview.identity !== current) {
    stage = 'preview'; description = '请生成动态预览，检查当前运动、字幕与声音。';
  } else if (!output) {
    stage = 'export'; description = '动态预览已准备，请观看后确认导出。';
  } else {
    stage = 'export'; description = '当前版本已导出，可以播放或下载。'; status = 'done';
  }
  record.status = status; record.success = !['failed','unknown_external_outcome'].includes(status);
  record.current_stage = stage; record.current_stage_message = message || description; record.message = message || description;
  record.current_progress = status === 'done' ? 100 : Math.round(STAGES.findIndex(item=>item.id===stage)*100/STAGES.length);
  record.stages = STAGES.map((item,index) => ({...item,status: index < STAGES.findIndex(entry=>entry.id===stage) || status==='done' ? 'done'
    : item.id === stage ? (['running','failed'].includes(status)?status:'pending') : 'pending', message:item.id===stage?record.message:''}));
  return record;
}
function actionsFor(record) {
  const state = record.illustrated;
  if (state.operation && ['running','queued'].includes(state.operation.status)) return ['cancel'];
  if (pendingUnknown(state).length) return ['authorize_retry','apply_models','save_plan','save_settings','save_input','upload_image'];
  const result = ['save_plan','save_settings','save_input','apply_models','generate_plan','save_motion','rerandomize','upload_image','select_image'];
  if (state.plan) result.push('approve_plan');
  if (state.plan && state.approvals.plan===planGate(state)) result.push('prepare_narration');
  if (state.plan && state.approvals.plan===planGate(state) && state.settings.narrationMode==='enabled'
    && Object.keys(state.audioCache).length) result.push('regenerate_narration');
  if (currentNarration(state) && state.approvals.plan===planGate(state)) {
    if (state.settings.narrationMode==='enabled') result.push('approve_audio');
    if (state.settings.narrationMode==='disabled' || state.approvals.audio===state.narration.identity) result.push('generate_images','approve_images','preview_scene');
  }
  const identity = imagesIdentity(state);
  const approved = state.approvals.plan===planGate(state) && currentNarration(state)
    && (state.settings.narrationMode==='disabled' || state.approvals.audio===state.narration.identity);
  if (approved && identity && state.approvals.images===identity) {
    result.push('render_preview');
    if (state.preview && state.preview.identity===mediaIdentity(state)) result.push('export');
  }
  return result;
}
function scenePreviewBasis(s, scene) {
  const span=s.narration.timing.scenes.find(item=>item.id===scene.id);
  return hash({image:selectedCandidate(s,scene)?.artifactId,timing:span,motion:motionIdentity(effectiveMotion(s,scene.id)),
    aspectRatio:s.settings.aspectRatio,subtitles:subtitleStyleFor(s.settings,s.settings.aspectRatio),
    burn:s.settings.burnSubtitles,fade:s.settings.motion.fadeMs,renderer:RENDER_VERSION});
}
function currentRecord(record) {
  const result={...record};
  refresh(result);
  if(result.status===record.status && result.current_stage===record.current_stage) {
    result.message=record.message;result.current_stage_message=record.current_stage_message;
  }
  return result;
}
function view(record) {
  const result = structuredClone(currentRecord(record)), state = result.illustrated;
  delete result.path;
  state.models = Object.fromEntries(Object.entries(state.models).map(([key,value])=>[key,publicSnapshot(value)]));
  state.artifacts = Object.fromEntries(Object.entries(state.artifacts).map(([id,item])=>[id,{...item,url:store.url(record,id),downloadUrl:store.url(record,id,true)}]));
  state.allowedActions = actionsFor(record);
  state.planGate = planGate(state);
  state.narrationCurrent = currentNarration(state);
  state.imagesIdentity = imagesIdentity(state);
  state.mediaIdentity = mediaIdentity(state);
  state.previewCurrent = !!state.preview && state.preview.identity===state.mediaIdentity;
  state.unknownAttempts = pendingUnknown(state);
  state.narrationRequestCount = state.settings.narrationMode === 'disabled' ? 0 : (state.plan?.scenes || []).flatMap(scene =>
    require('./timing').chunkText(scene, state.settings.narrationLanguage, record.illustrated.models.tts.parameters)).length;
  state.missingImages = (state.plan?.scenes || []).filter(scene => !selectedCandidate(state, scene)).length;
  if (state.narration && state.settings.narrationMode === 'enabled') state.narration.deviation = Math.abs(state.narration.actualDurationMs-state.settings.targetDurationSeconds*1000)/(state.settings.targetDurationSeconds*1000);
  state.scenes = (state.plan?.scenes || []).map(scene=>{
    const selected = selectedCandidate(state,scene), artifact = selected && state.artifacts[selected.artifactId];
    const candidateList = (state.candidates[scene.id] || []).map(candidate=>({...candidate,current:candidate.dependency===imageIdentity(scene,state.settings)}));
    return {...scene, selected, candidates:candidateList, motion:state.motions[scene.id],
      preview:state.scenePreviews[scene.id] || null,
      previewCurrent:!!state.scenePreviews[scene.id] && state.narrationCurrent && state.scenePreviews[scene.id].basis===scenePreviewBasis(state,scene),
      timing:state.narrationCurrent ? state.narration.timing.scenes.find(item=>item.id===scene.id) : null,
      crop:artifact ? cropInfo(artifact,state.settings.aspectRatio,effectiveMotion(state,scene.id)) : null,
      imageStatus:state.attempts.findLast(item=>item.sceneId===scene.id && item.type==='image')?.status || (selected?'done':'missing')};
  });
  // 缓存内容供服务器恢复，页面只需要当前分段、当前选择和历史摘要。
  state.partialNarration=Object.values(state.audioCache).filter(item=>item.rawId).map(item=>({
    id:item.id,sceneId:item.sceneId,text:item.text,audioId:item.audioId||item.rawId,
    verified:!!item.timing,durationMs:item.durationMs||null,
  }));
  delete state.audioCache;
  state.fragments = Object.fromEntries(Object.entries(state.fragments).map(([key,item])=>[key,{...item}]));
  return result;
}
function recoverInterruptedRecord(record, now = new Date().toISOString()) {
  const state = record.illustrated;
  for (const attempt of state.attempts) {
    if (attempt.status === 'requesting') {
      attempt.status = 'unknown_external_outcome'; attempt.message = '应用中断前已发送请求，结果需要核实。';
    } else if (attempt.status === 'prepared') {
      attempt.status = 'cancelled'; attempt.message = '应用中断时尚未发送请求。';
    }
  }
  if (state.operation && ['queued','running'].includes(state.operation.status)) {
    state.operation.status = 'interrupted';
    state.lastError = {code:'INTERRUPTED',stage:state.operation.stage,message:'任务已中断，成功媒体已保留；请检查当前阶段后继续。'};
  }
  record.active_task_id = ''; record.active_operation_id = ''; record.task_status = 'failed'; record.updated_at = now;
  refresh(record);
}

module.exports = { planGate, narrationSignature, currentNarration, selectedCandidate, imagesIdentity, mediaIdentity,
  ensureMotions, replacePlan, alignSceneIds, pendingUnknown, refresh, actionsFor, currentRecord, view, recoverInterruptedRecord, scenePreviewBasis, effectiveMotion };
