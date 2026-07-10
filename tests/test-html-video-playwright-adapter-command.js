const assert = require('assert');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  buildFfmpegArgs,
  render,
} = require('../server/services/creative-video/html-video/hyperframesPlaywrightAdapter');
const { diagnoseEnvironment } = require('../server/services/creative-video/html-video/environmentDoctor');

(async () => {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-video-adapter-'));
  try {
    const sourcePath = path.join(workDir, 'frame.html');
    const outputPath = path.join(workDir, 'frame.mp4');
    await fsp.writeFile(sourcePath, '<html><body><h1>帧</h1></body></html>', 'utf8');

    // webm 余量不足时不再静默放弃裁剪，而是钳制到最大安全 seek：10.6 - 2.56 - 0.1 = 7.94
    const clampedSeek = buildFfmpegArgs({
      webmPath: path.join(workDir, 'capture.webm'),
      outputPath,
      fps: 24,
      leadInMs: 19936,
      duration: 2.56,
      inputDurationSec: 10.6,
    });
    assertIncludesPair(clampedSeek.args, '-ss', '7.940');
    assert.equal(clampedSeek.seek.clamped, true, '余量不足时应标记 clamped');
    assert.ok(clampedSeek.seek.requested_sec > clampedSeek.seek.applied_sec, 'clamp 后 applied 应小于 requested');

    // webm 比目标时长还短：无法裁剪，seek 归零并标记 skipped
    const skippedSeek = buildFfmpegArgs({
      webmPath: path.join(workDir, 'capture.webm'),
      outputPath,
      fps: 24,
      leadInMs: 19936,
      duration: 2.56,
      inputDurationSec: 2.0,
    });
    assert.equal(skippedSeek.args.includes('-ss'), false, 'webm 短于目标时长时不应生成 -ss');
    assert.equal(skippedSeek.seek.skipped, true, '无法裁剪时应标记 skipped');

    const calls = {
      launches: [],
      contexts: [],
      gotos: [],
      initScripts: 0,
      progress: [],
      ffmpeg: [],
      waits: [],
    };

    const mockPlaywright = {
      chromium: {
        launch: async options => {
          calls.launches.push(options);
          return {
            newContext: async options => {
              calls.contexts.push(options);
              const recordDir = options.recordVideo.dir;
              return {
                newPage: async () => ({
                  addInitScript: async () => { calls.initScripts += 1; },
                  goto: async (url, options) => { calls.gotos.push({ url, options }); },
                  evaluate: async fn => {
                    const source = String(fn);
                    if (source.includes('getComputedStyle')) return 1800;
                    if (source.includes('__hvPlayAll')) return true;
                    return undefined;
                  },
                  waitForTimeout: async ms => { calls.waits.push(ms); },
                }),
                close: async () => {
                  await fsp.writeFile(path.join(recordDir, 'capture.webm'), 'webm');
                },
              };
            },
            close: async () => {},
          };
        },
      },
    };

    const renderResult = await render(
      {
        template: { sourcePath },
        config: {
          outputPath,
          resolution: { width: 640, height: 360 },
          fps: 24,
          duration: 4,
          durationMode: 'explicit',
        },
      },
      {
        onProgress: (percent, message) => calls.progress.push({ percent, message }),
      },
      {
        now: (() => {
          const values = [1000, 1500];
          return () => values.shift() || 1500;
        })(),
        importPlaywright: async () => mockPlaywright,
        runFfmpeg: async (command, args) => {
          calls.ffmpeg.push({ command, args });
          await fsp.writeFile(outputPath, Buffer.alloc(4096, 1));
          return { ok: true, stdout: '', stderr: '' };
        },
        probeWebmDurationSec: async () => 10,
        probeVideoStreams: async () => [{ codec_type: 'video' }],
        ffmpegPath: 'ffmpeg-mock',
      },
    );
    assert.equal(renderResult.diagnostics[0].code, 'frame_rendered');
    assert.match(renderResult.diagnostics[0].message, /Playwright\/Chromium/);
    assert.equal(
      renderResult.diagnostics.some(item => item.code === 'lead_in_trim_degraded'),
      false,
      '正常裁剪不应产生降级诊断',
    );

    assert.equal(calls.launches.length, 1);
    assert.equal(calls.launches[0].headless, true);
    assert.deepEqual(calls.contexts[0].recordVideo.size, { width: 640, height: 360 });
    assert.equal(calls.initScripts, 1);
    assert.equal(calls.gotos[0].options.waitUntil, 'domcontentloaded');
    assert.ok(calls.waits.includes(800), '录制结束前应有 800ms 尾部缓冲，保证 -ss 裁剪安全余量');

    assert.equal(calls.ffmpeg.length, 1);
    assert.equal(calls.ffmpeg[0].command, 'ffmpeg-mock');
    const args = calls.ffmpeg[0].args;
    assertIncludesPair(args, '-c:v', 'libx264');
    assertIncludesPair(args, '-pix_fmt', 'yuv420p');
    assertIncludesPair(args, '-preset', 'medium');
    assertIncludesPair(args, '-crf', '20');
    assertIncludesPair(args, '-movflags', '+faststart');
    assertIncludesPair(args, '-t', '4');
    assert.ok(args.includes('-vf'), '显式 duration 应添加 tpad filter');
    assert.ok(args.includes('tpad=stop_mode=clone:stop_duration=4'), '显式 duration 应 clone 尾帧补齐');
    assert.ok(args.includes('-ss'), '应按 leadInMs 裁剪 dead lead-in');

    const badOutputPath = path.join(workDir, 'bad-frame.mp4');
    await assert.rejects(
      () => render(
        {
          template: { sourcePath },
          config: {
            outputPath: badOutputPath,
            resolution: { width: 640, height: 360 },
            fps: 24,
            duration: 2,
            durationMode: 'explicit',
          },
        },
        {},
        {
          now: (() => {
            const values = [2000, 2300];
            return () => values.shift() || 2300;
          })(),
          importPlaywright: async () => mockPlaywright,
          runFfmpeg: async () => {
            await fsp.writeFile(badOutputPath, Buffer.alloc(4096, 1));
            return { ok: true, stdout: '', stderr: '' };
          },
          probeWebmDurationSec: async () => 10,
          probeVideoStreams: async () => [],
          ffmpegPath: 'ffmpeg-mock',
        },
      ),
      error => error.code === 'render-failed'
        && error.message.includes('html-video 编码完成但输出视频无有效画面流。'),
    );

    const ffmpegDir = path.join(workDir, 'bin');
    const ffmpegExecutable = path.join(ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const expectedFfprobe = path.join(ffmpegDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    await fsp.mkdir(ffmpegDir, { recursive: true });
    await fsp.writeFile(expectedFfprobe, 'ffprobe');
    const ffprobeCalls = [];
    const absoluteFfprobeOutput = path.join(workDir, 'absolute-ffprobe.mp4');
    await render(
      {
        template: { sourcePath },
        config: {
          outputPath: absoluteFfprobeOutput,
          resolution: { width: 640, height: 360 },
          fps: 24,
          duration: 2,
          durationMode: 'explicit',
        },
      },
      {},
      {
        now: (() => {
          const values = [3000, 3300];
          return () => values.shift() || 3300;
        })(),
        importPlaywright: async () => mockPlaywright,
        runCommand: async (command, args) => {
          if (command === (process.platform === 'win32' ? 'where.exe' : 'which')) {
            return { ok: true, stdout: `${ffmpegExecutable}\n`, stderr: '' };
          }
          return { ok: true, stdout: 'ffmpeg version mock', stderr: '' };
        },
        runFfmpeg: async (command) => {
          assert.equal(command, ffmpegExecutable);
          await fsp.writeFile(absoluteFfprobeOutput, Buffer.alloc(4096, 1));
          return { ok: true, stdout: '', stderr: '' };
        },
        runFfprobe: async (command, args) => {
          ffprobeCalls.push({ command, args });
          if (args.includes('format=duration')) return { ok: true, stdout: '10.0', stderr: '' };
          return { ok: true, stdout: JSON.stringify({ streams: [{ codec_type: 'video' }] }), stderr: '' };
        },
      },
    );
    assert.ok(ffprobeCalls.length >= 2);
    assert.equal(ffprobeCalls[0].command, expectedFfprobe);
    assert.equal(ffprobeCalls[1].command, expectedFfprobe);

    const originalFfmpegPath = process.env.FFMPEG_PATH;
    delete process.env.FFMPEG_PATH;
    const commandCalls = [];
    try {
      const foundFfmpeg = process.platform === 'win32'
        ? path.join(workDir, 'doctor-bin', 'ffmpeg.exe')
        : path.join(workDir, 'doctor-bin', 'ffmpeg');
      const foundFfprobe = path.join(path.dirname(foundFfmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
      await fsp.mkdir(path.dirname(foundFfmpeg), { recursive: true });
      await fsp.writeFile(foundFfprobe, 'ffprobe');
      const doctor = await diagnoseEnvironment({
        importPlaywright: async () => ({
          chromium: {
            launch: async () => ({ close: async () => {} }),
          },
        }),
        runCommand: async (command, args) => {
          commandCalls.push({ command, args });
          if (command === (process.platform === 'win32' ? 'where.exe' : 'which')) {
            return { ok: true, stdout: `${foundFfmpeg}\n`, stderr: '' };
          }
          return { ok: true, stdout: 'ffmpeg version mock', stderr: '' };
        },
      });

      assert.equal(doctor.ok, true);
      assert.equal(commandCalls[0].command, process.platform === 'win32' ? 'where.exe' : 'which');
      assert.deepEqual(commandCalls[0].args, ['ffmpeg']);
      assert.equal(doctor.diagnostics.find(item => item.code === 'ffmpeg_available').path, foundFfmpeg);
      assert.equal(doctor.diagnostics.find(item => item.code === 'ffprobe_available').path, foundFfprobe);
    } finally {
      if (originalFfmpegPath === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = originalFfmpegPath;
    }

    const missingFfprobe = await diagnoseEnvironment({
      importPlaywright: async () => ({
        chromium: {
          launch: async () => ({ close: async () => {} }),
        },
      }),
      runCommand: async (command, args) => {
        const basename = path.basename(command).toLowerCase();
        if (command === (process.platform === 'win32' ? 'where.exe' : 'which')) {
          return { ok: false, stdout: '', stderr: 'not found' };
        }
        if (basename.startsWith('ffmpeg')) {
          return { ok: true, stdout: 'ffmpeg version mock', stderr: '' };
        }
        if (basename.startsWith('ffprobe')) {
          return { ok: false, stdout: '', stderr: 'ffprobe missing' };
        }
        return { ok: false, stdout: '', stderr: 'unexpected command' };
      },
    });
    assert.equal(missingFfprobe.ok, false);
    assert.equal(missingFfprobe.diagnostics.some(item => item.code === 'ffmpeg_available'), true);
    const ffprobeMissing = missingFfprobe.diagnostics.find(item => item.code === 'ffprobe_missing');
    assert.ok(ffprobeMissing);
    assert.equal(path.basename(ffprobeMissing.path).toLowerCase(), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    assert.equal(ffprobeMissing.path.includes('@ffmpeg-installer'), false);

    console.log('html-video playwright adapter command tests passed');
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
})();

function assertIncludesPair(args, key, value) {
  const index = args.indexOf(key);
  assert.notEqual(index, -1, `缺少 ${key}`);
  assert.equal(args[index + 1], value, `${key} 参数不正确`);
}
