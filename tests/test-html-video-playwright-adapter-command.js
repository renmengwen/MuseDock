const assert = require('assert');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const {
  buildFfmpegArgs,
  createRuntimeAssetPolicy,
  createViolationCollector,
  installRuntimeAssetPolicy,
  render,
} = require('../server/services/creative-video/html-video/hyperframesPlaywrightAdapter');
const { diagnoseEnvironment } = require('../server/services/creative-video/html-video/environmentDoctor');

(async () => {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-video-adapter-'));
  const outsideDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-video-adapter-outside-'));
  try {
    const sourcePath = path.join(workDir, 'frame.html');
    const outputPath = path.join(workDir, 'frame.mp4');
    await fsp.writeFile(sourcePath, '<html><body><h1>帧</h1></body></html>', 'utf8');
    assert.equal(typeof createRuntimeAssetPolicy, 'function');
    const assetDir = path.join(workDir, 'assets');
    await fsp.mkdir(assetDir);
    const registeredPath = path.join(assetDir, 'registered.png');
    const unregisteredPath = path.join(assetDir, 'unregistered.png');
    const stylesheetPath = path.join(assetDir, 'frame.css');
    await fsp.writeFile(registeredPath, 'png');
    await fsp.writeFile(unregisteredPath, 'png');
    await fsp.writeFile(stylesheetPath, 'body{}');
    const policy = await createRuntimeAssetPolicy({
      security: {
        projectDir: workDir,
        frameId: 'scene_policy',
        assets: [{ type: 'image', path: 'assets/registered.png', frame_src: '../assets/unregistered.png', url: pathToFileURL(unregisteredPath).href }],
      },
      preparedPath: sourcePath,
    });
    assert.equal((await policy.decide(pathToFileURL(sourcePath).href, 'document')).allow, true);
    assert.equal((await policy.decide(`${pathToFileURL(registeredPath).href}?v=1`, 'image')).allow, true);
    assert.equal((await policy.decide(pathToFileURL(unregisteredPath).href, 'image')).allow, false, 'asset.url 不得进入 allowlist');
    assert.equal((await policy.decide(pathToFileURL(stylesheetPath).href, 'stylesheet')).allow, true);
    assert.equal((await policy.decide(pathToFileURL(registeredPath).href, 'stylesheet')).allow, false, '资源类型与扩展名必须匹配');
    assert.equal((await policy.decide('https://example.invalid/a.png', 'image')).allow, false);
    const outsideImage = path.join(outsideDir, 'outside.png');
    const junctionPath = path.join(workDir, 'junction-outside');
    await fsp.writeFile(outsideImage, 'png');
    await fsp.symlink(outsideDir, junctionPath, process.platform === 'win32' ? 'junction' : 'dir');
    const junctionPolicy = await createRuntimeAssetPolicy({
      security: { projectDir: workDir, frameId: 'scene_policy', assets: [{ type: 'image', path: 'junction-outside/outside.png' }] },
      preparedPath: sourcePath,
    });
    assert.equal((await junctionPolicy.decide(pathToFileURL(path.join(junctionPath, 'outside.png')).href, 'image')).allow, false, 'junction 出根必须拒绝');

    const missingApiCollector = createViolationCollector('scene_policy', workDir);
    await assert.rejects(
      () => installRuntimeAssetPolicy({ context: {}, page: {}, policy, collector: missingApiCollector }),
      error => error.code === 'runtime_visual_asset_policy_violation'
        && error.details.violations[0].kind === 'route_api_unavailable',
    );

    let routeHandler;
    let continued = 0;
    let aborted = 0;
    const fakePage = {
      addInitScript: async () => {}, exposeBinding: async () => {}, on: () => {}, mainFrame: () => null,
    };
    await installRuntimeAssetPolicy({
      context: {
        route: async (_pattern, handler) => { routeHandler = handler; },
        routeWebSocket: async () => {},
        on: () => {},
      },
      page: fakePage,
      policy,
      collector: createViolationCollector('scene_policy', workDir),
    });
    await routeHandler({
      request: () => ({ url: () => pathToFileURL(unregisteredPath).href, resourceType: () => 'image' }),
      continue: async () => { continued += 1; },
      abort: async () => { aborted += 1; },
    });
    assert.equal(continued, 0);
    assert.equal(aborted, 1, 'route 必须只有一个终态');

    const browserCollector = createViolationCollector('scene_browser', workDir);
    const contextEvents = new Map();
    const pageEvents = new Map();
    let websocketHandler;
    let websocketClosed = 0;
    const mainFrame = { url: () => 'file:///unexpected.html' };
    await installRuntimeAssetPolicy({
      context: {
        route: async () => {},
        routeWebSocket: async (_pattern, handler) => { websocketHandler = handler; },
        on: (name, handler) => contextEvents.set(name, handler),
      },
      page: {
        addInitScript: async () => {}, exposeBinding: async () => {},
        on: (name, handler) => pageEvents.set(name, handler), mainFrame: () => mainFrame,
      },
      policy,
      collector: browserCollector,
    });
    await websocketHandler({ url: () => 'ws://127.0.0.1/socket', close: async () => { websocketClosed += 1; } });
    contextEvents.get('page')({ url: () => 'file:///popup.html' });
    pageEvents.get('popup')({ url: () => 'file:///popup.html' });
    pageEvents.get('download')({ url: () => 'file:///download.bin' });
    pageEvents.get('crash')();
    await pageEvents.get('framenavigated')(mainFrame);
    assert.equal(websocketClosed, 1);
    assert.deepEqual(
      new Set(browserCollector.values().map(item => item.kind)),
      new Set(['websocket_blocked', 'unexpected_page', 'popup_blocked', 'download_blocked', 'page_crash', 'unexpected_navigation']),
    );

    // webm 余量不足时不再静默放弃裁剪，而是钳制到最大安全 seek：10.6 - 2.56 - 0.1 = 7.94
    const clampedSeek = buildFfmpegArgs({
      webmPath: path.join(workDir, 'capture.webm'),
      outputPath,
      fps: 24,
      leadInMs: 19936,
      duration: 2.56,
      inputDurationSec: 10.6,
    });
    assertIncludesPair(clampedSeek.args, '-ss', '7.940');
    assert.equal(clampedSeek.seek.clamped, true, '余量不足时应标记 clamped');
    assert.ok(clampedSeek.seek.requested_sec > clampedSeek.seek.applied_sec, 'clamp 后 applied 应小于 requested');

    // webm 比目标时长还短：无法裁剪，seek 归零并标记 skipped
    const skippedSeek = buildFfmpegArgs({
      webmPath: path.join(workDir, 'capture.webm'),
      outputPath,
      fps: 24,
      leadInMs: 19936,
      duration: 2.56,
      inputDurationSec: 2.0,
    });
    assert.equal(skippedSeek.args.includes('-ss'), false, 'webm 短于目标时长时不应生成 -ss');
    assert.equal(skippedSeek.seek.skipped, true, '无法裁剪时应标记 skipped');

    const calls = {
      launches: [],
      contexts: [],
      gotos: [],
      initScripts: 0,
      initScriptSources: [],
      progress: [],
      ffmpeg: [],
      waits: [],
      evaluates: [],
    };

    let startupFailureMode = false;
    let managedImageNeverSettles = false;
    const mockPlaywright = {
      chromium: {
        launch: async options => {
          calls.launches.push(options);
          return {
            newContext: async options => {
              calls.contexts.push(options);
              const recordDir = options.recordVideo.dir;
              const pageEvents = new Map();
              const page = {
                on: (name, handler) => pageEvents.set(name, handler),
                mainFrame: () => null,
                exposeBinding: async () => {},
                addInitScript: async fn => {
                    calls.initScripts += 1;
                    calls.initScriptSources.push(String(fn));
                },
                goto: async (url, gotoOptions) => { calls.gotos.push({ url, options: gotoOptions }); },
                evaluate: async fn => {
                  const source = String(fn);
                  calls.evaluates.push(source);
                  if (source.includes('managed-shot-images')) return managedImageNeverSettles ? new Promise(() => {}) : { success: true, count: 0 };
                  if (source.includes('getComputedStyle')) return 1800;
                  if (source.includes('__hvPlayAll')) return startupFailureMode
                    ? { success: false, errors: ['__hvPlayAll: boom'] }
                    : { success: true, errors: [] };
                  return undefined;
                },
                waitForTimeout: async ms => { calls.waits.push(ms); },
              };
              return {
                newPage: async () => page,
                route: async () => {},
                routeWebSocket: async () => {},
                on: () => {},
                close: async () => {
                  await fsp.writeFile(path.join(recordDir, 'capture.webm'), 'webm');
                },
              };
            },
            close: async () => {},
          };
        },
      },
    };

    const renderResult = await render(
      {
        template: { sourcePath },
        security: { projectDir: workDir, assets: [], frameId: 'scene_01' },
        config: {
          outputPath,
          resolution: { width: 640, height: 360 },
          fps: 24,
          duration: 4,
          durationMode: 'explicit',
        },
      },
      {
        onProgress: (percent, message) => calls.progress.push({ percent, message }),
      },
      {
        now: (() => {
          const values = [1000, 1500];
          return () => values.shift() || 1500;
        })(),
        importPlaywright: async () => mockPlaywright,
        runFfmpeg: async (command, args) => {
          calls.ffmpeg.push({ command, args });
          await fsp.writeFile(outputPath, Buffer.alloc(4096, 1));
          return { ok: true, stdout: '', stderr: '' };
        },
        probeWebmDurationSec: async () => 10,
        probeVideoStreams: async () => [{ codec_type: 'video' }],
        ffmpegPath: 'ffmpeg-mock',
      },
    );
    assert.equal(renderResult.diagnostics[0].code, 'frame_rendered');
    assert.match(renderResult.diagnostics[0].message, /Playwright\/Chromium/);
    assert.equal(
      renderResult.diagnostics.some(item => item.code === 'lead_in_trim_degraded'),
      false,
      '正常裁剪不应产生降级诊断',
    );

    assert.equal(calls.launches.length, 1);
    assert.equal(calls.launches[0].headless, true);
    assert.equal(calls.launches[0].chromiumSandbox, true);
    assert.equal((calls.launches[0].args || []).includes('--no-sandbox'), false);
    assert.equal((calls.launches[0].args || []).includes('--disable-blink-features=AutomationControlled'), false);
    assert.deepEqual(calls.contexts[0].recordVideo.size, { width: 640, height: 360 });
    assert.equal(calls.contexts[0].serviceWorkers, 'block');
    // 受控标志、动画冻结和 CSP 违规监听三条 initScript
    assert.equal(calls.initScripts, 3);
    assert.ok(
      calls.initScriptSources.some(source => source.includes('__mpAdapterControlled')),
      '必须在 goto 前注入 __mpAdapterControlled 受控标志',
    );
    assert.equal(calls.gotos[0].options.waitUntil, 'domcontentloaded');
    const playbackStart = calls.evaluates.find(source => source.includes('__hvPlayAll') && source.includes('__hvUnfreeze'));
    assert.ok(playbackStart, 'animation、解冻和共享时钟必须在同一次 evaluate 启动');
    assert.match(playbackStart, /__hvPlaybackClock/);
    assert.match(playbackStart, /\.pause\(\)/, '正式启动必须先暂停可能提前运行的共享时钟');
    assert.match(playbackStart, /\.setTime\(0\)/, '正式启动必须把共享时钟归零');
    assert.match(playbackStart, /timeSec\(\)/, '正式启动必须验证时钟从零开始');
    assert.ok(playbackStart.indexOf("__hvPlaybackClock.reset") < playbackStart.indexOf('__hvPlayAll'));
    assert.ok(playbackStart.indexOf('__hvPlayAll') < playbackStart.indexOf('__hvUnfreeze'));
    assert.ok(playbackStart.indexOf('__hvUnfreeze') < playbackStart.lastIndexOf("attempt('__hvPlaybackClock'"));
    assert.ok(calls.evaluates.some(source => source.includes('[data-hv-shot]') && source.includes('decode')), '正式 adapter 必须在启动前等待受管 Shot 图片 decode');
    assert.ok(calls.waits.includes(800), '录制结束前应有 800ms 尾部缓冲，保证 -ss 裁剪安全余量');

    assert.equal(calls.ffmpeg.length, 1);
    assert.equal(calls.ffmpeg[0].command, 'ffmpeg-mock');
    const args = calls.ffmpeg[0].args;
    assertIncludesPair(args, '-c:v', 'libx264');
    assertIncludesPair(args, '-pix_fmt', 'yuv420p');
    assertIncludesPair(args, '-preset', 'medium');
    assertIncludesPair(args, '-crf', '20');
    assertIncludesPair(args, '-movflags', '+faststart');
    assertIncludesPair(args, '-t', '4');
    assert.ok(args.includes('-vf'), '显式 duration 应添加 tpad filter');
    assert.ok(args.includes('tpad=stop_mode=clone:stop_duration=4'), '显式 duration 应 clone 尾帧补齐');
    assert.ok(args.includes('-ss'), '应按 leadInMs 裁剪 dead lead-in');

    startupFailureMode = true;
    let startupFailureFfmpegCalls = 0;
    await assert.rejects(() => render(
      {
        template: { sourcePath },
        security: { projectDir: workDir, assets: [], frameId: 'scene_startup_failure' },
        config: { outputPath: path.join(workDir, 'startup-failure.mp4'), duration: 0.5, durationMode: 'explicit' },
      },
      {},
      {
        importPlaywright: async () => mockPlaywright,
        runFfmpeg: async () => { startupFailureFfmpegCalls += 1; return { ok: true }; },
        ffmpegPath: 'ffmpeg-mock',
      },
    ), error => error.code === 'render-playback-start-failed');
    assert.equal(startupFailureFfmpegCalls, 0, '播放启动错误不得进入 ffmpeg');
    startupFailureMode = false;

    managedImageNeverSettles = true;
    let decodeTimeoutFfmpegCalls = 0;
    await assert.rejects(() => render(
      {
        template: { sourcePath }, security: { projectDir: workDir, assets: [], frameId: 'scene_decode_timeout' },
        config: { outputPath: path.join(workDir, 'decode-timeout.mp4'), duration: 0.5, durationMode: 'explicit' },
      }, {}, {
        importPlaywright: async () => mockPlaywright,
        managedShotImageTimeoutMs: 30,
        runFfmpeg: async () => { decodeTimeoutFfmpegCalls += 1; return { ok: true }; }, ffmpegPath: 'ffmpeg-mock',
      },
    ), error => error.code === 'render-shot-image-not-ready');
    assert.equal(decodeTimeoutFfmpegCalls, 0);
    managedImageNeverSettles = false;

    let lateRouteHandler;
    let lateTriggered = false;
    let lateFfmpegCalls = 0;
    const latePage = {
      addInitScript: async () => {}, exposeBinding: async () => {}, on: () => {}, mainFrame: () => null,
      goto: async () => {},
      evaluate: async fn => String(fn).includes('managed-shot-images') ? { success: true, count: 0 } : String(fn).includes('getComputedStyle') ? 0 : { success: true, errors: [] },
      waitForTimeout: async ms => {
        if (ms === 250 && !lateTriggered) {
          lateTriggered = true;
          await lateRouteHandler({
            request: () => ({ url: () => pathToFileURL(unregisteredPath).href, resourceType: () => 'image' }),
            continue: async () => { throw new Error('不应放行'); },
            abort: async () => {},
          });
        }
      },
    };
    const latePlaywright = {
      chromium: { launch: async () => ({
        newContext: async () => ({
          newPage: async () => latePage,
          route: async (_pattern, handler) => { lateRouteHandler = handler; },
          routeWebSocket: async () => {}, on: () => {}, close: async () => {},
        }),
        close: async () => {},
      }) },
    };
    await assert.rejects(
      () => render({
        template: { sourcePath },
        security: { projectDir: workDir, assets: [], frameId: 'scene_late' },
        config: { outputPath: path.join(workDir, 'late.mp4'), duration: 0.5, durationMode: 'explicit' },
      }, {}, {
        importPlaywright: async () => latePlaywright,
        runFfmpeg: async () => { lateFfmpegCalls += 1; return { ok: true }; },
        ffmpegPath: 'ffmpeg-mock',
      }),
      error => error.code === 'runtime_visual_asset_policy_violation'
        && error.details.violations.some(item => item.kind === 'unregistered_local_image'),
    );
    assert.equal(lateFfmpegCalls, 0, '晚到动态违规必须在 ffmpeg 前停止');

    for (const trigger of ['goto', 'close']) {
      let handler;
      let ffmpegCalls = 0;
      let recordDir;
      const fireViolation = () => handler({
        request: () => ({ url: () => pathToFileURL(unregisteredPath).href, resourceType: () => trigger === 'goto' ? 'document' : 'image' }),
        continue: async () => {}, abort: async () => {},
      });
      const page = {
        addInitScript: async () => {}, exposeBinding: async () => {}, on: () => {}, mainFrame: () => null,
        goto: async () => { if (trigger === 'goto') { await fireViolation(); throw new Error('ERR_BLOCKED_BY_CLIENT'); } },
        evaluate: async fn => String(fn).includes('managed-shot-images') ? { success: true, count: 0 } : String(fn).includes('getComputedStyle') ? 0 : { success: true, errors: [] },
        waitForTimeout: async () => {},
      };
      const playwrightForTrigger = { chromium: { launch: async () => ({
        newContext: async options => {
          recordDir = options.recordVideo.dir;
          return {
            newPage: async () => page, route: async (_pattern, next) => { handler = next; },
            routeWebSocket: async () => {}, on: () => {},
            close: async () => {
              if (trigger === 'close') await fireViolation();
              await fsp.writeFile(path.join(recordDir, 'capture.webm'), 'webm');
            },
          };
        },
        close: async () => {},
      }) } };
      await assert.rejects(() => render({
        template: { sourcePath }, security: { projectDir: workDir, assets: [], frameId: `scene_${trigger}` },
        config: { outputPath: path.join(workDir, `${trigger}.mp4`), duration: 0.5, durationMode: 'explicit' },
      }, {}, {
        importPlaywright: async () => playwrightForTrigger,
        runFfmpeg: async () => { ffmpegCalls += 1; return { ok: true }; }, ffmpegPath: 'ffmpeg-mock',
      }), error => error.code === 'runtime_visual_asset_policy_violation');
      assert.equal(ffmpegCalls, 0, `${trigger} 期间违规不得调用 ffmpeg`);
    }

    const badOutputPath = path.join(workDir, 'bad-frame.mp4');
    await assert.rejects(
      () => render(
        {
          template: { sourcePath },
          security: { projectDir: workDir, assets: [], frameId: 'scene_01' },
          config: {
            outputPath: badOutputPath,
            resolution: { width: 640, height: 360 },
            fps: 24,
            duration: 2,
            durationMode: 'explicit',
          },
        },
        {},
        {
          now: (() => {
            const values = [2000, 2300];
            return () => values.shift() || 2300;
          })(),
          importPlaywright: async () => mockPlaywright,
          runFfmpeg: async () => {
            await fsp.writeFile(badOutputPath, Buffer.alloc(4096, 1));
            return { ok: true, stdout: '', stderr: '' };
          },
          probeWebmDurationSec: async () => 10,
          probeVideoStreams: async () => [],
          ffmpegPath: 'ffmpeg-mock',
        },
      ),
      error => error.code === 'render-failed'
        && error.message.includes('html-video 编码完成但输出视频无有效画面流。'),
    );

    const ffmpegDir = path.join(workDir, 'bin');
    const ffmpegExecutable = path.join(ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const expectedFfprobe = path.join(ffmpegDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    await fsp.mkdir(ffmpegDir, { recursive: true });
    await fsp.writeFile(expectedFfprobe, 'ffprobe');
    const ffprobeCalls = [];
    const absoluteFfprobeOutput = path.join(workDir, 'absolute-ffprobe.mp4');
    await render(
      {
        template: { sourcePath },
        security: { projectDir: workDir, assets: [], frameId: 'scene_01' },
        config: {
          outputPath: absoluteFfprobeOutput,
          resolution: { width: 640, height: 360 },
          fps: 24,
          duration: 2,
          durationMode: 'explicit',
        },
      },
      {},
      {
        now: (() => {
          const values = [3000, 3300];
          return () => values.shift() || 3300;
        })(),
        importPlaywright: async () => mockPlaywright,
        runCommand: async (command, args) => {
          if (command === (process.platform === 'win32' ? 'where.exe' : 'which')) {
            return { ok: true, stdout: `${ffmpegExecutable}\n`, stderr: '' };
          }
          return { ok: true, stdout: 'ffmpeg version mock', stderr: '' };
        },
        runFfmpeg: async (command) => {
          assert.equal(command, ffmpegExecutable);
          await fsp.writeFile(absoluteFfprobeOutput, Buffer.alloc(4096, 1));
          return { ok: true, stdout: '', stderr: '' };
        },
        runFfprobe: async (command, args) => {
          ffprobeCalls.push({ command, args });
          if (args.includes('format=duration')) return { ok: true, stdout: '10.0', stderr: '' };
          return { ok: true, stdout: JSON.stringify({ streams: [{ codec_type: 'video' }] }), stderr: '' };
        },
      },
    );
    assert.ok(ffprobeCalls.length >= 2);
    assert.equal(ffprobeCalls[0].command, expectedFfprobe);
    assert.equal(ffprobeCalls[1].command, expectedFfprobe);

    const originalFfmpegPath = process.env.FFMPEG_PATH;
    delete process.env.FFMPEG_PATH;
    const commandCalls = [];
    try {
      const foundFfmpeg = process.platform === 'win32'
        ? path.join(workDir, 'doctor-bin', 'ffmpeg.exe')
        : path.join(workDir, 'doctor-bin', 'ffmpeg');
      const foundFfprobe = path.join(path.dirname(foundFfmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
      await fsp.mkdir(path.dirname(foundFfmpeg), { recursive: true });
      await fsp.writeFile(foundFfprobe, 'ffprobe');
      const doctor = await diagnoseEnvironment({
        importPlaywright: async () => ({
          chromium: {
            launch: async () => ({ close: async () => {} }),
          },
        }),
        runCommand: async (command, args) => {
          commandCalls.push({ command, args });
          if (command === (process.platform === 'win32' ? 'where.exe' : 'which')) {
            return { ok: true, stdout: `${foundFfmpeg}\n`, stderr: '' };
          }
          return { ok: true, stdout: 'ffmpeg version mock', stderr: '' };
        },
      });

      assert.equal(doctor.ok, true);
      assert.equal(commandCalls[0].command, process.platform === 'win32' ? 'where.exe' : 'which');
      assert.deepEqual(commandCalls[0].args, ['ffmpeg']);
      assert.equal(doctor.diagnostics.find(item => item.code === 'ffmpeg_available').path, foundFfmpeg);
      assert.equal(doctor.diagnostics.find(item => item.code === 'ffprobe_available').path, foundFfprobe);
    } finally {
      if (originalFfmpegPath === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = originalFfmpegPath;
    }

    const missingFfprobe = await diagnoseEnvironment({
      importPlaywright: async () => ({
        chromium: {
          launch: async () => ({ close: async () => {} }),
        },
      }),
      runCommand: async (command, args) => {
        const basename = path.basename(command).toLowerCase();
        if (command === (process.platform === 'win32' ? 'where.exe' : 'which')) {
          return { ok: false, stdout: '', stderr: 'not found' };
        }
        if (basename.startsWith('ffmpeg')) {
          return { ok: true, stdout: 'ffmpeg version mock', stderr: '' };
        }
        if (basename.startsWith('ffprobe')) {
          return { ok: false, stdout: '', stderr: 'ffprobe missing' };
        }
        return { ok: false, stdout: '', stderr: 'unexpected command' };
      },
    });
    assert.equal(missingFfprobe.ok, false);
    assert.equal(missingFfprobe.diagnostics.some(item => item.code === 'ffmpeg_available'), true);
    const ffprobeMissing = missingFfprobe.diagnostics.find(item => item.code === 'ffprobe_missing');
    assert.ok(ffprobeMissing);
    assert.equal(path.basename(ffprobeMissing.path).toLowerCase(), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    assert.equal(ffprobeMissing.path.includes('@ffmpeg-installer'), false);

    console.log('html-video playwright adapter command tests passed');
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
    await fsp.rm(outsideDir, { recursive: true, force: true });
  }
})();

function assertIncludesPair(args, key, value) {
  const index = args.indexOf(key);
  assert.notEqual(index, -1, `缺少 ${key}`);
  assert.equal(args[index + 1], value, `${key} 参数不正确`);
}
