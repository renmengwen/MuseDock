const MAX_JSON_CHARS = 12000;

const ALLOWED_PROJECT_FILES = new Set([
  'index.html',
  'design.md',
  'hyperframes.json',
  'package.json',
  'meta.json',
]);

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
        '2. files 必须包含非空字符串 index.html。',
        '3. files 只允许包含 index.html、design.md、hyperframes.json、package.json、meta.json。',
        '4. 不要输出 output.mp4、contact_sheet.jpg 或任何二进制产物文件。',
        '5. 所有 files 内容必须是字符串。',
        '6. index.html 应是完整 HTML，可以直接作为 HyperFrames 工程入口。',
        '7. design.md 记录视觉设计、动效、验证和渲染说明。',
        '8. index.html 的根合成元素必须包含 data-composition-id="main" 和 data-duration="<总秒数>"；如果使用 CSS/WAAPI/requestAnimationFrame 动画，不要省略 data-duration。',
        '9. CSS font-family 只能使用 HyperFrames 可映射字体，例如 inter、jetbrains-mono、montserrat、noto-sans、open-sans；不要使用 Microsoft YaHei、PingFang SC、SFMono-Regular 等系统字体名。',
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

function validateProjectFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('files 必须是 JSON 对象');
  }

  const validatedFiles = {};
  for (const [fileName, content] of Object.entries(files)) {
    if (!ALLOWED_PROJECT_FILES.has(fileName)) {
      throw new Error(`不支持的工程文件：${fileName}`);
    }
    if (typeof content !== 'string') {
      throw new Error(`工程文件 ${fileName} 的内容必须是字符串`);
    }
    validatedFiles[fileName] = content;
  }

  if (typeof validatedFiles['index.html'] !== 'string' || !validatedFiles['index.html'].trim()) {
    throw new Error('缺少非空 index.html 文件');
  }

  return validatedFiles;
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
    return {
      success: true,
      summary: value.summary || '',
      files: validateProjectFiles(value.files),
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
