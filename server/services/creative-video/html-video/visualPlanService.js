const crypto = require('crypto');
const { selectMotionPrimitive, CAPTION_SAFE_BOTTOM_PX } = require('./motionPrimitiveCatalog');
const { normalizeCaptionsForFrame } = require('./captionLayer');

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

function roundTime(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function shotMinimumDuration(ref = {}, registry = new Map()) {
  const asset = registry.get(ref.asset_id) || {};
  return asset.image_analysis?.contains_text === true ? 2 : 1;
}

function sequenceDiagnostic({ code, sceneId, message, severity = 'warning', details = {} }) {
  return {
    code,
    stage: 'project',
    sub_stage: 'visual_plan',
    scene_id: sceneId,
    severity,
    user_message: message,
    retryable: false,
    fallback_allowed: severity !== 'error',
    details,
  };
}

function captionsDisabledForScene(scene = {}, mediaOptions = {}) {
  return mediaOptions.generateCaptions === false
    || mediaOptions.generate_captions === false
    || scene.generate_captions === false
    || scene.generateCaptions === false
    || scene.media_options?.generateCaptions === false
    || scene.mediaOptions?.generateCaptions === false;
}

function captionInvalidDiagnostic(sceneId, issues) {
  return sequenceDiagnostic({
    code: 'image_sequence_caption_invalid',
    sceneId,
    message: '场景字幕存在无效条目、重复标识或非法时间，无法安全编排图片镜头。',
    severity: 'error',
    details: { issues },
  });
}

function canonicalCaptionTrack(scene = {}, sceneId = '', duration = 0, mediaOptions = {}) {
  if (captionsDisabledForScene(scene, mediaOptions)) return { captions: [], diagnostics: [] };
  const rawCaptions = Array.isArray(scene.captions) ? scene.captions : [];
  const rawIssues = rawCaptions.flatMap((caption, index) => {
    if (!caption || typeof caption !== 'object' || Array.isArray(caption)) return [{ index, reason: 'caption_not_object' }];
    const start = Number(caption.start ?? caption.start_sec ?? 0);
    const rawEnd = caption.end ?? caption.end_sec;
    const end = rawEnd == null ? null : Number(rawEnd);
    const issues = [];
    if (!Number.isFinite(start) || start < 0) issues.push({ index, reason: 'invalid_start' });
    if (rawEnd != null && (!Number.isFinite(end) || end <= start || end > duration)) issues.push({ index, reason: 'invalid_end' });
    return issues;
  });
  if (rawIssues.length) return { captions: [], diagnostics: [captionInvalidDiagnostic(sceneId, rawIssues)] };

  const captions = normalizeCaptionsForFrame({
    ...scene,
    id: sceneId,
    scene_id: sceneId,
    duration_sec: duration,
  });
  const ids = new Set();
  const issues = [];
  let previousStart = -1;
  captions.forEach((caption, index) => {
    const id = safeString(caption?.id);
    const start = Number(caption?.start);
    const end = Number(caption?.end);
    if (!id) issues.push({ index, reason: 'caption_id_missing' });
    else if (ids.has(id)) issues.push({ index, id, reason: 'duplicate_id' });
    ids.add(id);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end || end > duration) {
      issues.push({ index, id, reason: 'invalid_canonical_window', start, end });
    }
    if (Number.isFinite(start) && start < previousStart) issues.push({ index, id, reason: 'caption_order_invalid' });
    if (Number.isFinite(start)) previousStart = start;
  });
  return {
    captions: captions.slice().sort((a, b) => Number(a.start) - Number(b.start) || Number(a.end) - Number(b.end) || String(a.id).localeCompare(String(b.id))),
    diagnostics: issues.length ? [captionInvalidDiagnostic(sceneId, issues)] : [],
  };
}

function refRequirement(ref = {}, registry = new Map()) {
  return safeString(registry.get(ref.asset_id)?.requirement || ref.requirement) || 'optional';
}

