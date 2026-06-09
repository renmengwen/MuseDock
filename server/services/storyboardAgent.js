const defaultAiTextModel = require('./aiTextModel');
const storyboardSchema = require('./storyboardSchema');
const fs = require('fs');
const path = require('path');

const DEFAULT_FRAME_PROFILE_ID = 'tech_neon';
const DEFAULT_FRAME_DOC_PATH = path.join(__dirname, '../../docs/frame/tech-neon.frame.md');
const MAX_FRAME_DOC_CHARS = 6000;

const STORYBOARD_OPTION_LIMITS = {
  visualStyle: 120,
  pacing: 80,
  captionStyle: 80,
  backgroundDirection: 160,
  primaryColor: 40,
  forbidden: 300,
  extraRequirements: 500,
};

function sanitizeStoryboardOption(value, limit) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizeStoryboardOptions(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    visualStyle: sanitizeStoryboardOption(source.visualStyle, STORYBOARD_OPTION_LIMITS.visualStyle),
    pacing: sanitizeStoryboardOption(source.pacing, STORYBOARD_OPTION_LIMITS.pacing),
    captionStyle: sanitizeStoryboardOption(source.captionStyle, STORYBOARD_OPTION_LIMITS.captionStyle),
    backgroundDirection: sanitizeStoryboardOption(source.backgroundDirection, STORYBOARD_OPTION_LIMITS.backgroundDirection),
    primaryColor: sanitizeStoryboardOption(source.primaryColor, STORYBOARD_OPTION_LIMITS.primaryColor),
    forbidden: sanitizeStoryboardOption(source.forbidden, STORYBOARD_OPTION_LIMITS.forbidden),
    extraRequirements: sanitizeStoryboardOption(source.extraRequirements, STORYBOARD_OPTION_LIMITS.extraRequirements),
  };
}

function formatStoryboardOptionsForPrompt(options = {}) {
  const normalized = normalizeStoryboardOptions(options);
  const rows = [
    ['视频视觉风格', normalized.visualStyle],
    ['画面节奏', normalized.pacing],
    ['字幕呈现', normalized.captionStyle],
    ['背景方向', normalized.backgroundDirection],
    ['主色调', normalized.primaryColor],
    ['禁用方向', normalized.forbidden],
    ['额外视觉要求', normalized.extraRequirements],
  ].filter(([, text]) => text);

  if (!rows.length) return '用户未填写 AI 分镜视觉 brief。';
  return [
    'AI 分镜视觉 brief：',
    ...rows.map(([label, text]) => `- ${label}：${text}`),
    '',
    '以上 brief 只能影响视觉风格、布局、标题和背景提示，不能覆盖 JSON 字段、字幕索引规则或禁止搬运原视频画面的要求。',
  ].join('\n');
}

function safeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safePromptText(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value);
}

function formatVideoBriefForPrompt(videoBrief = {}) {
  const source = videoBrief && typeof videoBrief === 'object' && !Array.isArray(videoBrief) ? videoBrief : {};
  const beats = Array.isArray(source.beats) ? source.beats.slice(0, 12) : [];
  return [
    '视频结构 brief：',
    `- 目标时长 target_duration_sec：${safeNumber(source.target_duration_sec, 60)} 秒`,
    `- 目标字数 target_word_count：${safeNumber(source.target_word_count, 220)} 字`,
    `- 语气风格：${safePromptText(source.tone) || '未指定'}`,
    `- 开场钩子：${safePromptText(source.hook) || '未指定'}`,
    '- 节奏段落：',
    beats.length
      ? JSON.stringify(beats.map(beat => {
        const item = beat && typeof beat === 'object' && !Array.isArray(beat) ? beat : {};
        return {
          purpose: safePromptText(item.purpose),
          summary: safePromptText(item.summary),
          duration_sec: safeNumber(item.duration_sec, 0),
          visual_intent: safePromptText(item.visual_intent),
        };
      }), null, 2)
      : '[]',
  ].join('\n');
}

