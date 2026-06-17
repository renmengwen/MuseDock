const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { runCommand: defaultRunCommand } = require('../hyperframesRenderer');

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
};

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

function analyzeFrameMetrics({ frames = [], contact_sheet_size = 0 } = {}) {
  const total = frames.length;
  const isLowInformationFrame = frame => (
    Number(frame.luma_stddev) < THRESHOLDS.lowInfoLumaStddev
    && Number(frame.edge_score) < THRESHOLDS.lowInfoEdgeScore
    && Number(frame.color_variance) < THRESHOLDS.lowInfoColorVariance
  );
  const nearWhite = frames.filter(frame => Number(frame.average_luma) > THRESHOLDS.nearWhiteLuma && isLowInformationFrame(frame)).length;
  const nearBlack = frames.filter(frame => Number(frame.average_luma) < THRESHOLDS.nearBlackLuma && isLowInformationFrame(frame)).length;
  const lowInformation = frames.filter(frame => (
    isLowInformationFrame(frame)
  )).length;
  const metrics = {
    frame_count: total,
    near_white_ratio: ratio(nearWhite, total),
    near_black_ratio: ratio(nearBlack, total),
    blank_ratio: ratio(nearWhite + nearBlack, total),
    low_information_ratio: ratio(lowInformation, total),
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
  if (Number(contact_sheet_size) < THRESHOLDS.contactSheetMinBytes) {
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

  return {
    success: issues.length === 0,
    issues,
    metrics,
    message: issues.length === 0 ? '视觉质检通过。' : '视觉质检失败。',
  };
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
      'stream=width,height,duration',
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
    };
  } catch {
    return probeVideoWithFfmpeg({ videoPath, runCommand });
  }
}

function parseFfmpegVideoInfo(text = '') {
  const source = String(text || '');
  const videoLine = source.split(/\r?\n/).find(line => /Video:/i.test(line)) || source;
  const dimensions = videoLine.match(/(?:^|[,\s])(\d{2,5})x(\d{2,5})(?:\s|,|\[|$)/);
  const durationMatch = source.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const duration = durationMatch
    ? (Number(durationMatch[1]) * 3600) + (Number(durationMatch[2]) * 60) + Number(durationMatch[3])
    : undefined;
  return {
    width: dimensions ? Number(dimensions[1]) : undefined,
    height: dimensions ? Number(dimensions[2]) : undefined,
    duration,
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

async function extractRawFrameMetrics({ projectDir, workDir, videoPath, runCommand, width = 160, height = 90 }) {
  const rawPath = path.join(workDir, 'frames.rgb');
  await fsp.mkdir(workDir, { recursive: true });
  await fsp.rm(rawPath, { force: true });
  const result = await runFfmpeg([
    '-y',
    '-i',
    videoPath,
    '-vf',
    `fps=1,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    '-frames:v',
    '12',
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
  for (let offset = 0, index = 0; offset + frameSize <= raw.length; offset += frameSize, index += 1) {
    frames.push(readRgbFrameMetrics(raw.subarray(offset, offset + frameSize), width, height, `frame_${index}`));
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
  runCommand = defaultRunCommand,
  expectedAspectRatio = '',
  expected_aspect_ratio = '',
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
  if (services.sampleFrames) {
    const frames = await services.sampleFrames({ projectDir, outputPath: videoPath, videoPath, workDir });
    const result = analyzeFrameMetrics({
      frames,
      contact_sheet_size: 45000,
    });
    return withAdditionalIssues(result, {
      videoInfo,
      expectedAspectRatio: expectedAspectRatio || expected_aspect_ratio,
      frames,
    });
  }
  const contactSheet = await createContactSheet({ projectDir, workDir, videoPath, runCommand });
  const extracted = await extractRawFrameMetrics({ projectDir, workDir, videoPath, runCommand });
  if (!extracted.success) {
    return {
      success: false,
      issues: [{ code: 'frame_extract_failed', message: '抽帧失败。' }],
      metrics: {},
      message: '视觉质检失败：抽帧失败。',
      diagnostics: extracted.diagnostics,
      contact_sheet_path: contactSheet.path,
    };
  }
  const result = analyzeFrameMetrics({
    frames: extracted.frames,
    contact_sheet_size: contactSheet.size,
  });
  const finalResult = withAdditionalIssues(result, {
    videoInfo,
    expectedAspectRatio: expectedAspectRatio || expected_aspect_ratio,
    frames: extracted.frames,
  });
  return {
    ...finalResult,
    frames: extracted.frames,
    contact_sheet_path: contactSheet.path,
  };
}

module.exports = {
  analyzeFrameMetrics,
  inspectRenderedVideo,
  aspectFromDimensions,
};
