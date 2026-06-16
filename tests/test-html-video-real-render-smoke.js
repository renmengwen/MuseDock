const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

if (process.env.RUN_HTML_VIDEO_REAL_RENDER !== '1') {
  console.log('跳过 html-video 真实渲染烟测：未设置 RUN_HTML_VIDEO_REAL_RENDER=1。');
  process.exit(0);
}

const { mapSceneSpecToContentGraph, buildFramesFromGraph } = require('../server/services/creative-video/html-video/sceneSpecMapper');
const { createEmptyProject } = require('../server/services/creative-video/html-video/projectSchema');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');
const { materializeProject } = require('../server/services/creative-video/html-video/materializer');
const { renderFrame } = require('../server/services/creative-video/html-video/frameRenderer');

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-real-render-'));
  const workflowId = 'workflow_real_render';
  const runId = 'run_001';
  const projectDir = await projectStore.createProjectDir({ rootDir, workflowId, runId });
  const templateRegistry = createTemplateRegistry({ rootDir: path.resolve(__dirname, '../server/templates') });
  templateRegistry.scanTemplates();
  const template = templateRegistry.getTemplate('glitch_title');
  assert.ok(template, '应能读取 glitch_title production-ready 模板');

  const sceneSpec = {
    title: 'AI 只填结构化字段',
    aspect_ratio: '16:9',
    scenes: [{
      id: 'scene_01',
      order: 1,
      start: 0,
      duration: 4,
      kind: 'text',
      narration_text: 'AI 负责选择模板和填写字段，系统负责确定性生成视频。',
      captions: [{ id: 'cap_01', start: 0, end: 3.8, text: 'AI 只填 JSON，系统生成 HTML' }],
      visual_text: {
        headline: 'JSON 成片',
        keywords: ['模板', '字段', '重渲'],
        cards: ['可编辑工程', '可追踪导出'],
      },
    }],
  };
  const contentGraph = mapSceneSpecToContentGraph(sceneSpec);
  const inputs = {
    title: 'JSON 成片',
    subtitle: '模板字段驱动 Playwright 渲染',
    channel_info: 'HTML_VIDEO · SMOKE',
    footer_text: '可编辑生产链路',
    duration_sec: 4,
  };

  const project = createEmptyProject({
    projectId: 'project_real_render',
    workflowId,
    runId,
    templateId: 'glitch_title',
    templateInputs: inputs,
    contentGraph,
  });
  project.frames = buildFramesFromGraph({
    sceneSpec,
    contentGraph,
    templateId: 'glitch_title',
    templateInputs: inputs,
  });
  projectStore.addRevision(project, {
    summary: '首次生成',
    author: 'smoke',
    change: { type: 'initial_generate' },
  });

  let materialized = await materializeProject({ projectDir, project, templateRegistry });
  await projectStore.saveProject(projectDir, materialized.project);
  const firstOutput = path.join(projectDir, 'exports', 'real-render-first.mp4');
  const firstRender = await renderFrame(materialized.project.frames[0], {
    projectDir,
    outputPath: firstOutput,
    resolution: template.output.resolution,
    fps: template.output.fps,
    duration: 4,
  });
  assert.equal(firstRender.success, true, firstRender.message || '首次渲染失败');
  const firstStat = await fs.stat(firstOutput);
  assert.ok(firstStat.size > 0, '首次 MP4 应非空');
  assert.equal(firstRender.meta.actualResolution.width, 1920);
  assert.equal(firstRender.meta.actualResolution.height, 1080);
  assert.ok(firstRender.meta.durationSec >= 4);

  const edited = materialized.project;
  edited.template_inputs.title = '重渲成功';
  edited.frames[0].inputs.title = '重渲成功';
  projectStore.addRevision(edited, {
    summary: '编辑标题并重渲',
    author: 'smoke',
    change: { type: 'template_inputs_patch', patch: { title: '重渲成功' } },
  });
  materialized = await materializeProject({ projectDir, project: edited, templateRegistry });
  await projectStore.saveProject(projectDir, materialized.project);
  const rerenderOutput = path.join(projectDir, 'exports', 'real-render-rerender.mp4');
  const rerender = await renderFrame(materialized.project.frames[0], {
    projectDir,
    outputPath: rerenderOutput,
    resolution: template.output.resolution,
    fps: template.output.fps,
    duration: 4,
  });
  assert.equal(rerender.success, true, rerender.message || '编辑重渲失败');
  const rerenderStat = await fs.stat(rerenderOutput);
  assert.ok(rerenderStat.size > 0, '重渲 MP4 应非空');
  projectStore.addExport(materialized.project, {
    path: 'exports/real-render-first.mp4',
    reason: '首次真实渲染',
    source_revision_id: materialized.project.revisions[0].id,
  });
  projectStore.addExport(materialized.project, {
    path: 'exports/real-render-rerender.mp4',
    reason: '编辑后重渲',
    source_revision_id: materialized.project.revisions[1].id,
  });
  await projectStore.saveProject(projectDir, materialized.project);

  const loaded = await projectStore.loadProject(projectDir);
  assert.equal(loaded.exports.length, 2);
  assert.equal(loaded.revisions.length, 2);
  assert.notEqual(loaded.exports[0].path, loaded.exports[1].path);

  console.log(`html-video 真实渲染烟测通过：${rerenderOutput}`);
})();
