/**
 * 抖音爬虫 - CDP 模式启动 Chrome
 * 
 * 核心思路（参考 MediaCrawler 的 CDP 模式）：
 * 1. 手动启动 Chrome，开启远程调试端口
 * 2. 通过 CDP 连接到已启动的 Chrome
 * 3. 完全避免 Playwright.launch() 的参数冲突问题
 */

const { chromium } = require('playwright');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 内存存储登录 Cookie
let storedDouyinCookies = [];

// 全局 Chrome 进程引用
let chromeProcess = null;
let cdpPort = 9222;

// ==================== Chrome 路径检测 ====================

function findChromePath() {
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  ];

  for (const p of chromePaths) {
    try {
      if (fs.existsSync(p)) {
        return p;
      }
    } catch (e) {}
  }

  return null;
}

// ==================== CDP 模式启动 Chrome ====================

async function startChromeWithCDP(headless = true) {
  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error('未找到 Chrome，请安装 Chrome 或手动指定路径');
  }

  console.log(`[抖音] Chrome 路径: ${chromePath}`);

  // 检查端口是否已被占用（Chrome 已启动）
  const net = require('net');
  const isPortAvailable = () => {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(cdpPort, '127.0.0.1');
    });
  };

  const available = await isPortAvailable();

  if (!available) {
    console.log(`[抖音] CDP 端口 ${cdpPort} 已被占用，尝试连接已有 Chrome...`);
    try {
      const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
      console.log('[抖音] 成功连接到已有 Chrome 实例');
      return { browser, isNew: false };
    } catch (e) {
      throw new Error(`CDP 端口被占用但无法连接，请关闭已有 Chrome 或更改端口: ${e.message}`);
    }
  }

  // 启动新的 Chrome 实例
  const userDataDir = path.join(__dirname, '../../chrome-user-data');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const chromeArgs = [
    `--remote-debugging-port=${cdpPort}`,
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

  if (headless) {
    chromeArgs.push('--headless=new');
    chromeArgs.push('--disable-gpu');
  }

  console.log(`[抖音] 启动 Chrome: ${chromePath}`);
  console.log(`[抖音] Chrome 参数: ${chromeArgs.join(' ')}`);

  chromeProcess = spawn(chromePath, chromeArgs, {
    detached: true,
    stdio: 'ignore',
  });

  // 等待 Chrome 启动
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 连接 CDP
  try {
    const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
    console.log('[抖音] Chrome CDP 连接成功！');
    return { browser, isNew: true };
  } catch (e) {
    throw new Error(`Chrome 启动后 CDP 连接失败: ${e.message}`);
  }
}

async function stopChromeWithCDP() {
  if (chromeProcess) {
    try {
      chromeProcess.kill('SIGTERM');
      console.log('[抖音] Chrome 进程已终止');
    } catch (e) {
      console.log('[抖音] 终止 Chrome 进程失败:', e.message);
    }
    chromeProcess = null;
  }
}

// ==================== Cookie 解析 ====================

function parseCookies(cookieStr) {
  const result = [];
  if (!cookieStr || !cookieStr.trim()) return result;

  try {
    const arr = JSON.parse(cookieStr);
    if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'object' && 'name' in arr[0]) {
      return arr.map(c => ({
        name: c.name,
        value: c.value || '',
        domain: c.domain || '.douyin.com',
        path: c.path || '/',
        httpOnly: c.httpOnly || false,
        secure: c.secure || true,
        sameSite: c.sameSite || 'Lax',
        expires: c.expires || c.expirationDate || -1,
      }));
    }
  } catch (e) {
    // 不是 JSON，按标准 Cookie 字符串解析
  }

  const pairs = cookieStr.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const name = pair.substring(0, idx).trim();
      const value = pair.substring(idx + 1).trim();
      if (name) {
        result.push({
          name,
          value,
          domain: '.douyin.com',
          path: '/',
          httpOnly: false,
          secure: true,
          sameSite: 'Lax',
        });
      }
    }
  }
  return result;
}

// ==================== 登录状态检测 ====================

async function isLoggedIn(page) {
  try {
    const info = await page.evaluate(() => {
      let hasLocalStorage = false;
      try {
        hasLocalStorage = localStorage.getItem('HasUserLogin') === '1';
      } catch (e) {}

      let hasLoginStatusCookie = false;
      try {
        hasLoginStatusCookie = document.cookie.includes('LOGIN_STATUS=1');
      } catch (e) {}

      return {
        hasLocalStorage,
        hasLoginStatusCookie,
        title: document.title,
        url: window.location.href,
      };
    });

    const loggedIn = info.hasLocalStorage || info.hasLoginStatusCookie;
    console.log(`[抖音] 登录状态检测: localStorage=${info.hasLocalStorage}, LOGIN_STATUS=${info.hasLoginStatusCookie}, 标题="${info.title}"`);
    return { loggedIn, ...info };
  } catch (e) {
    console.log('[抖音] 登录检测异常:', e.message);
    return { loggedIn: false, error: e.message };
  }
}

