/**
 * 抖音爬虫 - CDP 模式启动 Chrome
 * 
 * 核心思路（参考 MediaCrawler 的 CDP 模式）：
 * 1. 手动启动 Chrome，开启远程调试端口
 * 2. 通过 CDP 连接到已启动的 Chrome
 * 3. 完全避免 Playwright.launch() 的参数冲突问题
 */

const { chromium } = require('playwright-core');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 内存存储登录 Cookie
let storedDouyinCookies = [];

// 持久化 Cookie 到磁盘
const COOKIE_FILE = path.join(require('../dataRoot'), 'douyin-cookies.json');

function loadCookiesFromDisk() {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      const data = fs.readFileSync(COOKIE_FILE, 'utf-8');
      storedDouyinCookies = JSON.parse(data);
      console.log(`[抖音] 从磁盘加载了 ${storedDouyinCookies.length} 个 Cookie`);
      return storedDouyinCookies.length > 0;
    }
  } catch (e) {
    console.log('[抖音] 加载 Cookie 文件失败:', e.message);
  }
  return false;
}

function saveCookiesToDisk(cookies) {
  try {
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2), 'utf-8');
    console.log(`[抖音] Cookie 已持久化保存到 ${COOKIE_FILE}`);
  } catch (e) {
    console.log('[抖音] 保存 Cookie 文件失败:', e.message);
  }
}

// 启动时尝试加载
loadCookiesFromDisk();

// 全局 Chrome 进程引用
let chromeProcess = null;
let cdpPort = 9222;
let douyinSignContext = null;

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
  const userDataDir = path.join(require('../dataRoot'), 'chrome-user-data');
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

async function isLoggedIn(page, context) {
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

    // 关键修复：同时用 Playwright API 检查 HttpOnly Cookie（如 sessionid）
    let hasSessionCookie = false;
    if (context) {
      try {
        const cookies = await context.cookies('https://www.douyin.com');
        hasSessionCookie = cookies.some(c => c.name === 'sessionid' || c.name === 'LOGIN_STATUS');
      } catch (e) {}
    }

    const loggedIn = info.hasLocalStorage || info.hasLoginStatusCookie || hasSessionCookie;
    console.log(`[抖音] 登录状态检测: localStorage=${info.hasLocalStorage}, LOGIN_STATUS=${info.hasLoginStatusCookie}, sessionid=${hasSessionCookie}, 标题="${info.title}"`);
    return { loggedIn, ...info, hasSessionCookie };
  } catch (e) {
    console.log('[抖音] 登录检测异常:', e.message);
    return { loggedIn: false, error: e.message };
  }
}

// ==================== 扫码登录 ====================

function buildDouyinSearchParams(keyword, count = 15, searchId = '', offset = 0, env = {}) {
  return {
    search_channel: 'aweme_general',
    enable_history: '1',
    keyword,
    search_source: 'tab_search',
    query_correct_type: '1',
    is_filter_search: '0',
    from_group_id: '7378810571505847586',
    offset,
    count: String(Math.min(Math.max(parseInt(count, 10) || 15, 1), 15)),
    need_filter_settings: '1',
    list_type: 'multi',
    search_id: searchId || '',
    device_platform: 'webapp',
    aid: '6383',
    channel: 'channel_pc_web',
    version_code: '190600',
    version_name: '19.6.0',
    update_version_code: '170400',
    pc_client_type: '1',
    cookie_enabled: 'true',
    browser_language: 'zh-CN',
    browser_platform: env.browser_platform || 'Win32',
    browser_name: 'Chrome',
    browser_version: env.browser_version || '',
    browser_online: 'true',
    engine_name: 'Blink',
    os_name: env.os_name || 'Windows',
    os_version: env.os_version || '10',
    cpu_core_num: env.cpu_core_num || '8',
    device_memory: env.device_memory || '8',
    platform: 'PC',
    screen_width: env.screen_width || '1920',
    screen_height: env.screen_height || '1080',
    effective_type: '4g',
    round_trip_time: '50',
    webid: env.webid || '',
    msToken: env.msToken || '',
  };
}

function getCookieValue(cookies, name) {
  return (cookies || []).find(c => c.name === name)?.value || '';
}

async function getDouyinRequestEnv(page, context) {
  const browserEnv = await page.evaluate(() => {
    const local = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        local[key] = localStorage.getItem(key);
      }
    } catch (e) {}

    const ua = navigator.userAgent || '';
    const chromeMatch = ua.match(/Chrome\/([\d.]+)/);

    return {
      userAgent: ua,
      browser_platform: navigator.platform || 'Win32',
      browser_version: chromeMatch ? chromeMatch[1] : '',
      cpu_core_num: String(navigator.hardwareConcurrency || 8),
      device_memory: String(navigator.deviceMemory || 8),
      screen_width: String(screen.width || 1920),
      screen_height: String(screen.height || 1080),
      msToken: local.xmst || local.msToken || '',
    };
  });
  const cookies = await context.cookies('https://www.douyin.com');
  return {
    ...browserEnv,
    webid: getCookieValue(cookies, 'webid') || getCookieValue(cookies, 'ttwid').replace(/\D/g, '').slice(0, 19),
  };
}

