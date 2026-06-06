export function getItemTitle(item = {}) {
  return String(item.title || item.description || '');
}

export function filterByTitle(data = [], query = '') {
  const keyword = String(query || '').trim().toLowerCase();
  if (!keyword) return data;
  return data.filter(item => getItemTitle(item).toLowerCase().includes(keyword));
}

export function withCrawlTimestamp(data = [], nowSeconds = Math.floor(Date.now() / 1000)) {
  return data.map(item => ({
    ...item,
    crawled_at: item.crawled_at || nowSeconds,
  }));
}

function readDurationMs(value) {
  if (value && typeof value === 'object') {
    return readDurationMs(value.duration_ms ?? value.video_duration_ms ?? value.duration ?? value.video?.duration);
  }
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num < 1000 ? num * 1000 : num;
}

export function formatDuration(value) {
  const durationMs = readDurationMs(value);
  if (!durationMs) return '-';

  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = num => String(num).padStart(2, '0');

  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function hasImages(item = {}) {
  if (Array.isArray(item.images) && item.images.length > 0) return true;
  if (Array.isArray(item.image_list) && item.image_list.length > 0) return true;
  if (typeof item.image_list === 'string' && item.image_list.trim() && item.image_list.trim() !== '[]') return true;
  if (Array.isArray(item.note_download_url) && item.note_download_url.length > 0) return true;
  if (typeof item.note_download_url === 'string' && item.note_download_url.trim()) return true;
  return false;
}

function hasVideo(item = {}) {
  return !!(
    item.video_download_url
    || item.video_url
    || item.video?.play_addr
    || item.video?.duration
    || item.duration_ms
    || item.duration
    || item.aweme_url
    || (typeof item.url === 'string' && item.url.includes('/video/'))
  );
}

export function getContentTypeLabel(item = {}, platform = '') {
  const type = String(item.type || item.aweme_type || '').toLowerCase();

  if (platform === 'xhs') {
    if (type.includes('video') || hasVideo(item)) return '视频';
    if (type === 'normal' || type.includes('image') || hasImages(item)) return '图文';
    return '未知';
  }

  if (type === '68' || type.includes('image') || type.includes('note') || hasImages(item)) return '图文';
  if (hasVideo(item) || type === '0' || type === '4' || type.includes('video')) return '视频';
  return '未知';
}
