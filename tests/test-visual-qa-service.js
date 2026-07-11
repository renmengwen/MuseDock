const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const qa = require('../server/services/creative-video/visualQaService');

(async () => {
  const whiteFrames = Array.from({ length: 10 }, (_, index) => ({
    id: `frame_${index}`,
    average_luma: 245,
    luma_stddev: 4,
    edge_score: 2,
    color_variance: 3,
  }));

  const whiteResult = qa.analyzeFrameMetrics({
    frames: whiteFrames,
    contact_sheet_size: 6000,
  });
  assert.equal(whiteResult.success, false);
  assert.ok(whiteResult.issues.some(issue => issue.code === 'too_many_blank_frames'));
  assert.ok(whiteResult.issues.some(issue => issue.code === 'contact_sheet_too_small'));

  const blackFrames = Array.from({ length: 10 }, (_, index) => ({
    id: `frame_${index}`,
    average_luma: 12,
    luma_stddev: 3,
    edge_score: 2,
    color_variance: 1,
  }));
  const blackResult = qa.analyzeFrameMetrics({ frames: blackFrames, contact_sheet_size: 45000 });
  assert.equal(blackResult.success, false);
  assert.ok(blackResult.issues.some(issue => issue.code === 'too_many_blank_frames'));

  const darkInformativeFrames = Array.from({ length: 10 }, (_, index) => ({
    id: `dark_informative_${index}`,
    average_luma: 18,
    luma_stddev: 42,
    edge_score: 18,
    color_variance: 28,
  }));
  const darkInformativeResult = qa.analyzeFrameMetrics({
    frames: darkInformativeFrames,
    contact_sheet_size: 45000,
  });
  assert.equal(darkInformativeResult.success, true);
  assert.equal(darkInformativeResult.metrics.blank_ratio, 0);
  assert.ok(!darkInformativeResult.issues.some(issue => issue.code === 'too_many_blank_frames'));

  const lowInfoFrames = Array.from({ length: 10 }, (_, index) => ({
    id: `frame_${index}`,
    average_luma: 120,
    luma_stddev: 5,
    edge_score: 4,
    color_variance: 4,
  }));
  const lowInfoResult = qa.analyzeFrameMetrics({ frames: lowInfoFrames, contact_sheet_size: 45000 });
  assert.equal(lowInfoResult.success, false);
  assert.ok(lowInfoResult.issues.some(issue => issue.code === 'too_many_low_information_frames'));

  const emptyResult = qa.analyzeFrameMetrics({ frames: [], contact_sheet_size: 45000 });
  assert.equal(emptyResult.success, false);
  assert.ok(emptyResult.issues.some(issue => issue.code === 'no_frames_analyzed'));

  const healthyFrames = Array.from({ length: 10 }, (_, index) => ({
    id: `frame_${index}`,
    average_luma: 120,
    luma_stddev: 45,
    edge_score: 28,
    color_variance: 35,
  }));

  const healthyResult = qa.analyzeFrameMetrics({
    frames: healthyFrames,
    contact_sheet_size: 45000,
  });
  assert.equal(healthyResult.success, true);
  assert.deepEqual(healthyResult.issues, []);

  const lowMotionFrames = Array.from({ length: 8 }, (_, index) => ({
    id: `low_motion_${index}`,
    average_luma: 120 + index,
    luma_stddev: 45,
    edge_score: 28,
    color_variance: 35,
    fingerprint: `unique_${index}`,
    motion_from_previous: index === 0 ? null : {
      mean_abs_diff: 0.35,
      changed_pixel_ratio: 0.004,
    },
  }));
  const lowMotionResult = qa.analyzeFrameMetrics({
    frames: lowMotionFrames,
    contact_sheet_size: 45000,
  });
  assert.equal(lowMotionResult.success, false);
  assert.ok(lowMotionResult.issues.some(issue => issue.code === 'low_motion'));
  assert.ok(lowMotionResult.metrics.motion_sample_count >= 7);

  const movingFrames = Array.from({ length: 8 }, (_, index) => ({
    id: `moving_${index}`,
    average_luma: 120 + index,
    luma_stddev: 45,
    edge_score: 28,
    color_variance: 35,
    fingerprint: `moving_${index}`,
    motion_from_previous: index === 0 ? null : {
      mean_abs_diff: 5.5,
      changed_pixel_ratio: 0.08,
    },
  }));
  const movingResult = qa.analyzeFrameMetrics({
    frames: movingFrames,
    contact_sheet_size: 45000,
  });
  assert.equal(movingResult.success, true);
  assert.ok(!movingResult.issues.some(issue => issue.code === 'low_motion'));

  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-qa-'));
  const outputPath = path.join(projectDir, 'output.mp4');
  await fs.writeFile(outputPath, 'fake video');
  const commands = [];
  const inspected = await qa.inspectRenderedVideo({
    projectDir,
    outputPath,
    runCommand: async (command, args) => {
      commands.push({ command, args });
      const target = args[args.length - 1];
      if (args.includes('rawvideo')) {
        await fs.writeFile(target, Buffer.alloc(160 * 90 * 3, 255));
      } else {
        await fs.writeFile(target, Buffer.alloc(45000, 1));
      }
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  assert.equal(inspected.success, false);
  assert.ok(inspected.issues.some(issue => issue.code === 'too_many_blank_frames'));
  assert.ok(commands.some(call => call.args.includes('rawvideo')));
  assert.ok(commands.some(call => call.args.includes('fps=2,scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2')));
  assert.ok(commands.some(call => call.args.includes('contact_sheet.jpg') || String(call.args[call.args.length - 1]).includes('contact_sheet.jpg')));

  {
    const calls = [];
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      expectedAspectRatio: '9:16',
      runCommand: async (command, args) => {
        calls.push({ command, args });
        if (args.includes('-show_entries')) {
          return { ok: false, stdout: '', stderr: 'ffprobe missing' };
        }
        if (args.length === 2 && args[0] === '-i') {
          return {
            ok: false,
            stdout: '',
            stderr: 'Stream #0:0: Video: h264, yuv420p, 1080x1920 [SAR 1:1 DAR 9:16], 30 fps',
          };
        }
        const target = args[args.length - 1];
        if (args.includes('rawvideo')) {
          const raw = Buffer.alloc(160 * 90 * 3);
          for (let i = 0; i < raw.length; i += 3) {
            const pixel = i / 3;
            raw[i] = pixel % 255;
            raw[i + 1] = (pixel * 3) % 255;
            raw[i + 2] = (pixel * 7) % 255;
          }
          await fs.writeFile(target, raw);
        } else {
          await fs.writeFile(target, Buffer.alloc(45000, 1));
        }
        return { ok: true, stdout: '', stderr: '' };
      },
    });
    assert.equal(report.success, true);
    assert.ok(calls.some(call => call.args.length === 2 && call.args[0] === '-i'));
    assert.ok(!report.issues.some(issue => issue.code === 'aspect_probe_unavailable'));
  }

  {
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      expectedAspectRatio: '9:16',
      services: {
        probeVideo: async () => ({ width: 1920, height: 1080, duration: 83.6 }),
        sampleFrames: async () => [
          { id: 'frame_0', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'a' },
          { id: 'frame_1', average_luma: 61, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'a' },
          { id: 'frame_2', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'a' },
        ],
      },
    });
    assert.equal(report.success, false);
    assert.ok(report.issues.some(issue => issue.code === 'aspect_ratio_mismatch'));
    assert.equal(report.report_path, 'inspect/visual-report.json');
    await fs.access(path.join(projectDir, report.report_path));
  }

  {
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      expectedAspectRatio: '16:9',
      services: {
        probeVideo: async () => ({ width: 1920, height: 1080, duration: 4 }),
        sampleFrames: async () => [
          { id: 'frame_0', time_sec: 0, average_luma: 245, luma_stddev: 2, edge_score: 1, color_variance: 1, fingerprint: 'blank' },
          { id: 'frame_1', time_sec: 0.5, average_luma: 246, luma_stddev: 2, edge_score: 1, color_variance: 1, fingerprint: 'blank_2' },
          { id: 'frame_2', time_sec: 1, average_luma: 100, luma_stddev: 31, edge_score: 19, color_variance: 31, fingerprint: 'b' },
          { id: 'frame_3', time_sec: 1.5, average_luma: 110, luma_stddev: 32, edge_score: 20, color_variance: 32, fingerprint: 'c' },
          { id: 'frame_4', time_sec: 2, average_luma: 120, luma_stddev: 33, edge_score: 21, color_variance: 33, fingerprint: 'd' },
          { id: 'frame_5', time_sec: 2.5, average_luma: 130, luma_stddev: 34, edge_score: 22, color_variance: 34, fingerprint: 'e' },
          { id: 'frame_6', time_sec: 3, average_luma: 140, luma_stddev: 35, edge_score: 23, color_variance: 35, fingerprint: 'f' },
          { id: 'frame_7', time_sec: 3.5, average_luma: 150, luma_stddev: 36, edge_score: 24, color_variance: 36, fingerprint: 'g' },
          { id: 'frame_8', time_sec: 4, average_luma: 160, luma_stddev: 37, edge_score: 25, color_variance: 37, fingerprint: 'h' },
          { id: 'frame_9', time_sec: 4.5, average_luma: 170, luma_stddev: 38, edge_score: 26, color_variance: 38, fingerprint: 'i' },
        ],
      },
    });
    assert.equal(report.success, false);
    assert.ok(report.issues.some(issue => issue.code === 'blank_opening_frame'));
    assert.ok(!report.issues.some(issue => issue.code === 'too_many_blank_frames'));
  }

  {
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      project: { frames: [{ id: 'a', duration_sec: 2 }, { id: 'b', duration_sec: 2 }] },
      expectedAspectRatio: '16:9',
      safetyOnly: true,
      services: {
        probeVideo: async () => ({ width: 1920, height: 1080, duration: 4 }),
        sampleFrames: async () => [
          { id: 'frame_0', time_sec: 0, average_luma: 90, luma_stddev: 30, edge_score: 18, color_variance: 30, fingerprint: 'a' },
          { id: 'frame_1', time_sec: 0.5, average_luma: 100, luma_stddev: 31, edge_score: 19, color_variance: 31, fingerprint: 'b' },
          { id: 'frame_2', time_sec: 1, average_luma: 110, luma_stddev: 32, edge_score: 20, color_variance: 32, fingerprint: 'c' },
          { id: 'frame_3', time_sec: 2, average_luma: 250, luma_stddev: 2, edge_score: 1, color_variance: 1, fingerprint: 'd' },
          { id: 'frame_4', time_sec: 2.5, average_luma: 251, luma_stddev: 2, edge_score: 1, color_variance: 1, fingerprint: 'e' },
          { id: 'frame_5', time_sec: 3, average_luma: 120, luma_stddev: 35, edge_score: 20, color_variance: 35, fingerprint: 'f' },
        ],
      },
    });
    assert.equal(report.success, false);
    assert.equal(report.safety_only, true);
    assert.ok(report.issues.some(issue => issue.code === 'blank_segment_boundary'));
  }

  {
    let rawvideoCalls = 0;
    let frameLimit = 0;
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      project: {
        frames: Array.from({ length: 100 }, (_, index) => ({ id: `f${index}`, duration_sec: 1 })),
      },
      expectedAspectRatio: '16:9',
      safetyOnly: true,
      runCommand: async (command, args) => {
        if (args.includes('-show_entries')) {
          return { ok: true, stdout: JSON.stringify({ streams: [{ width: 1920, height: 1080, duration: 180 }] }), stderr: '' };
        }
        if (args.includes('rawvideo')) {
          rawvideoCalls += 1;
          const frameArgIndex = args.indexOf('-frames:v');
          frameLimit = Number(args[frameArgIndex + 1]);
          const target = args[args.length - 1];
          const raw = Buffer.alloc(160 * 90 * 3 * frameLimit);
          const frameSize = 160 * 90 * 3;
          for (let frame = 0; frame < frameLimit; frame += 1) {
            const value = 80 + (frame % 80);
            for (let i = frame * frameSize; i < (frame + 1) * frameSize; i += 3) {
              raw[i] = value;
              raw[i + 1] = (value + 50) % 255;
              raw[i + 2] = (value + 100) % 255;
            }
          }
          await fs.writeFile(target, raw);
          return { ok: true, stdout: '', stderr: '' };
        }
        return { ok: true, stdout: '', stderr: '' };
      },
    });
    assert.equal(report.success, true);
    assert.equal(rawvideoCalls, 1);
    assert.ok(frameLimit <= 120);
    assert.equal(report.metrics.sampled_boundary_count, 39);
  }

  {
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      expectedAspectRatio: '9:16',
      services: {
        probeVideo: async () => ({}),
        sampleFrames: async () => [
          { id: 'frame_0', average_luma: 80, luma_stddev: 35, edge_score: 14, color_variance: 40, fingerprint: 'a' },
          { id: 'frame_1', average_luma: 90, luma_stddev: 36, edge_score: 15, color_variance: 41, fingerprint: 'b' },
          { id: 'frame_2', average_luma: 100, luma_stddev: 37, edge_score: 16, color_variance: 42, fingerprint: 'c' },
          { id: 'frame_3', average_luma: 110, luma_stddev: 38, edge_score: 17, color_variance: 43, fingerprint: 'd' },
        ],
      },
    });
    assert.equal(report.success, false);
    assert.ok(report.issues.some(issue => issue.code === 'aspect_probe_unavailable'));
  }

  {
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      expectedAspectRatio: '16:9',
      services: {
        probeVideo: async () => ({ width: 1920, height: 1080, duration: 83.6 }),
        sampleFrames: async () => [
          { id: 'frame_0', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'same' },
          { id: 'frame_1', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'same' },
          { id: 'frame_2', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'same' },
          { id: 'frame_3', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'same' },
        ],
      },
    });
    assert.equal(report.success, false);
    assert.ok(report.issues.some(issue => issue.code === 'repeated_frames'));
  }

  // ===== 模块7：asset_first QA =====
  const {
    analyzeAssetFirstRouting,
    analyzeAssetFirstBoundaries,
    analyzeAssetFirstCaptionRegion,
    attachAssetFirstWarnings,
  } = require('../server/services/creative-video/visualQaService');

  // 1) 路由类：takeover 按归零语义（决策 3）——任何 template_inputs 决策即报，不看占比阈值
  {
    const decisions = [
      { beat_id: 'b1', source_mode: 'template_inputs', template_id: 'frame-build-minimal' },
      { beat_id: 'b2', source_mode: 'template_inputs', template_id: 'frame-glitch-title' },
      { beat_id: 'b3', source_mode: 'raw_html', template_id: null, route_role: 'asset_overlay' },
    ];
    const warnings = analyzeAssetFirstRouting(decisions, { visualStrategy: 'asset_first' });
    assert.ok(warnings.some(i => i.code === 'asset_first_template_takeover' && i.severity === 'warning'));
    assert.ok(warnings.some(i => i.code === 'asset_first_title_template_used' && i.severity === 'warning'));
    const single = analyzeAssetFirstRouting(
      [{ beat_id: 'x1', source_mode: 'template_inputs', template_id: 'frame-swiss-grid' },
       ...Array.from({ length: 17 }, (_, i) => ({ beat_id: `r${i}`, source_mode: 'raw_html', template_id: null }))],
      { visualStrategy: 'asset_first' },
    );
    assert.ok(single.some(i => i.code === 'asset_first_template_takeover'), '占比再低也必须报（归零语义）');
    assert.deepStrictEqual(analyzeAssetFirstRouting(decisions, { visualStrategy: 'hf_first' }), []);
  }

  // 2) 边界重刷：同 scene 相邻条目边界前后成对采样差分（真实指标字段 average_luma / edge_score）
  {
    const boundaryGroups = [
      { scene_id: 'scene_05', boundary_sec: 69.71, same_scene: true,
        before: { average_luma: 158, edge_score: 0.31 }, after: { average_luma: 46, edge_score: 0.05 } },
      { scene_id: 'scene_05', boundary_sec: 76.04, same_scene: true,
        before: { average_luma: 153, edge_score: 0.30 }, after: { average_luma: 150, edge_score: 0.29 } },
      { scene_id: 'x', boundary_sec: 12.75, same_scene: false,
        before: { average_luma: 230, edge_score: 0.9 }, after: { average_luma: 25, edge_score: 0.1 } },
    ];
    const warnings = analyzeAssetFirstBoundaries(boundaryGroups, { visualStrategy: 'asset_first', diffThreshold: 0.25 });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'asset_first_boundary_refresh');
    assert.strictEqual(warnings[0].severity, 'warning');
    assert.ok(warnings[0].details.boundary_sec === 69.71);
  }

  // 3) 字幕区可读性：底部区域方差过低 = 无内容
  {
    const frames = [
      { time: 47.0, caption_active: true, bottom_region: { variance: 0.001, luma: 0.02 } },
      { time: 49.0, caption_active: true, bottom_region: { variance: 0.12, luma: 0.4 } },
      { time: 61.0, caption_active: false, bottom_region: { variance: 0.0, luma: 0.0 } },
    ];
    const warnings = analyzeAssetFirstCaptionRegion(frames, { visualStrategy: 'asset_first', minVariance: 0.01 });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'asset_first_caption_invisible');
  }

  // 4) QA warning 双向断言：warnings 不改变 success/issues；空 warnings 不加字段
  {
    const base = { success: true, issues: [], metrics: {} };
    const attached = attachAssetFirstWarnings(base, [{ code: 'asset_first_style_drift', severity: 'warning', message: 'x' }]);
    assert.strictEqual(attached.success, true, 'warnings 绝不能把 success 置 false');
    assert.deepStrictEqual(attached.issues, []);
    assert.strictEqual(attached.warnings.length, 1);
    const failed = attachAssetFirstWarnings({ success: false, issues: [{ code: 'blank_opening_frame' }], metrics: {} }, []);
    assert.strictEqual(failed.success, false, '空 warnings 不得翻转既有失败结果');
    assert.strictEqual(attachAssetFirstWarnings(base, []).warnings, undefined, '无 warning 时不添加字段，报告结构与现状一致');
  }
  console.log('visual qa asset_first tests passed');

  console.log('visual qa service tests passed');
})();
