const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function roundTime(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function stripNarrationLabel(line) {
  const text = String(line || '').trim();
  if (!text) return '';

  if (/^(开头|片头|引子|导语|正文|主体|结尾|片尾|总结)\s*[:：]\s*$/.test(text)) {
    return '';
  }
  if (/^第[一二三四五六七八九十\d]+部分\s*[:：]/.test(text)) {
    return '';
  }

  return text.replace(/^(开头|片头|引子|导语|正文|主体|结尾|片尾|总结)\s*[:：]\s*/, '').trim();
}

function normalizeNarrationScript(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(stripNarrationLabel)
    .filter(Boolean)
    .join('\n');
}

function splitScriptIntoSentences(text) {
  const input = normalizeNarrationScript(text).trim();
  if (!input) return [];

  const normalized = input
    .replace(/[ \t]+/g, ' ')
    .trim();

  const matches = normalized.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [];
  return matches
    .map(item => item.trim())
    .filter(Boolean);
}

function buildCaptionsFromSegments(segments = []) {
  let cursor = 0;
  return segments.map((segment, index) => {
    const duration = roundTime(segment.duration);
    const start = roundTime(cursor);
    const end = roundTime(cursor + duration);
    cursor = end;
    return {
      index: Number(segment.index || index + 1),
      start,
      end,
      duration,
      text: typeof segment.text === 'string' ? segment.text : '',
    };
  });
}

async function getExistingExecutable(filePath) {
  if (!filePath) return '';
  try {
    const stats = await fsp.stat(filePath);
    return stats.isFile() && stats.size > 0 ? filePath : '';
  } catch {
    return '';
  }
}

async function resolveFfprobePath(options = {}) {
  const explicitPath = options.ffprobePath || process.env.FFPROBE_PATH;
  const resolvedExplicitPath = await getExistingExecutable(explicitPath);
  if (resolvedExplicitPath) return resolvedExplicitPath;

  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    const siblingName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const siblingPath = path.join(path.dirname(installer.path), siblingName);
    const resolvedSiblingPath = await getExistingExecutable(siblingPath);
    if (resolvedSiblingPath) return resolvedSiblingPath;
  } catch {
    // Optional dependency fallback. If it is not installed, use PATH lookup below.
  }

  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
}

function runCommand(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { windowsHide: true, ...options });
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

async function readAudioDuration(filePath, options = {}) {
  const ffprobePath = await resolveFfprobePath(options);
  const result = await runCommand(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);

  if (!result.ok) {
    const detail = result.error || result.stderr || `ffprobe exited ${result.code}`;
    return {
      success: false,
      message: detail && /not found|not recognized|ENOENT|spawn/i.test(detail)
        ? '未找到 ffprobe，无法读取分段音频时长。请配置 FFPROBE_PATH 或安装 ffprobe。'
        : `读取音频时长失败：${detail}`,
    };
  }

  const duration = Number.parseFloat(String(result.stdout || '').trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    return {
      success: false,
      message: '读取音频时长失败：ffprobe 未返回有效时长。',
    };
  }

  return {
    success: true,
    duration: roundTime(duration),
  };
}

async function resolveFfmpegPath(options = {}) {
  const explicitPath = options.ffmpegPath || process.env.FFMPEG_PATH;
  const resolvedExplicitPath = await getExistingExecutable(explicitPath);
  if (resolvedExplicitPath) return resolvedExplicitPath;

  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    const bundledPath = await getExistingExecutable(installer.path);
    if (bundledPath) return bundledPath;
  } catch {
    // Optional dependency fallback. If it is not installed, use PATH lookup below.
  }

  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function escapeConcatPath(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''");
}

async function concatenateAudioFiles({ inputPaths, targetPath, options = {} }) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    return { success: false, message: '没有可拼接的 TTS 分段音频。' };
  }

  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const listPath = path.join(path.dirname(targetPath), `${path.basename(targetPath)}.concat.txt`);
  const listText = inputPaths
    .map(item => `file '${escapeConcatPath(item)}'`)
    .join('\n');
  await fsp.writeFile(listPath, listText, 'utf-8');

  const ffmpegPath = await resolveFfmpegPath(options);
  const result = await runCommand(ffmpegPath, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    targetPath,
  ]);

  await fsp.rm(listPath, { force: true });

  if (!result.ok) {
    const detail = result.error || result.stderr || `ffmpeg exited ${result.code}`;
    return {
      success: false,
      message: `拼接 TTS 分段音频失败：${detail}`,
    };
  }

  if (!fs.existsSync(targetPath)) {
    return { success: false, message: '拼接 TTS 分段音频失败：未生成目标音频文件。' };
  }

  return { success: true, path: targetPath };
}

module.exports = {
  normalizeNarrationScript,
  splitScriptIntoSentences,
  buildCaptionsFromSegments,
  resolveFfprobePath,
  readAudioDuration,
  concatenateAudioFiles,
};
