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
        duration: 125000,
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
  assert.strictEqual(detail.duration_ms, 125000);
  assert.strictEqual(detail.aweme_type, '');

  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-pipeline-test-'));
  const status = await mediaPipeline.getStatus('1234567890', { rootDir });
  assert.strictEqual(status.aweme_id, '1234567890');
  assert.strictEqual(status.exists, false);
  assert.strictEqual(status.steps.video.status, 'missing');
  assert.strictEqual(status.steps.audio.status, 'missing');
  assert.strictEqual(status.steps.frames.status, 'missing');

  const transcribe = await mediaPipeline.transcribeAudio('1234567890', {
    rootDir,
    env: {
      OPENAI_API_KEY: '',
      ASR_API_KEY: '',
      MIMO_API_KEY: '',
      ASR_PROVIDER: '',
    },
    asrConfig: { enabled: false, apiKey: '', provider: '' },
  });
  assert.strictEqual(transcribe.success, false);
  assert.strictEqual(transcribe.configured, false);
  assert.match(transcribe.message, /OPENAI_API_KEY|ASR/);

  const paths = mediaPipeline.getMediaPaths('1234567890', rootDir);
  fs.mkdirSync(path.dirname(paths.audio), { recursive: true });
  fs.writeFileSync(paths.audio, 'fake mp3 bytes');

  let requestedUrl = '';
  let requestedOptions = null;
  const mimoTranscribe = await mediaPipeline.transcribeAudio('1234567890', {
    rootDir,
    env: {
      ASR_PROVIDER: 'mimo',
      MIMO_API_KEY: 'mimo-secret',
      ASR_LANGUAGE: 'zh',
    },
    asrConfig: { enabled: false, apiKey: '', provider: '' },
    fetchImpl: async (url, requestOptions) => {
      requestedUrl = url;
      requestedOptions = requestOptions;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'chatcmpl-test',
          choices: [
            { message: { content: '这是一段测试转写。' } },
          ],
          usage: { seconds: 1 },
        }),
      };
    },
  });

  assert.strictEqual(mimoTranscribe.success, true);
  assert.strictEqual(mimoTranscribe.text, '这是一段测试转写。');
  assert.strictEqual(requestedUrl, 'https://api.xiaomimimo.com/v1/chat/completions');
  assert.strictEqual(requestedOptions.headers['api-key'], 'mimo-secret');
  const body = JSON.parse(requestedOptions.body);
  assert.strictEqual(body.model, 'mimo-v2.5-asr');
  assert.strictEqual(body.asr_options.language, 'zh');
  assert.match(body.messages[0].content[0].input_audio.data, /^data:audio\/mpeg;base64,/);

  const savedTranscript = JSON.parse(fs.readFileSync(paths.transcript, 'utf-8'));
  assert.strictEqual(savedTranscript.status, 'done');
  assert.strictEqual(savedTranscript.text, '这是一段测试转写。');

  const oversized = await mediaPipeline.transcribeAudio('1234567890', {
    rootDir,
    env: {
      ASR_PROVIDER: 'mimo',
      MIMO_API_KEY: 'mimo-secret',
    },
    maxBase64AudioBytes: 4,
    fetchImpl: async () => {
      throw new Error('fetch should not be called for oversized audio');
    },
  });
  assert.strictEqual(oversized.success, false);
  assert.strictEqual(oversized.status, 'audio_too_large');
  assert.match(oversized.message, /音频文件过大/);
}

run().then(() => {
  console.log('media pipeline tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
