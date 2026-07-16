const assert = require('assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { prepareSourceHtml } = require('../server/services/creative-video/html-video/prepareSourceHtml');
const {
  createRuntimeAssetPolicy,
  createViolationCollector,
  installRuntimeAssetPolicy,
  render,
  throwIfPolicyViolated,
} = require('../server/services/creative-video/html-video/hyperframesPlaywrightAdapter');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function runCase(browser, projectDir, name, body, assets = [], sourceHtml = '', inspect = false) {
  const sourcePath = path.join(projectDir, 'frames', `${name}.html`);
  await fsp.writeFile(sourcePath, sourceHtml || `<!doctype html><html><head></head><body>${body}</body></html>`, 'utf8');
  const prepared = await prepareSourceHtml(sourcePath, { projectDir });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  let snapshot = { csp_count: 0, natural_width: -1 };
  try {
    const policy = await createRuntimeAssetPolicy({
      security: { projectDir, assets, frameId: name },
      preparedPath: prepared.loadPath,
    });
    const collector = createViolationCollector(name, policy.projectRoot);
    await installRuntimeAssetPolicy({ context, page, policy, collector });
    await page.goto(pathToFileURL(prepared.loadPath).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);
    snapshot = await page.evaluate(() => ({
      csp_count: document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length,
      natural_width: document.querySelector('img')?.naturalWidth ?? -1,
    }));
    throwIfPolicyViolated(collector);
    return inspect ? { violations: [], ...snapshot } : [];
  } catch (error) {
    if (error.code === 'runtime_visual_asset_policy_violation') {
      return inspect ? { violations: error.details.violations, ...snapshot } : error.details.violations;
    }
    throw error;
  } finally {
    await context.close().catch(() => {});
    await prepared.cleanup();
  }
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-video-runtime-policy-chrome-'));
  let browser;
  try {
    const projectDir = path.join(root, 'project');
    await fsp.mkdir(path.join(projectDir, 'frames'), { recursive: true });
    await fsp.mkdir(path.join(projectDir, 'assets'), { recursive: true });
    await fsp.writeFile(path.join(projectDir, 'assets', 'registered.png'), PNG);
    await fsp.writeFile(path.join(projectDir, 'assets', 'unregistered.png'), PNG);
    const playwright = require('playwright-core');
    browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
    const registered = [{ id: 'registered', type: 'image', media_type: 'image', path: 'assets/registered.png' }];

    assert.deepEqual(await runCase(
      browser,
      projectDir,
      'registered',
      '<style>body{background:#fff}</style><script>document.body.dataset.ready="1"</script><svg width="1" height="1"><rect width="1" height="1"/></svg><img src="../assets/registered.png">',
      registered,
    ), []);

    for (const [name, body, expectedSource] of [
      ['static', '<img src="../assets/unregistered.png">', 'route'],
      ['css', '<style>body{background-image:url(../assets/unregistered.png)}</style>', 'route'],
      ['dynamic', '<script>setTimeout(()=>{const i=new Image;i.src="../assets/unregistered.png"},20)</script>', 'route'],
      ['data', `<script>try{window.__hvReportSecurityPolicyViolation=()=>{}}catch{}</script><img src="data:image/png;base64,${PNG.toString('base64')}">`, 'csp'],
      ['blob', '<script>try{Object.defineProperty(window,"__hvReportSecurityPolicyViolation",{value:()=>{}})}catch{};const u=URL.createObjectURL(new Blob([new Uint8Array([1])],{type:"image/png"}));const i=new Image;i.src=u</script>', 'csp'],
    ]) {
      const violations = await runCase(browser, projectDir, name, body, registered);
      assert.ok(violations.some(item => item.source === expectedSource), `${name} 应由 ${expectedSource} 阻断`);
    }

    const dataImage = `<img src="data:image/png;base64,${PNG.toString('base64')}">`;
    for (const [name, sourceHtml] of [
      ['quoted-head', `<!doctype html><html><head data-x="legal>quoted"></head><body>${dataImage}</body></html>`],
      ['quoted-html', `<!doctype html><html data-x="legal>quoted"><body>${dataImage}</body></html>`],
    ]) {
      const violations = await runCase(browser, projectDir, name, '', registered, sourceHtml);
      assert.ok(violations.some(item => item.source === 'csp'), `${name} 必须由正确注入的 CSP 终裁 data:image`);
    }

    const structuralAttacks = [
      ['comment-fake-head', `<!-- fake <head data-x="fake>quoted"></head> --><!doctype html><html><body>${dataImage}</body></html>`],
      ['comment-fake-html', `<!-- fake <html data-x="fake>quoted"> --><!doctype html><html><body>${dataImage}</body></html>`],
      ['html-attribute-fake-head', `<!doctype html><html data-description="<head>"><body>${dataImage}</body></html>`],
      ['head-x-before-head', `<!doctype html><html><head-x></head-x><head></head><body>${dataImage}</body></html>`],
      ['head-colon-before-head', `<!doctype html><html><head:foo></head:foo><head></head><body>${dataImage}</body></html>`],
    ];
    for (const [name, sourceHtml] of structuralAttacks) {
      const result = await runCase(browser, projectDir, name, '', registered, sourceHtml, true);
      assert.equal(result.csp_count, 1, `${name} 必须只存在一个真实 CSP meta`);
      assert.equal(result.natural_width, 0, `${name} 的 data:image 必须未加载`);
      assert.ok(result.violations.some(item => item.source === 'csp'), `${name} 必须由 CSP 终裁`);
    }

    const adapterSource = path.join(projectDir, 'frames', 'adapter-comment-fake-head.html');
    await fsp.writeFile(adapterSource, structuralAttacks[0][1], 'utf8');
    let ffmpegCalls = 0;
    await assert.rejects(() => render({
      template: { sourcePath: adapterSource },
      security: { projectDir, assets: registered, frameId: 'adapter-comment-fake-head' },
      config: { outputPath: path.join(projectDir, 'frames', 'adapter-comment-fake-head.mp4'), duration: 0.1, durationMode: 'explicit' },
    }, {}, {
      importPlaywright: async () => require('playwright-core'),
      runFfmpeg: async () => { ffmpegCalls += 1; return { ok: true }; },
      ffmpegPath: 'ffmpeg-mock',
    }), error => error.code === 'runtime_visual_asset_policy_violation');
    assert.equal(ffmpegCalls, 0, 'production adapter 的 CSP 违规不得进入 ffmpeg');

    console.log('html-video runtime asset policy chromium tests passed');
  } finally {
    if (browser) await browser.close().catch(() => {});
    await fsp.rm(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