// ==================== 扫码登录 ====================

async function startQrcodeLogin() {
  console.log('[抖音] 启动扫码登录流程（CDP 模式）...');

  try {
    // 启动 Chrome 并连接 CDP
    const { browser, isNew } = await startChromeWithCDP(false);  // 非 headless，显示二维码

    const contexts = browser.contexts();
    let context;
    if (contexts.length > 0) {
      context = contexts[0];
    } else {
      context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
      });
    }

    const page = contexts.length > 0 && contexts[0].pages().length > 0
      ? contexts[0].pages()[0]
      : await context.newPage();

    // 注入反检测脚本
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };
    });

    // 打开抖音首页
    console.log('[抖音] 打开抖音首页...');
    await page.goto('https://www.douyin.com', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // 检查是否已经登录
    const status = await isLoggedIn(page);
    if (status.loggedIn) {
      console.log('[抖音] 已处于登录状态！保存 Cookie');
      const allCookies = await context.cookies('https://www.douyin.com');
      storedDouyinCookies = allCookies;
      console.log(`[抖音] 保存了 ${allCookies.length} 个 Cookie`);
      await browser.close();
      return {
        alreadyLoggedIn: true,
        qrcode: '',
      };
    }

    // 点击登录按钮
    await page.waitForTimeout(2000);
    const loginBtnSelectors = [
      'button:has-text("登录")',
      '[data-e2e="login"]',
      'text=登录',
    ];

    for (const sel of loginBtnSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          console.log('[抖音] 点击登录按钮');
          break;
        }
      } catch (e) {}
    }

    await page.waitForTimeout(2000);

    // 截图返回二维码
    const screenshot = await page.screenshot({ type: 'png' });
    const qrcode = screenshot.toString('base64');
    console.log('[抖音] 二维码截图已生成，等待用户扫码...');

    // 保存 context 引用供后续检查
    global._douyinLoginContext = context;
    global._douyinLoginPage = page;
    global._douyinBrowser = browser;

    return {
      alreadyLoggedIn: false,
      qrcode: `data:image/png;base64,${qrcode}`,
    };
  } catch (e) {
    console.error('[抖音] 扫码登录启动失败:', e.message);
    console.error(e.stack);
    throw e;
  }
}

async function checkLoginResult() {
  const context = global._douyinLoginContext;
  const page = global._douyinLoginPage;
  const browser = global._douyinBrowser;

  if (!page) {
    return { loggedIn: false, message: '未启动扫码登录' };
  }

  try {
    const status = await isLoggedIn(page);

    if (status.loggedIn) {
      console.log('[抖音] 扫码登录成功！保存 Cookie');

      // 读取所有 Cookie（包括 HttpOnly）
      const allCookies = await context.cookies('https://www.douyin.com');
      storedDouyinCookies = allCookies;
      console.log(`[抖音] 保存了 ${allCookies.length} 个 Cookie，关键 Cookie:`);
      const keyNames = ['sessionid', 'ttwid', 'odin_tt', 'passport_csrf_token'];
      for (const name of keyNames) {
        const found = allCookies.find(c => c.name === name);
        if (found) {
          console.log(`  ✅ ${name}: ${found.value.substring(0, 20)}...`);
        } else {
          console.log(`  ❌ ${name}: 未找到`);
        }
      }

      await browser.close();
      global._douyinLoginContext = null;
      global._douyinLoginPage = null;
      global._douyinBrowser = null;

      return { loggedIn: true, message: '登录成功！Cookie 已保存。' };
    }

    return {
      loggedIn: false,
      message: '等待扫码...',
      url: status.url,
      title: status.title,
    };
  } catch (e) {
    console.log('[抖音] 登录检测中断:', e.message);
    return { loggedIn: false, message: '浏览器已关闭，请重新开始扫码登录' };
  }
}

// ==================== 搜索（Headless + Cookie 注入） ====================

