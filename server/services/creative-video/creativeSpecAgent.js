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
    'scene_spec.scenes[].kind 必须从以下枚举选择：',
    stringify(enums.KINDS),
    'visual_text.cards、visual_text.keywords、visual_text.headline、caption.text 和 narration_text 只能包含观众可见文案。',
    '不要把视觉意图写进 visual_text.cards，例如“深色科技背景”“光效扩散”“动画转场”“镜头布局”等制作说明必须避免。',
    '如果需要表达背景、光效、动画、转场、布局、发光、粒子、镜头，请留给第二次 frame_specs 调用。',
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
    'template、layout、background、motion、visual_layers.type 必须从 allowed_templates/enums 中选择。',
    '所有视觉效果只能通过 background、motion、visual_layers 表达，不能写进 cards 或字幕。',
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
  if (/^```/m.test(raw) || /<\/?[a-z][\s\S]*>/i.test(raw)) {
    return 'AI 返回必须是纯 JSON，不能包含 Markdown 代码块或 HTML';
  }
  return '';
}

function parseJsonResponse(responseText) {
  const rejection = rejectNonJsonText(responseText);
  if (rejection) {
    return { success: false, message: rejection };
  }
  try {
    return { success: true, data: JSON.parse(String(responseText).trim()) };
  } catch (error) {
    return { success: false, message: `AI 返回不是有效 JSON：${error.message}` };
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

function parseSceneSpecResponse(responseText) {
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
  const validation = sceneSpecService.validateSceneSpec(parsed.data.scene_spec || parsed.data);
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

module.exports = {
  buildSceneSpecPrompt,
  buildFrameSpecsPrompt,
  parseSceneSpecResponse,
  parseFrameSpecsResponse,
};
