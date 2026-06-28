const assert = require('assert');
const rerender = require('../server/services/creative/creativeVideoRerender');

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

  const ttsCalls = [];
  const localTts = await rerender.rerenderSceneWithLocalTts({
    workflowId: '202606131200000006',
    sceneSpec: spec,
    sceneId: 'scene_01',
    projectDir: 'D:/tmp/project',
    outputPath: 'D:/tmp/tts-output.mp4',
    services: {
      ttsService: {
        synthesizeSceneNarration: async input => {
          ttsCalls.push(input);
          return {
            success: true,
            audio_manifest: {
              scenes: [{
                scene_id: 'scene_01',
                path: 'D:/tmp/project/tts/scene_01.mp3',
                relative_path: 'tts/scene_01.mp3',
                duration: 3.25,
              }],
            },
          };
        },
      },
      composer: {
        composeHyperframesProjectFiles: value => ({
          success: true,
          scene_spec: value,
          files: { 'index.html': '<html></html>' },
        }),
      },
      projectWriter: async () => ({ success: true, projectDir: 'D:/tmp/project' }),
      renderAdapter: {
        render: async input => ({ success: true, outputPath: input.outputPath, diagnostics: [] }),
      },
    },
  });
  assert.equal(localTts.success, true);
  assert.equal(ttsCalls.length, 1);
  assert.equal(ttsCalls[0].sceneId, 'scene_01');
  assert.equal(ttsCalls[0].projectDir, 'D:/tmp/project');
  assert.equal(localTts.scene_spec.scenes[0].audio_path, 'tts/scene_01.mp3');
  assert.equal(localTts.scene_spec.scenes[0].duration, 3.25);

  const noComposerTts = await rerender.rerenderSceneWithLocalTts({
    workflowId: '202606131200000007',
    sceneSpec: spec,
    sceneId: 'scene_01',
    projectDir: 'D:/tmp/project',
    previousOutputPath: 'D:/tmp/old-output.mp4',
    services: {
      ttsService: {
        synthesizeSceneNarration: async () => ({
          success: true,
          audio_manifest: {
            scenes: [{
              scene_id: 'scene_01',
              path: 'D:/tmp/project/tts/scene_01.mp3',
              relative_path: 'tts/scene_01.mp3',
              duration: 0,
            }],
          },
        }),
      },
    },
  });
  assert.equal(noComposerTts.success, true);
  assert.equal(noComposerTts.requires_render, true);
  assert.equal(noComposerTts.output_path, 'D:/tmp/old-output.mp4');
  assert.equal(noComposerTts.scene_spec.scenes[0].audio_path, 'tts/scene_01.mp3');
  assert.equal(noComposerTts.scene_spec.scenes[0].duration, 5);
  assert.match(noComposerTts.message, /需要重新导出/);

  const noAudioChange = await rerender.rerenderSceneWithLocalTts({
    workflowId: '202606131200000008',
    sceneSpec: spec,
    sceneId: 'scene_01',
    previousOutputPath: 'D:/tmp/old-output.mp4',
    services: {
      ttsService: {
        synthesizeSceneNarration: async () => ({
          success: true,
          message: '没有可生成的旁白音频。',
          audio_manifest: { scenes: [] },
        }),
      },
    },
  });
  assert.equal(noAudioChange.success, true);
  assert.equal(noAudioChange.requires_render, false);
  assert.equal(noAudioChange.scene_spec.scenes[0].audio_path, undefined);

  console.log('creative video rerender tests passed');
})();
