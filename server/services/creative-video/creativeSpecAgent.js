const enums = require('./specEnums');
const sceneSpecService = require('./sceneSpecService');
const frameSpecService = require('./frameSpecService');

function stringify(value) {
  return JSON.stringify(value || {}, null, 2);
}

function retrySection(retryCount, previousErrors) {
  if (!retryCount) {
    return '';
  }
  const errors = Array.isArray(previousErrors) && previousErrors.length > 0
    ? previousErrors.map(error => `- ${error}`).join('\n')
    : '- 上一次输出未通过结构化校验';
  return `\n\n上一次输出包含以下问题：\n${errors}\n请重新生成并重点修正这些问题。`;
}

function buildSceneSpecPrompt({ creativeContext, target, retryCount = 0, previousErrors = [] } = {}) {
  return [
    '你是 html-video lite 的创意规格生成器。',
    '请只输出 JSON，不要输出 Markdown、解释、注释或代码块。',
    '本次只生成 scene_spec，不允许输出 frame_specs。',
    '不要输出 HTML、CSS、JavaScript、GSAP timeline、index.html、hyperframes.json、package.json 或 files 数组。',
    'scene_spec 是内容图 / storyboard 草稿：只描述观众会听到、看到、读到的内容，以及场景顺序、时长、字幕。',
    'scene_spec.scenes[].kind 必须从以下枚举选择：',
    stringify(enums.KINDS),
    'visual_text.cards、visual_text.keywords、visual_text.headline、caption.text 和 narration_text 只能包含观众可见文案。',
    '不要把视觉意图写进 visual_text.cards，例如“深色科技背景”“光效扩散”“动画转场”“镜头布局”等制作说明必须避免。',
    '如果需要表达背景、光效、动画、转场、布局、发光、粒子、镜头，请留给第二次 frame_specs 阶段调用。',
    '不要因为主题本身提到 HTML、CSS、动画、转场或渲染就删除这些词；它们作为观众内容出现时可以保留。',
    '输出格式必须是：{"scene_spec":{...}}。',
    '创作上下文：',
    stringify(creativeContext),
    '目标参数：',
    stringify(target),
    retrySection(retryCount, previousErrors),
  ].join('\n');
}

function buildFrameSpecsPrompt({ sceneSpec, retryCount = 0, previousErrors = [] } = {}) {
  const allowed = {
    allowed_kinds: enums.KINDS,
    allowed_templates: enums.TEMPLATES,
    allowed_layouts: enums.LAYOUTS,
    allowed_backgrounds: enums.BACKGROUNDS,
    allowed_motions: enums.MOTIONS,
    allowed_visual_layer_types: enums.VISUAL_LAYER_TYPES,
  };
  return [
    '你是 html-video lite 的分帧规格生成器。',
    '请只输出 JSON，不要输出 Markdown、解释、注释或代码块。',
    '不允许改写 scene_spec 文案；text_layers 只能引用或拆分 scene_spec 中观众可见的文案。',
    '不要输出 HTML、CSS、JavaScript、GSAP timeline、index.html、hyperframes.json、package.json 或 files 数组。',
    '像 html-video 的模板 manifest 一样，先根据每个 scene 的意图选择合适的 template/layout/motion/background，再映射 text_layers 和 visual_layers。',
    'template、layout、background、motion、visual_layers.type 必须从 allowed_templates/enums 中选择。',
    '用 template、layout、background、motion 和 visual_layers 表达视觉实现，不能写进 cards、字幕或 narration_text。',
    '默认每个 scene 生成一个覆盖整段的 frame：scene_id 引用该 scene，kind 等于 scene.kind，start 等于 scene.start，duration 等于 scene.duration。',
    '输出格式必须是：{"frame_specs":[...]}。',
    'allowed_templates/enums：',
    stringify(allowed),
    '已校验通过的完整 scene_spec：',
    stringify(sceneSpec),
    retrySection(retryCount, previousErrors),
  ].join('\n');
}

