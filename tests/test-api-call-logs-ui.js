// 运行前先构建前端：npm run build:frontend；设置 RUN_API_CALL_UI_SMOKE=1 后运行本文件。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright-core');

async function run() {
  if (process.env.RUN_API_CALL_UI_SMOKE !== '1') {
    console.log('跳过 API 返回详情浏览器验证；设置 RUN_API_CALL_UI_SMOKE=1 后启用。');
    return;
  }
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .filter(Boolean).find(value => fs.existsSync(value));
  assert.ok(executablePath, '需要安装 Chrome 或设置 CHROME_PATH。');
  const dist = path.resolve(__dirname, '../frontend-dist');
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), '请先运行 npm run build:frontend。');

  const jsonBody = '{"id":7123456789012345678,"ratio":1.2300e+4,"choices":[{"message":{"role":"assistant","content":"字符串直接显示，保留转义符 \\n 和括号 {}[]。"}}],"usage":{"input_tokens":10,"output_tokens":20},"ready":true,"extra":null,"empty":{},"list":[]}';
  const bodies = [jsonBody, '<html>服务暂时不可用</html>', '{"partial":[', 'data: {"text":"已取得部分"}\n\n',
    '1234', '"顶层字符串"', '{}', JSON.stringify({ text: '长'.repeat(100100), after: '已保存的结尾' })];
  const records = bodies.map((body, index) => ({
    id: `fixture-${index + 1}`, sequence: index + 1, created_at: '2026-09-22T02:00:00Z', completed_at: '2026-09-22T02:00:01Z',
    state: 'success', category: 'text', context: {}, method: 'POST', endpoint: 'https://example.invalid/v1/chat/completions',
    model: '本地测试模型', workflow_id: '', operation: '本地页面验证', http_status: 200, duration_ms: 1000,
    response_bytes: Buffer.byteLength(body), response_headers: {}, validation: [], body_text: body,
    body_encoding: index === 4 ? 'base64' : 'utf8', body_truncated: false, transport_status: index === 2 ? 'incomplete' : 'complete',
    request_body_status: index === 0 ? 'captured' : 'unavailable',
    request_body_text: index === 0 ? '{"model":"fixture","instructions":"只返回 JSON","input":[{"role":"user","content":"本地测试输入"}]}' : '',
  }));
  let apiRequests = 0;
  const app = express();
  app.get('/api/api-call-logs', (_request, response) => {
    apiRequests += 1;
    response.json({ records: records.map(({ body_text, request_body_text, ...record }) => record), nextCursor: null });
  });
  app.get('/api/api-call-logs/:id', (request, response) => {
    apiRequests += 1;
    const record = records.find(item => item.id === request.params.id);
    response.status(record ? 200 : 404).json({ record });
  });
  app.use('/api', (_request, response) => response.status(404).json({ message: '未配置的本地测试接口' }));
  app.use(express.static(dist));
  app.get('*', (_request, response) => response.sendFile(path.join(dist, 'index.html')));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'musedock-json-tree-ui-'));
  let browser;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await context.addInitScript(() => {
      window.__apiTestClipboard = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { writeText: async text => { window.__apiTestClipboard = text; } } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/api-calls`);
    const dialog = page.getByRole('dialog');
    const body = page.getByLabel('API 返回正文', { exact: true });
    const openRecord = async sequence => {
      await page.getByRole('button', { name: `查看 API 返回详情 ${sequence}`, exact: true }).click();
      await body.waitFor({ state: 'visible' });
    };
    const closeRecord = async () => {
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    };

    await openRecord(1);
    const requestsBeforeToggle = apiRequests;
    await body.getByRole('button', { name: '展开数组项 0', exact: true }).click();
    await body.getByRole('button', { name: '展开字段 message', exact: true }).click();
    assert.match(await body.textContent(), /字符串直接显示/);
    assert.equal(await body.getByRole('button', { name: /字段 (content|id|ready|extra)$/ }).count(), 0);
    await body.getByRole('button', { name: '折叠根节点', exact: true }).press('Enter');
    await body.getByRole('button', { name: '展开根节点', exact: true }).press('Space');
    await dialog.getByRole('button', { name: '全部折叠', exact: true }).click();
    assert.equal(await body.getByRole('button').count(), 1);
    assert.doesNotMatch(await body.textContent(), /7123456789012345678/);
    await dialog.getByRole('button', { name: '全部展开', exact: true }).click();
    assert.match(await body.textContent(), /7123456789012345678/);
    assert.match(await body.textContent(), /1\.2300e\+4/);
    assert.match(await body.textContent(), /字符串直接显示/);
    await body.getByRole('button', { name: '折叠字段 usage', exact: true }).click();
    assert.doesNotMatch(await body.textContent(), /input_tokens/);
    await dialog.getByRole('button', { name: '全部展开', exact: true }).click();
    assert.match(await body.textContent(), /input_tokens/);
    await dialog.getByRole('button', { name: '复制返回正文', exact: true }).click();
    await dialog.getByText('已复制返回正文。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__apiTestClipboard), jsonBody);
    await dialog.getByRole('button', { name: '复制完整诊断', exact: true }).click();
    await dialog.getByText('已复制完整诊断信息。', { exact: true }).waitFor();
    assert.equal(JSON.parse(await page.evaluate(() => window.__apiTestClipboard)).body_text, jsonBody);
    await dialog.getByText('请求入参（已脱敏）', { exact: true }).click();
    const requestBody = dialog.getByLabel('API 请求入参', { exact: true });
    await requestBody.waitFor({ state: 'visible' });
    assert.match(await requestBody.textContent(), /只返回 JSON/);
    await dialog.getByRole('button', { name: '复制请求入参', exact: true }).click();
    await dialog.getByText('已复制请求入参。', { exact: true }).waitFor();
    assert.equal(JSON.parse(await page.evaluate(() => window.__apiTestClipboard)).input[0].content, '本地测试输入');
    await dialog.getByText('请求入参（已脱敏）', { exact: true }).click();
    assert.equal(apiRequests, requestsBeforeToggle, '展开、折叠和复制不应发起额外 API 请求。');
    await page.screenshot({ path: path.join(screenshots, 'desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const box = document.querySelector('[role="dialog"]').getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight + 1;
    }, null, { timeout: 3000 });
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, '窄屏弹窗应保持在视口内。');
    const expandBounds = await dialog.getByRole('button', { name: '全部展开', exact: true }).boundingBox();
    const collapseBounds = await dialog.getByRole('button', { name: '全部折叠', exact: true }).boundingBox();
    assert.equal(expandBounds.y, collapseBounds.y, '窄屏中的批量操作按钮应保持在同一行。');
    await page.screenshot({ path: path.join(screenshots, 'mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await closeRecord();

    for (const sequence of [2, 3, 4, 5]) {
      await openRecord(sequence);
      assert.equal(await body.evaluate(element => element.tagName), 'PRE');
      assert.equal(await body.textContent(), bodies[sequence - 1]);
      assert.equal(await dialog.getByRole('button', { name: '全部展开', exact: true }).count(), 0);
      await closeRecord();
    }
    for (const sequence of [6, 7]) {
      await openRecord(sequence);
      assert.equal(await body.getByRole('button').count(), 0);
      assert.equal(await body.textContent(), bodies[sequence - 1]);
      await closeRecord();
    }
    await openRecord(8);
    await dialog.getByText('当前仅预览部分正文，复制按钮会复制这条记录中保存的全部正文。', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '复制返回正文', exact: true }).click();
    await dialog.getByText('已复制返回正文。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__apiTestClipboard), bodies[7]);
    await closeRecord();
    await openRecord(1);
    assert.equal(await body.getByRole('button', { name: '折叠根节点', exact: true }).getAttribute('aria-expanded'), 'true');
    assert.deepEqual(errors, [], '页面不应出现 JavaScript 异常。');
    console.log('API 返回详情浏览器验证通过：逐层与全部折叠、键盘操作、原文复制、文本回退、长正文和窄屏布局；真实供应商调用 0 次。');
    console.log(`页面截图：${screenshots}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
