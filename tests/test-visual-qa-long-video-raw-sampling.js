const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { inspectRenderedVideo } = require('../server/services/creative-video/visualQaService');
const { extractRawFrameMetrics } = require('../server/services/creative-video/frameSampling');

(async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-qa-long-raw-'));
  const videoPath = path.join(projectDir, 'output.mp4');
  await fs.writeFile(videoPath, 'fixture');
  const project = {
    frames: Array.from({ length: 8 }, (_, index) => ({
      id: `scene_${index + 1}`,
      scene_id: `scene_${index + 1}`,
      duration_sec: 11,
    })),
  };
  const rawCalls = [];
  const runCommand = async (_command, args) => {
    const outputPath = args.at(-1);
    if (outputPath.endsWith('contact_sheet.jpg')) {
      await fs.writeFile(outputPath, Buffer.alloc(20001));
      return { ok: true, stdout: '', stderr: '' };
    }
    if (outputPath.endsWith('.rgb')) {
      const count = Number(args[args.indexOf('-frames:v') + 1]);
      const frameSize = 160 * 90 * 3;
      const raw = Buffer.alloc(frameSize * count);
      for (let frame = 0; frame < count; frame += 1) {
        for (let offset = frame * frameSize; offset < (frame + 1) * frameSize; offset += 3) {
          raw[offset] = (frame * 17 + offset) % 256;
          raw[offset + 1] = (frame * 29 + offset) % 256;
          raw[offset + 2] = (frame * 43 + offset) % 256;
        }
      }
      await fs.writeFile(outputPath, raw);
      if (outputPath.endsWith('frames.rgb') && !outputPath.endsWith('timed-frames.rgb')) {
        rawCalls.push({
          filter: args[args.indexOf('-vf') + 1],
          maxFrames: args[args.indexOf('-frames:v') + 1],
        });
      }
      return { ok: true, stdout: '', stderr: '' };
    }
    return { ok: true, stdout: '', stderr: '' };
  };

  const report = await inspectRenderedVideo({
    projectDir,
    outputPath: videoPath,
    project,
    runCommand,
    services: { probeVideo: async () => ({ width: 1080, height: 1920, duration: 88, fps: 12 }) },
  });
  assert.equal(report.frames.length, 24);
  assert.match(rawCalls[0].filter, /^tpad=stop_mode=clone:stop=-1,fps=0\.26136363636363635,/);
  assert.equal(rawCalls[0].maxFrames, '24');
  assert.equal(report.frames[0].time_sec, 0);
  assert.ok(Math.abs(report.frames.at(-1).time_sec - 88) < 0.001, `末帧必须到达片尾：${report.frames.at(-1).time_sec}`);
  assert.deepEqual(
    [...new Set(report.frames.map(frame => Math.min(7, Math.floor(frame.time_sec / 11))))],
    [0, 1, 2, 3, 4, 5, 6, 7],
    '88 秒 8 Scene 的生产 raw 24 帧必须覆盖每个 Scene',
  );

  const short = await extractRawFrameMetrics({
    projectDir,
    workDir: path.join(projectDir, 'short'),
    videoPath,
    runCommand,
    duration: 12,
  });
  assert.equal(short.frames.length, 24);
  assert.match(rawCalls[1].filter, /^fps=2,/);
  assert.doesNotMatch(rawCalls[1].filter, /tpad=/);
  assert.equal(short.frames.at(-1).time_sec, 11.5);

  const boundary = await extractRawFrameMetrics({
    projectDir,
    workDir: path.join(projectDir, 'boundary'),
    videoPath,
    runCommand,
    duration: 12.0001,
  });
  assert.match(rawCalls[2].filter, /^tpad=stop_mode=clone:stop=-1,fps=/);
  assert.ok(Math.abs(boundary.frames.at(-1).time_sec - 12.0001) < 0.001);

  const single = await extractRawFrameMetrics({
    projectDir,
    workDir: path.join(projectDir, 'single'),
    videoPath,
    runCommand,
    duration: 88,
    maxFrames: 1,
  });
  assert.equal(single.frames.length, 1);
  assert.match(rawCalls[3].filter, /^fps=2,/);
  assert.doesNotMatch(rawCalls[3].filter, /tpad=/);
  assert.equal(single.frames[0].time_sec, 0);
  console.log('visual QA long video raw sampling tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
