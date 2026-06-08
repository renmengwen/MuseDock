import assert from 'node:assert/strict';
import {
  formatBytes,
  getDisplayFrames,
  getFramePreviewUrl,
  normalizeFrameAsset,
} from './frontend-react/src/utils/mediaAssets.js';
import { shouldAutoPrepareMedia } from './frontend-react/src/utils/mediaStatus.js';

assert.equal(formatBytes(0), '0 B');
assert.equal(formatBytes(512), '512 B');
assert.equal(formatBytes(1536), '1.5 KB');
assert.equal(formatBytes(2 * 1024 * 1024), '2 MB');
assert.equal(formatBytes(null), '-');

assert.equal(
  getFramePreviewUrl('7420001', 'frame-0001.jpg'),
  '/api/media/douyin/7420001/files/frames/frame-0001.jpg',
);
assert.equal(
  getFramePreviewUrl('7420001', 'frame 1.jpg'),
  '/api/media/douyin/7420001/files/frames/frame%201.jpg',
);

assert.deepEqual(
  normalizeFrameAsset('D:\\media\\frame-0001.jpg', '7420001'),
  {
    path: 'D:\\media\\frame-0001.jpg',
    name: 'frame-0001.jpg',
    bytes: null,
    preview_url: '/api/media/douyin/7420001/files/frames/frame-0001.jpg',
  },
);

assert.deepEqual(
  normalizeFrameAsset({
    path: 'D:\\media\\frame-0002.jpg',
    name: 'frame-0002.jpg',
    bytes: 2048,
    preview_url: '/custom/frame.jpg',
  }, '7420001'),
  {
    path: 'D:\\media\\frame-0002.jpg',
    name: 'frame-0002.jpg',
    bytes: 2048,
    preview_url: '/custom/frame.jpg',
  },
);

assert.deepEqual(
  getDisplayFrames({
    aweme_id: '7420001',
    frames: [],
    analysis_input: {
      local_assets: {
        frames: ['D:\\media\\frame-0003.jpg'],
      },
    },
  }),
  [
    {
      path: 'D:\\media\\frame-0003.jpg',
      name: 'frame-0003.jpg',
      bytes: null,
      preview_url: '/api/media/douyin/7420001/files/frames/frame-0003.jpg',
    },
  ],
);

assert.equal(
  getDisplayFrames({
    aweme_id: '7420001',
    frames: [{ path: 'D:\\media\\frame-0004.jpg', bytes: 9 }],
    analysis_input: {
      local_assets: {
        frames: ['D:\\media\\frame-legacy.jpg'],
      },
    },
  })[0].name,
  'frame-0004.jpg',
);

assert.equal(shouldAutoPrepareMedia({ media_status: { ready: true } }), false);
assert.equal(shouldAutoPrepareMedia({ media_status: { ready: false } }), true);
assert.equal(shouldAutoPrepareMedia({}), true);

console.log('media assets utils tests passed');
