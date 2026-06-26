function compactText(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function hasTerminalPunctuation(text) {
  return /[。！？!?…」』）)]$/.test(compactText(text));
}

function endsWithDanglingToken(text) {
  const value = compactText(text);
  return /[，,、：:；;]$/.test(value)
    || /(明明|如果|因为|所以|但是|而是|比如|例如|以及|或者|并且|然后|正在|已经|可以|需要|把|将|给|对|在|用|有|是)$/.test(value)
    || /[A-Za-z]{8,}$/.test(value);
}

function isIncompleteNarration(text) {
  const value = compactText(text);
  if (!value) return false;
  if (isConditionalFragment(value)) return true;
  if (hasTerminalPunctuation(value)) return false;
  if (endsWithDanglingToken(value)) return true;
  const hasLongClause = /[，,：:；;]/.test(value) && value.length >= 18;
  return hasLongClause;
}

function isConditionalFragment(text) {
  const value = compactText(text);
  return /^(如果|当|假如|若|要是).{2,18}[。！？!?]$/.test(value)
    && !/(就|则|建议|推荐|优先|选择|可以|应该|最好|通常|直接|记住|关键|结论|够用)/.test(value);
}

function trimNarrationToCompleteBoundary(text, maxChars) {
  const limit = Math.max(1, Number(maxChars || 0));
  const compact = compactText(text);
  if (compact.length <= limit) return compact;

  const withinLimit = compact.slice(0, limit);
  const strong = [...withinLimit.matchAll(/[。！？!?]/g)].map(match => match.index + 1).pop();
  if (strong && strong >= Math.min(8, limit)) return withinLimit.slice(0, strong);

  const soft = [...withinLimit.matchAll(/[，,：:；;]/g)].map(match => match.index).pop();
  if (soft && soft >= Math.min(8, limit - 1)) return `${withinLimit.slice(0, soft)}。`;

  return `${withinLimit.slice(0, Math.max(1, limit - 1))}。`;
}

function validateNarrationScenes(scenes = []) {
  const issues = [];
  for (const [index, scene] of (Array.isArray(scenes) ? scenes : []).entries()) {
    const text = String(scene?.narration_text || '').trim();
    if (isIncompleteNarration(text)) {
      issues.push({
        index: Number(scene?.index || index + 1),
        narration_text: text,
      });
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    message: issues.length
      ? `检测到 ${issues.length} 段旁白不完整或像半句截断，请重新生成导演策划后再配音。`
      : '',
  };
}

module.exports = {
  isIncompleteNarration,
  trimNarrationToCompleteBoundary,
  validateNarrationScenes,
};
