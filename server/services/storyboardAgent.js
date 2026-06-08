const defaultAiTextModel = require('./aiTextModel');
const storyboardSchema = require('./storyboardSchema');

function buildStoryboardMessages({ rewriteScript, captions }) {
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
        '字幕时间轴：',
        JSON.stringify(captions, null, 2),
        '',
        '要求：',
        '- caption_indexes 必须引用现有字幕 index。',
        '- 每个字幕 index 最多被一个 scene 使用。',
        '- 优先每 1 条字幕生成 1 个分镜；只有语义强绑定的短句才允许 2 条字幕合并。',
        '- 分镜节奏要密，避免 1 个 scene 覆盖过多内容。',
        '- 每个 scene 最多覆盖 2 条连续字幕。',
        '- visual_type 优先使用 text_card、quote_card、step_card、contrast_card。',
        '- background_prompt 必须描述原创抽象/图文背景，不得描述原视频画面。',
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
  const messages = buildStoryboardMessages({ rewriteScript, captions });
  let modelResult;
  try {
    modelResult = await modelService.callTextModel({
      messages,
      temperature: 0.35,
      configPath: options.configPath,
      textConfig: options.textConfig,
      fetchImpl: options.fetchImpl,
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
};
