const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const { spawn } = require('child_process');

const { prepareSourceHtml } = require('./prepareSourceHtml');
const { buildPlaybackClockSource } = require('./playbackClock');
const { resolveFfmpegPath } = require('./environmentDoctor');

const ADAPTER_VERSION = '0.1.0-playwright';
const DEFAULT_RENDER_RESOLUTION = { width: 1920, height: 1080 };
// 录制尾部缓冲：保证 webm 长度 ≥ leadIn + duration + 余量，避免 -ss 前导裁剪被安全检查钳制
const RECORD_TAIL_BUFFER_MS = 800;
const POLICY_ERROR_CODE = 'runtime_visual_asset_policy_violation';
const RESOURCE_EXTENSIONS = {
  script: new Set(['.js', '.mjs', '.cjs']),
  stylesheet: new Set(['.css']),
  font: new Set(['.woff', '.woff2', '.ttf', '.otf']),
  media: new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.mp4', '.webm', '.mov']),
};

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isContained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sanitizedTarget(rawUrl, projectRoot = '') {
  if (path.isAbsolute(String(rawUrl || ''))) return path.basename(String(rawUrl));
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'file:') {
      const filePath = fileURLToPath(parsed);
      return projectRoot && isContained(projectRoot, filePath)
        ? path.relative(projectRoot, filePath).replace(/\\/g, '/')
        : path.basename(filePath);
    }
    if (parsed.protocol === 'data:') return 'data:';
    if (parsed.protocol === 'blob:') return 'blob:';
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return String(rawUrl || '').slice(0, 160);
  }
}

function createViolationCollector(frameId, projectRoot = '') {
  const byKey = new Map();
  return {
    add(input = {}) {
      const violation = {
        source: input.source || 'route',
        kind: input.kind || 'disallowed_resource',
        resource_type: input.resource_type || '',
        target: sanitizedTarget(input.url || input.target || '', projectRoot),
        directive: input.directive || '',
        frame_id: frameId || '',
      };
      const key = [violation.source, violation.kind, violation.resource_type, violation.target, violation.directive].join('|');
      if (!byKey.has(key)) byKey.set(key, violation);
    },
    values: () => [...byKey.values()],
  };
}

async function createRuntimeAssetPolicy({ security = {}, preparedPath } = {}) {
  const projectDir = String(security.projectDir || '').trim();
  if (!projectDir || !preparedPath) {
    throw createPolicyError(security.frameId, [{ source: 'policy', kind: 'policy_not_configured', target: '' }]);
  }
  const projectRoot = await fsp.realpath(projectDir).catch(() => '');
  const preparedRealPath = await fsp.realpath(preparedPath).catch(() => '');
  if (!projectRoot || !preparedRealPath || !isContained(projectRoot, preparedRealPath)) {
    throw createPolicyError(security.frameId, [{ source: 'policy', kind: 'document_outside_project', target: preparedPath }]);
  }
  const imagePaths = new Set();
  for (const asset of (Array.isArray(security.assets) ? security.assets : [])) {
    const mediaType = String(asset?.media_type || asset?.type || '').trim().toLowerCase();
    if (mediaType !== 'image' && !mediaType.startsWith('image/')) continue;
    const relativePath = String(asset?.path || '').trim();
    if (!relativePath) continue;
    const lexicalPath = path.resolve(projectRoot, relativePath);
    if (!isContained(projectRoot, lexicalPath)) continue;
    const realPath = await fsp.realpath(lexicalPath).catch(() => '');
    if (realPath && isContained(projectRoot, realPath)) imagePaths.add(pathKey(realPath));
  }
  return {
    projectRoot,
    preparedPath: preparedRealPath,
    preparedKey: pathKey(preparedRealPath),
    frameId: String(security.frameId || '').trim(),
    imagePaths,
    async decide(rawUrl, resourceType) {
      let parsed;
      try {
        parsed = new URL(rawUrl);
      } catch {
        return { allow: false, kind: 'invalid_url' };
      }
      if (parsed.protocol !== 'file:' || (parsed.hostname && parsed.hostname !== 'localhost')) {
        return { allow: false, kind: parsed.protocol === 'data:' ? 'data_resource' : parsed.protocol === 'blob:' ? 'blob_resource' : 'remote_or_disallowed_scheme' };
      }
      let requestedPath;
      try {
        requestedPath = await fsp.realpath(fileURLToPath(parsed));
      } catch {
        return { allow: false, kind: 'missing_file' };
      }
      if (!isContained(projectRoot, requestedPath)) return { allow: false, kind: 'file_outside_project' };
      const requestedKey = pathKey(requestedPath);
      if (resourceType === 'document') {
        return requestedKey === this.preparedKey
          ? { allow: true }
          : { allow: false, kind: 'unexpected_document' };
      }
      if (resourceType === 'image') {
        return imagePaths.has(requestedKey)
          ? { allow: true }
          : { allow: false, kind: 'unregistered_local_image' };
      }
      const extensions = RESOURCE_EXTENSIONS[resourceType];
      if (extensions && extensions.has(path.extname(requestedPath).toLowerCase())) return { allow: true };
      return { allow: false, kind: 'disallowed_resource_type' };
    },
  };
}

