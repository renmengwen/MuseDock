const DOUYIN_VIDEO_PAGE_MESSAGES = Object.freeze({
  DOUYIN_SOURCE_INVALID: '抖音视频编号无效，请检查输入的视频链接。',
  DOUYIN_NEEDS_LOGIN: '抖音要求重新登录，请点击“登录抖音”，完成登录后重试。',
  DOUYIN_ACCESS_DENIED: '抖音拒绝读取该视频，请在 MuseDock 打开的 Chrome 中确认视频可播放，并完成页面要求的验证后重试。',
  DOUYIN_RATE_LIMITED: '抖音请求过于频繁，请稍后再试，避免连续提交。',
  DOUYIN_VIDEO_UNAVAILABLE: '抖音没有返回该视频的信息，请在 MuseDock 打开的 Chrome 中确认视频可正常播放。',
  DOUYIN_RESPONSE_INVALID: '抖音返回的视频信息格式异常，请稍后重试。',
  DOUYIN_SOURCE_TIMEOUT: '等待抖音视频信息超时，请检查 Chrome 中的视频页面是否加载完成后重试。',
  DOUYIN_SOURCE_NETWORK: '抖音视频页面加载失败，请检查网络，并确认 Chrome 可以打开该视频。',
  DOUYIN_SOURCE_HTTP_ERROR: '抖音视频信息请求失败，请稍后重试。',
  DOUYIN_BROWSER_CLOSED: '读取视频时 Chrome 页面已关闭，请重新开始转写并保持登录窗口打开。',
  SOURCE_MISMATCH: '抖音返回的视频与输入的视频 ID 不一致，已停止转写。',
});

class DouyinVideoPageError extends Error {
  constructor(code) {
    super(DOUYIN_VIDEO_PAGE_MESSAGES[code]);
    this.name = 'DouyinVideoPageError';
    this.code = code;
  }
}

function responseError(status) {
  const code = { 401: 'DOUYIN_NEEDS_LOGIN', 403: 'DOUYIN_ACCESS_DENIED',
    404: 'DOUYIN_VIDEO_UNAVAILABLE', 429: 'DOUYIN_RATE_LIMITED' }[status] || 'DOUYIN_SOURCE_HTTP_ERROR';
  return new DouyinVideoPageError(code);
}

async function readDouyinVideoPage(page, awemeId, { diagnostic = {}, timeoutMs = 20000 } = {}) {
  const expectedId = String(awemeId);
  if (!/^\d{1,30}$/.test(expectedId)) throw new DouyinVideoPageError('DOUYIN_SOURCE_INVALID');
  let settled = false;
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    if (error) rejectResult(error);
    else resolveResult(value);
  };

  const onResponse = response => {
    if (settled) return;
    let url;
    try { url = new URL(response.url()); } catch { return; }
    if (url.origin !== 'https://www.douyin.com' || url.pathname !== '/aweme/v1/web/aweme/detail/'
      || url.searchParams.get('aweme_id') !== expectedId) return;

    // 只消费正常视频页面自身发出的响应；不复制签名、账号参数或其他视频的数据。
    diagnostic.detailApi = { method: 'browser-page', status: response.status() };
    if (!response.ok()) { finish(responseError(response.status())); return; }
    void response.json().then(json => {
      if (settled) return;
      diagnostic.detailApi.statusCode = json?.status_code;
      const aweme = json?.aweme_detail;
      if ((json?.status_code != null && Number(json.status_code) !== 0) || !aweme?.aweme_id) {
        finish(new DouyinVideoPageError('DOUYIN_VIDEO_UNAVAILABLE'));
      } else if (String(aweme.aweme_id) !== expectedId) {
        finish(new DouyinVideoPageError('SOURCE_MISMATCH'));
      } else {
        finish(null, json);
      }
    }).catch(() => finish(new DouyinVideoPageError('DOUYIN_RESPONSE_INVALID')));
  };
  const onClose = () => finish(new DouyinVideoPageError('DOUYIN_BROWSER_CLOSED'));
  page.on('response', onResponse);
  page.on('close', onClose);
  const timer = setTimeout(() => finish(new DouyinVideoPageError('DOUYIN_SOURCE_TIMEOUT')), timeoutMs);
  const navigation = Promise.resolve().then(() => page.goto(`https://www.douyin.com/video/${expectedId}`, {
    waitUntil: 'domcontentloaded', timeout: timeoutMs,
  })).then(response => {
    if (response && !response.ok()) finish(responseError(response.status()));
  }).catch(error => finish(new DouyinVideoPageError(error.name === 'TimeoutError' ? 'DOUYIN_SOURCE_TIMEOUT' : 'DOUYIN_SOURCE_NETWORK')));

  try {
    const [json] = await Promise.all([result, navigation]);
    return json;
  } finally {
    clearTimeout(timer);
    page.off('response', onResponse);
    page.off('close', onClose);
  }
}

module.exports = { readDouyinVideoPage, DouyinVideoPageError, DOUYIN_VIDEO_PAGE_MESSAGES };
