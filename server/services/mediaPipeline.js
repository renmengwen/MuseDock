const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const aiModelConfig = require('./aiModelConfig');

const DEFAULT_ROOT = path.join(__dirname, '../../data/media/douyin');
const DEFAULT_MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1';
const DEFAULT_MIMO_ASR_MODEL = 'mimo-v2.5-asr';
const MIMO_MAX_BASE64_AUDIO_BYTES = 10 * 1024 * 1024;
const DEFAULT_ASR_SEGMENT_SECONDS = 180;
const FFMPEG_INSTALLER_PACKAGE = '@ffmpeg-installer/ffmpeg';
const AWEME_ID_PATTERN = /^\d{5,32}$/;

function getMediaDir(awemeId, rootDir = DEFAULT_ROOT) {
  const id = String(awemeId || '');
  if (!AWEME_ID_PATTERN.test(id)) {
    throw new Error('Invalid aweme_id');
  }

  const rootPath = path.resolve(rootDir);
  const dir = path.resolve(rootPath, id);
  const relative = path.relative(rootPath, dir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('aweme_id resolves outside media root');
  }
  return dir;
}

function getMediaPaths(awemeId, rootDir = DEFAULT_ROOT) {
  const dir = getMediaDir(awemeId, rootDir);
  return {
    dir,
    metadata: path.join(dir, 'metadata.json'),
    video: path.join(dir, 'video.mp4'),
    audio: path.join(dir, 'audio.mp3'),
    asrAudio: path.join(dir, 'audio.asr.mp3'),
    asrSegmentsDir: path.join(dir, 'asr_segments'),
    framesDir: path.join(dir, 'frames'),
    analysisInput: path.join(dir, 'analysis_input.json'),
    transcript: path.join(dir, 'transcript.json'),
  };
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getFileInfo(filePath) {
  if (!filePath) return null;
  try {
    const stats = await fsp.stat(filePath);
    if (!stats.isFile()) return null;
    return {
      path: filePath,
      name: path.basename(filePath),
      bytes: stats.size,
      updated_at: stats.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function stripRawMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const { raw, ...rest } = metadata;
  return rest;
}

async function writeJson(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getAudioMimeType(audioPath) {
  const ext = path.extname(audioPath).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  return 'application/octet-stream';
}

async function getBase64AudioBytes(audioPath) {
  const audioBuffer = await fsp.readFile(audioPath);
  const audioBase64 = audioBuffer.toString('base64');
  return {
    audioBase64,
    base64Bytes: Buffer.byteLength(audioBase64, 'utf-8'),
    fileBytes: audioBuffer.length,
  };
}

function normalizeProvider(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
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

async function resolveFfmpegPath(options = {}) {
  const explicitPath = options.ffmpegPath || process.env.FFMPEG_PATH;
  const resolvedExplicitPath = await getExistingExecutable(explicitPath);
  if (resolvedExplicitPath) return resolvedExplicitPath;

  try {
    const installer = require(FFMPEG_INSTALLER_PACKAGE);
    const bundledPath = await getExistingExecutable(installer.path);
    if (bundledPath) return bundledPath;
  } catch {
    // Optional dependency fallback. If it is not installed, use PATH lookup below.
  }

  return 'ffmpeg';
}

async function resolveAsrRuntime(options = {}) {
  const env = options.env || process.env;
  const storedConfig = options.asrConfig || await aiModelConfig.getRuntimeConfig('asr', {
    configPath: options.configPath,
  });
  const storedEnabled = storedConfig?.enabled === true && !!storedConfig.apiKey;
  const provider = normalizeProvider(env.ASR_PROVIDER || env.MIMO_PROVIDER || (storedEnabled ? storedConfig.provider : ''));
  const isMimo = provider === 'mimo' || provider === 'xiaomi' || provider === 'xiaomimimo';

  if (isMimo) {
    return {
      configured: !!(env.MIMO_API_KEY || env.ASR_API_KEY || (storedEnabled ? storedConfig.apiKey : '')),
      provider: 'mimo',
      apiKey: env.MIMO_API_KEY || env.ASR_API_KEY || (storedEnabled ? storedConfig.apiKey : ''),
      baseUrl: (env.MIMO_BASE_URL || env.ASR_BASE_URL || storedConfig?.baseUrl || DEFAULT_MIMO_BASE_URL).replace(/\/+$/, ''),
      modelId: env.MIMO_ASR_MODEL || env.ASR_MODEL || storedConfig?.modelId || DEFAULT_MIMO_ASR_MODEL,
      language: env.ASR_LANGUAGE || env.MIMO_ASR_LANGUAGE || 'auto',
    };
  }

  const legacyApiKey = env.OPENAI_API_KEY || env.ASR_API_KEY || (storedEnabled ? storedConfig.apiKey : '');
  return {
    configured: !!legacyApiKey,
    provider: provider || normalizeProvider(storedConfig?.provider) || '',
    apiKey: legacyApiKey,
    baseUrl: env.ASR_BASE_URL || storedConfig?.baseUrl || '',
    modelId: env.ASR_MODEL || storedConfig?.modelId || '',
    language: env.ASR_LANGUAGE || 'auto',
  };
}

async function sendMimoAudio(audioPath, config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const { audioBase64 } = await getBase64AudioBytes(audioPath);
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': config.apiKey,
    },
    body: JSON.stringify({
      model: config.modelId || DEFAULT_MIMO_ASR_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: `data:${getAudioMimeType(audioPath)};base64,${audioBase64}`,
              },
            },
          ],
        },
      ],
      asr_options: {
        language: config.language || 'auto',
      },
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    return {
      success: false,
      status: 'failed',
      message: `音频转写失败：${detail}`,
      raw_response: payload,
    };
  }

  const text = payload?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') {
    return {
      success: false,
      status: 'failed',
      message: '音频转写失败：MiMo ASR 未返回有效文本。',
      raw_response: payload,
    };
  }

  return {
    success: true,
    status: 'done',
    message: '音频转写完成。',
    text,
    raw_response: payload,
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
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

async function compressAudioForAsr(audioPath, targetPath, options = {}) {
  const runCommandImpl = options.runCommandImpl || runCommand;
  const ffmpegPath = await resolveFfmpegPath(options);
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const result = await runCommandImpl(ffmpegPath, [
    '-y',
    '-i', audioPath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-b:a', '32k',
    targetPath,
  ]);

  if (!result.ok) {
    return {
      success: false,
      status: 'compress_failed',
      message: `音频过大，自动压缩失败：${result.error || result.stderr || `ffmpeg exited ${result.code}`}`,
    };
  }

  return { success: true, status: 'compressed', path: targetPath };
}

async function listAsrSegments(segmentDir) {
  try {
    const names = await fsp.readdir(segmentDir);
    return names
      .filter(name => /^segment-\d+\.mp3$/i.test(name))
      .sort()
      .map(name => path.join(segmentDir, name));
  } catch {
    return [];
  }
}

async function segmentAudioForAsr(audioPath, segmentDir, options = {}) {
  const runCommandImpl = options.runCommandImpl || runCommand;
  const ffmpegPath = await resolveFfmpegPath(options);
  await fsp.rm(segmentDir, { recursive: true, force: true });
  await fsp.mkdir(segmentDir, { recursive: true });
  const segmentPattern = path.join(segmentDir, 'segment-%03d.mp3');
  const result = await runCommandImpl(ffmpegPath, [
    '-y',
    '-i', audioPath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-b:a', '32k',
    '-f', 'segment',
    '-segment_time', String(options.asrSegmentSeconds || DEFAULT_ASR_SEGMENT_SECONDS),
    '-segment_format', 'mp3',
    segmentPattern,
  ]);

  if (!result.ok) {
    return {
      success: false,
      status: 'segment_failed',
      message: `音频压缩后仍过大，自动切片失败：${result.error || result.stderr || `ffmpeg exited ${result.code}`}`,
    };
  }

  const segments = await listAsrSegments(segmentDir);
  if (!segments.length) {
    return {
      success: false,
      status: 'segment_failed',
      message: '音频压缩后仍过大，自动切片失败：未生成可转写的音频片段。',
    };
  }

  const maxBase64AudioBytes = options.maxBase64AudioBytes || MIMO_MAX_BASE64_AUDIO_BYTES;
  const oversizedSegments = [];
  for (const segmentPath of segments) {
    const { base64Bytes } = await getBase64AudioBytes(segmentPath);
    if (base64Bytes > maxBase64AudioBytes) {
      oversizedSegments.push({ path: segmentPath, base64Bytes });
    }
  }

  if (oversizedSegments.length > 0) {
    return {
      success: false,
      status: 'audio_too_large',
      message: '音频已自动压缩并切片，但仍有片段超过 MiMo ASR 的 10MB 限制，请手动缩短音频后重试。',
      oversized_segments: oversizedSegments,
    };
  }

  return { success: true, status: 'segmented', dir: segmentDir, segments };
}

async function transcribeMimoSegments(segmentPaths, config, options = {}) {
  const texts = [];
  const segmentResults = [];

  for (let index = 0; index < segmentPaths.length; index += 1) {
    const segmentPath = segmentPaths[index];
    const result = await sendMimoAudio(segmentPath, config, options);
    segmentResults.push({
      index: index + 1,
      path: segmentPath,
      status: result.status,
      success: result.success,
      text: result.text || '',
      message: result.message || '',
    });

    if (!result.success) {
      return {
        ...result,
        message: `第 ${index + 1} 段音频转写失败：${result.message || 'MiMo ASR 未返回成功结果。'}`,
        segments: segmentResults,
      };
    }

    texts.push(result.text.trim());
  }

  return {
    success: true,
    status: 'done',
    message: '音频较大，已自动压缩并分段转写完成。',
    text: texts.filter(Boolean).join('\n'),
    segments: segmentResults,
  };
}

async function transcribeWithMimo(audioPath, config, options = {}) {
  const maxBase64AudioBytes = options.maxBase64AudioBytes || MIMO_MAX_BASE64_AUDIO_BYTES;
  const paths = options.paths || {};
  const asrAudioPath = paths.asrAudio || path.join(path.dirname(audioPath), 'audio.asr.mp3');
  const asrSegmentsDir = paths.asrSegmentsDir || path.join(path.dirname(audioPath), 'asr_segments');
  const audioInfo = await getBase64AudioBytes(audioPath);

  if (audioInfo.base64Bytes <= maxBase64AudioBytes) {
    return sendMimoAudio(audioPath, config, options);
  }

  const compressed = await compressAudioForAsr(audioPath, asrAudioPath, options);
  if (!compressed.success) {
    return {
      ...compressed,
      preprocess: {
        status: 'compress_failed',
        source_path: audioPath,
        source_base64_bytes: audioInfo.base64Bytes,
      },
    };
  }

  const compressedInfo = await getBase64AudioBytes(asrAudioPath);
  if (compressedInfo.base64Bytes <= maxBase64AudioBytes) {
    const result = await sendMimoAudio(asrAudioPath, config, options);
    return {
      ...result,
      message: result.success ? '音频较大，已自动压缩后转写完成。' : result.message,
      preprocess: {
        status: 'compressed',
        source_path: audioPath,
        source_base64_bytes: audioInfo.base64Bytes,
        audio_path: asrAudioPath,
        base64_bytes: compressedInfo.base64Bytes,
      },
    };
  }

  const segmented = await segmentAudioForAsr(asrAudioPath, asrSegmentsDir, {
    ...options,
    maxBase64AudioBytes,
  });
  if (!segmented.success) {
    return {
      ...segmented,
      preprocess: {
        status: segmented.status,
        source_path: audioPath,
        source_base64_bytes: audioInfo.base64Bytes,
        compressed_path: asrAudioPath,
        compressed_base64_bytes: compressedInfo.base64Bytes,
      },
    };
  }

  const result = await transcribeMimoSegments(segmented.segments, config, options);
  return {
    ...result,
    preprocess: {
      status: 'segmented',
      source_path: audioPath,
      source_base64_bytes: audioInfo.base64Bytes,
      compressed_path: asrAudioPath,
      compressed_base64_bytes: compressedInfo.base64Bytes,
      segments_dir: asrSegmentsDir,
      segment_count: segmented.segments.length,
    },
  };
}

async function checkFfmpeg() {
  const ffmpegPath = await resolveFfmpegPath();
  const result = await runCommand(ffmpegPath, ['-version']);
  return {
    available: result.ok,
    error: result.ok ? '' : (result.error || result.stderr || 'ffmpeg is not available'),
  };
}

async function downloadFile(url, targetPath, options = {}) {
  if (!options.force && await fileExists(targetPath)) {
    return { status: 'exists', path: targetPath };
  }
  if (!url) {
    return { status: 'skipped', message: 'No download URL available' };
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      Referer: options.referer || 'https://www.douyin.com/',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.writeFile(targetPath, buffer);
  return { status: 'done', path: targetPath, bytes: buffer.length };
}

async function extractAudio(videoPath, audioPath, options = {}) {
  const ffmpegPath = await resolveFfmpegPath(options);
  const result = await runCommand(ffmpegPath, [
    '-y',
    '-i', videoPath,
    '-vn',
    '-acodec', 'libmp3lame',
    '-q:a', '4',
    audioPath,
  ]);
  if (!result.ok) {
    return { status: 'failed', error: result.error || result.stderr || `ffmpeg exited ${result.code}` };
  }
  return { status: 'done', path: audioPath };
}

async function extractFrames(videoPath, framesDir, options = {}) {
  await fsp.mkdir(framesDir, { recursive: true });
  const framePattern = path.join(framesDir, 'frame-%04d.jpg');
  const ffmpegPath = await resolveFfmpegPath(options);
  const result = await runCommand(ffmpegPath, [
    '-y',
    '-i', videoPath,
    '-vf', 'fps=1/5',
    '-q:v', '3',
    framePattern,
  ]);
  if (!result.ok) {
    return { status: 'failed', error: result.error || result.stderr || `ffmpeg exited ${result.code}` };
  }
  const frames = await listFramePaths(framesDir);
  return { status: 'done', path: framesDir, count: frames.length, frames };
}

async function listFramePaths(framesDir) {
  try {
    const names = await fsp.readdir(framesDir);
    return names
      .filter(name => /\.(jpg|jpeg|png)$/i.test(name))
      .sort()
      .map(name => path.join(framesDir, name));
  } catch {
    return [];
  }
}

async function listFrameAssets(framesDir, awemeId = '') {
  const framePaths = await listFramePaths(framesDir);
  const frames = [];
  for (const framePath of framePaths) {
    const info = await getFileInfo(framePath);
    if (!info) continue;
    frames.push({
      ...info,
      preview_url: awemeId
        ? `/api/media/douyin/${encodeURIComponent(String(awemeId))}/files/frames/${encodeURIComponent(info.name)}`
        : '',
    });
  }
  return frames;
}

async function buildAnalysisInput(awemeId, paths, metadata, steps) {
  const frames = await listFramePaths(paths.framesDir);
  const transcript = await readJsonIfExists(paths.transcript);
  const transcriptStep = transcript
    ? { status: transcript.status || (transcript.success ? 'done' : 'failed'), path: paths.transcript, message: transcript.message || '' }
    : (steps.transcript || { status: 'not_requested' });
  return {
    aweme_id: String(awemeId),
    video: {
      title: metadata.title || '',
      description: metadata.description || '',
      author: metadata.author || {},
      statistics: metadata.statistics || {},
      aweme_url: metadata.aweme_url || '',
    },
    local_assets: {
      dir: paths.dir,
      metadata: paths.metadata,
      video: await fileExists(paths.video) ? paths.video : '',
      audio: await fileExists(paths.audio) ? paths.audio : '',
      frames,
    },
    comments_summary: {
      status: 'placeholder',
      message: 'Comment analysis is not connected yet.',
    },
    transcript: {
      status: transcriptStep.status || 'not_requested',
      path: await fileExists(paths.transcript) ? paths.transcript : '',
    },
    steps: {
      ...steps,
      transcript: transcriptStep,
    },
    updated_at: new Date().toISOString(),
  };
}

async function prepareDouyinMedia(awemeId, metadata, options = {}) {
  const paths = getMediaPaths(awemeId, options.rootDir);
  await fsp.mkdir(paths.framesDir, { recursive: true });
  await writeJson(paths.metadata, metadata);
  const force = !!options.force;

  const steps = {
    metadata: { status: 'done', path: paths.metadata },
    video: { status: 'pending' },
    ffmpeg: { status: 'pending' },
    audio: { status: 'pending' },
    frames: { status: 'pending' },
    transcript: { status: 'not_requested' },
  };

  try {
    steps.video = await downloadFile(metadata.video_download_url, paths.video, {
      referer: metadata.aweme_url,
      userAgent: options.userAgent,
      force,
    });
  } catch (error) {
    steps.video = { status: 'failed', error: error.message };
  }

  const ffmpeg = typeof options.ffmpegAvailable === 'boolean'
    ? { available: options.ffmpegAvailable, error: options.ffmpegAvailable ? '' : 'ffmpeg is not available' }
    : await checkFfmpeg();
  steps.ffmpeg = ffmpeg.available
    ? { status: 'available' }
    : { status: 'unavailable', error: ffmpeg.error };

  const hasVideo = await fileExists(paths.video);
  const hasAudio = await fileExists(paths.audio);
  const existingFrames = await listFramePaths(paths.framesDir);
  if (!hasVideo) {
    steps.audio = { status: 'skipped', message: 'video.mp4 is not available' };
    steps.frames = { status: 'skipped', message: 'video.mp4 is not available' };
  } else {
    const canUseCachedAudio = !force && hasAudio;
    const canUseCachedFrames = !force && existingFrames.length > 0;

    steps.audio = canUseCachedAudio ? { status: 'exists', path: paths.audio } : steps.audio;
    steps.frames = canUseCachedFrames
      ? { status: 'exists', path: paths.framesDir, count: existingFrames.length, frames: existingFrames }
      : steps.frames;

    if (!ffmpeg.available) {
      if (!canUseCachedAudio) steps.audio = { status: 'skipped', message: 'ffmpeg is not available' };
      if (!canUseCachedFrames) steps.frames = { status: 'skipped', message: 'ffmpeg is not available' };
    } else {
      if (!canUseCachedAudio) steps.audio = await extractAudio(paths.video, paths.audio, options);
      if (!canUseCachedFrames) steps.frames = await extractFrames(paths.video, paths.framesDir, options);
    }
  }

  const analysisInput = await buildAnalysisInput(awemeId, paths, metadata, steps);
  await writeJson(paths.analysisInput, analysisInput);
  return {
    success: true,
    aweme_id: String(awemeId),
    dir: paths.dir,
    steps: analysisInput.steps,
    analysis_input: analysisInput,
  };
}

async function getStatus(awemeId, options = {}) {
  const paths = getMediaPaths(awemeId, options.rootDir);
  const metadata = await readJsonIfExists(paths.metadata);
  const analysisInput = await readJsonIfExists(paths.analysisInput);
  const transcript = await readJsonIfExists(paths.transcript);
  const frames = await listFrameAssets(paths.framesDir, awemeId);
  const metadataInfo = await getFileInfo(paths.metadata);
  const videoInfo = await getFileInfo(paths.video);
  const audioInfo = await getFileInfo(paths.audio);
  const transcriptInfo = await getFileInfo(paths.transcript);
  const videoExists = !!videoInfo;
  const audioExists = !!audioInfo;

  return {
    success: true,
    aweme_id: String(awemeId),
    exists: !!metadata || videoExists || audioExists || frames.length > 0,
    dir: paths.dir,
    metadata: stripRawMetadata(metadata),
    analysis_input: analysisInput,
    transcript,
    frames,
    assets: {
      dir: { path: paths.dir, exists: fs.existsSync(paths.dir) },
      metadata: metadataInfo,
      video: videoInfo,
      audio: audioInfo,
      transcript: transcriptInfo,
      frames_dir: { path: paths.framesDir, exists: fs.existsSync(paths.framesDir), count: frames.length },
    },
    steps: {
      metadata: metadata ? { status: 'done', path: paths.metadata } : { status: 'missing' },
      video: videoExists ? { status: 'done', path: paths.video } : { status: 'missing' },
      audio: audioExists ? { status: 'done', path: paths.audio } : { status: 'missing' },
      frames: frames.length ? { status: 'done', path: paths.framesDir, count: frames.length } : { status: 'missing' },
      transcript: transcript ? { status: 'done', path: paths.transcript } : { status: 'not_requested' },
    },
  };
}

function resolveMediaOpenTarget(awemeId, target = 'dir', options = {}) {
  const paths = getMediaPaths(awemeId, options.rootDir);
  const targetMap = {
    dir: paths.dir,
    metadata: paths.metadata,
    video: paths.video,
    audio: paths.audio,
    frames: paths.framesDir,
    transcript: paths.transcript,
  };
  const targetPath = targetMap[target];
  if (!targetPath) {
    throw new Error('Unsupported media target');
  }

  const rootPath = path.resolve(paths.dir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(rootPath, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Media target is outside asset directory');
  }
  return resolvedTarget;
}

async function openInExplorer(awemeId, target = 'dir', options = {}) {
  const targetPath = resolveMediaOpenTarget(awemeId, target, options);
  const stats = await fsp.stat(targetPath);
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32'
    ? [
      '/c',
      'start',
      '',
      'explorer.exe',
      stats.isDirectory() ? targetPath : `/select,${targetPath}`,
    ]
    : [stats.isDirectory() ? targetPath : path.dirname(targetPath)];

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve();
    }, 250);
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 || process.platform === 'win32') {
        resolve();
        return;
      }
      reject(new Error(`Open command exited with code ${code}`));
    });
  });
  return { success: true, path: targetPath };
}