function minimumSequenceBudget(refs = [], registry = new Map(), mode = 'fullscreen_relay', hasCaptions = true) {
  const minimums = refs.map(ref => shotMinimumDuration(ref, registry));
  if (!minimums.length) return 0;
  if (mode === 'semantic_compare') return Math.max(...minimums);
  if (mode === 'overview_detail') {
    const detail = minimums.slice(1);
    const detailBudget = detail.reduce((sum, value) => sum + value, 0)
      - (hasCaptions ? Math.max(0, detail.length - 1) * 0.35 : 0);
    return Math.max(minimums[0], detailBudget);
  }
  return minimums.reduce((sum, value) => sum + value, 0)
    - (hasCaptions ? Math.max(0, minimums.length - 1) * 0.35 : 0);
}

function removeDroppableFromTail(refs, registry, shouldRemove, eligible = () => true) {
  const removed = [];
  for (const requirement of ['optional', 'preferred']) {
    for (let index = refs.length - 1; index >= 0 && shouldRemove(); index -= 1) {
      if (refRequirement(refs[index], registry) !== requirement || !eligible(refs[index])) continue;
      removed.unshift(refs.splice(index, 1)[0].asset_id);
    }
  }
  return removed;
}

function captionGroups(captions = [], count = 1) {
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * captions.length / count);
    const end = Math.floor((index + 1) * captions.length / count);
    return captions.slice(start, Math.max(start + 1, end));
  });
}