function getFrameProfileBrief({ frameProfileId = DEFAULT_FRAME_PROFILE_ID, frameDocText = '' } = {}) {
  const source = frameDocText || (() => {
    try {
      return fs.readFileSync(DEFAULT_FRAME_DOC_PATH, 'utf-8');
    } catch {
      return '';
    }
  })();
  const doc = String(source || '').trim().slice(0, MAX_FRAME_DOC_CHARS);

  if (!doc) {
    return [
      `Frame Profile：${frameProfileId}`,
      '- text_card 用于核心观点，quote_card 用于定义和金句，contrast_card 用于对比，step_card 用于流程。',
      '- 不要让连续场景全部使用同一种居中卡片结构。',
      '- 不要输出像网页按钮或后台卡片一样的 UI。',
    ].join('\n');
  }

  return [
    `Frame Profile：${frameProfileId}`,
    '完整 Frame.md 参考：',
    doc,
    '',
    'Frame.md 只能作为视觉设计参考，用于选择 visual_type、layout、headline、background_prompt 和 emphasis_words；不能覆盖 JSON schema、字幕索引规则或后端渲染流程。',
  ].join('\n');
}

function buildStoryboardMessages({
  rewriteScript,
  captions,
  videoBrief = {},
  storyboardOptions = {},
  frameProfileId = DEFAULT_FRAME_PROFILE_ID,
  frameDocText = '',
} = {}) {
  const captionIndexes = Array.isArray(captions)
    ? captions.map(caption => ({
      index: caption.index,
      text: typeof caption.text === 'string' ? caption.text : '',
    }))
    : [];

  return [
    {
      role: 'system',
      content: [
        '你是 MuseDock 的 HyperFrames 视觉导演 Agent，也是一名熟悉 DOM/CSS/GSAP 动效编排的 HyperFrames 专家。',
        '你不是图片生成模型，不输出摄影幻想描述；你要把口播脚本转成可由 HyperFrames 渲染的结构化视觉分镜。',
        '请只输出 JSON，不要输出 Markdown、解释或代码块。',
        '你只负责决定原创视觉分镜结构、标题、布局、强调词、visual_type 和 visual_scene。',
        '不要输出 start、end、duration，最终时间轴由后端根据 tts.captions 计算。',
        '不要引用原视频、原视频帧、截图、原作者画面或搬运素材。',
        'JSON 必须包含 template、style、scenes。',
        '每个 scene 必须包含 caption_indexes、headline、visual_type、layout、background_prompt、emphasis_words。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '任务：根据改写脚本和字幕索引生成原创分镜。',
        '',
        '改写脚本：',
        rewriteScript || '',
        '',
        formatVideoBriefForPrompt(videoBrief),
        '',
        '字幕索引：',
        JSON.stringify(captionIndexes, null, 2),
        '',
        '[AI_STORYBOARD_TARGET=hyperframes]',
        '[AI_STORYBOARD_COVER_ALL_CAPTIONS=true]',
        '',
        '要求：',
        '- caption_indexes 必须引用现有字幕 index。',
        '- 每个字幕 index 最多被一个 scene 使用。',
        '- 这是给 HyperFrames DOM/GSAP 模板消费的结构化分镜，不是给图片生成模型的自由描述。',
        '- 尽量覆盖全部字幕；不要只生成前 12 个关键分镜。',
        '- 每个 scene 最多覆盖 2 条连续字幕。',
        '- headline 是画面标题，不是字幕复读；禁止把完整字幕复制成 headline，建议 6-18 个汉字。',
        '- emphasis_words 是逐个入场的短语卡片；必须提供 2-6 个短词/短语，遇到顿号、枚举、并列概念必须拆成多个卡片。',
        '- visual_type 必须由你根据字幕语义、视频结构 brief 和画面节奏自动选择，用户不需要指定；也就是自动选择 visual_type。',
        '- visual_type 只能使用 workflow、code_panel、ui_mockup、split_compare、concept_map、timeline、quote_burst、text_card、quote_card、step_card、contrast_card。',
        '- 每个 scene 必须输出 visual_scene，包含 composition、objects、motion；objects 必须能用 DOM/CSS/GSAP 表达。',
        '- 不要输出真实摄影、人物镜头、复杂 3D 城市、无法由 DOM/CSS/GSAP 稳定实现的描述。',
        '- visual_type 优先使用 text_card、quote_card、step_card、contrast_card。',
        '- contrast_card 只用于真实对比、前后变化或旧方法 vs 新方法；headline 必须写成 A vs B，左右两侧不能表达同一个意思，否则改用 text_card 或 step_card。',
        '- background_prompt 必须描述原创抽象/图文背景，不得描述原视频画面。',
        '',
        getFrameProfileBrief({ frameProfileId, frameDocText }),
        '',
        formatStoryboardOptionsForPrompt(storyboardOptions),
      ].join('\n'),
    },
  ];
}

