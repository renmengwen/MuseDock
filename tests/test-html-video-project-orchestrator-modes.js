const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const orchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-modes-'));
  // rootDir/workflowId/runId 模式的工程目录布局与 projectStore.createProjectDir 一致
  // （同 test-agent-runs-html-video-project-failure-meta.js 的既有约定）
  const runProjectDirFor = runId => path.join(rootDir, 'wf', 'agent_runs', `${runId}-html-video`);
  const rawFrameHtml = label => `<html><body><main>${label}</main></body></html>`;
  await writeFile(path.join(runProjectDirFor('run'), 'frames/frame_01.html'), rawFrameHtml('帧一'));
  await writeFile(path.join(runProjectDirFor('run'), 'frames/frame_02.html'), rawFrameHtml('帧二'));

  const project = {
    project_id: 'wf_run',
    workflow_id: 'wf',
    run_id: 'run',
    output: { resolution: { width: 1080, height: 1920 }, fps: 24 },
    frames: [
      { id: 'frame_01', scene_id: 'scene_01', source_mode: 'raw_html', html_path: 'frames/frame_01.html', duration_sec: 2 },
      { id: 'frame_02', scene_id: 'scene_02', source_mode: 'raw_html', html_path: 'frames/frame_02.html', duration_sec: 2 },
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
      verifyDurationWithFfprobe: async ({ expectedDurationSec }) => ({
        success: true,
        expected_duration_sec: expectedDurationSec,
        duration_sec: expectedDurationSec,
      }),
    },
  };

  const materialized = await orchestrator.materializeHtmlVideoProject({
    rootDir,
    workflowId: 'wf',
    runId: 'run',
    project,
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
    frameId: 'frame_02',
    services,
  });
  assert.equal(preview.success, true);
  assert.deepEqual(calls, ['render:frame_02']);
  assert.equal(preview.preview_frame_id, 'frame_02');

  const autoFitRenderCalls = [];
  await writeFile(path.join(runProjectDirFor('auto-fit'), 'frames/frame_auto_fit.html'), rawFrameHtml('自动延长'));
  const autoFitExport = await orchestrator.exportHtmlVideoProject({
    rootDir,
    workflowId: 'wf',
    runId: 'auto-fit',
    project: {
      ...project,
      project_id: 'wf_auto_fit',
      run_id: 'auto-fit',
      frames: [
        {
          id: 'frame_auto_fit',
          scene_id: 'scene_auto_fit',
          source_mode: 'raw_html',
          html_path: 'frames/frame_auto_fit.html',
          duration_sec: 2,
          captions: [{ id: 'cap_01', start: 0, end: 3.2, text: '这句字幕超过画面时长' }],
        },
      ],
      timeline: { tracks: [{ id: 'main', type: 'video', items: [{ id: 'item_auto_fit', kind: 'frame', frame_id: 'frame_auto_fit', start_sec: 0, duration_sec: 2 }] }] },
    },
    services: {
      frameRenderer: {
        renderFrame: async (frame, options) => {
          autoFitRenderCalls.push({ id: frame.id, duration_sec: frame.duration_sec });
          await writeFile(options.outputPath, 'mp4');
          return { success: true, output_path: options.outputPath, diagnostics: [] };
        },
      },
      ffmpegComposer: services.ffmpegComposer,
    },
  });
  assert.equal(autoFitExport.success, true);
  assert.deepEqual(autoFitRenderCalls, [{ id: 'frame_auto_fit', duration_sec: 3.2 }]);
  assert.equal(autoFitExport.project.frames[0].duration_sec, 3.2);
  assert.equal(autoFitExport.project.timeline.tracks[0].items[0].duration_sec, 3.2);
  assert.ok(autoFitExport.diagnostics.some(item => item.code === 'frame_duration_auto_extended'));

  const lockedRenderCalls = [];
  await writeFile(path.join(runProjectDirFor('locked'), 'frames/frame_locked.html'), rawFrameHtml('锁定时长'));
  const lockedExport = await orchestrator.exportHtmlVideoProject({
    rootDir,
    workflowId: 'wf',
    runId: 'locked',
    project: {
      ...project,
      project_id: 'wf_locked',
      run_id: 'locked',
      output: { ...project.output, duration_locked: true },
      frames: [
        {
          id: 'frame_locked',
          scene_id: 'scene_locked',
          source_mode: 'raw_html',
          html_path: 'frames/frame_locked.html',
          duration_sec: 2,
          captions: [{ id: 'cap_01', start: 0, end: 3.2, text: '锁定后不能自动延长' }],
        },
      ],
      timeline: { tracks: [{ id: 'main', type: 'video', items: [] }] },
    },
    services: {
      frameRenderer: {
        renderFrame: async () => {
          lockedRenderCalls.push('render');
          return { success: true, output_path: 'unused.mp4', diagnostics: [] };
        },
      },
      ffmpegComposer: services.ffmpegComposer,
    },
  });
  assert.equal(lockedExport.success, false);
  assert.match(lockedExport.message, /字幕时间超过锁定的画面时长/);
  assert.deepEqual(lockedRenderCalls, []);
  assert.ok(lockedExport.diagnostics.some(item => item.code === 'caption_duration_exceeds_frame'));

  const renderFailureDir = path.join(rootDir, 'render-failure-project');
  await writeFile(path.join(renderFailureDir, 'frames/frame_failed.html'), rawFrameHtml('失败'));
  const renderFailure = await orchestrator.exportHtmlVideoProject({
    projectDir: renderFailureDir,
    project: {
      ...project,
      project_id: 'wf_render_failure',
      run_id: 'render-failure',
      frames: [
        { id: 'frame_failed', scene_id: 'scene_failed', source_mode: 'raw_html', html_path: 'frames/frame_failed.html', duration_sec: 2 },
      ],
      timeline: { tracks: [{ id: 'main', type: 'video', items: [] }] },
    },
    services: {
      frameRenderer: {
        renderFrame: async () => ({ success: false, code: 'render_timeout', message: '单帧渲染超时。', diagnostics: [] }),
      },
      ffmpegComposer: services.ffmpegComposer,
    },
  });
  assert.equal(renderFailure.success, false);
  const renderFailureProjectJson = JSON.parse(await fs.readFile(path.join(renderFailureDir, 'project.json'), 'utf8'));
  assert.equal(renderFailureProjectJson.generation_checkpoint.stages.render.frames.scene_failed.status, 'failed');
  assert.equal(renderFailureProjectJson.generation_checkpoint.stages.render.frames.scene_failed.diagnostic_code, 'render_timeout');

  const exported = await orchestrator.exportHtmlVideoProject({
    rootDir,
    workflowId: 'wf',
    runId: 'run',
    project: preview.project,
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
  const exportedProjectJson = JSON.parse(await fs.readFile(path.join(exported.html_video_project_path, 'project.json'), 'utf8'));
  assert.equal(exportedProjectJson.generation_checkpoint.stages.render.frames.scene_01.status, 'done');
  assert.equal(exportedProjectJson.generation_checkpoint.stages.render.frames.scene_01.mp4_path, 'frames/frame_01.mp4');
  assert.ok(exportedProjectJson.generation_checkpoint.stages.render.frames.scene_01.output_hash);
  assert.equal(exportedProjectJson.generation_checkpoint.stages.compose.status, 'done');
  assert.equal(exportedProjectJson.generation_checkpoint.stages.compose.output_path, 'exports/output.mp4');
  assert.equal(exportedProjectJson.generation_checkpoint.stages.duration_verify.status, 'done');
  assert.equal(exportedProjectJson.generation_checkpoint.stages.duration_verify.expected_duration_sec, 4);
  assert.equal(exportedProjectJson.generation_checkpoint.stages.duration_verify.actual_duration_sec, 4);

  await writeFile(path.join(runProjectDirFor('missing-manifest'), 'frames/frame_01.html'), rawFrameHtml('帧一'));
  await writeFile(path.join(runProjectDirFor('missing-manifest'), 'frames/frame_02.html'), rawFrameHtml('帧二'));
  const missingManifestExport = await orchestrator.exportHtmlVideoProject({
    rootDir,
    workflowId: 'wf',
    runId: 'missing-manifest',
    project: {
      ...project,
      project_id: 'wf_missing_manifest',
      run_id: 'missing-manifest',
      audio: { status: 'ready', tts_manifest_path: 'tts/missing-manifest.json' },
    },
    services,
  });
  assert.equal(missingManifestExport.success, true);
  const missingManifestDiagnostic = missingManifestExport.diagnostics.find(item => item.code === 'tts_manifest_missing');
  assert.ok(missingManifestDiagnostic);
  assert.equal(missingManifestDiagnostic.sub_stage, 'compose');
  assert.equal(missingManifestDiagnostic.retryable, true);
  assert.equal(missingManifestDiagnostic.repair_action, 'retry_compose');

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
