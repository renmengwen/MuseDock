// asset_first 单链路：所有 beat 走 raw_html（主视觉 + 局部 overlay / diagram）。
// route_role 无图语义与 visual_base 对齐——无 asset 的 beat 统一 diagram_motion。
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
      reason: '素材做主视觉，HTML 仅做局部 overlay。',
    };
  }
  return {
    beat_id: beat.id,
    scene_id: beat.scene_id,
    source_mode: 'raw_html',
    route_role: 'diagram_motion',
    template_id: null,
    duration_strategy: 'raw_html',
    confidence: 0.9,
    reason: '无图场景按统一 diagram/局部动效生成。',
  };
}

function matchVisualBeatsToRenderers({ visualPlan = {} } = {}) {
  const decisions = new Map();
  const beats = Array.isArray(visualPlan.beats) ? visualPlan.beats : [];
  for (const beat of beats) {
    if (!beat.id || decisions.has(beat.id)) continue;
    decisions.set(beat.id, assetFirstDecision(beat));
  }
  return decisions;
}

module.exports = { matchVisualBeatsToRenderers };
