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
        '你是 MuseDock 的原创短视频分镜 Agent。',
        '只输出 JSON，不要输出 Markdown、解释或代码块。',
        '你只负责决定原创视觉分镜结构、标题、布局、强调词和原创视觉提示。',
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
        '字幕索引：',
        JSON.stringify(captionIndexes, null, 2),
        '',
        '[AI_STORYBOARD_MAX_SCENES=12]',
        '[AI_STORYBOARD_BACKEND_FILL=true]',
        '',
        '要求：',
        '- caption_indexes 必须引用现有字幕 index。',
        '- 每个字幕 index 最多被一个 scene 使用。',
        '- 最多生成 12 个关键分镜，优先覆盖开头、转折、核心观点和结尾。',
        '- 未覆盖字幕会由后端自动补齐为默认分镜，不需要为每条字幕都生成 scene。',
        '- 每个 scene 最多覆盖 2 条连续字幕。',
        '- visual_type 优先使用 text_card、quote_card、step_card、contrast_card。',
        '- background_prompt 必须描述原创抽象/图文背景，不得描述原视频画面。',
        '',
        getFrameProfileBrief({ frameProfileId, frameDocText }),
        '',
        formatStoryboardOptionsForPrompt(storyboardOptions),
      ].join('\n'),
    },
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
  const messages = buildStoryboardMessages({
    rewriteScript,
    captions,
    storyboardOptions,
    frameProfileId: options.frameProfileId || DEFAULT_FRAME_PROFILE_ID,
    frameDocText: options.frameDocText || '',
  });
  let modelResult;
  try {
    modelResult = await modelService.callTextModel({
      messages,
      temperature: 0.35,
      configPath: options.configPath,
      textConfig: options.textConfig,
      fetchImpl: options.fetchImpl,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      stream: options.stream !== false,
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
      raw: {},
      raw_parse_failed: false,
    };
  }

  const parsed = parseJson(modelResult.text);
  const storyboard = storyboardSchema.normalizeStoryboard({
    storyboard: parsed.value,
    captions,
  });

  return {
    success: true,
    message: parsed.parsed ? 'AI 分镜已生成。' : 'AI 分镜返回不是有效 JSON，已使用默认分镜。',
    model: modelResult.model || {},
    storyboard,
    raw: parsed.value,
    raw_parse_failed: !parsed.parsed,
  };
}

module.exports = {
  buildStoryboardMessages,
  createStoryboard,
  normalizeStoryboardOptions,
  formatStoryboardOptionsForPrompt,
  getFrameProfileBrief,
};
