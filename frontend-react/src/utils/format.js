export function formatTime(value) {
  if (value === null || value === undefined || value === '') return '-';

  if (typeof value === 'string' && Number.isNaN(Number(value))) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toLocaleString('zh-CN', { hour12: false });
    }
    return value;
  }

  const num = Number(value || 0);
  if (!num) return '-';
  const ms = num > 1e12 ? num : num * 1000;
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

export function getDouyinAwemeId(item = {}) {
  const source = item || {};
  return String(source.aweme_id || source.id || '');
}

export function getDouyinUrl(item = {}) {
  const source = item || {};
  const awemeId = getDouyinAwemeId(source);
  return source.url || source.aweme_url || (awemeId ? `https://www.douyin.com/video/${awemeId}` : '#');
}
