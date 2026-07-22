function sceneNumber(value) {
  const match = String(value || '').match(/(?:^|_)(?:S|scene_?)(\d{1,3})$/i)
    || String(value || '').match(/^S(\d{1,3})$/i);
  return match ? Number(match[1]) : 0;
}

function extractRequiredNarrationLiterals(rawText = '') {
  const text = String(rawText || '');
  const requirements = [];
  const pattern = /\b(S\d{2,3})\b(?:(?!\bS\d{2,3}\b)[\s\S])*?旁白必须(?:完整)?包含\s*“([^”\r\n]+)”/gi;
  for (const match of text.matchAll(pattern)) {
    const literal = String(match[2] || '').trim();
    if (literal) requirements.push({ scene_id: match[1].toUpperCase(), literal });
  }
  return requirements;
}

function findScene(scenes, requirement) {
  const requiredNumber = sceneNumber(requirement?.scene_id);
  return (Array.isArray(scenes) ? scenes : []).find((scene, index) => {
    const idNumber = sceneNumber(scene?.id || scene?.scene_id || scene?.sceneId);
    const order = Number(scene?.index || scene?.order || index + 1);
    return (idNumber && idNumber === requiredNumber) || order === requiredNumber;
  });
}

function validateRequiredNarrationLiterals(scenes = [], requirements = []) {
  const missing = [];
  for (const requirement of Array.isArray(requirements) ? requirements : []) {
    const scene = findScene(scenes, requirement);
    const narrationText = String(scene?.narration_text || scene?.narration || scene?.voiceover || scene?.script || '');
    if (!scene || !narrationText.includes(requirement.literal)) {
      missing.push({
        scene_id: requirement.scene_id,
        literal: requirement.literal,
        actual: narrationText,
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
