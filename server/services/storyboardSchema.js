const DEFAULT_TEMPLATE = 'ai_storyboard_cards';
const DEFAULT_STYLE = {
  visual_tone: '清晰、原创、适合短视频口播',
  palette: ['#101216', '#fe2c55', '#25f4ee'],
  motion: '轻微推进、重点词弹出',
};

const VISUAL_TYPE_ALLOWED = ['workflow', 'code_panel', 'ui_mockup', 'split_compare', 'concept_map', 'timeline', 'quote_burst', 'text_card', 'quote_card', 'step_card', 'contrast_card'];
const VISUAL_OBJECT_ALLOWED = ['node', 'connector', 'code', 'terminal', 'panel', 'button', 'field', 'metric', 'column', 'branch', 'milestone', 'badge', 'keyword', 'center', 'step'];
const VISUAL_MOTION_ALLOWED = ['stagger_reveal', 'draw_line', 'type_in', 'scan', 'pulse', 'slide_in', 'zoom_focus', 'highlight', 'float'];
const VISUAL_BEAT_EFFECT_ALLOWED = ['slide_up_reveal', 'draw_line', 'type_in', 'scan', 'pulse', 'slide_in', 'zoom_focus', 'highlight', 'float', 'glow_focus', 'check_on', 'progress_fill', 'caption_highlight'];
const VISUAL_DSL_TYPES = ['workflow', 'code_panel', 'ui_mockup', 'split_compare', 'concept_map', 'timeline', 'quote_burst'];
const VISUAL_OBJECT_TYPE_ALIASES = {
  badge_rotated: 'badge',
  browser_mockup: 'panel',
  chat_bubble: 'panel',
  circular_arrow: 'connector',
  code_panel: 'code',
  comparison_column: 'column',
  comparison_panel: 'panel',
  component_stack: 'panel',
  concept_node: 'node',
  connector_line: 'connector',
  diagonal_strike: 'connector',
  drop_zone: 'field',
  file_card: 'panel',
  file_chip: 'keyword',
  form_field: 'field',
  keyword_card: 'keyword',
  large_frame: 'panel',
  marker_block: 'badge',
  marker_strip: 'badge',
  mono_kicker: 'badge',
  mono_topbar: 'panel',
  pill_badge: 'badge',
  progress_bar: 'metric',
  quote_card: 'keyword',
  small_label: 'badge',
  spreadsheet_card: 'panel',
  stacked_cards: 'panel',
  stamp: 'badge',
  step_card: 'step',
  step_chain: 'step',
  thick_arrow: 'connector',
  timeline_node: 'milestone',
  timeline_row: 'milestone',
  tool_dashboard: 'panel',
  tool_panel: 'panel',
  typed_prompt: 'code',
  ui_box: 'panel',
  ui_form: 'panel',
  ui_panel: 'panel',
  vertical_rule: 'connector',
};

function roundTime(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(item => item !== undefined && item !== null) : [];
}

