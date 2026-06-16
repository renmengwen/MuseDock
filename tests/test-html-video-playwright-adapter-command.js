const assert = require('assert');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const { render } = require('../server/services/creative-video/html-video/hyperframesPlaywrightAdapter');

(async () => {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-video-adapter-'));
  try {
    const sourcePath = path.join(workDir, 'frame.html');
    const outputPath = path.join(workDir, 'frame.mp4');
    await fsp.writeFile(sourcePath, '<html><body><h1>帧</h1></body></html>', 'utf8');

    const calls = {
      launches: [],
      contexts: [],
      gotos: [],
      initScripts: 0,
      progress: [],
      ffmpeg: [],
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
                  waitForTimeout: async () => {},
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

    await render(
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
          await fsp.writeFile(outputPath, 'mp4');
          return { ok: true, stdout: '', stderr: '' };
        },
        ffmpegPath: 'ffmpeg-mock',
      },
    );

    assert.equal(calls.launches.length, 1);
    assert.equal(calls.launches[0].headless, true);
    assert.deepEqual(calls.contexts[0].recordVideo.size, { width: 640, height: 360 });
    assert.equal(calls.initScripts, 1);
    assert.equal(calls.gotos[0].options.waitUntil, 'domcontentloaded');

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
