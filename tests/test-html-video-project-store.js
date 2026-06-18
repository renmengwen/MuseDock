const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const schema = require('../server/services/creative-video/html-video/projectSchema');
const store = require('../server/services/creative-video/html-video/projectStore');
const assetStore = require('../server/services/creative-video/html-video/assetStore');

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-project-'));
  const projectDir = await store.createProjectDir({
    rootDir,
    workflowId: 'workflow_001',
    runId: 'run_001',
  });

  assert.equal(projectDir, path.join(rootDir, 'workflow_001', 'agent_runs', 'run_001-html-video'));
  await fs.access(path.join(projectDir, 'project.json'));
  await fs.access(path.join(projectDir, 'content-graph.json'));
  for (const name of ['frames', 'assets', 'exports', 'inspect', 'tts']) {
    const stat = await fs.stat(path.join(projectDir, name));
    assert.equal(stat.isDirectory(), true);
  }

  const project = schema.createEmptyProject({
    projectId: 'project_001',
    workflowId: 'workflow_001',
    runId: 'run_001',
    templateId: 'basic',
    templateInputs: { title: '测试标题' },
  });
  project.frames.push({
    id: 'frame_01',
    scene_id: 'scene_01',
    graph_node_id: 'node_01',
    order: 1,
    template_id: 'basic',
    inputs: { title: '测试标题' },
    html_path: 'frames/frame_01.html',
    duration_sec: 3,
    engine: 'hyperframes-playwright',
    transition_in: { type: 'cut', duration_sec: 0, params: {} },
    transition_out: { type: 'cut', duration_sec: 0, params: {} },
    trim: { in_sec: 0, out_sec: null },
    speed: 1,
    loop: false,
    enhancement: {
      enabled: false,
      engine: null,
      template_id: null,
      data: null,
      preview_mp4_path: null,
    },
  });

  const savedProject = await store.saveProject(projectDir, project);
  const loaded = await store.loadProject(projectDir);
  assert.deepEqual(loaded, savedProject);
  await assert.rejects(
    fs.access(path.join(projectDir, 'project.json.tmp')),
    /ENOENT/
  );

  const firstRevision = store.addRevision(project, { summary: '初始化工程', author: 'tester' });
  const secondRevision = store.addRevision(project, { summary: '更新帧', author: 'tester' });
  assert.equal(project.revisions.length, 2);
  assert.equal(project.revisions[0].id, firstRevision.id);
  assert.equal(project.revisions[1].id, secondRevision.id);
  assert.notEqual(project.revisions[0].id, project.revisions[1].id);
  assert.equal(project.revisions[0].summary, '初始化工程');
  assert.equal(project.revisions[1].summary, '更新帧');

  const firstExport = store.addExport(project, { format: 'mp4', path: 'exports/final.mp4' });
  const secondExport = store.addExport(project, { format: 'mp4', path: 'exports/final.mp4' });
  assert.equal(project.exports.length, 2);
  assert.notEqual(firstExport.path, secondExport.path);
  assert.equal(firstExport.path, 'exports/final.mp4');
  assert.equal(secondExport.path, 'exports/final-2.mp4');

  assert.equal(
    store.resolveProjectPath(projectDir, 'exports/final.mp4'),
    path.join(projectDir, 'exports', 'final.mp4')
  );
  assert.throws(
    () => store.resolveProjectPath(projectDir, '../escape.mp4'),
    /工程目录/
  );
  assert.throws(
    () => store.resolveProjectPath(projectDir, path.resolve(rootDir, 'escape.mp4')),
    /工程目录/
  );

  assert.equal(
    await assetStore.ensureAssetDir(projectDir),
    path.join(projectDir, 'assets')
  );
  assert.equal(
    assetStore.resolveAssetPath(projectDir, 'assets/logo.png'),
    path.join(projectDir, 'assets', 'logo.png')
  );
  assert.throws(
    () => assetStore.resolveAssetPath(projectDir, 'frames/frame_01.html'),
    /assets/
  );
  assert.throws(
    () => assetStore.resolveAssetPath(projectDir, 'assets/../project.json'),
    /素材路径不能包含 \.\./
  );

  console.log('html-video project store tests passed');
})();