function rejectNonJsonText(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return 'AI 返回为空，无法解析 JSON';
  }
  // Only reject Markdown code blocks; don't reject HTML since valid JSON may contain HTML in string values
  if (/^```/m.test(raw)) {
    return 'AI 返回必须是纯 JSON，不能包含 Markdown 代码块';
  }
  // Try JSON.parse first - if it succeeds, the content is valid JSON regardless of HTML-like patterns
  try {
    JSON.parse(raw);
    return ''; // Valid JSON, no rejection
  } catch {
    // Not valid JSON - check if it looks like raw HTML (not JSON containing HTML strings)
    if (/^<[a-z][\s\S]*>$/i.test(raw) && !raw.startsWith('{')) {
      return 'AI 返回必须是纯 JSON，不能返回 HTML';
    }
    return ''; // Let parseJsonResponse handle the actual parse error
  }
}

function removeTrailingJsonCommas(value) {
  const raw = String(value || '');
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ',') {
      let cursor = index + 1;
      while (cursor < raw.length && /\s/.test(raw[cursor])) {
        cursor += 1;
      }
      if (raw[cursor] === '}' || raw[cursor] === ']') {
        continue;
      }
    }
    output += char;
  }
  return output;
}

function addMissingArrayElementCommas(value) {
  const raw = String(value || '');
  let output = '';
  let inString = false;
  let escaped = false;
  const stack = [];
  let previousSignificant = '';

  const isValueStart = char => char === '{'
    || char === '['
    || char === '"'
    || char === '-'
    || /[0-9tfn]/.test(char);
  const isValueEnd = char => char === '}'
    || char === ']'
    || char === '"'
    || /[0-9eElnr]/.test(char);

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
        previousSignificant = '"';
      }
      continue;
    }

    if (char === '"') {
      if (stack[stack.length - 1] === '[' && isValueEnd(previousSignificant)) {
        output += ',';
      }
      inString = true;
      output += char;
      continue;
    }

    if (/\s/.test(char)) {
      output += char;
      continue;
    }

    if (stack[stack.length - 1] === '[' && isValueStart(char) && isValueEnd(previousSignificant)) {
      output += ',';
    }

    output += char;
    if (char === '{' || char === '[') {
      stack.push(char);
    } else if (char === '}' && stack[stack.length - 1] === '{') {
      stack.pop();
    } else if (char === ']' && stack[stack.length - 1] === '[') {
      stack.pop();
    }
    previousSignificant = char;
  }

  return output;
}

function fixUnescapedControlChars(value) {
  // Replace unescaped control characters inside JSON strings with escaped equivalents.
  // JSON strings may not contain raw U+0000–U+001F; they must be \n, \t, etc.
  const raw = String(value || '');
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const code = char.charCodeAt(0);
    if (inString) {
      if (escaped) {
        output += char;
        escaped = false;
      } else if (char === '\\') {
        output += char;
        escaped = true;
      } else if (char === '"') {
        output += char;
        inString = false;
      } else if (code >= 0x00 && code <= 0x1f) {
        // Escape control characters
        const replacements = {
          '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t',
        };
        output += replacements[char] || `\\u${String(code).padStart(4, '0')}`;
      } else {
        output += char;
      }
    } else {
      output += char;
      if (char === '"') inString = true;
    }
  }
  return output;
}

function fixUnescapedQuotesInStrings(value) {
  // Fix unescaped double quotes inside JSON string values by backslash-escaping them.
  // This is a heuristic: only fixes quotes that would break JSON parsing.
  const raw = String(value || '');
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        output += char;
        escaped = false;
      } else if (char === '\\') {
        output += char;
        escaped = true;
      } else if (char === '"') {
        // Check if this quote ends the string: look ahead for , or } or ] or :
        let cursor = index + 1;
        while (cursor < raw.length && /\s/.test(raw[cursor])) cursor += 1;
        const next = raw[cursor] || '';
        if (next === ',' || next === '}' || next === ']' || next === ':' || next === '') {
          // This is a real closing quote
          output += char;
          inString = false;
        } else {
          // This quote is inside the string — escape it
          output += '\\"';
        }
      } else {
        output += char;
      }
    } else {
      output += char;
      if (char === '"') inString = true;
    }
  }
  return output;
}

function repairJsonSeparators(value) {
  return addMissingArrayElementCommas(removeTrailingJsonCommas(value));
}

function aggressiveRepairJson(raw) {
  // Multi-pass repair: try increasingly aggressive fixes
  let text = raw;

  // Pass 1: Fix unescaped control characters
  text = fixUnescapedControlChars(text);

  // Pass 2: Fix unescaped quotes inside strings
  text = fixUnescapedQuotesInStrings(text);

  // Pass 3: Standard separator repair
  text = repairJsonSeparators(text);

  return text;
}

function parseJsonResponse(responseText) {
  const rejection = rejectNonJsonText(responseText);
  if (rejection) {
    return { success: false, message: rejection };
  }
  const raw = String(responseText).trim();
  try {
    return { success: true, data: JSON.parse(raw) };
  } catch (firstError) {
    // Pass 1: Standard separator repair (trailing commas, missing commas)
    const repaired = repairJsonSeparators(raw);
    if (repaired !== raw) {
      try {
        return { success: true, data: JSON.parse(repaired), repaired: true };
      } catch {}
    }
    // Pass 2: Aggressive repair (unescaped control chars, unescaped quotes)
    const aggressive = aggressiveRepairJson(raw);
    if (aggressive !== repaired) {
      try {
        return { success: true, data: JSON.parse(aggressive), repaired: true };
      } catch {}
    }
    return { success: false, message: `AI 返回不是有效 JSON：${firstError.message}` };
  }
}

const PROJECT_FILE_KEYS = new Set(['files', 'index.html', 'hyperframes.json', 'package.json']);

function findProjectFileKey(value) {
  if (!value || typeof value !== 'object') {
    return '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProjectFileKey(item);
      if (found) {
        return found;
      }
    }
    return '';
  }
  for (const key of Object.keys(value)) {
    if (PROJECT_FILE_KEYS.has(key)) {
      return key;
    }
    const found = findProjectFileKey(value[key]);
    if (found) {
      return found;
    }
  }
  return '';
}

function rejectProjectFileFields(data) {
  const found = findProjectFileKey(data);
  if (!found) {
    return '';
  }
  return `AI 只能输出结构化 JSON spec，不允许包含工程文件字段：${found}`;
}

function normalizeDurationFallbacks(sceneDurations) {
  if (!Array.isArray(sceneDurations)) {
    return [];
  }
  return sceneDurations.map((item, index) => ({
    id: String(item?.id || item?.scene_id || '').trim(),
    index: Number(item?.index || index + 1),
    duration: Number(item?.duration ?? item?.actual_duration_sec ?? item?.duration_sec ?? item?.target_duration_sec ?? 0),
  })).filter(item => Number.isFinite(item.duration) && item.duration > 0);
}

function applyDurationFallbacks(rawSceneSpec, sceneDurations) {
  const fallbacks = normalizeDurationFallbacks(sceneDurations);
  if (!fallbacks.length || !rawSceneSpec || typeof rawSceneSpec !== 'object') {
    return rawSceneSpec;
  }
  const scenes = Array.isArray(rawSceneSpec.scenes) ? rawSceneSpec.scenes : [];
  if (!scenes.length) {
    return rawSceneSpec;
  }
  const byId = new Map(fallbacks.filter(item => item.id).map(item => [item.id, item.duration]));
  const byIndex = new Map(fallbacks.map(item => [item.index, item.duration]));
  return {
    ...rawSceneSpec,
    scenes: scenes.map((scene, index) => {
      const current = Number(scene?.duration);
      if (Number.isFinite(current) && current > 0) {
        return scene;
      }
      const id = String(scene?.id || '').trim();
      const fallback = byId.get(id) || byIndex.get(index + 1) || 0;
      return fallback > 0 ? { ...scene, duration: fallback } : scene;
    }),
  };
}

function parseSceneSpecResponse(responseText, options = {}) {
  const parsed = parseJsonResponse(responseText);
  if (!parsed.success) {
    return parsed;
  }
  const projectFileMessage = rejectProjectFileFields(parsed.data);
  if (projectFileMessage) {
    return { success: false, message: projectFileMessage };
  }
  if (parsed.data.frame_specs || parsed.data.frames) {
    return { success: false, message: 'scene_spec 阶段不允许输出 frame_specs 或工程文件' };
  }
  const rawSceneSpec = parsed.data.scene_spec || parsed.data;
  const sceneSpecWithDurations = applyDurationFallbacks(rawSceneSpec, options.sceneDurations);
  const validation = sceneSpecService.validateSceneSpec(sceneSpecWithDurations);
  if (!validation.success) {
    return {
      success: false,
      message: `scene_spec 校验失败：${validation.errors.join('；')}`,
      errors: validation.errors,
    };
  }
  return {
    success: true,
    scene_spec: validation.scene_spec,
  };
}

function parseFrameSpecsResponse(responseText, sceneSpec) {
  const parsed = parseJsonResponse(responseText);
  if (!parsed.success) {
    return parsed;
  }
  const projectFileMessage = rejectProjectFileFields(parsed.data);
  if (projectFileMessage) {
    return { success: false, message: projectFileMessage };
  }
  if (parsed.data.scene_spec) {
    return { success: false, message: 'frame_specs 阶段不允许输出 scene_spec 或工程文件' };
  }
  const validation = frameSpecService.validateFrameSpecs(parsed.data, sceneSpec);
  if (!validation.success) {
    return {
      success: false,
      message: `frame_specs 校验失败：${validation.errors.join('；')}`,
      errors: validation.errors,
    };
  }
  return {
    success: true,
    frame_specs: validation.frame_specs,
  };
}

/**
 * Build a compact prompt for AI to select the best template based on scene content.
 * Returns a prompt string (~500 token) that asks AI to output JSON { template_id, reason }.
 */
function buildSelectTemplatePrompt({ sceneSpec, compactIndex }) {
  const scenes = (sceneSpec.scenes || []);
  const firstScene = scenes[0] || {};
  const title = sceneSpec.title || '';
  const kind = firstScene.kind || 'text';
  const narration = (firstScene.narration_text || '').slice(0, 200);
  const headline = firstScene.visual_text?.headline || title;

  return [
    '你是视频模板选择专家。根据以下内容场景，从模板列表中选择最合适的模板。',
    '请只输出 JSON，不要输出 Markdown、解释或代码块。',
    '输出格式：{"template_id":"...","reason":"..."}',
    '',
    '## 内容场景',
    `标题：${title}`,
    `类型：${kind}`,
    `关键文案：${headline}`,
    `旁白摘要：${narration}`,
    '',
    '## 可用模板',
    ...compactIndex.map(t =>
      `- [${t.id}] ${t.name}：${t.description}。适合：${(t.best_for || []).join('、')}`
    ),
    '',
    '请选择最匹配内容主题和情绪的模板。只输出 JSON。',
  ].join('\n');
}

/**
 * Build a prompt for AI to fill a template's HTML with actual content.
 * Returns a prompt string that provides the template HTML + content data.
 */
function buildFillTemplatePrompt({ sceneSpec, frameSpecs, templateHtml, templateManifest }) {
  const scenes = (sceneSpec.scenes || []);

  // Extract content for each scene
  const contentData = scenes.map((scene, index) => {
    const frame = (frameSpecs?.frames || [])[index] || {};
    return {
      scene_id: scene.id,
      kind: scene.kind,
      duration: scene.duration,
      headline: scene.visual_text?.headline || scene.title || '',
      keywords: scene.visual_text?.keywords || [],
      cards: scene.visual_text?.cards || [],
      narration: scene.narration_text || '',
      captions: (scene.captions || []).map(c => c.text),
    };
  });

  const inputsDesc = templateManifest.inputs
    ? Object.entries(templateManifest.inputs).map(([k, v]) =>
      `  ${k}（${v.type}${v.required ? '，必填' : '，可选'}${v.max_length ? `，最多${v.max_length}字` : ''}）：${v.description || ''}`
    ).join('\n')
    : '  无特定字段要求';

  const totalDuration = scenes.reduce((s, c) => s + (c.duration || 0), 0);

  return [
    '你是一个前端动效工程师。请修改以下 HTML 模板，将示例内容替换为实际内容。',
    '',
    '## 模板说明',
    `名称：${templateManifest.name}`,
    `描述：${templateManifest.description}`,
    `内容字段：`,
    inputsDesc,
    '',
    '## 实际内容',
    stringify(contentData),
    '',
    `视频总时长：${totalDuration}秒`,
    '',
    '## 要求',
    '1. 保持 CSS 样式和布局不变',
    '2. 只替换文本内容和数据，保持 HTML 结构和 class 名不变',
    '3. 如果内容超出模板容量，精简内容而非修改布局',
    '4. 将所有英文示例文字替换为中文实际内容',
    '5. 保持 Google Fonts 链接不变；GSAP 必须使用本地路径 <script src="./gsap.min.js"></script>，不要用 CDN',
    '6. 如果目标宽高比不是 16:9，需要调整 body 的 width/height 为对应尺寸（9:16 = 1080x1920, 1:1 = 1080x1080, 4:5 = 1080x1350）',
    '7. 返回完整的修改后 HTML，不要添加任何解释',
    '',
    '## ⚠️ 动画规范（最关键）',
    '',
    '视频渲染器通过 GSAP timeline 逐帧捕获画面。CSS @keyframes 动画对渲染器不可见，会导致输出全是静态图片。',
    '',
    '你必须：',
    '- 删除所有 CSS @keyframes 和 animation 属性',
    '- 所有动画效果必须用 GSAP timeline tweens 实现',
    `- 在 <script> 中创建 window.__timelines["main"] = gsap.timeline({ paused: true })`,
    `- 用 tl.fromTo() / tl.to() 控制每个元素的入场、退场动画`,
    `- 最后添加 tl.to({}, { duration: ${totalDuration} }) 确保 timeline 时长正确`,
    '- 每个 scene 的动画应在对应的时间点触发（根据 scene 的 start 和 duration 计算）',
    '',
    '示例结构：',
    '```javascript',
    'window.__timelines = window.__timelines || {};',
    'const tl = gsap.timeline({ paused: true });',
    'window.__timelines["main"] = tl;',
    '// 元素入场动画',
    'tl.fromTo(".headline", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1, ease: "power3.out" }, 0);',
    'tl.fromTo(".subtitle", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, 0.5);',
    '// 元素退场动画（在场景结束前）',
    'tl.to(".headline", { opacity: 0, y: -20, duration: 0.5, ease: "power2.in" }, 8.5);',
    '// 确保 timeline 时长',
    `tl.to({}, { duration: ${totalDuration} });`,
    '```',
    '',
    '## 原始模板 HTML',
    '```html',
    templateHtml,
    '```',
  ].join('\n');
}

