const crypto = require('crypto');
const { resolveSceneDurationSec } = require('./sceneTemplateMatcher');

const STYLE_PROFILES = [
  {
    id: 'clean_education',
    family: 'clean_education',
    palette: ['#F7F4EA', '#222222', '#2F80ED'],
    layout_language: 'annotated_diagram',
    motion_language: 'draw_reveal',
  },
  {
    id: 'editorial_whiteboard',
    family: 'editorial_whiteboard',
    palette: ['#FFFFFF', '#111111', '#D64545'],
    layout_language: 'editorial_notes',
    motion_language: 'write_on',
  },
  {
    id: 'product_walkthrough',
    family: 'product_walkthrough',
    palette: ['#101014', '#F3F4F6', '#22C55E'],
    layout_language: 'interface_panels',
    motion_language: 'zoom_highlight',
  },
  {
    id: 'data_magazine',
    family: 'data_magazine',
    palette: ['#FAFAFA', '#1F2937', '#F59E0B'],
    layout_language: 'charts_and_callouts',
    motion_language: 'staggered_reveal',
  },
];

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hashIndex(input, length) {
  const hash = crypto.createHash('sha1').update(String(input || '')).digest();
  return length ? hash[0] % length : 0;
}

function chooseStyleProfile({ sceneSpec = {}, workflowId = '' } = {}) {
  const key = [workflowId, sceneSpec.title, sceneSpec.summary].filter(Boolean).join('|');
  return STYLE_PROFILES[hashIndex(key, STYLE_PROFILES.length)];
}

function inferIntent(scene = {}) {
  const kind = safeString(scene.kind) || 'text';
  if (['steps', 'comparison', 'data', 'quote', 'cta'].includes(kind)) return kind;
  return 'definition';
}

function chunkForBeat(items, index, count) {
  if (!Array.isArray(items) || count <= 1) return items;
  const size = Math.max(1, Math.ceil(items.length / count));
  const chunk = items.slice(index * size, (index + 1) * size);
  return chunk.length ? chunk : items.slice(-1);
}

function visualTextForBeat(visualText = {}, index, count) {
  if (!visualText || typeof visualText !== 'object' || Array.isArray(visualText)) return {};
  return {
    ...visualText,
    keywords: chunkForBeat(visualText.keywords, index, count),
    cards: chunkForBeat(visualText.cards, index, count),
  };
}

function splitScene(scene = {}, startOrder = 1, sceneIndex = 0) {
  const sceneId = safeString(scene.id || scene.scene_id)
    || `scene_${String(sceneIndex + 1).padStart(2, '0')}`;
  const duration = resolveSceneDurationSec(scene) || 6;
  const count = Math.max(1, Math.ceil(duration / 7));
  const beatDuration = Math.round((duration / count) * 100) / 100;
  const lastBeatDuration = Math.round((duration - beatDuration * (count - 1)) * 100) / 100;
  return Array.from({ length: count }, (_, index) => ({
    id: count === 1 ? sceneId : `${sceneId}_b${index + 1}`,
    scene_id: sceneId,
    order: startOrder + index,
    beat_index: index + 1,
    beat_count: count,
    duration_sec: index === count - 1 ? lastBeatDuration : beatDuration,
    intent: inferIntent(scene),
    kind: safeString(scene.kind) || 'text',
    narration_text: safeString(scene.narration_text),
    visual_text: visualTextForBeat(scene.visual_text || {}, index, count),
    asset_refs: Array.isArray(scene.asset_refs) ? scene.asset_refs : [],
    source_scene: scene,
  }));
}

function buildVisualPlan({ sceneSpec = {}, workflowId = '' } = {}) {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const beats = [];
  scenes.forEach((scene, sceneIndex) => {
    const next = splitScene(scene, beats.length + 1, sceneIndex);
    beats.push(...next);
  });
  return {
    version: 1,
    style_profile: chooseStyleProfile({ sceneSpec, workflowId }),
    beats,
  };
}

module.exports = { STYLE_PROFILES, buildVisualPlan, chooseStyleProfile, splitScene };
