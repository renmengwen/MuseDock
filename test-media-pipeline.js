const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseDouyinVideoDetail } = require('./server/scraper/douyin');
const mediaPipeline = require('./server/services/mediaPipeline');

function assertFfmpegCommand(command) {
  assert.match(path.basename(command).toLowerCase(), /^ffmpeg(\.exe)?$/);
}

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

  const assetPaths = mediaPipeline.getMediaPaths('1234567890', rootDir);
  fs.mkdirSync(assetPaths.framesDir, { recursive: true });
  fs.writeFileSync(assetPaths.metadata, JSON.stringify({ aweme_id: '1234567890', title: 'A test video' }));
  fs.writeFileSync(assetPaths.video, Buffer.alloc(10, 1));
  fs.writeFileSync(assetPaths.audio, Buffer.alloc(8, 2));
  fs.writeFileSync(path.join(assetPaths.framesDir, 'frame-0001.jpg'), Buffer.alloc(5, 3));
  fs.writeFileSync(path.join(assetPaths.framesDir, 'frame-0002.jpg'), Buffer.alloc(7, 4));

  const statusWithAssets = await mediaPipeline.getStatus('1234567890', { rootDir });
  assert.strictEqual(statusWithAssets.assets.dir.path, assetPaths.dir);
  assert.strictEqual(statusWithAssets.assets.video.bytes, 10);
  assert.strictEqual(statusWithAssets.assets.audio.bytes, 8);
  assert.strictEqual(statusWithAssets.frames.length, 2);
  assert.deepStrictEqual(
    statusWithAssets.frames.map(frame => ({
      name: frame.name,
      bytes: frame.bytes,
      preview_url: frame.preview_url,
    })),
    [
      {
        name: 'frame-0001.jpg',
        bytes: 5,
        preview_url: '/api/media/douyin/1234567890/files/frames/frame-0001.jpg',
      },
      {
        name: 'frame-0002.jpg',
        bytes: 7,
        preview_url: '/api/media/douyin/1234567890/files/frames/frame-0002.jpg',
      },
    ],
  );
  assert.strictEqual(
    mediaPipeline.resolveMediaOpenTarget('1234567890', 'video', { rootDir }),
    assetPaths.video,
  );
  assert.throws(
    () => mediaPipeline.resolveMediaOpenTarget('..\\..\\outside', 'dir', { rootDir }),
    /Invalid aweme_id|outside media root/,
  );
  assert.throws(
    () => mediaPipeline.resolveMediaOpenTarget('../outside', 'dir', { rootDir }),
    /Invalid aweme_id|outside media root/,
  );
  assert.throws(
    () => mediaPipeline.resolveMediaOpenTarget('1234567890', '..\\..\\Windows', { rootDir }),
    /Unsupported media target/,
  );
  assert.strictEqual(
    mediaPipeline.resolveFrameFile('1234567890', 'frame-0001.jpg', { rootDir }),
    path.join(assetPaths.framesDir, 'frame-0001.jpg'),
  );
  fs.writeFileSync(path.join(assetPaths.framesDir, 'note.txt'), 'not a frame');
  assert.throws(
    () => mediaPipeline.resolveFrameFile('1234567890', 'note.txt', { rootDir }),
    /Frame file is not available/,
  );
  assert.throws(
    () => mediaPipeline.resolveFrameFile('..\\..\\outside', 'frame-0001.jpg', { rootDir }),
    /Invalid aweme_id|outside media root/,
  );

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

  fs.writeFileSync(paths.audio, Buffer.alloc(12, 1));
  const compressedAudioPath = path.join(path.dirname(paths.audio), 'audio.asr.mp3');
  let compressedRequestData = '';
  const compressed = await mediaPipeline.transcribeAudio('1234567890', {
    rootDir,
    env: {
      ASR_PROVIDER: 'mimo',
      MIMO_API_KEY: 'mimo-secret',
    },
    maxBase64AudioBytes: 8,
    runCommandImpl: async (command, args) => {
      assertFfmpegCommand(command);
      assert.ok(args.includes('-b:a'));
      fs.writeFileSync(compressedAudioPath, Buffer.from([2, 2, 2]));
      return { ok: true, code: 0, stdout: '', stderr: '' };
    },
    fetchImpl: async (url, requestOptions) => {
      const requestBody = JSON.parse(requestOptions.body);
      compressedRequestData = requestBody.messages[0].content[0].input_audio.data;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            { message: { content: '压缩后转写文本' } },
          ],
        }),
      };
    },
  });

  assert.strictEqual(compressed.success, true);
  assert.strictEqual(compressed.status, 'done');
  assert.strictEqual(compressed.text, '压缩后转写文本');
  assert.strictEqual(compressed.preprocess?.status, 'compressed');
  assert.match(compressedRequestData, /^data:audio\/mpeg;base64,AgIC$/);

  fs.writeFileSync(paths.audio, Buffer.alloc(18, 3));
  const segmentDir = path.join(path.dirname(paths.audio), 'asr_segments');
  const requestedSegments = [];
  const segmented = await mediaPipeline.transcribeAudio('1234567890', {
    rootDir,
    env: {
      ASR_PROVIDER: 'mimo',
      MIMO_API_KEY: 'mimo-secret',
    },
    maxBase64AudioBytes: 8,
    asrSegmentBytes: 3,
    runCommandImpl: async (command, args) => {
      assertFfmpegCommand(command);
      const outputPath = args[args.length - 1];
      if (outputPath.endsWith('audio.asr.mp3')) {
        fs.writeFileSync(outputPath, Buffer.alloc(12, 4));
        return { ok: true, code: 0, stdout: '', stderr: '' };
      }
      if (outputPath.includes('%03d')) {
        fs.mkdirSync(segmentDir, { recursive: true });
        fs.writeFileSync(path.join(segmentDir, 'segment-001.mp3'), Buffer.from([5, 5, 5]));
        fs.writeFileSync(path.join(segmentDir, 'segment-002.mp3'), Buffer.from([6, 6, 6]));
        return { ok: true, code: 0, stdout: '', stderr: '' };
      }
      throw new Error(`unexpected ffmpeg output path: ${outputPath}`);
    },
    fetchImpl: async (url, requestOptions) => {
      const requestBody = JSON.parse(requestOptions.body);
      const data = requestBody.messages[0].content[0].input_audio.data;
      requestedSegments.push(data);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            { message: { content: requestedSegments.length === 1 ? '第一段' : '第二段' } },
          ],
        }),
      };
    },
  });

  assert.strictEqual(segmented.success, true);
  assert.strictEqual(segmented.status, 'done');
  assert.strictEqual(segmented.text, '第一段\n第二段');
  assert.strictEqual(segmented.preprocess?.status, 'segmented');
  assert.strictEqual(segmented.segments?.length, 2);
  assert.deepStrictEqual(requestedSegments, [
    'data:audio/mpeg;base64,BQUF',
    'data:audio/mpeg;base64,BgYG',
  ]);

  const statusAfterTranscribe = await mediaPipeline.getStatus('1234567890', { rootDir });
  assert.strictEqual(statusAfterTranscribe.steps.transcript.status, 'done');
  assert.strictEqual(statusAfterTranscribe.transcript.text, '第一段\n第二段');

  const preparedAgain = await mediaPipeline.prepareDouyinMedia('1234567890', {
    aweme_id: '1234567890',
    title: 'A test video',
    aweme_url: 'https://www.douyin.com/video/1234567890',
    video_download_url: '',
  }, {
    rootDir,
    ffmpegAvailable: false,
  });
  assert.strictEqual(preparedAgain.steps.transcript.status, 'done');
  assert.strictEqual(preparedAgain.analysis_input.steps.transcript.status, 'done');
  assert.strictEqual(preparedAgain.analysis_input.transcript.status, 'done');
}

run().then(() => {
  console.log('media pipeline tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
