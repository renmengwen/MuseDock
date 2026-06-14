const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const defaultTtsModel = require('./aiTtsModel');
const defaultTtsTimeline = require('./ttsTimeline');
const defaultPhraseTimeline = require('./phraseTimeline');

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
  const readAudioDuration = options.readAudioDuration || ttsTimeline.readAudioDuration;
  const concatenateAudioFiles = options.concatenateAudioFiles || ttsTimeline.concatenateAudioFiles;
  const sceneDir = path.join(outputDir, `${runId}-scene-tts`);
  const inputPaths = [];
  const sceneResults = [];
  let model = null;

  await fsp.rm(sceneDir, { recursive: true, force: true });
  await fsp.mkdir(sceneDir, { recursive: true });

  for (const scene of scenes) {
    const sceneIndex = Number(scene?.index || sceneResults.length + 1);
    const text = String(scene?.narration_text || '').trim();
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

    const durationResult = await readAudioDuration(filePath, options.audioDurationOptions || {});
    const durationValue = typeof durationResult === 'number' ? durationResult : durationResult?.duration;
    if (typeof durationResult !== 'number' && !durationResult?.success) {
      return fail(durationResult?.message || `第 ${sceneIndex} 幕音频时长读取失败。`, {
        scene_index: sceneIndex,
        model,
      });
    }

    const duration = roundTime(durationValue);
    const captions = ttsTimeline.buildCaptionsFromSegments([
      { index: 1, text, duration, path: filePath },
    ]);
    const phraseCaptions = phraseTimeline.buildPhraseBlocksFromCaptions(captions);

    inputPaths.push(filePath);
    sceneResults.push({
      ...scene,
      index: sceneIndex,
      duration,
      actual_duration_sec: duration,
      path: filePath,
      file_name: fileName,
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
