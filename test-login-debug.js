const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const USER_DATA_DIR = path.join(__dirname, 'browser_data', 'douyin');

(async () => {
  console.log('=== 抖音登录态诊断 ===');
  console.log('USER_DATA_DIR:', USER_DATA_DIR);
  console.log('目录存在?', fs.existsSync(USER_DATA_DIR));

  if (fs.existsSync(USER_DATA_DIR)) {
    const files = fs.readdirSync(USER_DATA_DIR);
    console.log('目录内容:', files);
  }

  console.log('\n启动 headless persistent context...');
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    channel: 'chrome',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
    ],
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  // 注入反检测
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {} };
  });

  console.log('打开抖音首页...');
  await page.goto('https://www.douyin.com', {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });

  console.log('当前URL:', page.url());
  console.log('页面标题:', await page.title());

  // 检查登录状态
  const loginInfo = await page.evaluate(() => {
    let hasLocalStorage = false;
    try {
      hasLocalStorage = localStorage.getItem('HasUserLogin') === '1';
    } catch (e) {}

    let hasLoginStatusCookie = false;
    try {
      hasLoginStatusCookie = document.cookie.includes('LOGIN_STATUS=1');
    } catch (e) {}

    // 获取所有 cookie
    let allCookies = '';
    try { allCookies = document.cookie; } catch (e) {}

    return {
      hasLocalStorage,
      hasLoginStatusCookie,
      allCookies,
      title: document.title,
      url: window.location.href,
    };
  });

  console.log('\n登录状态:', loginInfo);

  // 截图
  await page.screenshot({ path: 'debug-homepage.png', fullPage: true });
  console.log('首页截图已保存到 debug-homepage.png');

  // 如果已登录，尝试搜索
  if (loginInfo.hasLocalStorage || loginInfo.hasLoginStatusCookie) {
    console.log('\n已登录，尝试搜索 "codexx"...');
    const searchUrl = `https://www.douyin.com/search/${encodeURIComponent('codexx')}?type=general`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    console.log('搜索页URL:', page.url());
    console.log('搜索页标题:', await page.title());

    // 检查页面结构
    const pageInfo = await page.evaluate(() => {
      return {
        videoLinks: document.querySelectorAll('a[href*="/video/"]').length,
        noteLinks: document.querySelectorAll('a[href*="/note/"]').length,
        bodyTextLength: document.body.innerText.length,
        hasLoginWall: document.body.innerText.includes('登录后免费看高清视频'),
        scriptsWithData: Array.from(document.querySelectorAll('script')).filter(s => s.textContent.includes('__INITIAL')).length,
      };
    });
    console.log('页面结构:', pageInfo);

    await page.screenshot({ path: 'debug-search.png', fullPage: true });
    console.log('搜索页截图已保存到 debug-search.png');
  } else {
    console.log('\n❌ 未检测到登录态，需要先扫码登录');
  }

  await context.close();
  console.log('\n诊断完成');
})().catch(e => {
  console.error('ERROR:', e.message);
  console.error(e.stack);
});
