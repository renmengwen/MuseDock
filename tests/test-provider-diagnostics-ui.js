// 离线浏览器验收：先 npm run build:frontend，再设置 RUN_PROVIDER_UI_SMOKE=1。
// 所有供应商响应均为内存 fixture，仅访问本测试启动的本地服务。
const assert = require('assert/strict');
const fs = require('fs/promises');
const { existsSync } = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { chromium } = require('playwright-core');
const aiModelConfig = require('../server/services/ai/aiModelConfig');
const diagnostics = require('../server/services/ai/aiProviderDiagnostics');

async function waitUntil(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, '等待异步事件超时');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function run() {
  if (process.env.RUN_PROVIDER_UI_SMOKE !== '1') {
    console.log('跳过供应商诊断浏览器验收：需设置 RUN_PROVIDER_UI_SMOKE=1。');
    return;
  }
  const chrome = process.env.CHROME_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].find(existsSync);
  assert.ok(chrome, '未找到系统 Chrome');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-provider-ui-'));
  const previews = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-provider-preview-'));
  const configPath = path.join(root, 'models.json');
  const originalConfigMethods = {
    getPublicConfig: aiModelConfig.getPublicConfig,
    saveConfig: aiModelConfig.saveConfig,
    resolveProviderDraft: aiModelConfig.resolveProviderDraft,
  };
  const originalDiagnose = diagnostics.diagnoseProvider;
  let browser;
  let page;
  let server;
  let saves = 0;
  let cancelled = 0;
  let behaviour = 'success';
  let delayMs = 220;
  const upstream = [];
  try {
    await aiModelConfig.saveConfig({ providers: { fixture: { name: '测试供应商', protocol: 'openai-responses',
      apiKey: 'fixture-saved-key', baseUrl: 'https://api.example.invalid/v1',
      models: { text: { enabled: true, modelId: 'existing-text' } } } }, active: { text: 'fixture/text' } }, { configPath });
    const originalFile = await fs.readFile(configPath, 'utf8');
    aiModelConfig.getPublicConfig = () => originalConfigMethods.getPublicConfig({ configPath });
    aiModelConfig.saveConfig = input => { saves += 1; return originalConfigMethods.saveConfig(input, { configPath }); };
    aiModelConfig.resolveProviderDraft = input => originalConfigMethods.resolveProviderDraft(input, { configPath });
    diagnostics.diagnoseProvider = (input, options) => originalDiagnose(input, { ...options, configPath,
      fetchImpl: (url, request) => new Promise((resolve, reject) => {
        const scenario = behaviour;
        upstream.push({ url, headers: request.headers });
        const cancel = () => { clearTimeout(timer); cancelled += 1; reject(request.signal.reason); };
        const timer = setTimeout(() => {
          request.signal.removeEventListener('abort', cancel);
          const status = scenario === 'auth' ? 401 : scenario === 'unsupported' ? 404 : 200;
          const body = status !== 200 ? { error: 'fixture-error' } : { data: scenario === 'empty' ? [] : scenario === 'many'
            ? Array.from({ length: 105 }, (_, index) => ({ id: `fixture-${String(index + 1).padStart(3, '0')}` })) : [
            { id: 'fixture-text', display_name: '测试分析模型' }, { id: 'fixture-image' }, { id: 'namespace/custom-model' }, { id: 'fixture-text' },
          ] };
          resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
        }, delayMs);
        if (request.signal.aborted) cancel();
        else request.signal.addEventListener('abort', cancel, { once: true });
      }),
    });
    const app = express();
    app.use(express.json());
    app.get('/api/creative-workflows/modes', (_req, res) => res.json({ success: true, whiteboard: { visualPresets: [] } }));
    app.get('/api/creative-workflows', (_req, res) => res.json({ success: true, data: [] }));
    app.get('/api/config/app-settings', (_req, res) => res.json({ success: true, data: {} }));
    app.get('/api/config/system-health', (_req, res) => res.json({ success: true, data: {} }));
    app.use('/api/config', require('../server/routes/config'));
    app.use(express.static(path.join(__dirname, '../frontend-dist')));
    app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../frontend-dist/index.html')));
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    // 隔离剪贴板，验证写入的完整 ID，不覆盖用户的系统剪贴板。
    await context.addInitScript(() => {
      window.fixtureClipboard = { value: '', denyWrite: false, denyFallback: false };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async text => {
          if (window.fixtureClipboard.denyWrite) throw new DOMException('fixture-denied', 'NotAllowedError');
          window.fixtureClipboard.value = text;
        },
      } });
      document.execCommand = command => {
        if (command !== 'copy' || window.fixtureClipboard.denyFallback) return false;
        const field = document.activeElement;
        if (!(field instanceof HTMLTextAreaElement) || !field.closest('[role="dialog"]')) return false;
        window.fixtureClipboard.value = field.value.slice(field.selectionStart, field.selectionEnd);
        return true;
      };
    });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(5000);
    await page.goto(`${base}/settings?section=models`);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const probe = () => dialog.getByRole('button', { name: '测试连通性', exact: true });
    const getModels = () => dialog.getByRole('button', { name: '获取模型列表', exact: true });
    const status = text => dialog.getByRole('status').filter({ hasText: text });
    const catalog = () => dialog.getByRole('list', { name: '供应商模型列表' });
    const imageInput = () => dialog.getByRole('textbox', { name: '图片生成 ID', exact: true });
    const textInput = () => dialog.getByRole('textbox', { name: '分析模型 ID', exact: true });
    const copyButton = id => dialog.getByRole('button', { name: `复制模型ID ${id}`, exact: true });
    assert.equal(await dialog.getByLabel('API Key', { exact: true }).inputValue(), '');
    await probe().click();
    const busyProbe = dialog.getByRole('button', { name: '正在检测连通性...', exact: true });
    assert.equal(await busyProbe.isDisabled(), true);
    assert.equal(await getModels().isDisabled(), true);
    await busyProbe.evaluate(button => { button.click(); button.click(); });
    await status('连接成功').waitFor();
    assert.match(await status('连接成功').innerText(), /HTTP 200.*耗时/);
    assert.equal(upstream.length, 1);
    assert.equal(upstream[0].headers.Authorization, 'Bearer fixture-saved-key');
    assert.equal(saves, 0);
    assert.equal(await fs.readFile(configPath, 'utf8'), originalFile);
    console.log('PASS 真实弹窗探针、加载与重复点击保护、空密钥复用、检测不保存');

    await getModels().click();
    assert.equal(await dialog.getByRole('button', { name: '正在获取模型列表...', exact: true }).isDisabled(), true);
    await status('已获取 3 个模型').waitFor();
    assert.equal(await dialog.getByRole('searchbox').count(), 0);
    assert.equal(await dialog.getByRole('combobox', { name: '模型用途' }).count(), 0);
    assert.equal(await dialog.getByPlaceholder('请输入模型id', { exact: true }).count(), 5);
    assert.equal(await catalog().getByRole('listitem').count(), 3);
    assert.equal(await copyButton('fixture-image').innerText(), '复制模型ID');
    await copyButton('fixture-image').click();
    await status('已复制模型ID：fixture-image').waitFor();
    assert.equal(await page.evaluate(() => window.fixtureClipboard.value), 'fixture-image');
    assert.equal(await imageInput().inputValue(), '');
    assert.equal(await imageInput().isDisabled(), true);
    assert.equal(await textInput().inputValue(), 'existing-text');
    await page.evaluate(() => { window.fixtureClipboard.denyWrite = true; });
    await copyButton('namespace/custom-model').click();
    await status('已复制模型ID：namespace/custom-model').waitFor();
    assert.equal(await page.evaluate(() => window.fixtureClipboard.value), 'namespace/custom-model');
    await page.evaluate(() => { window.fixtureClipboard.denyFallback = true; });
    await copyButton('fixture-text').click();
    await status('复制失败').waitFor();
    assert.equal(await copyButton('fixture-text').isEnabled(), true);
    assert.equal(await status('已复制模型ID').count(), 0);
    await page.evaluate(() => { window.fixtureClipboard.denyWrite = false; window.fixtureClipboard.denyFallback = false; });
    behaviour = 'many';
    await getModels().click(); await status('已获取 105 个模型').waitFor();
    assert.equal(await catalog().getByRole('listitem').count(), 105, '移除搜索后仍能访问第 100 个以后的模型');
    await copyButton('fixture-105').click();
    await status('已复制模型ID：fixture-105').waitFor();
    assert.equal(await page.evaluate(() => window.fixtureClipboard.value), 'fixture-105');
    behaviour = 'success';
    await getModels().click(); await status('已获取 3 个模型').waitFor();
    await copyButton('fixture-image').click();
    await status('已复制模型ID：fixture-image').waitFor();
    await page.screenshot({ path: path.join(previews, 'desktop.png') });
    assert.equal(saves, 0);
    console.log('PASS 复制完整模型 ID、备用复制和失败提示，不自动填入；无搜索与用途控件，统一占位提示，长列表可访问');

    await dialog.getByLabel('Base URL', { exact: true }).fill('https://api.example.invalid/custom/v1');
    assert.equal(await catalog().count(), 0);
    assert.equal(await status('连接成功').count(), 0);
    await dialog.getByLabel('Base URL', { exact: true }).fill('https://api.example.invalid/v1');
    assert.equal(await catalog().count(), 0, '地址改回原值也不能复活旧目录');
    assert.equal(await status('连接成功').count(), 0, '地址改回原值也不能复活旧探针结果');
    await dialog.getByLabel('Base URL', { exact: true }).fill('https://api.example.invalid/custom/v1');
    await probe().click();
    await status('连接成功').waitFor();
    assert.equal(upstream.at(-1).url, 'https://api.example.invalid/custom/v1/models');
    behaviour = 'auth';
    await dialog.getByLabel('API Key', { exact: true }).fill('fixture-unsaved-key');
    await probe().click();
    await status('供应商鉴权失败').waitFor();
    assert.match(await status('供应商鉴权失败').innerText(), /HTTP 401/);
    assert.equal(await probe().isEnabled(), true);
    assert.equal(upstream.at(-1).headers.Authorization, 'Bearer fixture-unsaved-key');
    assert.equal(await fs.readFile(configPath, 'utf8'), originalFile);
    behaviour = 'empty';
    await getModels().click(); await status('模型列表为空').waitFor();
    assert.equal(await catalog().count(), 0);
    behaviour = 'unsupported';
    await getModels().click(); await status('未找到模型列表接口').waitFor();
    assert.equal(await getModels().isEnabled(), true);
    console.log('PASS 地址与密钥草稿生效、旧结果清除、鉴权失败及空目录与不支持提示');

    behaviour = 'success'; delayMs = 1200;
    let cancelledBefore = cancelled;
    let requestsBefore = upstream.length;
    await getModels().click();
    await waitUntil(() => upstream.length > requestsBefore);
    await dialog.getByLabel('Base URL', { exact: true }).fill('https://api.example.invalid/changed/v1');
    await waitUntil(() => cancelled > cancelledBefore);
    assert.equal(await catalog().count(), 0);
    assert.equal(await getModels().isEnabled(), true);
    await dialog.getByLabel('Base URL', { exact: true }).fill('https://api.example.invalid/custom/v1');
    assert.equal(await getModels().isEnabled(), true, '改回已取消请求的地址后不能残留加载状态');
    assert.equal(await dialog.getByRole('button', { name: '正在获取模型列表...', exact: true }).count(), 0);
    cancelledBefore = cancelled; requestsBefore = upstream.length;
    await getModels().click();
    await waitUntil(() => upstream.length > requestsBefore);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await waitUntil(() => cancelled > cancelledBefore);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await catalog().count(), 0);
    assert.equal(await dialog.getByLabel('Base URL', { exact: true }).inputValue(), 'https://api.example.invalid/v1');
    assert.equal(await imageInput().inputValue(), '');
    console.log('PASS 编辑连接配置与关闭弹窗取消请求，重新打开不显示过期结果');

    delayMs = 100;
    await page.setViewportSize({ width: 390, height: 844 });
    await getModels().click(); await status('已获取 3 个模型').waitFor();
    await copyButton('fixture-text').click();
    await status('已复制模型ID：fixture-text').waitFor();
    assert.equal(await textInput().inputValue(), 'existing-text');
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 391, '窄屏弹窗不得超出视口');
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, '内容不得横向溢出');
    await page.screenshot({ path: path.join(previews, 'mobile.png') });
    await textInput().fill(await page.evaluate(() => window.fixtureClipboard.value));
    await dialog.getByRole('button', { name: '应用到列表', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(saves, 0);
    await page.getByRole('button', { name: '保存模型配置', exact: true }).click();
    await page.getByText('配置已保存', { exact: true }).waitFor();
    const saved = JSON.parse(await fs.readFile(configPath, 'utf8'));
    assert.equal(saved.providers.fixture.models.text.modelId, 'fixture-text');
    assert.equal(saved.providers.fixture.models.image.modelId, '');
    assert.equal(saved.providers.fixture.models.image.enabled, false);
    assert.equal(saved.providers.fixture.apiKey, 'fixture-saved-key');
    assert.equal(saves, 1);
    console.log('PASS 窄屏复制布局，手动填写并显式保存，密钥及其他配置保留');

    await page.getByRole('button', { name: '添加供应商', exact: true }).click();
    await dialog.getByLabel('供应商名称', { exact: true }).fill('新增测试供应商');
    await dialog.getByLabel('Base URL', { exact: true }).fill('https://new.example.invalid/v1');
    await probe().click(); await status('请先填写 API Key').waitFor();
    await dialog.getByLabel('API Key', { exact: true }).fill('fixture-new-provider-key');
    await getModels().click(); await status('已获取 3 个模型').waitFor();
    assert.equal(saves, 1);
    assert.equal(upstream.at(-1).headers.Authorization, 'Bearer fixture-new-provider-key');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log('PASS 新增供应商可在保存前检测，页面无 JavaScript 异常');
    console.log(`截图：${path.join(previews, 'desktop.png')}`);
    console.log(`截图：${path.join(previews, 'mobile.png')}`);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(previews, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    Object.assign(aiModelConfig, originalConfigMethods);
    diagnostics.diagnoseProvider = originalDiagnose;
    assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    assert.ok(path.basename(root).startsWith('musedock-provider-ui-'));
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
