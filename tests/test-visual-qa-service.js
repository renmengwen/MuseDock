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

  console.log('visual qa service tests passed');
})();
