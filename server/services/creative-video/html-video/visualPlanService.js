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

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableJsonValue(value[key]);
    return result;
  }, {});
}

function assetRegistry(creativeContext = {}) {
  const assets = Array.isArray(creativeContext?.asset_context?.assets)
    ? creativeContext.asset_context.assets
    : [];
  return new Map(assets.map(asset => [safeString(asset?.id || asset?.asset_id), asset]).filter(([id]) => id));
}

function nodeForScene(graph = {}, sceneId = '') {
  return (Array.isArray(graph?.nodes) ? graph.nodes : []).find(node => (
    safeString(node?.scene_id || node?.metadata?.scene_id || node?.id) === sceneId
  ));
}

function sequenceMode({ scene = {}, node = {}, refs = [] } = {}) {
  const text = [
    scene.narration_text,
    JSON.stringify(scene.visual_text || {}),
    node.label,
    node.text,
    ...refs.map(ref => ref?.reason),
  ].map(value => String(value || '')).join(' ').toLowerCase();
  const montageDenied = /(?:不是|并非|不要|不使用|无需)\s*(?:做|用|采用)?\s*蒙太奇/i.test(text)
    || /\b(?:do\s+not|don't)\s+use\s+(?:a\s+)?montage\b/i.test(text)
    || /\bnot\s+intended\s+as\s+(?:a\s+)?montage\b/i.test(text)
    || /\bnot\s+(?:a\s+)?montage\b/i.test(text);
  if (refs.length >= 2 && (safeString(scene.kind) === 'comparison' || /(?:对比|比较|差异|versus|\bvs\.?\b)/i.test(text))) {
    return 'semantic_compare';
  }
  if (refs.length >= 2 && /(?:概览|全貌|整体|overview)/i.test(text) && /(?:细节|局部|特写|detail)/i.test(text)) {
    return 'overview_detail';
  }
  if (!montageDenied && refs.length >= 2 && /(?:并列|案例|合集|蒙太奇|montage)/i.test(text)) {
    return 'rhythm_montage';
  }
  return 'fullscreen_relay';
}

function selectedRefs(refs = [], registry = new Map(), mode = 'fullscreen_relay') {
  const unique = [];
  const seen = new Set();
  for (const ref of refs) {
    const assetId = safeString(ref?.asset_id || ref?.id);
    if (!assetId || seen.has(assetId)) continue;
    seen.add(assetId);
    unique.push({ ...ref, asset_id: assetId });
  }
  const limit = mode === 'rhythm_montage' ? 4 : 3;
  if (unique.length <= limit) return unique;
  const required = unique.filter(ref => safeString(registry.get(ref.asset_id)?.requirement || ref.requirement) === 'required');
  const selected = new Set(required.slice(0, 4).map(ref => ref.asset_id));
  for (const ref of unique) {
    if (selected.size >= Math.max(limit, Math.min(4, required.length))) break;
    selected.add(ref.asset_id);
  }
  return unique.filter(ref => selected.has(ref.asset_id)).slice(0, 4);
}

function visualBaseForBeat({ beat, scene, node, registry }) {
  const graphRefs = Array.isArray(node?.asset_refs) ? node.asset_refs : [];
  const intendedMode = sequenceMode({ scene, node, refs: graphRefs });
  const compareCandidates = selectedRefs(graphRefs, registry, 'rhythm_montage');
  const compareRequiredConflict = intendedMode === 'semantic_compare'
    && compareCandidates.slice(2).some(ref => safeString(registry.get(ref.asset_id)?.requirement || ref.requirement) === 'required');
  const mode = compareRequiredConflict ? 'fullscreen_relay' : intendedMode;
  const refs = intendedMode === 'semantic_compare' && !compareRequiredConflict
    ? compareCandidates.slice(0, 2)
    : selectedRefs(graphRefs, registry, mode);
  if (!refs.length) {
    return { type: 'diagram', asset_id: null, fit: 'contain', role: 'main_visual', continuity_group: beat.scene_id };
  }
  return {
    type: 'image_sequence',
    sequence_mode: mode,
    ...(compareRequiredConflict ? { mode_reason: 'compare_conflict_required_candidates' } : {}),
    continuity_group: beat.scene_id,
    role: 'main_visual',
    shots: refs.map((ref, index) => {
      const asset = registry.get(ref.asset_id) || {};
      const analysis = asset.image_analysis && typeof asset.image_analysis === 'object' ? asset.image_analysis : {};
      const src = safeString(asset.frame_src) || (safeString(asset.path) ? `../${safeString(asset.path).replace(/\\/g, '/')}` : '');
      return {
        id: `${beat.scene_id}_shot_${String(index + 1).padStart(2, '0')}`,
        asset_id: ref.asset_id,
        role: safeString(ref.usage) || 'showcase',
        reason: safeString(ref.reason),
        requirement: safeString(asset.requirement || ref.requirement) || 'optional',
        fit: analysis.contains_text === true ? 'contain' : (safeString(analysis.fit || asset.fit || ref.fit) || 'cover'),
        src,
        ...(Object.keys(analysis).length ? { analysis: stableJsonValue(analysis) } : {}),
      };
    }),
  };
}

function buildVisualPlan({ graph = {}, sceneSpec = {}, creativeContext = {}, workflowId = '' } = {}) {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const registry = assetRegistry(creativeContext);
  const referencedAssetIds = new Set((Array.isArray(graph?.nodes) ? graph.nodes : [])
    .flatMap(node => (Array.isArray(node?.asset_refs) ? node.asset_refs : []))
    .map(ref => safeString(ref?.asset_id || ref?.id))
    .filter(Boolean));
  const beats = [];
  scenes.forEach((scene, sceneIndex) => {
    const next = splitScene(scene, beats.length + 1, sceneIndex);
    const node = nodeForScene(graph, safeString(scene.id || scene.scene_id) || `scene_${String(sceneIndex + 1).padStart(2, '0')}`);
    next.forEach(beat => {
      beat.asset_refs = Array.isArray(node?.asset_refs) ? node.asset_refs.map(ref => ({ ...ref })) : [];
      beat.visual_base = visualBaseForBeat({ beat, scene, node, registry });
    });
    beats.push(...next);
  });
  const plan = {
    version: 2,
    style_profile: chooseStyleProfile({ sceneSpec, workflowId }),
    beats,
  };
  plan.input_fingerprint = crypto.createHash('sha256').update(JSON.stringify(stableJsonValue({
    version: plan.version,
    scene_spec: sceneSpec,
    graph_refs: (Array.isArray(graph?.nodes) ? graph.nodes : []).map(node => ({
      scene_id: safeString(node?.scene_id || node?.metadata?.scene_id || node?.id),
      asset_refs: Array.isArray(node?.asset_refs) ? node.asset_refs : [],
    })),
    registered_assets: Array.from(registry.values()).filter(asset => referencedAssetIds.has(safeString(asset.id || asset.asset_id))).sort((a, b) => safeString(a.id || a.asset_id).localeCompare(safeString(b.id || b.asset_id))).map(asset => ({
      id: asset.id || asset.asset_id,
      requirement: asset.requirement,
      fit: asset.fit,
      image_analysis: asset.image_analysis,
      path: asset.path,
      frame_src: asset.frame_src,
    })),
    workflow_id: workflowId,
  }))).digest('hex');
  return plan;
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
    if (!beat.visual_base) {
      const assetId = generatedAssetIdForBeat(beat);
      beat.visual_base = assetId
        ? { type: 'generated_image', asset_id: assetId, fit: 'contain', role: 'main_visual', continuity_group: beat.scene_id }
        : { type: 'diagram', asset_id: null, fit: 'contain', role: 'main_visual', continuity_group: beat.scene_id };
    }
    const pick = selectMotionPrimitive({ ...beat, base_type: beat.visual_base.type === 'diagram' ? 'diagram' : 'image' });
    beat.motion_overlay = pick
      ? {
        preset: pick.preset,
        placement: pick.placement,
        density: 'medium',
        max_items: pick.max_items,
        avoid_caption_bottom_px: CAPTION_SAFE_BOTTOM_PX,
        theme_tokens: { ...themeTokens },
      }
      : null;
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