function sanitizeText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function pickAllowed(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeVisualObjectType(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return VISUAL_OBJECT_TYPE_ALIASES[text] || text;
}

function isKnownVisualObjectType(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return VISUAL_OBJECT_ALLOWED.includes(text) || Object.prototype.hasOwnProperty.call(VISUAL_OBJECT_TYPE_ALIASES, text);
}

function sanitizeShortText(value, fallback = '', maxLength = 18) {
  return sanitizeText(value, fallback).slice(0, maxLength);
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanCaptionText(value) {
  return String(value || '')
    .replace(/^(开头|片头|引子|导语|正文|主体|结尾|片尾|总结)\s*[:：]\s*/g, '')
    .replace(/^第[一二三四五六七八九十\d]+部分\s*[:：]\s*/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function splitTextUnits(text) {
  return cleanCaptionText(text)
    .split(/[，,、；;：:。“”"「」『』（）()【】\[\]\s]+/g)
    .map(item => item.trim())
    .filter(item => item && item.length >= 2);
}

function makeFallbackHeadline(text, sceneNumber) {
  const clean = cleanCaptionText(text);
  if (!clean) return `分镜 ${sceneNumber}`;
  const beforeColon = clean.split(/[：:]/)[0];
  const source = beforeColon && beforeColon.length >= 4 && beforeColon.length <= 18 ? beforeColon : clean;
  return source.slice(0, 18).replace(/[，,、；;。！？!?：:]$/g, '') || `分镜 ${sceneNumber}`;
}

function makeFallbackEmphasisWords(text, headline) {
  const seen = new Set();
  const words = [];
  const add = value => {
    const clean = cleanCaptionText(value)
      .replace(/^(你要先懂|要先懂|先懂|懂|比如|例如)/, '')
      .slice(0, 12);
    if (/^(以前|过去|现在).{0,6}(写代码|做项目|开发)$/.test(clean)) return;
    if (!clean || clean === headline || clean.length < 2 || seen.has(clean)) return;
    seen.add(clean);
    words.push(clean);
  };

  const units = splitTextUnits(text);
  const exampleIndex = units.findIndex(item => /^(比如|例如|你要先懂|要先懂|先懂|懂)/.test(item));
  if (exampleIndex >= 0) {
    units.slice(exampleIndex).forEach(add);
  }
  units.forEach(add);
  if (words.length < 3) {
    cleanCaptionText(text).split(/[、，,]/g).forEach(add);
  }

  return words.slice(0, 6);
}

function normalizeVisualObject(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const type = pickAllowed(normalizeVisualObjectType(source.type), VISUAL_OBJECT_ALLOWED, null);
  if (!type) return null;

  const object = { type };
  const id = sanitizeShortText(source.id, '', 48);
  const text = sanitizeShortText(source.text, '', 18);
  const role = sanitizeShortText(source.role, '', 32);
  const style = sanitizeShortText(source.style, '', 48);
  const stage = sanitizeShortText(source.stage, '', 24);
  const accent = sanitizeShortText(source.accent, '', 24);
  const from = sanitizeShortText(source.from, '', 48);
  const to = sanitizeShortText(source.to, '', 48);
  const code = sanitizeShortText(source.code, '', 160);

  if (id) object.id = id;
  if (text) object.text = text;
  if (role) object.role = role;
  if (style) object.style = style;
  if (stage) object.stage = stage;
  if (accent) object.accent = accent;
  if (from) object.from = from;
  if (to) object.to = to;
  if (code) object.code = code;

  return object;
}

function normalizeVisualBeat(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const effect = pickAllowed(source.effect, VISUAL_BEAT_EFFECT_ALLOWED, null);
  if (!effect) return null;

  return {
    at: clampNumber(source.at, 0, 0, 8),
    duration: clampNumber(source.duration, 0.32, 0.08, 3),
    target: sanitizeShortText(source.target, '', 48),
    effect,
    emphasis: sanitizeShortText(source.emphasis, '', 24),
    caption_block_id: sanitizeShortText(source.caption_block_id, '', 80),
  };
}

function normalizeCaptionSync(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const captionIndex = Number(source.caption_index);
  if (!Number.isFinite(captionIndex)) return null;
  const effect = pickAllowed(source.effect, VISUAL_BEAT_EFFECT_ALLOWED, 'caption_highlight');
  return {
    caption_index: captionIndex,
    caption_block_id: sanitizeShortText(source.caption_block_id, '', 80),
    target: sanitizeShortText(source.target, '', 48),
    effect,
  };
}

function normalizeVisualMotion(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const effect = pickAllowed(source.effect, VISUAL_MOTION_ALLOWED, null);
  if (!effect) return null;

  return {
    target: sanitizeShortText(source.target, '', 48),
    effect,
    delay: clampNumber(source.delay, 0, 0, 3),
  };
}

function makeFallbackVisualScene(scene = {}) {
  const emphasisWords = asArray(scene.emphasis_words)
    .map(item => sanitizeShortText(item, '', 18))
    .filter(Boolean);
  const headline = sanitizeShortText(scene.headline, '重点', 18);
  const words = emphasisWords.length ? emphasisWords : [headline];
  const objects = words.slice(0, 8).map((word, index) => ({
    id: `keyword-${index + 1}`,
    type: 'keyword',
    text: word,
    role: index === 0 ? 'primary' : 'supporting',
  }));

  return {
    composition: 'burst_center',
    objects,
    motion: [
      { target: 'keyword', effect: 'stagger_reveal', delay: 0 },
      { target: 'focus', effect: 'pulse', delay: 0.2 },
    ],
    beats: [
      { at: 0.12, duration: 0.36, target: 'focus', effect: 'zoom_focus', emphasis: 'primary' },
      { at: 0.42, duration: 0.32, target: 'keyword', effect: 'slide_up_reveal', emphasis: 'supporting' },
    ],
    caption_sync: [],
    focus: {
      text: headline,
      style: 'accent_pulse',
    },
  };
}

function getScenePhraseBlocks(scene = {}) {
  const captionIndexes = new Set(asArray(scene.caption_indexes).map(item => Number(item)).filter(Number.isFinite));
  const phraseBlocks = asArray(scene.phrase_captions).filter(block => captionIndexes.has(Number(block?.caption_index)));
  return phraseBlocks;
}

function applyCaptionBlockFallback(visualScene, scene = {}) {
  const phraseBlocks = getScenePhraseBlocks(scene);
  if (!phraseBlocks.length || !Array.isArray(visualScene.beats)) return visualScene;
  let blockIndex = 0;
  const beats = visualScene.beats.map(beat => {
    if (beat.caption_block_id) return beat;
    const block = phraseBlocks[blockIndex % phraseBlocks.length];
    blockIndex += 1;
    return {
      ...beat,
      caption_block_id: sanitizeShortText(block?.id, '', 80),
    };
  });
  const caption_sync = Array.isArray(visualScene.caption_sync)
    ? visualScene.caption_sync.map((sync, index) => {
      if (sync.caption_block_id) return sync;
      const block = phraseBlocks[index % phraseBlocks.length];
      return {
        ...sync,
        caption_block_id: sanitizeShortText(block?.id, '', 80),
      };
    })
    : visualScene.caption_sync;
  return {
    ...visualScene,
    beats,
    caption_sync,
  };
}

function normalizeVisualScene(scene = {}) {
  const fallback = makeFallbackVisualScene(scene);
  const source = scene.visual_scene && typeof scene.visual_scene === 'object' && !Array.isArray(scene.visual_scene)
    ? scene.visual_scene
    : {};
  const objects = asArray(source.objects).map(normalizeVisualObject).filter(Boolean).slice(0, 8);
  const motion = asArray(source.motion).map(normalizeVisualMotion).filter(Boolean).slice(0, 8);
  const beats = asArray(source.beats).map(normalizeVisualBeat).filter(Boolean).slice(0, 12);
  const captionSync = asArray(source.caption_sync).map(normalizeCaptionSync).filter(Boolean).slice(0, 12);
  const focusSource = source.focus && typeof source.focus === 'object' && !Array.isArray(source.focus)
    ? source.focus
    : {};
  const safeObjects = objects.length ? objects : fallback.objects;
  const safeMotion = motion.length ? motion : fallback.motion;
  const safeBeats = beats.length ? beats : fallback.beats;

  return applyCaptionBlockFallback({
    composition: sanitizeShortText(source.composition, fallback.composition, 48),
    objects: safeObjects,
    motion: safeMotion,
    beats: safeBeats,
    caption_sync: captionSync.length ? captionSync : fallback.caption_sync,
    focus: {
      text: sanitizeShortText(focusSource.text, fallback.focus.text, 18),
      style: sanitizeShortText(focusSource.style, fallback.focus.style, 48),
    },
  }, scene);
}

function normalizeCaption(caption) {
  const start = roundTime(caption?.start);
  const end = roundTime(caption?.end);
  return {
    index: Number(caption?.index),
    start,
    end,
    duration: roundTime(caption?.duration || end - start),
    text: sanitizeText(caption?.text),
  };
}

function normalizeCaptions(captions) {
  return asArray(captions)
    .map(normalizeCaption)
    .filter(item => Number.isFinite(item.index) && item.text && item.end > item.start)
    .sort((left, right) => left.index - right.index);
}

function makeFallbackScenes(captions) {
  const scenes = [];
  for (let index = 0; index < captions.length; index += 1) {
    const group = captions.slice(index, index + 1);
    const text = group.map(item => item.text).filter(Boolean).join(' ');
    const headline = makeFallbackHeadline(text, scenes.length + 1);
    scenes.push({
      index: scenes.length + 1,
      caption_indexes: group.map(item => item.index),
      headline,
      visual_type: 'text_card',
      layout: scenes.length % 2 === 0 ? 'center_focus' : 'split_emphasis',
      background_prompt: '原创抽象动态图文背景，不包含原视频画面',
      emphasis_words: makeFallbackEmphasisWords(text, headline),
    });
  }
  return scenes;
}

function buildScene(source, sceneCaptions, sceneIndex, phraseCaptions = []) {
  const start = sceneCaptions[0].start;
  const end = sceneCaptions[sceneCaptions.length - 1].end;
  const visualType = pickAllowed(source.visual_type, VISUAL_TYPE_ALLOWED, 'quote_burst');
  return {
    index: sceneIndex,
    caption_indexes: sceneCaptions.map(item => item.index),
    start,
    end,
    duration: roundTime(end - start),
    headline: sanitizeText(source.headline, sceneCaptions[0].text),
    visual_type: visualType,
    layout: sanitizeText(source.layout, sceneIndex % 2 === 1 ? 'center_focus' : 'split_emphasis'),
    background_prompt: sanitizeText(source.background_prompt, '原创抽象动态图文背景，不包含原视频画面'),
    emphasis_words: asArray(source.emphasis_words).map(item => String(item).trim()).filter(Boolean).slice(0, 6),
    captions: sceneCaptions,
    visual_scene: normalizeVisualScene({
      ...source,
      caption_indexes: sceneCaptions.map(item => item.index),
      phrase_captions: phraseCaptions,
      headline: sanitizeText(source.headline, sceneCaptions[0].text),
      visual_type: visualType,
      emphasis_words: asArray(source.emphasis_words).map(item => String(item).trim()).filter(Boolean).slice(0, 6),
    }),
  };
}

function normalizeStoryboard({ storyboard = {}, captions = [], phraseCaptions = [] } = {}) {
  const normalizedCaptions = normalizeCaptions(captions);
  const captionByIndex = new Map(normalizedCaptions.map(item => [item.index, item]));
  const used = new Set();
  const sourceScenes = asArray(storyboard.scenes).length
    ? asArray(storyboard.scenes)
    : makeFallbackScenes(normalizedCaptions);
  const scenes = [];

  for (const source of sourceScenes) {
    const indexes = asArray(source.caption_indexes)
      .map(item => Number(item))
      .filter(index => captionByIndex.has(index) && !used.has(index))
      .sort((left, right) => left - right);
    if (!indexes.length) continue;
    indexes.forEach(index => used.add(index));
    scenes.push(buildScene(source, indexes.map(index => captionByIndex.get(index)), scenes.length + 1, phraseCaptions));
  }

  const uncovered = normalizedCaptions.filter(caption => !used.has(caption.index));
  for (const fallback of makeFallbackScenes(uncovered)) {
    const sceneCaptions = fallback.caption_indexes.map(index => captionByIndex.get(index)).filter(Boolean);
    if (sceneCaptions.length) {
      scenes.push(buildScene(fallback, sceneCaptions, scenes.length + 1, phraseCaptions));
    }
  }

  return {
    status: scenes.length ? 'done' : 'failed',
    template: sanitizeText(storyboard.template, DEFAULT_TEMPLATE),
    style: {
      ...DEFAULT_STYLE,
      ...(storyboard.style && typeof storyboard.style === 'object' ? storyboard.style : {}),
    },
    scenes,
    message: scenes.length ? 'AI 分镜已生成。' : '分镜生成失败：没有可用字幕。',
    updated_at: new Date().toISOString(),
  };
}

function validateRawVisualDsl(scene, label, errors) {
  const visualType = sanitizeText(scene.visual_type);
  if (visualType && !VISUAL_TYPE_ALLOWED.includes(visualType)) errors.push(`${label} 画面类型不受支持。`);
  if (!VISUAL_DSL_TYPES.includes(visualType)) return;

  const visualScene = scene.visual_scene;
  const hasVisualScene = visualScene && typeof visualScene === 'object' && !Array.isArray(visualScene);
  if (!hasVisualScene) {
    errors.push(`${label} visual_scene 必须是对象。`);
    return;
  }

  if (!sanitizeText(visualScene.composition)) errors.push(`${label} visual_scene.composition 不能为空。`);
  const normalizedVisualScene = normalizeVisualScene(scene);
  if (!Array.isArray(normalizedVisualScene.objects) || normalizedVisualScene.objects.length === 0) {
    errors.push(`${label} visual_scene.objects 不能为空。`);
  } else if (visualScene.objects.some(item => {
    const type = item && typeof item === 'object' && !Array.isArray(item) ? item.type : null;
    return !isKnownVisualObjectType(type);
  })) {
    errors.push(`${label} visual_scene.objects 包含不受支持的对象类型。`);
  }

  if (!Array.isArray(normalizedVisualScene.motion) || normalizedVisualScene.motion.length === 0) {
    errors.push(`${label} visual_scene.motion 不能为空。`);
  } else if (Array.isArray(visualScene.motion) && visualScene.motion.length > 0 && visualScene.motion.some(item => {
    const effect = item && typeof item === 'object' && !Array.isArray(item) ? item.effect : null;
    return !VISUAL_MOTION_ALLOWED.includes(effect);
  })) {
    errors.push(`${label} visual_scene.motion 包含不受支持的动效。`);
  }

  if (Array.isArray(visualScene.beats) && visualScene.beats.some(item => {
    const effect = item && typeof item === 'object' && !Array.isArray(item) ? item.effect : null;
    return !VISUAL_BEAT_EFFECT_ALLOWED.includes(effect);
  })) {
    errors.push(`${label} visual_scene.beats 包含不受支持的编排动效。`);
  }
}

function validateStoryboardEditableInput({ storyboard = {}, captions = [] } = {}) {
  const normalizedCaptions = normalizeCaptions(captions);
  const captionIndexes = new Set(normalizedCaptions.map(item => item.index));
  const used = new Set();
  const errors = [];
  const scenes = asArray(storyboard.scenes);

  if (!scenes.length) errors.push('分镜不能为空。');

  scenes.forEach((scene, sceneIndex) => {
    const label = `分镜 ${sceneIndex + 1}`;
    const indexes = asArray(scene.caption_indexes).map(item => Number(item)).filter(Number.isFinite);
    validateRawVisualDsl(scene, label, errors);

    if (!indexes.length) errors.push(`${label} 必须至少引用一条字幕。`);
    indexes.forEach(index => {
      if (!captionIndexes.has(index)) errors.push(`${label} 引用了不存在的字幕 ${index}。`);
      if (used.has(index)) errors.push(`${label} 重复使用了字幕 ${index}。`);
      used.add(index);
    });

    if (!sanitizeText(scene.headline)) errors.push(`${label} 标题不能为空。`);
    if (!sanitizeText(scene.visual_type)) errors.push(`${label} 画面类型不能为空。`);
    if (!sanitizeText(scene.layout)) errors.push(`${label} 布局不能为空。`);
    if (!sanitizeText(scene.background_prompt)) errors.push(`${label} 背景提示不能为空。`);
  });

  return {
    success: errors.length === 0,
    errors,
  };
}

module.exports = {
  DEFAULT_TEMPLATE,
  DEFAULT_STYLE,
  VISUAL_TYPE_ALLOWED,
  VISUAL_OBJECT_ALLOWED,
  VISUAL_MOTION_ALLOWED,
  VISUAL_BEAT_EFFECT_ALLOWED,
  pickAllowed,
  sanitizeShortText,
  normalizeVisualObject,
  normalizeVisualMotion,
  normalizeVisualBeat,
  normalizeCaptionSync,
  makeFallbackVisualScene,
  normalizeVisualScene,
  normalizeStoryboard,
  validateStoryboardEditableInput,
  makeFallbackScenes,
};
