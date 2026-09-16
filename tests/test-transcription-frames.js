const assert = require('assert/strict');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const express = require('express');
const { createTranscriptionService } = require('../server/services/transcription/transcriptionTasks');
const { createTranscriptionRouter } = require('../server/routes/transcriptions');
const { extractVideoFrames } = require('../server/services/transcription/videoFrames');
const { resolveFfmpegPath } = require('../server/services/tts/ttsTimeline');
const mediaPipeline = require('../server/services/mediaPipeline');

async function checkRealMedia(root) {
  const ffmpeg = await resolveFfmpegPath();
  const execute = args => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args],
    { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  const video = path.join(root, 'colors.mp4');
  // 视频 6 秒、音轨 8 秒：抽帧必须采用视频流时长，不能采用音频或来源元数据时长。
  execute([
    '-f', 'lavfi', '-i', 'color=c=red:s=96x64:r=10:d=2',
    '-f', 'lavfi', '-i', 'color=c=lime:s=96x64:r=10:d=2',
    '-f', 'lavfi', '-i', 'color=c=blue:s=96x64:r=10:d=2',
    '-f', 'lavfi', '-t', '8', '-i', 'anullsrc=r=16000:cl=mono',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video,
  ]);
  const sampled = await extractVideoFrames(video, path.join(root, 'real-frames'), { frameCount: 3 });
  assert.equal(sampled.durationMs, 6000);
  assert.deepEqual(sampled.frames.map(frame => frame.timestampMs), [0, 2000, 4000]);
  for (const [index, frame] of sampled.frames.entries()) {
    const pixel = execute(['-i', frame.path, '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    assert.ok(pixel[index] > 180 && [...pixel].every((value, channel) => channel === index || value < 80),
      `第 ${index + 1} 张实际截图的颜色应匹配目标时间点`);
  }
  const single = await extractVideoFrames(video, path.join(root, 'real-single'), { frameCount: 1 });
  assert.equal(single.frames[0].timestampMs, 0);
  const firstPixel = execute(['-i', single.frames[0].path, '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  assert.ok(firstPixel[0] > 180 && firstPixel[1] < 80 && firstPixel[2] < 80, '只抽一帧也必须取视频起点');
  const shortVideo = path.join(root, 'single-frame.mp4');
  execute(['-f', 'lavfi', '-i', 'color=c=yellow:s=96x64:r=5:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', shortVideo]);
  const dense = await extractVideoFrames(shortVideo, path.join(root, 'real-dense'), { frameCount: 4 });
  assert.deepEqual(dense.frames.map(frame => frame.timestampMs), [0, 50, 100, 150]);
  assert.equal(dense.frames.length, 4, '密集采样落在末帧显示区间时仍应生成指定数量');
  console.log('真实 FFmpeg 验证通过：从 0 秒均匀抽帧、实际图片颜色、视频与音频时长不同、单帧与极短视频。');
}

async function run() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'musedock-transcription-frames-'));
  const frameTimes = [];
  const opened = [];
  let failProbe = false;
  let failCapture = false;
  let failCorrection = false;
  let transcriptions = 0;
  const fixture = {
    rootDir: path.join(root, 'tasks'),
    ensureFunasrService: async () => {},
    resolveAsrRuntime: async () => ({ configured: true, provider: 'funasr', baseUrl: 'http://localhost:8000/v1', modelId: 'paraformer' }),
    getTextConfig: async () => ({ enabled: true, apiKey: 'fixture-only', baseUrl: 'https://example.invalid/v1', modelId: 'fixture' }),
    resolveSource: async () => ({ aweme_id: '1234567890' }),
    getVideoDetail: async () => ({ success: true, data: { aweme_id: '1234567890', title: '抽帧测试',
      duration_ms: 999999, video_download_url: 'https://example.invalid/video' } }),
    mediaPipeline: {
      getMediaPaths: mediaPipeline.getMediaPaths,
      prepareDouyinMedia: async (id, _metadata, options) => {
        assert.equal(options.extractFrames, false, '准备阶段不应触发固定每 5 秒抽帧');
        const media = mediaPipeline.getMediaPaths(id, options.rootDir);
        await fsp.mkdir(media.dir, { recursive: true });
        await fsp.writeFile(media.video, 'video-fixture');
        await fsp.writeFile(media.audio, 'audio-fixture');
        return { steps: { audio: { status: 'done' } } };
      },
    },
    readAudioDuration: async () => ({ success: true, duration: 80 }),
    transcribeAudio: async () => {
      transcriptions += 1;
      return { success: true, text: '测试文字。', sentences: [{ index: 1, startMs: 0, endMs: 1000, text: '测试文字。' }],
        missingRanges: [], timingSource: 'funasr_sentence_info', requestCount: 1 };
    },
    callTextModel: async () => failCorrection ? { success: false, configured: true, message: '测试校订失败' }
      : { success: true, text: JSON.stringify({ changes: [] }) },
    extractVideoFrames: (video, framesDir, options) => extractVideoFrames(video, framesDir, {
      ...options,
      runCommandImpl: async (_command, args) => {
        if (args.includes('-show_entries')) {
          assert.equal(path.basename(args.at(-1)), 'video.mp4', '实际抽帧阶段必须探测本地视频');
          return { ok: !failProbe, stdout: JSON.stringify({ streams: [{ duration: '60' }], format: { duration: '80' } }) };
        }
        const seconds = Number(args[args.indexOf('-ss') + 1]);
        frameTimes.push(seconds);
        if (failCapture && seconds > 0) return { ok: false };
        await fsp.writeFile(args.at(-1), `image-fixture-at-${seconds}`);
        return { ok: true };
      },
    }),
  };
  const service = createTranscriptionService(fixture);
  const app = express();
  app.use(express.json());
  app.locals.localFileOpener = async (file, options) => opened.push({ file, ...options });
  app.use('/api/transcriptions', createTranscriptionRouter({ service }));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const source = 'https://www.douyin.com/video/1234567890';
  const post = (url, body) => fetch(`${origin}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    for (const frameCount of [undefined, null, 0, -1, 1.5, 101, '6']) {
      const response = await post('/api/transcriptions', { source, extractFrames: true, frameCount });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 'INVALID_FRAME_COUNT');
    }
    await assert.rejects(service.create({ source, extractFrames: 'yes', frameCount: 6 }), error => error.code === 'INVALID_INPUT');
    await assert.rejects(extractVideoFrames('unused', path.join(root, 'invalid'), { frameCount: 101 }), error => error.code === 'INVALID_FRAME_COUNT');
    const plain = await service.create({ source });
    await service.waitForIdle();
    const plainResult = await service.get(plain.id);
    assert.equal(plainResult.status, 'succeeded');
    assert.equal(plainResult.extractFrames, false);
    assert.equal(plainResult.frameCount, null);
    assert.deepEqual(plainResult.frames, []);
    assert.deepEqual(frameTimes, [], '默认关闭时不能请求抽帧或视频时长探测');

    const job = await service.create({ source, extractFrames: true, frameCount: 6 });
    assert.equal((await service.create({ source, extractFrames: true, frameCount: 6 })).id, job.id);
    await assert.rejects(service.create({ source, extractFrames: true, frameCount: 3 }), error => error.code === 'TASK_BUSY');
    await assert.rejects(service.create({ source, extractFrames: false }), error => error.code === 'TASK_BUSY');
    await service.waitForIdle();
    const result = await service.get(job.id);
    assert.equal(result.status, 'succeeded');
    assert.match(result.message, /已保存 6 张截图/);
    assert.deepEqual(frameTimes, [0, 10, 20, 30, 40, 50]);
    assert.deepEqual(result.frames.map(frame => frame.timestampMs), [0, 10000, 20000, 30000, 40000, 50000]);
    assert.equal(result.frameSampling.durationMs, 60000);
    assert.equal(result.frameSampling.intervalMs, 10000);
    const saved = JSON.parse(await fsp.readFile(path.join(fixture.rootDir, job.id, 'task.json'), 'utf8'));
    assert.equal(saved.extractFrames, true);
    assert.equal(saved.frameCount, 6);
    const restored = await createTranscriptionService(fixture).get(job.id);
    assert.deepEqual(restored.frames, result.frames, '重启后仍能查看带时间点的截图');
    assert.equal(restored.frameCount, 6);
    const manifest = JSON.parse(await fsp.readFile((await service.file(job.id, 'framesManifest')).path, 'utf8'));
    assert.equal(manifest.frames[0].timestampMs, 0);
    assert.equal(manifest.frames[0].sha256, result.frames[0].sha256);
    assert.ok(!JSON.stringify(result).includes(fixture.rootDir), '公开结果不返回本机绝对路径');

    const preview = await fetch(`${origin}${result.frames[0].url}`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-type'), /^image\/jpeg/);
    assert.equal(preview.headers.get('content-disposition'), null, '预览图片不应触发附件下载');
    assert.equal(preview.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await post(result.frames[0].url, { target: 'folder' })).status, 200);
    assert.equal(opened.at(-1).target, 'folder');
    assert.equal(opened.at(-1).file, (await service.file(job.id, result.frames[0].kind)).path);
    assert.equal((await fetch(`${origin}/api/transcriptions/${job.id}/files/frame-9999`)).status, 404);
    const originalFrame = await service.file(job.id, result.frames[0].kind);
    await fsp.appendFile(originalFrame.path, 'changed');
    assert.equal((await fetch(`${origin}${result.frames[0].url}`)).status, 409, '截图预览也应检查 SHA-256');

    frameTimes.length = 0;
    const one = await service.create({ source, extractFrames: true, frameCount: 1 });
    await service.waitForIdle();
    assert.equal((await service.get(one.id)).status, 'succeeded');
    assert.deepEqual(frameTimes, [0]);

    failCapture = true;
    const failed = await service.create({ source, autoCorrect: true, extractFrames: true, frameCount: 3 });
    await service.waitForIdle();
    const partial = await service.get(failed.id);
    assert.equal(partial.status, 'partial');
    assert.equal(partial.stage, 'extracting_frames');
    assert.equal(partial.canRetryCorrection, false);
    assert.equal(partial.frames.length, 1);
    assert.equal(partial.error.code, 'FRAME_EXTRACTION_FAILED');
    assert.equal(partial.result.rawText, '测试文字。');
    assert.ok(partial.files.rawSrt && partial.files.correctedSrt);
    const interruptedPath = path.join(fixture.rootDir, failed.id, 'task.json');
    const interrupted = JSON.parse(await fsp.readFile(interruptedPath, 'utf8'));
    interrupted.status = 'running';
    await fsp.writeFile(interruptedPath, JSON.stringify(interrupted), 'utf8');
    const recovered = await createTranscriptionService(fixture).get(failed.id);
    assert.equal(recovered.stage, 'extracting_frames', '抽帧中断不能误报为可重试校订');
    assert.equal(recovered.canRetryCorrection, false);
    failCapture = false;
    failProbe = true;
    const invalidVideo = await service.create({ source, extractFrames: true, frameCount: 3 });
    await service.waitForIdle();
    assert.equal((await service.get(invalidVideo.id)).error.code, 'VIDEO_DURATION_INVALID');
    assert.equal((await service.get(invalidVideo.id)).result.rawText, '测试文字。');
    failProbe = false;

    failCorrection = true;
    frameTimes.length = 0;
    const correcting = await service.create({ source, autoCorrect: true, extractFrames: true, frameCount: 3 });
    await service.waitForIdle();
    assert.equal((await service.get(correcting.id)).canRetryCorrection, true);
    assert.deepEqual(frameTimes, []);
    const asrCount = transcriptions;
    failCorrection = false;
    await service.retryCorrection(correcting.id);
    await service.waitForIdle();
    assert.equal((await service.get(correcting.id)).status, 'succeeded');
    assert.deepEqual(frameTimes, [0, 20, 40], '校订重试成功后仍应执行已保存的抽帧设置');
    assert.equal(transcriptions, asrCount);
    await service.remove(correcting.id);
    await assert.rejects(fsp.access(path.join(fixture.rootDir, correcting.id)), error => error.code === 'ENOENT');

    if (process.env.RUN_TRANSCRIPTION_FRAME_MEDIA_TEST === '1') await checkRealMedia(root);
    else console.log('跳过真实媒体验证：设置 RUN_TRANSCRIPTION_FRAME_MEDIA_TEST=1 可运行本地 FFmpeg 合成视频检查。');
    console.log('转写抽帧测试通过：数量校验、默认关闭、从 0 秒采样、配置持久化、预览和本地打开、失败保留与校订恢复。');
  } finally {
    await service.waitForIdle();
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
