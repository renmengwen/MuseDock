import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(__dirname, '../frontend-react/src/utils/persistentRoutes.js');
const routeSource = fs.readFileSync(routePath, 'utf-8');
const routeModule = await import(`data:text/javascript;base64,${Buffer.from(`${routeSource}\n//# sourceURL=${pathToFileURL(routePath).href}`).toString('base64')}`);
const { getPersistentRouteState } = routeModule;

const defaultState = getPersistentRouteState(undefined, '/', '');
assert.deepStrictEqual(defaultState, {
  crawlPlatform: 'douyin',
  recordsPlatform: 'douyin',
  mediaPlatform: '',
  mediaId: '',
  aiSearch: '',
  creativeWorkflowId: '',
  studioAwemeId: '',
  studioRunId: '',
  activePage: 'creative',
});

const creative = getPersistentRouteState(undefined, '/creative', '');
assert.strictEqual(creative.activePage, 'creative');
assert.strictEqual(creative.creativeWorkflowId, '');

const creativeDetail = getPersistentRouteState(creative, '/creative/wf-123', '');
assert.strictEqual(creativeDetail.activePage, 'creative');
assert.strictEqual(creativeDetail.creativeWorkflowId, 'wf-123');

const creativeToMedia = getPersistentRouteState(creative, '/media/douyin/12345', '');
assert.strictEqual(creativeToMedia.mediaPlatform, 'douyin');
assert.strictEqual(creativeToMedia.mediaId, '12345');
assert.strictEqual(creativeToMedia.activePage, 'media');

const initial = getPersistentRouteState(undefined, '/crawl/douyin', '');
assert.deepStrictEqual(initial, {
  crawlPlatform: 'douyin',
  recordsPlatform: 'douyin',
  mediaPlatform: '',
  mediaId: '',
  aiSearch: '',
  creativeWorkflowId: '',
  studioAwemeId: '',
  studioRunId: '',
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

const studio = getPersistentRouteState(undefined, '/hyperframes-freeform/123/run-abc', '');
assert.strictEqual(studio.activePage, 'hyperframes-freeform');
assert.strictEqual(studio.studioAwemeId, '123');
assert.strictEqual(studio.studioRunId, 'run-abc');

const studioState = getPersistentRouteState(studio, '/hyperframes-freeform/456', '');
assert.strictEqual(studioState.activePage, 'hyperframes-freeform');
assert.strictEqual(studioState.studioAwemeId, '456');
assert.strictEqual(studioState.studioRunId, 'run-abc');

console.log('persistent route tests passed');
