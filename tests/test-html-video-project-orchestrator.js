const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');

(async () => {
  {
    const project = {
      frames: [{
        id: 'scene_04',
        duration_sec: 6,
        captions: [{ start: 0, end: 231.04, text: '异常字幕' }],
      }],
      timeline: { tracks: [{ id: 'main', type: 'video', items: [{ frame_id: 'scene_04', duration_sec: 6 }] }] },
    };

    const result = projectOrchestrator.fitFrameDurationsToCaptions(project);

    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(item => item.code === 'caption_duration_exceeds_reasonable_frame'));
    assert.equal(project.frames[0].duration_sec, 6);
  }

  {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-'));
    let muxCalls = 0;
    const project = {
      project_id: 'timing-fit-no-errors-field',
      template_id: 'raw-html',
      output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 4 },
      frames: [{
        id: 'scene_01',
        scene_id: 'scene_01',
        source_mode: 'raw_html',
        html_path: 'frames/scene_01.html',
        duration_sec: 4,
        captions: [{ start: 0, end: 3.5, text: '正常字幕' }],
      }],
      timeline: { tracks: [{ id: 'main', type: 'video', items: [{ frame_id: 'scene_01', duration_sec: 4 }] }] },
      audio: { status: 'skipped', reason: 'disabled_by_settings' },
    };

    const result = await projectOrchestrator.renderHtmlVideoProject({
      project,
      projectDir,
      services: {
        materializer: {
          materializeProject: async ({ project }) => ({ project, diagnostics: [] }),
        },
        frameRenderer: {
          renderFrame: async frame => ({
            success: true,
            output_path: path.join(projectDir, 'frames', `${frame.id}.mp4`),
            diagnostics: [],
            meta: { encoding: 'h264' },
          }),
        },
        ffmpegComposer: {
          concatFramesWithFfmpeg: async () => ({ success: true, output_path: path.join(projectDir, 'exports', 'output.mp4') }),
          muxAudioWithFfmpeg: async ({ videoPath }) => {
            muxCalls += 1;
            return { success: true, skipped: true, output_path: videoPath };
          },
          verifyDurationWithFfprobe: async () => ({ success: true, duration_sec: 4, expected_duration_sec: 4 }),
        },
      },
    });

    assert.equal(result.success, true);
    assert.equal(muxCalls, 0);
    assert.equal(result.output_path, path.join(projectDir, 'exports', 'output.mp4'));
  }

  {
    const project = {
      output: { duration: 60 },
      target: { duration_sec: 60 },
      frames: [
        { id: 'scene_01', duration_sec: 7.52 },
        { id: 'scene_04', duration_sec: 231.04 },
        { id: 'scene_05', duration_sec: 12.48 },
      ],
    };

    const result = projectOrchestrator.validateReasonableTimelineDuration(project, { targetDurationSec: 60 });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'timeline_duration_unreasonable');
  }

  {
    const project = {
      output: { duration: 91.84 },
      target: { duration_sec: 60 },
      frames: [
        { id: 'scene_01', duration_sec: 31.84 },
        { id: 'scene_02', duration_sec: 30 },
        { id: 'scene_03', duration_sec: 30 },
      ],
    };

    const result = projectOrchestrator.validateReasonableTimelineDuration(project, { targetDurationSec: 60 });

    assert.equal(result.ok, true);
    assert.equal(result.within_grace_duration, true);
    assert.equal(result.soft_allowed_duration_sec, 90);
  }

  {
    const project = {
      output: { duration: 108.64 },
      target: { duration_sec: 60 },
      frames: [
        { id: 'scene_01', duration_sec: 36.64 },
        { id: 'scene_02', duration_sec: 36 },
        { id: 'scene_03', duration_sec: 36 },
      ],
    };

    const result = projectOrchestrator.validateReasonableTimelineDuration(project, { targetDurationSec: 60 });

    assert.equal(result.ok, true);
    assert.equal(result.within_grace_duration, true);
  }

  {
    const project = {
      output: { duration: 121 },
      target: { duration_sec: 60 },
      frames: [
        { id: 'scene_01', duration_sec: 41 },
        { id: 'scene_02', duration_sec: 40 },
        { id: 'scene_03', duration_sec: 40 },
      ],
    };

    const result = projectOrchestrator.validateReasonableTimelineDuration(project, { targetDurationSec: 60 });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'timeline_duration_unreasonable');
  }

  {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-'));
    let renderFrameCalls = 0;
    const project = {
      project_id: 'timeline-duration-real-render',
      template_id: 'raw-html',
      output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 329 },
      target: { duration_sec: 60 },
      frames: [
        { id: 'scene_01', scene_id: 'scene_01', source_mode: 'raw_html', html_path: 'frames/scene_01.html', duration_sec: 7.52 },
        { id: 'scene_04', scene_id: 'scene_04', source_mode: 'raw_html', html_path: 'frames/scene_04.html', duration_sec: 309 },
        { id: 'scene_05', scene_id: 'scene_05', source_mode: 'raw_html', html_path: 'frames/scene_05.html', duration_sec: 12.48 },
      ],
      timeline: {
        tracks: [{
          id: 'main',
          type: 'video',
          items: [
            { frame_id: 'scene_01', duration_sec: 7.52 },
            { frame_id: 'scene_04', duration_sec: 309 },
            { frame_id: 'scene_05', duration_sec: 12.48 },
          ],
        }],
      },
      audio: { status: 'skipped' },
    };

    const result = await projectOrchestrator.renderHtmlVideoProject({
      project,
      projectDir,
      services: {
        materializer: {
          materializeProject: async ({ project }) => ({ project, diagnostics: [] }),
        },
        frameRenderer: {
          renderFrame: async () => {
            renderFrameCalls += 1;
            return { success: true, output_path: path.join(projectDir, 'frames', 'unused.mp4'), diagnostics: [] };
          },
        },
        ffmpegComposer: {
          concatFramesWithFfmpeg: async () => ({ success: true, output_path: path.join(projectDir, 'exports', 'output.mp4') }),
          muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
          verifyDurationWithFfprobe: async () => ({ success: true, duration_sec: 329, expected_duration_sec: 329 }),
        },
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.code, 'timeline_duration_unreasonable');
    assert.equal(result.diagnostics.some(item => item.code === 'timeline_duration_unreasonable'), true);
    assert.equal(renderFrameCalls, 0);
  }

  {
    const project = {
      frames: [{
        id: 'scene_01',
        duration_sec: 2,
        captions: [{ start: 0, end: 3.2, text: '可自动延长字幕' }],
      }],
      timeline: {
        tracks: [{
          id: 'main',
          type: 'video',
          items: [
            { id: 'unrelated_item', duration_sec: 2 },
            { id: 'scene_01', duration_sec: 2 },
          ],
        }],
      },
    };

    const result = projectOrchestrator.fitFrameDurationsToCaptions(project);

    assert.equal(result.ok, true);
    assert.equal(project.timeline.tracks[0].items[0].duration_sec, 2);
    assert.equal(project.timeline.tracks[0].items[1].duration_sec, 3.2);
  }

  console.log('html-video project orchestrator tests passed');
})();
