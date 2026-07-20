const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const schema = require('../server/services/creative-video/html-video/projectSchema');
const store = require('../server/services/creative-video/html-video/projectStore');
const assetStore = require('../server/services/creative-video/html-video/assetStore');
const assetUsagePhase = require('../server/services/creative-video/html-video/assetUsagePhase');

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
  });
  project.assets = assetUsagePhase.projectAssetsFromCreativeContext({
    asset_context: {
      assets: [{
        id: 'upload_01',
        type: 'image',
        media_type: 'image',
        source: 'upload',
        origin: 'user_upload',
        origin_detail: 'creative_input',
        provider: 'local',
        requirement: 'preferred',
        evidence_class: 'user_supplied',
        status: 'ready',
        path: 'assets/upload.png',
        mime: 'image/png',
        bytes: 123,
        focus_regions: [{
          id: 'region_stars',
          label: 'Stars 数量',
          aliases: [' Stars ', 'stars', '星标'],
          region: { x: 0.7, y: 0.1, width: 0.2, height: 0.1 },
          method: 'ocr',
          confidence_level: 'high',
          verification: { status: 'verified', method: 'text_match', evidence: 'Stars' },
          trust_level: 'A',
        }],
      }, {
        asset_id: 'legacy_capture',
        source: 'article',
        path: 'assets/legacy.png',
        focus_regions: null,
      }, {
        id: 'legacy_without_focus',
        source: 'article',
        path: 'assets/no-focus.png',
      }],
    },
  });
  project.frames.push({
    id: 'frame_01',
    scene_id: 'scene_01',
    graph_node_id: 'node_01',
    order: 1,
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
  assert.equal(loaded.generation_checkpoint.version, 1);
  assert.equal(loaded.assets[0].origin, 'user_upload');
  assert.equal(loaded.assets[0].requirement, 'preferred');
  assert.equal(loaded.assets[0].evidence_class, 'user_supplied');
  assert.equal(loaded.assets[0].bytes, 123);
  assert.deepEqual(loaded.assets[0].focus_regions[0].aliases, ['Stars', '星标']);
  assert.equal(loaded.assets[0].focus_regions[0].trust_level, 'B');
  assert.ok(Math.abs(loaded.assets[0].focus_regions[0].focus_point.x - 0.8) < Number.EPSILON);
  assert.ok(Math.abs(loaded.assets[0].focus_regions[0].focus_point.y - 0.15) < Number.EPSILON);
  assert.equal(loaded.assets[1].id, 'legacy_capture');
  assert.deepEqual(loaded.assets[1].focus_regions, []);
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.assets[2], 'focus_regions'), false);
  await assert.rejects(
    fs.access(path.join(projectDir, 'project.json.tmp')),
    /ENOENT/
  );

  const updated = await store.writeProjectJson(projectDir, current => {
    schema.markCheckpointStage(current, 'content_graph', { status: 'done', path: 'content-graph.json' });
    return current;
  });
  assert.equal(updated.generation_checkpoint.stages.content_graph.status, 'done');
  assert.equal((await store.loadProject(projectDir)).generation_checkpoint.stages.content_graph.path, 'content-graph.json');

  const withUsageReport = await store.writeProjectJson(projectDir, current => ({
    ...current,
    asset_usage_report: {
      status: 'ready',
      assets: [{ asset_id: 'article_01', used: true, used_in_frames: ['scene_01'], usage_count: 1 }],
      used_asset_ids: ['article_01'],
      unused_asset_ids: [],
      summary: '最终 HTML 使用了 1 张来源图片。',
    },
  }));
  assert.equal(withUsageReport.asset_usage_report.status, 'ready');
  assert.deepEqual((await store.loadProject(projectDir)).asset_usage_report.used_asset_ids, ['article_01']);

  const graphPath = await store.saveContentGraph(projectDir, { schemaVersion: 1, nodes: [{ id: 'node_01' }], edges: [] });
  assert.equal(graphPath, 'content-graph.json');
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(projectDir, graphPath), 'utf8')),
    { schemaVersion: 1, nodes: [{ id: 'node_01' }], edges: [] }
  );

  const frameWrite = await store.writeRawFrameHtml({
    projectDir,
    sceneId: 'scene_01',
    order: 1,
    html: '<!doctype html><html><body><main>原始画面</main></body></html>',
    captions: [{ id: 'c1', text: '中文字幕', start: 0, end: 1 }],
    durationSec: 3,
  });
  assert.equal(frameWrite.html_path, 'frames/01-scene_01.html');
  assert.match(frameWrite.output_hash, /^[a-f0-9]{64}$/);
  const frameHtml = await fs.readFile(path.join(projectDir, frameWrite.html_path), 'utf8');
  assert.match(frameHtml, /原始画面/);
  assert.match(frameHtml, /中文字幕/);

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
