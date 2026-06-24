const { normalizeSceneSpec } = require('../sceneSpecService');
const { topoSort, getNode, DEFAULT_FRAME_DURATION_SEC } = require('./contentGraph');
const { resolveNodeSceneId } = require('./sceneGraphBinding');

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

function compactText(value, maxLength = 80) {
  let raw = value;
  if (Array.isArray(value)) {
    raw = value.map(item => compactText(item, maxLength)).filter(Boolean).join(' / ');
  } else if (value && typeof value === 'object') {
    raw = objectText(value);
  }
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/^\[object Object\]$/i.test(text)) return '';
  return text.length > maxLength ? text.slice(0, maxLength - 1).trimEnd() : text;
}

function schemaProperties(schema = {}) {
  return schema && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties
    : (schema || {});
}

function schemaHas(schema, key) {
  return Object.prototype.hasOwnProperty.call(schemaProperties(schema), key);
}

function fieldMaxLength(schema, key, fallback) {
  const raw = schemaProperties(schema)[key];
  const value = raw && (raw.max_length ?? raw.maxLength);
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function objectText(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const label = value.title
    || value.label
    || value.name
    || value.text
    || value.headline
    || value.key
    || '';
  const metric = value.value
    ?? value.metric
    ?? value.amount
    ?? value.count
    ?? value.y
    ?? '';
  const labelText = compactText(label, 40);
  const metricText = compactText(metric, 40);
  if (labelText && metricText && labelText !== metricText) return `${labelText}：${metricText}`;
  if (labelText) return labelText;
  if (metricText) return metricText;
  const nested = ['summary', 'description', 'subtitle']
    .map(key => compactText(value[key], 40))
    .find(Boolean);
  return nested || '';
}

function sectionNo(index, total) {
  const width = Math.max(2, String(total).length);
  return `${String(index + 1).padStart(width, '0')}/${String(total).padStart(width, '0')}`;
}

function displayText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map(item => compactText(item, 40)).filter(Boolean).join(' / ');
  }
  if (typeof value === 'object') return objectText(value);
  return String(value);
}

function firstMetric(visualText = {}, maxLength = 24) {
  const candidates = [
    ...(Array.isArray(visualText.keywords) ? visualText.keywords : []),
    ...(Array.isArray(visualText.cards) ? visualText.cards : []),
    visualText.headline,
  ];
  return compactText(candidates.find(item => /[$￥¥]?\d|%/.test(displayText(item))) || visualText.headline || '', maxLength);
}

function buildFrameInputs({ templateInputs, templateSchema, scene, sourceScene, index, total }) {
  const visualText = scene.visual_text || {};
  const headlineSource = visualText.headline || scene.title || scene.id;
  const cards = Array.isArray(visualText.cards)
    ? visualText.cards.map(item => compactText(item, 48)).filter(Boolean)
    : [];
  const keywords = Array.isArray(visualText.keywords)
    ? visualText.keywords.map(item => compactText(item, 24)).filter(Boolean)
    : [];
  const bulletItems = cards.length ? cards : keywords;
  const inputs = clone(templateInputs);

  if (schemaHas(templateSchema, 'headline')) {
    inputs.headline = compactText(headlineSource, fieldMaxLength(templateSchema, 'headline', 48));
  }
  if (schemaHas(templateSchema, 'title')) {
    inputs.title = compactText(headlineSource, fieldMaxLength(templateSchema, 'title', 48));
  }
  if (schemaHas(templateSchema, 'card_title')) {
    inputs.card_title = compactText(headlineSource, fieldMaxLength(templateSchema, 'card_title', 28));
  }
  if (schemaHas(templateSchema, 'section_no')) inputs.section_no = sectionNo(index, total);
  if (schemaHas(templateSchema, 'eyebrow')) {
    inputs.eyebrow = compactText(keywords.slice(0, 2).join(' / '), fieldMaxLength(templateSchema, 'eyebrow', 28));
  }
  if (schemaHas(templateSchema, 'card_label')) {
    inputs.card_label = compactText(keywords.slice(0, 2).join('｜') || inputs.card_label, fieldMaxLength(templateSchema, 'card_label', 24));
  }
  if (schemaHas(templateSchema, 'bullets')) inputs.bullets = bulletItems.slice(0, 4);
  if (schemaHas(templateSchema, 'cards')) inputs.cards = bulletItems.slice(0, 4);
  if (schemaHas(templateSchema, 'metric')) {
    inputs.metric = firstMetric(visualText, fieldMaxLength(templateSchema, 'metric', 24));
  }
  if (schemaHas(templateSchema, 'footer_text')) {
    inputs.footer_text = compactText(bulletItems[0] || inputs.footer_text || '', fieldMaxLength(templateSchema, 'footer_text', 36));
  }
  if (schemaHas(templateSchema, 'duration_sec')) {
    inputs.duration_sec = trustedSceneDuration(sourceScene || scene, scene, { durationSec: inputs.duration_sec });
  }

  return inputs;
}