function createPolicyError(frameId, violations = []) {
  const error = createRenderError(
    POLICY_ERROR_CODE,
    'html-video 引用了未登记图片或不允许的运行时资源，已停止渲染。',
  );
  error.frame_id = String(frameId || '');
  error.details = {
    frame_id: error.frame_id,
    violations: violations.map(item => ({ ...item, target: sanitizedTarget(item?.target || item?.url || '') })),
  };
  return error;
}

function throwIfPolicyViolated(collector) {
  const violations = collector.values();
  if (violations.length) throw createPolicyError(violations[0]?.frame_id, violations);
}

async function installRuntimeAssetPolicy({ context, page, policy, collector }) {
  if (!context?.route || !context?.routeWebSocket || !context?.on || !page?.exposeBinding || !page?.addInitScript || !page?.on) {
    collector.add({ source: 'policy', kind: 'route_api_unavailable' });
    throwIfPolicyViolated(collector);
  }
  await context.route('**/*', async route => {
    const request = route.request();
    let decision = { allow: false, kind: 'route_decision_failed' };
    try {
      decision = await policy.decide(request.url(), request.resourceType());
    } catch {}
    if (decision.allow) {
      await route.continue();
      return;
    }
    collector.add({ source: 'route', kind: decision.kind, resource_type: request.resourceType(), url: request.url() });
    await route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', async webSocketRoute => {
    collector.add({ source: 'websocket', kind: 'websocket_blocked', resource_type: 'websocket', url: webSocketRoute.url?.() || '' });
    await webSocketRoute.close({ code: 1008, reason: 'html-video 运行时禁止 WebSocket。' });
  });
  context.on('page', extraPage => {
    if (extraPage !== page) collector.add({ source: 'browser', kind: 'unexpected_page', resource_type: 'document', url: extraPage.url?.() || '' });
  });
  page.on('popup', popup => collector.add({ source: 'browser', kind: 'popup_blocked', resource_type: 'document', url: popup.url?.() || '' }));
  page.on('download', download => collector.add({ source: 'browser', kind: 'download_blocked', url: download.url?.() || '' }));
  page.on('crash', () => collector.add({ source: 'browser', kind: 'page_crash' }));
  page.on('framenavigated', async frame => {
    if (frame !== page.mainFrame?.()) return;
    const decision = await policy.decide(frame.url?.() || '', 'document').catch(() => ({ allow: false }));
    if (!decision.allow) collector.add({ source: 'browser', kind: 'unexpected_navigation', resource_type: 'document', url: frame.url?.() || '' });
  });
  await page.exposeBinding('__hvReportSecurityPolicyViolation', (_source, violation) => {
    collector.add({
      source: 'csp',
      kind: 'csp_violation',
      resource_type: violation?.effectiveDirective || '',
      url: violation?.blockedURI || '',
      directive: violation?.violatedDirective || '',
    });
  });
  await page.addInitScript(() => {
    const report = window.__hvReportSecurityPolicyViolation;
    try {
      Object.defineProperty(window, '__hvReportSecurityPolicyViolation', {
        value: report,
        writable: false,
        configurable: false,
      });
    } catch (_) {}
    document.addEventListener('securitypolicyviolation', event => {
      report?.({
        blockedURI: event.blockedURI,
        violatedDirective: event.violatedDirective,
        effectiveDirective: event.effectiveDirective,
      });
    });
  });
}

