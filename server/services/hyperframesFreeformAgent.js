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
        '6. audio_direction 给出高级成片音频导演建议，必须包含 voice 和 style_prompt；style_prompt 可描述情绪、口吻、语速、停顿、吸气、笑声或哭腔，例如紧张、深呼吸、语速加快、沉默片刻、长叹一口气。',
        '7. storyboard.scenes[].narration_text 和 captions.text 只能包含观众可见、可朗读的正文；吸气、停顿、语速等表演指令只能写入 audio_direction.style_prompt，不要写进旁白或字幕。',
        '8. design_md 使用 Markdown 文本描述视觉方向、版式、动效和检查要点。',
        '',
        '输出示例：',
        safeJson({
          title: '短片标题',
          summary: '成片目标说明',
          narration: '整理后的口播',
          audio_direction: {
            voice: 'mimo_default',
            style_prompt: '自然清晰，带一点紧张感；开头深呼吸，关键句语速加快，结尾留出短暂停顿。',
          },
          storyboard: {
            scenes: [
              {
                headline: '开场',
                narration_text: '第一段旁白。',
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
        '8. index.html 的根合成元素必须包含 data-composition-id="main" 和 data-duration="<总秒数>"，但根合成元素禁止包含 data-start 或 data-track-index；只有内部 scene/clip 元素可以使用 data-start、data-duration、data-track-index，否则会触发 overlapping_clips_same_track lint 错误。',
        '9. 内部 scene/clip 如果放在同一个 data-track-index 上，必须首尾相接，不得重叠；data-start 和 data-duration 最多保留 2 位小数，不要输出 55.440000000000005 这类浮点长尾；如果需要与其它元素同时间出现，必须使用不同 data-track-index。',
        '10. CSS font-family 只能使用 HyperFrames 可映射字体，例如 inter、jetbrains-mono、montserrat、noto-sans、open-sans；不要使用 Microsoft YaHei、PingFang SC、SFMono-Regular 等系统字体名。',
        '11. 首屏不得一次性展示所有信息。请将首屏中的关键短语、能力标签、步骤标签、卖点词或主题关键词拆成多个独立元素，并在 0.2-2.5 秒内按节奏逐个进入、强调或点亮；具体文案应根据本次主题自动生成，不要使用固定模板词。',
        '12. 每个主要场景至少设计 4 个元素级 motion beat，让标题、副标题、卡片、代码行、图标、数据点、标签或核心对象分层出现；不要只做整页显示/隐藏。',
        '13. index.html 必须注册确定性的 GSAP 时间线：window.__timelines["main"] = tl；时间线需 paused: true，并使用 tl.from、tl.to 或 tl.fromTo 编排元素级动画。不要依赖 setInterval、performance.now、requestAnimationFrame 或无限 repeat 动画。',
        '14. 如果 scene 通过 opacity/autoAlpha 退出，必须在退出结束时间追加硬隐藏，例如 tl.set("#scene01", { opacity: 0 }, 13.12)。注意：scene 元素（class 含 "clip"）的 visibility 由框架自动管理，禁止在 GSAP 中对 clip 元素设置 visibility/display，否则触发 gsap_animates_clip_element lint 错误；如需同时控制 visibility，请将内容包在子 <div> 中并对子元素做动画。',
        '15. 大字号中文、标题、关键词、glitch word、burst word 或任何会 scale > 1.1 入场的文字，不能放在 overflow:hidden 的固定高度容器里；容器应使用 overflow:visible、足够高度，或添加 data-layout-allow-overflow="true"，避免 inspect 报 clipped_text/text_box_overflow。',
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

function buildSceneSpecMessages({ run = {}, brief = {}, skillContext = '', options = {} } = {}) {
  const optionSummary = getOptionSummary(options);
  return [
    {
      role: 'system',
      content: [
        '你是 HyperFrames 场景规格 Agent。',
        '你的任务是根据导演简报生成结构化的场景规格 scene_spec。',
        '只输出 JSON，不要输出 HTML、CSS、JS、package.json 或完整工程 files。',
        '根字段是 scene_spec。',
        '每个场景必须有 stable id、duration、narration_text、captions、visual_text。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '请生成场景规格 scene_spec。',
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
        '2. 根字段是 scene_spec。',
        '3. 不要输出 HTML、CSS、JS、package.json 或完整工程 files。',
        '4. scene_spec 必须包含 version、title、aspect_ratio、scenes。',
        '5. 每个场景必须有 stable id、duration、narration_text、captions、visual_text。',
        '6. captions 数组每个元素必须有 id、start、end、text。',
        '7. visual_text 必须包含 headline、keywords、cards。',
        '',
        '输出示例：',
        safeJson({
          scene_spec: {
            version: 1,
            title: '短片标题',
            aspect_ratio: '9:16',
            scenes: [
              {
                id: 'scene_01',
                duration: 5,
                narration_text: '第一段旁白',
                captions: [{ id: 'cap_01_01', start: 0, end: 2, text: '第一句字幕' }],
                visual_text: { headline: '开场标题', keywords: ['关键词'], cards: ['卡片'] },
              },
            ],
          },
        }),
      ].join('\n'),
    },
  ];
}

function parseSceneSpecResponse(text = '') {
  try {
    const value = parseJsonObject(text);
    if (!value.scene_spec || typeof value.scene_spec !== 'object') {
      throw new Error('缺少 scene_spec 字段');
    }
    if (!Array.isArray(value.scene_spec.scenes) || value.scene_spec.scenes.length === 0) {
      throw new Error('scene_spec.scenes 不能为空');
    }
    return {
      success: true,
      scene_spec: value.scene_spec,
    };
  } catch (error) {
    return {
      success: false,
      message: `解析场景规格响应失败：${error.message}`,
    };
  }
}

module.exports = {
  buildFreeformBriefMessages,
  buildFreeformProjectMessages,
  buildSceneSpecMessages,
  parseFreeformBriefResponse,
  parseFreeformProjectResponse,
  parseSceneSpecResponse,
};
