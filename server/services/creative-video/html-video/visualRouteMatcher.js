const { orderedCandidates, passCandidate } = require('./sceneTemplateMatcher');

function getTemplate(registry, id) {
  if (!registry) return null;
  if (typeof registry.getTemplate === 'function') return registry.getTemplate(id);
  if (registry instanceof Map) return registry.get(id);
  return null;
}

function beatAsScene(beat = {}) {
  return {
    ...(beat.source_scene || {}),
    id: beat.id,
    scene_id: beat.scene_id,
    kind: beat.kind,
    duration_sec: beat.duration_sec,
    narration_text: beat.narration_text,
    visual_text: beat.visual_text,
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
  for (const beat of beats) {
    const candidates = orderedCandidates(beatAsScene(beat));
    const failures = [];
    let picked = null;
    for (const id of candidates) {
      const result = passCandidate({
        template: getTemplate(registry, id),
        scene: beatAsScene(beat),
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
