const { summarizeCreativeContextForPrompt } = require('./contentGraphAgent');
const { createDiagnostic } = require('./diagnostics');
const {
  normalizeHtmlCanvasContract,
  validateHtmlCanvasContract,
} = require('./frameCanvasContract');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compactText(value, maxLength = 1000) {
  let raw = value;
  if (Array.isArray(value)) {
    raw = value.map(item => compactText(item, 120)).filter(Boolean).join(' / ');
  } else if (value && typeof value === 'object') {
    raw = value.title || value.label || value.name || value.text || value.headline || value.summary || value.description || '';
  }
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text || /^\[object Object\]$/i.test(text)) return '';
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

function resolveResolution(target = {}) {
  const resolution = objectOrEmpty(target.resolution || target.output?.resolution);
  const width = Number(target.width || resolution.width || 1920);
  const height = Number(target.height || resolution.height || 1080);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1920,
    height: Number.isFinite(height) && height > 0 ? height : 1080,
  };
}

function nodeSummary(node = {}) {
  const summary = {
    id: node.id,
    kind: node.kind,
    label: node.label,
    durationSec: node.durationSec,
  };
  if (node.data) summary.data = node.data;
  if (node.text) summary.text = node.text;
  if (node.metadata) {
    // 硬约束 A：visual_beat/visual_beats/beat_windows 是展开阶段写入的内部编排快照，
    // asset_first 的编排信息已由 buildAssetFirstFramePrompt 显式注入，
    // 原始 JSON 进 prompt 只会污染 hf_first 的模型输入并浪费 token，这里统一剥离。
    const { visual_beat, visual_beats, beat_windows, ...rest } = node.metadata;
    if (Object.keys(rest).length) summary.metadata = rest;
  }
  return JSON.stringify(summary, null, 2);
}

function adjacentSummary(graph = {}, index) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  return {
    previous: index > 0 ? compactText(nodes[index - 1]?.label || nodes[index - 1]?.text || nodes[index - 1]?.id, 160) : '',
    next: index < nodes.length - 1 ? compactText(nodes[index + 1]?.label || nodes[index + 1]?.text || nodes[index + 1]?.id, 160) : '',
  };
}

function sceneLightSummary(scene = {}) {
  if (!scene || typeof scene !== 'object') return null;
  return {
    id: scene.id,
    title: compactText(scene.visual_text?.headline || scene.headline || scene.title || scene.narration_text, 160),
  };
}

function frameSceneSpecSummary(sceneSpec = {}, node = {}, frameId = '', index = 0) {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const currentScene = resolveSceneForFrame(sceneSpec, node, frameId || node?.id || '');
  const currentIndex = scenes.findIndex(scene => scene && scene.id === currentScene?.id);
  const sceneIndex = currentIndex >= 0 ? currentIndex : index;
  return {
    title: sceneSpec.title || '',
    current_scene: currentScene && Object.keys(currentScene).length ? currentScene : null,
    previous_scene: sceneIndex > 0 ? sceneLightSummary(scenes[sceneIndex - 1]) : null,
    next_scene: sceneIndex >= 0 && sceneIndex < scenes.length - 1 ? sceneLightSummary(scenes[sceneIndex + 1]) : null,
  };
}

