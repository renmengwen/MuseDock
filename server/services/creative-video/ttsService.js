const fs = require('fs/promises');
const path = require('path');
const defaultTtsModel = require('../ai/aiTtsModel');
const {
  computeSceneSpecSpeechHash,
  getSceneSpecSpeechSignature,
} = require('./sceneSpecHash');

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

function sceneIds(sceneSpec = {}) {
  const signature = getSceneSpecSpeechSignature(sceneSpec);
  return signature.scenes.map(scene => scene.id);
}

function createSceneSpecManifestBase(projectDir, sceneSpec, { status = 'ready' } = {}) {
  const ids = sceneIds(sceneSpec);
  return {
    version: 1,
    source: 'scene_spec',
    scene_spec_hash: computeSceneSpecSpeechHash(sceneSpec || {}),
    scene_count: ids.length,
    scene_ids: ids,
    status,
    project_dir: projectDir,
    scenes: [],
  };
}

async function defaultReadAudioDuration() {
  return 0;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function hasManifestSceneAudio(audioManifest = {}) {
  return (Array.isArray(audioManifest.scenes) ? audioManifest.scenes : [])
    .some(scene => firstNonEmptyString(scene?.path, scene?.relative_path, scene?.relativePath));
}

// TTS manifest -> project.audio 的唯一映射实现，htmlVideoWorkflow / resumeExecutor /
// creativeWorkflows 三条链路共用，避免各自手抄后漂移。
function applyManifestToProjectAudio(project, sceneSpec, audioManifest = {}) {
  const manifest = audioManifest && typeof audioManifest === 'object' ? audioManifest : {};
  const scenes = Array.isArray(sceneSpec?.scenes) ? sceneSpec.scenes : [];
  const narrationPath = firstNonEmptyString(
    manifest.combined_path,
    manifest.narration_path,
    manifest.narrationPath,
  );
  const manifestPath = firstNonEmptyString(
    manifest.tts_manifest_path,
    manifest.ttsManifestPath,
    manifest.manifest_path,
    manifest.manifestPath,
  );
  project.audio = project.audio && typeof project.audio === 'object' ? project.audio : {};
  project.audio.source = 'scene_spec';
  project.audio.scene_spec_hash = manifest.scene_spec_hash || computeSceneSpecSpeechHash(sceneSpec || {});
  project.audio.scene_count = manifest.scene_count || scenes.length;
  project.audio.scene_ids = Array.isArray(manifest.scene_ids) && manifest.scene_ids.length
    ? manifest.scene_ids
    : scenes.map(scene => scene.id);
  project.audio.status = manifest.status || 'ready';
  project.audio.tts_manifest_path = manifestPath || (narrationPath || hasManifestSceneAudio(manifest) ? 'tts/audio_manifest.json' : null);
  project.audio.narration_path = narrationPath || null;
  return project.audio;
}

async function readExistingManifestScenes(ttsDir) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(ttsDir, 'audio_manifest.json'), 'utf8'));
    return Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  } catch {
    return [];
  }
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
    return { success: false, message: `TTS 失败：未找到场景 ${sceneId}。`, audio_manifest: createSceneSpecManifestBase(projectDir, sceneSpec, { status: 'failed' }) };
  }
  const scenes = selectedScenes.filter(scene => String(scene.narration_text || '').trim());
  if (scenes.length === 0) {
    return { success: true, message: '没有可生成的旁白音频。', audio_manifest: createSceneSpecManifestBase(projectDir, sceneSpec) };
  }

  const ttsModel = services.ttsModel || defaultTtsModel;
  const callTtsModel = ttsModel && ttsModel.callTtsModel;
  if (typeof callTtsModel !== 'function') {
    return { success: false, message: 'TTS 失败：未配置语音合成服务。', audio_manifest: createSceneSpecManifestBase(projectDir, sceneSpec, { status: 'failed' }) };
  }

  const readAudioDuration = services.readAudioDuration || defaultReadAudioDuration;
  const ttsDir = path.join(projectDir, 'tts');
  await fs.mkdir(ttsDir, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(ttsDir, '.tmp-'));
  const manifest = createSceneSpecManifestBase(projectDir, sceneSpec);
  const pendingFiles = [];
  const usedNames = new Set();

  try {
    for (const scene of scenes) {
      const text = String(scene.narration_text || '').trim();
      const response = await callTtsModel({ text, scene_id: scene.id });
      if (!response || response.success === false || !response.audioBuffer) {
        manifest.status = 'failed';
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
    if (sceneId) {
      // 单场景重生成：把磁盘上已有 manifest 里其他场景的条目并回来，避免整份覆盖丢音频
      const specIdOrder = new Map(getScenes(sceneSpec).map((scene, index) => [scene.id, index]));
      const regenerated = new Set(manifest.scenes.map(scene => scene.scene_id));
      const kept = (await readExistingManifestScenes(ttsDir))
        .filter(scene => !regenerated.has(scene.scene_id) && specIdOrder.has(scene.scene_id));
      manifest.scenes = [...kept, ...manifest.scenes]
        .sort((a, b) => (specIdOrder.get(a.scene_id) ?? 0) - (specIdOrder.get(b.scene_id) ?? 0));
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
  applyManifestToProjectAudio,
};
