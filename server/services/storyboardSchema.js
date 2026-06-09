const DEFAULT_TEMPLATE = 'ai_storyboard_cards';
const DEFAULT_STYLE = {
  visual_tone: '清晰、原创、适合短视频口播',
  palette: ['#101216', '#fe2c55', '#25f4ee'],
  motion: '轻微推进、重点词弹出',
};

const VISUAL_TYPE_ALLOWED = ['workflow', 'code_panel', 'ui_mockup', 'split_compare', 'concept_map', 'timeline', 'quote_burst', 'text_card', 'quote_card', 'step_card', 'contrast_card'];
const VISUAL_OBJECT_ALLOWED = ['node', 'connector', 'code', 'terminal', 'panel', 'button', 'field', 'metric', 'column', 'branch', 'milestone', 'badge', 'keyword'];
const VISUAL_MOTION_ALLOWED = ['stagger_reveal', 'draw_line', 'type_in', 'scan', 'pulse', 'slide_in', 'zoom_focus', 'highlight', 'float'];

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
  const type = pickAllowed(source.type, VISUAL_OBJECT_ALLOWED, null);
  if (!type) return null;

  const object = { type };
  const id = sanitizeShortText(source.id, '', 48);
  const text = sanitizeShortText(source.text, '', 18);
  const role = sanitizeShortText(source.role, '', 32);
  const style = sanitizeShortText(source.style, '', 48);
  const from = sanitizeShortText(source.from, '', 48);
  const to = sanitizeShortText(source.to, '', 48);
  const code = sanitizeShortText(source.code, '', 160);

  if (id) object.id = id;
  if (text) object.text = text;
  if (role) object.role = role;
  if (style) object.style = style;
  if (from) object.from = from;
  if (to) object.to = to;
  if (code) object.code = code;

  return object;
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
    focus: {
      text: headline,
      style: 'accent_pulse',
    },
  };
}

function normalizeVisualScene(scene = {}) {
  const fallback = makeFallbackVisualScene(scene);
  const source = scene.visual_scene && typeof scene.visual_scene === 'object' && !Array.isArray(scene.visual_scene)
    ? scene.visual_scene
    : {};
  const objects = asArray(source.objects).map(normalizeVisualObject).filter(Boolean).slice(0, 8);
  const motion = asArray(source.motion).map(normalizeVisualMotion).filter(Boolean).slice(0, 8);
  const focusSource = source.focus && typeof source.focus === 'object' && !Array.isArray(source.focus)
    ? source.focus
    : {};

  if (!objects.length || !motion.length) return fallback;

  return {
    composition: sanitizeShortText(source.composition, fallback.composition, 48),
    objects,
    motion,
    focus: {
      text: sanitizeShortText(focusSource.text, fallback.focus.text, 18),
      style: sanitizeShortText(focusSource.style, fallback.focus.style, 48),
    },
  };
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

function buildScene(source, sceneCaptions, sceneIndex) {
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
      headline: sanitizeText(source.headline, sceneCaptions[0].text),
      visual_type: visualType,
      emphasis_words: asArray(source.emphasis_words).map(item => String(item).trim()).filter(Boolean).slice(0, 6),
    }),
  };
}

function normalizeStoryboard({ storyboard = {}, captions = [] } = {}) {
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
    scenes.push(buildScene(source, indexes.map(index => captionByIndex.get(index)), scenes.length + 1));
  }

  const uncovered = normalizedCaptions.filter(caption => !used.has(caption.index));
  for (const fallback of makeFallbackScenes(uncovered)) {
    const sceneCaptions = fallback.caption_indexes.map(index => captionByIndex.get(index)).filter(Boolean);
    if (sceneCaptions.length) {
      scenes.push(buildScene(fallback, sceneCaptions, scenes.length + 1));
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
  pickAllowed,
  sanitizeShortText,
  normalizeVisualObject,
  normalizeVisualMotion,
  makeFallbackVisualScene,
  normalizeVisualScene,
  normalizeStoryboard,
  validateStoryboardEditableInput,
  makeFallbackScenes,
};
