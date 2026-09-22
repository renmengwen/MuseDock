const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {fixture}=require('./test-illustrated-narration');
const workflow=require('../server/services/creative/illustrated/workflows');
const store=require('../server/services/creative/illustrated/storage');
const contract=require('../server/services/creative/illustrated/contracts');
const state=require('../server/services/creative/illustrated/state');
const media=require('../server/services/creative/illustrated/media');
const {letters}=require('../server/services/creative/shared/captionLayout');

function wav(durationMs=2500) {
  const rate=24000,samples=Math.round(durationMs*rate/1000),out=Buffer.alloc(44+samples*2);
  out.write('RIFF',0);out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);
  out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);
  out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)out.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*5000*Math.min(1,i/800,(samples-i)/800)),44+i*2);
  return out;
}
function nativeFixture(text,durationMs) {
  const chars=letters(text);
  return {schemaVersion:1,kind:'providerNativeWordSubtitles',provider:'minimax',model:'speech-fixture',
    words:chars.map((text,index)=>({text,start_time:100+Math.round((durationMs-200)*index/chars.length),
      end_time:100+Math.round((durationMs-200)*(index+1)/chars.length)}))};
}
async function markerImage(directory,canvas,runtime) {
  const {width:w,height:h}=canvas,data=Buffer.alloc(w*h*3);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    let rgb=(x%160<4||y%120<4)?[48,70,95]:[205,219,224];
    if(x>w*0.35&&x<w*0.35+160&&y>h*0.4&&y<h*0.4+160)rgb=[235,28,32];
    if(x>w*0.68&&x<w*0.68+80&&y>h*0.2&&y<h*0.2+240)rgb=[25,180,70];
    const i=(y*w+x)*3;data[i]=rgb[0];data[i+1]=rgb[1];data[i+2]=rgb[2];
  }
  const ppm=path.join(directory,'markers-'+w+'x'+h+'.ppm'),png=ppm+'.png';
  await fs.writeFile(ppm,Buffer.concat([Buffer.from('P6\n'+w+' '+h+'\n255\n'),data]));
  await media.execute(runtime.ffmpeg,['-v','error','-y','-i',ppm,'-frames:v','1','-threads','1',png]);
  return png;
}
async function fullPipeline({aspectRatio,narrationMode,burnSubtitles,bgmMode='disabled',outputDirectory}) {
  await fixture(async ctx=>{
    const runtime=await media.preflight();
    const image=await markerImage(ctx.rootDir,contract.canvasFor(aspectRatio),runtime);
    ctx.options.services.aiTtsModel.callTtsModel=async ({text})=>{
      ctx.counters.tts++;const durationMs=Math.max(1800,letters(text).length*200+200);
      return {success:true,audioBuffer:wav(durationMs),format:'wav',nativeSubtitles:nativeFixture(text,durationMs)};
    };
    const id=await ctx.create({aspectRatio,narrationMode,burnSubtitles,bgmMode,targetDurationSeconds:15});
    assert.equal((await workflow.run(id,ctx.options)).current_stage,'plan_review');
    await ctx.act(id,'approve_plan');await ctx.act(id,'prepare_narration');
    let result=await workflow.run(id,ctx.options);
    assert.notEqual(result.status,'failed',result.message);
    let record=await ctx.read(id);
    if(narrationMode==='enabled'){
      assert.equal(record.current_stage,'audio_review');assert.equal(ctx.counters.tts,3);
      await ctx.act(id,'approve_audio',{identity:record.illustrated.narration.identity});
    } else assert.equal(ctx.counters.tts,0);
    for(const scene of record.illustrated.plan.scenes){
      record=await ctx.read(id);
      await workflow.upload(id,{sceneId:scene.id,expectedRevision:record.illustrated.revision,data:(await fs.readFile(image)).toString('base64')},ctx.options);
    }
    record=await ctx.read(id);await ctx.act(id,'approve_images',{identity:state.imagesIdentity(record.illustrated)});
    await ctx.act(id,'render_preview');result=await workflow.run(id,ctx.options);
    assert.notEqual(result.status,'failed',result.message);
    record=await ctx.read(id);assert.equal(record.current_stage,'export');assert.equal(record.status,'waiting_approval');
    const preview=record.illustrated.preview;
    assert(preview.validation.decoded);assert.equal(preview.validation.width,contract.canvasFor(aspectRatio).width);
    assert.equal(preview.validation.audio,narrationMode==='enabled'||bgmMode==='enabled');
    await ctx.act(id,'export',{identity:state.mediaIdentity(record.illustrated)});
    record=await ctx.read(id);assert.equal(record.status,'done');
    const artifact=await store.mediaFile(record,preview.artifactId,ctx.rootDir,{checkHash:true});
    if(outputDirectory){
      const tag=[aspectRatio.replace(':','x'),narrationMode,burnSubtitles?'captions':'no-captions',bgmMode].join('-');
      await fs.copyFile(artifact.path,path.join(outputDirectory,tag+'.mp4'));
      const subtitle=await store.mediaFile(record,preview.srtId,ctx.rootDir);
      await fs.copyFile(subtitle.path,path.join(outputDirectory,tag+'.srt'));
      await fs.writeFile(path.join(outputDirectory,tag+'.json'),JSON.stringify({fixture:true,modelCalls:ctx.counters,
        narrationEvidence:'synthetic_native_fixture_not_real_provider',validation:preview.validation,settings:record.illustrated.settings},null,2));
    }
    // 相同设置重复预览应保留全部片段；单幕运镜只新增一个片段，不请求图片或配音。
    const oldFragments=Object.keys(record.illustrated.fragments);
    await ctx.act(id,'save_motion',{sceneId:'scene_1',motion:{track:'pan_down_right',amount:12}});
    await ctx.act(id,'render_preview');result=await workflow.run(id,ctx.options);
    assert.notEqual(result.status,'failed',result.message);
    record=await ctx.read(id);assert.equal(Object.keys(record.illustrated.fragments).length,oldFragments.length+1);
    assert.equal(ctx.counters.image,0);assert.equal(ctx.counters.tts,narrationMode==='enabled'?3:0);
    assert(record.illustrated.exports.length===1);assert.equal(record.result,null,'历史成片不能冒充当前成片');
    console.log('PASS 实际 FFmpeg 闭环 '+aspectRatio+' '+narrationMode+' 字幕='+burnSubtitles+' BGM='+bgmMode);
  });
}
async function main(){
  const outputIndex=process.argv.indexOf('--output'),outputDirectory=outputIndex>=0?path.resolve(process.argv[outputIndex+1]):await fs.mkdtemp(path.join(os.tmpdir(),'illustrated-media-evidence-'));
  await fs.mkdir(outputDirectory,{recursive:true});
  for(const settings of [
    {aspectRatio:'16:9',narrationMode:'disabled',burnSubtitles:true},
    {aspectRatio:'9:16',narrationMode:'disabled',burnSubtitles:false,bgmMode:'enabled'},
    {aspectRatio:'4:3',narrationMode:'enabled',burnSubtitles:true},
    {aspectRatio:'16:9',narrationMode:'enabled',burnSubtitles:false},
    {aspectRatio:'4:3',narrationMode:'enabled',burnSubtitles:false,bgmMode:'enabled'},
  ])await fullPipeline({...settings,outputDirectory});
  console.log('媒体验证产物：'+outputDirectory);
}
if(require.main===module)main().catch(error=>{console.error(error.message);if(error.detail)console.error(error.detail);console.error(error.stack);process.exitCode=1;});
module.exports={wav,nativeFixture,markerImage,fullPipeline};