function compactHtmlReference(source, maxLength = 2600) {
  const text = String(source || '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

function buildVisualContinuitySection({ visualStyleReferenceHtml = '', previousFrameHtml = '' } = {}) {
  const styleReference = compactHtmlReference(visualStyleReferenceHtml);
  const previousReference = compactHtmlReference(previousFrameHtml);
  if (!styleReference && !previousReference) return [];
  return [
    '',
    'Visual continuity lock（跨镜头风格锁定）：',
    '本视频按 html-video multi-composition 的思路生成：每一帧可以有不同构图和叙事重点，但必须保持同一套调色板、字体、背景语言、组件形状和 motion vocabulary。',
    '允许当前帧更换构图、信息层级和主视觉对象；不要另起一套视觉主题，不要切换到新的蓝紫科技风、玻璃拟态 dashboard 或与视觉锚点不一致的风格。',
    '如果当前内容需要流程图、卡片、数据或设备界面，必须用视觉锚点中的颜色、字体、形状、阴影、圆角、边框和动效语言重新表达，而不是重新设计一套美术风格。',
    ...(styleReference ? [
      '',
      '全片视觉锚点 HTML（通常来自第一帧；用于锁定全片 visual signature，只参考视觉系统，不复制文案）：',
      '```html',
      styleReference,
      '```',
    ] : []),
    ...(previousReference ? [
      '',
      '相邻上一帧 HTML（用于保持镜头衔接；当前帧要延续它的视觉语言，但内容和构图必须服务当前 frame）：',
      '```html',
      previousReference,
      '```',
    ] : []),
  ];
}

function buildStyleProfileSection(styleProfile = {}) {
  if (!styleProfile || !styleProfile.id) return [];
  return [
    '',
    'Task style profile（本任务视觉签名，不要复用失败模板的默认视觉）：',
    `视觉风格参考：遵循本任务 style_profile「${styleProfile.id}」；不要复用模板默认主体文案。`,
    JSON.stringify({
      id: styleProfile.id,
      family: styleProfile.family,
      palette: styleProfile.palette,
      layout_language: styleProfile.layout_language,
      motion_language: styleProfile.motion_language,
    }, null, 2),
  ];
}

function frameAssetReferenceSummary(node = {}, creativeContext = {}) {
  const expected = resolveExpectedFrameAsset(node, creativeContext);
  if (!expected) return '';
  const { ref, asset } = expected;
  const analysis = asset.image_analysis || {};
  const isGenerated = asset.source === 'generated';
  const lines = [
    isGenerated ? '本帧推荐生成图片（AI 主视觉素材）：' : '本帧推荐来源图片：',
    `- asset_id：${compactText(ref.asset_id, 160)}`,
    `- src：${compactText(asset.frame_src || asset.path, 260)}`,
    `- 类型：${compactText(analysis.visual_type || asset.type || asset.source || 'image', 80)}`,
    `- 图片说明：${compactText(analysis.summary || asset.alt || asset.caption || asset.description || asset.summary, 260) || '（无）'}`,
    `- 建议用法：${compactText(ref.usage || analysis.best_usage, 180) || '（无）'}`,
    `- 推荐原因：${compactText(ref.reason, 260) || '（无）'}`,
  ];
  if (isGenerated) {
    lines.push('- 注意：这是 AI 生成素材，不是来源证据，不要用作事实证明或截图展示。');
  }
  return lines.join('\n');
}

function assetFirstFrameRequirements(creativeContext = {}) {
  if (creativeContext?.visual_strategy !== 'asset_first') return [];
  return [
    '- 当前为素材主导（asset_first）模式：如果本帧有推荐图片，图片必须作为画面主体（占据主要视觉面积，可全出血或大图卡），不是小配图。',
    '- 在图片主体之上叠加 HTML 表达层：标题、关键词浮层、框选高亮、箭头标注、局部放大、步骤编号、数据卡或字幕节奏点，至少使用其中 2 种。',
    '- 表达层必须服务旁白重点：标注/放大图片中与旁白直接相关的区域，不要做无意义装饰。',
    '- 图片上叠加文字时必须加渐变遮罩或半透明底色保证可读性；主体图片使用 object-fit: cover 时不得裁掉关键主体，含文字的截图仍用 object-fit: contain。',
    '- 禁止退化成纯图片轮播：没有表达层的帧不合格。',
  ];
}

const MOTION_PRIMITIVE_GUIDE = `可用 motion primitive（只能作为局部 overlay，不能替代主视觉）：
- concept_card：小型概念卡，适合术语解释。
- key_marker：重点句/金句/提醒，下三分之一或侧边。
- three_step_flow：三步流程，横向或侧边。
- cause_chain：原因 -> 机制 -> 结果。
- checklist：三条总结清单。
- stat_compare：两个数据/对象对比。`;

function buildAssetFirstFramePrompt({ beat = {}, primitiveSnippet = '', diagramSkeleton = '', previousBeatSummary = '', hasCaptions = true, sceneBeatsBrief = '' } = {}) {
  const base = beat.visual_base || {};
  const overlay = beat.motion_overlay || {};
  const continuity = beat.continuity || {};
  const lines = [MOTION_PRIMITIVE_GUIDE, ''];
  // beat 级 overlay 编排段：只有 motion_overlay 存在时输出（scene_html 组内全无 overlay 时仅剩 brief 段）
  if (beat.motion_overlay) {
    if (base.type === 'diagram') {
      lines.push('本 beat 无图片素材：必须生成统一风格的结构化 diagram 作为主视觉（main_visual），禁止输出标题页式整屏大字。');
      if (diagramSkeleton) {
        lines.push('base 层必须以以下 diagram 骨架为起点（保留 data-mp-diagram-base 结构与 --mp-* 主题变量，在 stage 区域内绘制结构图）：');
        lines.push(diagramSkeleton);
      }
    } else {
      lines.push(`图片 ${base.asset_id} 是主视觉（main_visual），必须占据画面主体，fit=${base.fit || 'contain'}；局部 overlay 不得覆盖图片主体。`);
    }
    lines.push(`本 beat 选定 motion primitive：${overlay.preset}，placement=${overlay.placement}，最多 ${overlay.max_items || 1} 条内容。`);
    if (overlay.theme_tokens) {
      lines.push(`主题 token（在 :root 或根容器上设置 CSS 变量）：--mp-accent:${overlay.theme_tokens.accent}；--mp-foreground:${overlay.theme_tokens.foreground}；--mp-surface:${overlay.theme_tokens.surface}；--mp-background:${overlay.theme_tokens.background}。全帧配色必须从这些 token 派生。`);
    }
    lines.push(`底部 ${overlay.avoid_caption_bottom_px || 140}px 是系统字幕安全区，任何 overlay 元素不得进入该区域。`);
    if (primitiveSnippet) {
      lines.push('overlay 必须基于以下片段落地（保留 data-mp-overlay 根节点与 data-mp-slot 槽位，可按主题 token 调整 --mp-accent/--mp-surface/--mp-foreground）：');
      lines.push(primitiveSnippet);
    }
    if (continuity.beat_index > 1) {
      lines.push(`本 beat 是 continuity group ${continuity.group_id} 的第 ${continuity.beat_index}/${continuity.beat_count} 段：必须复用上一 beat 的主视觉布局（图片位置、背景、主卡片区域、主题色），只替换局部 overlay/焦点框/箭头/标签。`);
      lines.push('禁止 base 层任何入场动画或重新开场效果：base 层元素初始状态即为最终位置与不透明度，只有 overlay 允许动画。');
      if (previousBeatSummary) lines.push(`上一 beat 布局摘要：\n${previousBeatSummary}`);
    }
    if (hasCaptions === false) {
      lines.push('本 beat 没有系统字幕文本：overlay 必须包含一条与旁白对应的画面重点短句（不超过 18 字），避免观众只听到旁白而画面无文字表达。');
    }
  }
  // scene_html 的 scene 级约束段：独立段落输出（不与 primitive 参考片段混在一起，
  // 否则 base 稳定/beat-scope 约定/时间窗口会被当成「参考 HTML 片段」照抄或降权）
  if (sceneBeatsBrief) {
    lines.push('');
    lines.push(sceneBeatsBrief);
  }
  lines.push('禁止把参考动效全屏照搬，只取核心动效区域做局部编排。');
  return lines.join('\n');
}

function normalizeAssetToken(value = '') {
  return String(value || '').replace(/\\/g, '/').trim();
}

function normalizeHtmlAssetReference(value = '') {
  const text = normalizeAssetToken(value).split(/[?#]/)[0];
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function assetReferenceTokens(asset = {}) {
  const assetPath = normalizeAssetToken(asset.path);
  return [...new Set([
    normalizeAssetToken(asset.frame_src),
    assetPath,
    assetPath ? `../${assetPath}` : '',
  ].filter(Boolean))];
}

function extractHtmlAssetReferences(html = '') {
  const references = new Set();
  const searchable = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const attrPattern = /\b(?:src|href|poster|data-src)=["']([^"']+)["']/gi;
  for (const match of searchable.matchAll(attrPattern)) {
    const value = normalizeHtmlAssetReference(match[1]);
    if (value) references.add(value);
  }
  const cssPattern = /url\(["']?([^"')]+)["']?\)/gi;
  for (const match of searchable.matchAll(cssPattern)) {
    const value = normalizeHtmlAssetReference(match[1]);
    if (value) references.add(value);
  }
  return references;
}

function htmlReferencesAsset(referenceSet, tokens = []) {
  for (const rawToken of tokens) {
    const token = normalizeHtmlAssetReference(rawToken);
    if (!token) continue;
    for (const ref of referenceSet) {
      if (ref === token || ref.endsWith(`/${token.replace(/^\.\.\//, '')}`)) return true;
    }
  }
  return false;
}

function resolveExpectedFrameAsset(node = {}, creativeContext = {}) {
  const ref = (Array.isArray(node.asset_refs) ? node.asset_refs : []).find(item => item && item.asset_id);
  if (!ref) return null;
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
  const asset = assets.find(item => String(item?.id || item?.asset_id || '') === String(ref.asset_id || ''));
  if (!asset) return null;
  return { ref, asset };
}

function validateFrameAssetUsage(html = '', { node = {}, creativeContext = {} } = {}) {
  const references = extractHtmlAssetReferences(html);
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
  const blockedAsset = assets.find(asset => objectOrEmpty(asset.image_analysis).should_use === false
    && htmlReferencesAsset(references, assetReferenceTokens(asset)));
  if (blockedAsset) {
    return {
      success: false,
      code: 'frame_html_blocked_source_asset_used',
      message: `HTML 引用了不建议用于成片的来源图片：${blockedAsset.id || blockedAsset.asset_id || blockedAsset.path || ''}。`,
      details: {
        asset_id: blockedAsset.id || blockedAsset.asset_id || '',
        path: blockedAsset.path || '',
        avoid_reason: blockedAsset.image_analysis?.avoid_reason || '',
      },
    };
  }

  const expected = resolveExpectedFrameAsset(node, creativeContext);
  if (!expected) return { success: true };
  const tokens = assetReferenceTokens(expected.asset);
  if (htmlReferencesAsset(references, tokens)) return { success: true };
  const missingLabel = expected.asset.source === 'generated' ? '本帧推荐生成图片' : '本帧推荐来源图片';
  return {
    success: false,
    code: 'frame_html_required_source_asset_missing',
    message: `HTML 未引用${missingLabel}：${expected.ref.asset_id}。`,
    details: {
      asset_id: expected.ref.asset_id,
      required_src: expected.asset.frame_src || expected.asset.path || '',
      accepted_refs: tokens,
      reason: expected.ref.reason || '',
    },
  };
}

function validateHtmlTargetResolution(html, target = {}) {
  return validateHtmlCanvasContract(html, target);
}

function targetResolutionValidationFailure(result = {}) {
  return {
    success: false,
    code: 'html_validation_failed',
    message: result.message || 'AI 返回的 HTML 画幅尺寸不符合目标尺寸。',
    details: {
      validation_code: 'frame_html_invalid',
      ...objectOrEmpty(result),
    },
  };
}

function buildFrameHtmlPrompt({
  graph = {},
  node = {},
  index = 0,
  total = 1,
  sceneSpec = {},
  creativeContext = {},
  target = {},
  styleProfile = null,
  visualStyleReferenceHtml = '',
  previousFrameHtml = '',
  layoutFeedback = '',
  beat = null,
  primitiveSnippet = '',
  diagramSkeleton = '',
  previousBeatSummary = '',
  hasCaptions = true,
  sceneBeatsBrief = '',
} = {}) {
  const resolution = resolveResolution(target);
  const adjacent = adjacentSummary(graph, index);
  const continuitySection = buildVisualContinuitySection({
    visualStyleReferenceHtml,
    previousFrameHtml,
  });
  const assetReferenceSummary = frameAssetReferenceSummary(node, creativeContext);
  return [
    '你是 html-video 单帧完整 HTML 生成器。',
    '请输出 exactly one fenced ```html code block 或一个完整 HTML document；不要输出解释、Markdown 说明或 HTML 之外的 prose。',
    '',
    '固定系统规则：',
    `Target resolution：${resolution.width}x${resolution.height}，画面必须 full-bleed ${resolution.width}x${resolution.height}，不要留白边或浏览器默认 margin。`,
    `必须按目标尺寸生成 root canvas：meta viewport、html/body 或主舞台容器都必须是 ${resolution.width}x${resolution.height}；不能交换宽高。`,
    `必须包含明确根画布 contract：body 或 #root 带 data-hv-canvas、data-width="${resolution.width}"、data-height="${resolution.height}"；普通装饰元素可有自己的 width/height，但不能替代根画布。`,
    '',
    '硬性要求：',
    '- 生成这一帧的 fresh complete HTML page，包含 <!doctype html>、html、head、body、style；JS 可选但不能依赖外网。',
    '- Output opens with an animation timeline: define CSS @keyframes/animation, GSAP timeline, or window.__hvPlayAll-driven timeline before the main visual settles.',
    '- 必须包含可检测的动效实现：CSS animation/@keyframes、GSAP timeline 或 window.__hvPlayAll 三者至少一种；禁止完全静态 HTML。',
    '- 主体运动必须覆盖标题、主卡片、核心图表、核心对象或关键数据；不要只有角落装饰、背景扫光、微弱脉冲在动。',
    '- 当前帧长于 6 秒时，必须设计至少 2-3 个 sub-beats，例如入场、数据/观点推进、强调/收束；不要入场后长期静止。',
    '- 动画节奏要服务当前 frame content，避免无意义漂浮、随机闪烁或只有背景纹理变化。',
    '- 可见文本默认使用中文，技术词、品牌名、文件名可保留英文。',
    '- 可见文本尽量加稳定 data-* 属性，例如 data-frame-id、data-role、data-text-key，便于后续编辑。',
    '- 步骤、流程、时间线、编号卡片等有序序列，必须保证视觉顺序与数字/语义顺序一致；从上到下或从左到右不能出现 4、1、2、3 这类乱序。',
    '- 不要用 .item:nth-of-type(n) 给序列项定位或设置延迟，因为同父级其他 div/span 会参与计数；请使用专用容器 + .item:nth-child(n)，或给每个序列项写 data-index、style="--i:n"、独立 class，再用 top: calc(var(--i) * 距离) / animation-delay: calc(...)。',
    '- 版式必须先规划安全区：标题、正文、卡片、图表、截图、步骤列表和 CTA 不得相互遮挡；每个主要内容块要有明确 grid/flex 区域、max-width/max-height、gap 和 padding。',
    '- 底部至少预留 140px 字幕安全区；HTML 内的主视觉、卡片、图片、进度条和装饰层不能覆盖系统注入的底部字幕层。',
    '- 装饰层、遮罩、扫描线、粒子、光效、背景图和伪元素只能在文字/关键元素之后或之下渲染；禁止用高 z-index、mix-blend-mode 或全屏半透明层压住可读文字。',
    '- 谨慎使用 position:absolute；如必须使用，必须给出明确 left/top/right/bottom、max-width/max-height、overflow 处理和 z-index 分层，保证任何时间点文字不出框、不互相盖住、不被裁切。',
    '- raw_html 每帧必须包含稳定可编辑文本锚点：',
    '  - 主标题元素必须带 data-text-key="headline"',
    '  - 副标题或短字幕元素必须带 data-text-key="subtitle"',
    '  - 正文/要点元素必须带 data-text-key="body"',
    '  - 不允许只把可见文案写进 canvas 或伪元素',
    '  - 字幕可由系统注入，但 HTML 不得阻挡底部字幕层',
    '- 画面文字必须是提炼后的短文案：subtitle 放一句不超过 20 字的支撑短句；body 优先使用 scene_spec visual_text.keywords/cards 里的关键词、数据点或要点短语。',
    '- 禁止把 narration_text 或 captions 的原句、近似原句搬进画面任何位置；旁白全文由系统注入底部字幕层，画面再复述就是内容重复。',
    '- 不要让每一帧都使用相同主布局；相邻帧必须有清晰不同的主视觉、层级或构图。',
    '- 不要只改底部 caption；主画面、数据、标题或视觉结构必须服务当前 frame content。',
    '- 不要保留与内容无关的模板导航标签，例如 Search / GitHub / Tech Forums / Docs / Issues，除非这些词就是当前内容事实。',
    '- 如果本帧提供“本帧推荐来源图片”或“本帧推荐生成图片”，必须在 HTML 中引用该图片的 src；没有推荐图片时，才从 Source context summary 的可用图片素材中选择。',
    ...assetFirstFrameRequirements(creativeContext),
    ...(creativeContext?.visual_strategy === 'asset_first' && (beat?.motion_overlay || sceneBeatsBrief)
      ? [buildAssetFirstFramePrompt({ beat: beat || {}, primitiveSnippet, diagramSkeleton, previousBeatSummary, hasCaptions, sceneBeatsBrief })]
      : []),
    '- 如果 Source context summary 提供“可用图片素材”，本帧内容适合引用时，可以使用其中的 HTML引用路径，例如 <img src="../assets/source-image-01.jpg">；禁止引用外部图片 URL。',
    '- 文章截图或含文字图片必须完整展示，使用 object-fit: contain；不要裁切成不可读背景。图库/search 图片只适合做弱背景或氛围层，必须加遮罩保证文字可读。',
    '- 不要做纯图片轮播；图片必须和本帧关键词、字幕、数据卡、框选、高亮或解释文案混排。',
    '- 不要输出 [object Object]；对象必须提取成有意义的文字或数据。',
    '- 不要发明源素材中没有的精确事实、数字、品牌、机构或时间。',
    '- 不要输出解释，不要在 HTML block 外写任何文字。',
    ...(String(layoutFeedback || '').trim() ? [
      '',
      '布局修复要求（上一版 HTML 经真实浏览器检测存在遮挡/出框，本次必须修复）：',
      `- 检测到的问题：${compactText(layoutFeedback, 600)}`,
      '- 保持文案内容不变，只调整布局：把互相重叠的内容块放进各自独立的 grid/flex 区域，或上下错开。',
      '- 出问题的元素禁止再用 position:absolute 叠放在其他内容块占用的区域之上。',
      '- 确保动画结束状态（所有元素落位后）任何文字互不遮挡、不超出画面。',
    ] : []),
    ...buildStyleProfileSection(styleProfile),
    ...continuitySection,
    '',
    '---- 本次动态输入 ----',
    `当前帧：${node.id || `frame_${index + 1}`}（${index + 1}/${total}）`,
    '当前 frame content graph node：',
    nodeSummary(node),
    '',
    `Whole video synopsis：${compactText(graph.synopsis || sceneSpec.title || '', 500)}`,
    `上一帧：${adjacent.previous || '无'}`,
    `下一帧：${adjacent.next || '无'}`,
    '',
    'Source context summary：',
    summarizeCreativeContextForPrompt(creativeContext) || '（无）',
    '',
    assetReferenceSummary || '本帧没有专门推荐的来源图片。',
    '',
    'scene_spec 摘要：',
    JSON.stringify(frameSceneSpecSummary(sceneSpec, node, node.id || '', index), null, 2),
    '',
    '请返回：',
    '```html',
    '<!doctype html>',
    '<html>...</html>',
    '```',
  ].join('\n');
}

function decodeBasicHtmlEntities(text = '') {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    });
}

function htmlVisibleSegments(html = '') {
  const withoutHidden = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  return decodeBasicHtmlEntities(withoutHidden.replace(/<[^>]+>/g, '\n'))
    .split(/\r?\n/)
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function visibleHtmlText(html = '') {
  return htmlVisibleSegments(html).join(' ').replace(/\s+/g, ' ').trim();
}

function normalizedComparableText(value = '') {
  return decodeBasicHtmlEntities(value)
    .replace(/\s+/g, '')
    .replace(/[“”‘’"']/g, '')
    .trim()
    .toLowerCase();
}

function flattenTextValues(value, output = []) {
  if (value === null || value === undefined) return output;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = compactText(value, 600);
    if (text) output.push(text);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => flattenTextValues(item, output));
    return output;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      if (/^(id|scene_id|frame_id|kind|type|status|path|url|html_path|mp4_path)$/i.test(key)) return;
      flattenTextValues(item, output);
    });
  }
  return output;
}

function resolveSceneForFrame(sceneSpec = {}, node = {}, frameId = '') {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const candidates = [
    node?.metadata?.scene_id,
    node?.scene_id,
    node?.sceneId,
    frameId,
    node?.id,
  ].map(item => String(item || '').trim()).filter(Boolean);
  return scenes.find(scene => candidates.includes(String(scene?.id || '').trim()))
    || (scenes.length === 1 ? scenes[0] : {});
}

// 画面内容匹配打分只用提炼素材（headline/keywords/cards/label），避免奖励画面照抄旁白。
function overlapExpectedTexts(args = {}) {
  const scene = resolveSceneForFrame(args.sceneSpec || {}, args.node || {}, args.frameId || args.node?.id || '');
  const values = [];
  flattenTextValues(scene?.visual_text, values);
  flattenTextValues(scene?.title, values);
  flattenTextValues(args.node?.label, values);
  return [...new Set(values.map(item => compactText(item, 600)).filter(Boolean))];
}

function primaryExpectedText(args = {}) {
  const scene = resolveSceneForFrame(args.sceneSpec || {}, args.node || {}, args.frameId || args.node?.id || '');
  return compactText(
    scene?.visual_text?.headline
      || scene?.headline
      || args.node?.label
      || args.node?.text
      || scene?.title
      || '',
    180,
  );
}

function textLengthScore(text = '') {
  const value = String(text || '');
  const chinese = (value.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (value.match(/[A-Za-z0-9]/g) || []).length;
  return chinese + latin;
}

function contentOverlapScore(htmlComparable, expectedTexts) {
  const tokens = new Set();
  for (const text of expectedTexts) {
    const raw = String(text || '');
    for (const match of raw.matchAll(/[A-Za-z][A-Za-z0-9_-]{2,}/g)) {
      tokens.add(match[0].toLowerCase());
    }
    for (const match of raw.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
      const chunk = match[0];
      if (chunk.length <= 6) {
        tokens.add(chunk);
      } else {
        for (let index = 0; index <= chunk.length - 4; index += 2) {
          tokens.add(chunk.slice(index, index + 4));
        }
      }
    }
  }
  return [...tokens]
    .filter(token => textLengthScore(token) >= 3 && htmlComparable.includes(normalizedComparableText(token)))
    .length;
}

function validateHtmlContentQuality(html, args = {}) {
  const htmlComparable = normalizedComparableText(visibleHtmlText(html));

  const primary = primaryExpectedText(args);
  const primaryComparable = normalizedComparableText(primary);
  if (primaryComparable && !htmlComparable.includes(primaryComparable)) {
    const overlap = contentOverlapScore(htmlComparable, overlapExpectedTexts(args));
    if (overlap < 2) {
      return {
        success: true,
        diagnostics: [{
          code: 'frame_html_content_mismatch',
          severity: 'warning',
          stage: 'ai-frame-html',
          sub_stage: 'frame_html',
          frame_id: args.node?.id || '',
          retryable: false,
          repair_action: '',
          user_message: `HTML 主画面文案没有匹配当前镜头内容，缺少核心标题或足够关键词：${primary}。`,
          details: {
            expected_headline: primary,
            overlap_score: overlap,
          },
        }],
        code: 'frame_html_content_mismatch',
        message: `HTML 主画面文案没有匹配当前镜头内容，缺少核心标题或足够关键词：${primary}。`,
      };
    }
  }

  return { success: true };
}

function validateGeneratedHtml(html, args = {}) {
  const resolution = validateHtmlTargetResolution(html, args.target || {});
  if (!resolution.success) {
    return {
      success: false,
      code: 'html_validation_failed',
      message: resolution.message || 'AI 返回的 HTML 画幅尺寸不符合目标尺寸。',
      details: {
        validation_code: 'frame_html_invalid',
        ...resolution,
      },
    };
  }
  const quality = validateHtmlContentQuality(html, args);
  if (!quality.success) {
    return {
      ...quality,
      code: 'html_validation_failed',
      details: {
        validation_code: quality.code || 'frame_html_invalid',
        ...(quality.details || {}),
      },
    };
  }
  const assetUsage = validateFrameAssetUsage(html, args);
  if (!assetUsage.success) {
    return {
      ...assetUsage,
      code: 'html_validation_failed',
      details: {
        validation_code: assetUsage.code || 'frame_html_asset_usage_invalid',
        ...(assetUsage.details || {}),
      },
    };
  }
  return quality;
}

function findScene(sceneSpec = {}, sceneId = '') {
  return (Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [])
    .find(scene => scene && scene.id === sceneId) || {};
}

function buildShortFrameHtmlPrompt({
  frameId = '',
  node = {},
  sceneSpec = {},
  target = {},
  creativeContext = {},
  beat = null,
  primitiveSnippet = '',
  diagramSkeleton = '',
  previousBeatSummary = '',
  hasCaptions = true,
  sceneBeatsBrief = '',
} = {}) {
  const resolution = resolveResolution(target);
  const sceneId = frameId || node.id || '';
  const scene = findScene(sceneSpec, sceneId);
  const title = compactText(scene.visual_text?.headline || node.label || scene.title || sceneId, 160);
  const narration = compactText(scene.narration_text || node.text || node.data || '', 420);
  const captions = compactText(scene.captions || [], 360);
  const visualKeywords = compactText(scene.visual_text?.keywords || [], 200);
  const visualCards = compactText(scene.visual_text?.cards || [], 240);
  const assetSummary = frameAssetReferenceSummary(node, creativeContext);
  return [
    '你是 html-video 单帧 HTML 生成器。只返回完整 HTML document，不要解释。',
    `当前帧：${sceneId}`,
    `scene title：${title || sceneId}`,
    `当前 scene narration：${narration || '无'}`,
    `当前 scene captions：${captions || '无'}`,
    `画面关键词：${visualKeywords || '无'}`,
    `画面要点卡：${visualCards || '无'}`,
    '画面文字用提炼后的关键词、要点短语或数据点，不要照抄 narration/captions 原句；旁白全文由系统注入底部字幕层。',
    ...assetFirstFrameRequirements(creativeContext),
    ...(creativeContext?.visual_strategy === 'asset_first' && (beat?.motion_overlay || sceneBeatsBrief)
      ? [buildAssetFirstFramePrompt({ beat: beat || {}, primitiveSnippet, diagramSkeleton, previousBeatSummary, hasCaptions, sceneBeatsBrief })]
      : []),
    assetSummary ? `${assetSummary}\n必须引用上面的 src，图片用 object-fit: contain，并与文字说明混排。` : '',
    `Target resolution：${resolution.width}x${resolution.height}`,
    `必须生成 full-bleed ${resolution.width}x${resolution.height} 完整 HTML，包含 <!doctype html>、html、head、body、style。`,
    `body 或 #root 必须带 data-hv-canvas、data-width="${resolution.width}"、data-height="${resolution.height}"。`,
    '必须包含 data-text-key="headline"、data-text-key="subtitle"、data-text-key="body" 三类可见文本锚点。',
    '必须包含基础动画：CSS @keyframes/animation、GSAP timeline 或 window.__hvPlayAll 至少一种。',
    '可见文本使用中文；不要输出 Markdown、解释或 HTML 外文字。',
  ].join('\n');
}

function extractHtmlDocument(text) {
  const raw = String(text || '').trim();
  if (!raw) return { success: false, code: 'provider_missing_text', message: 'AI 返回为空，未返回 HTML 内容。' };
  const fenced = raw.match(/```html\s*([\s\S]*?)```/i);
  const html = fenced ? fenced[1].trim() : extractRawHtmlDocument(raw);
  if (!/(<!doctype\s+html|<html[\s>])/i.test(html) || !/<\/html>/i.test(html)) {
    return { success: false, code: 'html_document_extract_failed', message: 'AI 未返回完整 HTML document。' };
  }
  return { success: true, html };
}

function extractRawHtmlDocument(raw) {
  const doctypeMatch = raw.match(/<!doctype\s+html[\s\S]*?<\/html>/i);
  if (doctypeMatch) return doctypeMatch[0].trim();
  const htmlMatch = raw.match(/<html[\s\S]*?<\/html>/i);
  if (htmlMatch) return htmlMatch[0].trim();
  return raw.trim();
}

function buildRetryPrompt(args = {}) {
  const resolution = resolveResolution(args.target || {});
  const validationMessage = compactText(args.validationMessage || args.validation_message || '', 260);
  const expectedTexts = overlapExpectedTexts(args).slice(0, 8);
  const expectedHeadline = primaryExpectedText(args);
  const scene = resolveSceneForFrame(args.sceneSpec || {}, args.node || {}, args.frameId || args.node?.id || '');
  // ponytail: 只有旧 scene-spec 没有 keywords/cards 时才兜底给旁白，且要求提炼后再用
  const frameText = expectedTexts.length > 1
    ? ''
    : compactText(args.node?.text || scene?.narration_text || '', 260);
  const styleProfile = objectOrEmpty(args.styleProfile);
  const assetSummary = frameAssetReferenceSummary(args.node || {}, args.creativeContext || {});
  return [
    '上一次没有得到可用 HTML。只返回一个完整 HTML document，不要解释。',
    `当前帧 id：${args.node?.id || ''}`,
    `目标尺寸：${resolution.width}x${resolution.height}`,
    validationMessage ? `上一次失败原因：${validationMessage}` : '',
    expectedHeadline ? `当前镜头核心标题：${expectedHeadline}` : '',
    frameText ? `当前镜头正文（提炼成关键词/短语再上画面，不要整句照抄）：${frameText}` : '',
    expectedTexts.length ? `当前镜头允许使用的内容文案：${expectedTexts.join(' / ')}` : '',
    '画面文字必须是提炼后的关键词、要点短语或数据点；禁止照抄旁白或字幕原句，旁白全文由系统注入底部字幕层。',
    ...assetFirstFrameRequirements(args.creativeContext),
    ...(args.creativeContext?.visual_strategy === 'asset_first' && (args.beat?.motion_overlay || args.sceneBeatsBrief)
      ? [buildAssetFirstFramePrompt({
        beat: args.beat || {},
        primitiveSnippet: args.primitiveSnippet || '',
        diagramSkeleton: args.diagramSkeleton || '',
        previousBeatSummary: args.previousBeatSummary || '',
        hasCaptions: args.hasCaptions !== false,
        sceneBeatsBrief: args.sceneBeatsBrief || '',
      })]
      : []),
    assetSummary ? `${assetSummary}\n必须引用上面的 src，图片用 object-fit: contain，并与文字说明混排。` : '',
    styleProfile?.id
      ? `视觉风格参考：遵循本任务 style_profile「${styleProfile.id}」；不要复用模板默认主体文案。`
      : '',
    `必须包含 body data-hv-canvas data-width="${resolution.width}" data-height="${resolution.height}"。`,
    `meta viewport、html/body 必须使用 ${resolution.width}x${resolution.height}；不能使用 ${resolution.height}x${resolution.width}。`,
    '必须包含 CSS @keyframes/animation、GSAP timeline 或 window.__hvPlayAll 至少一种 animation timeline。',
    '必须包含 data-text-key="headline"、data-text-key="subtitle"、data-text-key="body" 三类可见文本锚点。',
    'HTML skeleton：',
    '```html',
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=' + resolution.width + ',height=' + resolution.height + ',initial-scale=1.0"><style>html,body{margin:0;width:' + resolution.width + 'px;height:' + resolution.height + 'px;overflow:hidden}@keyframes enter{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}main{animation:enter .7s ease-out both}</style></head>',
    '<body data-hv-canvas data-width="' + resolution.width + '" data-height="' + resolution.height + '"><main><h1 data-text-key="headline">...</h1><p data-text-key="subtitle">...</p><section data-text-key="body">...</section></main></body>',
    '</html>',
    '```',
    '只返回一个完整 HTML document。',
  ].join('\n');
}

async function callModel(model, prompt, options = {}) {
  if (!model || typeof model.callTextModel !== 'function') {
    return { success: false, message: '未配置 HTML 生成模型。' };
  }
  const response = await model.callTextModel({
    ...objectOrEmpty(options),
    messages: [{ role: 'user', content: prompt }],
  });
  if (!response || response.success === false) {
    const message = response?.message || 'AI 调用失败。';
    return {
      success: false,
      message,
      ...(isProviderMissingTextMessage(message) ? { code: 'provider_missing_text' } : {}),
    };
  }
  const text = response.text || response.content || '';
  if (!String(text || '').trim()) {
    return { success: false, message: '模型返回结果缺少文本内容。', code: 'provider_missing_text' };
  }
  return { success: true, text };
}

function isProviderMissingTextMessage(message = '') {
  return /返回结果缺少文本内容|流式返回结果缺少文本内容|缺少文本/.test(String(message || ''));
}

function frameDiagnostic(code, message, args = {}, details = {}) {
  return createDiagnostic({
    code,
    stage: 'ai-frame-html',
    sub_stage: 'frame_html',
    frame_id: args.node?.id || '',
    retryable: true,
    repair_action: 'retry_frame_html',
    user_message: message,
    details,
  });
}

function frameFailure(code, message, args = {}, details = {}) {
  const result = {
    success: false,
    code,
    message,
    diagnostics: [frameDiagnostic(code, message, args, details)],
  };
  if (details.failed_html) result.failed_html = details.failed_html;
  return result;
}

function htmlRetryFailureMessage(retry = {}) {
  const retryProviderMissing = retry.code === 'provider_missing_text' || isProviderMissingTextMessage(retry.message || '');
  if (retryProviderMissing) return '首版 HTML 文档提取失败；修复重试时模型返回空内容。';
  return retry.message
    ? `首版 HTML 文档提取失败；修复重试失败：${retry.message}`
    : '首版 HTML 文档提取失败；修复重试仍未返回完整 HTML。';
}

function withRepairAudit(options = {}, repairAttempt = 1) {
  const audit = objectOrEmpty(options.audit);
  if (!audit.agent && !audit.stage) return options;
  return {
    ...options,
    audit: {
      ...audit,
      repair_attempt: repairAttempt,
    },
  };
}

function validationFailureMessage(validationMessage, retry = {}) {
  const retryProviderMissing = retry.code === 'provider_missing_text' || isProviderMissingTextMessage(retry.message || '');
  const retryMessage = retry.message || '';
  return [
    `首版 HTML 未通过校验：${validationMessage || 'HTML 内容校验失败。'}`,
    retryProviderMissing
      ? '修复重试时模型返回空内容。'
      : (retryMessage ? `修复重试仍未返回可用 HTML：${retryMessage}` : ''),
  ].filter(Boolean).join('；');
}

function validationFailureDetails(validation = {}, retry = {}, failedHtml = '', extra = {}) {
  const retryProviderMissing = retry.code === 'provider_missing_text' || isProviderMissingTextMessage(retry.message || '');
  return {
    ...(validation.details || {}),
    validation_code: validation.details?.validation_code || validation.code || 'html_validation_failed',
    validation_message: validation.message || '',
    retry_message: retry.message || '',
    ...(retryProviderMissing ? { retry_provider_missing_text: true } : {}),
    ...extra,
    ...(failedHtml ? { failed_html: failedHtml } : {}),
  };
}

async function generateFrameHtml({
  model,
  frameId,
  attempt = 1,
  modelOptions = {},
  shortPrompt = false,
  ...args
} = {}) {
  const callOptions = attempt >= 2 ? { ...modelOptions, stream: false } : modelOptions;
  const promptArgs = {
    ...args,
    frameId,
    node: {
      ...objectOrEmpty(args.node),
      ...(frameId ? { id: args.node?.id || frameId } : {}),
    },
  };
  const firstPrompt = shortPrompt ? buildShortFrameHtmlPrompt(promptArgs) : buildFrameHtmlPrompt(promptArgs);
  const first = await callModel(model, firstPrompt, callOptions);
  if (!first.success) {
    return frameFailure(first.code || 'frame_html_invalid', first.message || '单帧 HTML 生成失败。', promptArgs);
  }
  const allowInternalRetry = attempt < 2 && shortPrompt !== true;
  const firstExtracted = extractHtmlDocument(first.text);
  if (firstExtracted.success) {
    const targetValidation = validateHtmlTargetResolution(firstExtracted.html, promptArgs.target || {});
    const normalizedHtml = normalizeHtmlCanvasContract(firstExtracted.html, promptArgs.target || {});
    const validation = targetValidation.success
      ? validateGeneratedHtml(normalizedHtml, promptArgs)
      : targetResolutionValidationFailure(targetValidation);
    if (validation.success) return { ...firstExtracted, html: normalizedHtml, diagnostics: validation.diagnostics || [] };
    if (!allowInternalRetry) {
      return frameFailure(validation.code || 'frame_html_invalid', validation.message || '单帧 HTML 内容校验失败。', promptArgs, {
        ...(validation.details || {}),
        failed_html: normalizedHtml,
      });
    }
    const retry = await callModel(model, buildRetryPrompt({
      ...promptArgs,
      validationMessage: validation.message,
    }), withRepairAudit(callOptions, 1));
    if (!retry.success) {
      return frameFailure('html_validation_failed', validationFailureMessage(validation.message, retry), promptArgs, validationFailureDetails(validation, retry, normalizedHtml, {
        diagnostics: [validation.message, retry.message].filter(Boolean),
      }));
    }
    const retryExtracted = extractHtmlDocument(retry.text);
    if (!retryExtracted.success) {
      return frameFailure('html_validation_failed', validationFailureMessage(validation.message, retryExtracted), promptArgs, validationFailureDetails(validation, retryExtracted, normalizedHtml, {
        diagnostics: [validation.message, retryExtracted.message].filter(Boolean),
      }));
    }
    const retryTargetValidation = validateHtmlTargetResolution(retryExtracted.html, promptArgs.target || {});
    const retryHtml = normalizeHtmlCanvasContract(retryExtracted.html, promptArgs.target || {});
    const retryValidation = retryTargetValidation.success
      ? validateGeneratedHtml(retryHtml, promptArgs)
      : targetResolutionValidationFailure(retryTargetValidation);
    if (retryValidation.success) return { ...retryExtracted, html: retryHtml, diagnostics: retryValidation.diagnostics || [] };
    return frameFailure(retryValidation.code || 'html_validation_failed', retryValidation.message || '单帧 HTML 内容校验失败。', promptArgs, {
      diagnostics: [validation.message, retryValidation.message].filter(Boolean),
      ...(retryValidation.details || {}),
      failed_html: retryHtml,
    });
  }

  if (!allowInternalRetry) {
    return frameFailure(firstExtracted.code || 'html_document_extract_failed', firstExtracted.message || 'AI 未返回完整 HTML document。', promptArgs);
  }
  const retry = await callModel(model, buildRetryPrompt(promptArgs), withRepairAudit(callOptions, 1));
  if (!retry.success) {
    return frameFailure('html_document_extract_failed', htmlRetryFailureMessage(retry), promptArgs, {
      diagnostics: [firstExtracted.message, retry.message].filter(Boolean),
      ...(retry.code === 'provider_missing_text' || isProviderMissingTextMessage(retry.message) ? { retry_provider_missing_text: true } : {}),
    });
  }
  const retryExtracted = extractHtmlDocument(retry.text);
  if (retryExtracted.success) {
    const retryTargetValidation = validateHtmlTargetResolution(retryExtracted.html, promptArgs.target || {});
    const retryHtml = normalizeHtmlCanvasContract(retryExtracted.html, promptArgs.target || {});
    const retryValidation = retryTargetValidation.success
      ? validateGeneratedHtml(retryHtml, promptArgs)
      : targetResolutionValidationFailure(retryTargetValidation);
    if (retryValidation.success) return { ...retryExtracted, html: retryHtml, diagnostics: retryValidation.diagnostics || [] };
    return frameFailure(retryValidation.code || 'html_validation_failed', retryValidation.message || '单帧 HTML 内容校验失败。', promptArgs, {
      diagnostics: [firstExtracted.message, retryValidation.message].filter(Boolean),
      ...(retryValidation.details || {}),
      failed_html: retryHtml,
    });
  }
  return frameFailure(retryExtracted.code || 'html_document_extract_failed', retryExtracted.message || 'AI 未返回完整 HTML document。', promptArgs, {
    diagnostics: [firstExtracted.message, retryExtracted.message].filter(Boolean),
    ...(retryExtracted.code === 'provider_missing_text' ? { retry_provider_missing_text: true } : {}),
  });
}

module.exports = {
  buildFrameHtmlPrompt,
  buildShortFrameHtmlPrompt,
  buildAssetFirstFramePrompt,
  extractHtmlDocument,
  generateFrameHtml,
  callModel,
  buildRetryPrompt,
  frameAssetReferenceSummary,
  resolveResolution,
  validateFrameAssetUsage,
  validateHtmlTargetResolution,
  validateHtmlContentQuality,
};
