const fs = require('fs/promises');
const path = require('path');
const defaultTtsModel = require('../aiTtsModel');

function safeSceneId(sceneId) {
  return String(sceneId || 'scene')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'scene';
}

function uniqueBaseName(sceneId, usedNames) {
  const base = safeSceneId(sceneId);
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  let suffix = 2;
  while (usedNames.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  const next = `${base}_${suffix}`;
  usedNames.add(next);
  return next;
}

function normalizeFormat(format) {
  const raw = String(format || 'mp3').trim().toLowerCase();
  const mapped = {
    mp3: 'mp3',
    mpeg: 'mp3',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    wav: 'wav',
    wave: 'wav',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    m4a: 'm4a',
    'audio/mp4': 'm4a',
    mp4: 'm4a',
  }[raw];
  return mapped || 'mp3';
}

function relativeAudioPath(fileName) {
  return `tts/${fileName}`.replace(/\\/g, '/');
}

function getScenes(sceneSpec, sceneId) {
  const scenes = Array.isArray(sceneSpec && sceneSpec.scenes) ? sceneSpec.scenes : [];
  if (!sceneId) {
    return scenes;
  }
  return scenes.filter(scene => scene.id === sceneId);
}

async function defaultReadAudioDuration() {
  return 0;
}

async function synthesizeSceneNarration({
  projectDir,
  sceneSpec,
  sceneId,
  services = {},
} = {}) {
  if (!projectDir) {
    return { success: false, message: 'TTS 失败：缺少工程目录。', audio_manifest: { scenes: [] } };
  }
  const selectedScenes = getScenes(sceneSpec, sceneId);
  if (sceneId && selectedScenes.length === 0) {
    return { success: false, message: `TTS 失败：未找到场景 ${sceneId}。`, audio_manifest: { scenes: [] } };
  }
  const scenes = selectedScenes.filter(scene => String(scene.narration_text || '').trim());
  if (scenes.length === 0) {
    return { success: true, message: '没有可生成的旁白音频。', audio_manifest: { version: 1, project_dir: projectDir, scenes: [] } };
  }

  const ttsModel = services.ttsModel || defaultTtsModel;
  const callTtsModel = ttsModel && ttsModel.callTtsModel;
  if (typeof callTtsModel !== 'function') {
    return { success: false, message: 'TTS 失败：未配置语音合成服务。', audio_manifest: { scenes: [] } };
  }

  const readAudioDuration = services.readAudioDuration || defaultReadAudioDuration;
  const ttsDir = path.join(projectDir, 'tts');
  await fs.mkdir(ttsDir, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(ttsDir, '.tmp-'));
  const manifest = {
    version: 1,
    project_dir: projectDir,
    scenes: [],
  };
  const pendingFiles = [];
  const usedNames = new Set();

  try {
    for (const scene of scenes) {
      const text = String(scene.narration_text || '').trim();
      const response = await callTtsModel({ text, scene_id: scene.id });
      if (!response || response.success === false || !response.audioBuffer) {
        return {
          success: false,
          message: `TTS 失败：场景 ${scene.id} 旁白生成失败。`,
          audio_manifest: manifest,
          error: response && (response.message || response.error),
        };
      }

      const format = normalizeFormat(response.format);
      const fileName = `${uniqueBaseName(scene.id, usedNames)}.${format}`;
      const finalPath = path.join(ttsDir, fileName);
      const tempPath = path.join(tempDir, fileName);
      await fs.writeFile(tempPath, response.audioBuffer);
      const duration = await readAudioDuration(tempPath, { scene, format });
      pendingFiles.push({ tempPath, finalPath });
      manifest.scenes.push({
        scene_id: scene.id,
        path: finalPath,
        relative_path: relativeAudioPath(fileName),
        duration: Number.isFinite(Number(duration)) ? Number(duration) : 0,
        format,
        voice: response.voice || '',
        model: response.model || {},
      });
    }

    for (const file of pendingFiles) {
      await fs.rm(file.finalPath, { force: true });
      await fs.rename(file.tempPath, file.finalPath);
    }
    await fs.writeFile(path.join(ttsDir, 'audio_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  return {
    success: true,
    audio_manifest: manifest,
    message: sceneId ? '场景旁白音频已生成。' : '全部场景旁白音频已生成。',
  };
}

module.exports = {
  synthesizeSceneNarration,
};
