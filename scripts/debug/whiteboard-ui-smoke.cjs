// 离线浏览器验收：真实 React 构建 + 真实业务路由 + 隔离磁盘 + 模型替身。
// 先运行 npm run build:frontend，再运行 node scripts/debug/whiteboard-ui-smoke.cjs。
const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright-core');
const workflows = require('../../server/services/creative/creativeWorkflows');
const router = require('../../server/routes/creativeWorkflows');
const { createCreativeTaskRegistry } = require('../../server/services/creative/creativeTaskRegistry');
const { parseSrt } = require('../../server/services/creative/whiteboard/contracts');

async function main() {
  const projectRoot = path.resolve(__dirname, '../..');
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'musedock-whiteboard-browser-'));
  const screenshots = path.join(projectRoot, '.codex-runtime', 'whiteboard-phase0-qa');
  await fs.mkdir(screenshots, { recursive: true });
  let sequence = 0;
  let modelCalls = 0;
  let creationCalls = 0;
  let releaseCreation;
  const creationGate = new Promise(resolve => { releaseCreation = resolve; });
  const requests = [];
  const runtimeErrors = [];
  const media = async () => { throw new Error('浏览器验收不允许调用媒体或真实 provider'); };
  const options = {
    rootDir, mediaRoot: path.join(rootDir, 'media'),
    services: {
      idFactory: () => `20260911100000${String(++sequence).padStart(6, '0')}`,
      aiModelConfig: { getRuntimeConfig: async type => type === 'tts' ? null : { enabled: true, apiKey: 'fixture-placeholder', baseUrl: 'http://fixture.invalid', modelId: 'fixture-text' } },
      fetchImpl: media, agentRuns: new Proxy({}, { get: () => media }),
      aiTextModel: { callTextModel: async request => {
        modelCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 250));
        const { input, revisionRequest } = JSON.parse(request.messages[1].content);
        const lines = [
          revisionRequest ? '面对一件大事，先找一个两分钟就能完成的动作。' : '你打开文档，准备做一件重要的事，却又拿起手机。并不是你不知道它重要，而是任务太大，开始的那一步还不够清楚。',
          '试着把“写完一篇文章”，换成“先写一个标题”。把“整理整个房间”，换成“先清理桌面的一角”。任务越具体，开始的阻力就越小。',
          '给自己两分钟，只做这一个动作。先不追求质量，也不要求马上完成全部。一个看得见的小进展，会帮助你找到接下来的方向。',
          '现在，写下你一直拖着的那件事。再在旁边写下：接下来的两分钟，我具体能做什么？从这个动作开始。',
        ];
        const cues = input.inputMode === 'srt' ? parseSrt(input.content).map(({ id, text }) => ({ id, text }))
          : input.inputMode === 'text' ? [{ id: 'cue_1', text: input.content }]
            : lines.map((text, index) => ({ id: `cue_${index + 1}`, text }));
        return { success: true, text: JSON.stringify({
          schemaVersion: 1, title: revisionRequest ? '从两分钟的小动作开始' : '先做两分钟，让任务动起来',
          summary: '用日常场景解释开始行动的阻力，再给出拆小任务、限定两分钟和立即行动的方法。',
          cues, scenes: cues.map((cue, index) => ({
            id: `scene_${index + 1}`, title: ['找到开始的阻力', '把任务变具体', '先行动两分钟', '写下下一个动作'][index] || `分镜 ${index + 1}`,
            cueIds: [cue.id], imagePrompt: [
              '暖米黄纸张，左侧一个人在书桌前面对空白文档，右侧独立摆放一部手机；粗黑漫画墨线，主体边界清楚，中间保留纸面留白。',
              '暖米黄纸张，三张彼此分离的小纸条依次写着“标题”“一段话”“完成”，一只手正圈出第一张；粗黑轮廓，少量暖黄点缀。',
              '暖米黄纸张，一个两分钟的计时器与一个正在写下标题的人物分开摆放；使用清晰漫画墨线和克制平涂，背景保持干净留白。',
              '暖米黄纸张，一本打开的笔记本，页面上只有“接下来两分钟”与一条待填写的横线；黑色主轮廓，暖黄色强调笔尖，四周充分留白。',
            ][index] || '暖米黄纸张上，一个人物在书桌前写下行动清单，粗黑线条与简洁留白。',
          })),
        }) };
      } },
    },
  };
  const bound = {
    createCreativeWorkflow: async payload => {
      assert.equal(payload.creationModeId, 'whiteboard-stream-v1');
      creationCalls += 1;
      requests.push(payload);
      await creationGate;
      return workflows.createCreativeWorkflow(payload, options);
    },
    runCreativeWorkflow: (id, params) => workflows.runCreativeWorkflow(id, { ...params, ...options }),
    getCreativeWorkflow: (id, params) => workflows.getCreativeWorkflow(id, { ...params, ...options }),
    listCreativeWorkflowRecords: () => workflows.listCreativeWorkflowRecords(options),
    patchCreativeWorkflowTaskSummary: (id, patch) => workflows.patchCreativeWorkflowTaskSummary(id, patch, options),
    actOnWhiteboardWorkflow: (id, payload) => workflows.actOnWhiteboardWorkflow(id, payload, options),
    getWhiteboardArtifact: (id, attemptId) => workflows.getWhiteboardArtifact(id, attemptId, options),
  };
  const app = express();
  app.use(express.json());
  app.locals.creativeWorkflows = bound;
  app.locals.creativeTaskRegistry = createCreativeTaskRegistry();
  app.get('/api/config/app-settings', (_req, res) => res.json({ success: true, data: { creativeDefaults: { useResearch: false } } }));
  app.use('/api/creative-workflows', router);
  app.use(express.static(path.join(projectRoot, 'frontend-dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(projectRoot, 'frontend-dist', 'index.html')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    let executablePath = process.env.MUSEDOCK_QA_BROWSER;
    if (!executablePath) {
      for (const candidate of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
        if (await fs.access(candidate).then(() => true, () => false)) { executablePath = candidate; break; }
      }
    }
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => runtimeErrors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/creative`);
    const hfTab = page.getByRole('tab', { name: 'HyperFrames 动态视频' });
    const wbTab = page.getByRole('tab', { name: /线稿白板动画/ });
    await page.getByLabel('输入视频方向、抖音链接、微信公众号文章或 GitHub 仓库链接').fill('一场有关咖啡的动态视频');
    await wbTab.click();
    assert.equal(await page.getByRole('button', { name: '横屏 16:9', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '竖屏 9:16', exact: true }).click();
    await page.getByLabel('白板主题内容').fill('用一分钟解释为什么会拖延，以及如何开始行动');
    await hfTab.click();
    assert.equal(await page.locator('#creative-input').inputValue(), '一场有关咖啡的动态视频');
    await wbTab.click();
    assert.match(await page.getByLabel('白板主题内容').inputValue(), /拖延/);
    assert.equal(await page.getByRole('button', { name: '竖屏 9:16', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('tab', { name: '正文', exact: true }).click();
    await page.getByLabel('白板正文内容').fill('这里保留原文内容。');
    await page.getByRole('tab', { name: 'SRT 字幕', exact: true }).click();
    await page.getByLabel('白板SRT 字幕内容').fill('格式错误的字幕');
    assert.equal(await page.getByRole('button', { name: '启动白板创作 Agent', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('#whiteboard-duration').count(), 0);
    await page.getByRole('tab', { name: '正文', exact: true }).click();
    assert.equal(await page.getByLabel('白板正文内容').inputValue(), '这里保留原文内容。');
    await page.getByRole('tab', { name: '主题', exact: true }).click();
    await page.getByRole('combobox', { name: '视觉模板' }).click();
    await page.getByRole('option', { name: '漫画墨线解释', exact: true }).click();
    await page.screenshot({ path: path.join(screenshots, 'homepage-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: '启动白板创作 Agent', exact: true }).click();
    assert.equal(await wbTab.isDisabled(), true);
    assert.equal(await hfTab.isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '横屏 16:9', exact: true }).isDisabled(), true);
    releaseCreation();
    await page.waitForURL(/\/creative\/\d+/);
    await page.getByRole('button', { name: '确认内容与制作方案', exact: true }).waitFor();
    assert.equal(creationCalls, 1);
    assert.equal(requests[0].input.visualStylePreset, 'comic-ink-v1');
    assert.equal(requests[0].input.aspectRatio, '9:16');
    assert.equal(requests[0].assetIds, undefined);
    const taskUrl = page.url();
    await page.screenshot({ path: path.join(screenshots, 'agent-review-desktop.png'), fullPage: true });

    await page.getByLabel('与白板创作 Agent 对话').fill('开头更直接，把第一段压缩成一句话。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('heading', { name: '从两分钟的小动作开始', exact: true }).waitFor();
    await page.getByRole('button', { name: '确认内容与制作方案', exact: true }).waitFor();
    await page.getByRole('button', { name: '调整制作设置', exact: true }).click();
    await page.getByRole('combobox', { name: '画笔显示' }).click();
    await page.getByRole('option', { name: '隐藏画笔', exact: true }).click();
    await page.getByRole('button', { name: '保存为新的待确认版本', exact: true }).click();
    await page.getByText('v3', { exact: true }).waitFor();
    assert.equal(modelCalls, 2);
    await page.getByRole('button', { name: '版本记录', exact: true }).click();
    await page.getByRole('button', { name: '查看方案', exact: true }).last().click();
    await page.getByRole('heading', { name: '第 1 版方案', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').getByRole('button', { name: '确认当前方案', exact: true }).count(), 0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '确认内容与制作方案', exact: true }).click();
    await page.getByRole('button', { name: '确认当前方案', exact: true }).click();
    await page.locator('header').getByText('方案已确认', { exact: true }).waitFor();
    await page.reload();
    await page.locator('header').getByText('方案已确认', { exact: true }).waitFor();
    assert.equal(await page.locator('main .animate-spin').count(), 0);
    await page.getByRole('tab', { name: '制作方案', exact: true }).click();
    await page.getByText('隐藏画笔', { exact: true }).waitFor();
    await page.getByText('1080 × 1920 · 9:16', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(screenshots, 'approved-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '开启新创作', exact: true }).click();
    await wbTab.click();
    assert.equal(await page.getByRole('button', { name: '横屏 16:9', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '竖屏 9:16', exact: true }).click();
    await page.getByLabel('白板主题内容').fill('解释一个生活中的科学现象');
    await page.locator('button[type="submit"]:enabled').waitFor();
    for (const tab of [hfTab, wbTab]) {
      const box = await tab.evaluate(element => ({ height: element.getBoundingClientRect().height, width: element.clientWidth, scrollWidth: element.scrollWidth }));
      assert.ok(box.height >= 44, '移动端模式按钮的点击高度不足 44px');
      assert.ok(box.scrollWidth <= box.width + 1, '移动端模式标签被挤出按钮');
    }
    const overflow = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(overflow.scrollWidth <= overflow.width, `移动端出现横向溢出：${JSON.stringify(overflow)}`);
    await page.screenshot({ path: path.join(screenshots, 'homepage-mobile.png'), fullPage: true });
    await page.goto(taskUrl);
    await page.locator('header').getByText('方案已确认', { exact: true }).waitFor();
    const detailOverflow = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(detailOverflow.scrollWidth <= detailOverflow.width, '移动端任务详情出现横向溢出');
    await page.screenshot({ path: path.join(screenshots, 'agent-mobile.png'), fullPage: true });
    assert.deepEqual(runtimeErrors, []);
    console.log(JSON.stringify({ success: true, modelCalls, creationCalls, realProviderCalls: 0, checks: ['模式与输入草稿隔离', 'SRT 校验', '创建中禁用切换', '真实后台待确认', '修改生成新版本', '制作设置无额外模型请求', '历史只读', '联合批准与刷新恢复', '桌面及390px布局', '无运行时异常'], screenshots }, null, 2));
  } finally {
    releaseCreation();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(rootDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(rootDir).startsWith('musedock-whiteboard-browser-'));
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
