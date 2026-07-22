const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { renderHtmlVideoProject } = require('../server/services/creative-video/html-video/projectOrchestrator');
const projectStore = require('../server/services/creative-video/html-video/projectStore');
const { createEmptyProject } = require('../server/services/creative-video/html-video/projectSchema');

(async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'layout-qa-persist-'));
  await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'frames', 'scene_01.html'), '<!doctype html><html><body></body></html>', 'utf8');
  const project = createEmptyProject({ projectId: 'layout-persist', workflowId: 'wf-layout-persist', runId: 'run-layout-persist' });
  project.frames = [{
    id: 'scene_01', scene_id: 'scene_01', source_mode: 'raw_html', html_path: 'frames/scene_01.html', duration_sec: 2,
  }];
  project.target = { duration_sec: 2 };
  await projectStore.saveProject(projectDir, project);

  const visibilitySample = {
    sample_time_sec: 1,
    required_shot_ids: ['shot_required'],
    changed_pixel_ratio: 0.75,
    minimum_changed_pixel_ratio: 0.05,
    style_restored: true,
    passed: true,
  };
  const result = await renderHtmlVideoProject({
    projectDir,
    project,
    runLayoutQa: true,
    services: {
      materializer: { async materializeProject() { return { project, diagnostics: [] }; } },
      layoutQaService: {
        async inspectFrameHtmlLayout() {
          return { success: true, issues: [], metrics: { image_sequence_visibility_samples: [visibilitySample] } };
        },
      },
      frameRenderer: {
        async renderFrame() { return { success: false, code: 'fixture_stop_after_layout', message: '测试在布局门后停止。', diagnostics: [] }; },
      },
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.code, 'fixture_stop_after_layout');

  const persisted = await projectStore.loadProject(projectDir);
  const report = persisted.layout_qa_reports.at(-1);
  assert.equal(report.success, true);
  assert.equal(report.reports[0].frame_id, 'scene_01');
  assert.deepEqual(report.reports[0].metrics.image_sequence_visibility_samples, [visibilitySample]);
  console.log('html-video layout QA persistence tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
