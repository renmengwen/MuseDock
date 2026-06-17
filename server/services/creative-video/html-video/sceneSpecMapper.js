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

function compactText(value, maxLength = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
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

function sectionNo(index, total) {
  const width = Math.max(2, String(total).length);
  return `${String(index + 1).padStart(width, '0')}/${String(total).padStart(width, '0')}`;
}

function firstMetric(visualText = {}) {
  const candidates = [
    ...(Array.isArray(visualText.keywords) ? visualText.keywords : []),
    ...(Array.isArray(visualText.cards) ? visualText.cards : []),
    visualText.headline,
  ];
  return compactText(candidates.find(item => /[$￥¥]?\d|%/.test(String(item || ''))) || visualText.headline || '', 24);
}

function buildFrameInputs({ templateInputs, templateSchema, scene, index, total }) {
  const visualText = scene.visual_text || {};
  const headline = compactText(visualText.headline || scene.title || scene.id, fieldMaxLength(templateSchema, 'headline', 48));
  const cards = Array.isArray(visualText.cards)
    ? visualText.cards.map(item => compactText(item, 48)).filter(Boolean)
    : [];
  const keywords = Array.isArray(visualText.keywords)
    ? visualText.keywords.map(item => compactText(item, 24)).filter(Boolean)
    : [];
  const inputs = clone(templateInputs);

  if (schemaHas(templateSchema, 'headline')) inputs.headline = headline;
  if (schemaHas(templateSchema, 'title')) inputs.title = headline;
  if (schemaHas(templateSchema, 'card_title')) inputs.card_title = headline;
  if (schemaHas(templateSchema, 'section_no')) inputs.section_no = sectionNo(index, total);
  if (schemaHas(templateSchema, 'eyebrow')) {
    inputs.eyebrow = compactText(keywords.slice(0, 2).join(' / '), fieldMaxLength(templateSchema, 'eyebrow', 28));
  }
  if (schemaHas(templateSchema, 'card_label')) {
    inputs.card_label = compactText(keywords.slice(0, 2).join('｜') || inputs.card_label, fieldMaxLength(templateSchema, 'card_label', 24));
  }
  if (schemaHas(templateSchema, 'bullets')) inputs.bullets = cards.slice(0, 4);
  if (schemaHas(templateSchema, 'cards')) inputs.cards = cards.slice(0, 4);
  if (schemaHas(templateSchema, 'metric')) inputs.metric = firstMetric(visualText);
  if (schemaHas(templateSchema, 'footer_text')) {
    inputs.footer_text = compactText(cards[0] || inputs.footer_text || '', fieldMaxLength(templateSchema, 'footer_text', 36));
  }
  if (schemaHas(templateSchema, 'duration_sec')) {
    inputs.duration_sec = Number(scene.duration || scene.target_duration_sec || inputs.duration_sec || DEFAULT_FRAME_DURATION_SEC);
  }

  return inputs;
}

function buildFramesFromGraph({ sceneSpec: rawSceneSpec, contentGraph, templateId, templateInputs, templateSchema }) {
  const sceneSpec = normalizeSceneSpec(rawSceneSpec);
  const scenesById = new Map((sceneSpec.scenes || []).map(scene => [scene.id, scene]));
  const orderedNodeIds = topoSort(contentGraph);
  const total = orderedNodeIds.length;
  return orderedNodeIds.map((nodeId, index) => {
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
      inputs: buildFrameInputs({
        templateInputs,
        templateSchema,
        scene,
        index,
        total,
      }),
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
  buildFrameInputs,
};
