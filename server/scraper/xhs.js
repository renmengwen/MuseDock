const { chromium } = require('playwright');
const db = require('../db');

const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });
  window.chrome = { runtime: {} };
`;

function parseCookies(cookieStr, domain = '.xiaohongshu.com') {
  if (!cookieStr || !cookieStr.trim()) return [];
  return cookieStr.split(';').map(pair => {
    const [name, ...rest] = pair.trim().split('=');
    return {
      name: name.trim(),
      value: rest.join('=').trim(),
      domain,
      path: '/',
    };
  }).filter(c => c.name && c.value);
}

async function searchNotes(keyword, maxCount = 20, cookieStr = '') {
  let browser;
  const results = [];

  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'zh-CN',
    });

    const cookies = parseCookies(cookieStr);
    if (cookies.length > 0) {
      await context.addCookies(cookies);
      console.log(`[小红书] 已注入 ${cookies.length} 个 Cookie`);
    } else {
      console.log('[小红书] ⚠️  未提供 Cookie，可能无法获取搜索结果');
    }

    const page = await context.newPage();
    await page.addInitScript(STEALTH_SCRIPT);

    const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`;
    console.log(`[小红书] 打开: ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('[小红书] 页面加载完成，等待 JS 渲染...');
    await page.waitForTimeout(6000);

    // 检查登录状态
    const hasLogin = await page.evaluate(() => {
      return !document.body.innerText.includes('登录');
    });
    console.log(`[小红书] 登录状态: ${hasLogin ? '✅ 已登录' : '❌ 未登录'}`);

    // 寻找笔记链接
    const noteLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/"]'))
        .slice(0, 10)
        .map(a => ({ href: a.href, text: a.textContent?.substring(0, 50) }));
    });
    console.log(`[小红书] 笔记链接数: ${noteLinks.length}`);
    if (noteLinks.length > 0) {
      console.log('[小红书] 示例:', JSON.stringify(noteLinks[0]));
    }

    for (const link of noteLinks.slice(0, maxCount)) {
      const match = link.href.match(/\/(explore|discovery\/item)\/([a-zA-Z0-9]+)/);
      if (match) {
        results.push({
          note_id: match[2],
          title: link.text || '',
          cover_url: '',
          note_url: link.href,
          keyword,
        });
      }
    }

    if (results.length === 0) {
      const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
      console.log('[小红书] 页面文本:', pageText.substring(0, 300));
    }

    return results;

  } catch (err) {
    console.error('[小红书] 异常:', err.message);
    return results;
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
  }
}

async function getNoteDetail(noteId) {
  let browser;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();
    await page.addInitScript(STEALTH_SCRIPT);

    const url = `https://www.xiaohongshu.com/explore/${noteId}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const detail = await page.evaluate(() => {
      const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
      return {
        title: getText('#detail-title') || getText('h1') || getText('[class*="title"]'),
        description: getText('#detail-desc') || getText('.note-text') || getText('[class*="desc"]'),
        liked_count: 0, comment_count: 0, collected_count: 0,
      };
    });
    return detail;
  } catch (err) {
    console.error('[小红书详情] 异常:', err.message);
    return null;
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
  }
}

module.exports = { searchNotes, getNoteDetail };
