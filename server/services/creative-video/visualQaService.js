const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { runCommand: defaultRunCommand } = require('../hyperframes/hyperframesRenderer');
// caption 活跃窗口与 sfxEventService.buildVoiceWindowsFromProject 同口径（帧起点累计偏移 + 毫秒取整）。
// 直接复用该实现：sfxEventService 仅依赖 projectStore/projectSchema/sfxLibrary，与本模块无 require 环。
const { buildVoiceWindowsFromProject } = require('./html-video/sfxEventService');
const {
  analyzeFrameMetrics,
  isBlankFrameMetric,
  projectBoundarySampleGroups,
  sceneCutTimesFromProject,
  buildTimedSamplePlan,
  extractTimedFrameMetrics,
  probeVideo,
  extractRawFrameMetrics,
  createContactSheet,
} = require('./frameSampling');
const {
  analyzeTimedSafetyMetrics,
  analyzeAssetFirstBoundaries,
  analyzeAssetFirstCaptionRegion,
  analyzeAssetFirstInformation,
  analyzeAssetFirstStyleDrift,
  mergeStyleDriftObservationFrames,
  mapAssetUsageToQaWarnings,
  mapOverlayChecksToQaWarnings,
  beatsInfoFromRenderDecisions,
  assembleBoundaryGroupsForDiff,
  captionRegionFramesFromSamples,
} = require('./assetFirstQa');

function aspectFromDimensions(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '';
  const actualRatio = w / h;
  if (Math.abs(actualRatio - 16 / 9) < 0.02) return '16:9';
  if (Math.abs(actualRatio - 9 / 16) < 0.02) return '9:16';
  if (Math.abs(actualRatio - 1) < 0.02) return '1:1';
  return `${w}:${h}`;
}

function addAspectIssue(issues, videoInfo, expectedAspectRatio) {
  const expected = String(expectedAspectRatio || '').trim();
  if (!expected || !videoInfo) return;
  const actual = aspectFromDimensions(videoInfo.width, videoInfo.height);
  if (!actual) {
    issues.push({
      code: 'aspect_probe_unavailable',
      message: `无法探测输出视频画幅，不能确认是否符合目标画幅 ${expected}。`,
      expected,
      width: videoInfo.width,
      height: videoInfo.height,
    });
    return;
  }
  if (actual && actual !== expected) {
    issues.push({
      code: 'aspect_ratio_mismatch',
      message: `输出画幅为 ${actual}，但目标画幅为 ${expected}。`,
      expected,
      actual,
      width: videoInfo.width,
      height: videoInfo.height,
    });
  }
}

function frameFingerprint(frame) {
  if (frame.fingerprint) return String(frame.fingerprint);
  return [
    Math.round(Number(frame.average_luma || 0)),
    Math.round(Number(frame.luma_stddev || 0)),
    Math.round(Number(frame.edge_score || 0) * 10),
    Math.round(Number(frame.color_variance || 0)),
  ].join(':');
}

