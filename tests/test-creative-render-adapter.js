const assert = require('assert');
const { HyperFramesRenderAdapter, createRenderAdapter } = require('../server/services/creative-video/renderAdapter');

(async () => {
  const calls = [];
  const adapter = new HyperFramesRenderAdapter({
    renderer: {
      renderHyperframesProject: async input => {
        calls.push(input);
        return { success: true, output_path: 'D:/tmp/output.mp4', stdout: 'ok', stderr: '' };
      },
    },
  });

  const result = await adapter.render({
    project_dir: 'D:/tmp/project',
    output_path: 'D:/tmp/output.mp4',
    fps: 30,
    duration: 12,
    audio_manifest: { scenes: [{ scene_id: 'scene_01', path: 'D:/tmp/tts/scene_01.mp3' }] },
  });
  assert.equal(result.success, true);
  assert.equal(result.output_path, 'D:/tmp/output.mp4');
  assert.equal(result.stdout, 'ok');
  assert.equal(calls[0].projectDir, 'D:/tmp/project');
  assert.equal(calls[0].renderOptions.fps, 30);
  assert.equal(calls[0].renderOptions.duration, 12);
  assert.equal(calls[0].renderOptions.audioManifest.scenes[0].scene_id, 'scene_01');
  assert.equal(result.meta.audio_manifest.scenes[0].path, 'D:/tmp/tts/scene_01.mp3');
  assert.ok(createRenderAdapter({ type: 'hyperframes' }));

  const throwing = new HyperFramesRenderAdapter({
    renderer: {
      renderHyperframesProject: async () => {
        throw new Error('renderer exploded');
      },
    },
  });
  const failed = await throwing.render({ project_dir: 'D:/tmp/project' });
  assert.equal(failed.success, false);
  assert.ok(failed.message.includes('renderer exploded'));

  console.log('creative render adapter tests passed');
})();
