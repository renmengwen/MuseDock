const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

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
// Finding 2：pairedBoundarySampling 下从 MAX_TIMED_SAMPLES 里固定预留给全片均匀
// style observation 的采样配额，避免密集边界组把观测预算全部耗尽（最多补 7 个点）。
const OBSERVATION_RESERVE = 7;

function ratio(count, total) {
  return total > 0 ? count / total : 0;
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

// pairedSampling（asset_first 专用）：same_scene===true 的边界取并集
// [b-0.3, b, b+0.3, b+0.5, b+1.0]——保留旧安全采样 [b, b+0.5, b+1.0]（blank_segment_boundary
// 的 ≥2 空白阻断能力不降级），额外增加 ∓0.3s 成对差分点供 boundary_refresh 检测；
// 跨 scene 边界保留 [b, b+0.5, b+1.0]。采样总量由 buildTimedSamplePlan 的
// MAX_TIMED_SAMPLES 封顶（典型 17 边界 ×5 点 + 开头 3 点 = 88 < 120，不会超）。
// review P2-3(c)：scene_html 单 frame 的内部 beat 边界（frame.metadata.beat_windows 相接处）
// 仅在显式 pairedSampling 时按 same_scene=true 边界产出采样组（boundary_sec = frame 起点 +
// window.end_sec，排除最后一个 window 末尾）；缺省不产出（硬约束 A，无 beat_windows 的旧工程天然不受影响）。
// 缺省（safetyOnly）采样时间逐值与原实现一致（硬约束 A）。
function projectBoundarySampleGroups(project = {}, duration = 0, { pairedSampling = false } = {}) {
  const frames = Array.isArray(project?.frames) ? project.frames : [];
  const groups = [];
  const withinVideo = time => time > 0 && (!Number.isFinite(duration) || duration <= 0 || time < duration);
  const roundTimes = values => values.map(time => Math.round(time * 1000) / 1000).filter(withinVideo);
  // P2-3：成对采样组结构拆分——safety_times（旧安全三点，白屏阻断专用口径）与
  // diff_times（∓0.3s 差分点，boundary_refresh 专用）分开存放；times 保留并集供抽帧计划。
  const pairedGroupFields = (boundary) => {
    const safety = roundTimes([boundary, boundary + 0.5, boundary + 1.0]);
    const diff = roundTimes([boundary - 0.3, boundary + 0.3]);
    return {
      safety_times: safety,
      diff_times: diff,
      times: uniqueTimes([...safety, ...diff]).sort((left, right) => left - right),
    };
  };
  let cursor = 0;
  for (let index = 0; index < frames.length; index += 1) {
    const frameDuration = positiveFrameDuration(frames[index]);
    if (!frameDuration) continue;
    const sceneId = String(frames[index]?.scene_id || '').trim();
    // 内部 beat 边界（scene_html 单 frame）：仅显式 pairedSampling 启用
    if (pairedSampling === true) {
      const windows = Array.isArray(frames[index]?.metadata?.beat_windows)
        ? frames[index].metadata.beat_windows
        : [];
      for (let w = 0; w < windows.length - 1; w += 1) {
        const endSec = Number(windows[w]?.end_sec);
        if (!Number.isFinite(endSec) || endSec <= 0) continue;
        const boundary = cursor + endSec;
        const fields = pairedGroupFields(boundary);
        if (!fields.times.length) continue;
        groups.push({
          boundary_sec: Math.round(boundary * 100) / 100,
          ...fields,
          same_scene: true,
          ...(sceneId ? { scene_id: sceneId } : {}),
        });
      }
    }
    cursor += frameDuration;
    if (index >= frames.length - 1) break;
    const nextSceneId = String(frames[index + 1]?.scene_id || '').trim();
    const sameScene = Boolean(sceneId) && sceneId === nextSceneId;
    // 缺省路径 / 跨 scene 边界：仅 times 三点，不加新字段（逐值行为与现状一致，硬约束 A）
    const fields = pairedSampling === true && sameScene
      ? pairedGroupFields(cursor)
      : { times: [cursor, cursor + 0.5, cursor + 1.0].filter(withinVideo) };
    if (!fields.times.length) continue;
    groups.push({
      boundary_sec: Math.round(cursor * 100) / 100,
      ...fields,
      same_scene: sameScene,
      ...(sameScene ? { scene_id: sceneId } : {}),
    });
  }
  return groups;
}

// Finding 3：完整跨 scene 硬切时间列表——直接从 project.frames 推导，不依赖（可能被
// MAX_TIMED_SAMPLES 截断的）timedPlan.boundaryGroups。帧时长回退链（duration_sec ->
// durationSec，无效跳过）与 projectBoundarySampleGroups 同口径；相邻帧 scene_id 不同
//（含任一为空）处产出 cut。scene_html 内部 beat 边界在同一 frame 内无 scene_id 变化，
// 天然不进该列表。仅供 style_drift 硬切豁免使用；boundaryGroups 继续只管抽帧。
function sceneCutTimesFromProject(project = {}) {
  const frames = Array.isArray(project?.frames) ? project.frames : [];
  const cuts = [];
  let cursor = 0;
  for (let index = 0; index < frames.length; index += 1) {
    const frameDuration = positiveFrameDuration(frames[index]);
    if (!frameDuration) continue;
    cursor += frameDuration;
    if (index >= frames.length - 1) break;
    const sceneId = String(frames[index]?.scene_id || '').trim();
    const nextSceneId = String(frames[index + 1]?.scene_id || '').trim();
    const sameScene = Boolean(sceneId) && sceneId === nextSceneId;
    if (!sameScene) cuts.push(Math.round(cursor * 100) / 100);
  }
  return cuts;
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

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveFrameDuration(frame) {
  return positiveNumber(frame?.duration_sec) || positiveNumber(frame?.durationSec);
}

function buildTimedSamplePlan({ project = {}, videoInfo = {}, pairedBoundarySampling = false } = {}) {
  const frames = Array.isArray(project?.frames) ? project.frames : [];
  const duration = positiveNumber(videoInfo.duration) || frames.reduce((sum, frame) => {
    const frameDuration = positiveFrameDuration(frame);
    return frameDuration ? sum + frameDuration : sum;
  }, 0);
  const opening = [0, 0.5, 1.0].filter(time => (
    !duration || time < duration
  ));
  const boundaryGroups = projectBoundarySampleGroups(project, duration, {
    pairedSampling: pairedBoundarySampling === true,
  });
  const cappedBoundaryGroups = [];
  let sampleCount = opening.length;
  if (pairedBoundarySampling === true) {
    // Finding 2：paired 采样下相邻边界组的采样点大量重叠（密集 beat window 场景），
    // 预算改按「全局唯一时间点」计数：每组仍整组原子纳入（部分纳入会破坏 safety/diff 语义），
    // 但扣费额 = 该组 times 中尚未出现过的唯一点数（毫秒键，与 uniqueTimes 同精度）。
    // 同时预留 OBSERVATION_RESERVE 给全片均匀观测点，boundary 组只用剩余预算。
    // 缺省路径（else 分支）保持原始按 group.times.length 扣费，逐值行为不变（硬约束 A）。
    const seen = new Set(opening.map(time => (Math.round(time * 1000) / 1000).toFixed(3)));
    const boundaryBudget = MAX_TIMED_SAMPLES - OBSERVATION_RESERVE;
    for (const group of boundaryGroups) {
      const newKeys = [...new Set(group.times
        .map(time => (Math.round(time * 1000) / 1000).toFixed(3)))]
        .filter(key => !seen.has(key));
      if (sampleCount + newKeys.length > boundaryBudget) break;
      for (const key of newKeys) seen.add(key);
      cappedBoundaryGroups.push(group);
      sampleCount += newKeys.length;
    }
  } else {
    for (const group of boundaryGroups) {
      if (sampleCount + group.times.length > MAX_TIMED_SAMPLES) break;
      cappedBoundaryGroups.push(group);
      sampleCount += group.times.length;
    }
  }
  // P2-4：asset_first（pairedBoundarySampling）下补均匀 style observation 采样点——
  // 边界/opening 点不足以覆盖全片时（如 60s 单 scene 单 beat 无边界组），按 duration/8
  // 间隔补最多 7 个均匀点，跳过与既有采样点 <0.5s 重叠的；预算 = OBSERVATION_RESERVE
  // 固定预留 + boundary 组没用完的余量（总量仍受 MAX_TIMED_SAMPLES 封顶）。这些点进入抽帧计划（自带 mean_rgb），流入 style_drift 观测合并输入。
  // 缺省 / safetyOnly 不加（行为不变，硬约束 A）。
  const observation = [];
  // probe duration 无效时用 project.frames 总时长兜底；opening、boundary 与
  // observation 共用上方的有效时长，避免不同采样通道口径分裂。
  if (pairedBoundarySampling === true && Number.isFinite(duration) && duration > 0) {
    const existing = uniqueTimes([...opening, ...cappedBoundaryGroups.flatMap(group => group.times)]);
    const interval = duration / 8;
    for (let step = 1; step <= 7; step += 1) {
      if (sampleCount + 1 > MAX_TIMED_SAMPLES) break;
      const time = Math.round(step * interval * 1000) / 1000;
      if (time <= 0 || time >= duration) continue;
      if ([...existing, ...observation].some(other => Math.abs(other - time) < 0.5)) continue;
      observation.push(time);
      sampleCount += 1;
    }
  }
  return {
    opening,
    boundaryGroups: cappedBoundaryGroups,
    observation,
    total_boundary_count: boundaryGroups.length,
    sampled_boundary_count: cappedBoundaryGroups.length,
    times: uniqueTimes([...opening, ...cappedBoundaryGroups.flatMap(group => group.times), ...observation]),
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

// 同帧去重：组内相邻查询点间距可小于 2×closestFrameAt 容差（0.26×2=0.52），某点位帧缺失时
// （ffmpeg 末尾丢帧、注入网格帧稀疏）两个查询会命中同一物理帧；blank≥2 阻断按帧身份
// （time_sec/time/id）去重计数，避免单帧空白满足阻断条件（issues 通道过敏）
function uniqueMatchedFrames(frames = []) {
  return [...new Map(frames.map(frame => [frame.time_sec ?? frame.time ?? frame.id, frame])).values()];
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
      // Finding 3：部分容器（如 webm/mkv）stream 段无 duration，同时读 format=duration 兜底
      'stream=width,height,duration,avg_frame_rate,r_frame_rate:format=duration',
      '-of',
      'json',
      videoPath,
    ]);
    if (!result.ok) return probeVideoWithFfmpeg({ videoPath, runCommand });
    const parsed = JSON.parse(result.stdout || '{}');
    const stream = Array.isArray(parsed.streams) ? parsed.streams[0] : {};
    const format = parsed.format && typeof parsed.format === 'object' ? parsed.format : {};
    const streamDuration = positiveNumber(stream.duration);
    const formatDuration = positiveNumber(format.duration);
    return {
      width: Number(stream.width) || undefined,
      height: Number(stream.height) || undefined,
      // duration 优先 stream，再回退 format
      duration: streamDuration || formatDuration || undefined,
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

module.exports = {
  analyzeFrameMetrics,
  isBlankFrameMetric,
  projectBoundarySampleGroups,
  sceneCutTimesFromProject,
  buildTimedSamplePlan,
  extractTimedFrameMetrics,
  closestFrameAt,
  uniqueMatchedFrames,
  probeVideo,
  extractRawFrameMetrics,
  createContactSheet,
};