/**
 * Parse the AI's template selection response.
 * Expected: { template_id: "...", reason: "..." }
 */
function parseSelectTemplateResponse(responseText, availableIds) {
  const parsed = parseJsonResponse(responseText);
  if (!parsed.success) {
    return { success: false, message: `模板选择解析失败：${parsed.message}` };
  }
  const data = parsed.data;
  const templateId = data.template_id || data.id;
  if (!templateId) {
    return { success: false, message: 'AI 未返回 template_id' };
  }
  if (availableIds && !availableIds.includes(templateId)) {
    return { success: false, message: `AI 选择了不存在的模板：${templateId}` };
  }
  return {
    success: true,
    template_id: templateId,
    reason: data.reason || '',
  };
}

/**
 * Parse the AI's HTML fill response.
 * The AI should return the full HTML content (not JSON).
 */
function parseFillTemplateResponse(responseText) {
  const raw = String(responseText || '').trim();
  if (!raw) {
    return { success: false, message: 'AI 返回为空' };
  }

  // The AI might wrap HTML in a code block
  let html = raw;
  const codeBlockMatch = raw.match(/```(?:html)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    html = codeBlockMatch[1].trim();
  }

  // Validate it looks like HTML
  if (!html.includes('<html') && !html.includes('<HTML') && !html.includes('<!DOCTYPE') && !html.includes('<body')) {
    return { success: false, message: 'AI 返回的内容不像 HTML' };
  }

  if (html.length < 200) {
    return { success: false, message: 'AI 返回的 HTML 过短' };
  }

  return { success: true, html };
}

module.exports = {
  buildSceneSpecPrompt,
  buildFrameSpecsPrompt,
  buildSelectTemplatePrompt,
  buildFillTemplatePrompt,
  parseSceneSpecResponse,
  parseFrameSpecsResponse,
  parseSelectTemplateResponse,
  parseFillTemplateResponse,
  applyDurationFallbacks,
  removeTrailingJsonCommas,
  addMissingArrayElementCommas,
  fixUnescapedControlChars,
  fixUnescapedQuotesInStrings,
  aggressiveRepairJson,
};