function isDouyinCaptchaTitle(title = '') {
  const value = String(title);
  return value.includes('\u9a8c\u8bc1\u7801\u4e2d\u95f4\u9875') || value.toLowerCase().includes('captcha');
}

function canUseDouyinLoginStatus(status = {}) {
  return !!status.loggedIn && !isDouyinCaptchaTitle(status.title);
}

function pickUrl(urlObj) {
  if (!urlObj) return '';
  if (Array.isArray(urlObj.url_list) && urlObj.url_list.length > 0) return urlObj.url_list[0] || '';
  return urlObj.url || '';
}

function pickLastUrl(urlObj) {
  if (!urlObj) return '';
  if (Array.isArray(urlObj.url_list) && urlObj.url_list.length > 0) return urlObj.url_list[urlObj.url_list.length - 1] || '';
  return urlObj.url || '';
}

function parseDouyinSearchResponse(response, keyword, maxCount = 20) {
  const rows = Array.isArray(response?.data) ? response.data : [];
  const result = [];

  for (const item of rows) {
    const aweme = item?.aweme_info || item?.aweme_mix_info?.mix_items?.[0];
    if (!aweme?.aweme_id) continue;

    const author = aweme.author || {};
    const statistics = aweme.statistics || {};
    const cover = aweme.video?.cover || aweme.images?.[0]?.url_list || aweme.images?.[0];

    result.push({
      aweme_id: aweme.aweme_id,
      title: aweme.desc || aweme.preview_title || '',
      create_time: aweme.create_time || 0,
      author: author.nickname || '',
      likes: statistics.digg_count || 0,
      comment_count: statistics.comment_count || 0,
      url: `https://www.douyin.com/video/${aweme.aweme_id}`,
      cover_url: pickUrl(cover),
      aweme_type: aweme.aweme_type ?? '',
      duration_ms: aweme.video?.duration || 0,
      keyword,
    });

    if (result.length >= maxCount) break;
  }

  return result;
}

function parseDouyinComment(comment, replies = []) {
  const user = comment?.user || {};
  const parsedReplies = replies.map(reply => (
    reply && 'comment_id' in reply ? reply : parseDouyinComment(reply)
  ));
  return {
    comment_id: comment?.cid || comment?.comment_id || '',
    content: comment?.text || comment?.content || '',
    create_time: comment?.create_time || 0,
    user_id: user.uid || user.sec_uid || '',
    nickname: user.nickname || '',
    avatar: pickUrl(user.avatar_thumb),
    like_count: comment?.digg_count || comment?.like_count || 0,
    ip_location: comment?.ip_label || comment?.ip_location || '',
    sub_comment_count: comment?.reply_comment_total || comment?.sub_comment_count || 0,
    replies: parsedReplies,
  };
}

function shouldSignDouyinApi(uri = '') {
  return uri.includes('/aweme/v1/web/comment/list/')
    || uri.includes('/aweme/v1/web/aweme/detail/')
    || uri.includes('/aweme/v1/web/user/profile/other/')
    || uri.includes('/aweme/v1/web/aweme/post/');
}

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    searchParams.append(key, String(value));
  }
  return searchParams.toString();
}

function getDouyinSignContext() {
  if (douyinSignContext) return douyinSignContext;
  const signPath = path.join(__dirname, '../libs/douyin.js');
  const code = fs.readFileSync(signPath, 'utf-8');
  const sandbox = {
    console,
    Math,
    Date,
    String,
    Number,
    Array,
    Object,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: signPath });
  douyinSignContext = sandbox;
  return douyinSignContext;
}

function getDouyinABogusFromJs(uri, queryString, userAgent) {
  const sandbox = getDouyinSignContext();
  const functionName = uri.includes('/reply') ? 'sign_reply' : 'sign_datail';
  const signer = sandbox[functionName];
  if (typeof signer !== 'function') {
    throw new Error(`Douyin signer ${functionName} is unavailable`);
  }
  return signer(String(queryString || ''), String(userAgent || ''));
}

