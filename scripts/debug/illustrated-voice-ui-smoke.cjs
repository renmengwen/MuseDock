const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright-core');
const {startFixtureServer}=require('../../tests/helpers/illustrated-server.cjs');
async function main(){
  const server=await startFixtureServer(),errors=[];let browser;
  try{
    let executablePath=process.env.MUSEDOCK_QA_BROWSER;
    for(const file of ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']){
      if(!executablePath&&await fs.access(file).then(()=>true,()=>false))executablePath=file;
    }
    browser=await chromium.launch({executablePath,headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-CN'});page.setDefaultTimeout(20000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===server.origin?route.continue():route.abort());
    await page.goto(server.origin+'/creative');
    await page.getByRole('tab',{name:'旁白配图视频',exact:true}).click();
    await page.getByLabel('旁白配图主题',{exact:true}).fill('清晨的城市，有声流程验证');
    await page.getByRole('button',{name:'15 秒',exact:true}).click();
    await page.getByRole('button',{name:'创建旁白配图任务',exact:true}).click();
    await page.waitForURL(/\/creative\/\d+/);
    await page.getByRole('button',{name:'确认当前文稿与制作方案',exact:true}).click();
    await page.getByRole('dialog',{name:'确认内容与制作方案',exact:true}).getByRole('button',{name:'确认',exact:true}).click();
    await page.getByRole('button',{name:'生成完整配音',exact:true}).click();
    await page.getByRole('dialog',{name:'生成完整配音',exact:true}).getByRole('button',{name:'确认',exact:true}).click();
    const audio=page.getByLabel('完整旁白试听',{exact:true});await audio.waitFor();
    await page.waitForFunction(()=>document.querySelector('audio[aria-label=\"完整旁白试听\"]')?.readyState>=2);
    await audio.evaluate(element=>element.play());
    await page.waitForFunction(()=>document.querySelector('audio[aria-label=\"完整旁白试听\"]')?.currentTime>0.2);
    await audio.evaluate(element=>element.pause());
    await page.getByText(/实际配音与目标偏差 50%/).waitFor();
    assert.equal(server.counts.tts,3);assert.equal(server.counts.image,0,'试听确认之前不能自动生图');
    const output=path.resolve('docs/verification/illustrated/ui');await fs.mkdir(output,{recursive:true});
    await page.screenshot({path:path.join(output,'08-voice-review.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'有声审核区在 390px 下不能横向溢出');
    await page.screenshot({path:path.join(output,'08-voice-review-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'已试听，接受实际时长',exact:true}).click();
    await page.getByRole('dialog',{name:'确认配音与实际时长',exact:true}).getByRole('button',{name:'确认',exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.includes('补齐缺失配图')&&!button.disabled));
    assert.deepEqual(errors,[]);
    const report={success:true,realProviderCalls:0,modelFixtureCalls:server.counts,audioFixture:'synthetic_tone_not_human_voice_approval',
      checks:['有声任务创建与完整配音','真实浏览器音频播放','实际时长偏差提示','试听确认前不生图','确认后进入图片阶段','390px 有声审核区','无浏览器运行时异常']};
    await fs.writeFile(path.join(output,'voice-ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser?.close();await server.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
