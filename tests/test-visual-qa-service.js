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
    // P2-5：edge_score 是 0-255 级原始梯度标度，差分必须 /255 归一后再与 diffThreshold 比较。
    // 亮度不变、edge 差 8（真实产物常见量级）=> 8/255≈0.031，不得触发；
    // edge 差 200 => 200/255≈0.78，才触发。
    const edgeOnly = analyzeAssetFirstBoundaries([
      { scene_id: 'scene_01', boundary_sec: 10, same_scene: true,
        before: { average_luma: 120, edge_score: 20 }, after: { average_luma: 120, edge_score: 28 } },
      { scene_id: 'scene_02', boundary_sec: 20, same_scene: true,
        before: { average_luma: 120, edge_score: 20 }, after: { average_luma: 120, edge_score: 220 } },
    ], { visualStrategy: 'asset_first', diffThreshold: 0.25 });
    assert.strictEqual(edgeOnly.length, 1, 'edge 微小原始差值（未归一前 >0.25）不得单独触发');
    assert.strictEqual(edgeOnly[0].details.boundary_sec, 20);
    assert.ok(Math.abs(edgeOnly[0].details.score - 200 / 255) < 0.001, 'edge 分量按 /255 归一计分');
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

  // ===== Task 7.2：asset_first 信息密度 / 风格漂移 / 素材缺失映射 / overlay 越界映射 / 成对边界采样 =====
  const {
    analyzeAssetFirstInformation,
    analyzeAssetFirstStyleDrift,
    mapAssetUsageToQaWarnings,
    mapOverlayChecksToQaWarnings,
    projectBoundarySampleGroups,
  } = require('../server/services/creative-video/visualQaService');

  // 信息密度：无图 beat 帧元素统计不足 => warning
  {
    const beatsInfo = [
      { beat_id: 'scene_04_b1', has_asset: false, text_blocks: 1, cards: 0, graphics: 0 },
      { beat_id: 'scene_02_b1', has_asset: true, text_blocks: 1, cards: 0, graphics: 0 },
    ];
    const warnings = analyzeAssetFirstInformation(beatsInfo, { visualStrategy: 'asset_first', minElements: 3 });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'asset_first_low_information');
    assert.strictEqual(warnings[0].details.beat_id, 'scene_04_b1');
    assert.deepStrictEqual(analyzeAssetFirstInformation(beatsInfo, { visualStrategy: 'hf_first', minElements: 3 }), []);
  }
  // 风格漂移：帧平均色序列突变 => warning
  {
    const frames = [
      { time: 1, mean_rgb: [220, 220, 215] }, { time: 30, mean_rgb: [222, 219, 214] },
      { time: 47, mean_rgb: [10, 10, 12] },   { time: 60, mean_rgb: [12, 9, 10] },
    ];
    const warnings = analyzeAssetFirstStyleDrift(frames, { visualStrategy: 'asset_first', maxMeanShift: 96 });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'asset_first_style_drift');
    assert.deepStrictEqual(analyzeAssetFirstStyleDrift(frames, { visualStrategy: 'hf_first', maxMeanShift: 96 }), []);
  }
  // P2-4：style_drift 观测窗口 = 顺序帧（0-11.5s）∪ timed 边界采样帧（覆盖全片），
  // 合并去重按时间排序后 45s 级断裂可命中；横跨跨 scene 边界 ±0.35s 的帧对跳过（硬切合法）
  {
    const { mergeStyleDriftObservationFrames } = require('../server/services/creative-video/visualQaService');
    const sequential = Array.from({ length: 24 }, (_, i) => ({
      time_sec: i * 0.5,
      mean_rgb: [220, 220, 215],
    }));
    const timed = [
      { time_sec: 0, mean_rgb: [220, 220, 215] }, // 与顺序帧同时间点，应去重
      { time_sec: 45.17, mean_rgb: [221, 219, 214] },
      { time_sec: 45.77, mean_rgb: [12, 10, 11] }, // 45.47s 断裂点后
      { time_sec: 60, mean_rgb: [11, 9, 12] },
    ];
    const merged = mergeStyleDriftObservationFrames(sequential, timed);
    assert.strictEqual(merged.filter(f => Number(f.time_sec) === 0).length, 1, '同时间点帧去重');
    const sortedTimes = merged.map(f => Number(f.time_sec));
    assert.deepStrictEqual(sortedTimes, [...sortedTimes].sort((a, b) => a - b), '合并后按时间排序');
    const warnings = analyzeAssetFirstStyleDrift(merged, { visualStrategy: 'asset_first', maxMeanShift: 96 });
    assert.strictEqual(warnings.length, 1, '45s 级断裂必须在扩窗后命中');
    assert.strictEqual(warnings[0].details.time, 45.77);
    // 同一断裂点若正好横跨跨 scene 边界（45.47s），该帧对应跳过，不误报硬切
    const skipped = analyzeAssetFirstStyleDrift(merged, {
      visualStrategy: 'asset_first', maxMeanShift: 96, sceneCutTimes: [45.47],
    });
    assert.deepStrictEqual(skipped, [], '横跨跨 scene 边界 ±0.35s 的帧对跳过');
    // 边界远离突变点时不影响检测
    const farCut = analyzeAssetFirstStyleDrift(merged, {
      visualStrategy: 'asset_first', maxMeanShift: 96, sceneCutTimes: [20],
    });
    assert.strictEqual(farCut.length, 1, '无关边界不得吞掉真实漂移');
  }
  // asset_missing 复用 workflow 级 asset usage 报告（真实结构，R6：无 report.missing）
  {
    const report = {
      status: 'ready',
      assets: [
        { asset_id: 'gen_scene_02', required: true, used: false, used_in_frames: [], expected_in_frames: ['scene_02_b1', 'scene_02_b2'] },
        { asset_id: 'gen_scene_03', required: true, used: true, used_in_frames: ['scene_03_b1'], expected_in_frames: ['scene_03_b1'] },
        { asset_id: 'gen_x', required: true, used: false, used_in_frames: [], expected_in_frames: [] },
      ],
      required_asset_ids: ['gen_scene_02', 'gen_scene_03', 'gen_x'],
      missing_required_asset_ids: ['gen_scene_02', 'gen_x'],
    };
    const warnings = mapAssetUsageToQaWarnings(report, { visualStrategy: 'asset_first' });
    assert.strictEqual(warnings.length, 2);
    const w1 = warnings.find(w => w.details.asset_id === 'gen_scene_02');
    assert.strictEqual(w1.code, 'asset_first_asset_missing');
    assert.deepStrictEqual(w1.details.expected_in_frames, ['scene_02_b1', 'scene_02_b2']);
    assert.strictEqual(w1.details.beat_id, 'scene_02_b1', '定向重试目标取 expected_in_frames 首个');
    const w2 = warnings.find(w => w.details.asset_id === 'gen_x');
    assert.strictEqual(w2.details.beat_id, null, '拿不到 frame 信息时只给 asset_id，不伪造 beat_id（R6）');
    assert.deepStrictEqual(mapAssetUsageToQaWarnings(report, { visualStrategy: 'hf_first' }), []);
  }
  // overlay_caption_overlap 透传 render_decisions[].overlay_check
  {
    const decisions = [
      { beat_id: 'scene_04_b1', overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area', message: 'x' } },
      { beat_id: 'scene_04_b2', overlay_check: { valid: true } },
    ];
    const warnings = mapOverlayChecksToQaWarnings(decisions, { visualStrategy: 'asset_first' });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'asset_first_overlay_caption_overlap');
    assert.strictEqual(warnings[0].details.beat_id, 'scene_04_b1');
    assert.deepStrictEqual(mapOverlayChecksToQaWarnings(decisions, { visualStrategy: 'hf_first' }), []);
    // scene_html 回落展开（stats_scope:'scene'）：同 scene 复制的整场景 overlay_check 只报一条；
    // beat 级（无标记）仍逐条报
    const sceneScoped = [
      { beat_id: 'scene_07_b1', scene_id: 'scene_07', stats_scope: 'scene', overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area' } },
      { beat_id: 'scene_07_b2', scene_id: 'scene_07', stats_scope: 'scene', overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area' } },
      { beat_id: 'scene_08_b1', scene_id: 'scene_08', overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area' } },
      { beat_id: 'scene_08_b2', scene_id: 'scene_08', overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area' } },
    ];
    const dedup = mapOverlayChecksToQaWarnings(sceneScoped, { visualStrategy: 'asset_first' });
    assert.strictEqual(dedup.length, 3, 'scene scope 去重为 1 条 + beat 级 2 条');
    assert.strictEqual(dedup.filter(w => w.details.scene_id === 'scene_07').length, 1);
  }
  // 边界成对采样（P1-7 修正）：pairedSampling 对 same_scene 边界取并集
  // [b-0.3, b, b+0.3, b+0.5, b+1.0]——保留旧安全采样三点（白屏阻断能力不降级），
  // 额外增加 ∓0.3s 差分点；跨 scene 边界保留 [b, b+0.5, b+1.0]；缺省与现状一致
  {
    const project = { frames: [
      { scene_id: 'scene_05', duration_sec: 6.33 },
      { scene_id: 'scene_05', duration_sec: 6.33 },
    ] };
    const paired = projectBoundarySampleGroups(project, 12.66, { pairedSampling: true });
    assert.strictEqual(paired.length, 1);
    assert.deepStrictEqual(paired[0].times, [6.03, 6.33, 6.63, 6.83, 7.33], '成对采样 = 旧安全三点 ∪ ∓0.3s 差分点');
    assert.strictEqual(paired[0].same_scene, true);
    const legacy = projectBoundarySampleGroups(project, 12.66);
    assert.deepStrictEqual(legacy[0].times, [6.33, 6.83, 7.33], '缺省采样与现状完全一致（硬约束 A）');
    // 混合序列：same_scene 边界并集采样，跨 scene 边界维持旧三点采样
    const mixed = projectBoundarySampleGroups({ frames: [
      { scene_id: 'scene_01', duration_sec: 4 },
      { scene_id: 'scene_01', duration_sec: 4 },
      { scene_id: 'scene_02', duration_sec: 4 },
    ] }, 12, { pairedSampling: true });
    assert.strictEqual(mixed.length, 2);
    assert.strictEqual(mixed[0].same_scene, true);
    assert.deepStrictEqual(mixed[0].times, [3.7, 4, 4.3, 4.5, 5], 'same_scene 边界 => 并集采样，含旧安全三点');
    assert.strictEqual(mixed[1].same_scene, false, '跨 scene 边界 same_scene=false');
    assert.deepStrictEqual(mixed[1].times, [8, 8.5, 9], '跨 scene 边界保留旧采样，空白检测不降敏');
    // 语义：边界后 0-0.6s 白屏时，times 必须覆盖 b 与 b+0.5 两个空白检测点（≥2 张空白可命中阻断）
    assert.ok(mixed[0].times.includes(4) && mixed[0].times.includes(4.5) && mixed[0].times.includes(5),
      'same_scene 边界白屏阻断点位（b / b+0.5 / b+1.0）必须保留');
  }
  // P1-7 语义回归：asset_first 成对采样下，same_scene 边界后白屏（b 与 b+0.5 两点空白）
  // 仍能命中 blank_segment_boundary 阻断（issues，而非 warning）
  {
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      project: {
        frames: [
          { id: 'scene_01_b1', scene_id: 'scene_01', duration_sec: 2 },
          { id: 'scene_01_b2', scene_id: 'scene_01', duration_sec: 2 },
        ],
      },
      visualStrategy: 'asset_first',
      expectedAspectRatio: '16:9',
      services: {
        probeVideo: async () => ({ width: 1920, height: 1080, duration: 4 }),
        sampleFrames: async () => [
          { id: 'frame_0', time_sec: 0, average_luma: 90, luma_stddev: 30, edge_score: 18, color_variance: 30, fingerprint: 'a' },
          { id: 'frame_1', time_sec: 0.5, average_luma: 100, luma_stddev: 31, edge_score: 19, color_variance: 31, fingerprint: 'b' },
          { id: 'frame_2', time_sec: 1, average_luma: 110, luma_stddev: 32, edge_score: 20, color_variance: 32, fingerprint: 'c' },
          { id: 'frame_3', time_sec: 1.7, average_luma: 115, luma_stddev: 33, edge_score: 20, color_variance: 33, fingerprint: 'c2' },
          { id: 'frame_4', time_sec: 2, average_luma: 250, luma_stddev: 2, edge_score: 1, color_variance: 1, fingerprint: 'd' },
          { id: 'frame_5', time_sec: 2.5, average_luma: 251, luma_stddev: 2, edge_score: 1, color_variance: 1, fingerprint: 'e' },
          { id: 'frame_6', time_sec: 3, average_luma: 120, luma_stddev: 35, edge_score: 20, color_variance: 35, fingerprint: 'f' },
          { id: 'frame_7', time_sec: 3.5, average_luma: 125, luma_stddev: 36, edge_score: 21, color_variance: 36, fingerprint: 'g' },
        ],
      },
    });
    assert.strictEqual(report.success, false, '边界后白屏必须仍是阻断项');
    assert.ok(report.issues.some(issue => issue.code === 'blank_segment_boundary'),
      'asset_first 成对采样不得吞掉 blank_segment_boundary 阻断');
  }
  // Important 1 修正：新增点位后组内相邻查询间距（0.2/0.3）小于 2×closestFrameAt 容差（0.52），
  // 某点位帧缺失时两个查询可命中同一物理帧——blank 计数必须按帧身份去重，单帧不得满足 ≥2 阻断
  {
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      project: {
        frames: [
          { id: 'scene_01_b1', scene_id: 'scene_01', duration_sec: 2 },
          { id: 'scene_01_b2', scene_id: 'scene_01', duration_sec: 2 },
        ],
      },
      visualStrategy: 'asset_first',
      expectedAspectRatio: '16:9',
      services: {
        probeVideo: async () => ({ width: 1920, height: 1080, duration: 4 }),
        // 采样点位 [1.7, 2, 2.3, 2.5, 3]：2.3 与 2.5 两个查询都最近命中同一张 2.4s 空白帧
        sampleFrames: async () => [
          { id: 'frame_0', time_sec: 0, average_luma: 90, luma_stddev: 30, edge_score: 18, color_variance: 30, fingerprint: 'a' },
          { id: 'frame_1', time_sec: 0.5, average_luma: 100, luma_stddev: 31, edge_score: 19, color_variance: 31, fingerprint: 'b' },
          { id: 'frame_2', time_sec: 1, average_luma: 110, luma_stddev: 32, edge_score: 20, color_variance: 32, fingerprint: 'c' },
          { id: 'frame_3', time_sec: 1.7, average_luma: 115, luma_stddev: 33, edge_score: 20, color_variance: 33, fingerprint: 'c2' },
          { id: 'frame_4', time_sec: 2.4, average_luma: 250, luma_stddev: 2, edge_score: 1, color_variance: 1, fingerprint: 'd' },
          { id: 'frame_5', time_sec: 3, average_luma: 120, luma_stddev: 35, edge_score: 20, color_variance: 35, fingerprint: 'f' },
          { id: 'frame_6', time_sec: 3.5, average_luma: 125, luma_stddev: 36, edge_score: 21, color_variance: 36, fingerprint: 'g' },
        ],
      },
    });
    assert.ok(!report.issues.some(issue => issue.code === 'blank_segment_boundary'),
      '两个查询命中同一物理空白帧只计 1，不得满足 ≥2 阻断');
    assert.strictEqual(report.success, true, '单帧空白不得触发边界阻断');
  }
  // 7.1 Minor 顺手修：before/after 指标非有限值（如缺帧兜底对象）跳过该组，不误报
  {
    const warnings = qa.analyzeAssetFirstBoundaries([
      { scene_id: 'scene_05', boundary_sec: 10, same_scene: true,
        before: { average_luma: NaN, edge_score: 0.3 }, after: { average_luma: 40, edge_score: 0.1 } },
      { scene_id: 'scene_05', boundary_sec: 20, same_scene: true,
        before: { average_luma: 200, edge_score: 0.3 }, after: { average_luma: 40, edge_score: undefined } },
    ], { visualStrategy: 'asset_first', diffThreshold: 0.25 });
    assert.deepStrictEqual(warnings, [], '非有限指标与缺帧同语义：跳过不误报');
  }
  // Important 6：中间层接线 —— 以 asset_first 真实调用 inspectRenderedVideo（注入 probeVideo/sampleFrames），
  // 断言 warnings 汇总进报告且 success 不受影响；同输入 hf_first 时无 warnings 字段
  {
    const assetFirstProject = {
      visual_strategy: 'asset_first',
      frames: [
        { id: 'scene_01_b1', scene_id: 'scene_01', duration_sec: 2, captions: [{ start: 0, end: 1.5, text: '旁白' }] },
        { id: 'scene_02_b1', scene_id: 'scene_02', duration_sec: 2, captions: [] },
      ],
      render_decisions: [
        {
          beat_id: 'scene_01_b1', scene_id: 'scene_01', source_mode: 'raw_html', route_role: 'diagram_motion',
          text_blocks: 1, cards: 0, graphics: 0,
          overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area', message: 'overlay 落入字幕安全区' },
        },
        {
          beat_id: 'scene_02_b1', scene_id: 'scene_02', source_mode: 'raw_html', route_role: 'asset_overlay',
          text_blocks: 5, cards: 1, graphics: 2,
          overlay_check: { valid: true },
        },
      ],
      asset_usage_report: {
        assets: [
          { asset_id: 'gen_scene_02', required: true, used: false, used_in_frames: [], expected_in_frames: ['scene_02_b1'] },
        ],
        required_asset_ids: ['gen_scene_02'],
        missing_required_asset_ids: ['gen_scene_02'],
      },
    };
    const healthySamples = [
      { id: 'frame_0', time_sec: 0, average_luma: 100, luma_stddev: 40, edge_score: 20, color_variance: 30, fingerprint: 'a' },
      { id: 'frame_1', time_sec: 1, average_luma: 110, luma_stddev: 41, edge_score: 21, color_variance: 31, fingerprint: 'b' },
      { id: 'frame_2', time_sec: 2, average_luma: 120, luma_stddev: 42, edge_score: 22, color_variance: 32, fingerprint: 'c' },
      { id: 'frame_3', time_sec: 3, average_luma: 130, luma_stddev: 43, edge_score: 23, color_variance: 33, fingerprint: 'd' },
    ];
    const injectedServices = {
      probeVideo: async () => ({ width: 1080, height: 1920, duration: 4 }),
      sampleFrames: async () => healthySamples,
    };
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      project: assetFirstProject,
      visualStrategy: 'asset_first',
      services: injectedServices,
    });
    assert.strictEqual(report.success, true, 'warnings 不得影响 success');
    assert.deepStrictEqual(report.issues, []);
    const codes = new Set((report.warnings || []).map(w => w.code));
    assert.ok(codes.has('asset_first_asset_missing'), `缺失素材应映射为 warning，实际：${[...codes].join(',')}`);
    assert.ok(codes.has('asset_first_overlay_caption_overlap'), `overlay 越界应映射为 warning，实际：${[...codes].join(',')}`);
    assert.ok(codes.has('asset_first_low_information'), `无图低密度 beat 应映射为 warning，实际：${[...codes].join(',')}`);
    const hfReport = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      project: assetFirstProject,
      visualStrategy: 'hf_first',
      services: injectedServices,
    });
    assert.strictEqual(hfReport.success, true);
    assert.strictEqual(hfReport.warnings, undefined, 'hf_first 报告不得出现 warnings 字段（硬约束 A）');
  }
  console.log('visual qa asset_first density/drift tests passed');

  console.log('visual qa service tests passed');
})();
