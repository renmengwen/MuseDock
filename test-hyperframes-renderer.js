const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const renderer = require('./server/services/hyperframesRenderer');

async function run() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperframes-renderer-test-'));
  fs.writeFileSync(path.join(projectDir, 'index.html'), '<html></html>');

  const calls = [];
  const result = await renderer.renderHyperframesProject({
    projectDir,
    runCommand: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      const rendersDir = path.join(projectDir, 'renders');
      fs.mkdirSync(rendersDir, { recursive: true });
      fs.writeFileSync(path.join(rendersDir, 'project_2026-06-09.mp4'), 'fake mp4');
      return { ok: true, code: 0, stdout: 'rendered', stderr: '' };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.output_path, path.join(projectDir, 'output.mp4'));
  assert.equal(fs.readFileSync(result.output_path, 'utf-8'), 'fake mp4');
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /npx/);
  assert.deepStrictEqual(calls[0].args, ['hyperframes', 'render']);
  assert.equal(calls[0].cwd, projectDir);

  const failed = await renderer.renderHyperframesProject({
    projectDir,
    runCommand: async () => ({ ok: false, code: 1, stdout: '', stderr: 'render failed' }),
  });
  assert.equal(failed.success, false);
  assert.match(failed.message, /render failed/);

  const thrown = await renderer.renderHyperframesProject({
    projectDir,
    runCommand: async () => {
      throw new Error('spawn EINVAL');
    },
  });
  assert.equal(thrown.success, false);
  assert.match(thrown.message, /spawn EINVAL/);
}

run().then(() => {
  console.log('hyperframes renderer tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
