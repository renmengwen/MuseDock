// Real settings UI + config routes, with isolated files and no provider requests.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright-core');
const appSettings = require('../../server/services/appSettings');
const aiModelConfig = require('../../server/services/ai/aiModelConfig');
const { imagePool } = require('../../server/services/creative/whiteboard/imagePool');
const { annotationPool } = require('../../server/services/creative/whiteboard/annotationPool');
const { sceneRenderPool } = require('../../server/services/creative/whiteboard/sceneRenderPool');

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

async function main() {
  const parent = path.resolve('.codex-runtime');
  await fs.mkdir(parent, { recursive: true });
  const output = await fs.mkdtemp(path.join(parent, 'whiteboard-settings-ui-qa-'));
  const buildArg = process.argv.indexOf('--build-dir');
  const build = path.resolve(buildArg >= 0 ? process.argv[buildArg + 1] : 'frontend-dist');
  const options = { configPath: path.join(output, 'app-settings.json'), aiConfigPath: path.join(output, 'ai-models.json'), env: {} };
  const originalRead = appSettings.getPublicConfig;
  const originalSave = appSettings.saveConfig;
  const baseline = await originalSave({ creativeDefaults: { aspectRatio: '16:9', frameHtmlConcurrency: 2 },
    system: { skipValidation: true }, whiteboard: { imageConcurrency: 3, annotationConcurrency: 10, renderConcurrency: 3 } }, options);
  let readGate = deferred();
  let saveGate;
  let saveSeen;
  let failSave = false;
  const requests = [];
  appSettings.getPublicConfig = async () => {
    if (readGate) await readGate.promise;
    return originalRead(options);
  };
  appSettings.saveConfig = async payload => {
    requests.push(structuredClone(payload));
    saveSeen?.resolve();
    if (saveGate) await saveGate.promise;
    if (failSave) throw new Error('测试注入：存储暂时不可用');
    return originalSave(payload, options);
  };
  const router = require('../../server/routes/config');
  const app = express(); app.use(express.json());
  app.get('/api/config/ai-models', async (_req, res) => res.json({ success: true, ...await aiModelConfig.getPublicConfig({ configPath: options.aiConfigPath }) }));
  const health = (_req, res) => res.json({ success: true, data: { environment: { ok: true }, storage: {}, models: {} } });
  app.get('/api/system/health', health); app.get('/api/config/system-health', health);
  app.use('/api/config', router);
  app.use(express.static(build));
  app.get('*', (_req, res) => res.sendFile(path.join(build, 'index.html')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    let executablePath = process.env.MUSEDOCK_QA_BROWSER;
    if (!executablePath) for (const candidate of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
      if (await fs.access(candidate).then(() => true, () => false)) { executablePath = candidate; break; }
    }
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/settings?section=whiteboard`);
    const image = page.getByRole('spinbutton', { name: '生图并发数', exact: true });
    const annotation = page.getByRole('spinbutton', { name: '落墨编排并发数', exact: true });
    const render = page.getByRole('spinbutton', { name: '单幕渲染并发数', exact: true });
    const save = page.getByRole('button', { name: '保存白板设置', exact: true });
    await page.getByRole('heading', { name: '白板动画设置', exact: true }).waitFor();
    assert.equal(await save.isDisabled(), true, '读取完成前不能保存默认值覆盖真实设置');
    readGate.resolve(); readGate = null;
    await page.getByText('设置中心已加载', { exact: true }).waitFor();
    assert.equal(await image.inputValue(), '3');
    assert.equal(await annotation.inputValue(), '10');
    assert.equal(await render.inputValue(), '3');
    await page.screenshot({ path: path.join(output, 'whiteboard-settings-desktop.png'), fullPage: true });

    for (const value of ['0', '11', '2.5', '']) {
      await image.fill(value);
      assert.equal(await image.getAttribute('aria-invalid'), 'true');
      assert.equal(await save.isDisabled(), true);
      await page.getByText('请输入 1–10 之间的整数。', { exact: true }).waitFor();
    }
    await image.fill('10'); await annotation.fill('6'); await render.fill('4');
    saveGate = deferred(); saveSeen = deferred();
    await save.click();
    await saveSeen.promise;
    const saving = page.getByRole('button', { name: '正在保存白板设置...', exact: true });
    assert.equal(await saving.isDisabled(), true);
    assert.equal(await image.isDisabled(), true);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], { whiteboard: { imageConcurrency: 10, annotationConcurrency: 6, renderConcurrency: 4 } });
    saveGate.resolve(); saveGate = null;
    await page.getByText('白板设置已保存', { exact: true }).waitFor();
    let persisted = await originalRead(options);
    assert.deepEqual(persisted.creativeDefaults, baseline.creativeDefaults);
    assert.deepEqual(persisted.system, baseline.system);
    assert.equal(imagePool.concurrency, 10); assert.equal(annotationPool.concurrency, 6); assert.equal(sceneRenderPool.concurrency, 4);
    await page.reload();
    await page.getByText('设置中心已加载', { exact: true }).waitFor();
    assert.equal(await image.inputValue(), '10');
    assert.equal(await annotation.inputValue(), '6');
    assert.equal(await render.inputValue(), '4');
    assert.ok(page.url().includes('section=whiteboard'));

    const navigation = page.getByRole('navigation', { name: '设置中心导航' });
    await navigation.getByRole('button', { name: 'HyperFrames', exact: true }).click();
    await page.getByRole('heading', { name: 'HyperFrames 创作默认值', exact: true }).waitFor();
    await page.getByRole('spinbutton', { name: '帧 HTML 并发上限', exact: true }).fill('4');
    await page.getByRole('button', { name: '保存创作默认值', exact: true }).click();
    await page.getByText('创作默认值已保存', { exact: true }).waitFor();
    persisted = await originalRead(options);
    assert.deepEqual(persisted.whiteboard, { imageConcurrency: 10, annotationConcurrency: 6, renderConcurrency: 4 });
    await navigation.getByRole('button', { name: '总览', exact: true }).click();
    await page.getByRole('button', { name: /白板并发.*生图 10.*落墨 6.*渲染 4/ }).click();
    await page.getByRole('heading', { name: '白板动画设置', exact: true }).waitFor();

    failSave = true;
    await image.fill('8'); await save.click();
    await page.getByText(/白板设置保存失败：/).waitFor();
    assert.equal(await save.isEnabled(), true, '失败后要恢复按钮，供用户重试');
    assert.equal((await originalRead(options)).whiteboard.imageConcurrency, 10);
    failSave = false;
    await save.click();
    await page.getByText('白板设置已保存', { exact: true }).waitFor();
    assert.equal((await originalRead(options)).whiteboard.imageConcurrency, 8);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByText('设置中心已加载', { exact: true }).waitFor();
    assert.equal(await image.inputValue(), '8');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'whiteboard-settings-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ success: true, providerCalls: 0,
      checks: ['独立白板分区与直达链接', '三项并发及整数范围', '加载/保存期间禁用', '局部保存与刷新回读', '调度池即时生效', 'HyperFrames 设置隔离', '总览入口', '失败后重试', '390px 布局', '无运行时异常'], screenshots: output }));
  } finally {
    readGate?.resolve(); saveGate?.resolve();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    appSettings.getPublicConfig = originalRead;
    appSettings.saveConfig = originalSave;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
