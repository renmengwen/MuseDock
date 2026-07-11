const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { runCommand: defaultRunCommand } = require('../hyperframes/hyperframesRenderer');
// caption 活跃窗口与 sfxEventService.buildVoiceWindowsFromProject 同口径（帧起点累计偏移 + 毫秒取整）。
// 直接复用该实现：sfxEventService 仅依赖 projectStore/projectSchema/sfxLibrary，与本模块无 require 环。
const { buildVoiceWindowsFromProject } = require('./html-video/sfxEventService');

let bundledFfmpegPath = '';
try {
  bundledFfmpegPath = require('@ffmpeg-installer/ffmpeg').path;
} catch {
  bundledFfmpegPath = '';
}

const THRESHOLDS = {
  nearWhiteLuma: 230,
  nearBlackLuma: 25,
  blankRatio: 0.3,
  contactSheetMinBytes: 20000,
  lowInfoLumaStddev: 12,
  lowInfoEdgeScore: 8,
  lowInfoColorVariance: 10,
  lowInfoRatio: 0.4,
  motionMinSamples: 4,
  lowMotionMeanAbsDiff: 1,
  lowMotionChangedPixelRatio: 0.015,
  lowMotionRatio: 0.75,
};
const MAX_TIMED_SAMPLES = 120;

function ratio(count, total) {
  return total > 0 ? count / total : 0;
}

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

