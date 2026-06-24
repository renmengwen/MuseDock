const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const defaultTtsModel = require('./aiTtsModel');
const defaultTtsTimeline = require('./ttsTimeline');
const defaultPhraseTimeline = require('./phraseTimeline');
const defaultAudioQuality = require('./ttsAudioQuality');
const { stripSpeechStageDirections } = require('./speechText');

const DEFAULT_VOICE = 'mimo_default';
const SUPPORTED_VOICES = new Set([
  DEFAULT_VOICE,
  '冰糖',
  '茉莉',
  '苏打',
  '白桃',
  '白桦',
  'Mia',
  'Chloe',
  'Milo',
  'Dean',
]);

function roundTime(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function safeFormat(format) {
  const clean = String(format || '').replace(/[^A-Za-z0-9]/g, '');
  return clean || 'wav';
}

async function getExistingExecutable(filePath) {
  if (!filePath) return null;
  try {
    await fsp.access(filePath, fs.constants.X_OK);
    return filePath;
  } catch {
    try {
      await fsp.access(filePath, fs.constants.F_OK);
      return filePath;
    } catch {
      return null;
    }
  }
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

function getSceneAudioFileName(index, format = 'wav') {
  const sceneIndex = Math.max(1, Number(index) || 1);
  return `scene-${String(sceneIndex).padStart(3, '0')}.${safeFormat(format)}`;
}

function normalizeVoice(voice) {
  const value = String(voice || '').trim();
  return SUPPORTED_VOICES.has(value) ? value : DEFAULT_VOICE;
}

function fail(message, extra = {}) {
  return {
    success: false,
    message,
    ...extra,
  };
}

async function synthesizeSceneTts(options = {}) {
  const scenes = Array.isArray(options.scenes) ? options.scenes : [];
  const outputDir = typeof options.outputDir === 'string' ? options.outputDir : '';
  const runId = String(options.runId || 'run').replace(/[^A-Za-z0-9_-]/g, '') || 'run';
  const format = safeFormat(options.format || 'wav');
  const voice = normalizeVoice(options.voice);
  const stylePrompt = options.stylePrompt || options.style_prompt || '';

  if (!outputDir) {
    return fail('缺少输出目录，无法生成分段配音。');
  }
  if (!scenes.length) {
    return fail('分镜列表为空，无法生成分段配音。');
  }

  const ttsModel = options.ttsModel || defaultTtsModel;
  const ttsTimeline = options.ttsTimeline || defaultTtsTimeline;
  const phraseTimeline = options.phraseTimeline || defaultPhraseTimeline;
  const audioQuality = options.audioQuality || defaultAudioQuality;
  const audioToolOptions = {
    ...(options.audioDurationOptions || {}),
    ffmpegPath: options.ffmpegPath || options.audioDurationOptions?.ffmpegPath,
    ffprobePath: options.ffprobePath || options.audioDurationOptions?.ffprobePath,
  };
  const resolveFfprobePath = typeof ttsTimeline.resolveFfprobePath === 'function'
    ? ttsTimeline.resolveFfprobePath
    : defaultTtsTimeline.resolveFfprobePath;
  const runAudioQualityCommand = options.runCommand || runCommand;
  const getFfprobeCommand = options.getFfprobeCommand || (() => resolveFfprobePath(audioToolOptions));
  const getFfmpegCommand = options.getFfmpegCommand || (() => resolveFfmpegPath(audioToolOptions));
  const concatenateAudioFiles = options.concatenateAudioFiles || ttsTimeline.concatenateAudioFiles;
  const sceneDir = path.join(outputDir, `${runId}-scene-tts`);
  const inputPaths = [];
  const sceneResults = [];
  let model = null;

  await fsp.rm(sceneDir, { recursive: true, force: true });
  await fsp.mkdir(sceneDir, { recursive: true });

  for (const scene of scenes) {
    const sceneIndex = Number(scene?.index || sceneResults.length + 1);
    const text = stripSpeechStageDirections(scene?.narration_text);
    if (!text) {
      return fail(`第 ${sceneIndex} 幕缺少旁白文本，无法生成分段配音。`, { scene_index: sceneIndex, model });
    }

    const ttsResult = await ttsModel.callTtsModel({
      text,
      voice,
      stylePrompt,
      format,
      configPath: options.configPath,
      ttsConfig: options.ttsConfig,
      fetchImpl: options.fetchImpl,
      waitImpl: options.waitImpl,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      ttsConcurrency: options.ttsConcurrency,
      ttsQueueIntervalMs: options.ttsQueueIntervalMs,
    });
    model = ttsResult?.model || model;

    if (!ttsResult?.success) {
      return fail(ttsResult?.message || `第 ${sceneIndex} 幕配音失败。`, {
        scene_index: sceneIndex,
        model,
      });
    }

    const fileName = getSceneAudioFileName(sceneIndex, ttsResult.format || format);
    const filePath = path.join(sceneDir, fileName);
    await fsp.writeFile(filePath, ttsResult.audioBuffer);

    const cleanFileName = fileName.replace(/(\.[^.]+)$/, '.clean$1');
    const cleanPath = path.join(sceneDir, cleanFileName);
    const quality = await audioQuality.inspectAndCleanAudio({
      inputPath: filePath,
      outputPath: cleanPath,
      plannedDurationSec: Number(scene?.duration ?? scene?.duration_sec ?? scene?.target_duration_sec ?? 0),
      runCommand: runAudioQualityCommand,
      getFfprobeCommand,
      getFfmpegCommand,
    });
    if (!quality?.success) {
      return fail(quality?.message || `第 ${sceneIndex} 幕配音时长异常。`, {
        scene_index: sceneIndex,
        code: quality?.code,
        diagnostics: quality,
        model,
      });
    }
    const speechDuration = Number(quality.speech_duration_sec);
    if (!Number.isFinite(speechDuration) || speechDuration <= 0) {
      return fail(quality.message || `第 ${sceneIndex} 幕配音时长无效。`, {
        scene_index: sceneIndex,
        code: quality.code || 'tts_speech_duration_invalid',
        diagnostics: quality,
        model,
      });
    }

    const audioPath = quality.path || filePath;
    const duration = roundTime(speechDuration);
    const captions = ttsTimeline.buildCaptionsFromSegments([
      { index: 1, text, duration, path: audioPath },
    ]);
    const phraseCaptions = phraseTimeline.buildPhraseBlocksFromCaptions(captions);

    inputPaths.push(audioPath);
    sceneResults.push({
      ...scene,
      index: sceneIndex,
      narration_text: text,
      duration,
      actual_duration_sec: duration,
      path: audioPath,
      raw_path: quality.raw_path || filePath,
      raw_duration_sec: quality.raw_duration_sec,
      speech_duration_sec: duration,
      tail_silence_sec: quality.tail_silence_sec || 0,
      trimmed: quality.trimmed === true,
      file_name: path.basename(audioPath),
      captions,
      phrase_captions: phraseCaptions,
    });
  }

  const fileName = `${runId}-tts.${format}`;
  const targetPath = path.join(outputDir, fileName);
  const concatResult = await concatenateAudioFiles({
    inputPaths,
    targetPath,
    options: options.concatenateOptions || {},
  });
  if (!concatResult?.success) {
    return fail(concatResult?.message || '拼接分段配音失败。', { model });
  }

  if (!fs.existsSync(targetPath)) {
    return fail('拼接分段配音失败：未生成目标音频文件。', { model });
  }

  return {
    success: true,
    message: '分段配音已生成。',
    scene_tts: {
      status: 'done',
      voice,
      style_prompt: stylePrompt,
      format,
      path: targetPath,
      file_name: path.basename(targetPath),
      scenes: sceneResults,
      model,
      updated_at: new Date().toISOString(),
    },
  };
}

module.exports = {
  synthesizeSceneTts,
  getSceneAudioFileName,
  normalizeVoice,
};
