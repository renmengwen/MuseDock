const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  getMediaPaths,
  prepareDouyinMedia,
} = require('./server/services/mediaPipeline');

(async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediacrawler-media-'));
  const awemeId = 'v1';
  const paths = getMediaPaths(awemeId, rootDir);
  await fsp.mkdir(paths.framesDir, { recursive: true });
  await fsp.writeFile(paths.video, 'video');
  await fsp.writeFile(paths.audio, 'audio');
  await fsp.writeFile(path.join(paths.framesDir, 'frame-0001.jpg'), 'frame');

  const result = await prepareDouyinMedia(awemeId, {
    aweme_id: awemeId,
    title: 'cached',
    aweme_url: 'https://www.douyin.com/video/v1',
    video_download_url: '',
  }, {
    rootDir,
    ffmpegAvailable: true,
  });

  assert.equal(result.steps.video.status, 'exists');
  assert.equal(result.steps.audio.status, 'exists');
  assert.equal(result.steps.frames.status, 'exists');
  assert.equal(result.analysis_input.local_assets.frames.length, 1);

  await fsp.rm(rootDir, { recursive: true, force: true });
  console.log('media pipeline cache tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