function applyShotTiming({ base, refs, sceneId, duration, registry, diagnostics, canonical }) {
  if (!base || base.type !== 'image_sequence') return base;
  if (canonical.diagnostics.length) return base;
  const captions = canonical.captions;
  let timedRefs = refs.slice();
  const removedAssetIds = [];
  if (!captions.length) {
    const required = timedRefs.filter(ref => refRequirement(ref, registry) === 'required');
    if (base.sequence_mode === 'semantic_compare') {
      timedRefs = timedRefs.slice(0, 2);
    } else if (base.sequence_mode === 'overview_detail') {
      timedRefs = required.length >= 2 ? required : (required.length ? required : timedRefs.slice(0, 1));
    } else {
      timedRefs = required.length ? required : timedRefs.slice(0, 1);
    }
    const keptIds = new Set(timedRefs.map(ref => ref.asset_id));
    removedAssetIds.push(...refs.filter(ref => !keptIds.has(ref.asset_id)).map(ref => ref.asset_id));
    if (required.length > 1 && base.sequence_mode !== 'semantic_compare') diagnostics.push(sequenceDiagnostic({
      code: 'image_sequence_caption_anchor_missing',
      sceneId,
      message: '场景没有字幕或旁白，必用图片将按最短展示时长顺序编排。',
      details: { required_asset_ids: required.map(ref => ref.asset_id) },
    }));
  }
  let mode = base.sequence_mode;
  let blockingConflict = false;
  if (captions.length && mode !== 'semantic_compare') {
    const capacity = captions.length;
    removedAssetIds.push(...removeDroppableFromTail(timedRefs, registry, () => timedRefs.length > capacity));
    if (timedRefs.length > capacity) diagnostics.push(sequenceDiagnostic({
      code: 'required_asset_shot_timing_conflict',
      sceneId,
      message: '必用图片镜头数量超过可安全绑定的字幕分组，已停止生成。',
      severity: 'error',
      details: { required_asset_ids: timedRefs.map(ref => ref.asset_id), caption_count: captions.length },
    }));
    if (timedRefs.length > capacity) blockingConflict = true;
  }
  const durationRemoved = removeDroppableFromTail(timedRefs, registry, () => (
    minimumSequenceBudget(timedRefs, registry, mode, captions.length > 0) > duration
  ));
  removedAssetIds.push(...durationRemoved);
  if (minimumSequenceBudget(timedRefs, registry, mode, captions.length > 0) > duration) diagnostics.push(sequenceDiagnostic({
    code: 'required_asset_shot_timing_conflict',
    sceneId,
    message: '必用图片镜头的最短展示时长超过场景时长，已停止生成。',
    severity: 'error',
    details: { required_asset_ids: timedRefs.map(ref => ref.asset_id), duration_sec: duration },
  }));
  if (minimumSequenceBudget(timedRefs, registry, mode, captions.length > 0) > duration) blockingConflict = true;

  if (blockingConflict) return { ...base, sequence_mode: mode };

  for (let pass = 0; pass < 4; pass += 1) {
    if (!timedRefs.length) {
      if (removedAssetIds.length) diagnostics.push(sequenceDiagnostic({
        code: 'image_sequence_shots_reduced_for_duration',
        sceneId,
        message: '场景时长不足，已移除无法满足最短展示时长的非必用图片镜头。',
        details: { removed_asset_ids: [...new Set(removedAssetIds)] },
      }));
      return { type: 'diagram', asset_id: null, fit: 'contain', role: base.role, continuity_group: base.continuity_group };
    }
    if (timedRefs.length === 1) mode = 'fullscreen_relay';
    else if (mode === 'semantic_compare' && timedRefs.length !== 2) mode = 'fullscreen_relay';
    else if (mode === 'overview_detail' && timedRefs.length < 2) mode = 'fullscreen_relay';
    else if (mode === 'rhythm_montage' && (timedRefs.length < 2 || timedRefs.length > 4)) mode = 'fullscreen_relay';
    const keptIds = new Set(timedRefs.map(ref => ref.asset_id));
    const shots = base.shots.filter(shot => keptIds.has(shot.asset_id));
    const captionIds = captions.map(caption => caption.id);
    if (shots.length === 1) {
      shots[0].caption_ids = captionIds;
      shots[0].active_window = { time_base: 'scene_local', start_sec: 0, end_sec: duration };
    } else if (mode === 'semantic_compare') {
      shots.forEach(shot => {
        shot.caption_ids = captionIds;
        shot.active_window = { time_base: 'scene_local', start_sec: 0, end_sec: duration };
      });
    } else if (mode === 'overview_detail') {
      shots[0].caption_ids = captionIds;
      shots[0].active_window = { time_base: 'scene_local', start_sec: 0, end_sec: duration };
      if (!captions.length) {
        const detailMinimums = timedRefs.slice(1).map(ref => shotMinimumDuration(ref, registry));
        let cursor = Math.max(0, duration - detailMinimums.reduce((sum, value) => sum + value, 0));
        shots.slice(1).forEach((shot, index) => {
          const end = index === shots.length - 2 ? duration : cursor + detailMinimums[index];
          shot.caption_ids = [];
          shot.active_window = { time_base: 'scene_local', start_sec: roundTime(cursor), end_sec: roundTime(end) };
          cursor = end;
        });
      } else {
        const groups = captionGroups(captions.slice(1), shots.length - 1);
        shots.slice(1).forEach((shot, index) => {
          const group = groups[index];
          shot.caption_ids = group.map(caption => caption.id);
          shot.active_window = { time_base: 'scene_local', start_sec: roundTime(group[0].start), end_sec: duration };
        });
      }
    } else if (!captions.length) {
      let cursor = 0;
      shots.forEach((shot, index) => {
        const end = index === shots.length - 1
          ? duration
          : cursor + shotMinimumDuration(timedRefs[index], registry);
        shot.caption_ids = [];
        shot.active_window = {
          time_base: 'scene_local',
          start_sec: roundTime(cursor),
          end_sec: roundTime(end),
        };
        cursor = end;
      });
    } else {
      const groups = captionGroups(captions, shots.length);
      shots.forEach((shot, index) => {
        const group = groups[index];
        const minimum = shotMinimumDuration(timedRefs[index], registry);
        const start = index === 0 ? 0 : Math.max(0, Number(group[0].start) - 0.18);
        const naturalEnd = index === shots.length - 1 ? duration : Number(group.at(-1).end) + 0.17;
        shot.caption_ids = group.map(caption => caption.id);
        shot.active_window = {
          time_base: 'scene_local',
          start_sec: roundTime(start),
          end_sec: roundTime(Math.min(duration, Math.max(naturalEnd, start + minimum))),
        };
      });
    }
    shots.forEach((shot, index) => {
      shot.minimum_visible_duration_sec = shotMinimumDuration(timedRefs[index], registry);
    });
    const inadequate = shots.filter(shot => (
      shot.active_window.end_sec - shot.active_window.start_sec + 0.001 < shot.minimum_visible_duration_sec
    ));
    if (!inadequate.length) {
      if (removedAssetIds.length) diagnostics.push(sequenceDiagnostic({
        code: 'image_sequence_shots_reduced_for_duration',
        sceneId,
        message: '场景时长或字幕锚点不足，已减少非必用图片镜头。',
        details: { removed_asset_ids: [...new Set(removedAssetIds)] },
      }));
      return { ...base, sequence_mode: mode, shots };
    }
    const inadequateIds = new Set(inadequate.map(shot => shot.asset_id));
    const removed = removeDroppableFromTail(timedRefs, registry, () => (
      timedRefs.some(ref => inadequateIds.has(ref.asset_id) && refRequirement(ref, registry) !== 'required')
    ), ref => inadequateIds.has(ref.asset_id));
    removedAssetIds.push(...removed);
    if (!removed.length) {
      diagnostics.push(sequenceDiagnostic({
        code: 'required_asset_shot_timing_conflict',
        sceneId,
        message: '必用图片镜头的实际时间窗短于最短展示时长，已停止生成。',
        severity: 'error',
        details: { required_asset_ids: inadequate.map(shot => shot.asset_id) },
      }));
      return { ...base, sequence_mode: mode, shots };
    }
  }
  return base;
}

