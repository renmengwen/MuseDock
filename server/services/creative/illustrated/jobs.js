const fs=require('fs/promises');
const path=require('path');
const {randomUUID}=require('crypto');
const contract=require('./contracts');
const models=require('./models');
const store=require('./storage');
const state=require('./state');
const media=require('./media');
const timing=require('./timing');
const {srtText}=require('../shared/captionLayout');

async function plan(ctx) {
  let record=await ctx.check();
  const frozen=await models.resolveFrozen(record.illustrated,['text'],ctx.options);
  await ctx.progress(record.input.useResearch?'正在读取联网参考资料...':'正在整理文稿与分镜...');
  const research=await models.research(record,ctx.options);
  record=await ctx.update(current=>{current.illustrated.research=research;});
  await ctx.external('text',contract.hash({input:record.input,settings:record.illustrated.settings,model:record.illustrated.models.text.hash}),null,
    (before,attempt)=>models.draft(before,frozen.text,attempt,ctx.options),
    (current,response)=>{state.replacePlan(current,state.alignSceneIds(current.illustrated.plan,response.plan));});
}

async function readJsonArtifact(record,id,options) {
  const file=await store.mediaFile(record,id,options.rootDir,{checkHash:true});
  return JSON.parse(await fs.readFile(file.path,'utf8'));
}
async function narration(ctx) {
  let record=await ctx.check(),s=record.illustrated;
  if(!s.plan || s.approvals.plan!==state.planGate(s)) throw new contract.ErrorType('PLAN_REQUIRED','请先确认当前文稿与分镜。',409);
  if(s.settings.narrationMode==='disabled') {
    const planned=timing.plannedTiming(s.plan,s.settings);
    // 基础计划不依赖显示样式；这里验证当次字号下的阅读预算。
    timing.displayFromCues(planned.cues,s.settings,true);
    await ctx.update(current=>{
      const signature=state.narrationSignature(current.illustrated);
      current.illustrated.narration={signature,identity:contract.hash({signature,timing:planned.identity}),
        audioId:'',timing:planned,segments:[],actualDurationMs:planned.durationMs};
    });
    return;
  }
  const frozen=await models.resolveFrozen(s,['tts'],ctx.options);
  if (frozen.asr) {
    await (ctx.options.services?.ensureFunasrService || require('../../transcription/funasrRuntime').ensureFunasrService)(frozen.asr, {
      onProgress:({message})=>ctx.progress(message),
    });
  }
  const runtime=await media.preflight(ctx.options.mediaOptions);
  const takes=s.operation.audioTakes||s.audioTakes,chunkTakes=s.operation.audioChunkTakes||s.audioChunkTakes||{};
  const chunks=s.plan.scenes.flatMap(scene=>timing.chunkText(scene,s.settings.narrationLanguage,frozen.tts)).map(chunk=>({
    ...chunk,identity:contract.hash({base:timing.audioSegmentIdentity(chunk,s.settings,s.models.tts),take:takes[chunk.sceneId]||0,
      ...(chunkTakes[chunk.id]?{chunkTake:chunkTakes[chunk.id]}:{})}),
  }));
  const segments=[];
  for(const [index,chunk] of chunks.entries()) {
    record=await ctx.check();s=record.illustrated;
    await ctx.progress('正在准备完整配音（'+(index+1)+'/'+chunks.length+' 段）...',{queued:chunks.length-index-1,running:1,success:index});
    let cached=s.audioCache[chunk.identity];
    if(!cached?.rawId || !await store.validArtifact(record,cached.rawId,ctx.options.rootDir)) {
      await ctx.external('tts',chunk.identity,chunk.sceneId,(before,attempt)=>models.narration(before,chunk,frozen.tts,attempt,ctx.options),
        async(current,response)=>{
          const entry={...chunk,provider:frozen.tts.provider,format:['wav','mp3','flac','ogg'].includes(response.format)?response.format:'wav'};
          if(response.audioBuffer?.length) {
            const raw=await store.putBuffer(current,response.audioBuffer,{kind:'audio_raw',ext:entry.format,mime:entry.format==='mp3'?'audio/mpeg':'audio/'+entry.format},ctx.options.rootDir);
            entry.rawId=raw.id;
          }
          if(response.nativeSubtitles) {
            const evidence=await store.putBuffer(current,Buffer.from(JSON.stringify(response.nativeSubtitles)),{kind:'subtitle_evidence',ext:'json',mime:'application/json'},ctx.options.rootDir);
            entry.evidenceId=evidence.id;
          }
          current.illustrated.audioCache[chunk.identity]=entry;
        },{chunkId:chunk.id,text:chunk.text,language:s.settings.narrationLanguage});
      record=await ctx.read();cached=record.illustrated.audioCache[chunk.identity];
    }
    if(!cached?.rawId) throw new contract.ErrorType('UNKNOWN_EXTERNAL_OUTCOME','配音未返回完整音频，请核实原请求后再决定是否重新生成。',409);
    if(!cached.audioId || !await store.validArtifact(record,cached.audioId,ctx.options.rootDir)) {
      const raw=await store.mediaFile(record,cached.rawId,ctx.options.rootDir,{checkHash:true});
      const output=path.join(ctx.directory,randomUUID()+'.wav');
      const info=await media.normalizeAudio(raw.path,output,runtime);
      record=await ctx.update(async current=>{
        const artifact=await store.putFile(current,output,{kind:'audio_segment',ext:'wav',mime:'audio/wav',...info},ctx.options.rootDir);
        Object.assign(current.illustrated.audioCache[chunk.identity],{audioId:artifact.id,durationMs:info.durationMs});
      });
      cached=record.illustrated.audioCache[chunk.identity];
    }
    if(frozen.tts.provider==='mimo' && !cached.evidenceId) {
      const audio=await store.mediaFile(record,cached.audioId,ctx.options.rootDir,{checkHash:true});
      await ctx.external('asr',chunk.identity,chunk.sceneId,
        (before,attempt)=>models.transcribe(before,audio.path,cached.durationMs,frozen.asr,attempt,path.join(ctx.directory,chunk.id),ctx.options),
        async(current,evidence)=>{
          const artifact=await store.putBuffer(current,Buffer.from(JSON.stringify(evidence)),{kind:'subtitle_evidence',ext:'json',mime:'application/json'},ctx.options.rootDir);
          current.illustrated.audioCache[chunk.identity].evidenceId=artifact.id;
        });
      record=await ctx.read();cached=record.illustrated.audioCache[chunk.identity];
    }
    if(!cached.evidenceId) throw new contract.ErrorType('NARRATION_EVIDENCE_INVALID','音频缺少同请求字幕证据，请核实原请求后处理；不会自动再次合成。',409);
    const evidence=await readJsonArtifact(record,cached.evidenceId,ctx.options);
    const partTiming=frozen.tts.provider==='mimo'?timing.asrSegmentTiming(chunk,evidence,cached.durationMs,s.settings):timing.nativeSegmentTiming(chunk,evidence,cached.durationMs,s.settings);
    const segment={...cached,...chunk,timing:partTiming};
    segments.push(segment);
    await ctx.update(current=>{
      current.illustrated.audioCache[chunk.identity]=segment;
      Object.assign(current.illustrated.operation.progress,{running:0,success:index+1});
    });
  }
  await ctx.check();
  record=await ctx.read();s=record.illustrated;
  const combined=timing.assembleTiming(s.plan,segments);
  const audioPaths=await Promise.all(segments.map(async item=>(await store.mediaFile(record,item.audioId,ctx.options.rootDir,{checkHash:true})).path));
  const output=path.join(ctx.directory,randomUUID()+'.wav');
  const actualDurationMs=await media.concatAudio(audioPaths,output,runtime,ctx.directory);
  if(Math.abs(actualDurationMs-combined.durationMs)>100) throw new contract.ErrorType('AUDIO_TIMING_MISMATCH','配音拼接时长与分段证据不一致，请检查分段音频。');
  await ctx.update(async current=>{
    if(current.illustrated.operation.cancelRequested) throw new contract.ErrorType('CANCELLED','替代配音已停止，当前已确认配音保持不变。');
    const artifact=await store.putFile(current,output,{kind:'narration',ext:'wav',mime:'audio/wav',durationMs:actualDurationMs},ctx.options.rootDir);
    const signature=state.narrationSignature(current.illustrated);
    const previous=current.illustrated.narration;
    const identity=contract.hash({signature,audio:artifact.sha256,timing:combined.identity});
    if(previous?.audioId && previous.identity!==identity) {
      (current.illustrated.narrationHistory ||= []).push({identity:previous.identity,audioId:previous.audioId,
        durationMs:previous.actualDurationMs,createdAt:new Date().toISOString()});
      current.illustrated.narrationHistory=current.illustrated.narrationHistory.slice(-30);
    }
    current.illustrated.narration={signature,identity,
      audioId:artifact.id,timing:combined,segments,actualDurationMs,
      deviation:Math.abs(actualDurationMs-s.settings.targetDurationSeconds*1000)/(s.settings.targetDurationSeconds*1000)};
    current.illustrated.audioTakes=takes;current.illustrated.audioChunkTakes=chunkTakes;
    current.illustrated.pendingAudioTakes=null;current.illustrated.pendingAudioChunkTakes=null;
    if(previous?.identity!==identity) current.illustrated.approvals.audio='';
    current.illustrated.operation.progress={queued:0,running:0,success:segments.length,failed:0,cancelled:0};
  });
}

