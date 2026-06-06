/**
 * 测试：用 Playwright 加载 Chrome 真实用户配置，看能否读取登录态
 */
const { chromium } = require('playwright');

const USER_DATA_DIR = process.env.LOCALAPPDATA + '/Google/Chrome/User Data';

async function test() {
  console.log('[测试] 尝试加载 Chrome 用户数据:', USER_DATA_DIR);

  let browser;
  try {
    browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
      channel: 'chrome',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
      viewport: { width: 1920, height: 1080 },
      locale: 'zh-CN',
    });

    const page = await browser.newPage();
    await page.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
    `);

    console.log('[测试] 打开抖音搜索页...');
    await page.goto('https://www.douyin.com/search/codex?type=general', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(8000);

    // 检查登录状态
    const status = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      const hasLogin = !body.includes('登录');
      const videoLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'))
        .slice(0, 3)
        .map(a => a.href);
      return {
        loggedIn: hasLogin,
        videoLinksCount: videoLinks.length,
        videoLinks: videoLinks,
        pageText: body.substring(0, 400),
      };
    });

    console.log('\n========== 结果 ==========');
    console.log('登录状态:', status.loggedIn ? '✅ 已登录' : '❌ 未登录');
    console.log('视频链接数:', status.videoLinksCount);
    if (status.videoLinks.length > 0) {
      console.log('示例链接:', status.videoLinks[0]);
    }
    console.log('页面摘要:', status.pageText.substring(0, 200));

    return status;
  } catch (err) {
    console.error('[测试] 失败:', err.message);
    return null;
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
  }
}

test().then(r => {
  if (r && r.loggedIn && r.videoLinksCount > 0) {
    console.log('\n🎉 成功！可以直接用 Chrome 配置抓取，无需手动配置 Cookie！');
    console.log('将 douyin.js 改为使用 launchPersistentContext 即可。');
  } else {
    console.log('\n⚠️  此方法未成功，可能需要其他方案。');
  }
});
