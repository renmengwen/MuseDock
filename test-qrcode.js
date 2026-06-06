const { startQrcodeLogin, checkLoginResult } = require('./server/scraper/douyin');

async function test() {
  console.log('====== 测试扫码登录 ======\n');
  try {
    console.log('调用 startQrcodeLogin()...');
    const result = await startQrcodeLogin();
    console.log('\n结果:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('\n❌ 错误:', e.message);
    console.error('堆栈:', e.stack);
  }
}

test();
