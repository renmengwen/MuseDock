const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright-core');
const workflows = require('../../server/services/creative/creativeWorkflows');
const router = require('../../server/routes/creativeWorkflows');
const { createCreativeTaskRegistry } = require('../../server/services/creative/creativeTaskRegistry');
const { fixture, deferred } = require('../../tests/test-whiteboard-annotation-workflow');
const store = require('../../server/services/creative/whiteboard/mediaStore');

(async () => {
  const ctx = await fixture(2);
  const vision = ctx.options.services.aiTextModel.callTextModel;
  ctx.options.services.aiTextModel.callTextModel = async request => {
    const result = await vision(request);
    const candidate = JSON.parse(result.text);
    candidate.visualGrouping = { mode: 'independent_clusters', reason: '两个独立图形分布在左右两侧，分别按顺序落墨。' };
    candidate.elements[0].region = { x: 120, y: 120, width: 600, height: 600 };
    candidate.elements.push({ ...candidate.elements[0], label: '第二个图形', region: { x: 1000, y: 120, width: 600, height: 600 } });
    return { ...result, text: JSON.stringify(candidate) };
  };
  assert.equal((await ctx.run()).status, 'waiting_approval');
  const calls = [...ctx.calls];
  const app = express(); app.use(express.json());
  let saveGate; let rejectSave = false; let saves = 0; let displayCanvas;
  app.locals.creativeTaskRegistry = createCreativeTaskRegistry();
  app.locals.creativeWorkflows = {
    listCreationModes: workflows.listCreationModes,
    listCreativeWorkflowRecords: () => workflows.listCreativeWorkflowRecords(ctx.options),
    getCreativeWorkflow: async id => {
      const view = await workflows.getCreativeWorkflow(id, ctx.options);
      if (displayCanvas) Object.assign(view.data.whiteboard.media.recipe, displayCanvas);
      return view;
    },
    getWhiteboardMediaFile: (id, fileId) => workflows.getWhiteboardMediaFile(id, fileId, ctx.options),
    actOnWhiteboardWorkflow: async (id, payload) => {
      assert.equal(payload.action, 'save_annotation'); saves += 1;
      if (saveGate) await saveGate.promise;
      if (rejectSave) return { success: false, statusCode: 503, message: '测试：保存失败，请重试。' };
      const result = await workflows.actOnWhiteboardWorkflow(id, payload, ctx.options);
      assert.equal(result.startTask || false, false);
      return result;
    },
    runCreativeWorkflow: () => { throw new Error('禁止触发制作'); },
  };
  app.get('/api/config/app-settings', (_req, res) => res.json({ success: true, data: { creativeDefaults: {} } }));
  app.get('/api/config/ai-models', (_req, res) => res.json({ success: true, data: { providers: {}, active: {} } }));
  app.get('/api/system/health', (_req, res) => res.json({ success: true, data: { status: 'ok', diagnostics: [] } }));
  app.get('/api/creative-workflows/:id/whiteboard/media/:fileId', async (req, res, next) => {
    if (!displayCanvas) return next();
    const record = await ctx.read();
    const file = record.whiteboard.media.artifacts.find(item => item.id === req.params.fileId);
    if (file?.kind !== 'annotation') return next();
    res.json({ ...await store.readData(record, file, ctx.rootDir), canvas: displayCanvas });
  });
  app.use('/api/creative-workflows', router);
  const build = path.resolve('.codex-runtime/annotation-editor-build');
  app.use(express.static(build)); app.get('*', (_req, res) => res.sendFile(path.join(build, 'index.html')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    let executablePath;
    for (const file of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
      if (await fs.access(file).then(() => true, () => false)) { executablePath = file; break; }
    }
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const open = async () => {
      await page.getByRole('tab', { name: '落墨', exact: true }).click();
      await page.getByRole('button', { name: '查看第 1 幕落墨详情', exact: true }).click();
      await page.getByRole('button', { name: '拖动编辑区域', exact: true }).click();
      await page.getByLabel('横坐标', { exact: true }).waitFor();
    };
    const x = page.getByLabel('横坐标', { exact: true });
    const save = page.getByRole('button', { name: '保存编排', exact: true });
    await page.goto(`${origin}/creative/${ctx.id}`); await open();
    assert.equal(await save.isDisabled(), true);
    const drawing = page.locator('svg[aria-label="拖动区域框调整落墨范围"]');
    const bounds = await drawing.boundingBox();
    const originX = bounds.x + 350 / 1920 * bounds.width;
    const originY = bounds.y + 350 / 1080 * bounds.height;
    await page.mouse.move(originX, originY); await page.mouse.down();
    await page.mouse.move(originX + 50, originY + 20, { steps: 5 }); await page.mouse.up();
    assert.ok(Number(await x.inputValue()) > 120, '拖动必须更新原图像素坐标');
    const corner = drawing.locator('g').last().locator('rect').nth(5);
    const cornerBounds = await corner.boundingBox();
    const widthBefore = Number(await page.getByLabel('宽度', { exact: true }).inputValue());
    await page.mouse.move(cornerBounds.x + cornerBounds.width / 2, cornerBounds.y + cornerBounds.height / 2);
    await page.mouse.down(); await page.mouse.move(cornerBounds.x + 35, cornerBounds.y + 25, { steps: 4 }); await page.mouse.up();
    assert.ok(Number(await page.getByLabel('宽度', { exact: true }).inputValue()) > widthBefore, '缩放必须更新宽度');
    await page.getByRole('button', { name: '下移区域 1', exact: true }).click();
    const rows = page.getByRole('list', { name: '落墨顺序' }).getByRole('listitem');
    await page.getByRole('button', { name: '拖动调整区域 1', exact: true }).dragTo(page.getByRole('button', { name: '拖动调整区域 2', exact: true }));
    assert.match(await rows.nth(0).innerText(), /测试主体/);
    await page.getByRole('button', { name: '拖动调整区域 1', exact: true }).dragTo(page.getByRole('button', { name: '拖动调整区域 2', exact: true }));
    assert.match(await rows.nth(0).innerText(), /第二个图形/);
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '有未保存的区域修改' }).waitFor();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    const savedX = Number(await x.inputValue());
    saveGate = deferred(); await save.click();
    await page.getByRole('button', { name: '正在保存并更新预览...', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '关闭详情', exact: true }).isDisabled(), true);
    assert.equal(saves, 1);
    saveGate.resolve(); saveGate = null;
    await page.getByRole('status').filter({ hasText: '已保存编排并更新预览' }).waitFor();
    await page.waitForFunction(() => document.querySelector('input[type="number"]')?.value === '1000');
    let record = await ctx.read();
    let annotation = await store.readData(record, record.whiteboard.media.annotations.scene_1.annotation, ctx.rootDir);
    assert.equal(annotation.elements[0].label, '第二个图形');
    assert.equal(annotation.elements[1].region.x, savedX);
    await page.getByRole('button', { name: '查看已保存预览', exact: true }).click();
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    await page.reload(); await open();
    assert.equal(await x.inputValue(), '1000');
    await x.fill('900'); rejectSave = true; await save.click();
    await page.getByRole('alert').filter({ hasText: '测试：保存失败' }).waitFor();
    assert.equal(await x.inputValue(), '900'); assert.equal(await save.isEnabled(), true);
    rejectSave = false; await save.click();
    await page.getByRole('status').filter({ hasText: '已保存编排并更新预览' }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const box = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
      return box && box.x >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
    });
    const output = path.resolve('.codex-runtime/annotation-editor-mobile.png');
    await page.screenshot({ path: output, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    // 仅改变隔离 fixture 的显示尺寸，检查三种画幅在预览/编辑首屏中的实际边界。
    for (const viewport of [{ width: 1920, height: 910 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const canvas of [{ width: 1440, height: 1080 }, { width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
        displayCanvas = canvas;
        await page.reload();
        await page.getByRole('tab', { name: '落墨', exact: true }).click();
        await page.getByRole('button', { name: '查看第 1 幕落墨详情', exact: true }).click();
        for (const mode of ['preview', 'editor']) {
          if (mode === 'editor') await page.getByRole('button', { name: '拖动编辑区域', exact: true }).click();
          await page.waitForFunction(() => {
            const frame = document.querySelector('[data-fit-canvas]');
            const viewport = document.querySelector('[role="dialog"] [data-scene-viewport]');
            if (!frame || !viewport) return false;
            const box = frame.getBoundingClientRect(); const bounds = viewport.getBoundingClientRect();
            return viewport.scrollTop === 0 && box.height > 50 && box.top >= bounds.top && box.bottom <= bounds.bottom - 2
              && box.left >= bounds.left && box.right <= bounds.right;
          });
          const frame = await page.locator('[data-fit-canvas]').boundingBox();
          assert.ok(Math.abs(frame.width / frame.height - canvas.width / canvas.height) < 0.02, '画布必须等比缩放');
          if (viewport.width === 1920 && canvas.width === 1440) await page.screenshot({ path: path.resolve(`.codex-runtime/annotation-fit-4x3-${mode}.png`) });
        }
      }
    }
    assert.deepEqual([...ctx.calls], calls); assert.deepEqual(errors, []);
    console.log('PASS 浏览器：拖动、缩放、顺序、保存持久化、刷新、错误保留、重复提交保护、关闭提醒；3 种窗口 × 3 种画幅 × 预览/编辑共 18 组首屏完整显示；真实模型调用 0。');
    console.log(output);
  } finally { saveGate?.resolve(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
