/**
 * 验证 API 拦截方案可行性
 * 核心思路：打开抖音搜索页 → 页面 JS 自动发带签名的 API 请求 → 我们拦截响应
 */
const { chromium } = require('playwright');

// 从服务器内存获取已登录 Cookie
const http = require('http');
let savedCookies = [];

async function getCookiesFromServer() {
  return new Promise((resolve) => {
    http.get('http://localhost:3000/api/config/cookies', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.douyin) {
            try {
              resolve(JSON.parse(json.douyin));
            } catch {
              resolve([]);
            }
          } else {
            resolve([]);
          }
        } catch {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

async function test() {
  console.log('====== API 拦截方案 - 可行性验证 ======\n');

  // 从服务器获取已保存的 Cookie
  savedCookies = await getCookiesFromServer();
  console.log(`从服务器获取 Cookie: ${savedCookies.length} 个`);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--single-process'],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // 拦截所有响应
  const capturedResponses = [];
  page.on('response', async (response) => {
    const url = response.url();

    // 关注搜索相关的 API
    const isSearchAPI =
      url.includes('/aweme/v1/web/search/') ||
      url.includes('/aweme/v1/web/general/search');

    // 也看看其他可能的 API
    const isAPI =
      url.includes('/aweme/') ||
      url.includes('/web/api/');

    if (!isAPI) return;

    const status = response.status();
    const contentType = response.headers()['content-type'] || '';

    if (isSearchAPI) {
      console.log(`\n🔍 [搜索API] ${status} ${url.substring(0, 120)}`);
      if (contentType.includes('json')) {
        try {
          const json = await response.json();
          const keys = Object.keys(json);
          console.log(`   响应 keys: ${keys.join(', ')}`);

          if (json.aweme_list) {
            console.log(`   ✅ aweme_list 长度: ${json.aweme_list.length}`);
            if (json.aweme_list.length > 0) {
              const first = json.aweme_list[0];
              console.log(`   第一条视频: ${JSON.stringify(first, null, 2).substring(0, 300)}`);
            }
          }
          if (json.data) {
            console.log(`   data 字段类型: ${typeof json.data}, keys: ${json.data ? Object.keys(json.data).join(', ') : 'null'}`);
          }
          capturedResponses.push({ url, keys, itemCount: json.aweme_list?.length || 0 });
        } catch (e) {
          console.log(`   ⚠️ 解析 JSON 失败: ${e.message}`);
        }
      }
    } else {
      console.log(`   [其他API] ${status} ${url.substring(0, 100)}`);
    }
  });

  // 注入登录 Cookie（如果有）
  if (savedCookies && savedCookies.length > 0) {
    await context.addCookies(savedCookies);
    console.log(`✅ 注入 ${savedCookies.length} 个 Cookie`);
  } else {
    console.log('⚠️ 无 Cookie，将使用未登录态测试');
  }

  // 打开抖音搜索页
  const keyword = '测试';
  const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=general`;

  console.log(`\n📡 打开搜索页: ${searchUrl}\n`);

  try {
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // 等待 API 请求完成（页面加载后 JS 会自动发请求）
    console.log('⏳ 等待 8 秒让 API 请求完成...');
    await page.waitForTimeout(8000);

    // 打印页面状态
    const pageInfo = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      bodyTextLength: (document.body?.innerText || '').length,
      videoCards: document.querySelectorAll('[data-e2e="search-card"], a[href*="video"], .search-result-card').length,
    }));
    console.log(`\n📄 页面状态:`, JSON.stringify(pageInfo, null, 2));

  } catch (err) {
    console.error(`❌ 页面加载失败: ${err.message}`);
  }

  // 总结
  console.log(`\n====== 验证结果 ======`);
  if (capturedResponses.length > 0) {
    const withData = capturedResponses.filter(r => r.itemCount > 0);
    console.log(`✅ 捕获到 ${capturedResponses.length} 个搜索 API 响应`);
    console.log(`✅ 其中 ${withData.length} 个包含视频数据`);
    if (withData.length > 0) {
      console.log(`🔑 方案可行！API 拦截能拿到结构化 JSON 数据`);
    }
  } else {
    console.log(`⚠️ 未捕获到搜索 API 响应`);
    console.log(`   可能原因：未登录 / 页面未发 API / API URL 模式不对`);
  }

  await browser.close();
  console.log(`\n验证完成`);
}

test().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
