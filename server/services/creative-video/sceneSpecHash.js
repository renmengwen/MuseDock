const crypto = require('crypto');

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => stableValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
      }, {});
  }

  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function normalizeSceneId(scene, index) {
  if (scene && scene.id) {
    return String(scene.id);
  }

  return `scene_${String(index + 1).padStart(2, '0')}`;
}

function normalizeSceneOrder(scene, index) {
  const order = Number(scene?.order);
  return Number.isFinite(order) ? order : index + 1;
}

function normalizeNarrationText(scene) {
  return scene?.narration_text ?? scene?.narrationText ?? '';
}

function normalizeCaptions(scene) {
  return Array.isArray(scene?.captions) ? stableValue(scene.captions) : [];
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getSceneSpecSpeechSignature(sceneSpec = {}) {
  const normalizedSceneSpec = isObjectRecord(sceneSpec) ? sceneSpec : {};
  const scenes = Array.isArray(normalizedSceneSpec.scenes) ? normalizedSceneSpec.scenes : [];

  return {
    version: 1,
    scenes: scenes.map((scene, index) => ({
      id: normalizeSceneId(scene, index),
      order: normalizeSceneOrder(scene, index),
      narration_text: normalizeNarrationText(scene),
      captions: normalizeCaptions(scene),
    })),
  };
}

function computeSceneSpecSpeechHash(sceneSpec = {}) {
  const signature = getSceneSpecSpeechSignature(sceneSpec);
  return crypto
    .createHash('sha256')
    .update(stableStringify(signature))
    .digest('hex');
}

function getAudioPath(audio = {}) {
  const normalizedAudio = isObjectRecord(audio) ? audio : {};
  return [
    normalizedAudio.path,
    normalizedAudio.narration_path,
    normalizedAudio.narrationPath,
    normalizedAudio.combined_path,
  ].map(value => String(value ?? '').trim())
    .find(value => value)
    || '';
}

function hasReusableStatus(audio) {
  if (!Object.prototype.hasOwnProperty.call(audio, 'status')) {
    return false;
  }

  return ['ready', 'done', 'rendered'].includes(String(audio.status ?? '').trim());
}

function sceneIdsMatch(audioSceneIds, expectedSceneIds) {
  if (!Array.isArray(audioSceneIds) || audioSceneIds.length !== expectedSceneIds.length) {
    return false;
  }

  return audioSceneIds.every((sceneId, index) => String(sceneId) === expectedSceneIds[index]);
}

function audioMatchesSceneSpec(audio = {}, sceneSpec = {}) {
  if (!isObjectRecord(audio)) {
    return false;
  }

  const signature = getSceneSpecSpeechSignature(sceneSpec);
  const expectedSceneIds = signature.scenes.map(scene => scene.id);
  const expectedHash = computeSceneSpecSpeechHash(sceneSpec);
  const rawSceneCount = audio.scene_count !== undefined ? audio.scene_count : audio.sceneCount;
  const hasSceneCount = rawSceneCount !== null
    && rawSceneCount !== undefined
    && !(typeof rawSceneCount === 'string' && rawSceneCount.trim() === '');
  const sceneCount = hasSceneCount ? Number(rawSceneCount) : NaN;

  return audio.source === 'scene_spec'
    && audio.scene_spec_hash === expectedHash
    && Number.isFinite(sceneCount)
    && sceneCount === signature.scenes.length
    && sceneIdsMatch(audio.scene_ids, expectedSceneIds)
    && Boolean(getAudioPath(audio))
    && hasReusableStatus(audio);
}

module.exports = {
  stableStringify,
  getSceneSpecSpeechSignature,
  computeSceneSpecSpeechHash,
  audioMatchesSceneSpec,
};
