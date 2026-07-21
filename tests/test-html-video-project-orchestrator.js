const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const fsSync = require('fs');
const createdTempDirs = [];
const mkdtemp = fs.mkdtemp.bind(fs);
fs.mkdtemp = async (...args) => { const dir = await mkdtemp(...args); createdTempDirs.push(dir); return dir; };
process.on('exit', () => createdTempDirs.forEach(dir => fsSync.rmSync(dir, { recursive: true, force: true })));

const projectOrchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const { runtimeAssetPolicyAttestation } = require('../server/services/creative-video/html-video/frameRenderPhase');

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
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-asset-gate-'));
    await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'frames', 'scene_01.html'), '<img src=../assets/unregistered.png>');
    let renderCalls = 0;
    let composeCalls = 0;
    const project = {
      project_id: 'asset-registry-preflight',
      output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 2 },
      frames: [{ id: 'scene_01', scene_id: 'scene_01', html_path: 'frames/scene_01.html', duration_sec: 2 }],
      timeline: { tracks: [{ id: 'main', type: 'video', items: [{ frame_id: 'scene_01', duration_sec: 2 }] }] },
      audio: { status: 'skipped', reason: 'disabled_by_settings' },
      assets: [],
    };
    const result = await projectOrchestrator.renderHtmlVideoProject({
      project,
      projectDir,
      services: {
        materializer: { materializeProject: async ({ project }) => ({ project, diagnostics: [] }) },
        frameRenderer: { renderFrame: async () => {
          renderCalls += 1;
          return {
            success: false,
            code: 'runtime_visual_asset_policy_violation',
            message: '运行时素材门禁阻断。',
            diagnostics: [{
              code: 'runtime_visual_asset_policy_violation',
              sub_stage: 'frame_html',
              frame_id: 'scene_01',
              details: { violations: [{ source: 'route', kind: 'unregistered_local_image', target: 'assets/unregistered.png', frame_id: 'scene_01' }] },
            }],
          };
        } },
        ffmpegComposer: { concatFramesWithFfmpeg: async () => { composeCalls += 1; return { success: true }; } },
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.code, 'runtime_visual_asset_policy_violation');
    assert.equal(renderCalls, 1, '静态早诊断后必须进入真实 renderer 裁决');
    assert.equal(composeCalls, 0, '资产登记预检失败后不得调用 compositor');
    assert.deepEqual(result.project.asset_usage_report.unregistered_image_references, [
      { frame_id: 'scene_01', reference: '../assets/unregistered.png' },
      { frame_id: 'scene_01', reference: 'assets/unregistered.png', source: 'runtime' },
    ]);
    const saved = JSON.parse(await fs.readFile(path.join(projectDir, 'project.json'), 'utf8'));
    assert.equal(saved.generation_checkpoint.stages.render.frames.scene_01.diagnostic_code, 'runtime_visual_asset_policy_violation');
    assert.equal(saved.asset_usage_report.runtime_policy_violations[0].frame_id, 'scene_01');

    renderCalls = 0;
    const lowLevelRender = await projectOrchestrator.renderHtmlVideoFrames({ project, projectDir, services: {
      frameRenderer: { renderFrame: async () => { renderCalls += 1; return { success: false, code: 'runtime_visual_asset_policy_violation', diagnostics: [] }; } },
    } });
    assert.equal(lowLevelRender.code, 'runtime_visual_asset_policy_violation');
    assert.equal(renderCalls, 1, '低层 renderHtmlVideoFrames 也必须进入 runtime gate');

    const failedProject = JSON.parse(await fs.readFile(path.join(projectDir, 'project.json'), 'utf8'));
    const recovered = await projectOrchestrator.renderHtmlVideoFrames({
      project: failedProject,
      projectDir,
      frameIds: ['scene_01'],
      services: { frameRenderer: { renderFrame: async (_frame, options) => ({ success: true, output_path: options.outputPath, diagnostics: [] }) } },
    });
    assert.equal(recovered.success, true);
    assert.deepEqual(recovered.project.asset_usage_report.runtime_policy_violations, [], '成功重渲染必须清理当前帧活动违规');

    composeCalls = 0;
    const lowLevelCompose = await projectOrchestrator.composeHtmlVideoProject({ project, projectDir, services: {
      ffmpegComposer: { concatFramesWithFfmpeg: async () => { composeCalls += 1; return { success: true }; } },
    } });
    assert.equal(lowLevelCompose.success, false);
    assert.equal(composeCalls, 0, '低层 composeHtmlVideoProject 不得绕过资产预检');
    await fs.rm(projectDir, { recursive: true, force: true });
  }

  {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-'));
    let muxCalls = 0;
    const project = {
      project_id: 'timing-fit-no-errors-field',
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
          renderFrame: async frame => {
            const outputPath = path.join(projectDir, 'frames', `${frame.id}.mp4`);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, 'frame-video');
            return { success: true, output_path: outputPath, diagnostics: [], meta: { encoding: 'h264' } };
          },
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
      output: { resolution: { width: 1920, height: 1080 }, fps: 30, duration: 2 },
      frames: [
        { id: 'frame_01', scene_id: 'scene_01', source_mode: 'raw_html', html_path: 'frames/scene_01.html', duration_sec: 2 },
      ],
      timeline: { tracks: [{ id: 'main', type: 'video', items: [{ frame_id: 'frame_01', scene_id: 'scene_01', duration_sec: 2 }] }] },
      audio: { status: 'skipped', reason: 'disabled_by_settings' },
    };
    await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'frames', 'scene_01.html'), '<html><head></head><body>frame</body></html>');

    const rendered = await projectOrchestrator.renderHtmlVideoFrames({
      project,
      projectDir,
      frameIds: ['scene_01'],
      services: {
        frameRenderer: {
          renderFrame: async frame => {
            renderCalls += 1;
            await fs.writeFile(path.join(projectDir, 'frames', `${frame.id}.mp4`), 'frame-video');
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
    assert.equal(rendered.project.generation_checkpoint.stages.render.frames.scene_01.runtime_asset_policy_attestation?.version, 'runtime-asset-policy-v2');
    assert.equal(Object.hasOwn(rendered.project.generation_checkpoint.stages.render.frames, 'frame_01'), false);

    const renderWithCheckpoint = async (candidate, beforeRender = async () => {}) => {
      let calls = 0;
      await beforeRender();
      const result = await projectOrchestrator.renderHtmlVideoFrames({
        projectDir,
        project: candidate,
        frameIds: ['scene_01'],
        services: { frameRenderer: { renderFrame: async (_frame, { outputPath }) => {
          calls += 1;
          await fs.writeFile(outputPath, 'frame-video');
          return { success: true, output_path: outputPath, diagnostics: [] };
        } } },
      });
      assert.equal(result.success, true);
      return calls;
    };
    assert.equal(await renderWithCheckpoint(rendered.project), 0, '输入与 MP4 身份完整一致时必须直接复用');
    const changedInputs = [
      candidate => { candidate.output.resolution.width = 1280; },
      candidate => { candidate.output.fps = 24; },
      candidate => { candidate.frames[0].duration_sec = 3; },
      candidate => { candidate.generation_checkpoint.stages.render.frames.scene_01.runtime_asset_policy_attestation.renderer_runtime_contract_version = 'hyperframes-playwright@older'; },
      candidate => { candidate.assets = [{ id: 'asset-new', media_type: 'image/png', status: 'ready', path: 'assets/new.png', frame_src: '../assets/new.png' }]; },
      candidate => { candidate.generation_checkpoint.stages.render.frames.scene_01.runtime_asset_policy_attestation.version = 'runtime-asset-policy-v1'; },
      candidate => { candidate.generation_checkpoint.stages.render.frames.scene_01.status = 'pending'; },
    ];
    for (const mutate of changedInputs) {
      const candidate = JSON.parse(JSON.stringify(rendered.project));
      mutate(candidate);
      assert.equal(await renderWithCheckpoint(candidate), 1, '任一渲染输入或旧 checkpoint 变化时只重渲染目标帧');
    }
    assert.equal(await renderWithCheckpoint(
      rendered.project,
      () => fs.writeFile(path.join(projectDir, 'frames', 'scene_01.html'), '<html><body>changed-render-input</body></html>'),
    ), 1, 'HTML 字节变化时不得复用');
    await fs.writeFile(path.join(projectDir, 'frames', 'scene_01.html'), '<html><head></head><body>frame</body></html>');
    assert.equal(await renderWithCheckpoint(
      rendered.project,
      () => fs.writeFile(path.join(projectDir, 'frames', 'frame_01.mp4'), 'tampered-before-render'),
    ), 1, 'MP4 内容 hash 变化时不得复用');

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

    await fs.writeFile(path.join(projectDir, 'frames', 'scene_01.html'), '<html><head></head><body>changed</body></html>');
    let driftComposeCalls = 0;
    const drifted = await projectOrchestrator.composeHtmlVideoProject({
      projectDir,
      project: rendered.project,
      services: { ffmpegComposer: { concatFramesWithFfmpeg: async () => { driftComposeCalls += 1; return { success: true }; } } },
    });
    assert.equal(drifted.code, 'runtime_asset_policy_revalidation_required');
    assert.deepEqual(drifted.diagnostics[0].details.frame_ids, ['frame_01']);
    assert.equal(driftComposeCalls, 0);
    await fs.writeFile(path.join(projectDir, 'frames', 'scene_01.html'), '<html><head></head><body>frame</body></html>');
    const registryDrifted = await projectOrchestrator.composeHtmlVideoProject({
      projectDir, project: { ...rendered.project, assets: [{ id: 'new', type: 'image', path: 'assets/new.png', status: 'ready' }] },
      services: { ffmpegComposer: { concatFramesWithFfmpeg: async () => { throw new Error('不得合成'); } } },
    });
    assert.equal(registryDrifted.code, 'runtime_asset_policy_revalidation_required');
    const oldCheckpointProject = JSON.parse(JSON.stringify(rendered.project));
    delete oldCheckpointProject.generation_checkpoint.stages.render.frames.scene_01.runtime_asset_policy_attestation;
    const oldCheckpoint = await projectOrchestrator.composeHtmlVideoProject({
      projectDir, project: oldCheckpointProject,
      services: { ffmpegComposer: { concatFramesWithFfmpeg: async () => { throw new Error('不得合成'); } } },
    });
    assert.equal(oldCheckpoint.code, 'runtime_asset_policy_revalidation_required');
    const oldPolicyProject = JSON.parse(JSON.stringify(rendered.project));
    oldPolicyProject.generation_checkpoint.stages.render.frames.scene_01.runtime_asset_policy_attestation.version = 'runtime-asset-policy-v0';
    const oldPolicy = await projectOrchestrator.composeHtmlVideoProject({
      projectDir, project: oldPolicyProject,
      services: { ffmpegComposer: { concatFramesWithFfmpeg: async () => { throw new Error('不得合成'); } } },
    });
    assert.equal(oldPolicy.code, 'runtime_asset_policy_revalidation_required');
    const attacks = [];
    const absoluteMp4 = JSON.parse(JSON.stringify(rendered.project));
    absoluteMp4.generation_checkpoint.stages.render.frames.scene_01.mp4_path = path.join(projectDir, 'frames', 'frame_01.mp4');
    attacks.push(absoluteMp4);
    const previewFallback = JSON.parse(JSON.stringify(rendered.project));
    previewFallback.generation_checkpoint.stages.render.frames.scene_01.mp4_path = '';
    previewFallback.frames[0].preview_mp4_path = 'frames/frame_01.mp4';
    attacks.push(previewFallback);
    const swappedPath = JSON.parse(JSON.stringify(rendered.project));
    swappedPath.generation_checkpoint.stages.render.frames.scene_01.mp4_path = 'frames/other.mp4';
    attacks.push(swappedPath);
    const wrongIdentity = JSON.parse(JSON.stringify(rendered.project));
    wrongIdentity.generation_checkpoint.stages.render.frames.scene_01.runtime_asset_policy_attestation.frame_id = 'evil';
    attacks.push(wrongIdentity);
    for (const attacked of attacks) {
      const blocked = await projectOrchestrator.composeHtmlVideoProject({ projectDir, project: attacked,
        services: { ffmpegComposer: { concatFramesWithFfmpeg: async () => { throw new Error('不得合成'); } } } });
      assert.equal(blocked.code, 'runtime_asset_policy_revalidation_required');
    }
    const nonMp4 = JSON.parse(JSON.stringify(rendered.project));
    const nonMp4Checkpoint = nonMp4.generation_checkpoint.stages.render.frames.scene_01;
    nonMp4Checkpoint.mp4_path = 'frames/not-video.txt';
    await fs.writeFile(path.join(projectDir, nonMp4Checkpoint.mp4_path), 'frame-video');
    nonMp4Checkpoint.runtime_asset_policy_attestation = await runtimeAssetPolicyAttestation(
      projectDir, nonMp4, nonMp4.frames[0], {
        checkpoint_key: 'scene_01', mp4_path: nonMp4Checkpoint.mp4_path, output_hash: nonMp4Checkpoint.output_hash,
      },
    );
    let nonMp4ComposeCalls = 0;
    const nonMp4Blocked = await projectOrchestrator.composeHtmlVideoProject({ projectDir, project: nonMp4,
      services: { ffmpegComposer: {
        concatFramesWithFfmpeg: async (_frames, outputPath) => {
          nonMp4ComposeCalls += 1;
          return { success: true, output_path: outputPath };
        },
        verifyDurationWithFfprobe: async () => ({ success: true, duration_sec: 2, expected_duration_sec: 2 }),
      } } });
    assert.equal(nonMp4Blocked.code, 'runtime_asset_policy_revalidation_required');
    assert.equal(nonMp4ComposeCalls, 0, '非 MP4 checkpoint 不得调用 compositor');
    await fs.writeFile(path.join(projectDir, 'frames', 'frame_01.mp4'), 'tampered');
    const tampered = await projectOrchestrator.composeHtmlVideoProject({ projectDir, project: rendered.project,
      services: { ffmpegComposer: { concatFramesWithFfmpeg: async () => { throw new Error('不得合成'); } } } });
    assert.equal(tampered.code, 'runtime_asset_policy_revalidation_required');

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
          renderFrame: async frame => {
            const outputPath = path.join(projectDir, 'frames', `${frame.id}.mp4`);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, `frame:${frame.id}`);
            return { success: true, output_path: outputPath, meta: { encoding: 'h264' }, diagnostics: [] };
          },
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
          renderFrame: async frame => {
            const outputPath = path.join(projectDir, 'frames', `${frame.id}.mp4`);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, `frame:${frame.id}`);
            return { success: true, output_path: outputPath, meta: { encoding: 'h264' }, diagnostics: [] };
          },
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
          renderFrame: async frame => {
            const outputPath = path.join(projectDir, 'frames', `${frame.id}.mp4`);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, `frame:${frame.id}`);
            return { success: true, output_path: outputPath, meta: { encoding: 'h264' }, diagnostics: [] };
          },
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
