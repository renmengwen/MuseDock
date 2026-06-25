const fs = require('fs');
const { resolveSourceEntryPath } = require('./templateRegistry');
const { summarizeCreativeContextForPrompt } = require('./contentGraphAgent');
const { createDiagnostic } = require('./diagnostics');

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

function readTemplateSourceSnippet(template = {}, maxLength = 4000) {
  if (!template || typeof template !== 'object') return '';
  const inlineSource = template.sourceHtml || template.source_html || template.templateHtml || template.template_html;
  if (inlineSource) return compactTemplateSource(inlineSource, maxLength);

  const sourcePath = resolveSourceEntryPath(template);
  if (!sourcePath || !fs.existsSync(sourcePath)) return '';
  try {
    return compactTemplateSource(fs.readFileSync(sourcePath, 'utf8'), maxLength);
  } catch {
    return '';
  }
}

function compactTemplateSource(source, maxLength = 4000) {
  const text = String(source || '').trim();
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

function compactHtmlReference(source, maxLength = 2600) {
  const text = String(source || '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

function buildVisualContinuitySection({ visualStyleReferenceHtml = '', previousFrameHtml = '' } = {}) {
  const styleReference = compactHtmlReference(visualStyleReferenceHtml);
  const previousReference = compactHtmlReference(previousFrameHtml);
  if (!styleReference && !previousReference) return [];
  return [
    '',
    'Visual continuity lock（跨镜头风格锁定）：',
    '本视频按 html-video multi-composition 的思路生成：每一帧可以有不同构图和叙事重点，但必须保持同一套调色板、字体、背景语言、组件形状和 motion vocabulary。',
    '允许当前帧更换构图、信息层级和主视觉对象；不要另起一套视觉主题，不要切换到新的蓝紫科技风、玻璃拟态 dashboard 或与视觉锚点不一致的风格。',
    '如果当前内容需要流程图、卡片、数据或设备界面，必须用视觉锚点中的颜色、字体、形状、阴影、圆角、边框和动效语言重新表达，而不是重新设计一套美术风格。',
    ...(styleReference ? [
      '',
      '全片视觉锚点 HTML（通常来自第一帧；用于锁定全片 visual signature，只参考视觉系统，不复制文案）：',
      '```html',
      styleReference,
      '```',
    ] : []),
    ...(previousReference ? [
      '',
      '相邻上一帧 HTML（用于保持镜头衔接；当前帧要延续它的视觉语言，但内容和构图必须服务当前 frame）：',
      '```html',
      previousReference,
      '```',
    ] : []),
  ];
}

function extractViewportDimensions(html = '') {
  const pairs = [];
  const metaPattern = /<meta\b[^>]*name=["']viewport["'][^>]*>/gi;
  for (const match of String(html || '').matchAll(metaPattern)) {
    const tag = match[0];
    const content = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1] || tag;
    const width = Number(content.match(/\bwidth\s*=\s*(\d{3,5})\b/i)?.[1]);
    const height = Number(content.match(/\bheight\s*=\s*(\d{3,5})\b/i)?.[1]);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      pairs.push({ source: 'viewport', width, height });
    }
  }
  return pairs;
}

function isRootCanvasSelector(selector = '') {
  const normalized = String(selector || '').toLowerCase();
  if (/(^|[\s,])html([\s,]|$)/.test(normalized)) return true;
  if (/(^|[\s,])body([\s,]|$)/.test(normalized)) return true;
  return /[.#-](app|root|stage|scene|frame|canvas|screen|page|video|container)\b/.test(normalized);
}

function extractCssRootDimensions(html = '') {
  const pairs = [];
  const rulePattern = /([^{}]+)\{([^{}]+)\}/g;
  for (const match of String(html || '').matchAll(rulePattern)) {
    const selector = match[1] || '';
    const body = match[2] || '';
    if (!isRootCanvasSelector(selector)) continue;
    const width = Number(body.match(/(?:^|[;\s])width\s*:\s*(\d{3,5})px\b/i)?.[1]);
    const height = Number(body.match(/(?:^|[;\s])height\s*:\s*(\d{3,5})px\b/i)?.[1]);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      pairs.push({ source: `css:${selector.trim().replace(/\s+/g, ' ')}`, width, height });
    }
  }
  return pairs;
}

function validateHtmlTargetResolution(html, target = {}) {
  const resolution = resolveResolution(target);
  const expectedWidth = resolution.width;
  const expectedHeight = resolution.height;
  const pairs = [
    ...extractViewportDimensions(html),
    ...extractCssRootDimensions(html),
  ];
  const mismatched = pairs.find(pair => pair.width !== expectedWidth || pair.height !== expectedHeight);
  if (!mismatched) return { success: true };
  const reversed = mismatched.width === expectedHeight && mismatched.height === expectedWidth;
  return {
    success: false,
    message: [
      `HTML 画幅尺寸不符合目标 ${expectedWidth}x${expectedHeight}。`,
      `${mismatched.source} 使用 ${mismatched.width}x${mismatched.height}。`,
      reversed ? `不能使用 ${expectedHeight}x${expectedWidth}，这会把横屏画面裁进竖屏。` : '',
    ].filter(Boolean).join(''),
    expected: { width: expectedWidth, height: expectedHeight },
    actual: { width: mismatched.width, height: mismatched.height, source: mismatched.source },
  };
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
  visualStyleReferenceHtml = '',
  previousFrameHtml = '',
} = {}) {
  const resolution = resolveResolution(target);
  const adjacent = adjacentSummary(graph, index);
  const templateSource = readTemplateSourceSnippet(template);
  const continuitySection = buildVisualContinuitySection({
    visualStyleReferenceHtml,
    previousFrameHtml,
  });
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
    `必须按目标尺寸生成 root canvas：meta viewport、html/body 或主舞台容器都必须是 ${resolution.width}x${resolution.height}；不能交换宽高。`,
    '',
    'Selected template metadata（用于理解模板身份、输入语义和适配边界）：',
    templateStyleReference(template),
    ...(templateSource ? [
      '',
      'Template HTML — this is the REQUIRED visual style for THIS frame. Reuse its palette, background, typography, layout structure and animation approach; only swap in this frame text/data. Do NOT invent a different theme:',
      '```html',
      templateSource,
      '```',
    ] : [
      '',
      'Template HTML：未能读取模板源码时，仍必须继承所选模板 metadata 描述的视觉方向和 motion vocabulary，不能退化为静态信息图。',
    ]),
    ...continuitySection,
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
    '- Output opens with an animation timeline: define CSS @keyframes/animation, GSAP timeline, or window.__hvPlayAll-driven timeline before the main visual settles.',
    '- 必须包含可检测的动效实现：CSS animation/@keyframes、GSAP timeline 或 window.__hvPlayAll 三者至少一种；禁止完全静态 HTML。',
    '- 主体运动必须覆盖标题、主卡片、核心图表、核心对象或关键数据；不要只有角落装饰、背景扫光、微弱脉冲在动。',
    '- 当前帧长于 6 秒时，必须设计至少 2-3 个 sub-beats，例如入场、数据/观点推进、强调/收束；不要入场后长期静止。',
    '- 动画节奏要服务当前 frame content，避免无意义漂浮、随机闪烁或只有背景纹理变化。',
    '- 可见文本默认使用中文，技术词、品牌名、文件名可保留英文。',
    '- 可见文本尽量加稳定 data-* 属性，例如 data-frame-id、data-role、data-text-key，便于后续编辑。',
    '- raw_html 每帧必须包含稳定可编辑文本锚点：',
    '  - 主标题元素必须带 data-text-key="headline"',
    '  - 副标题或短字幕元素必须带 data-text-key="subtitle"',
    '  - 正文/要点元素必须带 data-text-key="body"',
    '  - 不允许只把可见文案写进 canvas 或伪元素',
    '  - 字幕可由系统注入，但 HTML 不得阻挡底部字幕层',
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

function findScene(sceneSpec = {}, sceneId = '') {
  return (Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [])
    .find(scene => scene && scene.id === sceneId) || {};
}

function buildShortFrameHtmlPrompt({
  frameId = '',
  node = {},
  sceneSpec = {},
  target = {},
} = {}) {
  const resolution = resolveResolution(target);
  const sceneId = frameId || node.id || '';
  const scene = findScene(sceneSpec, sceneId);
  const title = compactText(scene.visual_text?.headline || node.label || scene.title || sceneId, 160);
  const narration = compactText(scene.narration_text || node.text || node.data || '', 420);
  const captions = compactText(scene.captions || [], 360);
  return [
    '你是 html-video 单帧 HTML 生成器。只返回完整 HTML document，不要解释。',
    `当前帧：${sceneId}`,
    `scene title：${title || sceneId}`,
    `当前 scene narration：${narration || '无'}`,
    `当前 scene captions：${captions || '无'}`,
    `Target resolution：${resolution.width}x${resolution.height}`,
    `必须生成 full-bleed ${resolution.width}x${resolution.height} 完整 HTML，包含 <!doctype html>、html、head、body、style。`,
    '必须包含 data-text-key="headline"、data-text-key="subtitle"、data-text-key="body" 三类可见文本锚点。',
    '必须包含基础动画：CSS @keyframes/animation、GSAP timeline 或 window.__hvPlayAll 至少一种。',
    '可见文本使用中文；不要输出 Markdown、解释或 HTML 外文字。',
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
  const validationMessage = compactText(args.validationMessage || args.validation_message || '', 260);
  const continuitySection = buildVisualContinuitySection({
    visualStyleReferenceHtml: args.visualStyleReferenceHtml,
    previousFrameHtml: args.previousFrameHtml,
  });
  return [
    '上一次没有返回有效 HTML。只返回一个完整 HTML document，不要解释。',
    `当前帧 id：${args.node?.id || ''}`,
    `目标尺寸：${resolution.width}x${resolution.height}`,
    validationMessage ? `上一次失败原因：${validationMessage}` : '',
    '必须包含 <!doctype html><html><head><style>...</style></head><body>...</body></html>。',
    `meta viewport、html/body 或主舞台容器必须使用 ${resolution.width}x${resolution.height}；不能使用 ${resolution.height}x${resolution.width}，不要交换宽高。`,
    '必须包含 animation timeline：CSS animation/@keyframes、GSAP timeline 或 window.__hvPlayAll 至少一种。',
    '主体元素必须有明显运动；超过 6 秒的帧必须包含 2-3 个 sub-beats，禁止只有角落闪烁或背景扫光。',
    'raw_html 每帧必须包含 data-text-key="headline"、data-text-key="subtitle"、data-text-key="body" 三类稳定可编辑文本锚点。',
    '不允许只把可见文案写进 canvas 或伪元素；字幕可由系统注入，但 HTML 不得阻挡底部字幕层。',
    '不要输出 [object Object]，不要输出无关导航，不要只改底部 caption。',
    ...continuitySection,
    '只返回一个完整 HTML。',
  ].join('\n');
}

async function callModel(model, prompt, options = {}) {
  if (!model || typeof model.callTextModel !== 'function') {
    return { success: false, message: '未配置 HTML 生成模型。' };
  }
  const response = await model.callTextModel({
    ...objectOrEmpty(options),
    messages: [{ role: 'user', content: prompt }],
  });
  if (!response || response.success === false) {
    return { success: false, message: response?.message || 'AI 调用失败。' };
  }
  const text = response.text || response.content || '';
  if (!String(text || '').trim()) {
    return { success: false, message: '模型返回结果缺少文本内容。', code: 'provider_missing_text' };
  }
  return { success: true, text };
}

function frameDiagnostic(code, message, args = {}, details = {}) {
  return createDiagnostic({
    code,
    stage: 'ai-frame-html',
    sub_stage: 'frame_html',
    frame_id: args.node?.id || '',
    retryable: true,
    repair_action: 'retry_frame_html',
    user_message: message,
    details,
  });
}

function frameFailure(code, message, args = {}, details = {}) {
  return {
    success: false,
    message,
    diagnostics: [frameDiagnostic(code, message, args, details)],
  };
}

async function generateFrameHtml({
  model,
  frameId,
  attempt = 1,
  modelOptions = {},
  shortPrompt = false,
  ...args
} = {}) {
  const callOptions = attempt >= 2 && modelOptions.stream === false ? { stream: false } : modelOptions;
  const promptArgs = {
    ...args,
    frameId,
    node: {
      ...objectOrEmpty(args.node),
      ...(frameId ? { id: args.node?.id || frameId } : {}),
    },
  };
  const firstPrompt = shortPrompt ? buildShortFrameHtmlPrompt(promptArgs) : buildFrameHtmlPrompt(promptArgs);
  const first = await callModel(model, firstPrompt, callOptions);
  if (!first.success) {
    return frameFailure(first.code || 'frame_html_invalid', first.message || '单帧 HTML 生成失败。', promptArgs);
  }
  const firstExtracted = extractHtmlDocument(first.text);
  if (firstExtracted.success) {
    const validation = validateHtmlTargetResolution(firstExtracted.html, promptArgs.target || {});
    if (validation.success) return firstExtracted;
    const retry = await callModel(model, buildRetryPrompt({
      ...promptArgs,
      validationMessage: validation.message,
    }), callOptions);
    if (!retry.success) {
      return frameFailure('frame_html_invalid', retry.message || '单帧 HTML 生成失败。', promptArgs, {
        diagnostics: [validation.message, retry.message].filter(Boolean),
      });
    }
    const retryExtracted = extractHtmlDocument(retry.text);
    if (!retryExtracted.success) {
      return frameFailure('frame_html_invalid', 'AI 未返回有效 HTML document。', promptArgs, {
        diagnostics: [validation.message, retryExtracted.message].filter(Boolean),
      });
    }
    const retryValidation = validateHtmlTargetResolution(retryExtracted.html, promptArgs.target || {});
    if (retryValidation.success) return retryExtracted;
    return frameFailure('frame_html_invalid', 'AI 返回的 HTML 画幅尺寸不符合目标尺寸。', promptArgs, {
      diagnostics: [validation.message, retryValidation.message].filter(Boolean),
    });
  }

  const retry = await callModel(model, buildRetryPrompt(promptArgs), callOptions);
  if (!retry.success) {
    return frameFailure('frame_html_invalid', retry.message || '单帧 HTML 生成失败。', promptArgs, {
      diagnostics: [firstExtracted.message, retry.message].filter(Boolean),
    });
  }
  const retryExtracted = extractHtmlDocument(retry.text);
  if (retryExtracted.success) {
    const retryValidation = validateHtmlTargetResolution(retryExtracted.html, promptArgs.target || {});
    if (retryValidation.success) return retryExtracted;
    return frameFailure('frame_html_invalid', 'AI 返回的 HTML 画幅尺寸不符合目标尺寸。', promptArgs, {
      diagnostics: [firstExtracted.message, retryValidation.message].filter(Boolean),
    });
  }
  return frameFailure('frame_html_invalid', 'AI 未返回有效 HTML document。', promptArgs, {
    diagnostics: [firstExtracted.message, retryExtracted.message].filter(Boolean),
  });
}

module.exports = {
  buildFrameHtmlPrompt,
  buildShortFrameHtmlPrompt,
  extractHtmlDocument,
  generateFrameHtml,
  callModel,
  buildRetryPrompt,
  readTemplateSourceSnippet,
  validateHtmlTargetResolution,
};
