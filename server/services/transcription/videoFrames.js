const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { resolveFfmpegPath, resolveFfprobePath } = require('../tts/ttsTimeline');
const { TranscriptionError } = require('./funasr');

const MAX_FRAME_COUNT = 100;

function runCommand(command, args, timeout) {
  return new Promise(resolve => {
    const child = spawn(command, args, { windowsHide: true, timeout });
    let stdout = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.resume();
    child.once('error', () => resolve({ ok: false, stdout }));
    child.once('close', code => resolve({ ok: code === 0, stdout }));
  });
}

async function hasImage(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch { return false; }
}

async function extractVideoFrames(videoPath, framesDir, options = {}) {
  const { frameCount } = options;
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > MAX_FRAME_COUNT) {
    throw new TranscriptionError('INVALID_FRAME_COUNT', `抽帧数量必须是 1 到 ${MAX_FRAME_COUNT} 之间的整数。`);
  }
  const execute = options.runCommandImpl || runCommand;
  const timeout = options.mediaTimeoutMs || 180000;
  const probe = await execute(await resolveFfprobePath(options), [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=duration:format=duration', '-of', 'json', videoPath,
  ], timeout);
  let info;
  try { if (probe.ok) info = JSON.parse(probe.stdout); } catch {}
  const streamDuration = Number(info?.streams?.[0]?.duration);
  const duration = Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : Number(info?.format?.duration);
  if (!info?.streams?.length || !Number.isFinite(duration) || duration <= 0) {
    throw new TranscriptionError('VIDEO_DURATION_INVALID', '无法读取视频时长，请检查视频文件和 ffprobe 配置。');
  }

  const ffmpeg = await resolveFfmpegPath(options);
  await fsp.mkdir(framesDir, { recursive: true });
  const interval = duration / frameCount;
  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    // 从 0 秒起等间隔采样，最后一个时间点始终小于视频总时长。
    const timestamp = index * interval;
    const filePath = path.join(framesDir, `frame-${String(index + 1).padStart(4, '0')}.jpg`);
    const capture = (seek, filters = []) => execute(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-ss', seek.toFixed(6), '-i', videoPath, '-map', '0:v:0',
      ...filters, '-frames:v', '1', '-q:v', '2', '-update', '1', filePath,
    ], timeout);
    let result = await capture(timestamp);
    // 极短视频或密集采样可能落在最后一帧的显示区间；保留该区间实际显示的末帧。
    if (result.ok && !await hasImage(filePath)) {
      result = await capture(Math.max(0, duration - 1), ['-vf', 'reverse']);
    }
    if (!result.ok || !await hasImage(filePath)) {
      throw new TranscriptionError('FRAME_EXTRACTION_FAILED', `第 ${index + 1} 张截图未生成，请检查视频文件、ffmpeg 配置与磁盘空间。`);
    }
    const frame = { index: index + 1, timestampMs: Number((timestamp * 1000).toFixed(3)), path: filePath };
    frames.push(frame);
    await options.onFrame?.(frame);
  }
  return { durationMs: Number((duration * 1000).toFixed(3)), intervalMs: Number((interval * 1000).toFixed(3)), frames };
}

module.exports = { extractVideoFrames, MAX_FRAME_COUNT };
