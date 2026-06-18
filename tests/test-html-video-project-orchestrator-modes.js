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
  const progressEvents = [];
  const services = {
    frameRenderer: {
      renderFrame: async (frame, options) => {
        calls.push(`render:${frame.id}`);
        await options.onProgress?.({ frame, percent: 40, message: '正在录制 html-video 帧...' });
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
    onProgress: async event => {
      await new Promise(resolve => setImmediate(resolve));
      progressEvents.push(event);
      if (event.type === 'html_video_compose_started') {
        throw new Error('progress failed');
      }
    },
  });
  assert.equal(exported.success, true);
  assert.deepEqual(calls.slice(-3), ['render:frame_01', 'render:frame_02', 'concat:2']);
  assert.equal(exported.project.exports.length, 1);
  assert.ok(progressEvents.some(event => event.type === 'html_video_frame_render_progress' && event.frame_id === 'frame_01'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_compose_started'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_export_ready'));

  const rawProjectDir = path.join(rootDir, 'raw-project');
  await writeFile(path.join(rawProjectDir, 'frames', 'raw.html'), [
    '<html>',
    '<body>',
    '<main>Raw HTML frame</main>',
    '</body>',
    '</html>',
  ].join('\n'));
  const rawProject = {
    project_id: 'wf_raw',
    workflow_id: 'wf',
    run_id: 'raw',
    output: { resolution: { width: 1080, height: 1920 }, fps: 24 },
    frames: [
      {
        id: 'raw_frame_01',
        scene_id: 'raw_scene_01',
        source_mode: 'raw_html',
        html_path: 'frames/raw.html',
        narration_text: '导出前必须恢复字幕层',
        duration_sec: 2,
      },
    ],
    timeline: { tracks: [{ id: 'main', type: 'video', items: [] }] },
  };
  const rawCalls = [];
  const rawExported = await orchestrator.exportHtmlVideoProject({
    projectDir: rawProjectDir,
    project: rawProject,
    services: {
      frameRenderer: {
        renderFrame: async (frame, options) => {
          rawCalls.push(`render:${frame.id}`);
          await writeFile(options.outputPath, 'mp4');
          return { success: true, output_path: options.outputPath, diagnostics: [] };
        },
      },
      ffmpegComposer: services.ffmpegComposer,
    },
  });
  assert.equal(rawExported.success, true);
  assert.deepEqual(rawCalls, ['render:raw_frame_01']);
  assert.ok(rawExported.project.frames[0].captions.length > 0);
  const rawHtml = await fs.readFile(path.join(rawProjectDir, rawExported.project.frames[0].html_path), 'utf8');
  assert.match(rawHtml, /data-hv-layer="captions"|data-role="subtitle-caption"/);

  console.log('html-video project orchestrator mode tests passed');
})();
