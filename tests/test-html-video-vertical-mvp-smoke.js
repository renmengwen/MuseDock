const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

if (process.env.RUN_HTML_VIDEO_REAL_RENDER !== '1') {
  console.log('跳过 html-video 纵向 MVP 真实渲染烟测：未设置 RUN_HTML_VIDEO_REAL_RENDER=1。');
  process.exit(0);
}

const { mapSceneSpecToContentGraph, buildFramesFromGraph } = require('../server/services/creative-video/html-video/sceneSpecMapper');
const { createEmptyProject } = require('../server/services/creative-video/html-video/projectSchema');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const { materializeProject } = require('../server/services/creative-video/html-video/materializer');
const { renderFrame } = require('../server/services/creative-video/html-video/frameRenderer');

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-vertical-mvp-'));
  const workflowId = 'workflow_vertical_mvp';
  const runId = 'run_001';
  const projectDir = await projectStore.createProjectDir({ rootDir, workflowId, runId });
  const templateRoot = path.resolve(__dirname, '../server/templates');
  const templateRegistry = createTemplateRegistry({ rootDir: templateRoot });
  templateRegistry.scanTemplates();

  const sceneSpec = {
    title: '评论区信号失控',
    aspect_ratio: '16:9',
    scenes: [{
      id: 'scene_01',
      order: 1,
      start: 0,
      duration: 4,
      kind: 'text',
      narration_text: '真正改写品牌传播的，不是广告，而是评论区。',
      captions: [{ id: 'cap_01', start: 0, end: 3.5, text: '评论区正在改写品牌传播' }],
      visual_text: {
        headline: '信号失控',
        keywords: ['评论区', '品牌', '传播'],
        cards: ['AI 只填 JSON', '模板确定性渲染'],
      },
    }],
  };
  const templateInputs = {
    title: '信号失控',
    subtitle: '评论区正在改写品牌传播',
    channel_info: 'COMMENT_SIGNAL · CH-01',
    footer_text: 'HTML-VIDEO / MVP',
    duration_sec: 4,
  };

  const contentGraph = mapSceneSpecToContentGraph(sceneSpec);
  const frames = buildFramesFromGraph({
    sceneSpec,
    contentGraph,
    templateId: 'glitch_title',
    templateInputs,
  });
  const project = createEmptyProject({
    projectId: 'project_vertical_mvp',
    workflowId,
    runId,
    templateId: 'glitch_title',
    templateInputs,
    contentGraph,
  });
  project.frames = frames;
  project.status = 'materializing';
  await projectStore.saveProject(projectDir, project);

  const materialized = await materializeProject({ projectDir, project, templateRegistry });
  assert.ok(materialized.diagnostics.some(item => item.code === 'materialized'));
  await projectStore.saveProject(projectDir, materialized.project);

  const manifest = templateRegistry.getTemplate('glitch_title');
  const outputPath = path.join(projectDir, 'exports', 'vertical-mvp-frame.mp4');
  const renderResult = await renderFrame(materialized.project.frames[0], {
    workDir: path.join(projectDir, 'frames'),
    outputPath,
    resolution: manifest.output.resolution,
    fps: manifest.output.fps,
    duration: 4,
  });

  assert.equal(renderResult.success, true, renderResult.message || '渲染失败');
  const stat = await fs.stat(outputPath);
  assert.ok(stat.size > 0, 'MP4 文件应存在且非空');
  assert.equal(renderResult.meta.actualResolution.width, manifest.output.resolution.width);
  assert.equal(renderResult.meta.actualResolution.height, manifest.output.resolution.height);
  assert.ok(renderResult.meta.durationSec > 0);

  const loaded = await projectStore.loadProject(projectDir);
  projectStore.addExport(loaded, {
    path: 'exports/vertical-mvp-frame.mp4',
    reason: '纵向 MVP 渲染检查点',
    source_revision_id: null,
  });
  await projectStore.saveProject(projectDir, loaded);

  console.log(`html-video 纵向 MVP 真实渲染烟测通过：${outputPath}`);
})();
