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

  const outputPath = path.join(projectDir, 'output.mp4');
  fs.writeFileSync(outputPath, 'fake mp4');
  const inspect = await quality.inspectRenderedVideo({
    projectDir,
    outputPath,
    runCommand: async (command, args) => {
      if (args.includes('fps=10/3')) {
        const framesDir = path.join(projectDir, 'inspect', 'frames');
        fs.mkdirSync(framesDir, { recursive: true });
        fs.writeFileSync(path.join(framesDir, 'frame_0001.jpg'), 'fake jpg');
      }
      if (args.includes('tile=5x3')) {
        fs.mkdirSync(path.join(projectDir, 'inspect'), { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'inspect', 'contact_sheet.jpg'), 'fake sheet');
      }
      return { ok: true, code: 0, stdout: 'ok', stderr: '' };
    },
  });

  assert.equal(inspect.success, true);
  assert.equal(fs.existsSync(path.join(projectDir, 'checks', 'visual_report.json')), true);
}

run().then(() => {
  console.log('hyperframes freeform quality tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
