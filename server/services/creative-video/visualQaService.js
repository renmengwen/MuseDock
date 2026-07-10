const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { runCommand: defaultRunCommand } = require('../hyperframes/hyperframesRenderer');

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

function projectBoundarySampleGroups(project = {}, duration = 0) {
  const frames = Array.isArray(project?.frames) ? project.frames : [];
  const groups = [];
  let cursor = 0;
  for (let index = 0; index < frames.length - 1; index += 1) {
    const frameDuration = Number(frames[index]?.duration_sec || frames[index]?.durationSec);
    if (!Number.isFinite(frameDuration) || frameDuration <= 0) continue;
    cursor += frameDuration;
    const times = [cursor, cursor + 0.5, cursor + 1.0]
      .filter(time => time > 0 && (!Number.isFinite(duration) || duration <= 0 || time < duration));
    if (times.length) groups.push({ boundary_sec: Math.round(cursor * 100) / 100, times });
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

function buildTimedSamplePlan({ project = {}, videoInfo = {} } = {}) {
  const opening = [0, 0.5, 1.0].filter(time => (
    !Number.isFinite(videoInfo.duration) || !videoInfo.duration || time < videoInfo.duration
  ));
  const boundaryGroups = projectBoundarySampleGroups(project, videoInfo.duration);
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
  for (let i = 0; i < pixels; i += 1) {
    const offset = i * 3;
    const r = buffer[offset];
    const g = buffer[offset + 1];
    const b = buffer[offset + 2];
    const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    lumas[i] = luma;
    lumaSum += luma;
    colorSum += Math.max(r, g, b) - Math.min(r, g, b);
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
  return {
    id,
    average_luma: Math.round(average * 100) / 100,
    luma_stddev: Math.round(Math.sqrt(variance) * 100) / 100,
    edge_score: Math.round((edgeCount ? edgeTotal / edgeCount : 0) * 100) / 100,
    color_variance: Math.round((pixels ? colorSum / pixels : 0) * 100) / 100,
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
  const timedPlan = buildTimedSamplePlan({ project, videoInfo });
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
    return writeVisualReport(projectDir, {
      ...finalResult,
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
  return writeVisualReport(projectDir, {
    ...finalResult,
    frames: extracted.frames,
    contact_sheet_path: contactSheet.path,
    safety_only: safetyOnly,
  });
}

module.exports = {
  analyzeFrameMetrics,
  inspectRenderedVideo,
  aspectFromDimensions,
  isBlankFrameMetric,
};
