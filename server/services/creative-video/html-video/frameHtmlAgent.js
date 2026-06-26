const fs = require('fs');
const { resolveSourceEntryPath } = require('./templateRegistry');
const { summarizeCreativeContextForPrompt } = require('./contentGraphAgent');
const { createDiagnostic } = require('./diagnostics');
const {
  normalizeHtmlCanvasContract,
  validateHtmlCanvasContract,
} = require('./frameCanvasContract');

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

function validateHtmlTargetResolution(html, target = {}) {
  return validateHtmlCanvasContract(html, target);
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
    `必须包含明确根画布 contract：body 或 #root 带 data-hv-canvas、data-width="${resolution.width}"、data-height="${resolution.height}"；普通装饰元素可有自己的 width/height，但不能替代根画布。`,
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
    '- 如果 Source context summary 提供“可用图片素材”，本帧内容适合引用时，可以使用其中的 HTML引用路径，例如 <img src="../assets/source-image-01.jpg">；禁止引用外部图片 URL。',
    '- 文章截图或含文字图片必须完整展示，使用 object-fit: contain；不要裁切成不可读背景。图库/search 图片只适合做弱背景或氛围层，必须加遮罩保证文字可读。',
    '- 不要做纯图片轮播；图片必须和本帧关键词、字幕、数据卡、框选、高亮或解释文案混排。',
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

function decodeBasicHtmlEntities(text = '') {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    });
}

function htmlVisibleSegments(html = '') {
  const withoutHidden = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  return decodeBasicHtmlEntities(withoutHidden.replace(/<[^>]+>/g, '\n'))
    .split(/\r?\n/)
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function visibleHtmlText(html = '') {
  return htmlVisibleSegments(html).join(' ').replace(/\s+/g, ' ').trim();
}

function normalizedComparableText(value = '') {
  return decodeBasicHtmlEntities(value)
    .replace(/\s+/g, '')
    .replace(/[“”‘’"']/g, '')
    .trim()
    .toLowerCase();
}

function flattenTextValues(value, output = []) {
  if (value === null || value === undefined) return output;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = compactText(value, 600);
    if (text) output.push(text);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => flattenTextValues(item, output));
    return output;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      if (/^(id|scene_id|frame_id|kind|type|status|path|url|html_path|mp4_path)$/i.test(key)) return;
      flattenTextValues(item, output);
    });
  }
  return output;
}

function resolveSceneForFrame(sceneSpec = {}, node = {}, frameId = '') {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const candidates = [
    node?.metadata?.scene_id,
    node?.scene_id,
    node?.sceneId,
    frameId,
    node?.id,
  ].map(item => String(item || '').trim()).filter(Boolean);
  return scenes.find(scene => candidates.includes(String(scene?.id || '').trim()))
    || (scenes.length === 1 ? scenes[0] : {});
}

function expectedContentTexts(args = {}) {
  const scene = resolveSceneForFrame(args.sceneSpec || {}, args.node || {}, args.frameId || args.node?.id || '');
  const values = [];
  flattenTextValues(scene?.visual_text, values);
  flattenTextValues(scene?.title, values);
  flattenTextValues(scene?.narration_text, values);
  flattenTextValues(scene?.captions, values);
  flattenTextValues(args.node?.label, values);
  flattenTextValues(args.node?.text, values);
  flattenTextValues(args.node?.data, values);
  return [...new Set(values.map(item => compactText(item, 600)).filter(Boolean))];
}

function primaryExpectedText(args = {}) {
  const scene = resolveSceneForFrame(args.sceneSpec || {}, args.node || {}, args.frameId || args.node?.id || '');
  return compactText(
    scene?.visual_text?.headline
      || scene?.headline
      || args.node?.label
      || args.node?.text
      || scene?.title
      || '',
    180,
  );
}

