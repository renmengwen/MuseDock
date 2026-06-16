const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

function getFfmpegCommand(options = {}) {
  if (options.ffmpegPath) return options.ffmpegPath;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return require('@ffmpeg-installer/ffmpeg').path;
  } catch {
    return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  }
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

async function concatFramesWithFfmpeg(frameMp4s, outputPath, workDir, opts = {}) {
  const frames = Array.isArray(frameMp4s) ? frameMp4s : [];
  if (!frames.length) {
    return { success: false, message: '没有可拼接的视频帧。' };
  }
  const runCommandImpl = opts.runCommand || runCommand;
  const ffmpeg = getFfmpegCommand(opts);
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
  inputs.forEach((input, index) => {
    const streamIndex = index + 1;
    const label = input.role === 'music' ? 'music' : 'narration';
    const volume = input.role === 'music' ? options.musicVolumeDb : options.narrationVolumeDb;
    const fadeIn = Number(options.fadeInSec || 0);
    const fadeOut = Number(options.fadeOutSec || 0);
    const duration = Number(options.videoDurationSec || 0);
    const outLabel = `${label}${index}`;
    const filters = [`volume=${Number(volume || 0)}dB`];
    if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn}`);
    if (fadeOut > 0 && duration > fadeOut) filters.push(`afade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}`);
    chains.push(`[${streamIndex}:a]${filters.join(',')}[${outLabel}]`);
  });
  const mixInputs = inputs.map((input, index) => `[${input.role === 'music' ? 'music' : 'narration'}${index}]`).join('');
  chains.push(`${mixInputs}amix=inputs=${inputs.length}:duration=first:dropout_transition=0[aout]`);
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
  const ffmpeg = getFfmpegCommand({ ffmpegPath });
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
  muxAudioWithFfmpeg,
  getFfmpegCommand,
  escapeConcatPath,
};
