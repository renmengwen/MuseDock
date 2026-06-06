import { getDouyinAwemeId } from './format.js';

export function getCommentCacheFromResponse(response = {}) {
  const count = Number(response.store?.saved ?? response.count ?? 0) || 0;
  return {
    cached: count > 0,
    count,
  };
}

export function updateCommentCacheForAweme(items = [], awemeId, cache = {}) {
  const targetId = String(awemeId || '');
  if (!targetId) return items;

  return items.map(item => {
    if (getDouyinAwemeId(item) !== targetId) return item;
    return {
      ...item,
      comment_cache: {
        ...(item.comment_cache || {}),
        cached: !!cache.cached,
        count: Number(cache.count || 0),
      },
    };
  });
}
