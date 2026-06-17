const { summarizeCreativeContextForPrompt } = require('./contentGraphAgent');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compactText(value, maxLength = 1000) {
  let raw = value;
  if (Array.isArray(value)) {
    raw = value.map(item => compactText(item, 120)).filter(Boolean).join(' / ');
  } else if (value && typeof value === 'object') {
    raw = value.title || value.label || value.name || value.text || value.headline || value.summary || value.description || '';
  }
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text || /^\[object Object\]$/i.test(text)) return '';
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

function resolveResolution(target = {}) {
  const resolution = objectOrEmpty(target.resolution || target.output?.resolution);
  const width = Number(target.width || resolution.width || 1920);
  const height = Number(target.height || resolution.height || 1080);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1920,
    height: Number.isFinite(height) && height > 0 ? height : 1080,
  };
}

function nodeSummary(node = {}) {
  const summary = {
    id: node.id,
    kind: node.kind,
    label: node.label,
    durationSec: node.durationSec,
  };
  if (node.data) summary.data = node.data;
  if (node.text) summary.text = node.text;
  if (node.metadata) summary.metadata = node.metadata;
  return JSON.stringify(summary, null, 2);
}

function adjacentSummary(graph = {}, index) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  return {
    previous: index > 0 ? compactText(nodes[index - 1]?.label || nodes[index - 1]?.text || nodes[index - 1]?.id, 160) : '',
    next: index < nodes.length - 1 ? compactText(nodes[index + 1]?.label || nodes[index + 1]?.text || nodes[index + 1]?.id, 160) : '',
  };
}

function templateStyleReference(template = {}) {
  if (!template || typeof template !== 'object') return '（无模板，仅自由生成完整 HTML）';
  const examples = template.inputs?.examples || template.examples || [];
  return JSON.stringify({
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    tags: template.tags,
    example_inputs: examples,
  }, null, 2);
}

function buildFrameHtmlPrompt({
  graph = {},
  node = {},
  index = 0,
  total = 1,
  sceneSpec = {},
  creativeContext = {},
  target = {},
  template = null,
} = {}) {
  const resolution = resolveResolution(target);
  const adjacent = adjacentSummary(graph, index);
  return [
    '你是 html-video 单帧完整 HTML 生成器。',
    '请输出 exactly one fenced ```html code block 或一个完整 HTML document；不要输出解释、Markdown 说明或 HTML 之外的 prose。',
    '',
    `当前帧：${node.id || `frame_${index + 1}`}（${index + 1}/${total}）`,
    '当前 frame content graph node：',
    nodeSummary(node),
    '',
    `Whole video synopsis：${compactText(graph.synopsis || sceneSpec.title || '', 500)}`,
    `上一帧：${adjacent.previous || '无'}`,
    `下一帧：${adjacent.next || '无'}`,
    '',
    `Target resolution：${resolution.width}x${resolution.height}，画面必须 full-bleed ${resolution.width}x${resolution.height}，不要留白边或浏览器默认 margin。`,
    '',
    'Style reference from selected template（只作为视觉风格参考，不要把它当成固定 inputs schema）：',
    templateStyleReference(template),
    '',
    'Source context summary：',
    summarizeCreativeContextForPrompt(creativeContext) || '（无）',
    '',
    'scene_spec 摘要：',
    JSON.stringify({
      title: sceneSpec.title || '',
      scenes: Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [],
    }, null, 2),
    '',
    '硬性要求：',
    '- 生成这一帧的 fresh complete HTML page，包含 <!doctype html>、html、head、body、style；JS 可选但不能依赖外网。',
    '- 可见文本默认使用中文，技术词、品牌名、文件名可保留英文。',
    '- 可见文本尽量加稳定 data-* 属性，例如 data-frame-id、data-role、data-text-key，便于后续编辑。',
    '- 不要让每一帧都使用相同主布局；相邻帧必须有清晰不同的主视觉、层级或构图。',
    '- 不要只改底部 caption；主画面、数据、标题或视觉结构必须服务当前 frame content。',
    '- 不要保留与内容无关的模板导航标签，例如 Search / GitHub / Tech Forums / Docs / Issues，除非这些词就是当前内容事实。',
    '- 不要输出 [object Object]；对象必须提取成有意义的文字或数据。',
    '- 不要发明源素材中没有的精确事实、数字、品牌、机构或时间。',
    '- 不要输出解释，不要在 HTML block 外写任何文字。',
    '',
    '请返回：',
    '```html',
    '<!doctype html>',
    '<html>...</html>',
    '```',
  ].join('\n');
}

function extractHtmlDocument(text) {
  const raw = String(text || '').trim();
  if (!raw) return { success: false, message: 'AI 返回为空，未返回有效 HTML。' };
  const fenced = raw.match(/```html\s*([\s\S]*?)```/i);
  const html = fenced ? fenced[1].trim() : extractRawHtmlDocument(raw);
  if (!/(<!doctype\s+html|<html[\s>])/i.test(html) || !/<\/html>/i.test(html)) {
    return { success: false, message: 'AI 未返回有效 HTML document。' };
  }
  return { success: true, html };
}

function extractRawHtmlDocument(raw) {
  const doctypeMatch = raw.match(/<!doctype\s+html[\s\S]*?<\/html>/i);
  if (doctypeMatch) return doctypeMatch[0].trim();
  const htmlMatch = raw.match(/<html[\s\S]*?<\/html>/i);
  if (htmlMatch) return htmlMatch[0].trim();
  return raw.trim();
}

function buildRetryPrompt(args = {}) {
  const resolution = resolveResolution(args.target || {});
  return [
    '上一次没有返回有效 HTML。只返回一个完整 HTML document，不要解释。',
    `当前帧 id：${args.node?.id || ''}`,
    `目标尺寸：${resolution.width}x${resolution.height}`,
    '必须包含 <!doctype html><html><head><style>...</style></head><body>...</body></html>。',
    '不要输出 [object Object]，不要输出无关导航，不要只改底部 caption。',
    '只返回一个完整 HTML。',
  ].join('\n');
}

async function callModel(model, prompt) {
  if (!model || typeof model.callTextModel !== 'function') {
    return { success: false, message: '未配置 HTML 生成模型。' };
  }
  const response = await model.callTextModel({
    messages: [{ role: 'user', content: prompt }],
  });
  if (!response || response.success === false) {
    return { success: false, message: response?.message || 'AI 调用失败。' };
  }
  return { success: true, text: response.text || response.content || '' };
}

async function generateFrameHtml({ model, ...args } = {}) {
  const firstPrompt = buildFrameHtmlPrompt(args);
  const first = await callModel(model, firstPrompt);
  if (!first.success) return first;
  const firstExtracted = extractHtmlDocument(first.text);
  if (firstExtracted.success) return firstExtracted;

  const retry = await callModel(model, buildRetryPrompt(args));
  if (!retry.success) return retry;
  const retryExtracted = extractHtmlDocument(retry.text);
  if (retryExtracted.success) return retryExtracted;
  return {
    success: false,
    message: 'AI 未返回有效 HTML document。',
    diagnostics: [firstExtracted.message, retryExtracted.message].filter(Boolean),
  };
}

module.exports = {
  buildFrameHtmlPrompt,
  extractHtmlDocument,
  generateFrameHtml,
  buildRetryPrompt,
};
