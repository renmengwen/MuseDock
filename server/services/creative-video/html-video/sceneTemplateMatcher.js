const { validateTemplateCompatibility } = require('./templateRegistry');
const { validateTemplateInputs } = require('./templateInputAgent');
const { supportsTemplateInputs } = require('./templateCapability');
const { mapSceneToTemplateInputs } = require('./templateInputMappers');

const PARAMETERIZED_TEMPLATES = new Set([
  'frame-pentagram-stat',
  'frame-data-chart-nyt',
  'frame-glitch-title',
  'frame-logo-outro',
  'frame-bold-poster',
  'frame-takram-organic',
  'frame-build-minimal',
  'frame-electric-studio',
]);

const KIND_TEMPLATE_CANDIDATES = {
  text: ['frame-glitch-title', 'frame-kinetic-type', 'frame-build-minimal', 'frame-creative-voltage', 'frame-swiss-grid'],
  data: ['frame-pentagram-stat', 'frame-data-chart-nyt', 'frame-nyt-graph'],
  quote: ['frame-electric-studio'],
  steps: ['frame-decision-tree', 'frame-takram-organic'],
  comparison: ['frame-data-chart-nyt', 'frame-electric-studio', 'frame-creative-voltage'],
  cta: ['frame-logo-outro', 'frame-bold-poster', 'frame-bold-signal'],
};

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

function sceneTextItems(scene = {}) {
  const v = scene.visual_text || {};
  return [
    v.headline,
    ...(Array.isArray(v.keywords) ? v.keywords : []),
    ...(Array.isArray(v.cards) ? v.cards : []),
  ].filter(Boolean).map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item)));
}

function numericCount(scene) {
  return sceneTextItems(scene).filter(item => /[$￥¥]?\d|%/.test(item)).length;
}

function orderedCandidates(scene = {}) {
  const kind = scene.kind || 'text';
  const base = [...(KIND_TEMPLATE_CANDIDATES[kind] || [])];
  if (kind === 'data') {
    const count = numericCount(scene);
    const preferred = count >= 3 ? 'frame-data-chart-nyt' : 'frame-pentagram-stat';
    return [preferred, ...base.filter(id => id !== preferred)];
  }
  if (kind === 'comparison') {
    const cards = scene.visual_text?.cards;
    if (Array.isArray(cards) && cards.length >= 2) return ['frame-data-chart-nyt', ...base.filter(id => id !== 'frame-data-chart-nyt')];
  }
  return base;
}

function failDecision(sceneId, reason, details = {}) {
  return {
    scene_id: sceneId,
    source_mode: 'raw_html',
    template_id: null,
    confidence: 0,
    reason,
    fallback_reason: reason,
    diagnostic: {
      code: 'scene_template_fallback',
      user_message: reason,
      details,
    },
  };
}

function passCandidate({ template, scene, renderTarget, confidence }) {
  if (!template) return { ok: false, reason: '未找到候选模板' };
  if (!supportsTemplateInputs(template)) return { ok: false, reason: '模板未接线变量' };
  if (!PARAMETERIZED_TEMPLATES.has(template.id)) return { ok: false, reason: '模板尚未参数化' };
  const compatibility = validateTemplateCompatibility(template, {
    engines: ['hyperframes'],
    aspects: [renderTarget.aspectRatio || renderTarget.aspect_ratio].filter(Boolean),
    durationSec: resolveSceneDurationSec(scene),
    commercialOnly: true,
  });
  if (!compatibility.ok) return { ok: false, reason: compatibility.reasons[0]?.message || '模板不兼容' };
  const inputs = mapSceneToTemplateInputs(template.id, scene, template.inputs?.schema || {});
  const inputValidation = validateTemplateInputs(inputs, template);
  if (!inputValidation.success) return { ok: false, reason: inputValidation.user_message || '模板字段不合格' };
  return { ok: true, template, inputs, confidence };
}

function getTemplate(registry, id) {
  if (!registry) return null;
  if (typeof registry.getTemplate === 'function') return registry.getTemplate(id);
  if (registry instanceof Map) return registry.get(id);
  return null;
}

function matchScenesToTemplates({ scenes = [], registry, renderTarget = {}, options = {} } = {}) {
  const decisions = new Map();
  const rr = new Map();
  for (const scene of Array.isArray(scenes) ? scenes : []) {
    const sceneId = scene.id || scene.scene_id;
    const candidates = orderedCandidates(scene);
    const passed = [];
    const failures = [];
    for (const id of candidates) {
      if (id === 'frame-data-rollup') continue;
      const result = passCandidate({
        template: getTemplate(registry, id),
        scene,
        renderTarget,
        confidence: candidates[0] === id ? 0.9 : 0.7,
      });
      if (result.ok) passed.push(result);
      else failures.push(`${id}: ${result.reason}`);
    }
    if (!passed.length) {
      decisions.set(sceneId, failDecision(sceneId, failures[0] || '无兼容模板', { failures }));
      continue;
    }
    const bestConfidence = Math.max(...passed.map(item => item.confidence));
    const best = passed.filter(item => item.confidence === bestConfidence);
    const key = `${scene.kind || 'text'}:${bestConfidence}`;
    const index = best.length > 1 && options.roundRobin !== false ? (rr.get(key) || 0) % best.length : 0;
    rr.set(key, (rr.get(key) || 0) + 1);
    const picked = best[index];
    decisions.set(sceneId, {
      scene_id: sceneId,
      source_mode: 'template_inputs',
      template_id: picked.template.id,
      inputs: picked.inputs,
      confidence: picked.confidence,
      reason: '匹配到可参数化模板。',
    });
  }
  return decisions;
}

module.exports = {
  PARAMETERIZED_TEMPLATES,
  KIND_TEMPLATE_CANDIDATES,
  matchScenesToTemplates,
  resolveSceneDurationSec,
  orderedCandidates,
  passCandidate,
  getTemplate,
};
