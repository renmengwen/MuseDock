const { orderedCandidates, passCandidate, getTemplate, blocksAssetFirstFullFrame } = require('./sceneTemplateMatcher');

const DIAGRAM_KINDS = new Set(['text', 'quote', 'steps', 'comparison']);

// 决策 3：asset_first 下 template_inputs 归零，兼容模板白名单不实现（见开放设计决策 1）。
function assetFirstDecision(beat) {
  const hasAsset = Array.isArray(beat.asset_refs) && beat.asset_refs.length > 0;
  if (hasAsset) {
    return {
      beat_id: beat.id,
      scene_id: beat.scene_id,
      source_mode: 'raw_html',
      route_role: 'asset_overlay',
      template_id: null,
      duration_strategy: 'raw_html',
      confidence: 1,
      template_blocked_reason: 'asset_first_prefers_visual_base',
      reason: 'asset_first：素材做主视觉，HTML 仅做局部 overlay。',
    };
  }
  return {
    beat_id: beat.id,
    scene_id: beat.scene_id,
    source_mode: 'raw_html',
    route_role: DIAGRAM_KINDS.has(beat.kind || 'text') ? 'diagram_motion' : 'caption_motion',
    template_id: null,
    duration_strategy: 'raw_html',
    confidence: 0.9,
    template_blocked_reason: 'asset_first_blocks_full_frame_templates',
    reason: '无图场景按统一 diagram/局部动效生成，不回退整帧标题模板。',
    diagnostic: {
      code: 'asset_first_template_blocked',
      user_message: 'asset_first 下已阻断整帧模板，使用统一 diagram。',
      details: {
        beat_id: beat.id,
        scene_id: beat.scene_id,
        blocked_candidates: ['frame-glitch-title', 'frame-build-minimal']
          .map(id => `${id}: ${blocksAssetFirstFullFrame({ id })}`),
      },
    },
  };
}

function beatAsScene(beat = {}) {
  return {
    ...(beat.source_scene || {}),
    id: beat.id,
    scene_id: beat.scene_id,
    kind: beat.kind,
    duration_sec: beat.duration_sec,
    speech_duration_sec: beat.duration_sec,
    speechDurationSec: undefined,
    duration: beat.duration_sec,
    durationSec: undefined,
    target_duration_sec: undefined,
    targetDurationSec: undefined,
    narration_text: beat.narration_text,
    visual_text: beat.visual_text,
    asset_refs: beat.asset_refs,
  };
}

function failDecision(beat, reason, failures = []) {
  return {
    beat_id: beat.id,
    scene_id: beat.scene_id,
    source_mode: 'raw_html',
    template_id: null,
    duration_strategy: 'raw_html',
    confidence: 0,
    fallback_from: 'template_inputs',
    fallback_reason: reason || '无兼容模板，已使用自由 HTML。',
    diagnostic: {
      code: 'visual_route_fallback',
      user_message: reason || '无兼容模板，已使用自由 HTML。',
      details: { beat_id: beat.id, scene_id: beat.scene_id, failures },
    },
  };
}

function matchVisualBeatsToRenderers({ visualPlan = {}, registry, renderTarget = {}, options = {} } = {}) {
  const decisions = new Map();
  const beats = Array.isArray(visualPlan.beats) ? visualPlan.beats : [];
  const visualStrategy = options.visualStrategy
    || (options.creativeContext && options.creativeContext.visual_strategy)
    || null;
  for (const beat of beats) {
    if (!beat.id || decisions.has(beat.id)) continue;
    if (visualStrategy === 'asset_first') {
      decisions.set(beat.id, assetFirstDecision(beat));
      continue;
    }
    const scene = beatAsScene(beat);
    const candidates = orderedCandidates(scene);
    const failures = [];
    let picked = null;
    for (const id of candidates) {
      const result = passCandidate({
        template: getTemplate(registry, id),
        scene,
        renderTarget,
        confidence: candidates[0] === id ? 0.9 : 0.7,
      });
      if (result.ok) {
        picked = result;
        break;
      }
      failures.push(`${id}: ${result.reason}`);
    }
    if (!picked) {
      const reason = failures.length ? `共 ${failures.length} 个候选均不可用；首因 ${failures[0]}` : '无兼容模板';
      decisions.set(beat.id, failDecision(beat, reason, failures));
      continue;
    }
    decisions.set(beat.id, {
      beat_id: beat.id,
      scene_id: beat.scene_id,
      source_mode: 'template_inputs',
      template_id: picked.template.id,
      inputs: picked.inputs,
      duration_strategy: 'fit',
      confidence: picked.confidence,
      reason: '匹配到可参数化模板。',
    });
  }
  return decisions;
}

module.exports = { matchVisualBeatsToRenderers };
