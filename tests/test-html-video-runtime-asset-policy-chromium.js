const assert = require('assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { prepareSourceHtml } = require('../server/services/creative-video/html-video/prepareSourceHtml');
const { ensureCaptionLayer } = require('../server/services/creative-video/html-video/captionLayer');
const { buildSceneTimelineScript } = require('../server/services/creative-video/html-video/frameHtmlPhaseSupport');
const { materializeSceneImageSequenceDom } = require('../server/services/creative-video/html-video/sceneImageSequenceDom');
const {
  createRuntimeAssetPolicy,
  createViolationCollector,
  installRuntimeAssetPolicy,
  render,
  throwIfPolicyViolated,
} = require('../server/services/creative-video/html-video/hyperframesPlaywrightAdapter');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function runCase(browser, projectDir, name, body, assets = [], sourceHtml = '', inspect = false, hooks = {}) {
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
    if (hooks.beforeGoto) await hooks.beforeGoto({ context, page, collector });
    await page.goto(pathToFileURL(prepared.loadPath).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);
    const extra = hooks.afterGoto ? await hooks.afterGoto({ context, page, collector }) : {};
    snapshot = await page.evaluate(() => ({
      csp_count: document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length,
      natural_width: document.querySelector('img')?.naturalWidth ?? -1,
    }));
    throwIfPolicyViolated(collector);
    return inspect ? { violations: [], ...snapshot, ...extra } : [];
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

    // C-04：生产 helper 物化两 Shot，真实 Chrome 验证慢预加载期间共享时钟保持 t=0。
    await fsp.writeFile(path.join(projectDir, 'assets', 'shot-a.png'), PNG);
    await fsp.writeFile(path.join(projectDir, 'assets', 'shot-b.png'), PNG);
    const shotAssets = ['a', 'b'].map(id => ({
      id,
      type: 'image',
      media_type: 'image',
      status: 'ready',
      path: `assets/shot-${id}.png`,
      frame_src: `../assets/shot-${id}.png`,
    }));
    const visualBase = {
      type: 'image_sequence',
      sequence_mode: 'fullscreen_relay',
      shots: [
        { id: 'shot_a', asset_id: 'a', role: 'overview', requirement: 'required', caption_ids: ['caption_1'], minimum_visible_duration_sec: 1, active_window: { time_base: 'scene_local', start_sec: 0, end_sec: 2.2 } },
        { id: 'shot_b', asset_id: 'b', role: 'detail', requirement: 'required', caption_ids: ['caption_2'], minimum_visible_duration_sec: 1, active_window: { time_base: 'scene_local', start_sec: 1.8, end_sec: 4 } },
      ],
    };
    const shotNode = {
      id: 'scene:scene_shots',
      metadata: {
        visual_beats: [
          { id: 'beat_1', visual_base: visualBase },
          { id: 'beat_2', visual_base: JSON.parse(JSON.stringify(visualBase)) },
        ],
      },
    };
    const shell = '<!doctype html><html><head><style>html,body{margin:0;width:640px;height:360px;background:#111}</style></head><body data-hv-canvas data-width="640" data-height="360"><main></main></body></html>';
    const materialized = materializeSceneImageSequenceDom({
      html: shell,
      node: shotNode,
      creativeContext: { asset_context: { assets: shotAssets } },
    });
    assert.equal(materialized.success, true, materialized.message);
    const withTimeline = materialized.html.replace('</body>', `${buildSceneTimelineScript([
      { id: 'beat_1', start_sec: 0, end_sec: 2 },
      { id: 'beat_2', start_sec: 2, end_sec: 4 },
    ])}</body>`);
    const shotHtml = ensureCaptionLayer(withTimeline, [
      { id: 'caption_1', start: 0, end: 2, text: '第一段' },
      { id: 'caption_2', start: 2, end: 4, text: '第二段' },
    ]);
    let slowRequestStarted;
    const slowRequest = new Promise(resolve => { slowRequestStarted = resolve; });
    const requestedUrls = [];
    const shotResult = await runCase(
      browser,
      projectDir,
      'shot-timeline',
      '',
      shotAssets,
      shotHtml,
      true,
      {
        beforeGoto: async ({ context, page }) => {
          await page.addInitScript(() => { window.__mpAdapterControlled = true; });
          page.on('request', request => requestedUrls.push(request.url()));
          await context.route('**/shot-*.png', async route => {
            slowRequestStarted();
            await new Promise(resolve => setTimeout(resolve, 1500));
            await route.fallback();
          });
        },
        afterGoto: async ({ page, collector }) => {
          await slowRequest;
          await page.waitForTimeout(1200);
          const preloaded = await page.evaluate(() => ({
            time: window.__hvPlaybackClock.timeSec(),
            paused: window.__hvPlaybackClock.paused(),
            beat: document.body.dataset.mpBeat,
            shots: Array.from(document.querySelectorAll('[data-hv-shot][data-shot-active="true"]')).map(item => item.dataset.shotId),
            captions: Array.from(document.querySelectorAll('.hv-caption-item[data-hv-active="true"]')).map(item => item.dataset.captionId),
          }));
          await page.waitForFunction(() => Array.from(document.images).every(image => image.complete && image.naturalWidth > 0));
          const at = async time => page.evaluate(value => {
            window.__mpSetTimelineTime(value);
            return {
              beat: document.body.dataset.mpBeat,
              shots: Array.from(document.querySelectorAll('[data-hv-shot][data-shot-active="true"]')).map(item => item.dataset.shotId),
              captions: Array.from(document.querySelectorAll('.hv-caption-item[data-hv-active="true"]')).map(item => item.dataset.captionId),
            };
          }, time);
          const overlap = await at(1.9);
          const boundary = await at(2.1);
          const afterBoundary = await at(2.3);
          const tail = await at(8);
          await page.evaluate(() => { window.__hvPlaybackClock.setTime(1); window.__hvPlaybackClock.play(); });
          await page.waitForTimeout(100);
          await page.evaluate(() => window.__hvPlaybackClock.pause());
          const pausedBefore = await page.evaluate(() => ({ time: window.__hvPlaybackClock.timeSec(), shots: document.querySelectorAll('[data-shot-active="true"]').length }));
          await page.waitForTimeout(500);
          const pausedAfter = await page.evaluate(() => ({ time: window.__hvPlaybackClock.timeSec(), shots: document.querySelectorAll('[data-shot-active="true"]').length }));
          const images = await page.evaluate(() => Array.from(document.images).map(image => ({
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            fit: getComputedStyle(image).objectFit,
          })));
          throwIfPolicyViolated(collector);
          return { preloaded, overlap, boundary, afterBoundary, tail, pausedBefore, pausedAfter, images };
        },
      },
    );
    assert.equal(shotResult.preloaded.time, 0);
    assert.equal(shotResult.preloaded.paused, true);
    assert.equal(shotResult.preloaded.beat, 'beat_1');
    assert.deepEqual(shotResult.preloaded.shots, ['shot_a']);
    assert.deepEqual(shotResult.preloaded.captions, ['caption_1']);
    assert.deepEqual(shotResult.overlap.shots, ['shot_a', 'shot_b']);
    assert.equal(shotResult.boundary.beat, 'beat_2');
    assert.deepEqual(shotResult.boundary.captions, ['caption_2']);
    assert.deepEqual(shotResult.afterBoundary.shots, ['shot_b']);
    assert.deepEqual(shotResult.tail.shots, ['shot_b']);
    assert.equal(shotResult.pausedAfter.time, shotResult.pausedBefore.time);
    assert.deepEqual(shotResult.pausedAfter.shots, shotResult.pausedBefore.shots);
    assert.equal(shotResult.images.length, 4);
    assert.ok(shotResult.images.every(image => image.complete && image.naturalWidth > 0));
    assert.deepEqual(shotResult.images.map(image => image.fit), ['cover', 'contain', 'cover', 'contain']);
    assert.ok(requestedUrls.every(url => url.startsWith('file:')), `只允许 file: 请求：${requestedUrls.join(', ')}`);

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
