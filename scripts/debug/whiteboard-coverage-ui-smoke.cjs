// Isolated HTTP/React checks. Requires the annotation-workflow and coverage-preview fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright-core');
const workflows = require('../../server/services/creative/creativeWorkflows');
const router = require('../../server/routes/creativeWorkflows');
const { createCreativeTaskRegistry } = require('../../server/services/creative/creativeTaskRegistry');

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function latestFixture(root, prefix, filename) {
  const candidates = [];
  for (const name of (await fs.readdir(root)).filter(name => name.startsWith(prefix))) {
    const file = path.join(root, name, filename);
    try { candidates.push({ file, time: (await fs.stat(file)).mtimeMs }); } catch { /* Incomplete fixtures are ignored. */ }
  }
  candidates.sort((a, b) => b.time - a.time);
  assert.ok(candidates.length, `缺少 ${prefix} 测试数据，请先执行对应的定向测试。`);
  return candidates[0].file;
}

async function main() {
  const root = path.resolve('.codex-runtime');
  const buildArg = process.argv.indexOf('--build-dir');
  const build = path.resolve(buildArg >= 0 ? process.argv[buildArg + 1] : 'frontend-dist');
  const fixture = JSON.parse(await fs.readFile(await latestFixture(root, 'whiteboard-annotation-test-', 'review-fixture.json'), 'utf8'));
  const diagnosticFixture = JSON.parse(await fs.readFile(await latestFixture(root, 'whiteboard-annotation-test-', 'diagnostic-fixture.json'), 'utf8'));
  const images = path.dirname(await latestFixture(root, 'whiteboard-coverage-preview-', 'landscape-coverage.json'));
  const output = await fs.mkdtemp(path.join(root, 'whiteboard-coverage-ui-qa-'));
  const requests = [];
  const errors = [];
  let imageGate;
  let actionGate;
  let missingImage = false;
  let staleAction = false;
  let portrait = false;
  let recoveryView;
  let view;
  async function reset(vertical = false) {
    portrait = vertical;
    view = structuredClone(fixture.view);
    view.whiteboard.media.identity = vertical ? 'fixture-portrait-version' : fixture.view.whiteboard.media.identity;
    view.whiteboard.media.lowCoverage[0].coverage = JSON.parse(await fs.readFile(path.join(images, `${vertical ? 'portrait' : 'landscape'}-coverage.json`), 'utf8'));
    if (vertical) {
      Object.assign(view.whiteboard.media.recipe, { width: 1080, height: 1920 });
      view.whiteboard.current.artifact.aspectRatio = '9:16';
      view.input.aspectRatio = '9:16';
    }
  }
  await reset();
  const app = express();
  app.use(express.json());
  app.locals.creativeTaskRegistry = createCreativeTaskRegistry();
  app.locals.creativeWorkflows = {
    listCreationModes: workflows.listCreationModes,
    listCreativeWorkflowRecords: () => workflows.listCreativeWorkflowRecords({ rootDir: fixture.rootDir }),
    getCreativeWorkflow: async () => ({ success: true, data: structuredClone(view) }),
    getWhiteboardMediaFile: async (_id, fileId) => {
      if (imageGate) await imageGate.promise;
      const artifact = view.whiteboard.media.artifacts.find(file => file.id === fileId);
      if (!artifact || missingImage) return { success: false, code: 'ARTIFACT_INVALID', message: '测试图片不可用。' };
      const suffix = artifact.kind === 'annotation_result' ? 'result' : artifact.kind === 'annotation_preview' ? 'annotation' : 'source';
      return { success: true, artifact: { ...artifact, mime: 'image/png' }, file_path: path.join(images, `${portrait ? 'portrait' : 'landscape'}-${suffix}.png`) };
    },
    actOnWhiteboardWorkflow: async (_id, payload) => {
      requests.push(payload);
      if (actionGate) await actionGate.promise;
      if (staleAction) {
        view.whiteboard.media.identity = 'fixture-newer-version';
        return { success: false, code: 'STALE_IDENTITY', message: '预览版本已变化，请检查当前产物。' };
      }
      if (payload.action === 'recover_annotation_preview' && recoveryView) view = structuredClone(recoveryView);
      return { success: true, startTask: false, data: structuredClone(view) };
    },
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
    const url = `${origin}/creative/${view.workflow_id}`;
    const open = () => page.getByRole('button', { name: '查看预览后接受当前落墨', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const accept = dialog.getByRole('button', { name: '接受这 1 幕当前落墨并继续', exact: true });
    const ready = () => page.waitForFunction(() => {
      const images = [...document.querySelectorAll('[role="dialog"] img')];
      return images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0);
    });
    await page.goto(url);
    await page.getByRole('table', { name: '落墨分镜列表', exact: true }).waitFor();
    assert.equal(await page.getByRole('table').getByRole('row').count(), 4, '应按方案顺序保留成功与失败三幕');
    await page.getByText('覆盖不足 · 待确认', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'coverage-list.png'), fullPage: true });
    imageGate = deferred();
    await open();
    assert.equal(await accept.isDisabled(), true, '图像加载前不能确认');
    await dialog.getByRole('status').first().waitFor();
    imageGate.resolve(); imageGate = null;
    await ready();
    assert.equal(await accept.isEnabled(), true);
    assert.deepEqual(await dialog.locator('img').evaluateAll(images => images.map(image => [image.naturalWidth, image.naturalHeight])), [[1920, 1080], [1920, 1080]]);
    await dialog.getByText('原图标注与遗漏（红色墨迹）', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'coverage-desktop.png'), fullPage: true });
    await dialog.getByRole('button', { name: '暂不决定', exact: true }).click();
    assert.equal(requests.length, 0, '查看和关闭不能触发接受或模型请求');

    await page.getByRole('button', { name: '查看第 2 幕落墨详情', exact: true }).click();
    await ready();
    assert.equal(await dialog.locator('img').count(), 2, '失败幕详情也必须显示两张对照图');
    await dialog.getByRole('button', { name: '暂不决定', exact: true }).click();

    await open(); await ready();
    actionGate = deferred();
    const expectedIdentity = view.whiteboard.media.identity;
    await accept.click();
    assert.equal(await accept.isDisabled(), true);
    await dialog.getByRole('status').filter({ hasText: '正在登记接受决定' }).waitFor();
    // The response remains deliberately blocked until the disabled/loading state is verified.
    assert.equal(requests.length, 1);
    assert.equal(requests[0].action, 'accept_low_coverage');
    assert.equal(requests[0].confirmed, true);
    assert.equal(requests[0].expectedMediaIdentity, expectedIdentity);
    actionGate.resolve(); actionGate = null;
    await dialog.waitFor({ state: 'hidden' });

    await reset(true); await page.setViewportSize({ width: 390, height: 844 });
    await page.reload(); await open(); await ready();
    assert.deepEqual(await dialog.locator('img').evaluateAll(images => images.map(image => [image.naturalWidth, image.naturalHeight])), [[1080, 1920], [1080, 1920]]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845);
    await page.screenshot({ path: path.join(output, 'coverage-mobile.png'), fullPage: true });
    await dialog.getByRole('button', { name: '重新编排未通过的幕', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(requests.at(-1).action, 'retry_media');

    missingImage = true;
    await page.reload(); await open();
    await dialog.getByRole('alert').first().waitFor();
    assert.equal(await accept.isDisabled(), true, '加载失败必须禁止接受');
    assert.equal(await dialog.getByRole('status').count(), 0, '失败图片不能一直 loading');
    await dialog.getByRole('button', { name: '暂不决定', exact: true }).click();

    missingImage = false; staleAction = true;
    await reset(); await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload(); await open(); await ready();
    await accept.click();
    await dialog.getByText('预览对应的版本已变化，请关闭后重新查看当前产物。', { exact: true }).waitFor();
    assert.equal(await accept.isDisabled(), true);
    assert.equal(await dialog.getByRole('button', { name: '重新编排未通过的幕', exact: true }).isDisabled(), true);
    await page.screenshot({ path: path.join(output, 'coverage-stale.png'), fullPage: true });

    staleAction = false;
    await reset();
    recoveryView = structuredClone(view);
    const legacyMedia = view.whiteboard.media;
    const legacyEntry = legacyMedia.lowCoverage[0];
    legacyMedia.lowCoverage = [];
    legacyMedia.gate = ''; legacyMedia.interactionId = '';
    view.status = 'failed';
    view.whiteboard.interactions = [];
    view.whiteboard.allowedActions = [{ id: 'recover_annotation_preview' }, { id: 'retry_media' }];
    const legacyAttempt = legacyMedia.attempts.find(item => item.id === legacyEntry.attemptId);
    legacyAttempt.errorCode = 'MEDIA_FAILED';
    legacyAttempt.received = { candidate: legacyAttempt.received.candidate };
    await page.reload();
    const recoveryButton = page.getByRole('button', { name: '恢复第 2 幕落墨预览', exact: true });
    await recoveryButton.waitFor();
    await page.getByText('编排失败', { exact: true }).waitFor();
    assert.equal(await page.getByRole('table').getByText('等待编排', { exact: true }).count(), 0, '已失败的幕不能显示为等待编排');
    const countBeforeRecovery = requests.length;
    actionGate = deferred();
    await recoveryButton.click();
    await page.getByRole('status').filter({ hasText: '正在使用已保存的编排恢复落墨预览' }).waitFor();
    assert.equal(await recoveryButton.isDisabled(), true);
    assert.equal(requests.length, countBeforeRecovery + 1);
    assert.equal(requests.at(-1).action, 'recover_annotation_preview');
    assert.equal(requests.at(-1).sceneId, 'scene_2');
    actionGate.resolve(); actionGate = null;
    await page.getByText('覆盖不足 · 待确认', { exact: true }).waitFor();
    await page.getByRole('button', { name: '查看第 2 幕落墨详情', exact: true }).click();
    await ready();
    assert.equal(await accept.isEnabled(), true);
    await dialog.getByRole('button', { name: '暂不决定', exact: true }).click();
    assert.equal(requests.length, countBeforeRecovery + 1, '恢复和预览不得自动接受或重新请求模型');

    view = structuredClone(diagnosticFixture.view);
    const beforeDetails = requests.length;
    await page.goto(`${origin}/creative/${view.workflow_id}`);
    const failedDetails = page.getByRole('button', { name: '查看第 2 幕落墨详情', exact: true });
    await failedDetails.waitFor();
    assert.equal(await failedDetails.isEnabled(), true, '没有预览的未知请求也必须能查看详情');
    await failedDetails.focus(); await page.keyboard.press('Enter');
    await dialog.getByText('当前没有可显示的落墨预览', { exact: true }).waitFor();
    await dialog.getByText('视觉模型达到输出上限，未返回完整的编排结果。', { exact: true }).waitFor();
    assert.equal(await dialog.locator('img, video').count(), 0, '没有预览时不能加载空媒体地址');
    assert.equal(await dialog.getByRole('status').count(), 0, '未知结果不能显示为正在加载预览');
    assert.equal(await dialog.getByRole('list', { name: '本幕请求记录' }).getByRole('listitem').count(), 1);
    await page.screenshot({ path: path.join(output, 'request-diagnostics-desktop.png'), fullPage: true });
    await dialog.getByRole('button', { name: '关闭详情', exact: true }).click();
    assert.equal(await failedDetails.evaluate(button => document.activeElement === button), true, '关闭详情后恢复键盘焦点');

    // 模拟截图中的旧任务：同一幕两次未知请求，历史没有详细诊断。
    const history = view.whiteboard.media.attempts;
    const currentAttempt = history.findLast(attempt => attempt.stage === 'annotation_drafting' && attempt.sceneId === 'scene_2');
    delete currentAttempt.diagnostics;
    Object.assign(currentAttempt, { createdAt: '2026-09-14T06:23:34.155Z', completedAt: '2026-09-14T06:25:41.452Z' });
    history.splice(history.indexOf(currentAttempt), 0, { ...currentAttempt, id: 'fixture-old-unknown-request',
      createdAt: '2026-09-14T06:13:23.911Z', completedAt: '2026-09-14T06:15:31.029Z' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload(); await failedDetails.click();
    await dialog.getByText('旧记录未保存具体原因，无法判断是超时、输出截断还是其他响应问题。', { exact: true }).first().waitFor();
    assert.equal(await dialog.getByRole('list', { name: '本幕请求记录' }).getByRole('listitem').count(), 2);
    assert.equal(await dialog.locator('img, video').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const requestBounds = await dialog.boundingBox();
    assert.ok(requestBounds.x >= 0 && requestBounds.y >= 0 && requestBounds.x + requestBounds.width <= 391 && requestBounds.y + requestBounds.height <= 845);
    await page.screenshot({ path: path.join(output, 'request-history-mobile.png'), fullPage: true });
    await dialog.getByRole('button', { name: '关闭详情', exact: true }).click();
    assert.equal(requests.length, beforeDetails, '查看新旧请求详情不能触发重试、恢复或授权');

    portrait = true;
    Object.assign(view.whiteboard.media.recipe, { width: 1080, height: 1920 });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.getByRole('button', { name: '查看第 1 幕落墨详情', exact: true }).click();
    await dialog.getByText('查看本幕请求记录', { exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] img')].every(image => image.complete && image.naturalWidth > 0));
    const portraitImage = await dialog.locator('img').boundingBox();
    const portraitHistory = await dialog.getByRole('list', { name: '本幕请求记录' }).boundingBox();
    assert.ok(portraitHistory.y >= portraitImage.y + portraitImage.height, '竖屏预览展开历史后，图片不能覆盖请求记录');
    await page.screenshot({ path: path.join(output, 'portrait-preview-request-history.png'), fullPage: true });
    await dialog.getByRole('button', { name: '关闭详情', exact: true }).click();
    assert.equal(requests.length, beforeDetails);
    view.whiteboard.media.stage = 'scene_render';
    view.whiteboard.media.sceneRenderProgress = { scenes: [
      { sceneId: 'scene_1', phase: 'drawing', writtenFrames: 30, totalFrames: 60 },
      { sceneId: 'scene_2', phase: 'encoding', writtenFrames: 60, totalFrames: 60 },
      { sceneId: 'scene_3', phase: 'failed', writtenFrames: 10, totalFrames: 60, errorCode: 'MEDIA_TIMEOUT' },
    ] };
    view.whiteboard.media.attempts.push({ id: 'fixture-render-timeout', stage: 'scene_render', sceneId: 'scene_3', status: 'failed', errorCode: 'MEDIA_TIMEOUT' });
    await page.reload();
    const renderTable = page.getByRole('table', { name: '单幕分镜列表', exact: true });
    await renderTable.getByText('正在绘制 · 30/60 帧', { exact: true }).waitFor();
    await renderTable.getByText('正在编码 · 60/60 帧', { exact: true }).waitFor();
    await renderTable.getByText('渲染超时 · 可重试', { exact: true }).waitFor();
    assert.equal(await renderTable.getByRole('row').count(), 4, '单幕未全部完成时也要显示每幕进度');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'scene-render-progress-mobile.png'), fullPage: true });
    assert.equal(requests.length, beforeDetails);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ success: true, providerCalls: 0,
      checks: ['失败幕与成功幕并存', '待确认行直接进入处理', '旧失败任务恢复预览', '双图与覆盖率', '加载完成前禁止确认', '关闭无副作用', '确认版本与重复点击保护', '竖屏和390px布局', '重新编排', '缺图禁用', '过期确认拒绝', '无预览仍可查看原因', '旧请求历史与移动端布局', '竖屏预览与请求历史不重叠', '详情键盘操作与零模型请求', '无运行时异常'], screenshots: output }));
  } finally {
    imageGate?.resolve(); actionGate?.resolve();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
