// Real React/HTTP/media player verification against isolated local fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright-core');
const workflows = require('../../server/services/creative/creativeWorkflows');
const config = require('../../server/services/ai/aiModelConfig');
const router = require('../../server/routes/creativeWorkflows');
const { createCreativeTaskRegistry } = require('../../server/services/creative/creativeTaskRegistry');

async function verifySceneTables(page, screenshots, media) {
  const canvas = { width: media.recipe.width, height: media.recipe.height };
  const stages = [
    { id: 'lineart_generation', file: 'image', label: '线稿', slug: 'lineart', download: '下载线稿', filename: 'lineart.png' },
    { id: 'annotation_drafting', file: 'preview', label: '落墨', slug: 'annotation', download: '下载区域编排', filename: 'annotation.json' },
    { id: 'scene_render', file: 'video', label: '单幕', slug: 'scene', download: '下载单幕视频', filename: 'scene.mp4' },
  ];
  const fileUrl = file => {
    const artifact = media.artifacts.find(item => item.id === file?.id);
    assert.ok(artifact, `fixture 缺少产物 ${file?.id}（${file?.name || '未命名'}），无法继续校验。`);
    return artifact.url;
  };
  for (const stage of stages) {
    const expected = media.current[stage.id].scenes;
    await page.getByRole('tab', { name: stage.label, exact: true }).click();
    const table = page.getByRole('table', { name: `${stage.label}分镜列表`, exact: true });
    await table.waitFor();
    assert.equal(await table.getByRole('row').count(), 3, '两幕产物应显示为表格行');
    if (stage.label === '落墨') {
      const summary = await table.getByRole('row').nth(1).locator('td').nth(1).innerText();
      assert.ok(summary.includes(`${expected[0].coverage.regions} 区`), '落墨概览必须显示实际区域数量，不能只显示覆盖率');
    }
    assert.equal(await page.locator('[aria-label="白板媒体产物"] img, [aria-label="白板媒体产物"] video').count(), 0, '列表不能提前挂载大图或视频');
    await page.screenshot({ path: path.join(screenshots, `${stage.slug}-table-desktop.png`), fullPage: true });
    const firstButton = table.getByRole('button', { name: `查看第 1 幕${stage.label}详情`, exact: true });
    await table.getByText('圆形', { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: `${stage.label}详情 · 1. 圆形`, exact: true }).waitFor();
    assert.equal(await dialog.locator('img, video').getAttribute('src'), fileUrl(expected[0][stage.file]), '详情必须绑定所选分镜文件');
    if (stage.label === '落墨' && expected[0].visualGrouping?.reason) {
      await dialog.getByText(expected[0].visualGrouping.reason, { exact: false }).waitFor();
    }
    if (stage.label === '单幕') {
      await page.waitForFunction(() => document.querySelector('[role="dialog"] video')?.readyState >= 2);
      const duration = await dialog.locator('video').evaluate(async element => { await element.play(); element.pause(); return element.duration; });
      assert.ok(Math.abs(duration - expected[0].validation.durationMs / 1000) < 0.1, '播放时长必须与当前分镜的真实媒体证据一致');
    } else {
      await page.waitForFunction(size => {
        const image = document.querySelector('[role="dialog"] img');
        return image?.complete && image.naturalWidth === size.width && image.naturalHeight === size.height;
      }, canvas);
      assert.equal(await dialog.getByRole('status').count(), 0, '图片加载后必须结束 loading');
    }
    const downloadWait = page.waitForEvent('download');
    await dialog.getByRole('link', { name: stage.download, exact: true }).click();
    const downloaded = await downloadWait;
    assert.equal(downloaded.suggestedFilename(), stage.filename);
    assert.ok((await fs.stat(await downloaded.path())).size > 0);
    await page.screenshot({ path: path.join(screenshots, `${stage.slug}-detail-desktop.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await firstButton.evaluate(element => document.activeElement === element), true, '关闭后焦点应回到对应表格按钮');
    assert.equal(await page.locator('video, [role="dialog"] img').count(), 0, '关闭详情后必须卸载媒体');
    await page.keyboard.press('Enter');
    await dialog.getByRole('heading', { name: `${stage.label}详情 · 1. 圆形`, exact: true }).waitFor();
    await dialog.getByRole('button', { name: '关闭详情', exact: true }).click();
    await table.getByRole('button', { name: `查看第 2 幕${stage.label}详情`, exact: true }).click();
    await dialog.getByRole('heading', { name: `${stage.label}详情 · 2. 方形`, exact: true }).waitFor();
    assert.equal(await dialog.locator('img, video').getAttribute('src'), fileUrl(expected[1][stage.file]), '切换分镜不能保留上一幕文件');
    await dialog.getByRole('button', { name: '关闭详情', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  for (const failure of [{ label: '线稿', selector: 'img', message: '图片读取失败' }, { label: '单幕', selector: 'video', message: '视频读取失败' }]) {
    await page.getByRole('tab', { name: failure.label, exact: true }).click();
    const openDetail = page.getByRole('button', { name: `查看第 1 幕${failure.label}详情`, exact: true });
    await openDetail.click();
    const mediaUrl = new URL(await page.getByRole('dialog').locator(failure.selector).getAttribute('src'), page.url()).href;
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const failRequest = route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'fixture media unavailable' });
    await page.route(mediaUrl, failRequest);
    // A new document avoids reusing decoded media from the browser's memory cache.
    await page.reload();
    await page.getByRole('tab', { name: failure.label, exact: true }).click();
    await openDetail.click();
    await page.getByRole('dialog').getByRole('alert').filter({ hasText: failure.message }).waitFor();
    assert.equal(await page.getByRole('dialog').getByRole('status').count(), 0, '媒体失败后不能一直 loading');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.unroute(mediaUrl, failRequest);
    await page.reload();
  }
  await page.getByRole('tab', { name: '线稿', exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '查看第 1 幕线稿详情', exact: true }).click();
  await page.waitForFunction(size => document.querySelector('[role="dialog"] img')?.naturalWidth === size.width, canvas);
  const previewBox = await page.getByRole('dialog').locator('img').boundingBox();
  assert.ok(Math.abs(previewBox.width / previewBox.height - canvas.width / canvas.height) < 0.02, '图片预览必须保持当前画幅比例');
  const mobileDialog = await page.getByRole('dialog').boundingBox();
  assert.ok(mobileDialog.x >= 0 && mobileDialog.x + mobileDialog.width <= 390, '移动端详情弹窗不能超出屏幕');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(screenshots, 'lineart-detail-mobile.png'), fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(screenshots, 'lineart-table-mobile.png'), fullPage: true });
}

async function main() {
  const root = path.resolve('.codex-runtime');
  const portrait = process.argv.includes('--portrait');
  const candidates = [];
  for (const name of (await fs.readdir(root)).filter(name => name.startsWith('whiteboard-media-test-') && name.startsWith('whiteboard-media-test-portrait-') === portrait)) {
    const file = path.join(root, name, 'result.json');
    try { candidates.push({ file, mtime: (await fs.stat(file)).mtimeMs }); } catch {}
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  assert.ok(candidates.length, `请先运行 node tests/test-whiteboard-media.js${portrait ? ' --portrait' : ''}`);
  const fixture = JSON.parse(await fs.readFile(candidates[0].file, 'utf8'));
  const canvas = fixture.canvas || { width: 1920, height: 1080 };
  const screenshots = path.join(root, portrait ? 'whiteboard-portrait-ui-qa' : 'whiteboard-media-ui-qa');
  await fs.mkdir(screenshots, { recursive: true });
  const configPath = path.join(screenshots, 'fixture-models.json');
  await config.saveConfig({ providers: { doubao: { name: '豆包语音测试', baseUrl: 'https://openspeech.bytedance.com', apiKey: 'fixture-key-only',
    models: { tts: { enabled: true, modelId: 'seed-audio-1.0' } } } }, active: { tts: 'doubao/tts' } }, { configPath });
  const options = { rootDir: fixture.rootDir };
  let emptyScenes = false;
  const app = express(); app.use(express.json());
  app.locals.creativeTaskRegistry = createCreativeTaskRegistry();
  app.locals.creativeWorkflows = {
    listCreationModes: workflows.listCreationModes,
    listCreativeWorkflowRecords: () => workflows.listCreativeWorkflowRecords(options),
    getCreativeWorkflow: async id => {
      const result = await workflows.getCreativeWorkflow(id, options);
      if (emptyScenes && result.success) {
        for (const stage of ['lineart_generation', 'annotation_drafting', 'scene_render']) {
          result.data.whiteboard.media.current[stage].scenes = [];
        }
      }
      return result;
    },
    getWhiteboardArtifact: (id, attempt) => workflows.getWhiteboardArtifact(id, attempt, options),
    getWhiteboardMediaFile: (id, file) => workflows.getWhiteboardMediaFile(id, file, options),
  };
  app.get('/api/config/ai-models', async (_req, res) => res.json(await config.getPublicConfig({ configPath })));
  app.post('/api/config/ai-models', async (req, res) => { await new Promise(resolve => setTimeout(resolve, 200)); res.json(await config.saveConfig(req.body, { configPath })); });
  app.get('/api/config/app-settings', (_req, res) => res.json({ success: true, data: { creativeDefaults: {} } }));
  app.get('/api/system/health', (_req, res) => res.json({ success: true, data: { status: 'ok', diagnostics: [] } }));
  app.use('/api/creative-workflows', router);
  app.use(express.static(path.resolve('frontend-dist')));
  app.get('*', (_req, res) => res.sendFile(path.resolve('frontend-dist/index.html')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    let executablePath = process.env.MUSEDOCK_QA_BROWSER;
    if (!executablePath) for (const file of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
      if (await fs.access(file).then(() => true, () => false)) { executablePath = file; break; }
    }
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', acceptDownloads: true });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/creative/${fixture.workflowId}`);
    await page.getByRole('link', { name: '下载最终视频', exact: true }).waitFor();
    const agentBox = await page.getByRole('region', { name: '白板创作 Agent', exact: true }).boundingBox();
    const resultBox = await page.getByRole('region', { name: '当前白板方案', exact: true }).boundingBox();
    assert.ok(Math.abs(agentBox.height - resultBox.height) < 1 && Math.abs(agentBox.y - resultBox.y) < 1, '桌面双栏必须等高并对齐');
    assert.ok(resultBox.x >= agentBox.x + agentBox.width - 1 && resultBox.width > agentBox.width, '右侧方案区应更宽且有独立边界');
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    const video = await page.locator('video').evaluate(async element => {
      await element.play(); element.pause();
      await new Promise(resolve => { element.addEventListener('seeked', resolve, { once: true }); element.currentTime = 3; });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
      const context = canvas.getContext('2d'); context.drawImage(element, 0, 0, 32, 32);
      const pixel = [...context.getImageData(0, 0, 1, 1).data];
      return { width: element.videoWidth, height: element.videoHeight, duration: element.duration, pixel };
    });
    assert.equal(video.width, canvas.width); assert.equal(video.height, canvas.height); assert.ok(Math.abs(video.duration - 6) < 0.1);
    const videoBox = await page.locator('video').boundingBox();
    assert.ok(Math.abs(videoBox.width / videoBox.height - canvas.width / canvas.height) < 0.02, '成片播放器不能把竖屏拉成横屏');
    assert.ok(video.pixel[0] > 180 && video.pixel[1] > 170 && video.pixel[2] > 150, '浏览器必须实际解码出暖纸画面，不能仅加载黑色播放器元数据');
    const downloadWait = page.waitForEvent('download');
    await page.getByRole('link', { name: '下载最终视频', exact: true }).click();
    const download = await downloadWait;
    assert.equal(download.suggestedFilename(), 'final.mp4');
    assert.ok((await fs.stat(await download.path())).size > 1000);
    await page.screenshot({ path: path.join(screenshots, 'final-desktop.png'), fullPage: true });
    await page.getByRole('tab', { name: '旁白', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('audio')?.readyState >= 1);
    assert.ok(Math.abs(await page.locator('audio').evaluate(element => element.duration) - 6) < 0.1);
    const fixtureView = await workflows.getCreativeWorkflow(fixture.workflowId, options);
    assert.equal(fixtureView.success, true);
    await verifySceneTables(page, screenshots, fixtureView.data.whiteboard.media);
    await page.getByRole('tab', { name: '成片', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(screenshots, 'final-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/settings?section=models`);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('豆包音色与整体表演描述').fill('成年女声，清晰自然，像在向朋友讲故事。');
    await page.getByLabel('豆包语速', { exact: true }).fill('12');
    await page.getByLabel('豆包音量', { exact: true }).fill('-5');
    await page.getByLabel('豆包音高', { exact: true }).fill('2');
    await page.screenshot({ path: path.join(screenshots, 'doubao-settings.png'), fullPage: true });
    await page.getByRole('button', { name: '应用到列表', exact: true }).click();
    const save = page.getByRole('button', { name: '保存模型配置', exact: true });
    await save.click(); assert.equal(await save.isDisabled(), true);
    await page.getByText('配置已保存', { exact: true }).waitFor();
    const stored = await config.getRuntimeConfig('tts', { configPath });
    assert.deepEqual(stored.doubao, { voiceDirection: '成年女声，清晰自然，像在向朋友讲故事。', speechRate: 12, loudnessRate: -5, pitchRate: 2 });
    assert.equal(stored.apiKey, 'fixture-key-only');
    await page.reload();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await page.getByLabel('豆包语速', { exact: true }).inputValue(), '12');
    emptyScenes = true;
    await page.goto(`${origin}/creative/${fixture.workflowId}`);
    for (const label of ['线稿', '落墨', '单幕']) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      await page.getByText(`暂无${label}产物，完成前面的步骤后会显示在这里。`, { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /查看第 .* 幕.*详情/ }).count(), 0, '空数组必须有空态且不能打开旧详情');
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ success: true, providerCalls: 0, checks: ['双栏等高与宽度', '最终视频播放及下载', '完整旁白播放', '三类分镜表格及按需加载', '详情预览与对应文件下载', '键盘打开关闭与焦点恢复', '关闭卸载媒体', '图片及视频失败状态', '空分镜列表', '390px表格及弹窗', '豆包参数保存及刷新', '无运行时异常'], screenshots }));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
