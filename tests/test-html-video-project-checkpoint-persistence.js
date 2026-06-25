const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  createEmptyProject,
  markCheckpointFrame,
} = require('../server/services/creative-video/html-video/projectSchema');
const store = require('../server/services/creative-video/html-video/projectStore');

const project = createEmptyProject({
  projectId: 'project_checkpoint',
  workflowId: 'workflow_checkpoint',
  runId: 'run_checkpoint',
});

assert.equal(project.generation_checkpoint.version, 1);
assert.equal(project.generation_checkpoint.stages.content_graph.status, 'pending');
assert.deepEqual(project.generation_checkpoint.stages.frame_html.frames, {});
assert.deepEqual(project.generation_checkpoint.stages.render.frames, {});

(async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-checkpoint-'));
  await store.saveProject(projectDir, project);

  await store.writeProjectJson(projectDir, current => {
    markCheckpointFrame(current, 'frame_html', 'scene_01', {
      status: 'done',
      html_path: 'frames/01-scene_01.html',
      input_hash: 'input-1',
      output_hash: 'output-1',
      diagnostic_code: '',
    });
    markCheckpointFrame(current, 'frame_html', 'scene_02', {
      status: 'done',
      html_path: 'frames/02-scene_02.html',
      input_hash: 'input-2',
      output_hash: 'output-2',
      diagnostic_code: '',
    });
    markCheckpointFrame(current, 'frame_html', 'scene_02', {
      status: 'failed',
      diagnostic_code: 'frame_html_invalid',
    });
    return current;
  });

  const loaded = await store.loadProject(projectDir);
  assert.equal(loaded.generation_checkpoint.stages.frame_html.frames.scene_01.status, 'done');
  assert.equal(loaded.generation_checkpoint.stages.frame_html.frames.scene_01.html_path, 'frames/01-scene_01.html');
  assert.equal(loaded.generation_checkpoint.stages.frame_html.frames.scene_02.status, 'failed');
  assert.equal(loaded.generation_checkpoint.stages.frame_html.frames.scene_02.html_path, '');
  assert.equal(loaded.generation_checkpoint.stages.frame_html.frames.scene_02.input_hash, '');
  assert.equal(loaded.generation_checkpoint.stages.frame_html.frames.scene_02.output_hash, '');
  assert.equal(loaded.generation_checkpoint.stages.frame_html.frames.scene_02.diagnostic_code, 'frame_html_invalid');

  console.log('html-video project checkpoint persistence tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
