const { chromium } = require('playwright');

async function test() {
  console.log('1. 启动 Chrome (visible 模式)...');
  let browser;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: ['--no-sandbox', '--disable-gpu'],
    });
    console.log('2. Chrome 启动成功!');
  } catch (e) {
    console.error('Chrome 启动失败:', e.message);
    return;
  }

  try {
    const page = await browser.newPage();
    console.log('3. 新页面创建成功');

    await page.goto('https://www.douyin.com', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    console.log('4. 页面加载完成');
    console.log('   URL:', page.url());
    console.log('   标题:', await page.title());

    console.log('\n验证：Chrome 窗口应该已经弹出来了。');
    console.log('请在 10 秒内查看桌面...');
    await page.waitForTimeout(10000);

  } catch (e) {
    console.error('页面操作失败:', e.message);
  } finally {
    await browser.close();
    console.log('浏览器已关闭');
  }
}

test().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
