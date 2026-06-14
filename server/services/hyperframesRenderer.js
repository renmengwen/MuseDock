const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

function getNpxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function runCommand(command, args, options = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, shell: process.platform === 'win32', ...options });
    } catch (error) {
      resolve({ ok: false, code: null, error: error.message, stdout: '', stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      resolve({ ok: false, code: null, error: error.message, stdout, stderr });
    });
    child.on('close', code => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function renderHyperframesProject({ projectDir, renderOptions = {}, runCommand: runCommandImpl = runCommand } = {}) {
  if (!projectDir || !fs.existsSync(path.join(projectDir, 'index.html'))) {
    return {
      success: false,
      message: '渲染失败：未找到 HyperFrames 工程入口 index.html。',
    };
  }

  let result;
  const args = ['hyperframes', 'render'];
  if (renderOptions.fps) {
    args.push('--fps', String(renderOptions.fps));
  }
  try {
    result = await runCommandImpl(getNpxCommand(), args, {
      cwd: projectDir,
    });
  } catch (error) {
    result = { ok: false, code: null, error: error.message, stdout: '', stderr: '' };
  }

  if (!result.ok) {
    return {
      success: false,
      message: `HyperFrames 渲染失败：${result.error || result.stderr || result.stdout || `exit ${result.code}`}`,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const outputPath = path.join(projectDir, 'output.mp4');
  const rendersOutput = findLatestRenderedMp4(projectDir);
  if (!fs.existsSync(outputPath) && rendersOutput) {
    await fsp.copyFile(rendersOutput, outputPath);
  }
  if (!fs.existsSync(outputPath)) {
    return {
      success: false,
      message: 'HyperFrames 渲染失败：未生成 output.mp4。',
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    success: true,
    output_path: outputPath,
    message: '视频渲染完成。',
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function findLatestRenderedMp4(projectDir) {
  const rendersDir = path.join(projectDir, 'renders');
  if (!fs.existsSync(rendersDir)) return '';
  const files = fs.readdirSync(rendersDir)
    .filter(name => name.toLowerCase().endsWith('.mp4'))
    .map(name => {
      const filePath = path.join(rendersDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return files[0]?.filePath || '';
}

function getFfmpegCommand() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

async function muxAudioWithVideo({ videoPath, audioPath, outputPath, runCommand: runCommandImpl = runCommand }) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    return { success: false, message: '混流失败：未找到视频文件。' };
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    return { success: false, message: '混流失败：未找到音频文件。' };
  }

  const output = outputPath || videoPath.replace(/\.mp4$/, '.muxed.mp4');
  const args = [
    '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    output,
  ];

  const result = await runCommandImpl(getFfmpegCommand(), args);
  if (!result.ok) {
    return {
      success: false,
      message: `音频混流失败：${result.stderr || result.error || `exit ${result.code}`}`,
      stderr: result.stderr,
    };
  }

  return { success: true, output_path: output };
}

async function concatAndMuxAudio({ projectDir, videoPath, audioManifest, runCommand: runCommandImpl = runCommand }) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    return { success: false, message: '混流失败：未找到视频文件。' };
  }

  const ttsDir = path.join(projectDir, 'tts');
  const manifestPath = path.join(ttsDir, 'audio_manifest.json');
  let manifest = audioManifest;

  if (!manifest && fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf-8')); } catch {}
  }

  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
  const audioFiles = scenes
    .map(s => s.path || (s.file_name ? path.join(ttsDir, s.file_name) : ''))
    .filter(p => p && fs.existsSync(p));

  if (audioFiles.length === 0) {
    return { success: true, output_path: videoPath, message: '无音频文件，跳过混流。' };
  }

  const concatListPath = path.join(projectDir, 'audio_concat.txt');
  const concatContent = audioFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
  await fsp.writeFile(concatListPath, concatContent, 'utf-8');

  const concatenatedPath = path.join(projectDir, 'narration.wav');
  const concatResult = await runCommandImpl(getFfmpegCommand(), [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', concatenatedPath,
  ]);

  if (!concatResult.ok) {
    return {
      success: false,
      message: `音频拼接失败：${concatResult.stderr || concatResult.error || `exit ${concatResult.code}`}`,
    };
  }

  const muxedPath = videoPath.replace(/\.mp4$/, '.muxed.mp4');
  const muxResult = await muxAudioWithVideo({
    videoPath,
    audioPath: concatenatedPath,
    outputPath: muxedPath,
    runCommand: runCommandImpl,
  });

  if (!muxResult.success) return muxResult;

  await fsp.rename(muxedPath, videoPath);
  return { success: true, output_path: videoPath, message: '音频混流完成。' };
}

module.exports = {
  getNpxCommand,
  runCommand,
  renderHyperframesProject,
  findLatestRenderedMp4,
  muxAudioWithVideo,
  concatAndMuxAudio,
};
