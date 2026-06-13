const assert = require('assert');
const rerender = require('../server/services/creativeVideoRerender');

const spec = {
  title: '测试',
  scenes: [
    {
      id: 'scene_01',
      duration: 5,
      narration_text: '旁白',
      captions: [{ id: 'cap_01_01', start: 0, end: 2, text: '字幕' }],
      visual_text: { headline: '标题', keywords: [], cards: [] },
    },
  ],
};

(async () => {
  const calls = [];
  const result = await rerender.rerenderSceneSpecProject({
    workflowId: '202606131200000004',
    sceneSpec: spec,
    outputPath: 'D:/tmp/output.mp4',
    services: {
      composer: {
        composeHyperframesProjectFiles: value => ({
          success: true,
          scene_spec: value,
          files: {
            'index.html': '<html></html>',
            'meta.json': '{}',
            'hyperframes.json': '{}',
            'design.md': '# Design',
            'scene_spec.json': JSON.stringify(value),
          },
        }),
      },
      projectWriter: async files => {
        calls.push(['write', Object.keys(files).sort()]);
        return { success: true, projectDir: 'D:/tmp/project' };
      },
      checker: async projectDir => {
        calls.push(['check', projectDir]);
        return { success: true, diagnostics: [] };
      },
      renderAdapter: {
        render: async input => {
          calls.push(['render', input.projectDir, input.outputPath]);
          return { success: true, outputPath: input.outputPath, diagnostics: [] };
        },
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.output_path, 'D:/tmp/output.mp4');
  assert.deepEqual(calls.map(call => call[0]), ['write', 'check', 'render']);

  const failed = await rerender.rerenderSceneSpecProject({
    workflowId: '202606131200000005',
    sceneSpec: spec,
    previousOutputPath: 'D:/tmp/old.mp4',
    services: {
      composer: { composeHyperframesProjectFiles: () => ({ success: false, message: '规格错误' }) },
      projectWriter: async () => { throw new Error('不应写入'); },
    },
  });
  assert.equal(failed.success, false);
  assert.equal(failed.previous_output_path, 'D:/tmp/old.mp4');

  console.log('creative video rerender tests passed');
})();