async function render(input = {}, ctx = {}, deps = {}) {
  const startedAt = Date.now();
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  const config = normalizeConfig(input.config || input);
  const sourcePath = input.template?.sourcePath || input.sourcePath || input.htmlPath || input.html_path;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw createRenderError('template-invalid', '未找到 html-video 模板入口 HTML。');
  }

  await fsp.mkdir(path.dirname(config.outputPath), { recursive: true });
  const recordDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hv-render-'));
  let browser;
  let cleanupPrepared;
  let webmPath = '';
  let leadInMs = 0;
  let totalDuration = config.duration;
  let collector;
  const pageErrors = [];

  try {
    report(ctx, 5, '正在准备 html-video 渲染...');

    // 对应 html-video 源码段：launch chromium headless。
    report(ctx, 15, '正在启动 Playwright Chromium...');
    const playwright = await loadPlaywright(deps.importPlaywright);
    browser = await playwright.chromium.launch({
      channel: 'chrome',
      headless: true,
      chromiumSandbox: true,
    });

    // 对应 html-video 源码段：recordVideo，context 创建即开始录制。
    const tWebmStart = now();
    const context = await browser.newContext({
      viewport: { width: config.width, height: config.height },
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      recordVideo: {
        dir: recordDir,
        size: { width: config.width, height: config.height },
      },
    });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error?.message || String(error)));

    // goto 之前置受控标志：scene_html 时间线脚本据此不挂 5s 兜底自启，
    // 避免预加载 >5s 时兜底抢先起钟、adapter 的显式启动被幂等吞掉导致 origin 偏移。
    await page.addInitScript(clockSource => {
      window.__mpAdapterControlled = true;
      (0, eval)(clockSource);
      const clock = window.__hvPlaybackClock;
      if (!clock || clock.__hvOwner !== 'musedock-playback-clock-v1' || typeof clock.play !== 'function') {
        throw new Error('无法安装 html-video 共享播放时钟。');
      }
      Object.freeze(clock);
      Object.defineProperty(window, '__hvPlaybackClock', { value: clock, writable: false, configurable: false });
    }, buildPlaybackClockSource());

    // 对应 html-video 源码段：page.addInitScript 冻结 CSS/SMIL 动画。
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.id = '__hv_freeze';
      style.textContent = [
        '*, *::before, *::after {',
        'animation-play-state: paused !important;',
        '-webkit-animation-play-state: paused !important;',
        '}',
        'svg * {',
        'animation-play-state: paused !important;',
        '}',
      ].join('');
      const pauseSmil = () => {
        document.querySelectorAll('svg').forEach(svg => {
          if (typeof svg.pauseAnimations === 'function') svg.pauseAnimations();
        });
      };
      const attach = () => {
        if (!document.documentElement) return;
        (document.head || document.documentElement).appendChild(style);
        pauseSmil();
        observer.observe(document.documentElement, { childList: true, subtree: true });
      };
      const observer = new MutationObserver(pauseSmil);
      if (document.head || document.documentElement) attach();
      else document.addEventListener('DOMContentLoaded', attach, { once: true });
      window.__hvUnfreeze = () => {
        observer.disconnect();
        document.getElementById('__hv_freeze')?.remove();
        document.querySelectorAll('svg').forEach(svg => {
          if (typeof svg.unpauseAnimations === 'function') svg.unpauseAnimations();
        });
      };
    });

    report(ctx, 30, '正在加载 html-video 模板...');
    const prepared = await prepareSourceHtml(sourcePath, { projectDir: input.security?.projectDir });
    cleanupPrepared = prepared.cleanup;
    const policy = await createRuntimeAssetPolicy({ security: input.security, preparedPath: prepared.loadPath });
    collector = createViolationCollector(policy.frameId, policy.projectRoot);
    await installRuntimeAssetPolicy({ context, page, policy, collector });

    // 对应 html-video 源码段：page.goto(file://..., domcontentloaded)。
    // 显式 45s 超时，避免模板异常时卡在默认导航等待里拖垮整条渲染任务。
    try {
      await page.goto(pathToFileURL(prepared.loadPath).href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (error) {
      throwIfPolicyViolated(collector);
      throw createRenderError('render-goto-timeout', `加载 html-video 模板超时或失败：${error.message}`);
    }
    throwIfPolicyViolated(collector);
    await calibratePlaybackClock(page);

    // 对应 html-video 源码段：等待 stylesheet、逐个 fonts.load、fonts.ready。
    report(ctx, 32, '正在加载字体和样式...');
    await waitForStylesAndFonts(page);
    await waitForRenderReady(page, config);
    await waitForManagedShotImages(page, Number(deps.managedShotImageTimeoutMs) || 10000);
    throwIfPolicyViolated(collector);
    await assertManagedVisualRuntime(page);
    throwIfPageErrored(pageErrors, 'render-playback-start-failed');

    await page.waitForTimeout(100);

    // 对应 html-video 源码段：探测 CSS animation 与 GSAP finite timeline。
    if (config.durationMode !== 'explicit') {
      const animationMs = await probeAnimationDurationMs(page);
      const needed = Math.min(30, (animationMs + 400) / 1000);
      if (needed > totalDuration) totalDuration = needed;
    } else {
      await probeAnimationDurationMs(page).catch(() => 0);
    }
    throwIfPolicyViolated(collector);
    throwIfPageErrored(pageErrors, 'render-playback-start-failed');
    await preflightPlaybackClock(page, Number(deps.playbackClockPreflightTimeoutMs) || 1000);
    await calibratePlaybackClock(page);

    // 正式录制起点：animation、解冻和 scene-local 时钟必须在同一个 JS task 启动，
    // 避免多个 evaluate 往返让 Caption/Beat/Shot 产生不同时间原点。
    const startup = await page.evaluate(() => {
      const errors = [];
      const attempt = (name, action) => {
        try { action(); } catch (error) { errors.push(`${name}: ${error?.message || String(error)}`); }
      };
      window.__hvPlayed = true;
      attempt('__hvPlaybackClock.reset', () => {
        if (!window.__hvPlaybackClock) return;
        if (window.__hvPlaybackClock.__hvOwner !== 'musedock-playback-clock-v1'
          || typeof window.__hvPlaybackClock.pause !== 'function'
          || typeof window.__hvPlaybackClock.setTime !== 'function'
          || typeof window.__hvPlaybackClock.play !== 'function'
          || typeof window.__hvPlaybackClock.timeSec !== 'function'
          || typeof window.__hvPlaybackClock.paused !== 'function') {
          throw new Error('检测到不可信共享播放时钟。');
        }
        window.__hvPlaybackClock.pause();
        window.__hvPlaybackClock.setTime(0);
        if (window.__hvPlaybackClock.paused() !== true || Math.abs(window.__hvPlaybackClock.timeSec()) > 0.001) {
          throw new Error('共享播放时钟未归零。');
        }
      });
      attempt('__hvPlayAll', () => { if (typeof window.__hvPlayAll === 'function') window.__hvPlayAll(); });
      attempt('__hvUnfreeze', () => { if (typeof window.__hvUnfreeze === 'function') window.__hvUnfreeze(); });
      attempt('__hvPlaybackClock', () => {
        if (window.__hvPlaybackClock) {
          window.__hvPlaybackClock.play();
          if (window.__hvPlaybackClock.paused() !== false) throw new Error('共享播放时钟未进入 running 状态。');
          if (Math.abs(window.__hvPlaybackClock.timeSec()) > 0.05) throw new Error('共享播放时钟未从 Scene 起点启动。');
        } else if (typeof window.__mpStartBeatClock === 'function') {
          window.__mpStartBeatClock();
        }
      });
      return { success: errors.length === 0, errors };
    }).catch(error => ({ success: false, errors: [`evaluate: ${error?.message || String(error)}`] }));
    if (pageErrors.length || !startup?.success) {
      const errors = [...pageErrors, ...(Array.isArray(startup?.errors) ? startup.errors : [])];
      const startupError = createRenderError('render-playback-start-failed', `html-video 播放启动失败：${errors.join('；') || '未知错误'}`);
      startupError.details = { errors };
      throw startupError;
    }
    await assertManagedVisualRuntime(page);

    // 对应 html-video 源码段：记录 leadInMs，后续由 ffmpeg -ss 裁剪。
    leadInMs = now() - tWebmStart;

    report(ctx, 40, `正在录制 ${totalDuration}s html-video 帧...`);
    await waitWithProgress(page, ctx, totalDuration, async () => {
      throwIfPolicyViolated(collector);
      throwIfPageErrored(pageErrors);
      await assertManagedVisualRuntime(page);
    });
    await page.waitForTimeout(RECORD_TAIL_BUFFER_MS).catch(() => {});
    throwIfPolicyViolated(collector);
    throwIfPageErrored(pageErrors);
    await assertManagedVisualRuntime(page);

    report(ctx, 85, '正在结束浏览器录制...');
    throwIfPolicyViolated(collector);
    throwIfPageErrored(pageErrors);
    await assertManagedVisualRuntime(page);
    await context.close();
    await new Promise(resolve => setImmediate(resolve));
    throwIfPolicyViolated(collector);
    throwIfPageErrored(pageErrors);
    webmPath = await findLatestWebm(recordDir);
    if (!webmPath) {
      throw createRenderError('render-failed', 'Playwright 未生成 webm 录制文件。');
    }
  } catch (error) {
    if (error && error.code === 'environment_not_configured') throw error;
    if (/playwright/i.test(error && error.message ? error.message : '')) {
      throw createRenderError('environment_not_configured', 'Playwright Chromium 未配置，无法渲染 html-video 模板。', error);
    }
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (cleanupPrepared) await cleanupPrepared().catch(() => {});
    if (!webmPath) await fsp.rm(recordDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  }

  try {
    throwIfPageErrored(pageErrors);
    report(ctx, 90, '正在编码 MP4...');
    const ffmpegPath = deps.ffmpegPath || await resolveFfmpegPath(deps);
    const probeDeps = { ...deps, ffmpegPath };
    const inputDurationSec = await probeMediaDurationSec(webmPath, probeDeps);
    const ffmpegBuild = buildFfmpegArgs({
      webmPath,
      outputPath: config.outputPath,
      fps: config.fps,
      duration: totalDuration,
      explicit: config.durationMode === 'explicit',
      leadInMs,
      inputDurationSec,
    });
    const ffmpegResult = await runFfmpegCommand(ffmpegPath, ffmpegBuild.args, deps.runFfmpeg);
    if (!ffmpegResult.ok) {
      throw createRenderError(
        'render-failed',
        `ffmpeg 编码 html-video 失败：${ffmpegResult.stderr || ffmpegResult.error || `exit ${ffmpegResult.code}`}`,
      );
    }

    const stat = await fsp.stat(config.outputPath).catch(() => ({ size: 0 }));
    const hasValidVideoStream = stat.size > 2048
      && await outputHasVideoStream(config.outputPath, probeDeps);
    if (!hasValidVideoStream) {
      throw createRenderError('render-failed', 'html-video 编码完成但输出视频无有效画面流。');
    }
    report(ctx, 100, 'html-video 帧渲染完成。');
    return {
    outputPath: config.outputPath,
    output_path: config.outputPath,
    meta: {
      durationSec: totalDuration,
      leadTrim: ffmpegBuild.seek,
      fileSizeBytes: stat.size,
      actualResolution: { width: config.width, height: config.height },
      fps: config.fps,
      renderedFrames: Math.round(totalDuration * config.fps),
      renderWallClockSec: (Date.now() - startedAt) / 1000,
      engineVersion: `hyperframes-playwright@${ADAPTER_VERSION}`,
      leadInMs,
    },
    diagnostics: [{
      code: 'frame_rendered',
      stage: 'render',
      message: '已通过 Playwright/Chromium 录制并使用 ffmpeg libx264 编码。',
      fallback_allowed: false,
    },
    ...(ffmpegBuild.seek.clamped || ffmpegBuild.seek.skipped ? [{
      code: 'lead_in_trim_degraded',
      stage: 'render',
      severity: 'warning',
      message: `录制前导裁剪不完整（请求 ${ffmpegBuild.seek.requested_sec}s，实际 ${ffmpegBuild.seek.applied_sec}s），画面开头可能残留空白帧。`,
      details: {
        lead_in_ms: leadInMs,
        webm_duration_sec: inputDurationSec ?? null,
        requested_seek_sec: ffmpegBuild.seek.requested_sec,
        applied_seek_sec: ffmpegBuild.seek.applied_sec,
      },
      fallback_allowed: true,
    }] : [])],
    };
  } finally {
    await fsp.rm(recordDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  }
}

function normalizeConfig(config) {
  const resolution = config.resolution || {};
  const width = Number(resolution.width || config.width || DEFAULT_RENDER_RESOLUTION.width);
  const height = Number(resolution.height || config.height || DEFAULT_RENDER_RESOLUTION.height);
  const duration = config.duration === 'auto'
    ? 5
    : Math.max(0.5, Number(config.duration || config.duration_sec || 5));
  return {
    outputPath: config.outputPath || config.output_path || path.resolve('output.mp4'),
    width,
    height,
    fps: Number(config.fps || 30),
    duration,
    durationMode: config.durationMode || config.duration_mode || (config.duration === 'auto' ? 'auto' : 'explicit'),
  };
}

async function loadPlaywright(importPlaywright) {
  try {
    return importPlaywright ? await importPlaywright() : await import('playwright-core');
  } catch (error) {
    throw createRenderError(
      'environment_not_configured',
      'Playwright Chromium 未配置，无法渲染 html-video 模板。',
      error,
    );
  }
}

async function waitForStylesAndFonts(page) {
  return page.evaluate(() => new Promise(resolve => {
    const fonts = document.fonts;
    if (!fonts || typeof fonts.ready?.then !== 'function') {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    };
    const cap = setTimeout(finish, 8000);
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    const linkDone = links.map(link => {
      try {
        if (link.sheet && link.sheet.cssRules) return Promise.resolve();
      } catch (_) {}
      return new Promise(done => {
        const finishLink = () => done();
        link.addEventListener('load', finishLink, { once: true });
        link.addEventListener('error', finishLink, { once: true });
        setTimeout(finishLink, 6000);
      });
    });
    Promise.all(linkDone)
      .then(() => {
        const loads = [];
        fonts.forEach(face => {
          try {
            loads.push(face.load().catch(() => undefined));
          } catch (_) {}
        });
        return Promise.all(loads);
      })
      .then(() => fonts.ready)
      .then(() => {
        clearTimeout(cap);
        finish();
      })
      .catch(() => {
        clearTimeout(cap);
        finish();
      });
  })).catch(() => {});
}

async function probeAnimationDurationMs(page) {
  return page.evaluate(() => {
    let cssMaxMs = 0;
    Array.from(document.querySelectorAll('*')).forEach(el => {
      const style = getComputedStyle(el);
      const durations = (style.animationDuration || '').split(',');
      const delays = (style.animationDelay || '').split(',');
      const iterations = (style.animationIterationCount || '').split(',');
      durations.forEach((durationText, index) => {
        if ((iterations[index] || '').trim() === 'infinite') return;
        const durationMs = cssTimeToMs(durationText);
        const delayMs = cssTimeToMs(delays[index] || '0s');
        cssMaxMs = Math.max(cssMaxMs, durationMs + delayMs);
      });
    });

    const gsap = window.gsap;
    let gsapMaxMs = 0;
    const children = gsap?.globalTimeline?.getChildren?.(true, true, true) || [];
    children.forEach(child => {
      const repeat = typeof child.repeat === 'function' ? child.repeat() : (child.vars?.repeat || 0);
      if (repeat === -1) return;
      const totalDuration = typeof child.totalDuration === 'function' ? child.totalDuration() : 0;
      if (Number.isFinite(totalDuration)) gsapMaxMs = Math.max(gsapMaxMs, totalDuration * 1000);
    });
    return Math.max(cssMaxMs, gsapMaxMs);

    function cssTimeToMs(value) {
      const text = String(value || '').trim();
      if (!text) return 0;
      if (text.endsWith('ms')) return Number.parseFloat(text) || 0;
      if (text.endsWith('s')) return (Number.parseFloat(text) || 0) * 1000;
      return (Number.parseFloat(text) || 0) * 1000;
    }
  }).catch(() => 0);
}

async function waitWithProgress(page, ctx, durationSec, checkPolicy = null) {
  const totalMs = Math.round(durationSec * 1000);
  const started = Date.now();
  while (Date.now() - started < totalMs) {
    const remaining = totalMs - (Date.now() - started);
    await page.waitForTimeout(Math.min(250, Math.max(0, remaining)));
    const elapsed = Math.min(totalMs, Date.now() - started);
    if (checkPolicy) await checkPolicy();
    report(ctx, 40 + Math.floor((elapsed / totalMs) * 45), '正在录制 html-video 帧...');
  }
}

async function waitForRenderReady(page, config = {}) {
  if (typeof page?.waitForFunction !== 'function') return;
  await page.waitForFunction(({ width, height }) => new Promise(resolve => {
    const ready = () => {
      const body = document.body;
      const root = document.querySelector('[data-hv-canvas], #root, main, body');
      const rect = root?.getBoundingClientRect?.();
      const fontsReady = !document.fonts || document.fonts.status !== 'loading';
      return document.readyState !== 'loading'
        && fontsReady
        && body
        && body.scrollWidth > 0
        && body.scrollHeight > 0
        && rect
        && rect.width >= Math.min(64, width || 64)
        && rect.height >= Math.min(64, height || 64);
    };
    const check = () => {
      if (!ready()) {
        requestAnimationFrame(check);
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
    };
    check();
  }), { width: config.width, height: config.height }, { timeout: 5000 }).catch(() => {});
}

async function waitForManagedShotImages(page, timeoutMs = 10000) {
  let timeout;
  const evaluation = page.evaluate(() => (async () => {
      const marker = 'managed-shot-images';
      const images = Array.from(document.querySelectorAll('[data-hv-shot] img'));
      try {
        await Promise.all(images.map(async image => {
          if (typeof image.decode === 'function') await image.decode();
          if (!image.complete || image.naturalWidth <= 0) throw new Error(`图片不可解码：${image.getAttribute('src') || ''}`);
        }));
        return { success: true, count: images.length, marker };
      } catch (error) {
        return { success: false, count: images.length, message: error?.message || String(error), marker };
      }
    })()).catch(error => ({ success: false, message: error?.message || String(error) }));
  const result = await Promise.race([
    evaluation,
    new Promise(resolve => { timeout = setTimeout(() => resolve({ success: false, message: '受管 Shot 图片解码超时。' }), timeoutMs); }),
  ]).finally(() => clearTimeout(timeout));
  if (result?.success) return result;
  const error = createRenderError('render-shot-image-not-ready', `html-video 受管 Shot 图片未就绪：${result?.message || '未知错误'}`);
  error.details = { message: result?.message || '', count: Number(result?.count) || 0 };
  throw error;
}

async function calibratePlaybackClock(page) {
  const result = await page.evaluate(() => {
    const clock = window.__hvPlaybackClock;
    if (!clock) return { success: true, applied: false };
    try {
      if (clock.__hvOwner !== 'musedock-playback-clock-v1'
        || typeof clock.pause !== 'function'
        || typeof clock.setTime !== 'function'
        || typeof clock.timeSec !== 'function'
        || typeof clock.paused !== 'function') throw new Error('检测到不可信共享播放时钟。');
      clock.pause();
      clock.setTime(0);
      if (clock.paused() !== true || Math.abs(clock.timeSec()) > 0.001) throw new Error('共享播放时钟未归零。');
      return { success: true, applied: true };
    } catch (error) {
      return { success: false, message: error?.message || String(error) };
    }
  }).catch(error => ({ success: false, message: error?.message || String(error) }));
  if (result?.success !== false) return result;
  throw createRenderError('render-playback-start-failed', `html-video 播放时钟预加载校准失败：${result.message || '未知错误'}`);
}

async function preflightPlaybackClock(page, timeoutMs = 1000) {
  let timeout;
  const evaluation = page.evaluate(() => new Promise(resolve => {
    const clock = window.__hvPlaybackClock;
    if (!clock) { resolve({ success: true, applied: false }); return; }
    try {
      clock.pause();
      clock.setTime(0);
      let unsubscribe = () => {};
      unsubscribe = clock.subscribe(time => {
        if (!(time > 0)) return;
        unsubscribe();
        resolve({ success: true, applied: true, time });
      });
      clock.play();
    } catch (error) {
      resolve({ success: false, message: error?.message || String(error) });
    }
  })).catch(error => ({ success: false, message: error?.message || String(error) }));
  const result = await Promise.race([
    evaluation,
    new Promise(resolve => { timeout = setTimeout(() => resolve({ success: false, message: '共享播放时钟未产生真实 tick。' }), timeoutMs); }),
  ]).finally(() => clearTimeout(timeout));
  if (result?.success !== false) return result;
  throw createRenderError('render-playback-start-failed', `html-video 播放时钟自检失败：${result.message || '未知错误'}`);
}

async function assertManagedVisualRuntime(page) {
  const result = await page.evaluate(() => {
    const root = document.querySelector('[data-hv-image-sequence]');
    if (!root) return { success: true, applied: false };
    if (!window.__hvManagedVisualGuardCheck) {
      const violations = [];
      const dirty = new Set();
      const properties = ['content', 'backgroundImage', 'maskImage', 'webkitMaskImage', 'borderImageSource', 'listStyleImage', 'filter', 'cursor', 'clipPath'];
      const protectedAttributes = new Set([
        'data-sequence-mode', 'data-scene-id', 'data-shot-id', 'data-asset-id',
        'data-window-start-sec', 'data-window-end-sec', 'data-time-base', 'data-shot-role',
        'data-shot-requirement', 'data-caption-ids', 'data-minimum-visible-duration-sec',
        'data-shot-layer', 'src', 'srcset', 'href', 'xlink:href', 'poster',
      ]);
      const current = new URL(location.href);
      current.hash = '';
      const lock = violation => { violations.push(violation); };
      const externalUrls = value => {
        const urls = [];
        for (const match of String(value || '').matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi)) {
          const raw = match[1] ?? match[2] ?? match[3] ?? '';
          try {
            const target = new URL(raw, location.href);
            const withoutHash = new URL(target.href);
            withoutHash.hash = '';
            if (!target.hash || withoutHash.href !== current.href) urls.push(target.href);
          } catch {
            urls.push(raw);
          }
        }
        return urls;
      };
      const shots = Array.from(root.children);
      const managedImages = new Set();
      const contract = {
        mode: root.getAttribute('data-sequence-mode') || '',
        scene_id: root.getAttribute('data-scene-id') || '',
        shots: shots.map(shot => {
          const images = Array.from(shot.children).filter(child => child.tagName?.toLowerCase() === 'img');
          images.forEach(image => managedImages.add(image));
          return {
            tag: shot.tagName?.toLowerCase() || '',
            id: shot.getAttribute('data-shot-id') || '',
            asset_id: shot.getAttribute('data-asset-id') || '',
            start: shot.getAttribute('data-window-start-sec') || '',
            end: shot.getAttribute('data-window-end-sec') || '',
            time_base: shot.getAttribute('data-time-base') || '',
            role: shot.getAttribute('data-shot-role') || '',
            requirement: shot.getAttribute('data-shot-requirement') || '',
            caption_ids: shot.getAttribute('data-caption-ids') || '',
            minimum: shot.getAttribute('data-minimum-visible-duration-sec') || '',
            child_count: shot.children.length,
            images: images.map(image => ({
              layer: image.getAttribute('data-shot-layer') || '',
              src: image.getAttribute('src') || '',
              current_src: image.currentSrc || '',
            })),
          };
        }),
      };
      const contractJson = JSON.stringify(contract);
      if (!contract.mode || !contract.scene_id || !contract.shots.length || contract.shots.some(shot => (
        shot.tag !== 'figure' || !shot.id || !shot.asset_id || !shot.start || !shot.end
        || shot.time_base !== 'scene_local' || !shot.minimum
        || shot.child_count !== 2 || shot.images.length !== 2
        || shot.images[0].layer !== 'background' || shot.images[1].layer !== 'foreground'
        || !shot.images[0].src || !shot.images[1].src || !shot.images[0].current_src || !shot.images[1].current_src
      ))) lock({ kind: 'managed_contract_incomplete' });
      const readContract = () => JSON.stringify({
        mode: root.getAttribute('data-sequence-mode') || '',
        scene_id: root.getAttribute('data-scene-id') || '',
        shots: Array.from(root.children).map(shot => ({
          tag: shot.tagName?.toLowerCase() || '',
          id: shot.getAttribute('data-shot-id') || '',
          asset_id: shot.getAttribute('data-asset-id') || '',
          start: shot.getAttribute('data-window-start-sec') || '',
          end: shot.getAttribute('data-window-end-sec') || '',
          time_base: shot.getAttribute('data-time-base') || '',
          role: shot.getAttribute('data-shot-role') || '',
          requirement: shot.getAttribute('data-shot-requirement') || '',
          caption_ids: shot.getAttribute('data-caption-ids') || '',
          minimum: shot.getAttribute('data-minimum-visible-duration-sec') || '',
          child_count: shot.children.length,
          images: Array.from(shot.children).filter(child => child.tagName?.toLowerCase() === 'img').map(image => ({
            layer: image.getAttribute('data-shot-layer') || '',
            src: image.getAttribute('src') || '',
            current_src: image.currentSrc || '',
          })),
        })),
      });
      const scanElement = element => {
        if (!(element instanceof Element)) return;
        if (element.matches('img,picture source,svg image,video[poster],input[type="image" i]') && !managedImages.has(element)) {
          lock({ kind: 'unmanaged_visual_element', tag: element.tagName.toLowerCase() });
        }
        for (const pseudo of [null, '::before', '::after']) {
          const style = getComputedStyle(element, pseudo);
          for (const property of properties) {
            const urls = externalUrls(style[property]);
            if (urls.length) lock({ kind: 'unmanaged_computed_visual', tag: element.tagName.toLowerCase(), pseudo: pseudo || '', property, urls });
          }
        }
      };
      const scanTree = node => {
        if (node instanceof Element) scanElement(node);
        node.querySelectorAll?.('*').forEach(scanElement);
      };
      scanTree(document.documentElement);
      const observer = new MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'childList') {
            const touchesRoot = record.target === root || root.contains(record.target)
              || Array.from(record.addedNodes).some(node => node === root || (node instanceof Element && node.contains(root)))
              || Array.from(record.removedNodes).some(node => node === root || managedImages.has(node) || (node instanceof Element && Array.from(managedImages).some(image => node.contains(image))));
            if (touchesRoot) lock({ kind: 'managed_contract_child_mutation' });
            record.addedNodes.forEach(scanTree);
            record.removedNodes.forEach(scanTree);
            if (record.target instanceof Element) dirty.add(record.target);
          } else if (record.type === 'attributes') {
            const target = record.target;
            if ((target === root || root.contains(target)) && protectedAttributes.has(record.attributeName)) {
              lock({ kind: 'managed_contract_attribute_mutation', attribute: record.attributeName });
            }
            dirty.add(target);
          }
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [...protectedAttributes, 'class', 'style'],
      });
      const check = () => {
        if (!root.isConnected || readContract() !== contractJson) lock({ kind: 'managed_contract_changed' });
        const pending = Array.from(dirty);
        dirty.clear();
        pending.forEach(scanTree);
        return violations.length ? { success: false, offenders: violations.slice() } : { success: true, applied: true };
      };
      Object.defineProperty(window, '__hvManagedVisualGuardCheck', { value: check, writable: false, configurable: false });
    }
    return window.__hvManagedVisualGuardCheck();
  }).catch(error => ({ success: false, message: error?.message || String(error), offenders: [] }));
  if (result?.success !== false) return result;
  const error = createRenderError('frame_html_shot_contract_invalid', `Image Sequence 运行时发现未受管视觉素材：${result.message || '模型美术壳不得创建外部视觉元素。'}`);
  error.retryable = true;
  error.repair_action = 'retry_frame_html';
  error.details = { validation_code: 'frame_html_shot_contract_invalid', offenders: result.offenders || [] };
  throw error;
}