async function images(ctx) {
  let record=await ctx.check(),s=record.illustrated;
  const frozen=await models.resolveFrozen(s,['image'],ctx.options);
  const runtime=await media.preflight(ctx.options.mediaOptions);
  const sceneIds=s.operation.sceneIds,errors=[];
  let successes=0;
  for(const [index,id] of sceneIds.entries()) {
    record=await ctx.check();s=record.illustrated;
    const scene=s.plan.scenes.find(item=>item.id===id);
    await ctx.progress('正在生成配图（'+(index+1)+'/'+sceneIds.length+'）...',{queued:sceneIds.length-index-1,running:1,success:successes,failed:errors.length});
    try {
      const requestIdentity = contract.hash({image:contract.imageIdentity(scene,s.settings),model:s.models.image.hash,aspectRatio:s.settings.aspectRatio});
      const reusable = !s.operation.regenerate && s.attempts.findLast(item=>item.type==='image' && item.sceneId===id
        && item.inputIdentity===requestIdentity && item.status==='local_failed' && item.sourceId);
      let sourceId = reusable?.sourceId;
      if (!sourceId || !await store.validArtifact(record,sourceId,ctx.options.rootDir)) await ctx.external('image',requestIdentity,id,
        (before,attempt)=>models.image(before,scene,frozen.image,attempt,ctx.directory,ctx.options),
        async(current,response)=>{
          const mime=media.imageMime(response.buffer);
          const artifact=await store.putBuffer(current,response.buffer,{kind:'image_raw',ext:mime==='image/jpeg'?'jpg':mime==='image/webp'?'webp':'png',mime},ctx.options.rootDir);
          sourceId=artifact.id;
          // 原图先落盘；归一化失败仍可从同次返回恢复。
          const attempt=current.illustrated.attempts.at(-1);
          attempt.sourceId=sourceId;attempt.prompt=response.prompt;attempt.size=response.size;
        });
      record=await ctx.read();
      const source=await store.mediaFile(record,sourceId,ctx.options.rootDir,{checkHash:true});
      const output=path.join(ctx.directory,randomUUID()+'.png');
      const size=await media.normalizeImage(source.path,output,runtime);
      await ctx.update(async current=>{
        const artifact=await store.putFile(current,output,{kind:'image',ext:'png',mime:'image/png',...size},ctx.options.rootDir);
        const candidate={id:randomUUID(),artifactId:artifact.id,sourceId,source:'generated',
          dependency:contract.imageIdentity(scene,s.settings),prompt:contract.imagePrompt(scene,s.settings),
          model:models.publicSnapshot(s.models.image),requestedSize:models.imageSize(frozen.image,s.settings.aspectRatio),
          aspectRatio:s.settings.aspectRatio,style:structuredClone(s.settings.style),customStyle:s.settings.customStyle,createdAt:new Date().toISOString()};
        (current.illustrated.candidates[id] ||= []).push(candidate);
        current.illustrated.selections[id]=candidate.id;
        if (reusable) { const attempt=current.illustrated.attempts.find(item=>item.id===reusable.id);attempt.status='done';attempt.message='已从保存的同次图片返回恢复。'; }
      });
      successes++;
      await ctx.update(current=>{Object.assign(current.illustrated.operation.progress,{running:0,success:successes});});
    } catch(error) {
      errors.push(store.safeError(error));
      await ctx.update(current=>{
        const attempt=current.illustrated.attempts.findLast(item=>item.sceneId===id && item.type==='image');
        if(attempt && attempt.status==='done') {attempt.status='local_failed';attempt.message=store.safeError(error).message;}
      });
      if(error.code==='UNKNOWN_EXTERNAL_OUTCOME') throw error;
    }
  }
  await ctx.update(current=>{current.illustrated.operation.progress={queued:0,running:0,success:successes,failed:errors.length,cancelled:0};});
  if(errors.length) throw new contract.ErrorType('PARTIAL_IMAGE_FAILURE','已保留 '+successes+' 张成功图片，'+errors.length+' 张未完成。请查看失败项并单张处理。',409);
}

