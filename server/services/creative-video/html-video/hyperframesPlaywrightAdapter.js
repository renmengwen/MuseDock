const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

const { prepareSourceHtml } = require('./prepareSourceHtml');
const { resolveFfmpegPath } = require('./environmentDoctor');

const ADAPTER_VERSION = '0.1.0-playwright';
const DEFAULT_RENDER_RESOLUTION = { width: 1920, height: 1080 };

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

  try {
    report(ctx, 5, '正在准备 html-video 渲染...');

    // 对应 html-video 源码段：launch chromium headless。
    report(ctx, 15, '正在启动 Playwright Chromium...');
    const playwright = await loadPlaywright(deps.importPlaywright);
    browser = await playwright.chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });

    // 对应 html-video 源码段：recordVideo，context 创建即开始录制。
    const tWebmStart = now();
    const context = await browser.newContext({
      viewport: { width: config.width, height: config.height },
      deviceScaleFactor: 1,
      recordVideo: {
        dir: recordDir,
        size: { width: config.width, height: config.height },
      },
    });
    const page = await context.newPage();

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
        (document.head || document.documentElement).appendChild(style);
        pauseSmil();
      };
      const observer = new MutationObserver(pauseSmil);
      observer.observe(document.documentElement, { childList: true, subtree: true });
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
    const prepared = await prepareSourceHtml(sourcePath);
    cleanupPrepared = prepared.cleanup;

    // 对应 html-video 源码段：page.goto(file://..., domcontentloaded)。
    // 显式 45s 超时，避免模板异常时卡在默认导航等待里拖垮整条渲染任务。
    try {
      await page.goto(pathToFileURL(prepared.loadPath).href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (error) {
      throw createRenderError('render-goto-timeout', `加载 html-video 模板超时或失败：${error.message}`);
    }

    // 对应 html-video 源码段：等待 stylesheet、逐个 fonts.load、fonts.ready。
    report(ctx, 32, '正在加载字体和样式...');
    await waitForStylesAndFonts(page);

    await page.waitForTimeout(100);

    // 对应 html-video 源码段：探测 CSS animation 与 GSAP finite timeline。
    if (config.durationMode !== 'explicit') {
      const animationMs = await probeAnimationDurationMs(page);
      const needed = Math.min(30, (animationMs + 400) / 1000);
      if (needed > totalDuration) totalDuration = needed;
    } else {
      await probeAnimationDurationMs(page).catch(() => 0);
    }

    // 对应 html-video 源码段：调用 window.__hvPlayAll()。
    await page.evaluate(() => {
      if (typeof window.__hvPlayAll === 'function') {
        window.__hvPlayed = true;
        window.__hvPlayAll();
        return true;
      }
      return false;
    }).catch(() => false);

    // 对应 html-video 源码段：调用 window.__hvUnfreeze()。
    await page.evaluate(() => {
      if (typeof window.__hvUnfreeze === 'function') window.__hvUnfreeze();
    }).catch(() => {});

    // 对应 html-video 源码段：记录 leadInMs，后续由 ffmpeg -ss 裁剪。
    leadInMs = now() - tWebmStart;

    report(ctx, 40, `正在录制 ${totalDuration}s html-video 帧...`);
    await waitWithProgress(page, ctx, totalDuration);

    report(ctx, 85, '正在结束浏览器录制...');
    await context.close();
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
  }

  report(ctx, 90, '正在编码 MP4...');
  const ffmpegPath = deps.ffmpegPath || await resolveFfmpegPath(deps);
  const probeDeps = { ...deps, ffmpegPath };
  const inputDurationSec = await probeMediaDurationSec(webmPath, probeDeps);
  const ffmpegArgs = buildFfmpegArgs({
    webmPath,
    outputPath: config.outputPath,
    fps: config.fps,
    duration: totalDuration,
    explicit: config.durationMode === 'explicit',
    leadInMs,
    inputDurationSec,
  });
  const ffmpegResult = await runFfmpegCommand(ffmpegPath, ffmpegArgs, deps.runFfmpeg);
  if (!ffmpegResult.ok) {
    throw createRenderError(
      'render-failed',
      `ffmpeg 编码 html-video 失败：${ffmpegResult.stderr || ffmpegResult.error || `exit ${ffmpegResult.code}`}`,
    );
  }

  await fsp.rm(recordDir, { recursive: true, force: true }).catch(() => {});
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
    }],
  };
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

async function waitWithProgress(page, ctx, durationSec) {
  const totalMs = Math.round(durationSec * 1000);
  const started = Date.now();
  while (Date.now() - started < totalMs) {
    const remaining = totalMs - (Date.now() - started);
    await page.waitForTimeout(Math.min(250, Math.max(0, remaining)));
    const elapsed = Math.min(totalMs, Date.now() - started);
    report(ctx, 40 + Math.floor((elapsed / totalMs) * 45), '正在录制 html-video 帧...');
  }
}

function buildFfmpegArgs({ webmPath, outputPath, fps, duration, explicit, leadInMs, inputDurationSec }) {
  const proposedSeekSec = leadInMs > 200 ? Math.max(0, (leadInMs - 120) / 1000) : 0;
  const outputDurationSec = Number(duration);
  const sourceDurationSec = Number(inputDurationSec);
  const seekSafe = proposedSeekSec > 0
    && Number.isFinite(outputDurationSec)
    && outputDurationSec > 0
    && Number.isFinite(sourceDurationSec)
    && sourceDurationSec > 0
    && proposedSeekSec + outputDurationSec <= sourceDurationSec - 0.1;
  const seekSec = seekSafe ? proposedSeekSec : 0;
  return [
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
};