function buildFramesFromGraph({ sceneSpec: rawSceneSpec, contentGraph, templateId, templateInputs, templateSchema }) {
  const rawSceneSpecSource = rawSceneSpec && rawSceneSpec.scene_spec ? rawSceneSpec.scene_spec : rawSceneSpec;
  const rawScenesById = new Map(((rawSceneSpecSource && rawSceneSpecSource.scenes) || []).map(scene => [scene.id, scene]));
  const sceneSpec = normalizeSceneSpec(rawSceneSpec);
  const scenesById = new Map((sceneSpec.scenes || []).map(scene => [scene.id, scene]));
  const orderedNodeIds = topoSort(contentGraph);
  const total = orderedNodeIds.length;
  return orderedNodeIds.map((nodeId, index) => {
    const node = getNode(contentGraph, nodeId) || {};
    const sceneId = resolveNodeSceneId(node);
    const scene = scenesById.get(sceneId);
    if (!scene) {
      throw new Error(`内容图节点 ${nodeId} 未匹配到 scene_spec 场景 ${sceneId || '未指定'}。`);
    }
    const sourceScene = rawScenesById.get(scene.id) || scene;
    const narrationText = sourceScene.narration_text || scene.narration_text || '';
    const captions = Array.isArray(sourceScene.captions) ? sourceScene.captions : scene.captions;
    const visualText = sourceScene.visual_text && typeof sourceScene.visual_text === 'object'
      ? sourceScene.visual_text
      : scene.visual_text;
    const durationSec = trustedSceneDuration(sourceScene, scene, node);
    const trustedNode = { ...node, durationSec };
    if (trustedNode.duration_sec != null) trustedNode.duration_sec = durationSec;
    if (trustedNode.duration != null) trustedNode.duration = durationSec;
    return {
      id: scene.id,
      scene_id: scene.id,
      graph_node_id: nodeId,
      order: index + 1,
      template_id: templateId,
      engine: 'hyperframes-playwright',
      source_mode: 'template_inputs',
      html_path: null,
      preview_mp4_path: null,
      duration_sec: durationSec,
      inputs: buildFrameInputs({
        templateInputs,
        templateSchema,
        scene,
        sourceScene,
        index,
        total,
      }),
      narration_text: narrationText,
      captions: clone(captions),
      metadata: {
        frame_intent: node.frameIntent || scene.kind || 'text',
        visual_text: clone(visualText),
        graph_node: clone(trustedNode),
        scene_snapshot: {
          id: scene.id,
          order: sourceScene.order || scene.order,
          narration_text: narrationText,
          captions: clone(captions),
        },
      },
      ...defaultFrameFields(),
    };
  });
}

module.exports = {
  mapSceneSpecToContentGraph,
  buildFramesFromGraph,
  buildFrameInputs,
};