const {scenePreviewBasis}=state;
async function render(ctx,single) {
  let record=await ctx.check(),s=record.illustrated;
  if (s.approvals.plan!==state.planGate(s) || (s.settings.narrationMode==='enabled' && s.approvals.audio!==s.narration?.identity)) {
    throw new contract.ErrorType('APPROVAL_REQUIRED','请先确认当前方案和实际配音时长。',409);
  }
  if(!state.currentNarration(s)) throw new contract.ErrorType('TIMING_REQUIRED','当前时间轴已失效，请先准备并确认配音或无配音时间轴。',409);
  const runtime=await media.preflight(ctx.options.mediaOptions);
  const captions=await timing.displayCaptions(s,id=>readJsonArtifact(record,id,ctx.options));
  const quantized=timing.quantizedScenes(s.narration.timing);
  const scenes=single?quantized.filter(scene=>s.operation.sceneIds.includes(scene.id)):quantized;
  const paths=[],fragmentIds=[];
  for(const [index,span] of scenes.entries()) {
    await ctx.check();
    await ctx.progress('正在渲染动态片段（'+(index+1)+'/'+scenes.length+'）...',{queued:scenes.length-index-1,running:1,success:index});
    const scene=s.plan.scenes.find(item=>item.id===span.id),candidate=state.selectedCandidate(s,scene);
    if(!candidate) throw new contract.ErrorType('IMAGE_REQUIRED','请先补齐并选择当前有效配图。',409);
    const image=await store.mediaFile(record,candidate.artifactId,ctx.options.rootDir,{checkHash:true});
    const localCaptions=captions.filter(cue=>cue.endMs>span.startMs && cue.startMs<span.endMs).map(cue=>({...cue,
      startMs:Math.max(0,cue.startMs-span.startMs),endMs:Math.min(span.endMs-span.startMs,cue.endMs-span.startMs)}));
    const input={scene:span,image:image.artifact,imagePath:image.path,motion:state.effectiveMotion(s,scene.id),settings:s.settings,captions:localCaptions,directory:ctx.directory,runtime};
    const identity=media.fragmentIdentity(input);
    let fragment=s.fragments[identity];
    if(!fragment || !await store.validArtifact(record,fragment.artifactId,ctx.options.rootDir)) {
      const output=await media.renderFragment(input);
      record=await ctx.update(async current=>{
        const artifact=await store.putFile(current,output.path,{kind:'fragment',ext:'mp4',mime:'video/mp4',...output.validation},ctx.options.rootDir);
        current.illustrated.fragments[identity]={identity,artifactId:artifact.id,validation:output.validation,renderer:contract.RENDER_VERSION};
      });
      s=record.illustrated;fragment=s.fragments[identity];
    }
    record=await ctx.update(current=>{
      current.illustrated.scenePreviews[scene.id]={...fragment,basis:scenePreviewBasis(current.illustrated,scene)};
      Object.assign(current.illustrated.operation.progress,{running:0,success:index+1});
    });
    s=record.illustrated;
    paths.push((await store.mediaFile(record,fragment.artifactId,ctx.options.rootDir,{checkHash:true})).path);
    fragmentIds.push(identity);
  }
  if(single) return;
  await ctx.check();
  const narrationPath=s.settings.narrationMode==='enabled'?(await store.mediaFile(record,s.narration.audioId,ctx.options.rootDir,{checkHash:true})).path:null;
  await ctx.progress('正在合成字幕、配音和背景音乐，并完整解码检查视频...');
  const output=await media.compose({files:paths,narrationPath,settings:s.settings,frameCount:quantized.at(-1).endFrame,directory:ctx.directory,runtime});
  await ctx.update(async current=>{
    const artifact=await store.putFile(current,output.path,{kind:'preview',ext:'mp4',mime:'video/mp4',...output.validation},ctx.options.rootDir);
    const srt=await store.putBuffer(current,Buffer.from(srtText(captions)),{kind:'subtitles',ext:'srt',mime:'application/x-subrip'},ctx.options.rootDir);
    current.illustrated.preview={identity:state.mediaIdentity(current.illustrated),artifactId:artifact.id,srtId:srt.id,
      fragmentIds,runtimeIdentity:runtime.identity,validation:output.validation,bgm:output.bgm,createdAt:new Date().toISOString()};
    current.illustrated.operation.progress={queued:0,running:0,success:scenes.length,failed:0,cancelled:0};
  });
}

module.exports={plan,narration,images,scene_preview:ctx=>render(ctx,true),preview:ctx=>render(ctx,false),scenePreviewBasis};