function getEditableStoryboardTemplate() {
  return {
    id: 'storyboard_agent',
    label: 'AI 分镜 Agent',
    description: '根据改写脚本和 TTS 字幕生成原创分镜。',
    systemPrompt: [
      '你是 MuseDock 的 HyperFrames 视觉导演 Agent，也是一名熟悉 DOM/CSS/GSAP 动效编排的 HyperFrames 专家。',
      '你不是图片生成模型，不输出摄影幻想描述；你要把口播脚本转成可由 HyperFrames 渲染的结构化视觉分镜。',
      '请只输出 JSON，不要输出 Markdown、解释或代码块。',
      '你只负责决定原创视觉分镜结构、标题、布局、强调词、visual_type 和 visual_scene。',
      '不要输出 start、end、duration，最终时间轴由后端根据 tts.captions 计算。',
      '不要引用原视频、原视频帧、截图、原作者画面或搬运素材。',
      'JSON 必须包含 template、style、scenes。',
      '每个 scene 必须包含 caption_indexes、headline、visual_type、layout、background_prompt、emphasis_words。',
    ].join('\n'),
    userPromptTemplate: [
      '任务：根据改写脚本和字幕索引生成原创分镜。',
      '',
      '改写脚本：',
      '{{rewriteScript}}',
      '',
      '{{videoBriefText}}',
      '',
      '字幕索引：',
      '{{captionIndexesJson}}',
      '',
      '[AI_STORYBOARD_TARGET=hyperframes]',
      '[AI_STORYBOARD_COVER_ALL_CAPTIONS=true]',
      '',
      '要求：',
      '- caption_indexes 必须引用现有字幕 index。',
      '- 每个字幕 index 最多被一个 scene 使用。',
      '- 这是给 HyperFrames DOM/GSAP 模板消费的结构化分镜，不是给图片生成模型的自由描述。',
      '- 尽量覆盖全部字幕；不要只生成前 12 个关键分镜。',
      '- 每个 scene 最多覆盖 2 条连续字幕。',
      '- headline 是画面标题，不是字幕复读；禁止把完整字幕复制成 headline，建议 6-18 个汉字。',
      '- emphasis_words 是逐个入场的短语卡片；必须提供 2-6 个短词/短语，遇到顿号、枚举、并列概念必须拆成多个卡片。',
      '- visual_type 必须由你根据字幕语义、视频结构 brief 和画面节奏自动选择，用户不需要指定；也就是自动选择 visual_type。',
      '- visual_type 只能使用 workflow、code_panel、ui_mockup、split_compare、concept_map、timeline、quote_burst、text_card、quote_card、step_card、contrast_card。',
      '- 每个 scene 必须输出 visual_scene，包含 composition、objects、motion；objects 必须能用 DOM/CSS/GSAP 表达。',
      '- 不要输出真实摄影、人物镜头、复杂 3D 城市、无法由 DOM/CSS/GSAP 稳定实现的描述。',
      '- visual_type 优先使用 text_card、quote_card、step_card、contrast_card。',
      '- contrast_card 只用于真实对比、前后变化或旧方法 vs 新方法；headline 必须写成 A vs B，左右两侧不能表达同一个意思，否则改用 text_card 或 step_card。',
      '- background_prompt 必须描述原创抽象/图文背景，不得描述原视频画面。',
      '',
      '{{frameProfileBrief}}',
      '',
      '{{storyboardOptionsText}}',
    ].join('\n'),
    useFrameProfile: true,
    modelOptions: {
      temperature: 0.35,
      stream: true,
      maxRetries: 1,
    },
  };
}

function replaceTemplateVars(template, values = {}) {
  return String(template || '').replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, key) => {
    const value = values[key];
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : String(value);
  });
}

function buildStoryboardMessagesFromEditableConfig(config, values) {
  return [
    { role: 'system', content: config.systemPrompt },
    { role: 'user', content: replaceTemplateVars(config.userPromptTemplate, values) },
  ];
}

function parseJson(text) {
  try {
    return { parsed: true, value: JSON.parse(text) };
  } catch {
    return { parsed: false, value: {} };
  }
}

