import assert from 'assert';

import { getPersistentRouteState } from './frontend-react/src/utils/persistentRoutes.js';

const initial = getPersistentRouteState(undefined, '/crawl/douyin', '');
assert.deepStrictEqual(initial, {
  crawlPlatform: 'douyin',
  recordsPlatform: 'douyin',
  mediaPlatform: '',
  mediaId: '',
  aiSearch: '',
  activePage: 'crawl',
});

const media = getPersistentRouteState(initial, '/media/douyin/12345', '');
assert.strictEqual(media.mediaPlatform, 'douyin');
assert.strictEqual(media.mediaId, '12345');
assert.strictEqual(media.activePage, 'media');

const ai = getPersistentRouteState(media, '/ai', '?aweme_id=abc');
assert.strictEqual(ai.mediaPlatform, 'douyin');
assert.strictEqual(ai.mediaId, '12345');
assert.strictEqual(ai.aiSearch, '?aweme_id=abc');
assert.strictEqual(ai.activePage, 'ai');

const settings = getPersistentRouteState(ai, '/settings', '');
assert.strictEqual(settings.mediaId, '12345');
assert.strictEqual(settings.aiSearch, '?aweme_id=abc');
assert.strictEqual(settings.activePage, 'settings');

console.log('persistent route tests passed');
