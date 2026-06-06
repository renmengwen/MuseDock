/**
 * 测试使用 executablePath 启动 Chrome
 */

const { chromium } = require('playwright');
const fs = require('fs');

async function testChromeLaunch() {
  console.log('[测试] 开始测试 Chrome 启动...');

  // Windows 系统 Chrome 常见路径
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  ];

  let chromePath = '';
  for (const p of chromePaths) {
    try {
      if (fs.existsSync(p)) {
        chromePath = p;
        break;
      }
    } catch (e) {}
  }

  if (!chromePath) {
    console.error('[测试] 未找到 Chrome');
    return;
  }

  console.log(`[测试] 使用 Chrome 路径: ${chromePath}`);

  try {
    const browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    console.log('[测试] Chrome 启动成功！');

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://www.baidu.com');
    console.log('[测试] 打开百度成功，标题:', await page.title());

    await browser.close();
    console.log('[测试] Chrome 关闭成功！');
  } catch (e) {
    console.error('[测试] Chrome 启动失败:', e.message);
    console.error(e.stack);
  }
}

testChromeLaunch();
