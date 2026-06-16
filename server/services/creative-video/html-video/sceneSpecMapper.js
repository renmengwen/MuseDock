const { normalizeSceneSpec } = require('../sceneSpecService');
const { topoSort, getNode, DEFAULT_FRAME_DURATION_SEC } = require('./contentGraph');

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function sceneSort(left, right) {
  return (Number(left.order) || 0) - (Number(right.order) || 0);
}

function normalizeKind(kind) {
  return kind === 'data' ? 'data' : 'text';
}

function buildNode(scene) {
  const visualText = clone(scene.visual_text);
  const headline = visualText.headline || scene.id;
  const base = {
    id: scene.id,
    kind: normalizeKind(scene.kind),
    label: headline,
    frameIntent: scene.kind || 'text',
    durationSec: scene.duration || DEFAULT_FRAME_DURATION_SEC,
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
    nodes: scenes.map(buildNode),
    edges: scenes.slice(0, -1).map((scene, index) => ({
      from: scene.id,
      to: scenes[index + 1].id,
      kind: 'sequence',
    })),
  };
}

function defaultFrameFields() {
  return {
    transition_in: { type: 'cut', duration_sec: 0, params: {} },
    transition_out: { type: 'cut', duration_sec: 0, params: {} },
    trim: { in_sec: 0, out_sec: null },
    speed: 1,
    loop: false,
    enhancement: {
      enabled: false,
      engine: null,
      template_id: null,
      data: null,
      preview_mp4_path: null,
    },
  };
}

function buildFramesFromGraph({ sceneSpec: rawSceneSpec, contentGraph, templateId, templateInputs }) {
  const sceneSpec = normalizeSceneSpec(rawSceneSpec);
  const scenesById = new Map((sceneSpec.scenes || []).map(scene => [scene.id, scene]));
  return topoSort(contentGraph).map((nodeId, index) => {
    const node = getNode(contentGraph, nodeId) || {};
    const scene = scenesById.get(nodeId) || {};
    return {
      id: nodeId,
      scene_id: nodeId,
      order: index + 1,
      template_id: templateId,
      engine: 'hyperframes-playwright',
      source_mode: 'template_inputs',
      html_path: null,
      preview_mp4_path: null,
      duration_sec: Number.isFinite(node.durationSec) ? node.durationSec : (scene.duration || DEFAULT_FRAME_DURATION_SEC),
      inputs: clone(templateInputs),
      narration_text: scene.narration_text || '',
      captions: clone(scene.captions),
      metadata: {
        frame_intent: node.frameIntent || scene.kind || 'text',
        visual_text: clone(scene.visual_text),
      },
      ...defaultFrameFields(),
    };
  });
}

module.exports = {
  mapSceneSpecToContentGraph,
  buildFramesFromGraph,
};