function visualBaseForBeat({ beat, scene, node, registry, diagnostics = [], canonical }) {
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
  const base = {
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
  return applyShotTiming({ base, refs, sceneId: beat.scene_id, duration: resolveSceneDurationSec(scene) || 6, registry, diagnostics, canonical });
}

function buildVisualPlan({ graph = {}, sceneSpec = {}, creativeContext = {}, workflowId = '', mediaOptions = {} } = {}) {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const registry = assetRegistry(creativeContext);
  const referencedAssetIds = new Set((Array.isArray(graph?.nodes) ? graph.nodes : [])
    .flatMap(node => (Array.isArray(node?.asset_refs) ? node.asset_refs : []))
    .map(ref => safeString(ref?.asset_id || ref?.id))
    .filter(Boolean));
  const beats = [];
  const diagnostics = [];
  scenes.forEach((scene, sceneIndex) => {
    const next = splitScene(scene, beats.length + 1, sceneIndex);
    const sceneId = safeString(scene.id || scene.scene_id) || `scene_${String(sceneIndex + 1).padStart(2, '0')}`;
    const node = nodeForScene(graph, sceneId);
    const canonical = canonicalCaptionTrack(scene, sceneId, resolveSceneDurationSec(scene) || 6, mediaOptions);
    diagnostics.push(...canonical.diagnostics);
    let sceneVisualBase = null;
    next.forEach(beat => {
      beat.asset_refs = Array.isArray(node?.asset_refs) ? node.asset_refs.map(ref => ({ ...ref })) : [];
      if (!sceneVisualBase) sceneVisualBase = visualBaseForBeat({ beat, scene, node, registry, diagnostics, canonical });
      beat.visual_base = stableJsonValue(sceneVisualBase);
    });
    beats.push(...next);
  });
  const plan = {
    version: 2,
    style_profile: chooseStyleProfile({ sceneSpec, workflowId }),
    beats,
    diagnostics,
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
    media_options: { generateCaptions: !captionsDisabledForScene({}, mediaOptions) },
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
  canonicalCaptionTrack,
  chooseStyleProfile,
  splitScene,
  resolveThemeTokens,
  assignMotionOrchestration,
};
