const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const orchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-modes-'));
  const templateRoot = path.join(rootDir, 'templates');
  await writeFile(path.join(templateRoot, 'simple', 'template.html-video.yaml'), [
    'id: simple',
    'name: 简单模板',
    'engine: hyperframes',
    'source_entry: index.html',
    'license:',
    '  commercial_use: true',
    '',
  ].join('\n'));
  await writeFile(path.join(templateRoot, 'simple', 'index.html'), '<html><body>{{headline}}</body></html>');
  const templateRegistry = createTemplateRegistry({ rootDir: templateRoot });
  templateRegistry.scanTemplates();

  const project = {
    project_id: 'wf_run',
    workflow_id: 'wf',
    run_id: 'run',
    template_id: 'simple',
    template_inputs: { headline: '标题' },
    output: { resolution: { width: 1080, height: 1920 }, fps: 24 },
    frames: [
      { id: 'frame_01', scene_id: 'scene_01', template_id: 'simple', inputs: { headline: '一' }, duration_sec: 2 },
      { id: 'frame_02', scene_id: 'scene_02', template_id: 'simple', inputs: { headline: '二' }, duration_sec: 2 },
    ],
    timeline: { tracks: [{ id: 'main', type: 'video', items: [] }] },
  };

  const calls = [];
  const services = {
    frameRenderer: {
      renderFrame: async (frame, options) => {
        calls.push(`render:${frame.id}`);
        await writeFile(options.outputPath, 'mp4');
        return { success: true, output_path: options.outputPath, diagnostics: [] };
      },
    },
    ffmpegComposer: {
      concatFramesWithFfmpeg: async (frames, outputPath) => {
        calls.push(`concat:${frames.length}`);
        await writeFile(outputPath, 'mp4');
        return { success: true, output_path: outputPath };
      },
      muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, output_path: videoPath, skipped: true }),
    },
  };

  const materialized = await orchestrator.materializeHtmlVideoProject({
    rootDir,
    workflowId: 'wf',
    runId: 'run',
    project,
    templateRegistry,
    services,
  });
  assert.equal(materialized.success, true);
  assert.deepEqual(calls, []);
  assert.ok(materialized.project.frames[0].html_path);

  const preview = await orchestrator.renderHtmlVideoFramePreview({
    rootDir,
    workflowId: 'wf',
    runId: 'run',
    project: materialized.project,
    templateRegistry,
    frameId: 'frame_02',
    services,
  });
  assert.equal(preview.success, true);
  assert.deepEqual(calls, ['render:frame_02']);
  assert.equal(preview.preview_frame_id, 'frame_02');

  const exported = await orchestrator.exportHtmlVideoProject({
    rootDir,
    workflowId: 'wf',
    runId: 'run',
    project: preview.project,
    templateRegistry,
    services,
  });
  assert.equal(exported.success, true);
  assert.deepEqual(calls.slice(-3), ['render:frame_01', 'render:frame_02', 'concat:2']);
  assert.equal(exported.project.exports.length, 1);

  console.log('html-video project orchestrator mode tests passed');
})();
