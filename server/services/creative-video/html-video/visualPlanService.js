const crypto = require('crypto');
const { selectMotionPrimitive, CAPTION_SAFE_BOTTOM_PX } = require('./motionPrimitiveCatalog');

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

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function resolveSceneDurationSec(scene = {}) {
  return firstPositiveNumber(
    scene.speech_duration_sec,
    scene.speechDurationSec,
    scene.duration_sec,
    scene.durationSec,
    scene.target_duration_sec,
    scene.targetDurationSec,
    scene.duration,
  );
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

function generatedAssetIdForBeat(beat = {}) {
  const refs = Array.isArray(beat.asset_refs) ? beat.asset_refs : [];
  const subject = refs.find(ref => ref && (ref.usage === 'subject' || ref.usage === 'evidence' || ref.usage === 'showcase'));
  return (subject || refs[0] || {}).asset_id || null;
}

// 只增强 visual_plan 上的 beat；绝不写 scene_spec（scene_spec_hash 稳定）。
const DEFAULT_THEME_TOKENS = {
  accent: '#FF5A36',
  foreground: '#F4EFE7',
  surface: 'rgba(18,16,14,.82)',
  background: '#12100E',
};

function resolveThemeTokens(styleProfile = null) {
  const palette = styleProfile?.palette;
  // 真实 STYLE_PROFILES.palette 是数组，索引语义 [background, foreground, accent]
  if (Array.isArray(palette)) {
    const [background, foreground, accent] = palette;
    return {
      accent: accent || DEFAULT_THEME_TOKENS.accent,
      foreground: foreground || DEFAULT_THEME_TOKENS.foreground,
      // surface = 背景色 + 85% 不透明度（6 位 hex 追加 alpha；非 hex 则退默认）
      surface: /^#[0-9a-fA-F]{6}$/.test(String(background || '')) ? `${background}D9` : DEFAULT_THEME_TOKENS.surface,
      background: background || DEFAULT_THEME_TOKENS.background,
    };
  }
  if (palette && typeof palette === 'object') {
    return {
      accent: palette.accent || DEFAULT_THEME_TOKENS.accent,
      foreground: palette.foreground || DEFAULT_THEME_TOKENS.foreground,
      surface: palette.surface || DEFAULT_THEME_TOKENS.surface,
      background: palette.background || DEFAULT_THEME_TOKENS.background,
    };
  }
  return { ...DEFAULT_THEME_TOKENS };
}

function assignMotionOrchestration(visualPlan = {}, { styleProfile = null } = {}) {
  const themeTokens = resolveThemeTokens(styleProfile);
  const beats = Array.isArray(visualPlan.beats) ? visualPlan.beats : [];
  const bySceneCount = new Map();
  for (const beat of beats) {
    bySceneCount.set(beat.scene_id, (bySceneCount.get(beat.scene_id) || 0) + 1);
  }
  const sceneIndex = new Map();
  for (const beat of beats) {
    const index = (sceneIndex.get(beat.scene_id) || 0) + 1;
    sceneIndex.set(beat.scene_id, index);
    const assetId = generatedAssetIdForBeat(beat);
    beat.visual_base = assetId
      ? { type: 'generated_image', asset_id: assetId, fit: 'contain', role: 'main_visual', continuity_group: beat.scene_id }
      : { type: 'diagram', asset_id: null, fit: 'contain', role: 'main_visual', continuity_group: beat.scene_id };
    const pick = selectMotionPrimitive(beat);
    beat.motion_overlay = {
      preset: pick.preset,
      placement: pick.placement,
      density: 'medium',
      max_items: pick.max_items,
      avoid_caption_bottom_px: CAPTION_SAFE_BOTTOM_PX,
      theme_tokens: { ...themeTokens },
    };
    beat.continuity = {
      group_id: beat.scene_id,
      reuse_base_layout: true,
      beat_index: index,
      beat_count: bySceneCount.get(beat.scene_id) || 1,
    };
  }
  return visualPlan;
}

module.exports = {
  STYLE_PROFILES,
  buildVisualPlan,
  chooseStyleProfile,
  splitScene,
  resolveThemeTokens,
  assignMotionOrchestration,
};