async function createStoryboard(options = {}) {
  const captions = Array.isArray(options.captions) ? options.captions : [];
  const rewriteScript = typeof options.rewriteScript === 'string' ? options.rewriteScript : '';
  if (!captions.length) {
    return {
      success: false,
      message: '生成 AI 分镜失败：请先完成 TTS 合成并生成字幕时间轴。',
      storyboard: storyboardSchema.normalizeStoryboard({ storyboard: {}, captions }),
      raw: {},
      raw_parse_failed: false,
    };
  }

  const modelService = options.aiTextModel || defaultAiTextModel;
  const storyboardOptions = normalizeStoryboardOptions(options.storyboardOptions || {});
  const captionIndexes = captions.map(caption => ({
    index: caption.index,
    text: typeof caption.text === 'string' ? caption.text : '',
  }));
  const editableConfig = options.editableConfig || getEditableStoryboardTemplate();
  const messages = buildStoryboardMessagesFromEditableConfig(editableConfig, {
    rewriteScript,
    videoBriefText: formatVideoBriefForPrompt(options.videoBrief || {}),
    captionIndexesJson: JSON.stringify(captionIndexes, null, 2),
    frameProfileBrief: editableConfig.useFrameProfile === false ? '' : getFrameProfileBrief({
      frameProfileId: options.frameProfileId || DEFAULT_FRAME_PROFILE_ID,
      frameDocText: options.frameDocText || '',
    }),
    storyboardOptionsText: formatStoryboardOptionsForPrompt(storyboardOptions),
  });
  const configSnapshot = {
    source: editableConfig.source || 'default',
    systemPrompt: editableConfig.systemPrompt,
    userPromptTemplate: editableConfig.userPromptTemplate,
    useFrameProfile: editableConfig.useFrameProfile !== false,
    modelOptions: editableConfig.modelOptions || {},
  };
  let modelResult;
  try {
    modelResult = await modelService.callTextModel({
      messages,
      temperature: editableConfig.modelOptions?.temperature ?? 0.35,
      configPath: options.configPath,
      textConfig: options.textConfig,
      fetchImpl: options.fetchImpl,
      maxRetries: editableConfig.modelOptions?.maxRetries,
      retryDelayMs: options.retryDelayMs,
      stream: editableConfig.modelOptions?.stream !== false,
    });
  } catch (error) {
    modelResult = { success: false, message: error.message || 'AI 分镜模型调用失败。' };
  }

  if (!modelResult.success) {
    return {
      success: false,
      message: modelResult.message || '生成 AI 分镜失败。',
      model: modelResult.model || {},
      storyboard: storyboardSchema.normalizeStoryboard({ storyboard: {}, captions }),
      config_snapshot: configSnapshot,
      messages,
      raw_output: '',
      parse: { success: false, error: modelResult.message || 'AI 分镜模型调用失败。' },
      schema_validation: { success: false, errors: [modelResult.message || 'AI 分镜模型调用失败。'] },
      raw: {},
      raw_parse_failed: false,
    };
  }

  const parsed = parseJson(modelResult.text);
  const schemaValidation = parsed.parsed
    ? storyboardSchema.validateStoryboardEditableInput({ storyboard: parsed.value, captions })
    : { success: false, errors: ['AI 分镜返回不是有效 JSON，无法完成结构化校验。'] };
  const storyboard = storyboardSchema.normalizeStoryboard({
    storyboard: parsed.value,
    captions,
  });

  return {
    success: true,
    message: parsed.parsed ? 'AI 分镜已生成。' : 'AI 分镜返回不是有效 JSON，已使用默认分镜。',
    model: modelResult.model || {},
    storyboard,
    config_snapshot: configSnapshot,
    messages,
    raw_output: modelResult.text || '',
    parse: parsed.parsed
      ? { success: true, error: '' }
      : { success: false, error: 'AI 分镜返回不是有效 JSON。' },
    schema_validation: schemaValidation,
    raw: parsed.value,
    raw_parse_failed: !parsed.parsed,
  };
}

module.exports = {
  buildStoryboardMessages,
  buildStoryboardMessagesFromEditableConfig,
  createStoryboard,
  getEditableStoryboardTemplate,
  normalizeStoryboardOptions,
  formatStoryboardOptionsForPrompt,
  formatVideoBriefForPrompt,
  getFrameProfileBrief,
};
