// 离线浏览器烟测：先 npm run build:frontend，再设置 RUN_TRANSCRIPTION_UI_SMOKE=1。
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { chromium } = require('playwright-core');
const aiModelConfig = require('../server/services/ai/aiModelConfig');
const { createTranscriptionService } = require('../server/services/transcription/transcriptionTasks');

async function run() {
  if (process.env.RUN_TRANSCRIPTION_UI_SMOKE !== '1') {
    console.log('跳过转写弹框浏览器烟测：需显式设置 RUN_TRANSCRIPTION_UI_SMOKE=1。');
    return;
  }
  const chrome = process.env.CHROME_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].find(file => fs.existsSync(file));
  assert.ok(chrome, '未找到系统 Chrome');
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'musedock-local-asr-ui-'));
  const configPath = path.join(testRoot, 'models.json');
  await aiModelConfig.saveConfig({ providers: {}, active: {} }, { configPath });
  const service = createTranscriptionService({ rootDir: path.join(testRoot, 'tasks'), configPath, env: {} });
  const app = express();
  const jobs = new Map();
  const submissions = [];
  const downloadRequests = [];
  const detailDelays = new Map();
  const detailFailures = new Set();
  let historyFailure = false;
  let historyDelay = 0;
  app.use(express.json());
  app.get('/api/transcriptions/capabilities', async (_req, res) => res.json({ success: true, data: await service.capabilities() }));
  app.get('/api/transcriptions', (_req, res) => {
    if (historyFailure) return res.status(503).json({ message: '历史服务暂时不可用，请稍后重试。' });
    const items = [...jobs.values()].reverse().map(job => ({
      id: job.id, title: job.source.title, source: job.source, status: job.status, stage: job.stage,
      createdAt: job.createdAt, updatedAt: job.updatedAt, autoCorrect: job.autoCorrect,
      hasResult: !!job.result, hasCorrectedText: !!job.result?.correctedText,
    }));
    setTimeout(() => res.json({ success: true, data: { items, skippedCount: 0 } }), historyDelay);
  });
  app.post('/api/transcriptions', (req, res) => {
    submissions.push(req.body);
    const number = submissions.length;
    const id = `fixture-${number}`;
    const timestamp = new Date().toISOString();
    const job = { id, autoCorrect: req.body.autoCorrect, status: 'running', stage: 'starting_asr', progress: 2,
      createdAt: timestamp, updatedAt: timestamp,
      message: '正在启动 FunASR 并加载模型...', source: { title: number === 1 ? '家乡的月光' : '窗前的月光', url: req.body.source }, files: {} };
    jobs.set(id, job);
    res.status(202).json({ success: true, data: job });
    setTimeout(() => {
      job.status = 'succeeded'; job.stage = 'done'; job.progress = 100;
      job.updatedAt = new Date().toISOString();
      job.message = req.body.autoCorrect ? '转写和校订完成，共校订 1 条字幕。' : '转写完成，原始文本和字幕已保存。';
      job.result = { rawText: number === 1 ? '家向的月光。' : '窗钱的月光。', durationMs: 1600, sentenceCount: 1 };
      if (req.body.autoCorrect) { job.result.correctedText = '窗前的月光。'; job.correctionCount = 1; }
      for (const kind of ['rawText', 'rawSrt', ...(req.body.autoCorrect ? ['correctedText', 'correctedSrt', 'corrections'] : [])]) {
        job.files[kind] = { name: `${kind}.${kind.endsWith('Srt') ? 'srt' : 'txt'}`, url: `/api/transcriptions/${id}/files/${kind}` };
      }
    }, number === 2 ? 1400 : 600);
  });
  app.get('/api/transcriptions/:id/files/:kind', (req, res) => {
    downloadRequests.push({ id: req.params.id, kind: req.params.kind });
    const job = jobs.get(req.params.id);
    const text = req.params.kind.startsWith('corrected') ? job.result.correctedText : job.result.rawText;
    res.type('text/plain').send(req.params.kind.endsWith('Srt') ? `1\n00:00:00,100 --> 00:00:00,800\n${text}\n` : text);
  });
  app.get('/api/transcriptions/:id', (req, res) => {
    if (detailFailures.has(req.params.id)) return res.status(503).json({ message: '这条转写暂时无法读取，请重试。' });
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ message: '转写任务不存在或已被清理。' });
    const snapshot = JSON.parse(JSON.stringify(job));
    const delays = detailDelays.get(req.params.id);
    setTimeout(() => res.json({ success: true, data: snapshot }), (Array.isArray(delays) ? delays.shift() : delays) || 0);
  });
  app.get('/api/creative-workflows/modes', (_req, res) => res.json({ success: true, whiteboard: { visualPresets: [{ id: 'warm-paper-minimal-v1', name: '暖纸极简' }] } }));
  app.get('/api/creative-workflows', (_req, res) => res.json({ success: true, data: [] }));
  app.get('/api/config/app-settings', (_req, res) => res.json({ success: true, data: {} }));
  app.get('/api/config/system-health', (_req, res) => res.json({ success: true, data: {} }));
  app.get('/api/config/ai-models', async (_req, res) => res.json({ success: true, ...await aiModelConfig.getPublicConfig({ configPath }) }));
  app.post('/api/config/ai-models', async (req, res) => res.json({ success: true, ...await aiModelConfig.saveConfig(req.body, { configPath }) }));
  app.use(express.static(path.join(__dirname, '../frontend-dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../frontend-dist/index.html')));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1360, height: 960 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const appUrl = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${appUrl}/settings?section=models`);
    const asrSelector = page.getByRole('combobox', { name: 'ASR 转写', exact: true });
    await asrSelector.waitFor();
    await page.getByText('暂无供应商，点击上方添加。', { exact: true }).waitFor();
    assert.match(await asrSelector.innerText(), /FunASR（本地，默认）/);
    assert.equal(await page.getByRole('textbox', { name: 'FunASR 服务地址', exact: true }).inputValue(), aiModelConfig.DEFAULT_FUNASR_BASE_URL);
    await asrSelector.click();
    await page.getByRole('option', { name: 'FunASR（本地，默认）', exact: true }).click();
    await page.getByRole('textbox', { name: 'FunASR 服务地址', exact: true }).fill('http://127.0.0.1:18000/v1');
    await page.getByRole('textbox', { name: 'FunASR Python 路径（可选）', exact: true }).fill('C:/测试环境/python.exe');
    await page.getByRole('textbox', { name: 'FunASR 模型缓存目录（可选）', exact: true }).fill('C:/测试模型');
    await page.getByRole('button', { name: '保存模型配置', exact: true }).click();
    await page.getByText('配置已保存', { exact: true }).waitFor();
    const savedLocal = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepEqual(savedLocal.providers, {});
    assert.equal(savedLocal.active.asr, aiModelConfig.BUILTIN_FUNASR_REF);
    assert.equal(savedLocal.localAsr.baseUrl, 'http://127.0.0.1:18000/v1');
    assert.equal(savedLocal.localAsr.pythonPath, 'C:/测试环境/python.exe');
    assert.equal(savedLocal.localAsr.modelCache, 'C:/测试模型');
    assert.equal(await page.locator('input[type="password"]').count(), 0, '内置 FunASR 不需要填写 API Key');
    await page.reload();
    await page.getByText('配置已加载', { exact: true }).waitFor();
    assert.match(await asrSelector.innerText(), /FunASR（本地，默认）/);
    assert.equal(await page.getByRole('textbox', { name: 'FunASR 服务地址', exact: true }).inputValue(), savedLocal.localAsr.baseUrl);
    assert.equal(await page.getByRole('textbox', { name: 'FunASR Python 路径（可选）', exact: true }).inputValue(), savedLocal.localAsr.pythonPath);
    assert.equal(await page.getByRole('textbox', { name: 'FunASR 模型缓存目录（可选）', exact: true }).inputValue(), savedLocal.localAsr.modelCache);

    // 已保存的云端选择仍可使用，并可直接切回内置模型，供应商配置不受影响。
    await aiModelConfig.saveConfig({ providers: { fixture: {
      name: '测试供应商', apiKey: 'fixture-key-only', baseUrl: 'https://example.invalid/v1',
      models: { asr: { enabled: true, backend: 'mimo', modelId: 'mimo-v2.5-asr' },
        text: { enabled: true, modelId: '离线测试模型' } },
    } }, active: { asr: 'fixture/asr', text: 'fixture/text' } }, { configPath });
    await page.reload();
    await page.getByText('配置已加载', { exact: true }).waitFor();
    assert.match(await asrSelector.innerText(), /mimo-v2.5-asr/);
    await asrSelector.click();
    await page.getByRole('option', { name: 'FunASR（本地，默认）', exact: true }).click();
    await page.getByRole('button', { name: '保存模型配置', exact: true }).click();
    await page.getByText('配置已保存', { exact: true }).waitFor();
    const selectedLocal = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(selectedLocal.active.asr, aiModelConfig.BUILTIN_FUNASR_REF);
    assert.equal(selectedLocal.providers.fixture.apiKey, 'fixture-key-only');
    assert.equal(selectedLocal.localAsr.baseUrl, savedLocal.localAsr.baseUrl);
    assert.equal(selectedLocal.localAsr.pythonPath, savedLocal.localAsr.pythonPath);
    assert.equal(selectedLocal.localAsr.modelCache, savedLocal.localAsr.modelCache);
    assert.equal((await service.capabilities()).asrReady, true);
    await page.screenshot({ path: path.join(os.tmpdir(), 'musedock-local-funasr-settings.png'), fullPage: true });

    await page.goto(`${appUrl}/creative`);
    await page.getByRole('button', { name: '打开抖音转写工具' }).click();
    const dialog = page.getByRole('dialog');
    const historyItem = id => dialog.locator(`[data-transcription-id="${id}"]`);
    await dialog.getByText('还没有转写记录', { exact: true }).waitFor();
    await dialog.getByRole('textbox', { name: '抖音链接或分享文案' }).fill('https://www.douyin.com/video/1234567890');
    await dialog.getByRole('button', { name: '开始转写', exact: true }).click();
    await dialog.getByText('正在启动 FunASR 并加载模型...', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '新建转写', exact: true }).isDisabled(), true);
    await dialog.getByText('转写完成，原始文本和字幕已保存。', { exact: true }).waitFor();
    assert.deepEqual(submissions.map(item => item.autoCorrect), [false]);
    assert.equal(await dialog.getByRole('tab', { name: '校订版' }).isDisabled(), true);
    const downloadEvent = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '下载 SRT' }).click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), 'rawSrt.srt');
    assert.match(fs.readFileSync(await download.path(), 'utf8'), /00:00:00,100 --> 00:00:00,800/);

    await dialog.getByRole('button', { name: '新建转写', exact: true }).click();
    assert.equal(await dialog.getByRole('textbox', { name: '抖音链接或分享文案' }).inputValue(), '');
    await dialog.getByRole('textbox', { name: '抖音链接或分享文案' }).fill('https://www.douyin.com/video/2345678901');
    await dialog.getByRole('combobox', { name: '自动校订' }).click();
    await page.getByRole('option', { name: '是，调用分析模型' }).click();
    await dialog.getByRole('button', { name: '开始转写', exact: true }).click();
    await dialog.getByText('正在启动 FunASR 并加载模型...', { exact: true }).waitFor();
    await historyItem('fixture-1').click();
    await dialog.getByRole('tabpanel').getByText('家向的月光。', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-transcription-id="fixture-2"]')?.textContent.includes('已完成'));
    assert.equal(await dialog.getByRole('tabpanel').innerText(), '家向的月光。', '后台完成不能抢走正在查看的旧记录');
    assert.equal(await dialog.getByRole('button', { name: '新建转写', exact: true }).isEnabled(), true);
    await historyItem('fixture-2').click();
    await dialog.getByText('转写和校订完成，共校订 1 条字幕。', { exact: true }).waitFor();
    assert.deepEqual(submissions.map(item => item.autoCorrect), [false, true]);
    assert.equal(await dialog.getByRole('tab', { name: '校订版' }).getAttribute('aria-selected'), 'true');
    assert.equal(await dialog.getByRole('tabpanel').innerText(), '窗前的月光。');
    await dialog.getByRole('tab', { name: '原始转写' }).click();
    assert.equal(await dialog.getByRole('tabpanel').innerText(), '窗钱的月光。');

    const search = dialog.getByRole('textbox', { name: '搜索转写历史' });
    await search.fill('家乡');
    assert.equal(await dialog.locator('[data-transcription-id]').count(), 1);
    await search.fill('不存在的标题');
    await dialog.getByText('没有找到匹配的转写', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '清除筛选', exact: true }).click();
    assert.equal(await dialog.locator('[data-transcription-id]').count(), 2);
    await dialog.getByRole('combobox', { name: '筛选转写状态' }).click();
    await page.getByRole('option', { name: '进行中', exact: true }).click();
    await dialog.getByText('没有找到匹配的转写', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '清除筛选', exact: true }).click();

    detailDelays.set('fixture-1', 650);
    const staleDetail = page.waitForResponse(response => response.url().endsWith('/api/transcriptions/fixture-1'));
    await historyItem('fixture-1').click();
    await dialog.getByText('正在加载这条转写...', { exact: true }).waitFor();
    await historyItem('fixture-2').click();
    await dialog.getByRole('tabpanel').getByText('窗前的月光。', { exact: true }).waitFor();
    await staleDetail;
    assert.equal(await historyItem('fixture-2').getAttribute('aria-pressed'), 'true', '迟到的历史响应不能覆盖新选择');
    assert.equal(await dialog.getByRole('tabpanel').innerText(), '窗前的月光。');
    detailDelays.clear();

    detailFailures.add('fixture-1');
    await historyItem('fixture-1').click();
    await dialog.getByText('这条转写暂时无法读取，请重试。', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('tabpanel').count(), 0, '读取失败时不能把旧结果当作当前结果');
    detailFailures.clear();
    await dialog.getByRole('button', { name: '重新加载这条转写', exact: true }).click();
    await dialog.getByRole('tabpanel').getByText('家向的月光。', { exact: true }).waitFor();
    const oldDownloadEvent = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '下载 SRT' }).click();
    const oldDownload = await oldDownloadEvent;
    assert.deepEqual(downloadRequests.at(-1), { id: 'fixture-1', kind: 'rawSrt' });
    assert.match(fs.readFileSync(await oldDownload.path(), 'utf8'), /家向的月光/);

    historyFailure = true;
    await dialog.getByRole('button', { name: '刷新转写历史', exact: true }).click();
    await dialog.getByText('历史服务暂时不可用，请稍后重试。', { exact: true }).waitFor();
    assert.equal(await dialog.locator('[data-transcription-id]').count(), 2);
    historyFailure = false;
    await dialog.getByRole('button', { name: '重新加载历史', exact: true }).click();
    await dialog.getByText('历史服务暂时不可用，请稍后重试。', { exact: true }).waitFor({ state: 'hidden' });

    // 同一弹框重新打开时，初始恢复不得覆盖用户已经点选的记录。
    await historyItem('fixture-2').click();
    await dialog.getByRole('tabpanel').getByText('窗前的月光。', { exact: true }).waitFor();
    historyDelay = 650;
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    const staleHistory = page.waitForResponse(response => response.url().endsWith('/api/transcriptions'));
    await page.getByRole('button', { name: '打开抖音转写工具' }).click();
    await historyItem('fixture-1').click();
    await dialog.getByRole('tabpanel').getByText('家向的月光。', { exact: true }).waitFor();
    await staleHistory;
    assert.equal(await historyItem('fixture-1').getAttribute('aria-pressed'), 'true');
    historyDelay = 0;
    await page.screenshot({ path: path.join(os.tmpdir(), 'musedock-transcription-desktop.png'), fullPage: true });

    await page.reload();
    await page.getByRole('button', { name: '打开抖音转写工具' }).click();
    await dialog.getByRole('tabpanel').getByText('家向的月光。', { exact: true }).waitFor();
    assert.equal(submissions.length, 2, '刷新页面应恢复结果，不能重复提交');
    assert.equal(await historyItem('fixture-1').getAttribute('aria-pressed'), 'true', '刷新应恢复用户选中的旧记录');
    await page.evaluate(() => localStorage.setItem('musedock.transcription.last-task', 'missing-task'));
    await page.reload();
    await page.getByRole('button', { name: '打开抖音转写工具' }).click();
    await dialog.getByRole('tabpanel').getByText('窗前的月光。', { exact: true }).waitFor();
    assert.equal(await dialog.locator('[data-transcription-id]').count(), 2, '没有有效浏览器记录也应从后端找回全部历史');
    assert.equal(submissions.length, 2);

    // 详情慢请求先读到 running，后台轮询随后读到 succeeded；慢响应不能把已完成状态回退。
    const retrying = jobs.get('fixture-2');
    Object.assign(retrying, { status: 'running', updatedAt: new Date().toISOString(), message: '正在重新校订...' });
    await dialog.getByRole('button', { name: '刷新转写历史', exact: true }).click();
    await historyItem('fixture-2').getByText('进行中', { exact: true }).waitFor();
    detailDelays.set('fixture-2', [1200, 0]);
    const staleRunning = page.waitForResponse(async response => response.url().endsWith('/api/transcriptions/fixture-2')
      && (await response.json()).data.status === 'running');
    await historyItem('fixture-2').click();
    await dialog.getByText('正在加载这条转写...', { exact: true }).waitFor();
    Object.assign(retrying, { status: 'succeeded', updatedAt: new Date().toISOString(), message: '转写和校订完成，共校订 1 条字幕。' });
    await staleRunning;
    await dialog.getByText('正在加载这条转写...', { exact: true }).waitFor({ state: 'hidden' });
    await dialog.getByText('转写和校订完成，共校订 1 条字幕。', { exact: true }).waitFor();
    assert.equal(await dialog.getByText('正在重新校订...', { exact: true }).count(), 0, '慢响应不能把当前详情回退到进行中');
    detailDelays.clear();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const rect = document.querySelector('[role="dialog"]').getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
    });
    const box = await page.getByRole('dialog').boundingBox();
    await page.screenshot({ path: path.join(os.tmpdir(), 'musedock-transcription-mobile.png'), fullPage: true });
    if (!(box.x >= 0 && box.x + box.width <= 391)) {
      console.log(JSON.stringify(await page.getByRole('dialog').evaluate(element => {
        const style = getComputedStyle(element);
        return { rect: element.getBoundingClientRect().toJSON(), width: style.width, maxWidth: style.maxWidth,
          left: style.left, transform: style.transform, position: style.position, innerWidth, innerHeight };
      })));
    }
    assert.ok(box.x >= 0 && box.x + box.width <= 391, '窄屏弹框不应溢出视口');
    assert.deepEqual(errors, [], '页面不应发生 JavaScript 异常');
    console.log('浏览器烟测通过：历史检索与切换、并行查看、响应乱序保护、失败重试、旧记录下载、刷新恢复、默认 FunASR 与窄屏布局。');
    console.log(`截图：${path.join(os.tmpdir(), 'musedock-transcription-desktop.png')}`);
    console.log(`截图：${path.join(os.tmpdir(), 'musedock-transcription-mobile.png')}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
