const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readDouyinVideoPage, DouyinVideoPageError } = require('../server/scraper/douyinVideoPage');

const VIDEO_ID = '1234567890123456789';
const DETAIL_URL = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${VIDEO_ID}&msToken=must-not-leak`;
const video = { status_code: 0, aweme_detail: { aweme_id: VIDEO_ID,
  video: { play_addr_h264: { url_list: ['https://example.invalid/video.mp4'] } } } };

function response({ url = DETAIL_URL, status = 200, body = video, jsonError = false } = {}) {
  return { url: () => url, status: () => status, ok: () => status >= 200 && status < 300,
    json: async () => { if (jsonError) throw new Error('private upstream body must-not-leak'); return body; } };
}

function pageFixture(onNavigate = () => {}) {
  const page = new EventEmitter();
  page.navigations = [];
  page.goto = async (url, options) => {
    page.navigations.push({ url, options });
    return await onNavigate(page) || response();
  };
  return page;
}

async function expectFailure(page, code, timeoutMs = 1000) {
  await assert.rejects(readDouyinVideoPage(page, VIDEO_ID, { timeoutMs }), error => {
    assert.ok(error instanceof DouyinVideoPageError);
    assert.equal(error.code, code);
    assert.ok(!error.message.includes('must-not-leak'));
    return true;
  });
  assert.equal(page.listenerCount('response'), 0);
  assert.equal(page.listenerCount('close'), 0);
  assert.equal(page.navigations.length, 1, '失败不得自动反复打开视频页面');
}

async function run() {
  const diagnostic = {};
  const page = pageFixture(current => {
    current.emit('response', response({ url: DETAIL_URL.replace('www.douyin.com', 'example.invalid'), jsonError: true }));
    current.emit('response', response({ url: DETAIL_URL.replace(VIDEO_ID, '9999999999999999999'), jsonError: true }));
    current.emit('response', response());
  });
  assert.deepEqual(await readDouyinVideoPage(page, VIDEO_ID, { diagnostic }), video);
  assert.equal(page.navigations[0].url, `https://www.douyin.com/video/${VIDEO_ID}`);
  assert.equal(page.navigations[0].options.waitUntil, 'domcontentloaded');
  assert.deepEqual(diagnostic, { detailApi: { method: 'browser-page', status: 200, statusCode: 0 } });
  assert.ok(!JSON.stringify(diagnostic).includes('must-not-leak'), '不保留带账号参数的请求地址');
  assert.equal(page.listenerCount('response'), 0);
  assert.equal(page.listenerCount('close'), 0);

  const mismatched = pageFixture(current => {
    current.emit('response', response({
      body: { ...video, aweme_detail: { ...video.aweme_detail, aweme_id: '9999999999999999999' } },
    }));
  });
  await expectFailure(mismatched, 'SOURCE_MISMATCH');

  for (const [status, code] of [[401, 'DOUYIN_NEEDS_LOGIN'], [403, 'DOUYIN_ACCESS_DENIED'],
    [404, 'DOUYIN_VIDEO_UNAVAILABLE'], [429, 'DOUYIN_RATE_LIMITED'], [503, 'DOUYIN_SOURCE_HTTP_ERROR']]) {
    await expectFailure(pageFixture(current => { current.emit('response', response({ status })); }), code);
  }

  await expectFailure(pageFixture(current => { current.emit('response', response({ jsonError: true })); }), 'DOUYIN_RESPONSE_INVALID');
  await expectFailure(pageFixture(current => { current.emit('response', response({ body: { status_code: 0, aweme_detail: null } })); }), 'DOUYIN_VIDEO_UNAVAILABLE');
  await expectFailure(pageFixture(current => { current.emit('response', response({ body: { status_code: 1, status_msg: 'must-not-leak', aweme_detail: video.aweme_detail } })); }), 'DOUYIN_VIDEO_UNAVAILABLE');
  await expectFailure(pageFixture(), 'DOUYIN_SOURCE_TIMEOUT', 25);
  await expectFailure(pageFixture(current => { current.emit('close'); }), 'DOUYIN_BROWSER_CLOSED');
  await expectFailure(pageFixture(() => { throw new Error('network failed: must-not-leak'); }), 'DOUYIN_SOURCE_NETWORK');
  await expectFailure(pageFixture(() => {
    const error = new Error('navigation timed out'); error.name = 'TimeoutError'; throw error;
  }), 'DOUYIN_SOURCE_TIMEOUT');
  await expectFailure(pageFixture(() => response({ status: 403 })), 'DOUYIN_ACCESS_DENIED');

  const invalid = pageFixture();
  await assert.rejects(readDouyinVideoPage(invalid, '../other-page'), error => error.code === 'DOUYIN_SOURCE_INVALID');
  assert.equal(invalid.navigations.length, 0);
}

run().then(() => console.log('抖音视频页面读取测试通过：原生响应、视频身份核对、访问拒绝与限流、无效返回、超时、关闭清理和敏感参数保护。'))
  .catch(error => { console.error(error); process.exitCode = 1; });
