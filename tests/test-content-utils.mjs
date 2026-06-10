import assert from 'node:assert/strict';
import {
  filterByTitle,
  formatDuration,
  getContentTypeLabel,
  withCrawlTimestamp,
} from '../frontend-react/src/utils/content.js';

assert.deepEqual(
  filterByTitle([
    { title: '北京探店视频' },
    { description: '上海图文记录' },
    { title: '广州日常' },
  ], '图文'),
  [{ description: '上海图文记录' }],
);

assert.deepEqual(
  filterByTitle([{ title: 'Coffee Vlog' }], 'coffee'),
  [{ title: 'Coffee Vlog' }],
);

assert.deepEqual(
  withCrawlTimestamp([{ title: 'new' }, { title: 'old', crawled_at: 100 }], 200),
  [{ title: 'new', crawled_at: 200 }, { title: 'old', crawled_at: 100 }],
);

assert.equal(formatDuration(0), '-');
assert.equal(formatDuration(62_000), '01:02');
assert.equal(formatDuration(3_661_000), '01:01:01');
assert.equal(formatDuration({ duration: 15_000 }), '00:15');
assert.equal(formatDuration({ duration_ms: 9_000 }), '00:09');

assert.equal(getContentTypeLabel({ aweme_type: 68, images: [{ url: 'image' }] }, 'douyin'), '图文');
assert.equal(getContentTypeLabel({ aweme_type: 0, video_download_url: 'https://cdn.test/a.mp4' }, 'douyin'), '视频');
assert.equal(getContentTypeLabel({ url: 'https://www.douyin.com/video/7420001' }, 'douyin'), '视频');
assert.equal(getContentTypeLabel({ type: 'video', video_url: 'https://cdn.test/a.mp4' }, 'xhs'), '视频');
assert.equal(getContentTypeLabel({ type: 'normal', image_list: '[]' }, 'xhs'), '图文');
assert.equal(getContentTypeLabel({}, 'douyin'), '未知');

console.log('content utils tests passed');
