const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseDouyinVideoDetail } = require('./server/scraper/douyin');
const mediaPipeline = require('./server/services/mediaPipeline');

async function run() {
  const detail = parseDouyinVideoDetail({
    aweme_detail: {
      aweme_id: '1234567890',
      desc: 'A test video',
      author: {
        nickname: 'Tester',
        sec_uid: 'sec-1',
      },
      statistics: {
        digg_count: 12,
        comment_count: 3,
      },
      video: {
        cover: { url_list: ['https://example.test/cover.jpg'] },
        play_addr_h264: { url_list: ['https://cdn.test/low.mp4', 'https://cdn.test/high.mp4'] },
        play_addr_256: { url_list: ['https://cdn.test/256.mp4'] },
        play_addr: { url_list: ['https://cdn.test/fallback.mp4'] },
      },
      music: {
        play_url: { url_list: ['https://cdn.test/audio.mp3'] },
      },
    },
  });

  assert.strictEqual(detail.aweme_id, '1234567890');
  assert.strictEqual(detail.title, 'A test video');
  assert.strictEqual(detail.author.nickname, 'Tester');
  assert.strictEqual(detail.video_download_url, 'https://cdn.test/high.mp4');
  assert.strictEqual(detail.music_download_url, 'https://cdn.test/audio.mp3');
  assert.strictEqual(detail.cover_url, 'https://example.test/cover.jpg');
  assert.strictEqual(detail.aweme_url, 'https://www.douyin.com/video/1234567890');

  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-pipeline-test-'));
  const status = await mediaPipeline.getStatus('1234567890', { rootDir });
  assert.strictEqual(status.aweme_id, '1234567890');
  assert.strictEqual(status.exists, false);
  assert.strictEqual(status.steps.video.status, 'missing');
  assert.strictEqual(status.steps.audio.status, 'missing');
  assert.strictEqual(status.steps.frames.status, 'missing');

  const transcribe = await mediaPipeline.transcribeAudio('1234567890', {
    rootDir,
    env: {},
  });
  assert.strictEqual(transcribe.success, false);
  assert.strictEqual(transcribe.configured, false);
  assert.match(transcribe.message, /OPENAI_API_KEY|ASR/);
}

run().then(() => {
  console.log('media pipeline tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
