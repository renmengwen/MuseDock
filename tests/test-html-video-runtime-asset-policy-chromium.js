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
  waitForManagedShotImages,
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
      duration_sec: 4,
      metadata: {
        visual_beats: [
          { id: 'beat_1', visual_base: visualBase },
          { id: 'beat_2', visual_base: JSON.parse(JSON.stringify(visualBase)) },
        ],
      },
    };
    const shell = '<!doctype html><html><head><style>html,body{margin:0;width:640px;height:360px;background:#111}main{position:relative;width:100%;height:100%}[data-test-overlay]{position:absolute;z-index:5;left:250px;top:150px;width:140px;height:60px;background:#fff;color:#000}</style><script>(()=>{const sheet=new CSSStyleSheet();const index=sheet.insertRule(".plain{color:#fff}");sheet.deleteRule(index)})()</script></head><body data-hv-canvas data-width="640" data-height="360"><main><div data-test-overlay="overlay">模型文字 Overlay</div></main></body></html>';
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
          await waitForManagedShotImages(page);
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
          const stacking = await page.evaluate(() => {
            const overlay = document.querySelector('[data-test-overlay]');
            const rect = overlay.getBoundingClientRect();
            const elements = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            const activeShot = document.querySelector('[data-hv-shot][data-shot-active="true"]');
            const shotStyle = getComputedStyle(activeShot);
            const caption = document.querySelector('.hv-caption-item[data-hv-active="true"]');
            const captionRect = caption.getBoundingClientRect();
            const captionLayer = caption.parentElement;
            const originalPointerEvents = captionLayer.style.pointerEvents;
            captionLayer.style.pointerEvents = 'auto';
            const captionTop = document.elementsFromPoint(captionRect.left + captionRect.width / 2, captionRect.top + captionRect.height / 2)[0];
            captionLayer.style.pointerEvents = originalPointerEvents;
            return {
              top: elements[0]?.getAttribute('data-test-overlay') || elements[0]?.getAttribute('data-shot-layer') || elements[0]?.tagName,
              shotVisible: shotStyle.visibility === 'visible' && Number(shotStyle.opacity) > 0,
              sequenceZ: getComputedStyle(document.querySelector('[data-hv-image-sequence]')).zIndex,
              overlayZ: getComputedStyle(overlay).zIndex,
              captionPosition: getComputedStyle(captionLayer).position,
              captionZ: getComputedStyle(captionLayer).zIndex,
              captionBottom: Math.round(innerHeight - captionRect.bottom),
              captionTopmost: captionTop === caption || caption.contains(captionTop),
            };
          });
          throwIfPolicyViolated(collector);
          return { preloaded, overlap, boundary, afterBoundary, tail, pausedBefore, pausedAfter, images, stacking };
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
    assert.equal(shotResult.stacking.top, 'overlay');
    assert.equal(shotResult.stacking.shotVisible, true);
    assert.ok(Number(shotResult.stacking.overlayZ) > Number(shotResult.stacking.sequenceZ));
    assert.equal(shotResult.stacking.captionPosition, 'absolute');
    assert.equal(shotResult.stacking.captionZ, '9999');
    assert.ok(shotResult.stacking.captionBottom >= 30 && shotResult.stacking.captionBottom <= 60);
    assert.equal(shotResult.stacking.captionTopmost, true);
    assert.ok(requestedUrls.every(url => url.startsWith('file:')), `只允许 file: 请求：${requestedUrls.join(', ')}`);

    async function adapterPlaywright({ delayPattern = '', delayMs = 0, capture = null } = {}) {
      return {
        chromium: {
          launch: async options => {
            const realBrowser = await playwright.chromium.launch(options);
            return {
              newContext: async contextOptions => {
                const realContext = await realBrowser.newContext(contextOptions);
                let slowRouteInstalled = false;
                let observedPage = null;
                return new Proxy(realContext, {
                  get(target, property) {
                    if (property === 'route') return async (pattern, handler) => {
                      await target.route(pattern, handler);
                      if (!slowRouteInstalled && delayPattern && pattern === '**/*') {
                        slowRouteInstalled = true;
                        await target.route(delayPattern, async route => {
                          capture && (capture.slow_request_started = true);
                          await new Promise(resolve => setTimeout(resolve, delayMs));
                          await route.fallback();
                        });
                      }
                    };
                    if (property === 'newPage') return async () => {
                      const realPage = await target.newPage();
                      observedPage = realPage;
                      return new Proxy(realPage, {
                        get(pageTarget, pageProperty) {
                          if (pageProperty === 'evaluate') return async (fn, ...args) => {
                            if (capture && String(fn).includes('__hvPlayAll') && String(fn).includes('__hvUnfreeze')) {
                              capture.pre_start = await pageTarget.evaluate(() => ({
                                paused: window.__hvPlaybackClock?.paused?.(),
                                time: window.__hvPlaybackClock?.timeSec?.(),
                                images_ready: Array.from(document.querySelectorAll('[data-hv-shot] img')).every(image => image.complete && image.naturalWidth > 0),
                              }));
                            }
                            const result = await pageTarget.evaluate(fn, ...args);
                            if (capture && String(fn).includes('__hvPlayAll') && String(fn).includes('__hvUnfreeze')) {
                              capture.post_start = await pageTarget.evaluate(() => ({
                                paused: window.__hvPlaybackClock?.paused?.(),
                                time: window.__hvPlaybackClock?.timeSec?.(),
                                beat: document.body.dataset.mpBeat,
                                shots: Array.from(document.querySelectorAll('[data-hv-shot][data-shot-active="true"]')).map(item => item.dataset.shotId),
                                captions: Array.from(document.querySelectorAll('.hv-caption-item[data-hv-active="true"]')).map(item => item.dataset.captionId),
                              }));
                            }
                            return result;
                          };
                          const value = pageTarget[pageProperty];
                          return typeof value === 'function' ? value.bind(pageTarget) : value;
                        },
                      });
                    };
                    if (property === 'close') return async () => {
                      if (capture && observedPage) {
                        capture.pre_close = await observedPage.evaluate(() => ({
                          time: window.__hvPlaybackClock?.timeSec?.(),
                          beat: document.body.dataset.mpBeat,
                          shots: Array.from(document.querySelectorAll('[data-hv-shot][data-shot-active="true"]')).map(item => item.dataset.shotId),
                          captions: Array.from(document.querySelectorAll('.hv-caption-item[data-hv-active="true"]')).map(item => item.dataset.captionId),
                        }));
                      }
                      return target.close();
                    };
                    const value = target[property];
                    return typeof value === 'function' ? value.bind(target) : value;
                  },
                });
              },
              close: () => realBrowser.close(),
            };
          },
        },
      };
    }

    const productionCapture = {};
    const productionOutput = path.join(projectDir, 'frames', 'shot-production.mp4');
    const productionStarted = Date.now();
    let productionFfmpegAt = 0;
    const productionResult = await render({
      template: { sourcePath: path.join(projectDir, 'frames', 'shot-timeline.html') },
      security: { projectDir, assets: shotAssets, frameId: 'shot-production' },
      config: { outputPath: productionOutput, resolution: { width: 640, height: 360 }, duration: 0.5, durationMode: 'explicit' },
    }, {}, {
      importPlaywright: async () => adapterPlaywright({ delayPattern: '**/shot-*.png', delayMs: 1500, capture: productionCapture }),
      runFfmpeg: async () => {
        productionFfmpegAt = Date.now();
        await fsp.writeFile(productionOutput, Buffer.alloc(4096, 1));
        return { ok: true, stdout: '', stderr: '' };
      },
      probeWebmDurationSec: async () => 5,
      probeVideoStreams: async () => [{ codec_type: 'video' }],
      ffmpegPath: 'ffmpeg-mock',
    });
    assert.equal(productionResult.diagnostics[0].code, 'frame_rendered');
    assert.equal(productionCapture.slow_request_started, true);
    assert.deepEqual(productionCapture.pre_start, { paused: true, time: 0, images_ready: true });
    assert.equal(productionCapture.post_start.paused, false);
    assert.ok(productionCapture.post_start.time >= 0 && productionCapture.post_start.time < 0.1);
    assert.equal(productionCapture.post_start.beat, 'beat_1');
    assert.deepEqual(productionCapture.post_start.shots, ['shot_a']);
    assert.deepEqual(productionCapture.post_start.captions, ['caption_1']);
    assert.ok(productionFfmpegAt - productionStarted >= 1400, 'production adapter 必须等待慢图 decode 后才进入录制/ffmpeg');

    const earlyPlaySource = path.join(projectDir, 'frames', 'shot-early-play.html');
    await fsp.writeFile(earlyPlaySource, shotHtml.replace('<main>', '<script>window["__hvPlay"+"backClock"].play()</script><main>'), 'utf8');
    const earlyPlayCapture = {};
    const earlyPlayOutput = path.join(projectDir, 'frames', 'shot-early-play.mp4');
    await render({
      template: { sourcePath: earlyPlaySource }, security: { projectDir, assets: shotAssets, frameId: 'shot-early-play' },
      config: { outputPath: earlyPlayOutput, resolution: { width: 640, height: 360 }, duration: 0.5, durationMode: 'explicit' },
    }, {}, {
      importPlaywright: async () => adapterPlaywright({ delayPattern: '**/shot-*.png', delayMs: 1200, capture: earlyPlayCapture }),
      runFfmpeg: async () => { await fsp.writeFile(earlyPlayOutput, Buffer.alloc(4096, 1)); return { ok: true }; },
      probeWebmDurationSec: async () => 5,
      probeVideoStreams: async () => [{ codec_type: 'video' }],
      ffmpegPath: 'ffmpeg-mock',
    });
    assert.deepEqual(earlyPlayCapture.pre_start, { paused: true, time: 0, images_ready: true }, '长预加载前必须校准 computed-property 提前启动的 Clock');
    assert.equal(earlyPlayCapture.post_start.paused, false);
    assert.ok(earlyPlayCapture.post_start.time >= 0 && earlyPlayCapture.post_start.time < 0.1);
    assert.equal(earlyPlayCapture.post_start.beat, 'beat_1');
    assert.deepEqual(earlyPlayCapture.post_start.shots, ['shot_a']);
    assert.deepEqual(earlyPlayCapture.post_start.captions, ['caption_1']);

    for (const [name, attack] of [
      ['dynamic-managed-visual', '<script>window.__hvPlayAll=function(){const image=new Image();image.src="../assets/shot-a.png";document.body.appendChild(image)}</script>'],
      ['escaped-css-visual', '<style>.rogue{background-image:u\\72l("../assets/shot-a.png")}</style><div class="rogue">rogue</div>'],
      ['escaped-css-path', '<style>.rogue{background-image:url(../assets/shot-a\\2e png)}</style><div class="rogue">rogue</div>'],
      ['third-foreground', '<script>window.__hvPlayAll=function(){const image=new Image();image.dataset.shotLayer="foreground";image.src="../assets/shot-a.png";document.querySelector("[data-hv-shot]").appendChild(image)}</script>'],
      ['changed-managed-src', '<script>window.__hvPlayAll=function(){document.querySelector("[data-shot-layer=foreground]").src="../assets/shot-b.png"}</script>'],
      ['root-background-div', '<script>window.__hvPlayAll=function(){const div=document.createElement("div");div.style.backgroundImage="url(../assets/shot-a.png)";document.querySelector("[data-hv-image-sequence]").appendChild(div)}</script>'],
      ['pseudo-content-visual', '<style>.rogue::before{content:u\\72l("../assets/shot-a.png")}</style><div class="rogue">rogue</div>'],
      ['transient-managed-visual', '<script>window.__hvPlayAll=function(){setTimeout(function(){const image=new Image();image.src="../assets/shot-a.png";document.body.appendChild(image);setTimeout(function(){image.remove()},60)},20)}</script>'],
      ['domcontentloaded-transient-visual', '<script>document.addEventListener("DOMContentLoaded",function(){const image=new Image();image.src="../assets/shot-a.png";document.body.appendChild(image);setTimeout(function(){image.remove()},0)})</script>'],
      ['pre-guard-src-restore', '<script>document.addEventListener("DOMContentLoaded",function(){const image=document.querySelector("[data-shot-layer=foreground]");const original=image.getAttribute("src");image.setAttribute("src","../assets/shot-b.png");image.setAttribute("src",original)})</script>'],
      ['preoccupied-guard-name', '<script>Object.defineProperty(window,"__hvManagedVisualGuardCheck",{value:function(){return {success:true,applied:true}},writable:false,configurable:false})</script>'],
      ['transient-cssom-visual', '<script>(()=>{const sheet=document.styleSheets[0];const index=sheet.insertRule(".rogue{background-image:url(../assets/shot-a.png)}",sheet.cssRules.length);sheet.deleteRule(index)})()</script>'],
      ['delayed-style-text-visual', '<style id="delayed-visual"></style><script>window.__hvPlayAll=function(){setTimeout(function(){document.getElementById("delayed-visual").textContent="body::before{content:url(../assets/shot-a.png)}"},20)}</script>'],
      ['delayed-style-topology-visual', '<script>window.__hvPlayAll=function(){setTimeout(function(){const style=document.createElement("style");style.textContent="body{background-image:url(../assets/shot-a.png)}";document.head.appendChild(style);style.remove()},20)}</script>'],
      ['delayed-link-topology', '<script>window.__hvPlayAll=function(){setTimeout(function(){const link=document.createElement("link");link.rel="stylesheet";document.head.appendChild(link);link.remove()},20)}</script>'],
      ['delayed-rule-declaration-visual', '<style id="rule-declaration">body{color:white}</style><script>window.__hvPlayAll=function(){setTimeout(function(){const rule=document.getElementById("rule-declaration").sheet.cssRules[0];rule.style.setProperty("background-image","url(../assets/shot-a.png)");rule.style.removeProperty("background-image")},20)}</script>'],
      ['delayed-rule-idl-visual', '<style id="rule-idl">body{color:white}</style><script>window.__hvPlayAll=function(){setTimeout(function(){document.getElementById("rule-idl").sheet.cssRules[0].style.backgroundImage="url(../assets/shot-a.png)"},20)}</script>'],
      ['delayed-rule-css-text-visual', '<style id="rule-css-text">body{color:white}</style><script>window.__hvPlayAll=function(){setTimeout(function(){document.getElementById("rule-css-text").sheet.cssRules[0].style.cssText="background-image:url(../assets/shot-a.png)"},20)}</script>'],
      ['delayed-grouping-rule-visual', '<style id="grouping-rule">@media (min-width:1px){body{color:white}}</style><script>window.__hvPlayAll=function(){setTimeout(function(){const group=document.getElementById("grouping-rule").sheet.cssRules[0];const index=group.insertRule("body{background-image:url(../assets/shot-a.png)}",group.cssRules.length);group.deleteRule(index)},20)}</script>'],
      ['delayed-adopted-stylesheet', '<script>const adoptedSheet=new CSSStyleSheet();adoptedSheet.replaceSync("body{color:white}");window.__hvPlayAll=function(){setTimeout(function(){const before=document.adoptedStyleSheets;document.adoptedStyleSheets=before.concat(adoptedSheet);document.adoptedStyleSheets=before},20)}</script>'],
      ['dormant-rule-class-restore', '<style>.dormant.armed{background-image:url(../assets/shot-a.png)}</style><script>document.body.classList.add("dormant");window.__hvPlayAll=function(){document.body.classList.add("armed");document.body.classList.remove("armed")}</script>'],
      ['transient-inline-style-visual', '<script>window.__hvPlayAll=function(){document.body.style.setProperty("background-image","url(../assets/shot-a.png)");document.body.style.removeProperty("background-image")}</script>'],
    ]) {
      const source = path.join(projectDir, 'frames', `${name}.html`);
      await fsp.writeFile(source, shotHtml.replace('<main>', `${attack}<main>`), 'utf8');
      let ffmpegCalls = 0;
      await assert.rejects(() => render({
        template: { sourcePath: source }, security: { projectDir, assets: shotAssets, frameId: name },
        config: { outputPath: path.join(projectDir, 'frames', `${name}.mp4`), duration: 0.5, durationMode: 'explicit' },
      }, {}, {
        importPlaywright: async () => adapterPlaywright(),
        runFfmpeg: async () => { ffmpegCalls += 1; return { ok: true }; },
        ffmpegPath: 'ffmpeg-mock',
      }), error => error.code === 'frame_html_shot_contract_invalid');
      assert.equal(ffmpegCalls, 0, `${name} 不得进入 ffmpeg`);
    }

    const hostileSchedulerSource = path.join(projectDir, 'frames', 'hostile-scheduler.html');
    await fsp.writeFile(hostileSchedulerSource, shotHtml.replace('<main>', '<script>window.__hvPlayAll=function(){window.requestAnimationFrame=function(){return 0};window.cancelAnimationFrame=function(){};try{performance.now=function(){return 0}}catch{}}</script><main>'), 'utf8');
    const hostileSchedulerCapture = {};
    const hostileSchedulerOutput = path.join(projectDir, 'frames', 'hostile-scheduler.mp4');
    await render({
      template: { sourcePath: hostileSchedulerSource }, security: { projectDir, assets: shotAssets, frameId: 'hostile-scheduler' },
      config: { outputPath: hostileSchedulerOutput, resolution: { width: 640, height: 360 }, duration: 2.4, durationMode: 'explicit' },
    }, {}, {
      importPlaywright: async () => adapterPlaywright({ capture: hostileSchedulerCapture }),
      runFfmpeg: async () => { await fsp.writeFile(hostileSchedulerOutput, Buffer.alloc(4096, 1)); return { ok: true }; },
      probeWebmDurationSec: async () => 6,
      probeVideoStreams: async () => [{ codec_type: 'video' }],
      ffmpegPath: 'ffmpeg-mock',
    });
    assert.ok(hostileSchedulerCapture.pre_close.time > 0, '模型覆写 scheduler 后 Clock 仍必须推进');
    assert.equal(hostileSchedulerCapture.pre_close.beat, 'beat_2');
    assert.deepEqual(hostileSchedulerCapture.pre_close.shots, ['shot_b']);
    assert.deepEqual(hostileSchedulerCapture.pre_close.captions, ['caption_2']);

    const brokenAsset = { id: 'broken', type: 'image', media_type: 'image', status: 'ready', path: 'assets/broken.png', frame_src: '../assets/broken.png' };
    await fsp.writeFile(path.join(projectDir, brokenAsset.path), Buffer.from('not-a-png'));
    const brokenNode = { id: 'scene:broken', duration_sec: 1, metadata: { visual_beat: { visual_base: {
      type: 'image_sequence', sequence_mode: 'fullscreen_relay', shots: [{ id: 'broken_shot', asset_id: 'broken', role: 'showcase', requirement: 'required', caption_ids: [], minimum_visible_duration_sec: 1, active_window: { time_base: 'scene_local', start_sec: 0, end_sec: 1 } }],
    } } } };
    const brokenMaterialized = materializeSceneImageSequenceDom({ html: shell, node: brokenNode, creativeContext: { asset_context: { assets: [brokenAsset] } } });
    assert.equal(brokenMaterialized.success, true);
    const brokenSource = path.join(projectDir, 'frames', 'shot-broken.html');
    await fsp.writeFile(brokenSource, brokenMaterialized.html, 'utf8');
    let brokenFfmpegCalls = 0;
    const brokenError = await render({
      template: { sourcePath: brokenSource }, security: { projectDir, assets: [brokenAsset], frameId: 'shot-broken' },
      config: { outputPath: path.join(projectDir, 'frames', 'shot-broken.mp4'), duration: 0.5, durationMode: 'explicit' },
    }, {}, {
      importPlaywright: async () => adapterPlaywright(),
      runFfmpeg: async () => { brokenFfmpegCalls += 1; return { ok: true }; }, ffmpegPath: 'ffmpeg-mock',
    }).then(() => null, error => error);
    assert.equal(brokenError?.code, 'render-shot-image-not-ready', JSON.stringify(brokenError?.details || {}));
    assert.equal(brokenFfmpegCalls, 0);

    const hostileDecodeSource = path.join(projectDir, 'frames', 'hostile-decode.html');
    await fsp.writeFile(hostileDecodeSource, shotHtml.replace('<main>', '<script>window.setTimeout=function(){return 0};HTMLImageElement.prototype.decode=function(){return new Promise(function(){})}</script><main>'), 'utf8');
    let hostileDecodeFfmpeg = 0;
    await assert.rejects(() => render({
      template: { sourcePath: hostileDecodeSource }, security: { projectDir, assets: shotAssets, frameId: 'hostile-decode' },
      config: { outputPath: path.join(projectDir, 'frames', 'hostile-decode.mp4'), duration: 0.5, durationMode: 'explicit' },
    }, {}, {
      importPlaywright: async () => adapterPlaywright(), managedShotImageTimeoutMs: 200,
      runFfmpeg: async () => { hostileDecodeFfmpeg += 1; return { ok: true }; }, ffmpegPath: 'ffmpeg-mock',
    }), error => error.code === 'render-shot-image-not-ready');
    assert.equal(hostileDecodeFfmpeg, 0);

    const hostileClockSource = path.join(projectDir, 'frames', 'hostile-clock.html');
    await fsp.writeFile(hostileClockSource, shotHtml.replace(/<body([^>]*)>/i, '<body$1><script>Object.defineProperty(window,"__hvPlaybackClock",{value:{__hvOwner:"musedock-playback-clock-v1",subscribe:function(){},play:function(){},pause:function(){},timeSec:function(){return 0},paused:function(){return true},setTime:function(){}},writable:false,configurable:false})</script>'), 'utf8');
    let hostileClockFfmpeg = 0;
    await assert.rejects(() => render({
      template: { sourcePath: hostileClockSource }, security: { projectDir, assets: shotAssets, frameId: 'hostile-clock' },
      config: { outputPath: path.join(projectDir, 'frames', 'hostile-clock.mp4'), duration: 0.5, durationMode: 'explicit' },
    }, {}, {
      importPlaywright: async () => adapterPlaywright(), runFfmpeg: async () => { hostileClockFfmpeg += 1; return { ok: true }; }, ffmpegPath: 'ffmpeg-mock',
    }), error => error.code === 'render-playback-start-failed');
    assert.equal(hostileClockFfmpeg, 0);

    const throwingPlaySource = path.join(projectDir, 'frames', 'throwing-play.html');
    await fsp.writeFile(throwingPlaySource, '<!doctype html><html><head></head><body><script>window.__hvPlayAll=function(){throw new Error("boom")}</script><main>画面</main></body></html>', 'utf8');
    let throwingPlayFfmpeg = 0;
    await assert.rejects(() => render({
      template: { sourcePath: throwingPlaySource }, security: { projectDir, assets: [], frameId: 'throwing-play' },
      config: { outputPath: path.join(projectDir, 'frames', 'throwing-play.mp4'), duration: 0.5, durationMode: 'explicit' },
    }, {}, {
      importPlaywright: async () => adapterPlaywright(), runFfmpeg: async () => { throwingPlayFfmpeg += 1; return { ok: true }; }, ffmpegPath: 'ffmpeg-mock',
    }), error => error.code === 'render-playback-start-failed' && /__hvPlayAll/.test(error.message));
    assert.equal(throwingPlayFfmpeg, 0);

    const lateBoomSource = path.join(projectDir, 'frames', 'late-boom.html');
    await fsp.writeFile(lateBoomSource, '<!doctype html><html><head></head><body><script>window.__hvPlayAll=function(){setTimeout(function(){throw new Error("late-boom")},300)}</script><main>画面</main></body></html>', 'utf8');
    let lateBoomFfmpeg = 0;
    await assert.rejects(() => render({
      template: { sourcePath: lateBoomSource }, security: { projectDir, assets: [], frameId: 'late-boom' },
      config: { outputPath: path.join(projectDir, 'frames', 'late-boom.mp4'), duration: 0.8, durationMode: 'explicit' },
    }, {}, {
      importPlaywright: async () => adapterPlaywright(), runFfmpeg: async () => { lateBoomFfmpeg += 1; return { ok: true }; }, ffmpegPath: 'ffmpeg-mock',
    }), error => error.code === 'render-playback-runtime-failed' && /late-boom/.test(error.message));
    assert.equal(lateBoomFfmpeg, 0);

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
