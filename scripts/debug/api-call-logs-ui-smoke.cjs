// 真实前端与业务路由，隔离存储、模型 HTTP 替身；不调用真实供应商。
const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright-core');
const workflows = require('../../server/services/creative/creativeWorkflows');
const workflowRouter = require('../../server/routes/creativeWorkflows');
const logsRouter = require('../../server/routes/apiCallLogs');
const { createCreativeTaskRegistry } = require('../../server/services/creative/creativeTaskRegistry');
const { createApiCallStore } = require('../../server/services/diagnostics/apiCallStore');
const { apiCallContextMiddleware, flushApiCallRecords } = require('../../server/services/diagnostics/apiCallRecorder');
const { seedWhiteboardCalls } = require('../../tests/test-api-call-logs');

async function main() {
  const projectRoot = path.resolve(__dirname, '../..');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-api-call-ui-'));
  const screenshots = path.join(projectRoot, '.codex-runtime', 'api-call-logs-qa');
  await fs.mkdir(screenshots, { recursive: true });
  const store = createApiCallStore({ directory: path.join(root, 'logs') });
  let server;
  let browser;
  try {
    const seeded = await seedWhiteboardCalls(store, path.join(root, 'workflows'));
    const app = express();
    app.locals.apiCallStore = store;
    app.locals.creativeTaskRegistry = createCreativeTaskRegistry();
    app.locals.creativeWorkflows = {
      getCreativeWorkflow: id => workflows.getCreativeWorkflow(id, seeded.options),
      listCreativeWorkflowRecords: () => workflows.listCreativeWorkflowRecords(seeded.options),
    };
    app.use(express.json());
    app.use('/api', apiCallContextMiddleware);
    app.get('/api/config/app-settings', (_req, res) => res.json({ success: true, data: { creativeDefaults: { useResearch: false } } }));
    app.use('/api/creative-workflows', workflowRouter);
    app.use('/api/api-call-logs', logsRouter);
    app.use(express.static(path.join(projectRoot, 'frontend-dist')));
    app.get('*', (_req, res) => res.sendFile(path.join(projectRoot, 'frontend-dist', 'index.html')));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let executablePath = process.env.MUSEDOCK_QA_BROWSER;
    if (!executablePath) {
      for (const candidate of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
        if (await fs.access(candidate).then(() => true, () => false)) { executablePath = candidate; break; }
      }
    }
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/creative/${seeded.failedId}`);
    await page.getByRole('link', { name: '查看 API 返回结果', exact: true }).click();
    await page.getByRole('heading', { name: 'API 调用记录', exact: true }).waitFor();
    await page.getByRole('button', { name: /查看 API 返回详情/ }).first().waitFor();
    assert.equal(await page.getByLabel('创作任务 ID', { exact: true }).inputValue(), seeded.failedId);
    assert.equal(await page.getByRole('button', { name: /查看 API 返回详情/ }).count(), 2);
    await page.screenshot({ path: path.join(screenshots, 'task-records-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: /查看 API 返回详情/ }).first().click();
    const body = page.getByLabel('API 返回正文', { exact: true });
    await body.waitFor();
    assert.match(await body.innerText(), /末尾诊断内容/);
    await page.getByRole('button', { name: '复制返回正文', exact: true }).click();
    let clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clipboard, /末尾诊断内容/);
    assert.doesNotMatch(clipboard, /fixture-secret-key-only/);
    await page.getByRole('button', { name: '复制完整诊断', exact: true }).click();
    clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(JSON.parse(clipboard).workflow_id, seeded.failedId);
    assert.ok(JSON.parse(clipboard).validation.length);
    await page.screenshot({ path: path.join(screenshots, 'response-detail-desktop.png'), fullPage: true });

    await page.evaluate(() => {
      window.qaClipboard = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });
    await page.getByRole('button', { name: '复制返回正文', exact: true }).click();
    clipboard = await page.evaluate(() => window.qaClipboard.readText());
    assert.equal(clipboard.replace(/\r\n/g, '\n'), await body.innerText(), '无 Clipboard API 时应使用选区复制');
    await page.evaluate(() => { delete navigator.clipboard; delete window.qaClipboard; });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '查看全部', exact: true }).click();
    await page.getByRole('combobox', { name: '返回状态', exact: true }).click();
    await page.getByRole('option', { name: '成功', exact: true }).click();
    await page.getByRole('button', { name: /查看 API 返回详情/ }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: /查看 API 返回详情/ }).count(), 1);
    await page.getByRole('button', { name: /查看 API 返回详情/ }).first().click();
    await body.waitFor();
    assert.match(await body.innerText(), /成功方案与返回记录/);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '查看全部', exact: true }).click();
    await page.getByRole('button', { name: /查看 API 返回详情/ }).first().waitFor();
    await page.screenshot({ path: path.join(screenshots, 'all-records-desktop.png'), fullPage: true });

    const listPattern = `${origin}/api/api-call-logs?*`;
    await page.route(listPattern, async route => {
      await new Promise(resolve => setTimeout(resolve, 200));
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '本地记录暂时不可用，请重试。' }) });
    });
    await page.getByRole('button', { name: '刷新记录', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '正在加载记录...', exact: true }).isDisabled(), true);
    await page.getByRole('alert').filter({ hasText: '本地记录暂时不可用' }).waitFor();
    await page.unroute(listPattern);
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.getByRole('button', { name: /查看 API 返回详情/ }).first().waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);

    await page.setViewportSize({ width: 390, height: 844 });
    let size = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(size.scrollWidth <= size.width, '手机记录页面不能溢出视口');
    await page.screenshot({ path: path.join(screenshots, 'all-records-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: /查看 API 返回详情/ }).first().click();
    await body.waitFor();
    const bounds = await page.getByRole('dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845, '手机详情弹窗应在视口内');
    await page.screenshot({ path: path.join(screenshots, 'response-detail-mobile.png'), fullPage: true });
    assert.equal(seeded.providerCalls(), 3, '查看、筛选和复制不应增加模型请求');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ success: true, checks: ['失败任务直达记录', '首次与补正详情', '复制正文', '复制完整诊断',
      'Clipboard API 不可用时复制', '成功记录筛选', '读取失败恢复及 loading', '桌面与手机布局', '查看不重发请求'],
      realProviderCalls: 0, screenshots }, null, 2));
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await flushApiCallRecords();
    store.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('musedock-api-call-ui-'));
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