function addRepeatedFrameIssue(issues, frames, threshold = 0.75) {
  if (!Array.isArray(frames) || frames.length < 4) return;
  const counts = new Map();
  for (const frame of frames) {
    const key = frameFingerprint(frame);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  const repeatedRatio = maxCount / frames.length;
  if (repeatedRatio >= threshold) {
    issues.push({
      code: 'repeated_frames',
      message: `采样帧重复率 ${(repeatedRatio * 100).toFixed(0)}%，疑似多场景重复同一画面。`,
      repeated_ratio: repeatedRatio,
      frame_count: frames.length,
    });
  }
}

function withAdditionalIssues(result, { videoInfo, expectedAspectRatio, frames }) {
  const issues = [...(result.issues || [])];
  addAspectIssue(issues, videoInfo, expectedAspectRatio);
  addRepeatedFrameIssue(issues, frames);
  return {
    ...result,
    success: issues.length === 0,
    issues,
    message: issues.length === 0 ? '视觉质检通过。' : '视觉质检失败。',
  };
}

async function writeVisualReport(projectDir, report) {
  if (!projectDir) return report;
  const relativePath = 'inspect/visual-report.json';
  const absolutePath = path.join(projectDir, relativePath);
  try {
    await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
    await fsp.writeFile(absolutePath, JSON.stringify(report, null, 2), 'utf8');
  } catch (error) {
    // 报告落盘失败不应把只读巡检变成整条工作流失败，降级为无 report_path
    return { ...report, report_path: '', report_write_error: `视觉巡检报告写入失败：${error?.message || '未知错误'}` };
  }
  return { ...report, report_path: relativePath };
}

async function inspectRenderedVideo({
  projectDir,
  outputPath,
  project = {},
  runCommand = defaultRunCommand,
  expectedAspectRatio = '',
  expected_aspect_ratio = '',
  safetyOnly = false,
  services = {},
} = {}) {
  const videoPath = outputPath || (projectDir ? path.join(projectDir, 'output.mp4') : '');
  if (!projectDir || !videoPath || !fs.existsSync(videoPath)) {
    return {
      success: false,
      issues: [{ code: 'output_missing', message: '未找到待质检视频。' }],
      metrics: {},
      message: '视觉质检失败：未找到待质检视频。',
    };
  }
  const inspectRoot = path.join(projectDir, 'inspect');
  await fsp.mkdir(inspectRoot, { recursive: true });
  const workDir = await fsp.mkdtemp(path.join(inspectRoot, 'qa-'));
  const videoInfo = services.probeVideo
    ? await services.probeVideo({ projectDir, outputPath: videoPath, videoPath })
    : await probeVideo({ videoPath, runCommand });
  // 非 safetyOnly 才启用成对边界采样与 warnings 通道；
  // safetyOnly 的采样与报告结构保持现状（硬约束 A）。
  const assetFirstQa = safetyOnly !== true;
  const timedPlan = buildTimedSamplePlan({ project, videoInfo, pairedBoundarySampling: assetFirstQa });
  if (services.sampleFrames) {
    // times：生产采样计划（P2-4 起含全片均匀观测点），注入实现可按需取用
    const frames = await services.sampleFrames({ projectDir, outputPath: videoPath, videoPath, workDir, times: timedPlan.times });
    const result = safetyOnly ? {
      success: true,
      issues: [],
      metrics: { frame_count: frames.length, contact_sheet_size: null },
      message: '视觉质检通过。',
    } : analyzeFrameMetrics({
      frames,
      contact_sheet_size: null,
    });
    const timed = analyzeTimedSafetyMetrics({ frames, ...timedPlan });
    const finalResult = withAdditionalIssues({
      ...result,
      issues: [...(result.issues || []), ...timed.issues],
      metrics: { ...(result.metrics || {}), ...timed.metrics },
    }, {
      videoInfo,
      expectedAspectRatio: expectedAspectRatio || expected_aspect_ratio,
      frames,
    });
    const reportBody = assetFirstQa
      ? attachAssetFirstWarnings(finalResult, collectAssetFirstWarnings({
        project,
        timedPlan,
        timedFrames: frames,
        sequentialFrames: frames,
      }))
      : finalResult;
    return writeVisualReport(projectDir, {
      ...reportBody,
      frames,
      safety_only: safetyOnly,
    });
  }
  const contactSheet = safetyOnly
    ? { success: true, path: '', size: null, diagnostics: null }
    : await createContactSheet({ projectDir, workDir, videoPath, runCommand });
  const safetyFrames = safetyOnly
    ? await extractTimedFrameMetrics({ projectDir, workDir, videoPath, runCommand, times: timedPlan.times, fps: videoInfo.fps })
    : [];
  const extracted = safetyOnly
    ? {
      success: timedPlan.times.length === 0 || safetyFrames.length > 0,
      frames: safetyFrames,
    }
    : await extractRawFrameMetrics({ projectDir, workDir, videoPath, runCommand, duration: timedPlan.duration });
  if (!extracted.success) {
    return writeVisualReport(projectDir, {
      success: false,
      issues: [{ code: 'frame_extract_failed', message: '抽帧失败。' }],
      metrics: {},
      message: '视觉质检失败：抽帧失败。',
      diagnostics: extracted.diagnostics,
      contact_sheet_path: contactSheet.path,
      safety_only: safetyOnly,
    });
  }
  const result = safetyOnly ? {
    success: true,
    issues: [],
    metrics: { frame_count: extracted.frames.length, contact_sheet_size: contactSheet.size },
    message: '视觉质检通过。',
  } : analyzeFrameMetrics({
    frames: extracted.frames,
    contact_sheet_size: contactSheet.size,
  });
  const timedFrames = safetyOnly
    ? extracted.frames
    : [
      ...extracted.frames,
      ...await extractTimedFrameMetrics({ projectDir, workDir, videoPath, runCommand, times: timedPlan.times, fps: videoInfo.fps }),
    ];
  const timed = analyzeTimedSafetyMetrics({ frames: timedFrames, ...timedPlan });
  const finalResult = withAdditionalIssues({
    ...result,
    issues: [...(result.issues || []), ...timed.issues],
    metrics: { ...(result.metrics || {}), ...timed.metrics },
  }, {
    videoInfo,
    expectedAspectRatio: expectedAspectRatio || expected_aspect_ratio,
    frames: extracted.frames,
  });
  const reportBody = assetFirstQa
    ? attachAssetFirstWarnings(finalResult, collectAssetFirstWarnings({
      project,
      timedPlan,
      timedFrames,
      sequentialFrames: extracted.frames,
    }))
    : finalResult;
  return writeVisualReport(projectDir, {
    ...reportBody,
    frames: extracted.frames,
    contact_sheet_path: contactSheet.path,
    safety_only: safetyOnly,
  });
}

// asset_first 巡检警告汇总：全部经 attachAssetFirstWarnings 挂 result.warnings，
// 不进入 issues / 不影响 success（硬约束 C）。
// 整体 try/catch：观测通道绝不阻断巡检——任何汇总异常时放弃 warnings，原 result 原样返回。
function collectAssetFirstWarnings({ project = {}, timedPlan = {}, timedFrames = [], sequentialFrames = [] } = {}) {
  try {
    const decisions = Array.isArray(project.render_decisions) ? project.render_decisions : [];
    const voiceWindows = buildVoiceWindowsFromProject(project);
    return [
      ...analyzeAssetFirstBoundaries(
        assembleBoundaryGroupsForDiff(timedPlan.boundaryGroups || [], timedFrames),
      ),
      ...analyzeAssetFirstCaptionRegion(captionRegionFramesFromSamples(timedFrames, voiceWindows)),
      ...analyzeAssetFirstInformation(beatsInfoFromRenderDecisions(decisions)),
      // style_drift 输入 = 顺序帧 ∪ timed 采样帧（覆盖全片），跨 scene 边界 ±0.35s 的帧对跳过；
      // Finding 3：豁免边界来自 project.frames 完整推导（sceneCutTimesFromProject），
      // 不再从可能被预算截断的 timedPlan.boundaryGroups 过滤，避免合法硬切被误报 drift
      ...analyzeAssetFirstStyleDrift(
        mergeStyleDriftObservationFrames(sequentialFrames, timedFrames),
        {
          sceneCutTimes: sceneCutTimesFromProject(project),
        },
      ),
      ...mapAssetUsageToQaWarnings(project.asset_usage_report || {}),
      ...mapOverlayChecksToQaWarnings(decisions),
    ];
  } catch (error) {
    console.warn(`视觉观测通道汇总失败，已跳过 warnings：${error?.message || error}`);
    return [];
  }
}

// warnings 独立于 issues，绝不影响 success / withAdditionalIssues / checkpoint 语义
function attachAssetFirstWarnings(result, warnings = []) {
  if (!Array.isArray(warnings) || !warnings.length) return result;
  return { ...result, warnings: [...(result.warnings || []), ...warnings] };
}

module.exports = {
  analyzeFrameMetrics,
  inspectRenderedVideo,
  aspectFromDimensions,
  isBlankFrameMetric,
  projectBoundarySampleGroups,
  sceneCutTimesFromProject,
  buildTimedSamplePlan,
  probeVideo,
  analyzeAssetFirstBoundaries,
  analyzeAssetFirstCaptionRegion,
  analyzeAssetFirstInformation,
  analyzeAssetFirstStyleDrift,
  mergeStyleDriftObservationFrames,
  mapAssetUsageToQaWarnings,
  mapOverlayChecksToQaWarnings,
  attachAssetFirstWarnings,
};
