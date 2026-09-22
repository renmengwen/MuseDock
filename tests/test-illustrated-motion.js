const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const media=require('../server/services/creative/illustrated/media');
const contract=require('../server/services/creative/illustrated/contracts');
const {markerImage}=require('./test-illustrated-media');

async function bounds(video,frameIndex,directory,runtime) {
  const file=path.join(directory,'frame-'+frameIndex+'.ppm');
  await media.execute(runtime.ffmpeg,['-v','error','-y','-i',video,'-vf','select=eq(n\\,'+frameIndex+')','-frames:v','1','-vsync','0',file]);
  const bytes=await fs.readFile(file),header=/^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(bytes.subarray(0,64).toString('ascii'));
  assert(header,'PPM 头无效');
  const width=Number(header[1]),height=Number(header[2]),offset=Buffer.byteLength(header[0]);
  let minX=width,minY=height,maxX=-1,maxY=-1,count=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const at=offset+(y*width+x)*3;
    if(bytes[at]>190&&bytes[at+1]<90&&bytes[at+2]<100) {minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);count++;}
  }
  assert(count>500,'非对称红色标记不可见，不能据纯色帧差判定运动');
  return {cx:(minX+maxX)/2,cy:(minY+maxY)/2,width:maxX-minX+1,height:maxY-minY+1};
}
async function main() {
  const index=process.argv.indexOf('--output'),directory=index>=0?path.resolve(process.argv[index+1]):await fs.mkdtemp(path.join(os.tmpdir(),'illustrated-motion-'));
  await fs.mkdir(directory,{recursive:true});
  const runtime=await media.preflight(),results=[];
  for(const aspectRatio of ['16:9','9:16','4:3']) {
    const canvas=contract.canvasFor(aspectRatio),imagePath=await markerImage(directory,canvas,runtime);
    for(const track of contract.TRACKS) {
      const settings=contract.normalizeSettings({aspectRatio,burnSubtitles:false,motion:{fadeMs:0}});
      const motion=contract.resolvedMotion({track:track.id,amount:8,easing:'smooth'});
      const result=await media.renderFragment({scene:{frameCount:50},imagePath,motion,settings,captions:[],directory,runtime});
      const tag=aspectRatio.replace(':','x')+'-'+track.id,output=path.join(directory,tag+'.mp4');
      await fs.rename(result.path,output);
      const frames=[];
      for(const index of [0,25,49])frames.push(await bounds(output,index,directory,runtime));
      const first=frames[0],last=frames.at(-1),dx=last.cx-first.cx,dy=last.cy-first.cy;
      if(track.kind==='still') {
        assert(Math.abs(dx)<1&&Math.abs(dy)<1);assert.equal(first.width,last.width);
      } else if(track.id==='zoom_in')assert(last.width/first.width>1.06,'推近必须增加标记尺寸');
      else if(track.id==='zoom_out')assert(last.width/first.width<0.94,'拉远必须减小标记尺寸');
      else {
        if(track.dx)assert(dx*track.dx>20,'横向位移方向或幅度错误：'+tag);
        else assert(Math.abs(dx)<2,'竖向轨迹不应产生横向漂移');
        if(track.dy)assert(dy*track.dy>20,'纵向位移方向或幅度错误：'+tag);
        else assert(Math.abs(dy)<2,'横向轨迹不应产生纵向漂移');
        assert(Math.abs(last.width-first.width)<=2,'平移不应同时改变缩放');
      }
      results.push({aspectRatio,track:track.id,amount:8,frames,dx,dy,validation:result.validation,passed:true});
    }
    console.log('PASS '+aspectRatio+'：静止 + 10 种运动，实际帧位置与尺度验证');
  }
  await fs.writeFile(path.join(directory,'motion-evaluation.json'),JSON.stringify({renderer:contract.RENDER_VERSION,motion:contract.MOTION_VERSION,
    method:'非对称网格与红色标记，25 fps，关闭字幕与淡化，比较第 0/25/49 帧',cases:results},null,2));
  console.log('运动验收：'+results.length+' 组实际 FFmpeg 输出全部符合有限断言。');
}
if(require.main===module)main().catch(error=>{console.error(error.message);if(error.detail)console.error(error.detail);process.exitCode=1;});
module.exports={bounds};