async function searchNotes(keyword, maxCount = 10, cookieStr = '') {
  const diagnostic = {};
  const startTime = Date.now();

  try {
    // 合并内存 Cookie 和用户手动粘贴的 Cookie
    let cookiesToInject = [...storedDouyinCookies];
    const extraCookies = parseCookies(cookieStr);
    if (extraCookies.length > 0) {
      console.log(`[抖音] 用户手动提供 Cookie ${extraCookies.length} 条`);
      const manualNames = new Set(extraCookies.map(c => c.name));
      cookiesToInject = cookiesToInject.filter(c => !manualNames.has(c.name));
      cookiesToInject.push(...extraCookies);
    }

    if (cookiesToInject.length === 0) {
      return {
        success: true,
        data: [],
        count: 0,
        needCookie: true,
        message: '尚未登录，请先使用「扫码登录」获取登录态',
        diagnostic,
        elapsed: `${Date.now() - startTime}ms`,
      };
    }

    console.log(`[抖音] 启动 headless Chrome (CDP 模式)，注入 ${cookiesToInject.length} 个 Cookie...`);

    // 使用 CDP 模式连接 headless Chrome
    const { browser } = await startChromeWithCDP(true);

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });

    // 注入 Cookie
    await context.addCookies(cookiesToInject);
    console.log(`[抖音] Cookie 注入完成`);

    const page = await context.newPage();

    // 反检测
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      window.chrome = { runtime: {} };
    });

    // 打开抖音首页验证登录态
    console.log('[抖音] 打开抖音首页...');
    await page.goto('https://www.douyin.com', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    diagnostic.pageUrl = page.url();

    const loginStatus = await isLoggedIn(page);
    diagnostic.loginStatus = loginStatus;

    if (!loginStatus.loggedIn) {
      console.log('[抖音] Cookie 无效或已过期');
      await browser.close();
      return {
        success: true,
        data: [],
        count: 0,
        cookieInvalid: true,
        message: 'Cookie 已过期或无效，请重新扫码登录',
        diagnostic,
        elapsed: `${Date.now() - startTime}ms`,
      };
    }

    console.log('[抖音] 已登录，开始搜索...');

    // 构建搜索 URL
    const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=general`;
    console.log('[抖音] 搜索 URL:', searchUrl);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // 等待搜索结果加载
    await page.waitForTimeout(3000);

    diagnostic.searchUrl = page.url();
    diagnostic.pageTitle = await page.title();

    // 尝试从页面提取数据
    const searchData = await page.evaluate((kw) => {
      const results = [];

      // 方法1: 提取搜索结果卡片的链接
      const links = document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]');
      const seen = new Set();

      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (!href || seen.has(href)) continue;
        seen.add(href);

        // 尝试找到父容器获取标题
        let container = link;
        for (let i = 0; i < 5; i++) {
          container = container.parentElement;
          if (!container) break;

          const titleEl = container.querySelector('[data-e2e="search-card-title"], .title, h3, .desc');
          const authorEl = container.querySelector('[data-e2e="search-card-username"], .author, .name');
          const likesEl = container.querySelector('[data-e2e="search-card-like"], .like-count, .count');

          if (titleEl) {
            results.push({
              title: titleEl.textContent.trim(),
              url: href.startsWith('http') ? href : `https://www.douyin.com${href}`,
              author: authorEl ? authorEl.textContent.trim() : '',
              likes: likesEl ? likesEl.textContent.trim() : '',
              keyword: kw,
            });
            break;
          }
        }
      }

      return results;
    }, keyword);

    await browser.close();
    const elapsed = `${Date.now() - startTime}ms`;
    console.log(`[抖音] 搜索完成: ${searchData.length} 条, 耗时 ${elapsed}`);

    return {
      success: true,
      data: searchData.slice(0, maxCount),
      count: searchData.length,
      diagnostic,
      elapsed,
    };
  } catch (e) {
    console.error('[抖音] 搜索异常:', e.message);
    console.error(e.stack);
    return {
      success: false,
      error: e.message,
      data: [],
      count: 0,
      elapsed: `${Date.now() - startTime}ms`,
    };
  }
}

// ==================== 检查登录状态 ====================

async function checkLoginStatus() {
  if (storedDouyinCookies.length === 0) {
    return { loggedIn: false, message: '未登录', cookieCount: 0 };
  }

  // 检查关键 Cookie
  const keyNames = ['sessionid', 'ttwid', 'odin_tt', 'passport_csrf_token'];
  const found = keyNames.filter(name => storedDouyinCookies.some(c => c.name === name));

  return {
    loggedIn: found.length > 0,
    message: found.length > 0 ? '已登录' : 'Cookie 不完整',
    cookieCount: storedDouyinCookies.length,
    keyCookies: found,
  };
}

module.exports = {
  searchNotes,
  startQrcodeLogin,
  checkLoginResult,
  checkLoginStatus,
  parseCookies,
};
