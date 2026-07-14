const { normalizeSceneSpec } = require('../sceneSpecService');
const { DEFAULT_FRAME_DURATION_SEC } = require('./contentGraph');

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function sceneSort(left, right) {
  return (Number(left.order) || 0) - (Number(right.order) || 0);
}

function normalizeKind(kind) {
  return kind === 'data' ? 'data' : 'text';
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function trustedSceneDuration(scene = {}, fallbackScene = {}, node = {}) {
  return firstPositiveNumber(
    scene.speech_duration_sec,
    scene.speechDurationSec,
    scene.duration,
    scene.duration_sec,
    scene.durationSec,
    scene.actual_duration_sec,
    scene.actualDurationSec,
    scene.target_duration_sec,
    scene.targetDurationSec,
    fallbackScene.speech_duration_sec,
    fallbackScene.speechDurationSec,
    fallbackScene.duration,
    fallbackScene.duration_sec,
    fallbackScene.durationSec,
    fallbackScene.actual_duration_sec,
    fallbackScene.actualDurationSec,
    fallbackScene.target_duration_sec,
    fallbackScene.targetDurationSec,
    node.durationSec,
    node.duration_sec,
    node.duration,
    DEFAULT_FRAME_DURATION_SEC,
  );
}

function buildNode(scene, sourceScene = scene) {
  const visualText = clone(scene.visual_text);
  const headline = visualText.headline || scene.id;
  const durationSec = trustedSceneDuration(sourceScene, scene);
  const base = {
    id: scene.id,
    kind: normalizeKind(scene.kind),
    label: headline,
    frameIntent: scene.kind || 'text',
    durationSec,
    metadata: {
      scene_id: scene.id,
      order: scene.order,
      start: scene.start,
      scene_kind: scene.kind,
      narration_text: scene.narration_text,
      captions: clone(scene.captions),
      visual_text: visualText,
    },
  };

  if (base.kind === 'data') {
    return {
      ...base,
      data: {
        headline,
        keywords: visualText.keywords || [],
        cards: visualText.cards || [],
      },
    };
  }

  return {
    ...base,
    text: headline,
  };
}

function mapSceneSpecToContentGraph(rawSceneSpec) {
  const sortedRaw = {
    ...(rawSceneSpec || {}),
    scenes: [...((rawSceneSpec && rawSceneSpec.scenes) || [])].sort(sceneSort),
  };
  const sceneSpec = normalizeSceneSpec(sortedRaw);
  const scenes = [...(sceneSpec.scenes || [])].sort(sceneSort);
  return {
    schemaVersion: 1,
    intent: 'promo',
    synopsis: sceneSpec.title,
    nodes: scenes.map((scene, index) => buildNode(scene, sortedRaw.scenes[index] || scene)),
    edges: scenes.slice(0, -1).map((scene, index) => ({
      from: scene.id,
      to: scenes[index + 1].id,
      kind: 'sequence',
    })),
  };
}

module.exports = {
  mapSceneSpecToContentGraph,
};