function throwIfPageErrored(pageErrors = [], code = 'render-playback-runtime-failed') {
  if (!pageErrors.length) return;
  const errors = [...pageErrors];
  const error = createRenderError(code, `html-video 页面脚本运行失败：${errors.join('；')}`);
  error.details = { errors };
  throw error;
}

function buildFfmpegArgs({ webmPath, outputPath, fps, duration, explicit, leadInMs, inputDurationSec }) {
  const requestedSeekSec = leadInMs > 200 ? Math.max(0, (leadInMs - 120) / 1000) : 0;
  const outputDurationSec = Number(duration);
  const sourceDurationSec = Number(inputDurationSec);
  let seekSec = 0;
  if (requestedSeekSec > 0
    && Number.isFinite(outputDurationSec) && outputDurationSec > 0
    && Number.isFinite(sourceDurationSec) && sourceDurationSec > 0) {
    // 裁掉录制前导白帧；webm 余量不足时钳制到最大安全 seek，而不是静默放弃
    const maxSafeSeekSec = sourceDurationSec - outputDurationSec - 0.1;
    seekSec = Math.max(0, Math.min(requestedSeekSec, maxSafeSeekSec));
  }
  const args = [
    '-y',
    ...(seekSec > 0 ? ['-ss', seekSec.toFixed(3)] : []),
    '-i', webmPath,
    ...(explicit ? ['-vf', `tpad=stop_mode=clone:stop_duration=${duration}`] : []),
    '-t', String(duration),
    '-r', String(fps),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'medium',
    '-crf', '20',
    '-movflags', '+faststart',
    outputPath,
  ];
  return {
    args,
    seek: {
      requested_sec: Number(requestedSeekSec.toFixed(3)),
      applied_sec: Number(seekSec.toFixed(3)),
      clamped: requestedSeekSec > 0 && seekSec > 0 && seekSec < requestedSeekSec,
      skipped: requestedSeekSec > 0 && seekSec === 0,
    },
  };
}