async function signDouyinParamsWithPage(page, uri, params, diagnosticKey, diagnostic) {
  if (!shouldSignDouyinApi(uri)) return params;
  const query = buildQueryString(params);

  try {
    const ua = await page.evaluate(() => navigator.userAgent || '');
    const aBogus = getDouyinABogusFromJs(uri, query, ua);
    if (diagnostic && diagnosticKey) {
      diagnostic[`${diagnosticKey}Sign`] = { attempted: true, method: 'js', ok: !!aBogus };
    }
    if (aBogus) return { ...params, a_bogus: aBogus };
  } catch (e) {
    if (diagnostic && diagnosticKey) {
      diagnostic[`${diagnosticKey}Sign`] = { attempted: true, method: 'js', ok: false, error: e.message };
    }
  }

  try {
    const aBogus = await page.evaluate(({ queryString, signType }) => {
      const signer = window.bdms?.init?._v?.[2]?.p?.[42];
      if (typeof signer !== 'function') return '';
      return signer.apply(null, [0, 1, signType, queryString, '', navigator.userAgent || '']);
    }, { queryString: query, signType: uri.includes('/reply') ? 8 : 14 });

    if (diagnostic && diagnosticKey) {
      diagnostic[`${diagnosticKey}SignFallback`] = { attempted: true, method: 'page', ok: !!aBogus };
    }

    if (!aBogus) return params;
    return { ...params, a_bogus: aBogus };
  } catch (e) {
    if (diagnostic && diagnosticKey) {
      diagnostic[`${diagnosticKey}SignFallback`] = { attempted: true, method: 'page', ok: false, error: e.message };
    }
    return params;
  }
}

