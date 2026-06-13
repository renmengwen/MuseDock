const assert = require('assert');
const { HyperFramesCliAdapter, createRenderAdapter } = require('../server/services/renderAdapters');

const calls = [];
const adapter = new HyperFramesCliAdapter({
  renderer: async (projectDir, options) => {
    calls.push({ projectDir, options });
    return { success: true, outputPath: 'D:/tmp/out.mp4', stdout: 'ok', stderr: '' };
  },
});

(async () => {
  const result = await adapter.render({
    projectDir: 'D:/tmp/project',
    outputPath: 'D:/tmp/out.mp4',
    fps: 30,
    duration: 12,
  });

  assert.equal(result.success, true);
  assert.equal(result.outputPath, 'D:/tmp/out.mp4');
  assert.equal(result.stdout, 'ok');
  assert.deepEqual(result.diagnostics, []);
  assert.equal(calls[0].projectDir, 'D:/tmp/project');
  assert.equal(calls[0].options.outputPath, 'D:/tmp/out.mp4');
  assert.ok(createRenderAdapter({ type: 'hyperframes-cli', renderer: async () => ({ success: true }) }));

  console.log('render adapter tests passed');
})();