async function probeMediaDurationSec(videoPath, deps = {}) {
  if (typeof deps.probeWebmDurationSec === 'function') {
    const injected = await deps.probeWebmDurationSec(videoPath);
    const duration = Number(injected);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  }
  const ffprobe = getFfprobeCommand(deps);
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ];
  const result = await runFfprobeCommand(ffprobe, args, deps.runFfprobe);
  if (!result.ok) return null;
  const duration = Number.parseFloat(String(result.stdout || '').trim());
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

async function outputHasVideoStream(videoPath, deps = {}) {
  if (typeof deps.probeVideoStreams === 'function') {
    const streams = await deps.probeVideoStreams(videoPath);
    return hasVideoStream(streams);
  }
  const ffprobe = getFfprobeCommand(deps);
  const args = [
    '-v', 'error',
    '-select_streams', 'v',
    '-show_entries', 'stream=codec_type',
    '-of', 'json',
    videoPath,
  ];
  const result = await runFfprobeCommand(ffprobe, args, deps.runFfprobe);
  if (!result.ok) return false;
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    return hasVideoStream(parsed.streams);
  } catch (_) {
    return false;
  }
}

function hasVideoStream(streams) {
  return Array.isArray(streams) && streams.some(stream => stream && stream.codec_type === 'video');
}

