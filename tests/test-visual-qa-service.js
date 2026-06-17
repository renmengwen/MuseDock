const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const qa = require('../server/services/creative-video/visualQaService');

(async () => {
  const whiteFrames = Array.from({ length: 10 }, (_, index) => ({
    id: `frame_${index}`,
    average_luma: 245,
    luma_stddev: 4,
    edge_score: 2,
    color_variance: 3,
  }));

  const whiteResult = qa.analyzeFrameMetrics({
    frames: whiteFrames,
    contact_sheet_size: 6000,
  });
  assert.equal(whiteResult.success, false);
  assert.ok(whiteResult.issues.some(issue => issue.code === 'too_many_blank_frames'));
  assert.ok(whiteResult.issues.some(issue => issue.code === 'contact_sheet_too_small'));

  const blackFrames = Array.from({ length: 10 }, (_, index) => ({
    id: `frame_${index}`,
    average_luma: 12,
    luma_stddev: 3,
    edge_score: 2,
    color_variance: 1,
  }));
  const blackResult = qa.analyzeFrameMetrics({ frames: blackFrames, contact_sheet_size: 45000 });
  assert.equal(blackResult.success, false);
  assert.ok(blackResult.issues.some(issue => issue.code === 'too_many_blank_frames'));

  const darkInformativeFrames = Array.from({ length: 10 }, (_, index) => ({
    id: `dark_informative_${index}`,
    average_luma: 18,
    luma_stddev: 42,
    edge_score: 18,
    color_variance: 28,
  }));
  const darkInformativeResult = qa.analyzeFrameMetrics({
    frames: darkInformativeFrames,
    contact_sheet_size: 45000,
  });
  assert.equal(darkInformativeResult.success, true);
  assert.equal(darkInformativeResult.metrics.blank_ratio, 0);
  assert.ok(!darkInformativeResult.issues.some(issue => issue.code === 'too_many_blank_frames'));

  const lowInfoFrames = Array.from({ length: 10 }, (_, index) => ({
    id: `frame_${index}`,
    average_luma: 120,
    luma_stddev: 5,
    edge_score: 4,
    color_variance: 4,
  }));
  const lowInfoResult = qa.analyzeFrameMetrics({ frames: lowInfoFrames, contact_sheet_size: 45000 });
  assert.equal(lowInfoResult.success, false);
  assert.ok(lowInfoResult.issues.some(issue => issue.code === 'too_many_low_information_frames'));

  const emptyResult = qa.analyzeFrameMetrics({ frames: [], contact_sheet_size: 45000 });
  assert.equal(emptyResult.success, false);
  assert.ok(emptyResult.issues.some(issue => issue.code === 'no_frames_analyzed'));

  const healthyFrames = Array.from({ length: 10 }, (_, index) => ({
    id: `frame_${index}`,
    average_luma: 120,
    luma_stddev: 45,
    edge_score: 28,
    color_variance: 35,
  }));

  const healthyResult = qa.analyzeFrameMetrics({
    frames: healthyFrames,
    contact_sheet_size: 45000,
  });
  assert.equal(healthyResult.success, true);
  assert.deepEqual(healthyResult.issues, []);

  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-qa-'));
  const outputPath = path.join(projectDir, 'output.mp4');
  await fs.writeFile(outputPath, 'fake video');
  const commands = [];
  const inspected = await qa.inspectRenderedVideo({
    projectDir,
    outputPath,
    runCommand: async (command, args) => {
      commands.push({ command, args });
      const target = args[args.length - 1];
      if (args.includes('rawvideo')) {
        await fs.writeFile(target, Buffer.alloc(160 * 90 * 3, 255));
      } else {
        await fs.writeFile(target, Buffer.alloc(45000, 1));
      }
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  assert.equal(inspected.success, false);
  assert.ok(inspected.issues.some(issue => issue.code === 'too_many_blank_frames'));
  assert.ok(commands.some(call => call.args.includes('rawvideo')));
  assert.ok(commands.some(call => call.args.includes('contact_sheet.jpg') || String(call.args[call.args.length - 1]).includes('contact_sheet.jpg')));

  {
    const calls = [];
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      expectedAspectRatio: '9:16',
      runCommand: async (command, args) => {
        calls.push({ command, args });
        if (args.includes('-show_entries')) {
          return { ok: false, stdout: '', stderr: 'ffprobe missing' };
        }
        if (args.length === 2 && args[0] === '-i') {
          return {
            ok: false,
            stdout: '',
            stderr: 'Stream #0:0: Video: h264, yuv420p, 1080x1920 [SAR 1:1 DAR 9:16], 30 fps',
          };
        }
        const target = args[args.length - 1];
        if (args.includes('rawvideo')) {
          const raw = Buffer.alloc(160 * 90 * 3);
          for (let i = 0; i < raw.length; i += 3) {
            const pixel = i / 3;
            raw[i] = pixel % 255;
            raw[i + 1] = (pixel * 3) % 255;
            raw[i + 2] = (pixel * 7) % 255;
          }
          await fs.writeFile(target, raw);
        } else {
          await fs.writeFile(target, Buffer.alloc(45000, 1));
        }
        return { ok: true, stdout: '', stderr: '' };
      },
    });
    assert.equal(report.success, true);
    assert.ok(calls.some(call => call.args.length === 2 && call.args[0] === '-i'));
    assert.ok(!report.issues.some(issue => issue.code === 'aspect_probe_unavailable'));
  }

  {
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      expectedAspectRatio: '9:16',
      services: {
        probeVideo: async () => ({ width: 1920, height: 1080, duration: 83.6 }),
        sampleFrames: async () => [
          { id: 'frame_0', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'a' },
          { id: 'frame_1', average_luma: 61, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'a' },
          { id: 'frame_2', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'a' },
        ],
      },
    });
    assert.equal(report.success, false);
    assert.ok(report.issues.some(issue => issue.code === 'aspect_ratio_mismatch'));
  }

  {
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      expectedAspectRatio: '9:16',
      services: {
        probeVideo: async () => ({}),
        sampleFrames: async () => [
          { id: 'frame_0', average_luma: 80, luma_stddev: 35, edge_score: 14, color_variance: 40, fingerprint: 'a' },
          { id: 'frame_1', average_luma: 90, luma_stddev: 36, edge_score: 15, color_variance: 41, fingerprint: 'b' },
          { id: 'frame_2', average_luma: 100, luma_stddev: 37, edge_score: 16, color_variance: 42, fingerprint: 'c' },
          { id: 'frame_3', average_luma: 110, luma_stddev: 38, edge_score: 17, color_variance: 43, fingerprint: 'd' },
        ],
      },
    });
    assert.equal(report.success, false);
    assert.ok(report.issues.some(issue => issue.code === 'aspect_probe_unavailable'));
  }

  {
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      expectedAspectRatio: '16:9',
      services: {
        probeVideo: async () => ({ width: 1920, height: 1080, duration: 83.6 }),
        sampleFrames: async () => [
          { id: 'frame_0', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'same' },
          { id: 'frame_1', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'same' },
          { id: 'frame_2', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'same' },
          { id: 'frame_3', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'same' },
        ],
      },
    });
    assert.equal(report.success, false);
    assert.ok(report.issues.some(issue => issue.code === 'repeated_frames'));
  }

  console.log('visual qa service tests passed');
})();
