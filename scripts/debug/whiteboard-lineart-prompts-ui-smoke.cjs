// Isolated HTTP + React regression. Every model/media dependency comes from a fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright-core');
const workflows = require('../../server/services/creative/creativeWorkflows');
const router = require('../../server/routes/creativeWorkflows');
const { createCreativeTaskRegistry } = require('../../server/services/creative/creativeTaskRegistry');
const { configureWhiteboardConcurrency } = require('../../server/services/creative/whiteboard/concurrency');
const { fixture, deferred, deadline } = require('../../tests/test-whiteboard-annotation-workflow');

async function main() {
  configureWhiteboardConcurrency({ imageConcurrency: 3, annotationConcurrency: 3, renderConcurrency: 3 });
  const ctx = await fixture(2, { startStage: 'lineart_generation' });
  const buildArg = process.argv.indexOf('--build-dir');
  const build = path.resolve(buildArg >= 0 ? process.argv[buildArg + 1] : 'frontend-dist');
  const output = await fs.mkdtemp(path.resolve('.codex-runtime/whiteboard-lineart-ui-qa-'));
  const requests = [];
  const errors = [];
  let actionGate;
  let rejectSave = false;
  let stageSnapshotOverride = '';
  let running = false;
  let releaseImages;
  let execution;
  const app = express();
  app.use(express.json());
  const registry = createCreativeTaskRegistry();
  registry.activeTaskForWorkflow = () => running ? { status: 'running' } : null;
  app.locals.creativeTaskRegistry = registry;
  app.locals.creativeWorkflows = {
    listCreationModes: workflows.listCreationModes,
    listCreativeWorkflowRecords: () => workflows.listCreativeWorkflowRecords(ctx.options),
    getCreativeWorkflow: id => workflows.getCreativeWorkflow(id, ctx.options),
    getWhiteboardMediaFile: (id, fileId) => workflows.getWhiteboardMediaFile(id, fileId, ctx.options),
    actOnWhiteboardWorkflow: async (id, payload) => {
      requests.push(payload);
      if (actionGate) await actionGate.promise;
      if (rejectSave) return { success: false, statusCode: 503, message: '测试：保存暂时失败，请稍后重试。' };
      const result = await workflows.actOnWhiteboardWorkflow(id, payload, ctx.options);
      assert.equal(result.startTask || false, false, '保存接口不能启动模型任务');
      // 模拟保存返回时同时收到下一阶段快照；详情不能被自动切换页签关闭。
      if (result.success && stageSnapshotOverride) result.workflow.whiteboard.media.stage = stageSnapshotOverride;
      return result;
    },
    runCreativeWorkflow: async () => { throw new Error('界面保存测试禁止启动后台制作'); },
  };
  app.get('/api/config/app-settings', (_req, res) => res.json({ success: true, data: { creativeDefaults: {} } }));
  app.get('/api/config/ai-models', (_req, res) => res.json({ success: true, data: { providers: {}, active: {} } }));
  app.get('/api/system/health', (_req, res) => res.json({ success: true, data: { status: 'ok', diagnostics: [] } }));
  app.use('/api/creative-workflows', router);
  app.use(express.static(build));
  app.get('*', (_req, res) => res.sendFile(path.join(build, 'index.html')));
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const open = async (index = 1) => {
      await page.getByRole('tab', { name: '线稿', exact: true }).click();
      const trigger = page.getByRole('button', { name: `查看第 ${index} 幕线稿详情`, exact: true });
      assert.equal(await trigger.isEnabled(), true);
      await trigger.click();
      await page.getByRole('dialog').waitFor();
    };
    const dialog = page.getByRole('dialog');
    const field = dialog.getByRole('textbox', { name: '线稿提示词', exact: true });
    const save = dialog.getByRole('button', { name: '保存提示词', exact: true });
    const close = dialog.getByRole('button', { name: '关闭详情', exact: true });
    const value = '暖米黄纸面上画一本书和一株植物，线条清晰，画面充分留白。测试编号 scene_1';
    await page.goto(`${origin}/creative/${ctx.id}`);
    await open();
    assert.equal(await dialog.locator('img,video').count(), 0, '等待生成不能挂载空预览');
    assert.match(await field.inputValue(), /测试编号 scene_1/);
    assert.equal(await save.isDisabled(), true, '未修改时不能重复保存');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '查看第 1 幕线稿详情');
    await page.keyboard.press('Enter');
    await field.waitFor();
    await field.fill('短');
    assert.equal(await save.isDisabled(), true);
    await field.fill(value);
    actionGate = deferred();
    stageSnapshotOverride = 'annotation_drafting';
    await save.click();
    await dialog.getByRole('status').filter({ hasText: '正在保存本幕线稿提示词' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '正在保存提示词...', exact: true }).isDisabled(), true);
    assert.equal(await close.isDisabled(), true);
    assert.equal(requests.length, 1, '加载时只提交一次保存请求');
    actionGate.resolve(); actionGate = null;
    await dialog.getByRole('status').filter({ hasText: '已保存，继续制作时会使用新提示词' }).waitFor();
    stageSnapshotOverride = '';
    assert.equal(ctx.imageRequests.length, 0);
    assert.equal((await ctx.read()).whiteboard.media.lineartPrompts.scene_1, value);
    await page.screenshot({ path: path.join(output, 'lineart-prompt-desktop.png'), fullPage: true });
    await close.click();
    await open(2);
    assert.match(await field.inputValue(), /测试编号 scene_2/, '切换分镜不能串用编辑内容');
    await close.click();
    await page.reload(); await open();
    assert.equal(await field.inputValue(), value, '刷新后仍显示保存值');

    const draft = `${value}增加一朵小花。`;
    await field.fill(draft);
    rejectSave = true;
    await save.click();
    await dialog.getByRole('alert').filter({ hasText: '保存暂时失败' }).waitFor();
    assert.equal(await field.inputValue(), draft, '失败保留用户编辑');
    assert.equal(await save.isEnabled(), true, '失败后结束 loading');
    assert.equal((await ctx.read()).whiteboard.media.lineartPrompts.scene_1, value);
    rejectSave = false;

    const latest = (await workflows.getCreativeWorkflow(ctx.id, ctx.options)).data.whiteboard.media.lineartPromptDetails.scene_1;
    const competing = `${value}一只蝴蝶落在植物旁。`;
    assert.equal((await ctx.action('save_lineart_prompt', { sceneId: 'scene_1', imagePrompt: competing,
      revision: '', expectedPromptIdentity: latest.identity })).success, true);
    await save.click();
    await dialog.getByText('本幕提示词已变化，请重新载入已保存内容后再修改。', { exact: true }).waitFor();
    assert.equal(await field.inputValue(), draft);
    await dialog.getByRole('button', { name: '重新载入已保存内容', exact: true }).click();
    assert.equal(await field.inputValue(), competing);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const box = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
      return box && box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
    });
    await page.screenshot({ path: path.join(output, 'lineart-prompt-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bounds = await dialog.boundingBox();
    const layout = await dialog.evaluate(element => {
      const style = getComputedStyle(element);
      return { width: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth, transform: style.transform,
        viewport: innerWidth, classes: element.className };
    });
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845,
      `详情超出屏幕：${JSON.stringify({ bounds, layout })}；截图 ${output}`);
    await close.click();

    const arrived = deferred(); releaseImages = deferred();
    let imageCount = 0;
    ctx.beforeImage = async () => { if (++imageCount === 2) arrived.resolve(); await releaseImages.promise; };
    running = true;
    execution = ctx.run();
    await deadline(arrived.promise);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload(); await open();
    await dialog.getByText(/正在生成.*当前没有可显示的线稿图片/).waitFor();
    const inFlightValue = `${value}使用更简洁的轮廓。`;
    await field.fill(inFlightValue); await save.click();
    await dialog.getByRole('status').filter({ hasText: '本轮结束后会应用修改' }).waitFor();
    assert.equal((await ctx.read()).whiteboard.media.pendingLineartPrompts.scene_1.imagePrompt, inFlightValue);
    releaseImages.resolve();
    assert.equal((await deadline(execution)).status, 'waiting_approval');
    execution = null; running = false;
    assert.equal(ctx.imageRequests.length, 2, '运行中保存不会增加图片请求');
    await close.click();

    ctx.imageFaults.set('scene_1', 'rejected');
    assert.equal((await ctx.action('retry_media')).success, true);
    assert.equal((await ctx.run()).code, 'LINEART_GENERATION_FAILED');
    await page.reload(); await open();
    await dialog.getByText(/生成失败.*当前没有可显示的线稿图片/).waitFor();
    await field.fill(value); await save.click();
    await dialog.getByRole('status').filter({ hasText: '已保存，继续制作时会使用新提示词' }).waitFor();
    assert.equal(await dialog.locator('img,video').count(), 0);
    assert.equal((await ctx.read()).whiteboard.media.lineartPrompts.scene_1, value);
    assert.equal(ctx.imageCalls.get('scene_1'), 2);
    assert.equal(ctx.imageCalls.get('scene_2'), 1);
    assert.deepEqual(errors, []);
    console.log(`PASS 等待/生成中/失败无图详情、HTTP 保存、加载与错误恢复、版本冲突、刷新持久化和 390px 布局；真实模型请求 0。截图：${output}`);
  } finally {
    actionGate?.resolve(); releaseImages?.resolve();
    if (execution) await deadline(execution);
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
