const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const quality = require('../server/services/hyperframesFreeformQuality');

async function run() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-freeform-quality-'));
  fs.writeFileSync(path.join(projectDir, 'index.html'), '<html></html>');

  const calls = [];
  const check = await quality.checkFreeformProject({
    projectDir,
    runCommand: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { ok: true, code: 0, stdout: `${args.join(' ')} ok`, stderr: '' };
    },
  });

  assert.equal(check.success, true);
  assert.equal(check.lint, 'passed');
  assert.equal(check.validate, 'passed');
  assert.equal(check.inspect, 'passed');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.args[1]), ['lint', 'validate', 'inspect']);
  assert.deepEqual(calls.map(call => call.cwd), [projectDir, projectDir, projectDir]);
  assert.deepEqual(calls[2].args, ['hyperframes', 'inspect', '--samples', '12']);
  assert.equal(fs.existsSync(path.join(projectDir, 'checks', 'lint.txt')), true);

  const failed = await quality.checkFreeformProject({
    projectDir,
    runCommand: async (_command, args) => ({
      ok: args[1] !== 'validate',
      code: args[1] === 'validate' ? 1 : 0,
      stdout: '',
      stderr: args[1] === 'validate' ? 'bad layout' : '',
    }),
  });

  assert.equal(failed.success, false);
  assert.equal(failed.validate, 'failed');
  assert.match(failed.message, /validate/);

  const lintStdoutProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-freeform-quality-lint-stdout-'));
  fs.writeFileSync(path.join(lintStdoutProjectDir, 'index.html'), '<html></html>');
  const lintStdoutFailed = await quality.checkFreeformProject({
    projectDir: lintStdoutProjectDir,
    runCommand: async (_command, args) => ({
      ok: args[1] !== 'lint',
      code: args[1] === 'lint' ? 1 : 0,
      stdout: args[1] === 'lint'
        ? 'root_missing_composition_id [stage]: Root composition is missing `data-composition-id`.'
        : 'ok',
      stderr: args[1] === 'lint'
        ? 'npm warn exec The following package was not found and will be installed: hyperframes@0.6.95'
        : '',
    }),
  });

  assert.equal(lintStdoutFailed.success, false);
  assert.match(lintStdoutFailed.message, /root_missing_composition_id/);
  assert.doesNotMatch(lintStdoutFailed.message, /npm warn exec/);

  const outputPath = path.join(projectDir, 'output.mp4');
  fs.writeFileSync(outputPath, 'fake mp4');
  const inspect = await quality.inspectRenderedVideo({
    projectDir,
    outputPath,
    runCommand: async (command, args) => {
      if (args.some(arg => String(arg).includes('fps=10/3'))) {
        const framesDir = path.join(projectDir, 'inspect', 'frames');
        fs.mkdirSync(framesDir, { recursive: true });
        fs.writeFileSync(path.join(framesDir, 'frame_0001.jpg'), 'fake jpg');
      }
      if (args.some(arg => String(arg).includes('tile=5x3'))) {
        fs.mkdirSync(path.join(projectDir, 'inspect'), { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'inspect', 'contact_sheet.jpg'), 'fake sheet');
      }
      return { ok: true, code: 0, stdout: 'ok', stderr: '' };
    },
  });

  assert.equal(inspect.success, true);
  assert.equal(fs.existsSync(path.join(projectDir, 'checks', 'visual_report.json')), true);

  const throwProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-freeform-quality-throw-'));
  const throwOutputPath = path.join(throwProjectDir, 'output.mp4');
  fs.writeFileSync(throwOutputPath, 'fake mp4');
  const throwInspect = await quality.inspectRenderedVideo({
    projectDir: throwProjectDir,
    outputPath: throwOutputPath,
    runCommand: async () => {
      throw new Error('ffmpeg crashed');
    },
  });

  assert.equal(throwInspect.success, false);
  assert.equal(fs.existsSync(path.join(throwProjectDir, 'checks', 'visual_report.json')), true);

  const missingOutputProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-freeform-quality-missing-output-'));
  const missingOutputInspect = await quality.inspectRenderedVideo({
    projectDir: missingOutputProjectDir,
    outputPath: path.join(missingOutputProjectDir, 'missing.mp4'),
  });
  const missingOutputReportPath = path.join(missingOutputProjectDir, 'checks', 'visual_report.json');
  const missingOutputReport = JSON.parse(fs.readFileSync(missingOutputReportPath, 'utf8'));

  assert.equal(missingOutputInspect.success, false);
  assert.equal(fs.existsSync(missingOutputReportPath), true);
  assert.ok(missingOutputReport.issues.includes('output_missing') || /未找到 output\.mp4/.test(missingOutputReport.message));

  const missingSheetProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-freeform-quality-sheet-'));
  const missingSheetOutputPath = path.join(missingSheetProjectDir, 'output.mp4');
  fs.writeFileSync(missingSheetOutputPath, 'fake mp4');
  const missingSheetInspect = await quality.inspectRenderedVideo({
    projectDir: missingSheetProjectDir,
    outputPath: missingSheetOutputPath,
    runCommand: async (_command, args) => {
      if (args.some(arg => String(arg).includes('fps=10/3'))) {
        const framesDir = path.join(missingSheetProjectDir, 'inspect', 'frames');
        fs.mkdirSync(framesDir, { recursive: true });
        fs.writeFileSync(path.join(framesDir, 'frame_0001.jpg'), 'fake jpg');
      }
      return { ok: true, code: 0, stdout: 'ok', stderr: '' };
    },
  });

  assert.equal(missingSheetInspect.success, false);
  assert.ok(missingSheetInspect.issues.includes('contact_sheet_failed'));

  const staleSheetProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-freeform-quality-stale-sheet-'));
  const staleSheetOutputPath = path.join(staleSheetProjectDir, 'output.mp4');
  const staleSheetPath = path.join(staleSheetProjectDir, 'inspect', 'contact_sheet.jpg');
  fs.mkdirSync(path.dirname(staleSheetPath), { recursive: true });
  fs.writeFileSync(staleSheetOutputPath, 'fake mp4');
  fs.writeFileSync(staleSheetPath, 'old sheet');
  const staleSheetInspect = await quality.inspectRenderedVideo({
    projectDir: staleSheetProjectDir,
    outputPath: staleSheetOutputPath,
    runCommand: async (_command, args) => {
      if (args.some(arg => String(arg).includes('fps=10/3'))) {
        const framesDir = path.join(staleSheetProjectDir, 'inspect', 'frames');
        fs.mkdirSync(framesDir, { recursive: true });
        fs.writeFileSync(path.join(framesDir, 'frame_0001.jpg'), 'fake jpg');
      }
      return { ok: true, code: 0, stdout: 'ok', stderr: '' };
    },
  });

  assert.equal(staleSheetInspect.success, false);
  assert.equal(fs.existsSync(staleSheetPath), false);

  const staleProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-freeform-quality-stale-'));
  const staleOutputPath = path.join(staleProjectDir, 'output.mp4');
  const staleFramesDir = path.join(staleProjectDir, 'inspect', 'frames');
  fs.mkdirSync(staleFramesDir, { recursive: true });
  fs.writeFileSync(staleOutputPath, 'fake mp4');
  fs.writeFileSync(path.join(staleFramesDir, 'frame_9999.jpg'), 'stale jpg');
  const staleInspect = await quality.inspectRenderedVideo({
    projectDir: staleProjectDir,
    outputPath: staleOutputPath,
    runCommand: async (_command, args) => {
      if (args.some(arg => String(arg).includes('fps=10/3'))) {
        fs.mkdirSync(staleFramesDir, { recursive: true });
        fs.writeFileSync(path.join(staleFramesDir, 'frame_0001.jpg'), 'fresh jpg');
      }
      if (args.some(arg => String(arg).includes('tile=5x3'))) {
        fs.mkdirSync(path.join(staleProjectDir, 'inspect'), { recursive: true });
        fs.writeFileSync(path.join(staleProjectDir, 'inspect', 'contact_sheet.jpg'), 'fake sheet');
      }
      return { ok: true, code: 0, stdout: 'ok', stderr: '' };
    },
  });

  assert.equal(staleInspect.success, true);
  assert.equal(fs.existsSync(path.join(staleFramesDir, 'frame_0001.jpg')), true);
  assert.equal(fs.existsSync(path.join(staleFramesDir, 'frame_9999.jpg')), false);
}

run().then(() => {
  console.log('hyperframes freeform quality tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
