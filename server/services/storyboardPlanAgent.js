const defaultAiTextModel = require('./aiTextModel');

const VISUAL_TYPE_HINT_ALLOWED = [
  'workflow',
  'code_panel',
  'ui_mockup',
  'split_compare',
  'concept_map',
  'timeline',
  'quote_burst',
  'text_card',
  'quote_card',
  'step_card',
  'contrast_card',
];

const VISUAL_TYPE_HINT_SET = new Set(VISUAL_TYPE_HINT_ALLOWED);

function sanitizeText(value, limit = 8000) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePromptOptions(promptOptions = {}) {
  if (!promptOptions || typeof promptOptions !== 'object' || Array.isArray(promptOptions)) return {};
  return Object.fromEntries(Object.entries(promptOptions).map(([key, value]) => {
    if (typeof value === 'number' || typeof value === 'boolean') return [key, value];
    return [key, sanitizeText(value, 1000)];
  }));
}

function buildStoryboardPlanMessages({
  transcriptText = '',
  commentsText = '',
  promptOptions = {},
} = {}) {
  const normalizedOptions = normalizePromptOptions(promptOptions);
  const targetDurationSec = safeNumber(
    normalizedOptions.targetDurationSec ?? normalizedOptions.target_duration_sec,
    60,
  );
  const allowedHints = VISUAL_TYPE_HINT_ALLOWED.join(', ');

  return [
    {
      role: 'system',
      content: [
        '你是 MuseDock 的导演规划 Agent，负责把口播素材和评论洞察规划成可执行的 storyboard_plan。',
        '请只输出 JSON，不要输出 Markdown、解释、代码块或额外文本。',
        'JSON 必须包含 target_duration_sec 和 scenes。',
        '每个 scene 必须包含 target_duration_sec、narration_text、headline、visual_intent、visual_type_hint。',
        `visual_type_hint 只能使用：${allowedHints}。`,
        '不要输出 HyperFrames DSL、visual_scene、start、end、duration。',
        'narration_text 必须保留可直接配音的中文口播，不要写成镜头说明。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '任务：生成 storyboard_plan，用于后续分镜与画面生成。',
        '',
        `target_duration_sec: ${targetDurationSec}`,
        '',
        '素材 transcript_text：',
        sanitizeText(transcriptText, 12000) || '（未提供）',
        '',
        '评论 comments_text：',
        sanitizeText(commentsText, 8000) || '（未提供）',
        '',
        'prompt_options：',
        JSON.stringify(normalizedOptions, null, 2),
        '',
        '输出示例：',
        JSON.stringify({
          storyboard_plan: {
            target_duration_sec: targetDurationSec,
            scenes: [
              {
                index: 1,
                target_duration_sec: 5,
                narration_text: '先别急着买最贵的模型。',
                headline: '先看工作流',
                visual_intent: '用对比画面说明模型不是全部',
                visual_type_hint: 'split_compare',
              },
            ],
          },
        }, null, 2),
        '',
        '请只返回 JSON，可以直接返回 storyboard_plan 对象，也可以返回包含 storyboard_plan 字段的对象。',
      ].join('\n'),
    },
  ];
}

function normalizeVisualTypeHint(value) {
  const hint = sanitizeText(value, 80);
  return VISUAL_TYPE_HINT_SET.has(hint) ? hint : 'text_card';
}

function normalizeStoryboardPlan(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const rawScenes = Array.isArray(source.scenes) ? source.scenes : [];
  const scenes = rawScenes
    .filter(scene => scene && typeof scene === 'object' && !Array.isArray(scene))
    .map((scene, sceneIndex) => ({
      index: sceneIndex + 1,
      target_duration_sec: safeNumber(scene.target_duration_sec, 0),
      narration_text: sanitizeText(scene.narration_text, 2000),
      headline: sanitizeText(scene.headline, 120),
      visual_intent: sanitizeText(scene.visual_intent, 500),
      visual_type_hint: normalizeVisualTypeHint(scene.visual_type_hint),
    }))
    .filter(scene => scene.narration_text);

  const hasScenes = scenes.length > 0;
  return {
    status: hasScenes ? 'planned' : 'failed',
    message: hasScenes ? '导演分镜规划已生成。' : '导演分镜规划失败：未生成有效场景。',
    target_duration_sec: safeNumber(source.target_duration_sec, 60),
    scenes,
    updated_at: new Date().toISOString(),
  };
}

function parseJson(text) {
  try {
    return { success: true, value: JSON.parse(text), error: '' };
  } catch (error) {
    return {
      success: false,
      value: {},
      error: error?.message || 'AI 返回内容不是有效 JSON。',
    };
  }
}

function unwrapStoryboardPlan(parsedValue) {
  if (parsedValue?.storyboard_plan && typeof parsedValue.storyboard_plan === 'object') {
    return parsedValue.storyboard_plan;
  }
  return parsedValue;
}

async function createStoryboardPlan(options = {}) {
  const modelService = options.aiTextModel || defaultAiTextModel;
  const messages = buildStoryboardPlanMessages({
    transcriptText: options.transcriptText,
    commentsText: options.commentsText,
    promptOptions: options.promptOptions,
  });
  const stream = options.stream !== false;

  let modelResult;
  try {
    modelResult = await modelService.callTextModel({
      messages,
      temperature: options.temperature ?? 0.35,
      configPath: options.configPath,
      textConfig: options.textConfig,
      fetchImpl: options.fetchImpl,
      maxRetries: options.maxRetries ?? 3,
      retryDelayMs: options.retryDelayMs,
      stream,
      fallbackToNonStreamOnGatewayTimeout: stream,
    });
  } catch (error) {
    modelResult = {
      success: false,
      message: error?.message || '导演分镜规划模型调用失败。',
    };
  }

  if (!modelResult.success) {
    return {
      success: false,
      message: modelResult.message || '导演分镜规划模型调用失败。',
      model: modelResult.model || {},
      messages,
      raw_output: modelResult.text || '',
      parse: { success: false, error: modelResult.message || '导演分镜规划模型调用失败。' },
      storyboard_plan: normalizeStoryboardPlan({}),
      raw: {},
    };
  }

  const parsed = parseJson(modelResult.text || '');
  if (!parsed.success) {
    return {
      success: false,
      message: '导演分镜规划失败：AI 返回内容不是有效 JSON。',
      model: modelResult.model || {},
      messages,
      raw_output: modelResult.text || '',
      parse: { success: false, error: parsed.error },
      storyboard_plan: normalizeStoryboardPlan({}),
      raw: {},
    };
  }

  const plan = normalizeStoryboardPlan(unwrapStoryboardPlan(parsed.value));
  return {
    success: plan.status === 'planned',
    message: plan.status === 'planned' ? '导演分镜规划已生成。' : plan.message,
    model: modelResult.model || {},
    messages,
    raw_output: modelResult.text || '',
    parse: { success: true, error: '' },
    storyboard_plan: plan,
    raw: parsed.value,
  };
}

module.exports = {
  VISUAL_TYPE_HINT_ALLOWED,
  buildStoryboardPlanMessages,
  normalizeStoryboardPlan,
  createStoryboardPlan,
};
