const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function findFfmpegOnPath(runCommandImpl) {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = await runCommandImpl(finder, ['ffmpeg']);
  if (!result.ok) return '';
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) || '';
}

async function getFfmpegCommand(options = {}) {
  if (options.ffmpegPath) return options.ffmpegPath;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const runCommandImpl = options.runCommand || runCommand;
  const pathFfmpeg = await findFfmpegOnPath(runCommandImpl);
  if (pathFfmpeg) return pathFfmpeg;
  try {
    return require('@ffmpeg-installer/ffmpeg').path;
  } catch {
    return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  }
}

async function getFfprobeCommand(options = {}) {
  if (options.ffprobePath) return options.ffprobePath;
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const ffmpegPath = options.ffmpegPath || await getFfmpegCommand(options);
  if (ffmpegPath && (ffmpegPath.includes(path.sep) || path.isAbsolute(ffmpegPath))) {
    const adjacent = path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fsSync.existsSync(adjacent)) return adjacent;
  }
  try {
    const installerPath = require('@ffmpeg-installer/ffmpeg').path;
    const adjacent = path.join(path.dirname(installerPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fsSync.existsSync(adjacent)) return adjacent;
  } catch {
    // Fall through to PATH lookup.
  }
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
}

function runCommand(command, args, options = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, ...options });
    } catch (error) {
      resolve({ ok: false, code: null, error: error.message, stdout: '', stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', error => resolve({ ok: false, code: null, error: error.message, stdout, stderr }));
    child.on('close', code => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

async function verifyDurationWithFfprobe({
  videoPath,
  expectedDurationSec,
  toleranceSec = 1,
  runCommand: runCommandImpl = runCommand,
  ffprobePath,
} = {}) {
  const expected = Number(expectedDurationSec);
  if (!videoPath || !Number.isFinite(expected) || expected <= 0) {
    return { success: true, skipped: true, message: '未提供期望时长，跳过 ffprobe 时长校验。' };
  }

  const ffprobe = await getFfprobeCommand({ ffprobePath, runCommand: runCommandImpl });
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ];
  const result = await runCommandImpl(ffprobe, args);
  if (!result.ok) {
    return {
      success: true,
      skipped: true,
      code: 'ffprobe_unavailable',
      message: `ffprobe 不可用，已跳过导出时长校验：${result.stderr || result.error || `ffprobe exited ${result.code}`}`,
      args,
    };
  }

  const actual = Number.parseFloat(String(result.stdout || '').trim());
  if (!Number.isFinite(actual)) {
    return {
      success: false,
      code: 'duration_probe_invalid',
      message: 'ffprobe 未返回有效的视频时长。',
      args,
      stdout: result.stdout || '',
    };
  }

  const diff = Math.abs(actual - expected);
  if (diff > Number(toleranceSec || 1)) {
    return {
      success: false,
      code: 'duration_mismatch',
      message: `导出视频时长偏差过大：期望 ${expected.toFixed(2)} 秒，实际 ${actual.toFixed(2)} 秒。`,
      expected_duration_sec: expected,
      duration_sec: actual,
      diff_sec: diff,
      tolerance_sec: Number(toleranceSec || 1),
      args,
    };
  }

  return {
    success: true,
    duration_sec: actual,
    expected_duration_sec: expected,
    diff_sec: diff,
    tolerance_sec: Number(toleranceSec || 1),
    args,
  };
}

function sameEncoding(frameMp4s) {
  if (!frameMp4s.length) return true;
  const first = frameMp4s[0];
  return frameMp4s.every(item => (
    item.engine === first.engine
    && (item.encoding || 'h264-yuv420p-crf20') === (first.encoding || 'h264-yuv420p-crf20')
  ));
}

function escapeConcatPath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/'/g, "'\\''");
}

async function writeConcatList(frameMp4s, workDir) {
  const framesDir = path.join(workDir, 'frames');
  await fs.mkdir(framesDir, { recursive: true });
  const listPath = path.join(framesDir, 'concat.txt');
  const content = frameMp4s
    .map(item => `file '${escapeConcatPath(item.path || item)}'`)
    .join('\n');
  await fs.writeFile(listPath, `${content}\n`, 'utf8');
  return listPath;
}

async function writeAudioConcatList(audioFiles, workDir) {
  const audioDir = path.join(workDir, 'audio');
  await fs.mkdir(audioDir, { recursive: true });
  const listPath = path.join(audioDir, 'concat.txt');
  const content = audioFiles
    .map(item => `file '${escapeConcatPath(item.path || item)}'`)
    .join('\n');
  await fs.writeFile(listPath, `${content}\n`, 'utf8');
  return listPath;
}

async function concatAudioWithFfmpeg(audioFiles, outputPath, workDir, opts = {}) {
  const files = Array.isArray(audioFiles) ? audioFiles : [];
  if (!files.length) {
    return { success: false, message: '没有可拼接的旁白音频。' };
  }
  if (files.length === 1) {
    return { success: true, skipped: true, output_path: files[0].path || files[0], message: '只有一段旁白音频，跳过拼接。' };
  }
  const runCommandImpl = opts.runCommand || runCommand;
  const ffmpeg = await getFfmpegCommand(opts);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const listPath = await writeAudioConcatList(files, workDir);
  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    outputPath,
  ];
  const result = await runCommandImpl(ffmpeg, args);
  if (!result.ok) {
    return {
      success: false,
      message: `旁白音频拼接失败：${result.stderr || result.error || `ffmpeg exited ${result.code}`}`,
      stderr: result.stderr || '',
    };
  }
  return { success: true, output_path: outputPath, args };
}

async function concatFramesWithFfmpeg(frameMp4s, outputPath, workDir, opts = {}) {
  const frames = Array.isArray(frameMp4s) ? frameMp4s : [];
  if (!frames.length) {
    return { success: false, message: '没有可拼接的视频帧。' };
  }
  const runCommandImpl = opts.runCommand || runCommand;
  const ffmpeg = await getFfmpegCommand(opts);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  let args;
  let strategy;
  if (sameEncoding(frames)) {
    strategy = 'concat-demuxer';
    const listPath = await writeConcatList(frames, workDir);
    args = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      outputPath,
    ];
  } else {
    strategy = 'concat-filter';
    const fps = String(opts.fps || 30);
    const inputArgs = frames.flatMap(item => ['-i', item.path || item]);
    const labels = frames.map((_, index) => `[${index}:v]`).join('');
    args = [
      '-y',
      ...inputArgs,
      '-filter_complex', `${labels}concat=n=${frames.length}:v=1:a=0[v]`,
      '-map', '[v]',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-r', fps,
      '-movflags', '+faststart',
      outputPath,
    ];
  }

  const result = await runCommandImpl(ffmpeg, args);
  if (!result.ok) {
    return {
      success: false,
      strategy,
      message: `视频拼接失败：${result.stderr || result.error || `ffmpeg exited ${result.code}`}`,
      stderr: result.stderr || '',
    };
  }
  return { success: true, strategy, output_path: outputPath, args };
}

