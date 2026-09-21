const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');

class DouyinBrowserError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = 'DouyinBrowserError';
    this.code = code;
    this.status = status;
  }
}

function createDouyinBrowserLauncher({
  userDataDir, findChromePath, browserType = chromium, spawnProcess = spawn,
  startupTimeoutMs = 15000, pollIntervalMs = 200,
}) {
  const activePortFile = path.join(userDataDir, 'DevToolsActivePort');
  let starting = null;

  async function readEndpoint() {
    try {
      const [portText, browserPath] = (await fs.readFile(activePortFile, 'utf8')).trim().split(/\r?\n/);
      const port = Number(portText);
      if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535
        || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(browserPath || '')) return null;
      // 只连接专用配置目录记录的本机浏览器，不探测或接管固定端口上的其他程序。
      return `ws://127.0.0.1:${port}${browserPath}`;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new DouyinBrowserError('DOUYIN_CHROME_PROFILE_UNAVAILABLE', '无法读取 MuseDock 的 Chrome 登录数据，请检查应用数据目录的访问权限。');
    }
  }

  async function connect(endpoint, timeout = 1500) {
    if (!endpoint) return null;
    try { return await browserType.connectOverCDP(endpoint, { timeout }); }
    catch { return null; }
  }

  async function launch(headless) {
    const existing = await connect(await readEndpoint());
    if (existing) return { browser: existing, isNew: false };

    const chromePath = findChromePath();
    if (!chromePath) {
      throw new DouyinBrowserError('DOUYIN_CHROME_NOT_FOUND', '未找到 Google Chrome，请安装 Chrome 后重新点击“登录抖音”。');
    }
    try { await fs.mkdir(userDataDir, { recursive: true }); }
    catch {
      throw new DouyinBrowserError('DOUYIN_CHROME_PROFILE_UNAVAILABLE', '无法创建 MuseDock 的 Chrome 登录数据目录，请检查应用数据目录的写入权限。');
    }

    const args = [
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-component-extensions-with-background-pages',
      '--disable-default-apps',
      '--disable-features=TranslateUI',
      '--disable-extensions',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-sync',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--password-store=basic',
      '--use-mock-keychain',
    ];
    if (headless) args.push('--headless=new', '--disable-gpu');

    let child;
    let spawnFailed = false;
    const startFailure = () => new DouyinBrowserError('DOUYIN_CHROME_START_FAILED', 'Chrome 启动失败，请确认 Chrome 能正常打开，且未被系统安全软件阻止。');
    try {
      child = spawnProcess(chromePath, args, { detached: true, stdio: 'ignore', windowsHide: headless });
      child.once('error', () => { spawnFailed = true; });
      child.unref();
    } catch { throw startFailure(); }

    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      if (spawnFailed || (child.exitCode != null && child.exitCode !== 0) || child.signalCode) throw startFailure();
      const endpoint = await readEndpoint();
      const browser = await connect(endpoint, Math.max(1, Math.min(1500, deadline - Date.now())));
      if (browser) return { browser, isNew: true };
      await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
    }
    if (spawnFailed) throw startFailure();
    throw new DouyinBrowserError('DOUYIN_CHROME_CONNECT_TIMEOUT', '等待 Chrome 登录窗口连接超时，请稍候再点击“登录抖音”；若仍失败，请关闭 MuseDock 打开的登录窗口后重试。', 504);
  }

  async function start(headless = true) {
    // 串行启动，但每个调用单独连接，避免一个调用断开其他调用的浏览器连接。
    if (starting) {
      await starting;
      return start(headless);
    }
    starting = launch(headless);
    try { return await starting; }
    finally { starting = null; }
  }

  return { start };
}

module.exports = { createDouyinBrowserLauncher, DouyinBrowserError };