function getFfprobeCommand(deps = {}) {
  if (deps.ffprobePath) return deps.ffprobePath;
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const ffmpegPath = deps.ffmpegPath || '';
  if (ffmpegPath && ffmpegPath.includes(path.sep)) {
    const adjacent = path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fs.existsSync(adjacent)) return adjacent;
  }
  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer && installer.path) {
      const adjacent = path.join(path.dirname(installer.path), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
      if (fs.existsSync(adjacent)) return adjacent;
    }
  } catch (_) {}
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
}

function runFfprobeCommand(command, args, injectedRunner) {
  if (injectedRunner) return injectedRunner(command, args);
  return runFfmpegCommand(command, args);
}

function runFfmpegCommand(command, args, injectedRunner) {
  if (injectedRunner) return injectedRunner(command, args);
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, code: null, error: error.message, stdout: '', stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', error => {
      resolve({ ok: false, code: null, error: error.message, stdout, stderr });
    });
    child.on('close', code => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function findLatestWebm(recordDir) {
  const files = await fsp.readdir(recordDir).catch(() => []);
  const webms = [];
  for (const file of files) {
    if (!file.toLowerCase().endsWith('.webm')) continue;
    const filePath = path.join(recordDir, file);
    const stat = await fsp.stat(filePath).catch(() => null);
    if (stat) webms.push({ filePath, mtimeMs: stat.mtimeMs });
  }
  webms.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return webms[0]?.filePath || '';
}

function createRenderError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function report(ctx, percent, message) {
  if (typeof ctx.onProgress === 'function') ctx.onProgress(percent, message);
}

module.exports = {
  render,
  buildFfmpegArgs,
  createRuntimeAssetPolicy,
  createViolationCollector,
  installRuntimeAssetPolicy,
  assertManagedVisualRuntime,
  preflightPlaybackClock,
  waitForManagedShotImages,
  throwIfPolicyViolated,
};