function normalizeMotionMetric(frame = {}) {
  const motion = frame.motion_from_previous || frame.motionFromPrevious || frame.motion || null;
  if (!motion || typeof motion !== 'object') return null;
  const meanAbsDiff = Number(motion.mean_abs_diff ?? motion.meanAbsDiff);
  const changedPixelRatio = Number(motion.changed_pixel_ratio ?? motion.changedPixelRatio);
  if (!Number.isFinite(meanAbsDiff) || !Number.isFinite(changedPixelRatio)) return null;
  return {
    mean_abs_diff: meanAbsDiff,
    changed_pixel_ratio: changedPixelRatio,
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
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

function isLowInformationFrame(frame = {}) {
  return (
    Number(frame.luma_stddev) < THRESHOLDS.lowInfoLumaStddev
    && Number(frame.edge_score) < THRESHOLDS.lowInfoEdgeScore
    && Number(frame.color_variance) < THRESHOLDS.lowInfoColorVariance
  );
}

function isBlankFrameMetric(frame = {}) {
  return (
    (Number(frame.average_luma) > THRESHOLDS.nearWhiteLuma
      || Number(frame.average_luma) < THRESHOLDS.nearBlackLuma)
    && isLowInformationFrame(frame)
  );
}

function analyzeFrameMetrics({ frames = [], contact_sheet_size = 0 } = {}) {
  const total = frames.length;
  const nearWhite = frames.filter(frame => Number(frame.average_luma) > THRESHOLDS.nearWhiteLuma && isLowInformationFrame(frame)).length;
  const nearBlack = frames.filter(frame => Number(frame.average_luma) < THRESHOLDS.nearBlackLuma && isLowInformationFrame(frame)).length;
  const lowInformation = frames.filter(frame => (
    isLowInformationFrame(frame)
  )).length;
  const motionSamples = frames.map(normalizeMotionMetric).filter(Boolean);
  const lowMotion = motionSamples.filter(motion => (
    motion.mean_abs_diff < THRESHOLDS.lowMotionMeanAbsDiff
    && motion.changed_pixel_ratio < THRESHOLDS.lowMotionChangedPixelRatio
  )).length;
  const motionMeanAbsDiffValues = motionSamples.map(motion => motion.mean_abs_diff);
  const motionChangedRatioValues = motionSamples.map(motion => motion.changed_pixel_ratio);
  const metrics = {
    frame_count: total,
    near_white_ratio: ratio(nearWhite, total),
    near_black_ratio: ratio(nearBlack, total),
    blank_ratio: ratio(nearWhite + nearBlack, total),
    low_information_ratio: ratio(lowInformation, total),
    motion_sample_count: motionSamples.length,
    low_motion_ratio: ratio(lowMotion, motionSamples.length),
    mean_motion_abs_diff: motionMeanAbsDiffValues.length
      ? Math.round((motionMeanAbsDiffValues.reduce((sum, value) => sum + value, 0) / motionMeanAbsDiffValues.length) * 1000) / 1000
      : 0,
    median_motion_abs_diff: Math.round(median(motionMeanAbsDiffValues) * 1000) / 1000,
    mean_motion_changed_pixel_ratio: motionChangedRatioValues.length
      ? Math.round((motionChangedRatioValues.reduce((sum, value) => sum + value, 0) / motionChangedRatioValues.length) * 10000) / 10000
      : 0,
    contact_sheet_size,
  };
  const issues = [];

  if (total === 0) {
    issues.push({
      code: 'no_frames_analyzed',
      message: '没有可分析的抽帧画面。',
      value: 0,
    });
  }
  if (metrics.blank_ratio > THRESHOLDS.blankRatio) {
    issues.push({
      code: 'too_many_blank_frames',
      message: '近白或近黑空白帧比例过高。',
      value: metrics.blank_ratio,
    });
  }
  // contact_sheet_size 为 null 表示本次巡检没有真实接触表（注入采样/安全检查模式），跳过该项检查
  if (contact_sheet_size != null && Number(contact_sheet_size) < THRESHOLDS.contactSheetMinBytes) {
    issues.push({
      code: 'contact_sheet_too_small',
      message: '接触表文件过小，可能没有有效画面。',
      value: Number(contact_sheet_size) || 0,
    });
  }
  if (metrics.low_information_ratio > THRESHOLDS.lowInfoRatio) {
    issues.push({
      code: 'too_many_low_information_frames',
      message: '低信息量帧比例过高。',
      value: metrics.low_information_ratio,
    });
  }
  if (
    metrics.motion_sample_count >= THRESHOLDS.motionMinSamples
    && metrics.low_motion_ratio >= THRESHOLDS.lowMotionRatio
  ) {
    issues.push({
      code: 'low_motion',
      message: `场景内运动强度过低：${(metrics.low_motion_ratio * 100).toFixed(0)}% 的相邻抽帧变化不足。`,
      value: metrics.low_motion_ratio,
      mean_abs_diff: metrics.mean_motion_abs_diff,
      changed_pixel_ratio: metrics.mean_motion_changed_pixel_ratio,
      sample_count: metrics.motion_sample_count,
    });
  }

  return {
    success: issues.length === 0,
    issues,
    metrics,
    message: issues.length === 0 ? '视觉质检通过。' : '视觉质检失败。',
  };
}

// pairedSampling（asset_first 专用）：仅对 same_scene===true 的边界改为成对采样（∓0.3s）供差分；
// 跨 scene 边界保留 [b, b+0.5, b+1.0]，blank_segment_boundary 检测口径不变。
// 代价：same_scene 边界的 blank_segment_boundary 降敏（成对两点需同时空白，边界后白屏闪现难命中），
// 该类边界的整帧重刷/白屏改由 asset_first_boundary_refresh 差分检测覆盖。
// 缺省（hf_first/safetyOnly）采样时间逐值与原实现一致（硬约束 A）。
function projectBoundarySampleGroups(project = {}, duration = 0, { pairedSampling = false } = {}) {
  const frames = Array.isArray(project?.frames) ? project.frames : [];
  const groups = [];
  let cursor = 0;
  for (let index = 0; index < frames.length - 1; index += 1) {
    const frameDuration = Number(frames[index]?.duration_sec || frames[index]?.durationSec);
    if (!Number.isFinite(frameDuration) || frameDuration <= 0) continue;
    cursor += frameDuration;
    const sceneId = String(frames[index]?.scene_id || '').trim();
    const nextSceneId = String(frames[index + 1]?.scene_id || '').trim();
    const sameScene = Boolean(sceneId) && sceneId === nextSceneId;
    const candidates = pairedSampling === true && sameScene
      ? [cursor - 0.3, cursor + 0.3].map(time => Math.round(time * 1000) / 1000)
      : [cursor, cursor + 0.5, cursor + 1.0];
    const times = candidates
      .filter(time => time > 0 && (!Number.isFinite(duration) || duration <= 0 || time < duration));
    if (!times.length) continue;
    groups.push({
      boundary_sec: Math.round(cursor * 100) / 100,
      times,
      same_scene: sameScene,
      ...(sameScene ? { scene_id: sceneId } : {}),
    });
  }
  return groups;
}

function uniqueTimes(values = []) {
  const seen = new Set();
  return values
    .map(value => Math.round(Number(value) * 1000) / 1000)
    .filter(value => Number.isFinite(value) && value >= 0)
    .filter(value => {
      const key = value.toFixed(3);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildTimedSamplePlan({ project = {}, videoInfo = {}, pairedBoundarySampling = false } = {}) {
  const opening = [0, 0.5, 1.0].filter(time => (
    !Number.isFinite(videoInfo.duration) || !videoInfo.duration || time < videoInfo.duration
  ));
  const boundaryGroups = projectBoundarySampleGroups(project, videoInfo.duration, {
    pairedSampling: pairedBoundarySampling === true,
  });
  const cappedBoundaryGroups = [];
  let sampleCount = opening.length;
  for (const group of boundaryGroups) {
    if (sampleCount + group.times.length > MAX_TIMED_SAMPLES) break;
    cappedBoundaryGroups.push(group);
    sampleCount += group.times.length;
  }
  return {
    opening,
    boundaryGroups: cappedBoundaryGroups,
    total_boundary_count: boundaryGroups.length,
    sampled_boundary_count: cappedBoundaryGroups.length,
    times: uniqueTimes([...opening, ...cappedBoundaryGroups.flatMap(group => group.times)]),
  };
}

async function extractTimedFrameMetrics({ projectDir, workDir, videoPath, runCommand, times = [], fps = 30, width = 160, height = 90 }) {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const selections = uniqueTimes(times)
    .map(time => ({ time, frameIndex: Math.max(0, Math.round(time * safeFps)) }));
  if (!selections.length) return [];
  const byIndex = new Map();
  for (const item of selections) {
    if (!byIndex.has(item.frameIndex)) byIndex.set(item.frameIndex, item.time);
  }
  const ordered = [...byIndex.entries()].sort((left, right) => left[0] - right[0]);
  const rawPath = path.join(workDir, 'timed-frames.rgb');
  await fsp.mkdir(workDir, { recursive: true });
  await fsp.rm(rawPath, { force: true });
  const selectExpr = ordered.map(([index]) => `eq(n\\,${index})`).join('+');
  const result = await runFfmpeg([
    '-y',
    '-i',
    videoPath,
    '-vf',
    `select=${selectExpr},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    '-vsync',
    '0',
    '-frames:v',
    String(ordered.length),
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    rawPath,
  ], projectDir, runCommand);
  if (!result.ok || !fs.existsSync(rawPath) || fs.statSync(rawPath).size < width * height * 3) return [];
  const raw = await fsp.readFile(rawPath);
  const frameSize = width * height * 3;
  const frames = [];
  for (let offset = 0, index = 0; offset + frameSize <= raw.length && index < ordered.length; offset += frameSize, index += 1) {
    const time = ordered[index][1];
    frames.push({
      ...readRgbFrameMetrics(raw.subarray(offset, offset + frameSize), width, height, `time_${time}`),
      time_sec: time,
    });
  }
  return frames;
}

function closestFrameAt(frames, time, tolerance = 0.26) {
  let best = null;
  let bestDiff = Infinity;
  for (const frame of frames) {
    const diff = Math.abs(Number(frame.time_sec) - Number(time));
    if (diff < bestDiff) {
      best = frame;
      bestDiff = diff;
    }
  }
  return best && bestDiff <= tolerance ? best : null;
}

function analyzeTimedSafetyMetrics({ frames = [], opening = [], boundaryGroups = [] } = {}) {
  const issues = [];
  const openingBlank = opening
    .map(time => closestFrameAt(frames, time))
    .filter(Boolean)
    .filter(isBlankFrameMetric);
  if (openingBlank.length >= 2) {
    issues.push({
      code: 'blank_opening_frame',
      message: '开头抽样帧接近空白，可能录入了页面加载白屏。',
      times: openingBlank.map(frame => frame.time_sec),
    });
  }
  for (const group of boundaryGroups) {
    const blank = group.times
      .map(time => closestFrameAt(frames, time))
      .filter(Boolean)
      .filter(isBlankFrameMetric);
    if (blank.length >= 2) {
      issues.push({
        code: 'blank_segment_boundary',
        message: `镜头边界 ${group.boundary_sec}s 附近出现连续空白帧。`,
        boundary_sec: group.boundary_sec,
        times: blank.map(frame => frame.time_sec),
      });
    }
  }
  return {
    issues,
    metrics: {
      timed_sample_count: frames.length,
      blank_timed_sample_count: frames.filter(isBlankFrameMetric).length,
      sampled_boundary_count: boundaryGroups.length,
    },
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

function getFfmpegCommand() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (bundledFfmpegPath) return bundledFfmpegPath;
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function getFfprobeCommand() {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const ffmpeg = getFfmpegCommand();
  if (ffmpeg && ffmpeg !== 'ffmpeg' && ffmpeg !== 'ffmpeg.exe') {
    return path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  }
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
}

async function runFfmpeg(args, cwd, runCommand) {
  try {
    return await runCommand(getFfmpegCommand(), args, { cwd });
  } catch (error) {
    return { ok: false, stdout: '', stderr: '', error: error.message };
  }
}

async function probeVideo({ videoPath, runCommand }) {
  try {
    const result = await runCommand(getFfprobeCommand(), [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,duration,avg_frame_rate,r_frame_rate',
      '-of',
      'json',
      videoPath,
    ]);
    if (!result.ok) return probeVideoWithFfmpeg({ videoPath, runCommand });
    const parsed = JSON.parse(result.stdout || '{}');
    const stream = Array.isArray(parsed.streams) ? parsed.streams[0] : {};
    return {
      width: Number(stream.width) || undefined,
      height: Number(stream.height) || undefined,
      duration: Number(stream.duration) || undefined,
      fps: parseFps(stream.avg_frame_rate || stream.r_frame_rate),
    };
  } catch {
    return probeVideoWithFfmpeg({ videoPath, runCommand });
  }
}

function parseFps(value) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const [left, right] = text.split('/').map(Number);
  if (Number.isFinite(left) && Number.isFinite(right) && right > 0) return left / right;
  const direct = Number(text);
  return Number.isFinite(direct) && direct > 0 ? direct : undefined;
}

function parseFfmpegVideoInfo(text = '') {
  const source = String(text || '');
  const videoLine = source.split(/\r?\n/).find(line => /Video:/i.test(line)) || source;
  const dimensions = videoLine.match(/(?:^|[,\s])(\d{2,5})x(\d{2,5})(?:\s|,|\[|$)/);
  const durationMatch = source.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const fpsMatch = source.match(/,\s*(\d+(?:\.\d+)?)\s*fps\b/i);
  const duration = durationMatch
    ? (Number(durationMatch[1]) * 3600) + (Number(durationMatch[2]) * 60) + Number(durationMatch[3])
    : undefined;
  return {
    width: dimensions ? Number(dimensions[1]) : undefined,
    height: dimensions ? Number(dimensions[2]) : undefined,
    duration,
    fps: fpsMatch ? Number(fpsMatch[1]) : undefined,
  };
}

async function probeVideoWithFfmpeg({ videoPath, runCommand }) {
  try {
    const result = await runCommand(getFfmpegCommand(), ['-i', videoPath]);
    return parseFfmpegVideoInfo(`${result.stdout || ''}\n${result.stderr || ''}`);
  } catch {
    return {};
  }
}

function readRgbFrameMetrics(buffer, width, height, id) {
  const pixels = Math.floor(buffer.length / 3);
  const lumas = new Array(pixels);
  let lumaSum = 0;
  let colorSum = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  // 底部字幕区条带：按 1920 高对应 140px 的比例折算到缩放帧，同一遍历中累计 sum/sumSq 求方差
  const bottomRows = Math.max(1, Math.round(height * (140 / 1920)));
  const bottomStart = Math.max(0, (height - bottomRows) * width);
  let bottomLumaSum = 0;
  let bottomLumaSquareSum = 0;
  let bottomCount = 0;
  for (let i = 0; i < pixels; i += 1) {
    const offset = i * 3;
    const r = buffer[offset];
    const g = buffer[offset + 1];
    const b = buffer[offset + 2];
    const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    lumas[i] = luma;
    lumaSum += luma;
    colorSum += Math.max(r, g, b) - Math.min(r, g, b);
    redSum += r;
    greenSum += g;
    blueSum += b;
    if (i >= bottomStart) {
      bottomLumaSum += luma;
      bottomLumaSquareSum += luma * luma;
      bottomCount += 1;
    }
  }
  const average = pixels ? lumaSum / pixels : 0;
  const variance = pixels
    ? lumas.reduce((sum, luma) => sum + ((luma - average) ** 2), 0) / pixels
    : 0;
  let edgeTotal = 0;
  let edgeCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const index = y * width + x;
      edgeTotal += Math.abs((lumas[index] || 0) - (lumas[index - 1] || 0));
      edgeCount += 1;
    }
  }
  const bottomMean = bottomCount ? bottomLumaSum / bottomCount : 0;
  const bottomVariance = bottomCount
    ? Math.max(0, (bottomLumaSquareSum / bottomCount) - (bottomMean * bottomMean))
    : 0;
  return {
    id,
    average_luma: Math.round(average * 100) / 100,
    luma_stddev: Math.round(Math.sqrt(variance) * 100) / 100,
    edge_score: Math.round((edgeCount ? edgeTotal / edgeCount : 0) * 100) / 100,
    color_variance: Math.round((pixels ? colorSum / pixels : 0) * 100) / 100,
    // 以下为新增只读观测字段（不参与既有 issue 判定）：帧平均色（0-255）与底部字幕区归一化统计（0-1）
    mean_rgb: [
      Math.round((pixels ? redSum / pixels : 0) * 100) / 100,
      Math.round((pixels ? greenSum / pixels : 0) * 100) / 100,
      Math.round((pixels ? blueSum / pixels : 0) * 100) / 100,
    ],
    bottom_region: {
      luma: Math.round((bottomMean / 255) * 10000) / 10000,
      variance: Math.round((bottomVariance / (255 * 255)) * 10000) / 10000,
    },
  };
}

function measureRgbFrameMotion(previous, current, width, height) {
  if (!previous || !current) return null;
  const pixels = Math.min(
    Math.floor(previous.length / 3),
    Math.floor(current.length / 3),
    width * height,
  );
  if (pixels <= 0) return null;
  let totalDiff = 0;
  let changedPixels = 0;
  for (let i = 0; i < pixels; i += 1) {
    const offset = i * 3;
    const diff = (
      Math.abs((current[offset] || 0) - (previous[offset] || 0))
      + Math.abs((current[offset + 1] || 0) - (previous[offset + 1] || 0))
      + Math.abs((current[offset + 2] || 0) - (previous[offset + 2] || 0))
    ) / 3;
    totalDiff += diff;
    if (diff >= 2) changedPixels += 1;
  }
  return {
    mean_abs_diff: Math.round((totalDiff / pixels) * 1000) / 1000,
    changed_pixel_ratio: Math.round((changedPixels / pixels) * 10000) / 10000,
  };
}

async function extractRawFrameMetrics({ projectDir, workDir, videoPath, runCommand, width = 160, height = 90, fps = 2, maxFrames = 24 }) {
  const rawPath = path.join(workDir, 'frames.rgb');
  await fsp.mkdir(workDir, { recursive: true });
  await fsp.rm(rawPath, { force: true });
  const result = await runFfmpeg([
    '-y',
    '-i',
    videoPath,
    '-vf',
    `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    '-frames:v',
    String(maxFrames),
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    rawPath,
  ], projectDir, runCommand);
  if (!result.ok) {
    return { success: false, message: '抽帧失败。', frames: [], diagnostics: result };
  }
  if (!fs.existsSync(rawPath) || fs.statSync(rawPath).size < width * height * 3) {
    return { success: false, message: '抽帧失败：未生成有效帧数据。', frames: [], diagnostics: result };
  }
  const raw = await fsp.readFile(rawPath);
  const frameSize = width * height * 3;
  const frames = [];
  let previousFrameBuffer = null;
  for (let offset = 0, index = 0; offset + frameSize <= raw.length; offset += frameSize, index += 1) {
    const frameBuffer = raw.subarray(offset, offset + frameSize);
    const frame = readRgbFrameMetrics(frameBuffer, width, height, `frame_${index}`);
    frame.time_sec = Math.round((index / fps) * 1000) / 1000;
    const motion = measureRgbFrameMotion(previousFrameBuffer, frameBuffer, width, height);
    if (motion) frame.motion_from_previous = motion;
    frames.push(frame);
    previousFrameBuffer = frameBuffer;
  }
  return { success: true, frames };
}

async function createContactSheet({ projectDir, workDir, videoPath, runCommand }) {
  const outputPath = path.join(workDir, 'contact_sheet.jpg');
  await fsp.mkdir(workDir, { recursive: true });
  await fsp.rm(outputPath, { force: true });
  const result = await runFfmpeg([
    '-y',
    '-i',
    videoPath,
    '-vf',
    "fps=1,scale=220:-1,tile=4x3",
    '-frames:v',
    '1',
    outputPath,
  ], projectDir, runCommand);
  const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
  return { success: result.ok && size > 0, path: outputPath, size, diagnostics: result };
}

async function inspectRenderedVideo({
  projectDir,
  outputPath,
  project = {},
  runCommand = defaultRunCommand,
  expectedAspectRatio = '',
  expected_aspect_ratio = '',
  safetyOnly = false,
  visualStrategy = null,
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
  // asset_first 且非 safetyOnly 才启用成对边界采样与 warnings 通道；
  // hf_first / safetyOnly 的采样与报告结构保持现状（硬约束 A）。
  const assetFirstQa = visualStrategy === 'asset_first' && safetyOnly !== true;
  const timedPlan = buildTimedSamplePlan({ project, videoInfo, pairedBoundarySampling: assetFirstQa });
  if (services.sampleFrames) {
    const frames = await services.sampleFrames({ projectDir, outputPath: videoPath, videoPath, workDir });
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
    : await extractRawFrameMetrics({ projectDir, workDir, videoPath, runCommand });
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

const TITLE_TEMPLATES = new Set(['frame-glitch-title', 'frame-build-minimal']);

// 归零语义（决策 3）：asset_first 下任何 template_inputs 决策都是 takeover，无占比阈值。
function analyzeAssetFirstRouting(decisions = [], { visualStrategy = null } = {}) {
  if (visualStrategy !== 'asset_first') return [];
  const warnings = [];
  const list = Array.isArray(decisions) ? decisions : [];
  if (!list.length) return warnings;
  const takeovers = list.filter(d => d.source_mode === 'template_inputs');
  if (takeovers.length) {
    warnings.push({
      code: 'asset_first_template_takeover',
      severity: 'warning',
      message: `asset_first 下出现 ${takeovers.length} 条整帧模板决策（应为 0，见决策 3 归零语义）。`,
      details: { beats: takeovers.map(d => ({ beat_id: d.beat_id, template_id: d.template_id })) },
    });
  }
  const titles = list.filter(d => TITLE_TEMPLATES.has(d.template_id));
  if (titles.length) {
    warnings.push({
      code: 'asset_first_title_template_used',
      severity: 'warning',
      message: 'asset_first 下出现标题类整帧模板主路由。',
      details: { beats: titles.map(d => ({ beat_id: d.beat_id, template_id: d.template_id })) },
    });
  }
  return warnings;
}

// 差分用真实指标字段（readRgbFrameMetrics 产出）：average_luma（0-255 标度）与 edge_score
function boundaryDiffScore(before = {}, after = {}) {
  const luma = Math.abs((Number(after.average_luma) || 0) - (Number(before.average_luma) || 0)) / 255;
  const edges = Math.abs((Number(after.edge_score) || 0) - (Number(before.edge_score) || 0));
  return Math.max(luma, edges);
}

function analyzeAssetFirstBoundaries(boundaryGroups = [], { visualStrategy = null, diffThreshold = 0.25 } = {}) {
  if (visualStrategy !== 'asset_first') return [];
  const warnings = [];
  const hasFiniteMetrics = frame => (
    Number.isFinite(Number(frame?.average_luma)) && Number.isFinite(Number(frame?.edge_score))
  );
  for (const group of Array.isArray(boundaryGroups) ? boundaryGroups : []) {
    if (group.same_scene !== true) continue;
    if (!group.before || !group.after) continue; // 成对采样缺帧时跳过，不误报
    // 指标非有限值（如兜底空对象）与缺帧同语义：跳过该组
    if (!hasFiniteMetrics(group.before) || !hasFiniteMetrics(group.after)) continue;
    const score = boundaryDiffScore(group.before, group.after);
    if (score > diffThreshold) {
      warnings.push({
        code: 'asset_first_boundary_refresh',
        severity: 'warning',
        message: `同 scene 边界 ${group.boundary_sec}s 前后画面差异 ${score.toFixed(2)}，疑似整帧重刷。`,
        details: { scene_id: group.scene_id, boundary_sec: group.boundary_sec, score },
      });
    }
  }
  return warnings;
}

function analyzeAssetFirstCaptionRegion(frames = [], { visualStrategy = null, minVariance = 0.01 } = {}) {
  if (visualStrategy !== 'asset_first') return [];
  const warnings = [];
  for (const frame of Array.isArray(frames) ? frames : []) {
    if (frame.caption_active !== true) continue;
    const variance = Number(frame.bottom_region?.variance) || 0;
    if (variance < minVariance) {
      warnings.push({
        code: 'asset_first_caption_invisible',
        severity: 'warning',
        message: `${frame.time}s 字幕应显示但底部字幕区无可读内容。`,
        details: { time: frame.time, variance },
      });
    }
  }
  return warnings;
}

// 信息密度：无图 beat（has_asset !== true）的帧内元素统计低于阈值 => warning
function analyzeAssetFirstInformation(beatsInfo = [], { visualStrategy = null, minElements = 3 } = {}) {
  if (visualStrategy !== 'asset_first') return [];
  const warnings = [];
  for (const beat of Array.isArray(beatsInfo) ? beatsInfo : []) {
    if (!beat || beat.has_asset === true) continue;
    const elements = (Number(beat.text_blocks) || 0) + (Number(beat.cards) || 0) + (Number(beat.graphics) || 0);
    if (elements < minElements) {
      warnings.push({
        code: 'asset_first_low_information',
        severity: 'warning',
        message: `无图 beat ${beat.beat_id} 画面元素仅 ${elements} 个（< ${minElements}），信息密度不足。`,
        details: { beat_id: beat.beat_id, elements, min_elements: minElements },
      });
    }
  }
  return warnings;
}

// 风格漂移：相邻帧平均色任一通道突变超过阈值 => 单条 warning（取全片最大突变点）
function analyzeAssetFirstStyleDrift(frames = [], { visualStrategy = null, maxMeanShift = 96 } = {}) {
  if (visualStrategy !== 'asset_first') return [];
  const list = (Array.isArray(frames) ? frames : []).filter(frame => (
    Array.isArray(frame?.mean_rgb)
    && frame.mean_rgb.length >= 3
    && frame.mean_rgb.slice(0, 3).every(value => Number.isFinite(Number(value)))
  ));
  let worst = null;
  for (let index = 1; index < list.length; index += 1) {
    const previous = list[index - 1].mean_rgb;
    const current = list[index].mean_rgb;
    const shift = Math.max(
      Math.abs(Number(current[0]) - Number(previous[0])),
      Math.abs(Number(current[1]) - Number(previous[1])),
      Math.abs(Number(current[2]) - Number(previous[2])),
    );
    if (shift > maxMeanShift && (!worst || shift > worst.shift)) {
      worst = {
        shift,
        time: list[index].time ?? list[index].time_sec ?? null,
        from_time: list[index - 1].time ?? list[index - 1].time_sec ?? null,
      };
    }
  }
  if (!worst) return [];
  return [{
    code: 'asset_first_style_drift',
    severity: 'warning',
    message: `帧平均色在 ${worst.time}s 附近突变（差值 ${Math.round(worst.shift)} > ${maxMeanShift}），疑似整体风格漂移。`,
    details: {
      time: worst.time,
      from_time: worst.from_time,
      shift: Math.round(worst.shift * 100) / 100,
      max_mean_shift: maxMeanShift,
    },
  }];
}

// 素材缺失：复用 workflow 级 asset_usage_report（R6：真实结构无 report.missing 字段）。
// beat_id 取 expected_in_frames 首个作为定向重试目标；拿不到 frame 信息时置 null，不伪造。
function mapAssetUsageToQaWarnings(report = {}, { visualStrategy = null } = {}) {
  if (visualStrategy !== 'asset_first') return [];
  const missing = Array.isArray(report?.missing_required_asset_ids)
    ? report.missing_required_asset_ids.filter(Boolean)
    : [];
  if (!missing.length) return [];
  const assetsById = new Map((Array.isArray(report?.assets) ? report.assets : [])
    .filter(asset => asset && asset.asset_id)
    .map(asset => [String(asset.asset_id), asset]));
  return missing.map(assetId => {
    const asset = assetsById.get(String(assetId)) || {};
    const expected = Array.isArray(asset.expected_in_frames) ? asset.expected_in_frames.filter(Boolean) : [];
    return {
      code: 'asset_first_asset_missing',
      severity: 'warning',
      message: `必用素材 ${assetId} 未进入最终画面。`,
      details: {
        asset_id: assetId,
        expected_in_frames: expected,
        beat_id: expected.length ? expected[0] : null,
      },
    };
  });
}

// overlay 越界：透传 render_decisions[].overlay_check 的字幕安全区违规（validationGate 已落盘）。
// scene_html 回落展开会把整场景 stats 复制到组内每个 beat（stats_scope:'scene' 标记，
// 见 mergeFrameStatsIntoDecisions），该类决策按 scene_id+reason_code 去重只报一条，避免 N 倍重复。
function mapOverlayChecksToQaWarnings(decisions = [], { visualStrategy = null } = {}) {
  if (visualStrategy !== 'asset_first') return [];
  const warnings = [];
  const seenSceneScoped = new Set();
  for (const decision of Array.isArray(decisions) ? decisions : []) {
    const check = decision?.overlay_check;
    if (!check || check.valid !== false || check.reason_code !== 'overlay_in_caption_safe_area') continue;
    const sceneScoped = decision.stats_scope === 'scene';
    if (sceneScoped) {
      const key = `${String(decision.scene_id || '')}:${check.reason_code}`;
      if (seenSceneScoped.has(key)) continue;
      seenSceneScoped.add(key);
    }
    warnings.push({
      code: 'asset_first_overlay_caption_overlap',
      severity: 'warning',
      message: sceneScoped
        ? `scene ${decision.scene_id} 的 motion overlay 落入字幕安全区。`
        : `beat ${decision.beat_id} 的 motion overlay 落入字幕安全区。`,
      details: {
        beat_id: decision.beat_id,
        reason_code: check.reason_code,
        reason: check.message || '',
        ...(sceneScoped ? { stats_scope: 'scene', scene_id: decision.scene_id } : {}),
      },
    });
  }
  return warnings;
}

// beatsInfo 从 render_decisions 构造（R4 已把 text_blocks/cards/graphics 合并进决策）。
// has_asset 按 route_role==='asset_overlay' 判定：asset_first 路由仅在 beat 携带 asset_refs
// 时给该角色，语义等价于回查 visual_plan 且实现更简单。无任何统计字段的决策跳过
//（stats 未合并时不对该 beat 做密度判断，避免误报）。
function beatsInfoFromRenderDecisions(decisions = []) {
  const beatsInfo = [];
  for (const decision of Array.isArray(decisions) ? decisions : []) {
    if (!decision || !decision.beat_id) continue;
    const hasStats = ['text_blocks', 'cards', 'graphics']
      .some(key => Number.isFinite(Number(decision[key])));
    if (!hasStats) continue;
    beatsInfo.push({
      beat_id: decision.beat_id,
      has_asset: decision.route_role === 'asset_overlay',
      text_blocks: Number(decision.text_blocks) || 0,
      cards: Number(decision.cards) || 0,
      graphics: Number(decision.graphics) || 0,
    });
  }
  return beatsInfo;
}

// 成对边界组装：同 scene 边界前后（∓0.3s）各取最近采样帧供差分；缺帧留空由分析函数跳过
function assembleBoundaryGroupsForDiff(boundaryGroups = [], frames = []) {
  return (Array.isArray(boundaryGroups) ? boundaryGroups : [])
    .filter(group => group.same_scene === true)
    .map(group => ({
      ...group,
      before: closestFrameAt(frames, group.boundary_sec - 0.3),
      after: closestFrameAt(frames, group.boundary_sec + 0.3),
    }));
}

// 字幕区帧视图：采样帧时间对 voice window 求交得 caption_active，携带底部条带统计；
// timedFrames 与 fps 网格可能在同一时间点各出一帧，按 time_sec（毫秒精度）去重避免成对重复告警
function captionRegionFramesFromSamples(frames = [], voiceWindows = []) {
  const windows = Array.isArray(voiceWindows) ? voiceWindows : [];
  const seenTimes = new Set();
  const result = [];
  for (const frame of Array.isArray(frames) ? frames : []) {
    if (!frame || !frame.bottom_region || !Number.isFinite(Number(frame.time_sec))) continue;
    const time = Number(frame.time_sec);
    const key = (Math.round(time * 1000) / 1000).toFixed(3);
    if (seenTimes.has(key)) continue;
    seenTimes.add(key);
    result.push({
      time,
      caption_active: windows.some(window => time >= window.start && time <= window.end),
      bottom_region: frame.bottom_region,
    });
  }
  return result;
}

// asset_first 巡检警告汇总：全部经 attachAssetFirstWarnings 挂 result.warnings，
// 不进入 issues / 不影响 success（硬约束 C）。
// 整体 try/catch：观测通道绝不阻断巡检——任何汇总异常时放弃 warnings，原 result 原样返回。
function collectAssetFirstWarnings({ project = {}, timedPlan = {}, timedFrames = [], sequentialFrames = [] } = {}) {
  try {
    const options = { visualStrategy: 'asset_first' };
    const decisions = Array.isArray(project.render_decisions) ? project.render_decisions : [];
    const voiceWindows = buildVoiceWindowsFromProject(project);
    return [
      ...analyzeAssetFirstRouting(decisions, options),
      ...analyzeAssetFirstBoundaries(
        assembleBoundaryGroupsForDiff(timedPlan.boundaryGroups || [], timedFrames),
        options,
      ),
      ...analyzeAssetFirstCaptionRegion(captionRegionFramesFromSamples(timedFrames, voiceWindows), options),
      ...analyzeAssetFirstInformation(beatsInfoFromRenderDecisions(decisions), options),
      ...analyzeAssetFirstStyleDrift(sequentialFrames, options),
      ...mapAssetUsageToQaWarnings(project.asset_usage_report || {}, options),
      ...mapOverlayChecksToQaWarnings(decisions, options),
    ];
  } catch (error) {
    console.warn(`asset_first 视觉观测通道汇总失败，已跳过 warnings：${error?.message || error}`);
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
  analyzeAssetFirstRouting,
  analyzeAssetFirstBoundaries,
  analyzeAssetFirstCaptionRegion,
  analyzeAssetFirstInformation,
  analyzeAssetFirstStyleDrift,
  mapAssetUsageToQaWarnings,
  mapOverlayChecksToQaWarnings,
  attachAssetFirstWarnings,
};
