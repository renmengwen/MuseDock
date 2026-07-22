const MAX_JSON_CHARS = 12000;
const requiredNarration = require('./requiredNarrationLiterals');

function stripCodeFence(text = '') {
  let value = String(text || '').trim();
  value = value.replace(/^```\s*(?:json)?\s*/i, '');
  value = value.replace(/\s*```$/i, '');
  return value.trim();
}

function safeJson(value, maxChars = MAX_JSON_CHARS) {
  const json = JSON.stringify(value || {}, null, 2);
  if (json.length <= maxChars) return json;

  const previewLimit = Math.max(200, maxChars - 2000);
  return JSON.stringify({
    truncated: true,
    original_length: json.length,
    preview: json.slice(0, previewLimit),
  }, null, 2);
}

function getOptionSummary(options = {}) {
  return {
    target_duration_sec: Number(options.targetDurationSec || options.target_duration_sec || 0) || '',
    aspect_ratio: options.aspectRatio || options.aspect_ratio || '',
    style_prompt: options.stylePrompt || options.style_prompt || '',
  };
}

function buildFreeformBriefMessages({ run = {}, skillContext = '', options = {} } = {}) {
  const optionSummary = getOptionSummary(options);
  const creativeInput = options.creative_context?.input || {};
  const userRequirements = creativeInput.raw_text || creativeInput.source_hint || '';
  const requiredNarrationLiterals = requiredNarration.extractRequiredNarrationLiterals(userRequirements);
  return [
    {
      role: 'system',
      content: [
        '你是 HyperFrames 导演简报 Agent。',
        '你的任务是把已有口播、分镜和用户风格要求整理成可执行的视频工程创作简报。',
        '只能返回 JSON 对象，不要返回 Markdown、代码块或解释文字。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '请根据以下资料生成 HyperFrames 导演简报。',
        '',
        '目标参数：',
        safeJson(optionSummary),
        '',
        '风格要求：',
        optionSummary.style_prompt || '未指定',
        '',
        '用户原始要求（优先于运行摘要，必须遵守其中的 Scene 数量、素材绑定和指定原文）：',
        String(userRequirements || '未提供').slice(0, MAX_JSON_CHARS),
        ...(requiredNarrationLiterals.length ? [
          '',
          '必须逐字保留的分 Scene 旁白原句（机器校验；不得同义改写、删减或移到其他 Scene）：',
          safeJson(requiredNarrationLiterals),
        ] : []),
        ...(Array.isArray(options.requiredLiteralRetryMissing) && options.requiredLiteralRetryMissing.length ? [
          '',
          '上一次结果未通过原句校验，请修正以下缺失项后重新返回完整 JSON：',
          safeJson(options.requiredLiteralRetryMissing),
        ] : []),
        '',
        '技能上下文：',
        String(skillContext || '未提供'),
        '',
        '运行摘要：',
        safeJson(run),
        '',
        '输出要求：',
        '1. 只返回 JSON 对象。',
        '2. title 用中文概括短片主题。',
        '3. summary 说明成片表达目标。',
        '4. narration 不要输出完整口播，只写 120 字以内的口播结构摘要。',
        '5. storyboard 给出关键场景规划；storyboard.scenes[].narration_text 承载实际配音文本。',
        '6. storyboard.scenes[].visual_text 承载画面文字素材：keywords 是 3~5 个画面关键词；cards 是 2~4 条提炼后的要点短语或数据点，每条 4~16 个汉字。keywords/cards 禁止照抄 narration_text 原句，也不要写成完整长句；旁白全文会由系统作为底部字幕注入，画面文字只放提炼后的短文案。',
        '7. audio_direction 给出高级成片音频导演建议，必须包含 voice 和 style_prompt；style_prompt 可描述情绪、口吻、语速、停顿、吸气、笑声或哭腔，例如紧张、深呼吸、语速加快、沉默片刻、长叹一口气。',
        '8. storyboard.scenes[].narration_text 和 captions.text 只能包含观众可见、可朗读的正文；吸气、停顿、语速等表演指令只能写入 audio_direction.style_prompt，不要写进旁白或字幕。',
        '9. design_md 使用 Markdown 文本描述视觉方向、版式、动效和检查要点。',
        '',
        '输出示例：',
        safeJson({
          title: '短片标题',
          summary: '成片目标说明',
          narration: '口播结构摘要，不粘贴完整长稿。',
          audio_direction: {
            voice: 'mimo_default',
            style_prompt: '自然清晰，带一点紧张感；开头深呼吸，关键句语速加快，结尾留出短暂停顿。',
          },
          storyboard: {
            scenes: [
              {
                headline: '开场',
                narration_text: '第一段旁白。',
                visual_text: {
                  keywords: ['关键词一', '关键词二', '关键词三'],
                  cards: ['提炼要点短语', '数据点：30%'],
                },
                visual_direction: '画面设计说明',
              },
            ],
          },
          design_md: '# Design\n视觉方向与制作要求',
        }),
      ].join('\n'),
    },
  ];
}

function parseJsonObject(text = '') {
  const cleaned = stripCodeFence(text);
  // AI 模型有时会用中文引号 「」""'' 代替标准双引号，统一清洗
  const sanitized = cleaned
    .replace(/[「『"']/g, '"')  // 「『"' → "
    .replace(/[」』"']/g, '"');   // 」』"' → "

  const candidates = [cleaned];
  if (sanitized !== cleaned) candidates.push(sanitized);

  for (const candidate of candidates) {
    // 1. 直接解析
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch (_) {}
    // 2. 正则提取第一个完整的 JSON 对象（非贪婪，容错 AI 输出的额外文字）
    const jsonMatch = candidate.match(/\{[\s\S]*?\}/);
    if (jsonMatch && jsonMatch[0] !== candidate) {
      try {
        const value = JSON.parse(jsonMatch[0]);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
      } catch (_) {}
    }
    // 3. 贪婪匹配兜底（处理嵌套大括号的情况）
    const greedyMatch = candidate.match(/\{[\s\S]*\}/);
    if (greedyMatch && greedyMatch[0] !== jsonMatch?.[0]) {
      try {
        const value = JSON.parse(greedyMatch[0]);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
      } catch (_) {}
    }
  }
  // 记录原始内容以便诊断（截取前 500 字符）
  const preview = String(text || '').slice(0, 500);
  throw new Error(`响应不是 JSON 对象。原始内容预览：${preview}`);
}

function parseFreeformBriefResponse(text = '') {
  try {
    return {
      success: true,
      brief: parseJsonObject(text),
    };
  } catch (error) {
    return {
      success: false,
      message: `解析 HyperFrames 导演简报失败：${error.message}`,
    };
  }
}

module.exports = {
  buildFreeformBriefMessages,
  parseFreeformBriefResponse,
  extractRequiredNarrationLiterals: requiredNarration.extractRequiredNarrationLiterals,
  validateRequiredNarrationLiterals: requiredNarration.validateRequiredNarrationLiterals,
};
