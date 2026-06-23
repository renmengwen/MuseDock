const { parseJsonOnlyResponse } = require('./templateInputAgent');

function stringify(value) {
  return JSON.stringify(value || {}, null, 2);
}

function fail(userMessage, diagnostics = []) {
  return {
    success: false,
    user_message: userMessage,
    message: userMessage,
    fallback_allowed: true,
    diagnostics: diagnostics.length ? diagnostics : [userMessage],
  };
}

function normalizeIndex(compactIndex = []) {
  return Array.isArray(compactIndex) ? compactIndex : [];
}

function buildTemplateSelectionPrompt({ sceneSpec, compactIndex, target } = {}) {
  return [
    '你是 html-video 模板选择助手。',
    '只返回 JSON，不要输出 Markdown、解释、注释或代码块。',
    '不要输出 HTML、CSS、JavaScript、完整页面、index.html、hyperframes.json、package.json 或 files 数组。',
    '你只能从可用模板列表中选择一个 template_id。',
    '返回格式必须严格是：',
    '{ "template_id": "frame-glitch-title", "reason": "内容偏科技感和冲突感，适合故障风标题模板", "confidence": 0.86 }',
    'confidence 必须是 0 到 1 的数字。',
    '选择时优先匹配主题、情绪、场景类型、宽高比和目标时长。',
    'scene_spec：',
    stringify(sceneSpec),
    'target：',
    stringify(target),
    '可用模板 compactIndex：',
    stringify(normalizeIndex(compactIndex)),
  ].join('\n');
}

function parseTemplateSelectionResponse(responseText, { compactIndex = [], allowedTemplateIds } = {}) {
  const parsed = parseJsonOnlyResponse(responseText);
  if (!parsed.success) {
    return fail(parsed.user_message || '模板选择返回不是有效 JSON。', parsed.diagnostics || []);
  }

  const data = parsed.data;
  const templateId = typeof data.template_id === 'string' ? data.template_id.trim() : '';
  if (!templateId) {
    return fail('模板选择失败：AI 未返回 template_id。', ['missing_template_id']);
  }

  const availableIds = normalizeIndex(compactIndex).map(item => item && item.id).filter(Boolean);
  if (availableIds.length && !availableIds.includes(templateId)) {
    return fail(`模板选择失败：AI 返回了不存在的 template_id：${templateId}。`, [`unknown_template_id:${templateId}`]);
  }

  if (Array.isArray(allowedTemplateIds) && allowedTemplateIds.length && !allowedTemplateIds.includes(templateId)) {
    return fail(`模板选择失败：template_id ${templateId} 不在本次允许的模板范围内。`, [`filtered_template_id:${templateId}`]);
  }

  const confidence = Number(data.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return fail('模板选择失败：confidence 必须是 0 到 1 的数字。', ['invalid_confidence']);
  }

  return {
    success: true,
    template_id: templateId,
    reason: typeof data.reason === 'string' ? data.reason : '',
    confidence,
    raw: data,
  };
}

module.exports = {
  buildTemplateSelectionPrompt,
  parseTemplateSelectionResponse,
};
