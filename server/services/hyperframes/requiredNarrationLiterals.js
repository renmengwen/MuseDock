function sceneNumber(value) {
  const match = String(value || '').match(/(?:^|_)(?:S|scene_?)(\d{1,3})$/i)
    || String(value || '').match(/^S(\d{1,3})$/i);
  return match ? Number(match[1]) : 0;
}

function extractRequiredNarrationLiterals(rawText = '') {
  const text = String(rawText || '');
  const requirements = [];
  const seen = new Set();
  const scenePattern = /\b(S\d{2,3})\b/gi;
  const sceneMatches = [...text.matchAll(scenePattern)];
  for (const [index, sceneMatch] of sceneMatches.entries()) {
    const sceneId = sceneMatch[1].toUpperCase();
    const segmentStart = sceneMatch.index + sceneMatch[0].length;
    const segmentEnd = sceneMatches[index + 1]?.index ?? text.length;
    const segment = text.slice(segmentStart, segmentEnd);
    const literalPattern = /旁白必须(?:完整)?包含\s*(?:“([^”\r\n]+)”|"([^"\r\n]+)")/g;
    for (const literalMatch of segment.matchAll(literalPattern)) {
      const literal = String(literalMatch[1] || literalMatch[2] || '').trim();
      const key = `${sceneId}\u0000${literal}`;
      if (!literal || seen.has(key)) continue;
      seen.add(key);
      requirements.push({ scene_id: sceneId, literal });
    }
  }
  return requirements;
}

function parseSceneId(scene) {
  for (const value of [scene?.id, scene?.scene_id, scene?.sceneId]) {
    const number = sceneNumber(value);
    if (number) return number;
  }
  return 0;
}

function findScene(scenes, requirement) {
  const list = Array.isArray(scenes) ? scenes : [];
  const requiredNumber = sceneNumber(requirement?.scene_id);
  const explicitlyIdentified = list.map(scene => ({ scene, number: parseSceneId(scene) })).filter(item => item.number);
  if (explicitlyIdentified.length) {
    const matches = explicitlyIdentified.filter(item => item.number === requiredNumber);
    if (matches.length !== 1) {
      return { scene: null, reason: matches.length > 1 ? 'duplicate_scene_id' : 'scene_id_not_found' };
    }
    return { scene: matches[0].scene, reason: '' };
  }
  const matches = list.filter((scene, index) => Number(scene?.index || scene?.order || index + 1) === requiredNumber);
  return {
    scene: matches.length === 1 ? matches[0] : null,
    reason: matches.length > 1 ? 'duplicate_scene_order' : (matches.length ? '' : 'scene_order_not_found'),
  };
}

function validateRequiredNarrationLiterals(scenes = [], requirements = []) {
  const missing = [];
  for (const requirement of Array.isArray(requirements) ? requirements : []) {
    const resolved = findScene(scenes, requirement);
    const scene = resolved.scene;
    const narrationText = String(scene?.narration_text || scene?.narration || scene?.voiceover || scene?.script || '');
    if (!scene || !narrationText.includes(requirement.literal)) {
      missing.push({
        scene_id: requirement.scene_id,
        literal: requirement.literal,
        actual: narrationText,
        reason: resolved.reason || 'literal_missing',
      });
    }
  }
  return {
    ok: missing.length === 0,
    code: missing.length ? 'brief_required_literal_missing' : '',
    missing,
    message: missing.length
      ? `导演策划缺少 ${missing.length} 条用户指定旁白原句：${missing.map(item => `${item.scene_id}「${item.literal}」`).join('；')}。`
      : '',
  };
}

module.exports = {
  extractRequiredNarrationLiterals,
  validateRequiredNarrationLiterals,
};
