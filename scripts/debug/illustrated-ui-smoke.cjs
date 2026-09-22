// 真实 React + HTTP/SSE + 本地存储 + FFmpeg，模型只使用隔离替身。
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright-core');
const {startFixtureServer}=require('../../tests/helpers/illustrated-server.cjs');

async function main(){
  const server=await startFixtureServer(),output=path.resolve('docs/verification/illustrated/ui');
  await fs.mkdir(output,{recursive:true});
  let browser,page;
  const errors=[],network=[];
  try {
    let executablePath=process.env.MUSEDOCK_QA_BROWSER;
    for(const candidate of ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']){
      if(!executablePath&&await fs.access(candidate).then(()=>true,()=>false))executablePath=candidate;
    }
    browser=await chromium.launch({executablePath,headless:true});
    page=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-CN'});
    page.setDefaultTimeout(20000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(response.status()>=400)network.push({path:new URL(response.url()).pathname,status:response.status()});});
    await page.route('**/*',route=>new URL(route.request().url()).origin===server.origin?route.continue():route.abort());
    const confirm=async title=>{
      const dialog=page.getByRole('dialog',{name:title,exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'确认',exact:true}).click();await dialog.waitFor({state:'hidden'});
    };
    await page.goto(server.origin+'/creative');
    await page.getByRole('tab',{name:'旁白配图视频',exact:true}).click();
    await page.getByLabel('旁白配图主题',{exact:true}).fill('清晨的城市，用图片讲述一个温柔的早晨。');
    await page.getByRole('button',{name:'15 秒',exact:true}).click();
    await page.getByRole('combobox',{name:'配音',exact:true}).click();await page.getByRole('option',{name:'关闭 · 使用计划时间轴',exact:true}).click();
    await page.getByLabel('自定义画面要求',{exact:true}).fill('自然的光线，主体保持完整。');
    await page.getByRole('combobox',{name:'生图风格',exact:true}).click();await page.getByRole('option',{name:'电影纪实',exact:true}).click();
    assert.equal(await page.getByLabel('自定义画面要求',{exact:true}).inputValue(),'自然的光线，主体保持完整。');
    await page.screenshot({path:path.join(output,'01-create-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'390px 新建表单不应横向溢出');
    await page.screenshot({path:path.join(output,'01-create-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'创建旁白配图任务',exact:true}).click();
    await page.waitForURL(/\/creative\/\d+/);
    const workflowId=page.url().split('/').at(-1);
    await page.getByRole('button',{name:'确认当前文稿与制作方案',exact:true}).waitFor();
    await page.screenshot({path:path.join(output,'02-plan-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'查看与编辑',exact:true}).first().click();
    const planEditor=page.getByRole('dialog',{name:'编辑分镜：窗边',exact:true});
    await planEditor.getByLabel('分镜文稿',{exact:true}).evaluate(input=>{input.focus();input.setSelectionRange(4,4);});
    await planEditor.getByRole('button',{name:'在光标处拆分',exact:true}).click();
    await planEditor.getByRole('button',{name:'与下一幕合并',exact:true}).click();
    await planEditor.getByRole('button',{name:'返回分镜列表',exact:true}).click();
    await page.getByRole('button',{name:'下移 窗边',exact:true}).click();await page.getByRole('button',{name:'上移 窗边',exact:true}).click();
    await page.getByRole('button',{name:'保存文稿与分镜',exact:true}).click();
    await page.getByRole('button',{name:'确认当前文稿与制作方案',exact:true}).click();await confirm('确认内容与制作方案');
    await page.getByRole('button',{name:'建立无配音时间轴',exact:true}).click();
    await page.getByText('计划分配（无配音）',{exact:false}).waitFor();
    await page.getByRole('button',{name:'补齐缺失配图（3）',exact:true}).click();await confirm('生成全部缺失配图');
    await page.getByRole('button',{name:'确认当前全部选图',exact:true}).waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='确认当前全部选图'&&!button.disabled));
    assert.equal(server.counts.image,3);assert.equal(server.counts.tts,0);
    await page.getByRole('button',{name:'候选与运动详情',exact:true}).first().click();
    const sceneDialog=page.getByRole('dialog',{name:'窗边 · 图片与运动',exact:true});
    await sceneDialog.locator('input[type="file"]').setInputFiles(server.imagePath);
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='选择这张'&&!button.disabled));
    await sceneDialog.getByRole('button',{name:'选择这张',exact:true}).first().click();
    await sceneDialog.getByRole('button',{name:'向上平移',exact:true}).click();
    await sceneDialog.getByRole('button',{name:'保存并回读运动',exact:true}).click();
    await sceneDialog.getByRole('button',{name:'生成运动片段',exact:true}).click();
    await sceneDialog.getByLabel('当前画面运动片段',{exact:true}).waitFor({timeout:90000});
    await sceneDialog.getByLabel('当前画面运动片段',{exact:true}).evaluate(video=>video.play());
    await page.waitForFunction(()=>document.querySelector('video[aria-label="当前画面运动片段"]')?.currentTime>0.15);
    await sceneDialog.getByLabel('当前画面运动片段',{exact:true}).evaluate(video=>video.pause());
    await page.screenshot({path:path.join(output,'07-motion-detail.png'),fullPage:true});
    await page.keyboard.press('Escape');await sceneDialog.waitFor({state:'hidden'});
    assert.equal(server.counts.image,3,'上传、选图和运动保存不能触发生图');
    await page.screenshot({path:path.join(output,'03-media-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(output,'03-media-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'确认当前全部选图',exact:true}).click();await confirm('确认当前选图');
    await page.getByRole('button',{name:'生成当前动态预览',exact:true}).click();
    await page.getByLabel('整片动态预览',{exact:true}).waitFor({timeout:90000});
    await page.waitForFunction(()=>document.querySelector('video[aria-label=\"整片动态预览\"]')?.readyState>=2);
    await page.getByLabel('整片动态预览',{exact:true}).evaluate(video=>video.play());
    await page.waitForFunction(()=>document.querySelector('video[aria-label=\"整片动态预览\"]')?.currentTime>0.3);
    await page.getByLabel('整片动态预览',{exact:true}).evaluate(video=>video.pause());
    assert.equal(await page.getByText('任务已启动，可在当前页面查看进度。',{exact:true}).count(),0,'后台完成后应清除旧启动反馈');
    await page.screenshot({path:path.join(output,'04-preview-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(output,'04-preview-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'已观看，确认并导出',exact:true}).click();await confirm('确认预览并导出');
    await page.getByRole('link',{name:'下载 MP4',exact:true}).waitFor();
    const download=await page.getByRole('link',{name:'下载 MP4',exact:true}).getAttribute('href');
    assert.equal((await page.request.get(server.origin+download)).status(),200);
    await page.reload();await page.getByRole('link',{name:'下载 MP4',exact:true}).waitFor();
    // 当前区域保存在本地，刷新后仍为导出区域。
    assert.equal(await page.getByRole('tab',{name:'预览与导出',exact:true}).getAttribute('data-state'),'active');
    await page.getByRole('tab',{name:'文稿与分镜',exact:true}).click();
    await page.getByRole('button',{name:'查看与编辑',exact:true}).first().click();
    const editor=page.getByRole('dialog',{name:'编辑分镜：窗边',exact:true});
    await editor.getByLabel('图片提示词',{exact:true}).fill('窗边植物与金色晨光，主体完整，桌面干净。');
    await editor.getByRole('button',{name:'返回分镜列表',exact:true}).click();
    await page.getByRole('button',{name:'开启新创作',exact:true}).click();
    await page.getByRole('dialog',{name:'放弃未保存修改并离开',exact:true}).waitFor();
    await page.getByRole('dialog',{name:'放弃未保存修改并离开',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
    await page.getByRole('button',{name:'保存文稿与分镜',exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.includes('保存文稿与分镜')&&button.disabled));
    assert.equal(server.counts.image,3,'保存提示词不能生图');
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'390px 页面不应横向溢出');
    await page.screenshot({path:path.join(output,'05-plan-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'制作设置',exact:true}).click();
    const settings=page.getByRole('dialog',{name:'本任务制作设置',exact:true});await settings.waitFor();
    const box=await settings.boundingBox();assert(box.x>=0&&box.x+box.width<=390&&box.height<=844);
    await settings.getByLabel('字幕字号',{exact:true}).fill('72');
    const titleBox=await settings.getByRole('heading',{name:'本任务制作设置',exact:true}).boundingBox();
    const saveBox=await settings.getByRole('button',{name:'保存并回读制作设置',exact:true}).boundingBox();
    assert(titleBox.y>=box.y&&saveBox.y+saveBox.height<=box.y+box.height,'滚动设置正文时标题与保存按钮应固定可见');
    await page.screenshot({path:path.join(output,'06-settings-mobile.png'),fullPage:true});
    await settings.getByRole('button',{name:'保存并回读制作设置',exact:true}).click();await settings.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'制作设置',exact:true}).focus();await page.keyboard.press('Enter');
    await settings.waitFor();await page.keyboard.press('Escape');await settings.waitFor({state:'hidden'});
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '制作设置', { timeout: 3000 });
    assert(await page.getByRole('button',{name:'制作设置',exact:true}).evaluate(element=>element===document.activeElement),'关闭弹窗应回到触发按钮');
    assert.deepEqual(errors,[],'浏览器不应出现运行时错误');
    assert.deepEqual(network,[],'正常流程不应产生失败请求');
    await page.getByRole('button',{name:'制作设置',exact:true}).click();await settings.waitFor();
    await settings.getByLabel('字幕字号',{exact:true}).fill('76');
    let failReadback=true;
    await page.route('**/api/creative-workflows/'+workflowId,route=>{
      if(failReadback&&route.request().method()==='GET'){failReadback=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,message:'回读失败测试'})});}
      return route.continue();
    });
    await settings.getByRole('button',{name:'保存并回读制作设置',exact:true}).click();
    await settings.getByText('服务器已接收操作，但回读失败。请刷新检查当前版本，避免重复提交。',{exact:true}).waitFor();
    assert.equal(await settings.getByRole('button',{name:'保存并回读制作设置',exact:true}).isDisabled(),true,'回读失败后应阻止重复保存');
    await settings.getByRole('button',{name:'刷新检查已保存版本',exact:true}).click();await settings.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'制作设置',exact:true}).click();await settings.waitFor();
    assert.equal(await settings.getByLabel('字幕字号',{exact:true}).inputValue(),'76');
    await page.keyboard.press('Escape');await settings.waitFor({state:'hidden'});
    assert.equal(network.filter(item=>item.status===503).length,1,'仅包含故意注入的单次回读故障');
    assert.deepEqual(errors,[],'故障恢复后同样不应产生运行时异常');
    const report={success:true,realProviderCalls:0,modelFixtureCalls:server.counts,workflowId,
      checks:['三模式入口','输入与风格补充','分镜拆分合并与排序保存','真实图片上传与候选切换','单张运动保存与实际播放','HTTP/SSE 待审核','无 TTS 路径','图片批次与审核','真实 MP4 动态播放','导出与下载',
        '刷新恢复所在区域','未保存导航保护','提示词保存不生图','390px 页面及弹窗','键盘打开/Esc/焦点返回','长表单固定标题与保存栏','启动反馈随终态清除','保存回读失败不误报成功并可恢复','无浏览器运行时异常']};
    await fs.writeFile(path.join(output,'ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
  finally{await browser?.close();await server.close();}
}
main().catch(error=>{console.error(error.message);console.error(error.stack);process.exitCode=1;});
