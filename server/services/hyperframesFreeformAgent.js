function stripCodeFence(text = '') {
  let value = String(text || '').trim();
  value = value.replace(/^```(?:json)?\s*/i, '');
  value = value.replace(/\s*```$/i, '');
  return value.trim();
}

function safeJson(value) {
  return JSON.stringify(value || {}, null, 2).slice(0, 12000);
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
        '4. narration 保留或整理口播结构。',
        '5. storyboard 给出关键场景规划。',
        '6. design_md 使用 Markdown 文本描述视觉方向、版式、动效和检查要点。',
        '',
        '输出示例：',
        safeJson({
          title: '短片标题',
          summary: '成片目标说明',
          narration: '整理后的口播',
          storyboard: {
            scenes: [
              {
                headline: '开场',
                narration_text: '第一段旁白',
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

function buildFreeformProjectMessages({ run = {}, brief = {}, skillContext = '', options = {} } = {}) {
  const optionSummary = getOptionSummary(options);
  return [
    {
      role: 'system',
      content: [
        '你是 HyperFrames 工程生成 Agent。',
        '你的任务是根据导演简报生成一个可运行、可检查、可渲染的 HyperFrames 自由工程。',
        '只能返回 JSON 对象，不要返回 Markdown、代码块或解释文字。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '请生成 HyperFrames 自由工程文件。',
        '',
        '目标参数：',
        safeJson(optionSummary),
        '',
        '风格要求：',
        optionSummary.style_prompt || '未指定',
        '',
        '技能上下文：',
        String(skillContext || '未提供'),
        '',
        '导演简报：',
        safeJson(brief),
        '',
        '运行摘要：',
        safeJson(run),
        '',
        '输出要求：',
        '1. 只返回 JSON 对象。',
        '2. files 必须包含 index.html。',
        '3. files 建议包含 design.md、hyperframes.json、package.json。',
        '4. index.html 应是完整 HTML，可以直接作为 HyperFrames 工程入口。',
        '5. design.md 记录视觉设计、动效、验证和渲染说明。',
        '',
        '输出示例：',
        safeJson({
          summary: '工程已生成',
          files: {
            'index.html': '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
            'design.md': '# Design\n视觉设计说明',
            'hyperframes.json': '{ "composition": "main" }',
            'package.json': '{ "private": true, "scripts": { "lint": "echo lint" } }',
          },
        }),
      ].join('\n'),
    },
  ];
}

function parseJsonObject(text = '') {
  const value = JSON.parse(stripCodeFence(text));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('响应不是 JSON 对象');
  }
  return value;
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

function parseFreeformProjectResponse(text = '') {
  try {
    const value = parseJsonObject(text);
    const files = value.files && typeof value.files === 'object' && !Array.isArray(value.files)
      ? value.files
      : {};
    if (!files['index.html']) {
      throw new Error('缺少 index.html 文件');
    }
    return {
      success: true,
      summary: value.summary || '',
      files,
    };
  } catch (error) {
    return {
      success: false,
      message: `解析 HyperFrames 工程响应失败：${error.message}`,
    };
  }
}

module.exports = {
  buildFreeformBriefMessages,
  buildFreeformProjectMessages,
  parseFreeformBriefResponse,
  parseFreeformProjectResponse,
};
