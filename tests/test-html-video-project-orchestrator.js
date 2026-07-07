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

  {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-render-'));
    let renderCalls = 0;
    let composeCalls = 0;
    const project = {
      project_id: 'render-subset',
      template_id: 'raw-html',
      output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 4 },
      frames: [
        { id: 'scene_01', scene_id: 'scene_01', source_mode: 'raw_html', html_path: 'frames/scene_01.html', duration_sec: 2 },
        { id: 'scene_02', scene_id: 'scene_02', source_mode: 'raw_html', html_path: 'frames/scene_02.html', duration_sec: 2 },
      ],
      timeline: {
        tracks: [{
          id: 'main',
          type: 'video',
          items: [
            { frame_id: 'scene_01', duration_sec: 2 },
            { frame_id: 'scene_02', duration_sec: 2 },
          ],
        }],
      },
      audio: { status: 'skipped', reason: 'disabled_by_settings' },
    };

    const result = await projectOrchestrator.renderHtmlVideoFrames({
      project,
      projectDir,
      frameIds: ['scene_02'],
      services: {
        materializer: {
          materializeProject: async ({ project }) => ({ project, diagnostics: [] }),
        },
        frameRenderer: {
          renderFrame: async frame => {
            renderCalls += 1;
            assert.equal(frame.id, 'scene_02');
            return {
              success: true,
              output_path: path.join(projectDir, 'frames', 'scene_02.mp4'),
              output_hash: 'scene_02-hash',
              meta: { encoding: 'h264' },
              diagnostics: [],
            };
          },
        },
        ffmpegComposer: {
          concatFramesWithFfmpeg: async () => {
            composeCalls += 1;
            throw new Error('renderHtmlVideoFrames 不应进入合成。');
          },
        },
      },
    });

    assert.equal(result.success, true);
    assert.equal(renderCalls, 1);
    assert.equal(composeCalls, 0);
    assert.equal(result.rendered_frames.length, 1);
    assert.equal(result.rendered_frames[0].frame_id, 'scene_02');
    assert.equal(result.project.generation_checkpoint.stages.render.frames.scene_02.status, 'done');
    assert.equal(result.project.generation_checkpoint.stages.render.frames.scene_02.diagnostic_code, '');
    assert.equal(Object.hasOwn(result.project.generation_checkpoint.stages.render.frames, 'scene_01'), false);
  }

  {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-render-scene-key-'));
    let renderCalls = 0;
    const project = {
      project_id: 'render-scene-key',
      template_id: 'raw-html',
      output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 2 },
      frames: [
        { id: 'frame_01', scene_id: 'scene_01', source_mode: 'raw_html', html_path: 'frames/scene_01.html', duration_sec: 2 },
      ],
      timeline: { tracks: [{ id: 'main', type: 'video', items: [{ frame_id: 'frame_01', scene_id: 'scene_01', duration_sec: 2 }] }] },
      audio: { status: 'skipped', reason: 'disabled_by_settings' },
    };

    const rendered = await projectOrchestrator.renderHtmlVideoFrames({
      project,
      projectDir,
      frameIds: ['scene_01'],
      services: {
        frameRenderer: {
          renderFrame: async frame => {
            renderCalls += 1;
            return {
              success: true,
              output_path: path.join(projectDir, 'frames', `${frame.id}.mp4`),
              output_hash: 'frame_01-hash',
              diagnostics: [],
            };
          },
        },
      },
    });

    assert.equal(rendered.success, true);
    assert.equal(renderCalls, 1);
    assert.equal(rendered.project.generation_checkpoint.stages.render.frames.scene_01.status, 'done');
    assert.equal(Object.hasOwn(rendered.project.generation_checkpoint.stages.render.frames, 'frame_01'), false);
    const composed = await projectOrchestrator.composeHtmlVideoProject({
      projectDir,
      project: rendered.project,
      services: {
        ffmpegComposer: {
          concatFramesWithFfmpeg: async (frames, outputPath) => {
            assert.equal(frames.length, 1);
            assert.equal(frames[0].frame_id, 'frame_01');
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, 'mp4');
            return { success: true, output_path: outputPath };
          },
          verifyDurationWithFfprobe: async () => ({ success: true, duration_sec: 2, expected_duration_sec: 2 }),
        },
      },
    });
    assert.equal(composed.success, true);

    renderCalls = 0;
    const aliasResult = await projectOrchestrator.renderHtmlVideoFrames({
      project,
      projectDir,
      frameIds: ['frame_01', 'scene_01'],
      services: {
        frameRenderer: {
          renderFrame: async frame => {
            renderCalls += 1;
            assert.equal(frame.id, 'frame_01');
            return {
              success: true,
              output_path: path.join(projectDir, 'frames', `${frame.id}-alias.mp4`),
              output_hash: 'frame_01-alias-hash',
              diagnostics: [],
            };
          },
        },
      },
    });
    assert.equal(aliasResult.success, true);
    assert.equal(renderCalls, 1);
  }

  {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-render-failure-'));
    let renderCalls = 0;
    const project = {
      project_id: 'render-failure',
      template_id: 'raw-html',
      output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 4 },
      frames: [
        { id: 'scene_01', scene_id: 'scene_01', source_mode: 'raw_html', html_path: 'frames/scene_01.html', duration_sec: 2 },
        { id: 'scene_02', scene_id: 'scene_02', source_mode: 'raw_html', html_path: 'frames/scene_02.html', duration_sec: 2 },
      ],
      timeline: {
        tracks: [{
          id: 'main',
          type: 'video',
          items: [
            { frame_id: 'scene_01', duration_sec: 2 },
            { frame_id: 'scene_02', duration_sec: 2 },
          ],
        }],
      },
      audio: { status: 'skipped', reason: 'disabled_by_settings' },
    };

    const result = await projectOrchestrator.renderHtmlVideoFrames({
      project,
      projectDir,
      frameIds: ['scene_02'],
      services: {
        materializer: {
          materializeProject: async ({ project }) => ({ project, diagnostics: [] }),
        },
        frameRenderer: {
          renderFrame: async () => {
            renderCalls += 1;
            return {
              success: false,
              message: '单帧渲染失败。',
              output_path: path.join(projectDir, 'frames', 'scene_02.mp4'),
              diagnostics: [],
            };
          },
        },
      },
    });

    assert.equal(result.success, false);
    assert.equal(renderCalls, 1);
    assert.equal(result.diagnostics.some(item => item.code === 'render_failed'), true);
    assert.equal(result.project.generation_checkpoint.stages.render.frames.scene_02.status, 'failed');
    assert.equal(result.project.generation_checkpoint.stages.render.frames.scene_02.diagnostic_code, 'render_failed');
  }

  {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-render-missing-'));
    const result = await projectOrchestrator.renderHtmlVideoFrames({
      project: {
        project_id: 'render-missing',
        frames: [{ id: 'scene_01', scene_id: 'scene_01', duration_sec: 2 }],
        audio: { status: 'skipped', reason: 'disabled_by_settings' },
      },
      projectDir,
      frameIds: ['scene_99'],
      services: {
        frameRenderer: {
          renderFrame: async () => {
            throw new Error('不存在的帧不应进入渲染。');
          },
        },
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.diagnostics[0].code, 'frame_not_found');
  }

  {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-compose-'));
    let concatCalls = 0;
    let muxCalls = 0;
    let verifyCalls = 0;
    const project = {
      project_id: 'compose-success',
      template_id: 'raw-html',
      output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 4 },
      frames: [
        { id: 'scene_01', scene_id: 'scene_01', source_mode: 'raw_html', html_path: 'frames/scene_01.html', duration_sec: 2 },
        { id: 'scene_02', scene_id: 'scene_02', source_mode: 'raw_html', html_path: 'frames/scene_02.html', duration_sec: 2 },
      ],
      timeline: {
        tracks: [{
          id: 'main',
          type: 'video',
          items: [
            { frame_id: 'scene_01', duration_sec: 2 },
            { frame_id: 'scene_02', duration_sec: 2 },
          ],
        }],
      },
      audio: { status: 'skipped', reason: 'disabled_by_settings' },
    };

    const rendered = await projectOrchestrator.renderHtmlVideoFrames({
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
            output_hash: `${frame.id}-hash`,
            meta: { encoding: 'h264' },
            diagnostics: [],
          }),
        },
      },
    });

    const composed = await projectOrchestrator.composeHtmlVideoProject({
      projectDir,
      project: rendered.project,
      targetDurationSec: 4,
      services: {
        ffmpegComposer: {
          concatFramesWithFfmpeg: async (frames, outputPath) => {
            concatCalls += 1;
            assert.equal(frames.length, 2);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, 'mp4');
            return { success: true, output_path: outputPath };
          },
          muxAudioWithFfmpeg: async () => {
            muxCalls += 1;
            throw new Error('音频已禁用，不应执行混流。');
          },
          verifyDurationWithFfprobe: async () => {
            verifyCalls += 1;
            return { success: true, duration_sec: 4, expected_duration_sec: 4 };
          },
        },
      },
    });

    assert.equal(composed.success, true);
    assert.equal(concatCalls, 1);
    assert.equal(muxCalls, 0);
    assert.equal(verifyCalls, 1);
    assert.equal(composed.output_path, path.join(projectDir, 'exports', 'output.mp4'));
    assert.equal(composed.project.generation_checkpoint.stages.compose.status, 'done');
    assert.equal(composed.project.generation_checkpoint.stages.compose.output_path, 'exports/output.mp4');
    assert.equal(composed.project.generation_checkpoint.stages.duration_verify.status, 'done');
    assert.equal(composed.project.generation_checkpoint.stages.duration_verify.expected_duration_sec, 4);
    assert.equal(composed.project.generation_checkpoint.stages.duration_verify.actual_duration_sec, 4);
  }

  {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-compose-incomplete-'));
    const partial = await projectOrchestrator.renderHtmlVideoFrames({
      project: {
        project_id: 'compose-incomplete',
        output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 4 },
        frames: [
          { id: 'scene_01', scene_id: 'scene_01', duration_sec: 2 },
          { id: 'scene_02', scene_id: 'scene_02', duration_sec: 2 },
        ],
        audio: { status: 'skipped', reason: 'disabled_by_settings' },
      },
      projectDir,
      frameIds: ['scene_02'],
      services: {
        frameRenderer: {
          renderFrame: async frame => ({
            success: true,
            output_path: path.join(projectDir, 'frames', `${frame.id}.mp4`),
            diagnostics: [],
          }),
        },
      },
    });

    const composed = await projectOrchestrator.composeHtmlVideoProject({
      projectDir,
      project: partial.project,
      services: {
        ffmpegComposer: {
          concatFramesWithFfmpeg: async () => {
            throw new Error('缺帧时不应进入合成。');
          },
        },
      },
    });

    assert.equal(composed.success, false);
    assert.equal(composed.diagnostics[0].code, 'render_checkpoint_missing');
    assert.equal(composed.project.generation_checkpoint.stages.compose.status, 'failed');
    assert.equal(composed.project.generation_checkpoint.stages.compose.diagnostic_code, 'render_checkpoint_missing');
  }

  {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-duration-failure-'));
    const project = {
      project_id: 'compose-duration-failure',
      template_id: 'raw-html',
      output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 4 },
      frames: [
        { id: 'scene_01', scene_id: 'scene_01', source_mode: 'raw_html', html_path: 'frames/scene_01.html', duration_sec: 2 },
      ],
      timeline: {
        tracks: [{
          id: 'main',
          type: 'video',
          items: [
            { frame_id: 'scene_01', duration_sec: 2 },
          ],
        }],
      },
      audio: { status: 'skipped', reason: 'disabled_by_settings' },
    };

    const rendered = await projectOrchestrator.renderHtmlVideoFrames({
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
            output_hash: `${frame.id}-hash`,
            meta: { encoding: 'h264' },
            diagnostics: [],
          }),
        },
      },
    });

    const composed = await projectOrchestrator.composeHtmlVideoProject({
      projectDir,
      project: rendered.project,
      targetDurationSec: 4,
      services: {
        ffmpegComposer: {
          concatFramesWithFfmpeg: async (frames, outputPath) => {
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, 'mp4');
            return { success: true, output_path: outputPath };
          },
          muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
          verifyDurationWithFfprobe: async () => ({
            success: false,
            code: 'duration_mismatch',
            message: '导出视频时长偏差过大。',
            expected_duration_sec: 4,
            duration_sec: 4.8,
          }),
        },
      },
    });

    assert.equal(composed.success, false);
    assert.equal(composed.diagnostics.some(item => item.code === 'duration_mismatch'), true);
    assert.equal(composed.project.generation_checkpoint.stages.duration_verify.status, 'failed');
    assert.equal(composed.project.generation_checkpoint.stages.duration_verify.diagnostic_code, 'duration_mismatch');
    assert.equal(composed.project.generation_checkpoint.stages.duration_verify.expected_duration_sec, 4);
    assert.equal(composed.project.generation_checkpoint.stages.duration_verify.actual_duration_sec, 4.8);
  }

  {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-sfx-fallback-'));
    const sfxDir = path.join(projectDir, 'audio', 'sfx');
    await fs.mkdir(sfxDir, { recursive: true });
    await fs.writeFile(path.join(sfxDir, 'hit.wav'), 'sfx');
    await fs.writeFile(path.join(sfxDir, 'skip.wav'), 'sfx');
    const muxCalls = [];
    const project = {
      project_id: 'compose-sfx-fallback',
      template_id: 'raw-html',
      output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 2 },
      frames: [
        { id: 'scene_01', scene_id: 'scene_01', source_mode: 'raw_html', html_path: 'frames/scene_01.html', duration_sec: 2 },
      ],
      timeline: { tracks: [{ id: 'main', type: 'video', items: [{ frame_id: 'scene_01', duration_sec: 2 }] }] },
      audio: {
        status: 'ready',
        narration_path: 'audio/narration.wav',
        sfx: {
          enabled: true,
          status: 'ready',
          events: [
            { id: 'enabled', sfx_id: 'mixkit-impact-blow', asset_path: 'audio/sfx/hit.wav', global_time_sec: 0.4, volume_db: -12, confidence: 0.9 },
            { id: 'disabled', sfx_id: 'mixkit-impact-blow', asset_path: 'audio/sfx/skip.wav', global_time_sec: 0.8, confidence: 0.9, enabled: false },
            { id: 'missing', sfx_id: 'mixkit-impact-blow', asset_path: 'audio/sfx/gone.wav', global_time_sec: 1.2, confidence: 0.9 },
          ],
        },
      },
    };

    const rendered = await projectOrchestrator.renderHtmlVideoFrames({
      project,
      projectDir,
      services: {
        frameRenderer: {
          renderFrame: async frame => ({
            success: true,
            output_path: path.join(projectDir, 'frames', `${frame.id}.mp4`),
            output_hash: `${frame.id}-hash`,
            meta: { encoding: 'h264' },
            diagnostics: [],
          }),
        },
      },
    });

    const composed = await projectOrchestrator.composeHtmlVideoProject({
      projectDir,
      project: rendered.project,
      services: {
        ffmpegComposer: {
          concatFramesWithFfmpeg: async (frames, outputPath) => {
            assert.equal(frames.length, 1);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, 'mp4');
            return { success: true, output_path: outputPath };
          },
          concatAudioWithFfmpeg: async () => ({ success: true, output_path: path.join(projectDir, 'audio', 'narration.wav') }),
          muxAudioWithFfmpeg: async options => {
            muxCalls.push(options);
            if (muxCalls.length === 1) return { success: false, stderr: 'sfx boom' };
            await fs.writeFile(options.outputPath, 'mp4');
            return { success: true, output_path: options.outputPath };
          },
        },
      },
    });

    assert.equal(composed.success, true);
    assert.equal(muxCalls.length, 2);
    assert.equal(muxCalls[0].sfxEvents.length, 1);
    assert.equal(muxCalls[0].sfxEvents[0].id, 'enabled');
    assert.equal(muxCalls[0].sfxEvents[0].path, path.join(projectDir, 'audio', 'sfx', 'hit.wav'));
    assert.deepEqual(muxCalls[1].sfxEvents, []);
    assert.equal(composed.diagnostics.some(item => item.code === 'sfx_mix_failed' && item.severity === 'warning'), true);
    // 素材缺失的事件被丢弃时要有 warning 诊断（spec §7.2），不能静默
    assert.equal(composed.diagnostics.some(item => item.code === 'sfx_event_dropped' && item.severity === 'warning'), true);
  }

  console.log('html-video project orchestrator tests passed');
})();