function audioInputs({ narrationPath, musicPath }) {
  const inputs = [];
  if (narrationPath) inputs.push({ role: 'narration', path: narrationPath });
  if (musicPath) inputs.push({ role: 'music', path: musicPath });
  return inputs;
}

function buildAudioFilter(inputs, options) {
  const chains = [];
  const duration = Number(options.videoDurationSec || 0);
  inputs.forEach((input, index) => {
    const streamIndex = index + 1;
    const label = input.role === 'music' ? 'music' : 'narration';
    const volume = input.role === 'music' ? options.musicVolumeDb : options.narrationVolumeDb;
    const fadeIn = Number(options.fadeInSec || 0);
    const fadeOut = Number(options.fadeOutSec || 0);
    const outLabel = `${label}${index}`;
    const filters = [`volume=${Number(volume || 0)}dB`];
    if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn}`);
    if (fadeOut > 0 && duration > fadeOut) filters.push(`afade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}`);
    chains.push(`[${streamIndex}:a]${filters.join(',')}[${outLabel}]`);
  });
  const mixInputs = inputs.map((input, index) => `[${input.role === 'music' ? 'music' : 'narration'}${index}]`).join('');
  chains.push(`${mixInputs}amix=inputs=${inputs.length}:duration=longest:dropout_transition=0[mixed]`);
  chains.push(duration > 0 ? `[mixed]apad=whole_dur=${duration}[aout]` : '[mixed]anull[aout]');
  return chains.join(';');
}

async function muxAudioWithFfmpeg({
  videoPath,
  outputPath,
  musicPath = null,
  narrationPath = null,
  musicVolumeDb = -18,
  narrationVolumeDb = 0,
  fadeInSec = 0,
  fadeOutSec = 1.5,
  videoDurationSec = 0,
  runCommand: runCommandImpl = runCommand,
  ffmpegPath,
} = {}) {
  const inputs = audioInputs({ narrationPath, musicPath });
  if (!inputs.length) {
    return { success: true, skipped: true, output_path: videoPath, message: '无音频文件，跳过混流。' };
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const ffmpeg = await getFfmpegCommand({ ffmpegPath, runCommand: runCommandImpl });
  const args = [
    '-y',
    '-i', videoPath,
    ...inputs.flatMap(input => ['-i', input.path]),
    '-filter_complex', buildAudioFilter(inputs, {
      musicVolumeDb,
      narrationVolumeDb,
      fadeInSec,
      fadeOutSec,
      videoDurationSec,
    }),
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    outputPath,
  ];

  const result = await runCommandImpl(ffmpeg, args);
  if (!result.ok) {
    return {
      success: false,
      message: `音频混流失败：${result.stderr || result.error || `ffmpeg exited ${result.code}`}`,
      stderr: result.stderr || '',
    };
  }
  return { success: true, output_path: outputPath, args };
}

module.exports = {
  concatFramesWithFfmpeg,
  concatAudioWithFfmpeg,
  muxAudioWithFfmpeg,
  verifyDurationWithFfprobe,
  getFfmpegCommand,
  getFfprobeCommand,
  escapeConcatPath,
};
