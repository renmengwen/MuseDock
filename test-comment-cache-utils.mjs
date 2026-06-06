import assert from 'node:assert/strict';
import {
  getCommentCacheFromResponse,
  updateCommentCacheForAweme,
} from './frontend-react/src/utils/commentCache.js';

assert.deepEqual(getCommentCacheFromResponse({ count: 3 }), { cached: true, count: 3 });
assert.deepEqual(getCommentCacheFromResponse({ store: { saved: 5 }, count: 3 }), { cached: true, count: 5 });
assert.deepEqual(getCommentCacheFromResponse({ count: 0 }), { cached: false, count: 0 });

const original = [
  { aweme_id: '1001', title: 'A', comment_cache: { cached: false, count: 0 } },
  { aweme_id: '1002', title: 'B', comment_cache: { cached: false, count: 0 } },
];

assert.deepEqual(
  updateCommentCacheForAweme(original, '1002', { cached: true, count: 8 }),
  [
    { aweme_id: '1001', title: 'A', comment_cache: { cached: false, count: 0 } },
    { aweme_id: '1002', title: 'B', comment_cache: { cached: true, count: 8 } },
  ],
);

assert.equal(updateCommentCacheForAweme(original, '', { cached: true, count: 1 }), original);

console.log('comment cache utils tests passed');
