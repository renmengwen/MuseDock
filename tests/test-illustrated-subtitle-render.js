const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const media=require('../server/services/creative/illustrated/media');
const contract=require('../server/services/creative/illustrated/contracts');
const {markerImage}=require('./test-illustrated-media');

async function textBounds(video,frame,file,runtime) {
  await media.execute(runtime.ffmpeg,['-v','error','-y','-i',video,'-vf','select=eq(n\\,'+frame+')','-frames:v','1','-vsync','0',file]);
  const bytes=await fs.readFile(file),header=/^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(bytes.subarray(0,64).toString('ascii'));
  const w=Number(header[1]),h=Number(header[2]),offset=Buffer.byteLength(header[0]);
  let x0=w,x1=-1,y0=h,y1=-1,pixels=0;
  for(let y=Math.floor(h*0.75);y<h;y++)for(let x=0;x<w;x++){
    const i=offset+(y*w+x)*3;
    if(bytes[i]>200&&bytes[i+1]>125&&bytes[i+1]<250&&bytes[i+2]<90){
      pixels++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
    }
  }
  assert(pixels>50,'底部应存在黄色字幕像素，不能只检查 ASS 参数字符串');
  assert(x0>w*0.06&&x1<w*0.94&&y1<h*0.98,'字幕应处于画面安全区域内');
  return {x0,x1,y0,y1,width:x1-x0+1,height:y1-y0+1,pixels};
}
async function main(){
  const index=process.argv.indexOf('--output'),directory=index>=0?path.resolve(process.argv[index+1]):await fs.mkdtemp(path.join(os.tmpdir(),'illustrated-subtitle-render-'));
  await fs.mkdir(directory,{recursive:true});
  const runtime=await media.preflight(),results=[];
  for(const aspectRatio of ['16:9','9:16','4:3']){
    const canvas=contract.canvasFor(aspectRatio),imagePath=await markerImage(directory,canvas,runtime),sizes=[];
    for(const fontSize of [24,96]){
      const settings=contract.normalizeSettings({aspectRatio,subtitleColor:'#FFCC00',subtitleFontSize:fontSize,motion:{fadeMs:0}});
      const output=await media.renderFragment({scene:{frameCount:25},imagePath,motion:contract.resolvedMotion({track:'zoom_in',amount:8}),
        settings,captions:[{text:'字幕颜色与字号',startMs:0,endMs:1000}],directory,runtime});
      const first=await textBounds(output.path,0,path.join(directory,'first.ppm'),runtime);
      const last=await textBounds(output.path,24,path.join(directory,'last.ppm'),runtime);
      for(const key of ['x0','x1','y0','y1'])assert(Math.abs(first[key]-last[key])<=2,'字幕不能随图片运镜改变位置或尺度');
      results.push({aspectRatio,fontSize,color:'#FFCC00',motion:'zoom_in',first,last,validation:output.validation,passed:true});
      sizes.push(first);
    }
    assert(sizes[1].width/sizes[0].width>3.4,'96px 字幕应明显大于 24px，不能只有配置值变化');
    console.log('PASS '+aspectRatio+'：字幕颜色、24/96px 实际像素及运镜时固定位置');
  }
  await fs.writeFile(path.join(directory,'subtitle-evaluation.json'),JSON.stringify({renderer:contract.RENDER_VERSION,cases:results},null,2));
}
main().catch(error=>{console.error(error.message);if(error.detail)console.error(error.detail);process.exitCode=1;});
