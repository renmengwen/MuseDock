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

  const ok = diagnostics.every(item => item.ok);
  return {
    ok,
    code: ok ? 'ok' : 'environment_not_configured',
    diagnostics: diagnostics.map(({ module, ...item }) => item),
    message: ok
      ? 'html-video 渲染环境已就绪。'
      : 'html-video 渲染环境未配置完整，请检查 Playwright Chromium 和 ffmpeg。',
  };
}

async function checkPlaywright(options = {}) {
  try {
    const mod = options.importPlaywright ? await options.importPlaywright() : await import('playwright');
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
  const ffmpegPath = options.ffmpegPath || resolveFfmpegPath();
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

function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    // Optional dependency: only use it when present.
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer && installer.path) return installer.path;
  } catch (_) {}
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function runProbe(command, injectedRunCommand) {
  if (injectedRunCommand) return injectedRunCommand(command, ['-version']);
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(command, ['-version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
};
