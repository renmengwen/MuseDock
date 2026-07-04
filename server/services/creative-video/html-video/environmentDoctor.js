const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function diagnoseEnvironment(options = {}) {
  const diagnostics = [];
  const playwright = await checkPlaywright(options);
  diagnostics.push(playwright);

  const chromium = playwright.ok
    ? await checkChromium(playwright.module, options)
    : {
      code: 'chromium_unavailable',
      ok: false,
      message: 'Playwright Chromium 未配置，无法渲染 html-video 模板。',
    };
  diagnostics.push(chromium);

  const ffmpeg = await checkFfmpeg(options);
  diagnostics.push(ffmpeg);

  const ffprobe = await checkFfprobe({ ...options, ffmpegPath: ffmpeg.path });
  diagnostics.push(ffprobe);

  const ok = diagnostics.every(item => item.ok);
  return {
    ok,
    code: ok ? 'ok' : 'environment_not_configured',
    diagnostics: diagnostics.map(({ module, ...item }) => item),
    message: ok
      ? 'html-video 渲染环境已就绪。'
      : 'html-video 渲染环境未配置完整，请检查 Playwright Chromium、ffmpeg 和 ffprobe。',
  };
}

async function checkPlaywright(options = {}) {
  try {
    const mod = options.importPlaywright ? await options.importPlaywright() : await import('playwright-core');
    return {
      ok: true,
      code: 'playwright_available',
      message: 'Playwright 可用。',
      module: mod,
    };
  } catch (error) {
    return {
      ok: false,
      code: 'playwright_missing',
      message: `Playwright 未安装或无法加载：${error.message}`,
    };
  }
}

async function checkChromium(playwright, options = {}) {
  try {
    const browser = await playwright.chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--no-sandbox'],
    });
    await browser.close().catch(() => {});
    return {
      ok: true,
      code: 'chromium_launchable',
      message: 'Playwright Chromium 可启动。',
    };
  } catch (error) {
    return {
      ok: false,
      code: 'chromium_unavailable',
      message: `Playwright Chromium 未配置，无法渲染 html-video 模板。${error.message ? ` ${error.message}` : ''}`,
    };
  }
}

async function checkFfmpeg(options = {}) {
  const ffmpegPath = await resolveFfmpegPath(options);
  const result = await runProbe(ffmpegPath, options.runCommand);
  if (result.ok) {
    return {
      ok: true,
      code: 'ffmpeg_available',
      path: ffmpegPath,
      message: 'ffmpeg 可用。',
    };
  }
  return {
    ok: false,
    code: 'ffmpeg_missing',
    path: ffmpegPath,
    message: `ffmpeg 未配置或无法执行：${result.stderr || result.error || `exit ${result.code}`}`,
  };
}

async function checkFfprobe(options = {}) {
  const ffprobePath = await resolveFfprobePath(options);
  const result = await runProbe(ffprobePath, options.runCommand);
  if (result.ok) {
    return {
      ok: true,
      code: 'ffprobe_available',
      path: ffprobePath,
      message: 'ffprobe 可用。',
    };
  }
  return {
    ok: false,
    code: 'ffprobe_missing',
    path: ffprobePath,
    message: `ffprobe 未配置或无法执行：${result.stderr || result.error || `exit ${result.code}`}`,
  };
}

async function resolveFfmpegPath(options = {}) {
  if (options.ffmpegPath) return options.ffmpegPath;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const pathFfmpeg = await findFfmpegOnPath(options.runCommand);
  if (pathFfmpeg) return pathFfmpeg;
  try {
    // Optional dependency: only use it when present.
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer && installer.path) return installer.path;
  } catch (_) {}
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

async function resolveFfprobePath(options = {}) {
  if (options.ffprobePath) return options.ffprobePath;
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const ffmpegPath = options.ffmpegPath || await resolveFfmpegPath(options);
  const adjacent = adjacentFfprobePath(ffmpegPath);
  if (adjacent) return adjacent;
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
}

function adjacentFfprobePath(ffmpegPath) {
  const text = String(ffmpegPath || '');
  if (!text || (!path.isAbsolute(text) && !text.includes(path.sep))) return '';
  const candidate = path.join(path.dirname(text), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  return fs.existsSync(candidate) ? candidate : '';
}

async function findFfmpegOnPath(injectedRunCommand) {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = await runProbe(finder, injectedRunCommand, ['ffmpeg']);
  if (!result.ok) return '';
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) || '';
}

function runProbe(command, injectedRunCommand, args = ['-version']) {
  if (injectedRunCommand) return injectedRunCommand(command, args);
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

module.exports = {
  diagnoseEnvironment,
  resolveFfmpegPath,
  resolveFfprobePath,
};
