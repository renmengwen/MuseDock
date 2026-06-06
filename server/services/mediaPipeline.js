const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const aiModelConfig = require('./aiModelConfig');

const DEFAULT_ROOT = path.join(__dirname, '../../data/media/douyin');
const DEFAULT_MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1';
const DEFAULT_MIMO_ASR_MODEL = 'mimo-v2.5-asr';
const MIMO_MAX_BASE64_AUDIO_BYTES = 10 * 1024 * 1024;

function getMediaDir(awemeId, rootDir = DEFAULT_ROOT) {
  return path.join(rootDir, String(awemeId));
}

function getMediaPaths(awemeId, rootDir = DEFAULT_ROOT) {
  const dir = getMediaDir(awemeId, rootDir);
  return {
    dir,
    metadata: path.join(dir, 'metadata.json'),
    video: path.join(dir, 'video.mp4'),
    audio: path.join(dir, 'audio.mp3'),
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

function normalizeProvider(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
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

async function transcribeWithMimo(audioPath, config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const audioBuffer = await fsp.readFile(audioPath);
  const audioBase64 = audioBuffer.toString('base64');
  const maxBase64AudioBytes = options.maxBase64AudioBytes || MIMO_MAX_BASE64_AUDIO_BYTES;

  if (Buffer.byteLength(audioBase64, 'utf-8') > maxBase64AudioBytes) {
    return {
      success: false,
      status: 'audio_too_large',
      message: '音频文件过大，MiMo ASR 要求 base64 编码后的音频不超过 10MB，请先压缩或切片后重试。',
    };
  }

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

async function checkFfmpeg() {
  const result = await runCommand('ffmpeg', ['-version']);
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

async function extractAudio(videoPath, audioPath) {
  const result = await runCommand('ffmpeg', [
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

async function extractFrames(videoPath, framesDir) {
  await fsp.mkdir(framesDir, { recursive: true });
  const framePattern = path.join(framesDir, 'frame-%04d.jpg');
  const result = await runCommand('ffmpeg', [
    '-y',
    '-i', videoPath,
    '-vf', 'fps=1/5',
    '-q:v', '3',
    framePattern,
  ]);
  if (!result.ok) {
    return { status: 'failed', error: result.error || result.stderr || `ffmpeg exited ${result.code}` };
  }
  const frames = await listFrames(framesDir);
  return { status: 'done', path: framesDir, count: frames.length, frames };
}

async function listFrames(framesDir) {
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

async function buildAnalysisInput(awemeId, paths, metadata, steps) {
  const frames = await listFrames(paths.framesDir);
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
      status: steps.transcript?.status || 'not_requested',
      path: await fileExists(paths.transcript) ? paths.transcript : '',
    },
    steps,
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
  const existingFrames = await listFrames(paths.framesDir);
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
      if (!canUseCachedAudio) steps.audio = await extractAudio(paths.video, paths.audio);
      if (!canUseCachedFrames) steps.frames = await extractFrames(paths.video, paths.framesDir);
    }
  }

  const analysisInput = await buildAnalysisInput(awemeId, paths, metadata, steps);
  await writeJson(paths.analysisInput, analysisInput);
  return {
    success: true,
    aweme_id: String(awemeId),
    dir: paths.dir,
    steps,
    analysis_input: analysisInput,
  };
}

async function getStatus(awemeId, options = {}) {
  const paths = getMediaPaths(awemeId, options.rootDir);
  const metadata = await readJsonIfExists(paths.metadata);
  const analysisInput = await readJsonIfExists(paths.analysisInput);
  const transcript = await readJsonIfExists(paths.transcript);
  const frames = await listFrames(paths.framesDir);
  const videoExists = await fileExists(paths.video);
  const audioExists = await fileExists(paths.audio);

  return {
    success: true,
    aweme_id: String(awemeId),
    exists: !!metadata || videoExists || audioExists || frames.length > 0,
    dir: paths.dir,
    metadata: stripRawMetadata(metadata),
    analysis_input: analysisInput,
    transcript,
    frames,
    steps: {
      metadata: metadata ? { status: 'done', path: paths.metadata } : { status: 'missing' },
      video: videoExists ? { status: 'done', path: paths.video } : { status: 'missing' },
      audio: audioExists ? { status: 'done', path: paths.audio } : { status: 'missing' },
      frames: frames.length ? { status: 'done', path: paths.framesDir, count: frames.length } : { status: 'missing' },
      transcript: transcript ? { status: 'done', path: paths.transcript } : { status: 'not_requested' },
    },
  };
}

async function transcribeAudio(awemeId, options = {}) {
  const paths = getMediaPaths(awemeId, options.rootDir);
  const asrConfig = await resolveAsrRuntime(options);
  if (!asrConfig.configured) {
    const result = {
      success: false,
      configured: false,
      aweme_id: String(awemeId),
      message: 'Transcription is not configured. Set OPENAI_API_KEY or ASR_API_KEY to enable ASR.',
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
      message: 'audio.mp3 is not available. Run prepare first.',
      transcript_path: paths.transcript,
    };
  }

  if (asrConfig.provider === 'mimo') {
    const providerResult = await transcribeWithMimo(paths.audio, asrConfig, options);
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
    message: 'ASR provider is configured, but only MiMo ASR is implemented now. Set ASR_PROVIDER=mimo or configure provider as mimo.',
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
  prepareDouyinMedia,
  getStatus,
  transcribeAudio,
  checkFfmpeg,
};