function resolveFrameFile(awemeId, frameName, options = {}) {
  const paths = getMediaPaths(awemeId, options.rootDir);
  const name = String(frameName || '');
  if (!name || path.basename(name) !== name) {
    throw new Error('Invalid frame name');
  }
  const targetPath = path.resolve(paths.framesDir, name);
  const framesRoot = path.resolve(paths.framesDir);
  const relative = path.relative(framesRoot, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Frame file is outside frames directory');
  }
  const allowedFrames = fs.existsSync(paths.framesDir)
    ? fs.readdirSync(paths.framesDir)
      .filter(item => /\.(jpg|jpeg|png)$/i.test(item))
      .map(item => path.basename(item))
    : [];
  if (!allowedFrames.includes(name)) {
    throw new Error('Frame file is not available');
  }
  const stats = fs.statSync(targetPath);
  if (!stats.isFile()) {
    throw new Error('Frame file is not available');
  }
  return targetPath;
}

async function transcribeAudio(awemeId, options = {}) {
  const paths = getMediaPaths(awemeId, options.rootDir);
  const asrConfig = await resolveAsrRuntime(options);
  if (!asrConfig.configured) {
    const result = {
      success: false,
      configured: false,
      aweme_id: String(awemeId),
      message: '音频转写未配置。请设置 OPENAI_API_KEY 或 ASR_API_KEY 后再启用 ASR。',
      transcript_path: paths.transcript,
    };
    await writeJson(paths.transcript, {
      ...result,
      status: 'not_configured',
      updated_at: new Date().toISOString(),
    });
    return result;
  }

  if (!(await fileExists(paths.audio))) {
    return {
      success: false,
      configured: true,
      aweme_id: String(awemeId),
      message: 'audio.mp3 不存在，请先准备素材。',
      transcript_path: paths.transcript,
    };
  }

  if (asrConfig.provider === 'mimo') {
    const providerResult = await transcribeWithMimo(paths.audio, asrConfig, {
      ...options,
      paths,
    });
    const result = {
      ...providerResult,
      configured: true,
      provider: 'mimo',
      model: asrConfig.modelId || DEFAULT_MIMO_ASR_MODEL,
      aweme_id: String(awemeId),
      transcript_path: paths.transcript,
    };
    await writeJson(paths.transcript, {
      ...result,
      audio_path: paths.audio,
      updated_at: new Date().toISOString(),
    });
    return result;
  }

  const result = {
    success: false,
    configured: true,
    aweme_id: String(awemeId),
    message: 'ASR 服务已配置，但当前只实现了 MiMo ASR。请将 ASR_PROVIDER 设置为 mimo，或在设置页将供应商配置为 mimo。',
    transcript_path: paths.transcript,
  };
  await writeJson(paths.transcript, {
    ...result,
    status: 'provider_not_implemented',
    audio_path: paths.audio,
    updated_at: new Date().toISOString(),
  });
  return result;
}

module.exports = {
  DEFAULT_ROOT,
  getMediaDir,
  getMediaPaths,
  resolveMediaOpenTarget,
  openInExplorer,
  resolveFrameFile,
  prepareDouyinMedia,
  getStatus,
  transcribeAudio,
  checkFfmpeg,
};