function textLengthScore(text = '') {
  const value = String(text || '');
  const chinese = (value.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (value.match(/[A-Za-z0-9]/g) || []).length;
  return chinese + latin;
}

function templateVisiblePhrases(template = {}) {
  const source = readTemplateSourceSnippet(template, 12000);
  if (!source) return [];
  const phrases = [];
  for (const segment of htmlVisibleSegments(source)) {
    String(segment || '')
      .split(/[\s|/\\,，。.!！?？:：;；、()[\]{}<>]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .forEach(item => {
        const comparable = normalizedComparableText(item);
        if (textLengthScore(comparable) >= 4) phrases.push(item);
      });
  }
  return [...new Set(phrases)];
}

function contentOverlapScore(htmlComparable, expectedTexts) {
  const tokens = new Set();
  for (const text of expectedTexts) {
    const raw = String(text || '');
    for (const match of raw.matchAll(/[A-Za-z][A-Za-z0-9_-]{2,}/g)) {
      tokens.add(match[0].toLowerCase());
    }
    for (const match of raw.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
      const chunk = match[0];
      if (chunk.length <= 6) {
        tokens.add(chunk);
      } else {
        for (let index = 0; index <= chunk.length - 4; index += 2) {
          tokens.add(chunk.slice(index, index + 4));
        }
      }
    }
  }
  return [...tokens]
    .filter(token => textLengthScore(token) >= 3 && htmlComparable.includes(normalizedComparableText(token)))
    .length;
}

function validateHtmlContentQuality(html, args = {}) {
  const expectedTexts = expectedContentTexts(args);
  const expectedComparable = normalizedComparableText(expectedTexts.join(' '));
  const htmlComparable = normalizedComparableText(visibleHtmlText(html));
  const leakedPhrases = templateVisiblePhrases(args.template)
    .filter(phrase => {
      const comparable = normalizedComparableText(phrase);
      return comparable
        && htmlComparable.includes(comparable)
        && !expectedComparable.includes(comparable);
    });
  if (leakedPhrases.length) {
    const shown = leakedPhrases.slice(0, 3);
    return {
      success: false,
      code: 'frame_html_template_text_leak',
      message: `HTML 保留了模板默认文案：${shown.join('、')}。请只继承模板视觉风格，替换为当前镜头内容。`,
      details: {
        leaked_text: shown,
        expected_headline: primaryExpectedText(args),
      },
    };
  }

  const primary = primaryExpectedText(args);
  const primaryComparable = normalizedComparableText(primary);
  if (primaryComparable && !htmlComparable.includes(primaryComparable)) {
    const overlap = contentOverlapScore(htmlComparable, expectedTexts);
    if (overlap < 2) {
      return {
        success: false,
        code: 'frame_html_content_mismatch',
        message: `HTML 主画面文案没有匹配当前镜头内容，缺少核心标题或足够关键词：${primary}。`,
        details: {
          expected_headline: primary,
          overlap_score: overlap,
        },
      };
    }
  }

  return { success: true };
}

function validateGeneratedHtml(html, args = {}) {
  const resolution = validateHtmlTargetResolution(html, args.target || {});
  if (!resolution.success) {
    return {
      success: false,
      code: 'frame_html_invalid',
      message: resolution.message || 'AI 返回的 HTML 画幅尺寸不符合目标尺寸。',
      details: resolution,
    };
  }
  return validateHtmlContentQuality(html, args);
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
    `body 或 #root 必须带 data-hv-canvas、data-width="${resolution.width}"、data-height="${resolution.height}"。`,
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
  const expectedTexts = expectedContentTexts(args).slice(0, 8);
  const expectedHeadline = primaryExpectedText(args);
  const continuitySection = buildVisualContinuitySection({
    visualStyleReferenceHtml: args.visualStyleReferenceHtml,
    previousFrameHtml: args.previousFrameHtml,
  });
  return [
    '上一次没有返回有效 HTML。只返回一个完整 HTML document，不要解释。',
    `当前帧 id：${args.node?.id || ''}`,
    `目标尺寸：${resolution.width}x${resolution.height}`,
    validationMessage ? `上一次失败原因：${validationMessage}` : '',
    expectedHeadline ? `当前镜头核心标题：${expectedHeadline}` : '',
    expectedTexts.length ? `当前镜头允许使用的内容文案：${expectedTexts.join(' / ')}` : '',
    args.template ? '如果使用模板，必须删除模板默认可见文案，只保留视觉风格、布局、配色、动效和结构。' : '',
    `必须包含 <!doctype html><html><head><style>...</style></head><body data-hv-canvas data-width="${resolution.width}" data-height="${resolution.height}">...</body></html>。`,
    `meta viewport、html/body 或主舞台容器必须使用 ${resolution.width}x${resolution.height}；不能使用 ${resolution.height}x${resolution.width}，不要交换宽高。`,
    '普通装饰元素可以有自己的 width/height，但不能替代 data-hv-canvas 根画布。',
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
    const message = response?.message || 'AI 调用失败。';
    return {
      success: false,
      message,
      ...(isProviderMissingTextMessage(message) ? { code: 'provider_missing_text' } : {}),
    };
  }
  const text = response.text || response.content || '';
  if (!String(text || '').trim()) {
    return { success: false, message: '模型返回结果缺少文本内容。', code: 'provider_missing_text' };
  }
  return { success: true, text };
}

function isProviderMissingTextMessage(message = '') {
  return /返回结果缺少文本内容|流式返回结果缺少文本内容|缺少文本/.test(String(message || ''));
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

function htmlRetryFailureMessage(retry = {}) {
  return retry.code === 'provider_missing_text'
    ? 'AI 未返回有效 HTML document。'
    : (retry.message || '单帧 HTML 生成失败。');
}

async function generateFrameHtml({
  model,
  frameId,
  attempt = 1,
  modelOptions = {},
  shortPrompt = false,
  ...args
} = {}) {
  const callOptions = attempt >= 2 ? { ...modelOptions, stream: false } : modelOptions;
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
  const allowInternalRetry = attempt < 2 && shortPrompt !== true;
  const firstExtracted = extractHtmlDocument(first.text);
  if (firstExtracted.success) {
    const normalizedHtml = normalizeHtmlCanvasContract(firstExtracted.html, promptArgs.target || {});
    const validation = validateGeneratedHtml(normalizedHtml, promptArgs);
    if (validation.success) return { ...firstExtracted, html: normalizedHtml };
    if (!allowInternalRetry) {
      return frameFailure(validation.code || 'frame_html_invalid', validation.message || '单帧 HTML 内容校验失败。', promptArgs, validation.details || {});
    }
    const retry = await callModel(model, buildRetryPrompt({
      ...promptArgs,
      validationMessage: validation.message,
    }), callOptions);
    if (!retry.success) {
      return frameFailure('frame_html_invalid', htmlRetryFailureMessage(retry), promptArgs, {
        diagnostics: [validation.message, retry.message].filter(Boolean),
      });
    }
    const retryExtracted = extractHtmlDocument(retry.text);
    if (!retryExtracted.success) {
      return frameFailure('frame_html_invalid', 'AI 未返回有效 HTML document。', promptArgs, {
        diagnostics: [validation.message, retryExtracted.message].filter(Boolean),
      });
    }
    const retryHtml = normalizeHtmlCanvasContract(retryExtracted.html, promptArgs.target || {});
    const retryValidation = validateGeneratedHtml(retryHtml, promptArgs);
    if (retryValidation.success) return { ...retryExtracted, html: retryHtml };
    return frameFailure(retryValidation.code || 'frame_html_invalid', retryValidation.message || '单帧 HTML 内容校验失败。', promptArgs, {
      diagnostics: [validation.message, retryValidation.message].filter(Boolean),
      details: retryValidation.details || {},
    });
  }

  if (!allowInternalRetry) {
    return frameFailure('frame_html_invalid', firstExtracted.message || 'AI 未返回有效 HTML document。', promptArgs);
  }
  const retry = await callModel(model, buildRetryPrompt(promptArgs), callOptions);
  if (!retry.success) {
    return frameFailure('frame_html_invalid', htmlRetryFailureMessage(retry), promptArgs, {
      diagnostics: [firstExtracted.message, retry.message].filter(Boolean),
    });
  }
  const retryExtracted = extractHtmlDocument(retry.text);
  if (retryExtracted.success) {
    const retryHtml = normalizeHtmlCanvasContract(retryExtracted.html, promptArgs.target || {});
    const retryValidation = validateGeneratedHtml(retryHtml, promptArgs);
    if (retryValidation.success) return { ...retryExtracted, html: retryHtml };
    return frameFailure(retryValidation.code || 'frame_html_invalid', retryValidation.message || '单帧 HTML 内容校验失败。', promptArgs, {
      diagnostics: [firstExtracted.message, retryValidation.message].filter(Boolean),
      details: retryValidation.details || {},
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
  validateHtmlContentQuality,
};