async function fetchDouyinSearchByApi(context, page, keyword, maxCount, diagnostic) {
  const apiUrl = 'https://www.douyin.com/aweme/v1/web/general/search/single/';
  const all = [];
  let searchId = '';
  let offset = 0;
  const env = await getDouyinRequestEnv(page, context);
  diagnostic.requestEnv = {
    browser_platform: env.browser_platform,
    browser_version: env.browser_version,
    screen_width: env.screen_width,
    screen_height: env.screen_height,
    hasMsToken: !!env.msToken,
    hasWebId: !!env.webid,
  };

  while (all.length < maxCount) {
    const count = Math.min(15, maxCount - all.length);
    const params = buildDouyinSearchParams(keyword, count, searchId, offset, env);
    diagnostic.apiParams = { keyword, offset, count: params.count, search_id: searchId };

    const response = await context.request.get(apiUrl, {
      params,
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=general`,
      },
    });
    const apiResponse = {
      ok: response.ok(),
      status: response.status(),
      url: response.url(),
      text: await response.text(),
    };

    diagnostic.apiStatus = apiResponse.status;
    diagnostic.apiUrl = apiResponse.url;

    if (!apiResponse.ok) {
      throw new Error(`Douyin search API HTTP ${apiResponse.status}`);
    }

    if (!apiResponse.text || apiResponse.text === 'blocked') {
      return {
        needVerify: true,
        message: 'Douyin returned blocked. Complete verification in the opened Chrome window, then retry search.',
        data: all,
      };
    }

    let json;
    try {
      json = JSON.parse(apiResponse.text);
    } catch (e) {
      diagnostic.apiTextPreview = apiResponse.text.slice(0, 300);
      return {
        needVerify: true,
        message: 'Douyin search API returned non-JSON content. Complete verification in Chrome, then retry search.',
        data: all,
      };
    }

    diagnostic.apiExtra = json.extra || {};
    diagnostic.apiTopLevelKeys = Object.keys(json);
    diagnostic.apiDataLength = Array.isArray(json.data) ? json.data.length : null;
    diagnostic.apiStatusCode = json.status_code;
    diagnostic.apiStatusMsg = json.status_msg;
    const parsed = parseDouyinSearchResponse(json, keyword, maxCount - all.length);
    all.push(...parsed);

    searchId = json.extra?.logid || searchId;
    offset += count;

    if (parsed.length === 0 || json.has_more === 0) break;
    await new Promise(resolve => setTimeout(resolve, 800));
  }

  const data = await enrichDouyinItemsWithDetails(all, {
    context,
    page,
    diagnostic,
    nowSeconds: Math.floor(Date.now() / 1000),
  });

  return { needVerify: false, data };
}

async function fetchJsonWithDouyinEnv(context, page, uri, params, referer, diagnosticKey, diagnostic) {
  const url = `https://www.douyin.com${uri}`;
  const signedParams = await signDouyinParamsWithPage(page, uri, params, diagnosticKey, diagnostic);
  const response = await context.request.get(url, {
    params: signedParams,
    headers: {
      Accept: 'application/json, text/plain, */*',
      Referer: referer || 'https://www.douyin.com/',
    },
  });
  const text = await response.text();
  if (diagnostic && diagnosticKey) {
    diagnostic[diagnosticKey] = {
      status: response.status(),
      url: response.url(),
      preview: text.slice(0, 160),
    };
  }
  if (!response.ok()) throw new Error(`Douyin API HTTP ${response.status()}`);
  if (!text || text === 'blocked') {
    const err = new Error('Douyin API returned blocked');
    err.needVerify = true;
    throw err;
  }
  return JSON.parse(text);
}

function extractDouyinVideoDownloadUrl(awemeDetail = {}) {
  const video = awemeDetail.video || {};
  return pickLastUrl(video.play_addr_h264) || pickLastUrl(video.play_addr_256) || pickLastUrl(video.play_addr);
}

function extractDouyinMusicDownloadUrl(awemeDetail = {}) {
  return pickLastUrl(awemeDetail.music?.play_url) || pickLastUrl(awemeDetail.music?.play_url_hq);
}

function parseDouyinVideoDetail(response) {
  const aweme = response?.aweme_detail || response?.aweme || response?.data?.aweme_detail || response;
  if (!aweme?.aweme_id) {
    return {
      aweme_id: '',
      title: '',
      description: '',
      author: {},
      statistics: {},
      cover_url: '',
      video_download_url: '',
      music_download_url: '',
      aweme_url: '',
      raw: response,
    };
  }

  const author = aweme.author || {};
  const title = aweme.desc || aweme.preview_title || aweme.share_info?.share_title || '';
  return {
    aweme_id: String(aweme.aweme_id),
    title,
    description: aweme.desc || '',
    aweme_type: aweme.aweme_type ?? '',
    create_time: aweme.create_time || 0,
    author: {
      nickname: author.nickname || '',
      sec_uid: author.sec_uid || '',
      uid: author.uid || '',
    },
    statistics: aweme.statistics || {},
    cover_url: pickUrl(aweme.video?.cover) || pickUrl(aweme.video?.origin_cover) || pickUrl(aweme.video?.dynamic_cover),
    duration_ms: aweme.video?.duration || 0,
    video_download_url: extractDouyinVideoDownloadUrl(aweme),
    music_download_url: extractDouyinMusicDownloadUrl(aweme),
    aweme_url: `https://www.douyin.com/video/${aweme.aweme_id}`,
    raw: aweme,
  };
}

function buildDouyinCommonParams(env, count = 20, offset = 0) {
  const params = buildDouyinSearchParams('', count, '', offset, env);
  delete params.keyword;
  delete params.search_channel;
  delete params.search_source;
  delete params.query_correct_type;
  delete params.is_filter_search;
  delete params.from_group_id;
  delete params.need_filter_settings;
  delete params.list_type;
  delete params.search_id;
  return params;
}

function parseDouyinSecUid(input = '') {
  const value = String(input || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    const querySecUid = parsed.searchParams.get('sec_uid') || parsed.searchParams.get('sec_user_id');
    if (querySecUid) return querySecUid;
    const match = parsed.pathname.match(/\/user\/([^/?#]+)/);
    if (match) return decodeURIComponent(match[1]);
  } catch (e) {}
  const match = value.match(/\/user\/([^/?#]+)/);
  if (match) return decodeURIComponent(match[1]);
  return value;
}

function parseDouyinAwemeId(input = '') {
  const value = String(input || '').trim();
  if (!value) return '';
  const videoMatch = value.match(/\/video\/(\d+)/);
  if (videoMatch) return videoMatch[1];
  const queryMatch = value.match(/[?&](?:aweme_id|modal_id|item_id)=(\d+)/);
  if (queryMatch) return queryMatch[1];
  const plainMatch = value.match(/\d{10,}/);
  return plainMatch ? plainMatch[0] : value;
}

function parseDouyinAwemeList(response, sourceKeyword = '', maxCount = 20) {
  const rows = Array.isArray(response?.aweme_list)
    ? response.aweme_list
    : (Array.isArray(response?.data) ? response.data.map(item => item.aweme_info || item).filter(Boolean) : []);
  return rows
    .map(row => ({ ...parseDouyinVideoDetail(row), keyword: sourceKeyword }))
    .filter(item => item.aweme_id)
    .slice(0, maxCount);
}

function needsDouyinDetailEnrichment(item = {}) {
  return (!item.aweme_type && item.aweme_type !== 0) || !item.duration_ms || !item.video_download_url;
}

async function getVideoDetailWithPage(context, page, awemeId, diagnostic = {}) {
  const env = await getDouyinRequestEnv(page, context);
  const params = {
    ...buildDouyinSearchParams('', 1, '', 0, env),
    aweme_id: awemeId,
  };
  delete params.keyword;
  delete params.search_channel;
  delete params.search_source;
  delete params.query_correct_type;
  delete params.is_filter_search;
  delete params.from_group_id;
  delete params.need_filter_settings;
  delete params.list_type;
  delete params.search_id;

  const json = await fetchJsonWithDouyinEnv(
    context,
    page,
    '/aweme/v1/web/aweme/detail/',
    params,
    `https://www.douyin.com/video/${awemeId}`,
    'detailApi',
    diagnostic,
  );
  return parseDouyinVideoDetail(json);
}

async function enrichDouyinItemsWithDetails(items = [], options = {}) {
  const nowSeconds = options.nowSeconds || Math.floor(Date.now() / 1000);
  const enriched = [];

  for (const item of items) {
    const base = { ...item, crawled_at: item.crawled_at || nowSeconds };
    if (!base.aweme_id || !needsDouyinDetailEnrichment(base)) {
      enriched.push(base);
      continue;
    }

    try {
      let detailResult = null;
      if (options.getDetail) {
        detailResult = await options.getDetail(base.aweme_id);
      } else if (options.context && options.page) {
        detailResult = {
          success: true,
          data: await getVideoDetailWithPage(options.context, options.page, base.aweme_id, options.diagnostic || {}),
        };
      }
      const detail = detailResult?.success ? detailResult.data : null;
      enriched.push(detail ? { ...base, ...detail, crawled_at: base.crawled_at } : base);
    } catch (error) {
      console.warn(`[Douyin] enrich detail failed for ${base.aweme_id}:`, error.message);
      enriched.push(base);
    }
  }

  return enriched;
}

async function createDouyinApiPage(diagnostic) {
  if (storedDouyinCookies.length === 0) {
    return {
      needLogin: true,
      message: 'Not logged in. Please scan QR code first.',
    };
  }

  const { browser } = await startChromeWithCDP(false);
  const context = browser.contexts()[0] || await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto('https://www.douyin.com', { waitUntil: 'domcontentloaded', timeout: 20000 });

  const loginStatus = await isLoggedIn(page, context);
  diagnostic.loginStatus = loginStatus;
  if (!canUseDouyinLoginStatus(loginStatus)) {
    await page.close().catch(() => {});
    return {
      needVerify: isDouyinCaptchaTitle(loginStatus.title),
      needLogin: !loginStatus.loggedIn,
      message: isDouyinCaptchaTitle(loginStatus.title)
        ? 'Douyin captcha page detected. Complete verification in Chrome, then retry.'
        : 'Not logged in. Please scan QR code first.',
      browser,
      context,
      page: null,
    };
  }

  return { browser, context, page };
}

async function getVideoDetail(awemeId) {
  const diagnostic = {};
  const startTime = Date.now();

  try {
    if (!awemeId) return { success: false, error: 'Missing aweme_id', diagnostic };
    if (storedDouyinCookies.length === 0) {
      return {
        success: true,
        needLogin: true,
        message: 'Not logged in. Please scan QR code first.',
        diagnostic,
        elapsed: `${Date.now() - startTime}ms`,
      };
    }

    const { browser } = await startChromeWithCDP(false);
    const context = browser.contexts()[0] || await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    await page.goto('https://www.douyin.com', { waitUntil: 'domcontentloaded', timeout: 20000 });

    const loginStatus = await isLoggedIn(page, context);
    diagnostic.loginStatus = loginStatus;
    if (!canUseDouyinLoginStatus(loginStatus)) {
      await page.close().catch(() => {});
      return {
        success: true,
        needVerify: isDouyinCaptchaTitle(loginStatus.title),
        needLogin: !loginStatus.loggedIn,
        message: isDouyinCaptchaTitle(loginStatus.title)
          ? 'Douyin captcha page detected. Complete verification in Chrome, then retry.'
          : 'Not logged in. Please scan QR code first.',
        diagnostic,
        elapsed: `${Date.now() - startTime}ms`,
      };
    }

    const env = await getDouyinRequestEnv(page, context);
    const params = {
      ...buildDouyinSearchParams('', 1, '', 0, env),
      aweme_id: awemeId,
    };
    delete params.keyword;
    delete params.search_channel;
    delete params.search_source;
    delete params.query_correct_type;
    delete params.is_filter_search;
    delete params.from_group_id;
    delete params.need_filter_settings;
    delete params.list_type;
    delete params.search_id;

    const json = await fetchJsonWithDouyinEnv(
      context,
      page,
      '/aweme/v1/web/aweme/detail/',
      params,
      `https://www.douyin.com/video/${awemeId}`,
      'detailApi',
      diagnostic,
    );
    const data = parseDouyinVideoDetail(json);
    await page.close().catch(() => {});
    return {
      success: true,
      data,
      diagnostic,
      elapsed: `${Date.now() - startTime}ms`,
    };
  } catch (e) {
    console.error('[Douyin] video detail error:', e.message);
    return {
      success: false,
      error: e.message,
      needVerify: !!e.needVerify,
      diagnostic,
      elapsed: `${Date.now() - startTime}ms`,
    };
  }
}

async function getVideosByIds(ids = []) {
  const startTime = Date.now();
  const values = Array.isArray(ids) ? ids : [ids];
  const awemeIds = [...new Set(values.map(parseDouyinAwemeId).filter(Boolean))];
  const data = [];
  const diagnostics = [];

  if (awemeIds.length === 0) {
    return { success: false, error: 'Missing aweme_id', data: [], count: 0 };
  }

  for (const awemeId of awemeIds) {
    const result = await getVideoDetail(awemeId);
    diagnostics.push({ aweme_id: awemeId, diagnostic: result.diagnostic, error: result.error });
    if (result.needLogin || result.needVerify) {
      return {
        success: true,
        needLogin: !!result.needLogin,
        needVerify: !!result.needVerify,
        message: result.message,
        data,
        count: data.length,
        diagnostic: diagnostics,
        elapsed: `${Date.now() - startTime}ms`,
      };
    }
    if (!result.success) {
      return {
        success: false,
        error: result.error,
        data,
        count: data.length,
        diagnostic: diagnostics,
        elapsed: `${Date.now() - startTime}ms`,
      };
    }
    if (result.data?.aweme_id) {
      data.push({ ...result.data, keyword: `指定ID:${awemeId}` });
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return {
    success: true,
    data,
    count: data.length,
    diagnostic: diagnostics,
    elapsed: `${Date.now() - startTime}ms`,
  };
}

async function getCreatorVideos(secUidOrUrl, maxCount = 20) {
  const diagnostic = {};
  const startTime = Date.now();
  const secUid = parseDouyinSecUid(secUidOrUrl);
  const max = Math.min(Math.max(parseInt(maxCount, 10) || 20, 1), 100);
  const data = [];

  try {
    if (!secUid) return { success: false, error: 'Missing sec_uid', data: [], count: 0, diagnostic };

    const created = await createDouyinApiPage(diagnostic);
    if (created.needLogin || created.needVerify) {
      return {
        success: true,
        needLogin: !!created.needLogin,
        needVerify: !!created.needVerify,
        message: created.message,
        data: [],
        count: 0,
        diagnostic,
        elapsed: `${Date.now() - startTime}ms`,
      };
    }

    const { context, page } = created;
    const env = await getDouyinRequestEnv(page, context);
    const referer = `https://www.douyin.com/user/${encodeURIComponent(secUid)}`;
    const profileParams = {
      ...buildDouyinCommonParams(env, 1),
      sec_user_id: secUid,
      publish_video_strategy_type: '2',
      personal_center_strategy: '1',
    };

    try {
      const profile = await fetchJsonWithDouyinEnv(
        context,
        page,
        '/aweme/v1/web/user/profile/other/',
        profileParams,
        referer,
        'profileApi',
        diagnostic,
      );
      diagnostic.creator = {
        sec_uid: secUid,
        nickname: profile.user?.nickname || profile.user_info?.nickname || '',
      };
    } catch (e) {
      diagnostic.profileError = e.message;
    }

    let maxCursor = 0;
    while (data.length < max) {
      const count = Math.min(20, max - data.length);
      const postParams = {
        ...buildDouyinCommonParams(env, count),
        sec_user_id: secUid,
        max_cursor: maxCursor,
        locate_query: 'false',
        show_live_replay_strategy: '1',
        need_time_list: '1',
        time_list_query: '0',
        whale_cut_token: '',
        cut_version: '1',
        count: String(count),
      };

      const json = await fetchJsonWithDouyinEnv(
        context,
        page,
        '/aweme/v1/web/aweme/post/',
        postParams,
        referer,
        'postApi',
        diagnostic,
      );
      diagnostic.postStatusCode = json.status_code;
      diagnostic.postHasMore = json.has_more;
      const parsed = parseDouyinAwemeList(json, `作者主页:${secUid}`, max - data.length);
      data.push(...parsed);

      if (!json.has_more || parsed.length === 0) break;
      maxCursor = json.max_cursor || json.cursor || maxCursor;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await page.close().catch(() => {});
    return {
      success: true,
      sec_uid: secUid,
      data,
      count: data.length,
      diagnostic,
      elapsed: `${Date.now() - startTime}ms`,
    };
  } catch (e) {
    console.error('[Douyin] creator videos error:', e.message);
    return {
      success: false,
      error: e.message,
      needVerify: !!e.needVerify,
      data,
      count: data.length,
      diagnostic,
      elapsed: `${Date.now() - startTime}ms`,
    };
  }
}

async function fetchDouyinCommentReplies(context, page, awemeId, commentId, maxReplies, env, diagnostic) {
  const replies = [];
  let cursor = 0;
  const referer = `https://www.douyin.com/video/${awemeId}`;

  while (replies.length < maxReplies) {
    const params = {
      ...buildDouyinSearchParams('', 20, '', 0, env),
      item_id: awemeId,
      comment_id: commentId,
      count: String(Math.min(20, maxReplies - replies.length)),
      cursor,
      item_type: '0',
    };
    delete params.keyword;
    delete params.search_channel;
    delete params.search_source;
    delete params.query_correct_type;
    delete params.is_filter_search;
    delete params.from_group_id;
    delete params.need_filter_settings;
    delete params.list_type;
    delete params.search_id;

    const json = await fetchJsonWithDouyinEnv(
      context,
      page,
      '/aweme/v1/web/comment/list/reply/',
      params,
      referer,
      'replyApi',
      diagnostic,
    );
    const rows = Array.isArray(json.comments) ? json.comments : [];
    replies.push(...rows.map(row => parseDouyinComment(row)));
    if (!json.has_more || rows.length === 0) break;
    cursor = json.cursor || cursor + rows.length;
    await new Promise(resolve => setTimeout(resolve, 800));
  }

  return replies.slice(0, maxReplies);
}

async function fetchDouyinCommentsByApi(context, page, awemeId, maxCount, includeReplies, maxRepliesPerComment, diagnostic) {
  const comments = [];
  let cursor = 0;
  const env = await getDouyinRequestEnv(page, context);
  diagnostic.requestEnv = {
    hasMsToken: !!env.msToken,
    hasWebId: !!env.webid,
    browser_version: env.browser_version,
  };
  const referer = `https://www.douyin.com/video/${awemeId}`;

  while (comments.length < maxCount) {
    const params = {
      ...buildDouyinSearchParams('', 20, '', 0, env),
      aweme_id: awemeId,
      cursor,
      count: String(Math.min(20, maxCount - comments.length)),
      item_type: '0',
    };
    delete params.keyword;
    delete params.search_channel;
    delete params.search_source;
    delete params.query_correct_type;
    delete params.is_filter_search;
    delete params.from_group_id;
    delete params.need_filter_settings;
    delete params.list_type;
    delete params.search_id;

    const json = await fetchJsonWithDouyinEnv(
      context,
      page,
      '/aweme/v1/web/comment/list/',
      params,
      referer,
      'commentApi',
      diagnostic,
    );
    diagnostic.commentStatusCode = json.status_code;
    diagnostic.commentHasMore = json.has_more;
    const rows = Array.isArray(json.comments) ? json.comments : [];

    for (const row of rows) {
      let replies = [];
      const replyTotal = row.reply_comment_total || 0;
      if (includeReplies && replyTotal > 0 && maxRepliesPerComment > 0) {
        replies = await fetchDouyinCommentReplies(
          context,
          page,
          awemeId,
          row.cid,
          Math.min(maxRepliesPerComment, replyTotal),
          env,
          diagnostic,
        );
      }
      comments.push(parseDouyinComment(row, replies));
      if (comments.length >= maxCount) break;
    }

    if (!json.has_more || rows.length === 0) break;
    cursor = json.cursor || cursor + rows.length;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return comments.slice(0, maxCount);
}

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

    const page = await context.newPage();
    await page.bringToFront();

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
    console.log('[抖音] contexts 数量:', browser.contexts().length);
    console.log('[抖音] pages 数量:', contexts.length > 0 ? contexts[0].pages().length : 0);
    
    try {
      await page.goto('https://www.douyin.com', {
        waitUntil: 'domcontentloaded',
        timeout: 30000, // 增加到 30 秒
      });
      console.log('[抖音] 页面加载完成，URL:', page.url());
    } catch (e) {
      console.error('[抖音] 页面加载失败:', e.message);
      // 即使加载失败，也尝试截图
    }

    // 检查是否已经登录
    const status = await isLoggedIn(page, context);
    if (isDouyinCaptchaTitle(status.title)) {
      console.log('[Douyin] Captcha page detected during login; keep Chrome open for manual verification');
      global._douyinLoginContext = context;
      global._douyinLoginPage = page;
      global._douyinBrowser = browser;
      return {
        alreadyLoggedIn: false,
        needVerify: true,
        qrcode: '',
        message: 'Douyin captcha page detected. Complete verification in the opened Chrome window, then wait for login status.',
      };
    }

    if (canUseDouyinLoginStatus(status)) {
      console.log('[抖音] 已处于登录状态！保存 Cookie');
      const allCookies = await context.cookies('https://www.douyin.com');
      storedDouyinCookies = allCookies;
      saveCookiesToDisk(allCookies);  // ← 持久化到磁盘
      console.log(`[抖音] 保存了 ${allCookies.length} 个 Cookie`);
      await browser.close();
      return {
        alreadyLoggedIn: true,
        qrcode: '',
      };
    }

    // 点击登录按钮
    await page.waitForTimeout(5000); // 增加等待时间到 5 秒
    
    // 使用正确的 Playwright JS API
    const loginBtn = page.getByText('登录', { exact: false });
    const count = await loginBtn.count();
    if (count > 0) {
      // 使用 force: true 绕过遮罩层检查
      await loginBtn.first().click({ force: true });
      console.log('[抖音] 点击登录按钮 (getByText, force)');
    } else {
      // 后备方案：使用 locator
      const btn = page.locator('button:has-text("登录")');
      const btnCount = await btn.count();
      if (btnCount > 0) {
        await btn.first().click({ force: true });
        console.log('[抖音] 点击登录按钮 (locator, force)');
      } else {
        console.log('[抖音] 未找到登录按钮');
      }
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
    const status = await isLoggedIn(page, context);

    if (isDouyinCaptchaTitle(status.title)) {
      return {
        loggedIn: false,
        needVerify: true,
        message: 'Douyin captcha page detected. Complete verification in the opened Chrome window.',
        url: status.url,
        title: status.title,
      };
    }

    if (canUseDouyinLoginStatus(status)) {
      console.log('[抖音] 扫码登录成功！保存 Cookie');

      // 读取所有 Cookie（包括 HttpOnly）
      const allCookies = await context.cookies('https://www.douyin.com');
      storedDouyinCookies = allCookies;
      saveCookiesToDisk(allCookies);  // ← 持久化到磁盘
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
        needLogin: true,  // ← 改为 needLogin，与 index.js 保持一致
        message: '尚未登录，请先使用「扫码登录」获取登录态',
        diagnostic,
        elapsed: `${Date.now() - startTime}ms`,
      };
    }

    console.log(`[抖音] 连接可见 Chrome (CDP 模式)，使用 ${cookiesToInject.length} 个 Cookie...`);

    // 使用可见 CDP Chrome，验证码出现时用户才能手动处理
    const { browser } = await startChromeWithCDP(false);

    // ====== 关键修复：复用已有的 Context，而不是创建新的 ======
    let context;
    const existingContexts = browser.contexts();
    if (existingContexts.length > 0) {
      // 复用扫码登录时的 Context（已包含登录态和 user-data-dir）
      context = existingContexts[0];
      console.log(`[抖音] 复用已有 Context (ID: ${context._guid || 'default'})`);
    } else {
      // 兜底：创建新 Context
      context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
      });
      console.log('[抖音] 创建了新 Context');
    }

    // 如果不是复用的已登录 Context，才需要注入 Cookie
    // Always use a dedicated search tab. Reusing the visible Douyin tab can race with page navigation.
    const page = await context.newPage();
    console.log('[Douyin] Created dedicated search page');
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

    const loginStatus = await isLoggedIn(page, context);
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

    diagnostic.pageTitle = await page.title();
    if (isDouyinCaptchaTitle(diagnostic.pageTitle)) {
      const elapsed = `${Date.now() - startTime}ms`;
      return {
        success: true,
        data: [],
        count: 0,
        needVerify: true,
        message: 'Douyin captcha page detected. Complete verification in the opened Chrome window, then retry search.',
        diagnostic,
        elapsed,
      };
    }

    console.log('[Douyin] Searching through Web API instead of navigating to the search page');
    const apiResult = await fetchDouyinSearchByApi(context, page, keyword, parseInt(maxCount, 10) || 10, diagnostic);
    const searchData = apiResult.data;

    if (apiResult.needVerify) {
      const elapsed = `${Date.now() - startTime}ms`;
      return {
        success: true,
        data: searchData,
        count: searchData.length,
        needVerify: true,
        message: apiResult.message,
        diagnostic,
        elapsed,
      };
    }
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

async function getComments(awemeId, options = {}) {
  const diagnostic = {};
  const startTime = Date.now();
  const maxCount = Math.min(Math.max(parseInt(options.max || 50, 10), 1), 100);
  const includeReplies = options.includeReplies !== false;
  const maxReplies = Math.min(Math.max(parseInt(options.maxReplies || 20, 10), 0), 50);

  try {
    if (!awemeId) {
      return { success: false, error: 'Missing aweme_id', data: [], count: 0 };
    }
    if (storedDouyinCookies.length === 0) {
      return {
        success: true,
        data: [],
        count: 0,
        needLogin: true,
        message: 'Not logged in. Please scan QR code first.',
        diagnostic,
        elapsed: `${Date.now() - startTime}ms`,
      };
    }

    const { browser } = await startChromeWithCDP(false);
    const context = browser.contexts()[0] || await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    await page.goto('https://www.douyin.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    diagnostic.pageUrl = page.url();

    const loginStatus = await isLoggedIn(page, context);
    diagnostic.loginStatus = loginStatus;
    if (!canUseDouyinLoginStatus(loginStatus)) {
      await page.close().catch(() => {});
      return {
        success: true,
        data: [],
        count: 0,
        needVerify: isDouyinCaptchaTitle(loginStatus.title),
        needLogin: !loginStatus.loggedIn,
        message: isDouyinCaptchaTitle(loginStatus.title)
          ? 'Douyin captcha page detected. Complete verification in Chrome, then retry.'
          : 'Not logged in. Please scan QR code first.',
        diagnostic,
        elapsed: `${Date.now() - startTime}ms`,
      };
    }

    const data = await fetchDouyinCommentsByApi(
      context,
      page,
      awemeId,
      maxCount,
      includeReplies,
      maxReplies,
      diagnostic,
    );
    await page.close().catch(() => {});
    return {
      success: true,
      aweme_id: awemeId,
      count: data.length,
      data,
      elapsed: `${Date.now() - startTime}ms`,
      diagnostic,
    };
  } catch (e) {
    console.error('[Douyin] comments error:', e.message);
    return {
      success: false,
      error: e.message,
      needVerify: !!e.needVerify,
      data: [],
      count: 0,
      diagnostic,
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
  getComments,
  parseCookies,
  buildDouyinSearchParams,
  shouldSignDouyinApi,
  getDouyinABogusFromJs,
  canUseDouyinLoginStatus,
  isDouyinCaptchaTitle,
  parseDouyinComment,
  parseDouyinSearchResponse,
  parseDouyinVideoDetail,
  enrichDouyinItemsWithDetails,
  getVideoDetail,
  getVideosByIds,
  getCreatorVideos,
  parseDouyinAwemeId,
  parseDouyinSecUid,
};
