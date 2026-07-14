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

  // ===== 模块7：观测通道 QA =====
  const {
    analyzeAssetFirstBoundaries,
    analyzeAssetFirstCaptionRegion,
    attachAssetFirstWarnings,
  } = require('../server/services/creative-video/visualQaService');

  // 1) 边界重刷：同 scene 相邻条目边界前后成对采样差分（真实指标字段 average_luma / edge_score）
  {
    const boundaryGroups = [
      { scene_id: 'scene_05', boundary_sec: 69.71, same_scene: true,
        before: { average_luma: 158, edge_score: 0.31 }, after: { average_luma: 46, edge_score: 0.05 } },
      { scene_id: 'scene_05', boundary_sec: 76.04, same_scene: true,
        before: { average_luma: 153, edge_score: 0.30 }, after: { average_luma: 150, edge_score: 0.29 } },
      { scene_id: 'x', boundary_sec: 12.75, same_scene: false,
        before: { average_luma: 230, edge_score: 0.9 }, after: { average_luma: 25, edge_score: 0.1 } },
    ];
    const warnings = analyzeAssetFirstBoundaries(boundaryGroups, { diffThreshold: 0.25 });
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
    ], { diffThreshold: 0.25 });
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
    const warnings = analyzeAssetFirstCaptionRegion(frames, { minVariance: 0.01 });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'asset_first_caption_invisible');
  }

  // 3) QA warning 双向断言：warnings 不改变 success/issues；空 warnings 不加字段
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
    const warnings = analyzeAssetFirstInformation(beatsInfo, { minElements: 3 });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'asset_first_low_information');
    assert.strictEqual(warnings[0].details.beat_id, 'scene_04_b1');
    // P2-3(b)：scene_html 回落展开把整 scene 统计复制到每 beat（stats_scope:'scene'），
    // 低信息告警按 scene 去重只报一条，message 说明是 scene 级聚合观察；beat 级仍逐条报
    const sceneScoped = [
      { beat_id: 'scene_06_b1', scene_id: 'scene_06', stats_scope: 'scene', has_asset: false, text_blocks: 1, cards: 0, graphics: 0 },
      { beat_id: 'scene_06_b2', scene_id: 'scene_06', stats_scope: 'scene', has_asset: false, text_blocks: 1, cards: 0, graphics: 0 },
      { beat_id: 'scene_07_b1', has_asset: false, text_blocks: 0, cards: 0, graphics: 0 },
    ];
    const dedupInfo = analyzeAssetFirstInformation(sceneScoped, { minElements: 3 });
    assert.strictEqual(dedupInfo.length, 2, 'scene scope 去重为 1 条 + beat 级 1 条');
    const sceneWarning = dedupInfo.find(w => w.details.scene_id === 'scene_06');
    assert.ok(sceneWarning, 'scene 级告警必须带 scene_id');
    assert.strictEqual(sceneWarning.details.stats_scope, 'scene');
    assert.ok(sceneWarning.message.includes('scene 级聚合'), 'message 必须说明是 scene 级聚合观察');
  }
  // 风格漂移：帧平均色序列突变 => warning
  {
    const frames = [
      { time: 1, mean_rgb: [220, 220, 215] }, { time: 30, mean_rgb: [222, 219, 214] },
      { time: 47, mean_rgb: [10, 10, 12] },   { time: 60, mean_rgb: [12, 9, 10] },
    ];
    const warnings = analyzeAssetFirstStyleDrift(frames, { maxMeanShift: 96 });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'asset_first_style_drift');
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
    const warnings = analyzeAssetFirstStyleDrift(merged, { maxMeanShift: 96 });
    assert.strictEqual(warnings.length, 1, '45s 级断裂必须在扩窗后命中');
    assert.strictEqual(warnings[0].details.time, 45.77);
    // 同一断裂点若正好横跨跨 scene 边界（45.47s），该帧对应跳过，不误报硬切
    const skipped = analyzeAssetFirstStyleDrift(merged, {
      maxMeanShift: 96, sceneCutTimes: [45.47],
    });
    assert.deepStrictEqual(skipped, [], '横跨跨 scene 边界 ±0.35s 的帧对跳过');
    // 边界远离突变点时不影响检测
    const farCut = analyzeAssetFirstStyleDrift(merged, {
      maxMeanShift: 96, sceneCutTimes: [20],
    });
    assert.strictEqual(farCut.length, 1, '无关边界不得吞掉真实漂移');
  }
  // asset_missing 复用 workflow 级 asset usage 报告（真实结构，R6：无 report.missing）。
  // review P2-6 契约变更：生产端 expected_in_frames 实际写的是 scene_id（见 htmlVideoWorkflow
  // asset usage 报告构造），映射层按真实语义暴露 details.scene_id，不再把它伪装成 beat_id（恒 null）。
  {
    const report = {
      status: 'ready',
      assets: [
        { asset_id: 'gen_scene_02', required: true, used: false, used_in_frames: [], expected_in_frames: ['scene_02'] },
        { asset_id: 'gen_scene_03', required: true, used: true, used_in_frames: ['scene_03_b1'], expected_in_frames: ['scene_03'] },
        { asset_id: 'gen_x', required: true, used: false, used_in_frames: [], expected_in_frames: [] },
      ],
      required_asset_ids: ['gen_scene_02', 'gen_scene_03', 'gen_x'],
      missing_required_asset_ids: ['gen_scene_02', 'gen_x'],
    };
    const warnings = mapAssetUsageToQaWarnings(report);
    assert.strictEqual(warnings.length, 2);
    const w1 = warnings.find(w => w.details.asset_id === 'gen_scene_02');
    assert.strictEqual(w1.code, 'asset_first_asset_missing');
    assert.deepStrictEqual(w1.details.expected_in_frames, ['scene_02']);
    assert.strictEqual(w1.details.scene_id, 'scene_02', 'expected_in_frames 首个按真实语义放 scene_id');
    assert.strictEqual(w1.details.beat_id, null, '不得把 scene_id 伪装成 beat_id（P2-6）');
    const w2 = warnings.find(w => w.details.asset_id === 'gen_x');
    assert.strictEqual(w2.details.scene_id, null, '拿不到 frame 信息时只给 asset_id，不伪造 scene_id');
    assert.strictEqual(w2.details.beat_id, null);
  }
  // overlay_caption_overlap 透传 render_decisions[].overlay_check
  {
    const decisions = [
      { beat_id: 'scene_04_b1', overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area', message: 'x' } },
      { beat_id: 'scene_04_b2', overlay_check: { valid: true } },
    ];
    const warnings = mapOverlayChecksToQaWarnings(decisions);
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'asset_first_overlay_caption_overlap');
    assert.strictEqual(warnings[0].details.beat_id, 'scene_04_b1');
    // 静态无法确认的定位值也必须进入成功任务的 visual_inspect.warnings，而不是只留在 gate diagnostics
    const indeterminate = mapOverlayChecksToQaWarnings([{
      beat_id: 'scene_04_b3',
      overlay_check: {
        valid: true,
        indeterminate: true,
        message: 'overlay 定位值无法静态确认安全区合规（bottom:5%），请人工复核',
        details: { indeterminate_props: ['bottom'] },
      },
    }]);
    assert.strictEqual(indeterminate.length, 1);
    assert.strictEqual(indeterminate[0].code, 'asset_first_overlay_position_indeterminate');
    assert.strictEqual(indeterminate[0].details.beat_id, 'scene_04_b3');
    assert.match(indeterminate[0].message, /人工复核/);
    // P2-7：scene_html 下整 scene stats 复制导致 decision.beat_id 是首个 beat，
    // 真实越界 beat 在 overlay_check.details.beat_scope——scene 级条目 beat_id 必须用 beat_scope，
    // 并结构化透出 details.overlay_beat_scope；beat 级条目维持 decision.beat_id
    {
      const scoped = [
        { beat_id: 'b1', scene_id: 'scene_09', stats_scope: 'scene',
          overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area', message: 'x（beat：b2）', details: { beat_scope: 'b2' } } },
        { beat_id: 'b2', scene_id: 'scene_09', stats_scope: 'scene',
          overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area', message: 'x（beat：b2）', details: { beat_scope: 'b2' } } },
        { beat_id: 'scene_10_b1', scene_id: 'scene_10',
          overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area', message: 'y', details: { beat_scope: 'scene_10_b1' } } },
      ];
      const scopedWarnings = mapOverlayChecksToQaWarnings(scoped);
      assert.strictEqual(scopedWarnings.length, 2);
      const sceneWarning = scopedWarnings.find(w => w.details.scene_id === 'scene_09');
      assert.strictEqual(sceneWarning.details.beat_id, 'b2', 'scene 级条目 beat_id 必须定位真实越界 beat（beat_scope）');
      assert.strictEqual(sceneWarning.details.overlay_beat_scope, 'b2');
      const beatWarning = scopedWarnings.find(w => !w.details.stats_scope);
      assert.strictEqual(beatWarning.details.beat_id, 'scene_10_b1', 'beat 级条目维持 decision.beat_id');
      // overlay_check 无 details（旧数据）时 scene 级 beat_id 置 null，不伪造首个 beat
      const legacyScoped = mapOverlayChecksToQaWarnings([
        { beat_id: 'b1', scene_id: 'scene_11', stats_scope: 'scene',
          overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area', message: 'z' } },
      ]);
      assert.strictEqual(legacyScoped[0].details.beat_id, null, '无 beat_scope 时不伪造 beat_id');
      // 去重键纳入 beat_scope：同 scene 两个不同越界 beat 的 scene 级条目必须各报一条
      const multiBeat = mapOverlayChecksToQaWarnings([
        { beat_id: 'b1', scene_id: 'scene_12', stats_scope: 'scene',
          overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area', message: 'x', details: { beat_scope: 'b1' } } },
        { beat_id: 'b2', scene_id: 'scene_12', stats_scope: 'scene',
          overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area', message: 'y', details: { beat_scope: 'b2' } } },
      ]);
      assert.strictEqual(multiBeat.length, 2, '同 scene 不同 beat_scope 不得被去重吞掉');
      assert.deepStrictEqual(multiBeat.map(w => w.details.beat_id).sort(), ['b1', 'b2']);
      // 摘要投影保留 overlay_beat_scope 定位字段
      const { summarizeVisualQaWarnings } = require('../server/services/creative-video/visualQaCodes');
      const summary = summarizeVisualQaWarnings(scopedWarnings);
      assert.strictEqual(summary.find(w => w.details?.scene_id === 'scene_09').details.overlay_beat_scope, 'b2',
        '摘要必须保留 overlay_beat_scope');
    }
    // scene_html 回落展开（stats_scope:'scene'）：同 scene 复制的整场景 overlay_check 只报一条；
    // beat 级（无标记）仍逐条报
    const sceneScoped = [
      { beat_id: 'scene_07_b1', scene_id: 'scene_07', stats_scope: 'scene', overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area' } },
      { beat_id: 'scene_07_b2', scene_id: 'scene_07', stats_scope: 'scene', overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area' } },
      { beat_id: 'scene_08_b1', scene_id: 'scene_08', overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area' } },
      { beat_id: 'scene_08_b2', scene_id: 'scene_08', overlay_check: { valid: false, reason_code: 'overlay_in_caption_safe_area' } },
    ];
    const dedup = mapOverlayChecksToQaWarnings(sceneScoped);
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
    // P2-3(c)：scene_html 单 frame 的内部 beat 边界（metadata.beat_windows 相接处）
    // 在 pairedSampling 下按 same_scene=true 边界产出采样组（排除最后一个 window 末尾）
    const sceneFrameProject = { frames: [
      {
        id: 'scene:scene_05', scene_id: 'scene_05', duration_sec: 12.66,
        metadata: { beat_windows: [
          { id: 'scene_05_b1', start_sec: 0, end_sec: 6.33 },
          { id: 'scene_05_b2', start_sec: 6.33, end_sec: 12.66 },
        ] },
      },
    ] };
    const internal = projectBoundarySampleGroups(sceneFrameProject, 12.66, { pairedSampling: true });
    assert.strictEqual(internal.length, 1, '两个 beat_windows => 1 个内部边界组（末尾窗口不产出）');
    assert.strictEqual(internal[0].same_scene, true);
    assert.strictEqual(internal[0].scene_id, 'scene_05');
    assert.strictEqual(internal[0].boundary_sec, 6.33);
    assert.deepStrictEqual(internal[0].times, [6.03, 6.33, 6.63, 6.83, 7.33], '内部边界用与 same_scene 相同的 5 点并集');
    // 缺省（不传 pairedSampling）不产出内部边界
    assert.deepStrictEqual(projectBoundarySampleGroups(sceneFrameProject, 12.66), [], '缺省不产出内部边界（硬约束 A）');
    // beat_mp4 帧无 beat_windows：pairedSampling 下行为不变
    const noWindows = projectBoundarySampleGroups({ frames: [
      { scene_id: 'scene_05', duration_sec: 6.33 },
      { scene_id: 'scene_05', duration_sec: 6.33 },
    ] }, 12.66, { pairedSampling: true });
    assert.strictEqual(noWindows.length, 1);
    assert.deepStrictEqual(noWindows[0].times, [6.03, 6.33, 6.63, 6.83, 7.33]);
    // P2-3：成对采样组结构拆分——safety_times 只含旧安全三点（白屏阻断口径），
    // diff_times 只含 ∓0.3s 差分点，times 保留并集供抽帧计划
    assert.deepStrictEqual(paired[0].safety_times, [6.33, 6.83, 7.33], 'safety_times = 旧安全三点');
    assert.deepStrictEqual(paired[0].diff_times, [6.03, 6.63], 'diff_times = ∓0.3s 差分点');
    assert.deepStrictEqual(internal[0].safety_times, [6.33, 6.83, 7.33], '内部 beat 边界组同样拆分');
    assert.deepStrictEqual(internal[0].diff_times, [6.03, 6.63]);
    assert.strictEqual(legacy[0].safety_times, undefined, '缺省路径不加新字段（逐值行为不变）');
    assert.strictEqual(mixed[1].safety_times, undefined, '跨 scene 边界组不加新字段');
    // 锁住派生关系：成对边界组 times 严格等于 safety_times ∪ diff_times 的去重排序并集
    for (const group of [paired[0], mixed[0], internal[0], noWindows[0]]) {
      const union = [...new Set([...group.safety_times, ...group.diff_times])].sort((a, b) => a - b);
      assert.deepStrictEqual(group.times, union, 'times 必须是 safety_times ∪ diff_times 去重排序并集');
    }
  }
  // P2-3：白屏阻断口径只看安全点——安全点仅 1 张空白 + 差分点 2 张空白时不得阻断
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
      expectedAspectRatio: '16:9',
      services: {
        probeVideo: async () => ({ width: 1920, height: 1080, duration: 4 }),
        // 边界 2s：安全点 [2, 2.5, 3] 仅 2s 一张空白；差分点 [1.7, 2.3] 均空白。
        // 原口径（遍历全部 5 点）会数出 3 张空白误升级阻断；新口径只看安全点 => 不阻断
        sampleFrames: async () => [
          { id: 'frame_0', time_sec: 0, average_luma: 90, luma_stddev: 30, edge_score: 18, color_variance: 30, fingerprint: 'a' },
          { id: 'frame_1', time_sec: 0.5, average_luma: 100, luma_stddev: 31, edge_score: 19, color_variance: 31, fingerprint: 'b' },
          { id: 'frame_2', time_sec: 1, average_luma: 110, luma_stddev: 32, edge_score: 20, color_variance: 32, fingerprint: 'c' },
          { id: 'frame_2b', time_sec: 1.2, average_luma: 112, luma_stddev: 32, edge_score: 20, color_variance: 32, fingerprint: 'c1' },
          { id: 'frame_3', time_sec: 1.7, average_luma: 250, luma_stddev: 2, edge_score: 1, color_variance: 1, fingerprint: 'd' },
          { id: 'frame_4', time_sec: 2, average_luma: 251, luma_stddev: 2, edge_score: 1, color_variance: 1, fingerprint: 'e' },
          { id: 'frame_5', time_sec: 2.3, average_luma: 252, luma_stddev: 2, edge_score: 1, color_variance: 1, fingerprint: 'f' },
          { id: 'frame_6', time_sec: 2.5, average_luma: 120, luma_stddev: 33, edge_score: 20, color_variance: 33, fingerprint: 'g' },
          { id: 'frame_7', time_sec: 3, average_luma: 125, luma_stddev: 34, edge_score: 21, color_variance: 34, fingerprint: 'h' },
          { id: 'frame_8', time_sec: 3.5, average_luma: 130, luma_stddev: 35, edge_score: 22, color_variance: 35, fingerprint: 'i' },
          { id: 'frame_9', time_sec: 3.8, average_luma: 135, luma_stddev: 36, edge_score: 23, color_variance: 36, fingerprint: 'j' },
        ],
      },
    });
    assert.ok(!report.issues.some(issue => issue.code === 'blank_segment_boundary'),
      '差分专用采样点不得参与白屏阻断计数（安全点仅 1 张空白）');
    assert.strictEqual(report.success, true);
  }
  // P2-4：asset_first 下 style 观测采样点必须覆盖全片——60s 无边界 project 补均匀观测点
  {
    const { buildTimedSamplePlan } = require('../server/services/creative-video/visualQaService');
    const longProject = { frames: [{ id: 'scene:scene_01', scene_id: 'scene_01', duration_sec: 60 }] };
    const plan = buildTimedSamplePlan({
      project: longProject,
      videoInfo: { width: 1080, height: 1920, duration: 60 },
      pairedBoundarySampling: true,
    });
    assert.strictEqual(plan.boundaryGroups.length, 0, '单 scene 单帧无边界组');
    const lateTimes = plan.times.filter(time => time > 12);
    assert.ok(lateTimes.length >= 5, `11.5s 后必须有观测点，实际 ${JSON.stringify(plan.times)}`);
    assert.ok(plan.times.some(time => time > 48), '观测点需覆盖片尾段');
    assert.ok(plan.times.length <= 120, '共用 MAX_TIMED_SAMPLES 预算');
    // 缺省（非 pairedBoundarySampling / safetyOnly）不补观测点：times 仅 opening 三点，行为不变
    const defaultPlan = buildTimedSamplePlan({
      project: longProject,
      videoInfo: { width: 1080, height: 1920, duration: 60 },
    });
    assert.deepStrictEqual(defaultPlan.times, [0, 0.5, 1.0], '缺省路径采样点逐值不变（硬约束 A）');
  }
  // P2-4：生产链路——采样请求携带全片观测点，45s 突变可被 style_drift 检出
  {
    const sampleRequests = [];
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      project: { frames: [{ id: 'scene:scene_01', scene_id: 'scene_01', duration_sec: 60 }] },
      services: {
        probeVideo: async () => ({ width: 1080, height: 1920, duration: 60 }),
        sampleFrames: async (request) => {
          sampleRequests.push(request);
          const times = Array.isArray(request.times) && request.times.length
            ? request.times
            : [0, 0.5, 1.0];
          return times.map((time, index) => ({
            id: `frame_${index}`,
            time_sec: time,
            average_luma: 120,
            luma_stddev: 40,
            edge_score: 20,
            color_variance: 30,
            fingerprint: `fp_${index}`,
            mean_rgb: time >= 45 ? [10, 10, 12] : [220, 220, 215],
          }));
        },
      },
    });
    assert.ok(sampleRequests[0] && Array.isArray(sampleRequests[0].times), 'sampleFrames 必须收到生产采样计划 times');
    assert.ok(sampleRequests[0].times.some(time => time > 12), '采样请求必须含 11.5s 之后的观测点');
    assert.strictEqual(report.success, true);
    assert.ok((report.warnings || []).some(w => w.code === 'asset_first_style_drift'),
      '45s 级风格断裂必须经生产采样计划检出');
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
    ], { diffThreshold: 0.25 });
    assert.deepStrictEqual(warnings, [], '非有限指标与缺帧同语义：跳过不误报');
  }
  // Important 6：中间层接线 —— 真实调用 inspectRenderedVideo（注入 probeVideo/sampleFrames），
  // 断言 warnings 汇总进报告且 success 不受影响；safetyOnly 时无 warnings 字段
  {
    const assetFirstProject = {
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
      services: injectedServices,
    });
    assert.strictEqual(report.success, true, 'warnings 不得影响 success');
    assert.deepStrictEqual(report.issues, []);
    const codes = new Set((report.warnings || []).map(w => w.code));
    assert.ok(codes.has('asset_first_asset_missing'), `缺失素材应映射为 warning，实际：${[...codes].join(',')}`);
    assert.ok(codes.has('asset_first_overlay_caption_overlap'), `overlay 越界应映射为 warning，实际：${[...codes].join(',')}`);
    assert.ok(codes.has('asset_first_low_information'), `无图低密度 beat 应映射为 warning，实际：${[...codes].join(',')}`);
    const safetyOnlyReport = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      project: assetFirstProject,
      safetyOnly: true,
      services: injectedServices,
    });
    assert.strictEqual(safetyOnlyReport.success, true);
    assert.strictEqual(safetyOnlyReport.warnings, undefined, 'safetyOnly 报告不得出现 warnings 字段（硬约束 A）');
  }
  // Finding 2（P2）：style observation 固定预留预算 + boundary 预算按全局唯一时间点计数
  // 探针 1：30×5s 同 scene 帧（150s）——旧逻辑 boundaryGroups 23/29 截断、observation 只到 37.5s，
  // 最后 34s 无观测。修复后 observation 必须覆盖尾段（预留 OBSERVATION_RESERVE=7）。
  {
    const { buildTimedSamplePlan } = require('../server/services/creative-video/visualQaService');
    const project = { frames: Array.from({ length: 30 }, (_, i) => ({
      id: `scene_01_b${i}`, scene_id: 'scene_01', duration_sec: 5,
    })) };
    const plan = buildTimedSamplePlan({
      project,
      videoInfo: { width: 1080, height: 1920, duration: 150 },
      pairedBoundarySampling: true,
    });
    assert.ok(plan.times.length <= 120, '共用 MAX_TIMED_SAMPLES 预算');
    assert.ok(plan.observation.length > 0, 'observation 必须有预留配额，不得被 boundary 组耗尽');
    assert.ok(Math.max(...plan.observation) >= (150 * 7) / 8 - 0.001,
      `observation 必须覆盖片尾段（≥131.25s），实际 ${JSON.stringify(plan.observation)}`);
    assert.ok(plan.times.some(time => time > 120),
      `最后 30s 必须有采样观测点，实际最大 ${Math.max(...plan.times)}`);
  }
  // 探针 2：60s scene_html + 80 个 0.1s 密集 beat window——旧逻辑相邻组采样点大量重复
  // 却按 group.times.length 重复扣预算：23 组即"耗尽"但唯一 times 只有 ~35 个、observation=[]。
  // 修复后预算按全局唯一时间点计数：全部 79 组纳入且 observation 非空含尾段点。
  {
    const { buildTimedSamplePlan } = require('../server/services/creative-video/visualQaService');
    const windows = Array.from({ length: 80 }, (_, i) => ({
      id: `scene_01_b${i}`,
      start_sec: Math.round(i * 0.1 * 1000) / 1000,
      end_sec: Math.round((i + 1) * 0.1 * 1000) / 1000,
    }));
    const project = { frames: [{
      id: 'scene:scene_01', scene_id: 'scene_01', duration_sec: 60,
      metadata: { beat_windows: windows },
    }] };
    const plan = buildTimedSamplePlan({
      project,
      videoInfo: { width: 1080, height: 1920, duration: 60 },
      pairedBoundarySampling: true,
    });
    assert.strictEqual(plan.total_boundary_count, 79);
    assert.ok(plan.sampled_boundary_count > 23,
      `唯一时间点计费后纳入组数必须显著大于旧逻辑的 23，实际 ${plan.sampled_boundary_count}`);
    assert.strictEqual(plan.sampled_boundary_count, 79, '密集重叠组全部可纳入（唯一点仅 ~89 个）');
    assert.ok(plan.observation.length > 0, '预算不再被重复计费虚耗，observation 非空');
    assert.ok(plan.observation.some(time => time > 48), 'observation 含尾段点');
    assert.ok(plan.times.length <= 120, '唯一采样点总量仍受 MAX_TIMED_SAMPLES 封顶');
    // 缺省路径逐值回归：同 project 不开 pairedBoundarySampling 时无内部边界组、无 observation
    const defaultPlan = buildTimedSamplePlan({
      project,
      videoInfo: { width: 1080, height: 1920, duration: 60 },
    });
    assert.deepStrictEqual(defaultPlan.times, [0, 0.5, 1.0], '缺省路径采样点逐值不变（硬约束 A）');
    assert.deepStrictEqual(defaultPlan.observation, []);
  }
  // Finding 3（P2）：sceneCutTimes 与截断后的采样组解耦——从 project.frames 完整推导
  {
    const { sceneCutTimesFromProject } = require('../server/services/creative-video/visualQaService');
    assert.strictEqual(typeof sceneCutTimesFromProject, 'function', '必须导出 sceneCutTimesFromProject');
    // 基本：scene1 20s + scene2 80s => 唯一 cut = 20
    const cuts = sceneCutTimesFromProject({ frames: [
      { id: 'scene:scene_01', scene_id: 'scene_01', duration_sec: 20 },
      { id: 'scene:scene_02', scene_id: 'scene_02', duration_sec: 80 },
    ] });
    assert.deepStrictEqual(cuts, [20], '相邻帧 scene_id 不同处产出 cut');
    // 同 scene 内部边界不是 cut；scene_html 内部 beat 边界（同 frame）天然不产出
    const sameScene = sceneCutTimesFromProject({ frames: [
      { id: 'scene_01_b1', scene_id: 'scene_01', duration_sec: 2 },
      { id: 'scene_01_b2', scene_id: 'scene_01', duration_sec: 2 },
      { id: 'scene:scene_02', scene_id: 'scene_02', duration_sec: 6,
        metadata: { beat_windows: [{ end_sec: 3 }, { end_sec: 6 }] } },
    ] });
    assert.deepStrictEqual(sameScene, [4], '同 scene 边界与 frame 内部 beat 边界不进 cut 列表');
    // 无效时长帧跳过（与 projectBoundarySampleGroups 帧时长口径一致）
    assert.deepStrictEqual(sceneCutTimesFromProject({ frames: [
      { scene_id: 'scene_01', durationSec: 20 },
      { scene_id: 'scene_02', duration_sec: 0 },
      { scene_id: 'scene_02', duration_sec: 80 },
    ] }), [20], 'durationSec 回退与无效时长跳过同口径');
    assert.deepStrictEqual(sceneCutTimesFromProject({ frames: [
      { scene_id: 'scene_01', duration_sec: -1, durationSec: 20 },
      { scene_id: 'scene_02', duration_sec: 80 },
    ] }), [20], '无效 duration_sec 不得阻断有效 durationSec 回退');
  }
  // Finding 3 接线：scene1(20s 密集 beat 耗尽预算) + scene2(80s)——真实 cut=20s 即使
  // boundaryGroups 截断也必须豁免 20s 硬切，同时远处真实漂移仍报
  {
    const windows = Array.from({ length: 200 }, (_, i) => ({
      id: `scene_01_b${i}`,
      start_sec: Math.round(i * 0.1 * 1000) / 1000,
      end_sec: Math.round((i + 1) * 0.1 * 1000) / 1000,
    }));
    const project = {
      frames: [
        { id: 'scene:scene_01', scene_id: 'scene_01', duration_sec: 20,
          metadata: { beat_windows: windows } },
        { id: 'scene:scene_02', scene_id: 'scene_02', duration_sec: 80 },
      ],
    };
    const meanRgbAt = time => {
      if (time < 20) return [220, 220, 215]; // scene_01 亮色
      if (time < 70) return [10, 10, 12]; // scene_02 前段暗色（20s 硬切合法）
      return [220, 220, 215]; // 70s 附近真实漂移（无 scene cut）
    };
    const report = await qa.inspectRenderedVideo({
      projectDir,
      outputPath,
      project,
      services: {
        probeVideo: async () => ({ width: 1080, height: 1920, duration: 100 }),
        sampleFrames: async (request) => (request.times || []).map((time, index) => ({
          id: `frame_${index}`,
          time_sec: time,
          average_luma: 100 + (index % 40),
          luma_stddev: 40,
          edge_score: 20,
          color_variance: 30,
          fingerprint: `fp_${index}`,
          mean_rgb: meanRgbAt(time),
        })),
      },
    });
    // 采样计划验证：密集 beat 确实截断了 boundaryGroups（20s 跨 scene 组不在采样组里）
    const { buildTimedSamplePlan } = require('../server/services/creative-video/visualQaService');
    const plan = buildTimedSamplePlan({
      project,
      videoInfo: { width: 1080, height: 1920, duration: 100 },
      pairedBoundarySampling: true,
    });
    assert.ok(plan.sampled_boundary_count < plan.total_boundary_count, '前置条件：boundaryGroups 已截断');
    assert.ok(!plan.boundaryGroups.some(group => group.same_scene !== true),
      '前置条件：20s 跨 scene 组已被截断挤出采样组');
    const drifts = (report.warnings || []).filter(w => w.code === 'asset_first_style_drift');
    assert.strictEqual(drifts.length, 1, `远处真实漂移（70s 附近）必须仍报，实际 ${JSON.stringify(drifts)}`);
    assert.ok(Number(drifts[0].details.time) > 60,
      `20s 合法跨 scene 硬切不得误报 style_drift，报警点应在 70s 附近，实际 ${drifts[0].details.time}`);
  }
  console.log('visual qa asset_first density/drift tests passed');

  // Finding 3（P3）：videoInfo.duration 缺失时 observation 不得失效
  {
    const { buildTimedSamplePlan } = require('../server/services/creative-video/visualQaService');
    // review 探针：ffprobe 未取到 duration（仅 fps）——用 frames duration_sec 总和兜底
    const plan = buildTimedSamplePlan({
      project: { frames: [{ scene_id: 'scene_01', duration_sec: 60 }] },
      videoInfo: { fps: 30 },
      pairedBoundarySampling: true,
    });
    assert.ok(plan.observation.length > 0,
      `duration 缺失时 observation 必须用 frames 时长兜底，实际 ${JSON.stringify(plan.observation)}`);
    assert.ok(Math.max(...plan.observation) >= (60 * 7) / 8 - 0.001,
      `observation 必须覆盖尾段（≥52.5s），实际 ${JSON.stringify(plan.observation)}`);
    assert.ok(plan.observation.every(time => time < 60), '兜底时长下采样点不得越过片尾');
    // 负的有限 probe duration 同样无效：opening / boundary / observation 必须共用帧时长兜底
    const negativeDurationPlan = buildTimedSamplePlan({
      project: { frames: [{ scene_id: 'scene_01', duration_sec: 60 }] },
      videoInfo: { fps: 30, duration: -1 },
      pairedBoundarySampling: true,
    });
    assert.deepStrictEqual(
      negativeDurationPlan.opening,
      [0, 0.5, 1],
      '负 duration 不得清空开头白屏安全采样点',
    );
    assert.deepStrictEqual(
      negativeDurationPlan.observation,
      plan.observation,
      '负 duration 必须与缺失 duration 使用同一个有效时长口径',
    );
    const boundaryProject = { frames: [
      { scene_id: 'scene_01', duration_sec: -1, durationSec: 1 },
      { scene_id: 'scene_01', duration_sec: 1 },
    ] };
    const boundaryPlanOptions = {
      project: boundaryProject,
      pairedBoundarySampling: true,
    };
    const missingBoundaryDuration = buildTimedSamplePlan({
      ...boundaryPlanOptions,
      videoInfo: { fps: 30 },
    });
    const negativeBoundaryDuration = buildTimedSamplePlan({
      ...boundaryPlanOptions,
      videoInfo: { fps: 30, duration: -1 },
    });
    const validBoundaryDuration = buildTimedSamplePlan({
      ...boundaryPlanOptions,
      videoInfo: { fps: 30, duration: 2 },
    });
    assert.strictEqual(missingBoundaryDuration.boundaryGroups.length, 1,
      'duration_sec 无效但 durationSec 有效的相邻帧仍应产出 boundary group');
    assert.deepStrictEqual(negativeBoundaryDuration.boundaryGroups, missingBoundaryDuration.boundaryGroups,
      '负 duration 与缺失 duration 的 boundary 采样必须使用同一帧时长兜底');
    assert.deepStrictEqual(validBoundaryDuration.boundaryGroups, missingBoundaryDuration.boundaryGroups,
      '帧时长兜底与有效 probe duration 的 boundary 采样必须一致');
    assert.ok(negativeBoundaryDuration.times.every(time => time < 2),
      `负 duration 兜底后的采样点不得越过有效总时长，实际 ${JSON.stringify(negativeBoundaryDuration.times)}`);
    // 兜底链：durationSec 回退 + 无效值跳过
    const fallbackChain = buildTimedSamplePlan({
      project: { frames: [
        { scene_id: 'scene_01', durationSec: 30 },
        { scene_id: 'scene_01', duration_sec: -1, durationSec: 30 },
        { scene_id: 'scene_01', duration_sec: 30 },
      ] },
      videoInfo: {},
      pairedBoundarySampling: true,
    });
    assert.ok(fallbackChain.observation.length > 0, 'durationSec 回退链同样生效');
    assert.ok(Math.max(...fallbackChain.observation) >= (90 * 7) / 8 - 0.001,
      `无效 duration_sec 后必须继续回退 durationSec，兜底时长应为 90s，实际 ${JSON.stringify(fallbackChain.observation)}`);
    // duration 与 frames 都无效：observation 空且不抛错（维持现状）
    const emptyPlan = buildTimedSamplePlan({
      project: { frames: [{ scene_id: 'scene_01' }] },
      videoInfo: { fps: 30 },
      pairedBoundarySampling: true,
    });
    assert.deepStrictEqual(emptyPlan.observation, [], 'duration 与 frames 时长都无效时 observation 保持为空');
    // videoInfo.duration 有效时兜底不介入（与探针 1 等价输入回归）
    const withDuration = buildTimedSamplePlan({
      project: { frames: [{ scene_id: 'scene_01', duration_sec: 60 }] },
      videoInfo: { fps: 30, duration: 60 },
      pairedBoundarySampling: true,
    });
    assert.deepStrictEqual(plan.observation, withDuration.observation, '兜底结果与真实 duration 一致');
  }
  // Finding 3（P3）双保险：probeVideo 同时读 format=duration，stream 优先、format 兜底
  {
    const { probeVideo } = require('../server/services/creative-video/visualQaService');
    assert.strictEqual(typeof probeVideo, 'function', '必须导出 probeVideo 供单测');
    const makeRunCommand = payload => async (command, args) => {
      // ffprobe 命令必须请求 format 段的 duration
      const entries = args[args.indexOf('-show_entries') + 1];
      assert.ok(/format\s*=\s*duration|format=duration/.test(entries),
        `ffprobe -show_entries 必须包含 format=duration，实际 ${entries}`);
      return { ok: true, stdout: JSON.stringify(payload), stderr: '' };
    };
    // stream.duration 缺失（如 mkv/webm 容器）→ 取 format.duration
    const fromFormat = await probeVideo({
      videoPath: 'x.mp4',
      runCommand: makeRunCommand({
        streams: [{ width: 1080, height: 1920, avg_frame_rate: '30/1' }],
        format: { duration: '83.6' },
      }),
    });
    assert.strictEqual(fromFormat.duration, 83.6, 'stream 无 duration 时必须回退 format.duration');
    assert.strictEqual(fromFormat.fps, 30);
    // stream.duration 存在 → 优先 stream
    const fromStream = await probeVideo({
      videoPath: 'x.mp4',
      runCommand: makeRunCommand({
        streams: [{ width: 1080, height: 1920, duration: '10.0', avg_frame_rate: '30/1' }],
        format: { duration: '20.0' },
      }),
    });
    assert.strictEqual(fromStream.duration, 10, 'stream.duration 必须优先于 format.duration');
    // stream.duration 为负数时无效，不得抢占有效的 format.duration
    const negativeStream = await probeVideo({
      videoPath: 'x.mp4',
      runCommand: makeRunCommand({
        streams: [{ width: 1080, height: 1920, duration: '-1', avg_frame_rate: '30/1' }],
        format: { duration: '20.0' },
      }),
    });
    assert.strictEqual(negativeStream.duration, 20, '负的 stream.duration 必须回退 format.duration');
  }
  console.log('visual qa duration fallback tests passed');

  console.log('visual qa service tests passed');
})();
