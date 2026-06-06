const { chromium } = require('playwright');

async function test() {
  console.log('=== 测试1: 最精简参数 ===');
  try {
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    console.log('✅ 测试1 成功');
    const page = await browser.newPage();
    await page.goto('https://www.baidu.com', { timeout: 10000 });
    console.log('  百度标题:', await page.title());
    await browser.close();
  } catch(e) {
    console.log('❌ 测试1 失败:', e.message);
  }

  console.log('\n=== 测试2: 加 --disable-dev-shm-usage ===');
  try {
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    console.log('✅ 测试2 成功');
    await browser.close();
  } catch(e) {
    console.log('❌ 测试2 失败:', e.message);
  }

  console.log('\n=== 测试3: 完全不加 args ===');
  try {
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
    });
    console.log('✅ 测试3 成功');
    await browser.close();
  } catch(e) {
    console.log('❌ 测试3 失败:', e.message);
  }
}

test().catch(e => console.error('Fatal:', e.message));
