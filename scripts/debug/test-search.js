// 诊断脚本：直接调用 searchVideos，打印完整日志
const { searchVideos } = require('../../server/scraper/douyin');

// 从诊断接口获取的实际 Cookie（简化版，只保留关键部分用于测试）
// 实际上我们需要的是用户粘贴的完整 Cookie
// 让我们先从服务端 API 读取

async function test() {
  try {
    const res = await fetch('http://localhost:3000/api/config/cookies');
    const json = await res.json();
    console.log('当前保存的 Cookie 长度:', json.douyin?.length || 0);

    if (!json.douyin || json.douyin.length < 10) {
      console.log('Cookie 为空或太短，无法测试');
      return;
    }

    console.log('\n开始搜索测试...');
    const results = await searchVideos('codex', 5, json.douyin);
    console.log('\n搜索结果:', results.length, '条');
    if (results.length > 0) {
      console.log('第一条:', JSON.stringify(results[0], null, 2));
    }
  } catch (e) {
    console.error('测试失败:', e.message);
    console.error(e.stack);
  }
}

test();
