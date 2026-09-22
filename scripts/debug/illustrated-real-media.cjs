// 固定公开照片 + Windows 本地语音夹具，用来观看实际裁切、字幕与运镜；不验证外部模型质量。
const fs=require('node:fs/promises');
const path=require('node:path');
const media=require('../../server/services/creative/illustrated/media');
const contract=require('../../server/services/creative/illustrated/contracts');
const timing=require('../../server/services/creative/illustrated/timing');
const store=require('../../server/services/creative/illustrated/storage');

async function main(){
  const reference=path.resolve('docs/verification/illustrated/reference'),directory=path.resolve('docs/verification/illustrated/real-media');
  await fs.mkdir(directory,{recursive:true});
  const runtime=await media.preflight(),imagePath=path.join(reference,'fruits.jpg'),audio=path.join(reference,'local-sapi-narration.wav');
  const durationMs=Math.round(Number((await media.probe(audio,runtime)).format.duration)*1000);
  const frameCount=Math.ceil(durationMs*25/1000),results=[];
  for(const [aspectRatio,track]of [['16:9','zoom_in'],['9:16','pan_up'],['4:3','pan_down_right']]){
    const settings=contract.normalizeSettings({aspectRatio,narrationMode:'enabled',subtitleColor:'#FFFFFF'});
    const motion=contract.resolvedMotion({track,amount:6,easing:'smooth'});
    const cues=timing.displayFromCues([{id:'local_fixture',text:'清晨的阳光，照亮桌上的水果。慢慢推近，看看熟悉事物里的细节。让画面轻轻移动，让讲述从容展开。',startMs:0,endMs:durationMs}],settings);
    const fragment=await media.renderFragment({scene:{frameCount},imagePath,motion,settings,captions:cues,directory,runtime});
    const output=await media.compose({files:[fragment.path],narrationPath:audio,settings,frameCount,directory,runtime});
    const name='real-photo-'+aspectRatio.replace(':','x')+'.mp4';
    await fs.rename(output.path,path.join(directory,name));
    results.push({name,aspectRatio,track,amount:6,validation:output.validation});
  }
  await fs.writeFile(path.join(directory,'provenance.json'),JSON.stringify({
    purpose:'本地真实照片与有声媒体检查，不代表所选外部模型的生成或人工质量验收',
    image:{url:'https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/fruits.jpg',sha256:await store.digest(imagePath),license:'OpenCV Apache-2.0；本地保留 LICENSE'},
    audio:{source:'Windows SAPI 本机离线中文语音',sha256:await store.digest(audio),externalProviderCalls:0},
    subtitles:{kind:'planned_display_fixture',notice:'仅为本地渲染夹具的计划显示时间，不冒充供应商原生字幕或 ASR'},
    results,
  },null,2));
  console.log(JSON.stringify({success:true,directory,cases:results.length,externalProviderCalls:0},null,2));
}
main().catch(error=>{console.error(error.message);if(error.detail)console.error(error.detail);process.exitCode=1;});
