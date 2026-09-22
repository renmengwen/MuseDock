const crypto = require('crypto');
const shared = require('../shared/productionSettings');
const { letters, splitCaption } = require('../shared/captionLayout');
const STYLES = require('../../../resources/creative/illustrated-presets.json');
const TRACKS = require('../../../resources/creative/motion-tracks.json');

const MODE = 'illustrated-narration-v1';
const RENDER_VERSION = 'illustrated-ffmpeg-25fps-v2';
const MOTION_VERSION = 'smoothstep-crop-v1';
const FPS = 25;
const ErrorType = shared.ProductionError;
const DEFAULT_MOTION = {
  mode: 'random', track: 'zoom_in', amount: 6, easing: 'smooth',
  pool: TRACKS.filter(track => track.id !== 'still').map(track => track.id), fadeMs: 250,
};
const STAGES = [
  ['content_plan', '文稿与分镜'], ['plan_review', '确认方案'], ['narration', '配音与时间轴'],
  ['audio_review', '确认实际时长'], ['images', '图片与运动'], ['preview', '动态预览'], ['export', '导出视频'],
].map(([id, label]) => ({ id, label }));

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function hash(value) { return crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex'); }
function fail(message, code = 'INVALID_INPUT', status = 400) { throw new ErrorType(code, message, status); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + '格式无效。');
  return value;
}
function text(value, label, max, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) fail(label + '不能为空且不能超过 ' + max + ' 个字符。');
  return value.replace(/\r\n?/g, '\n').trim();
}

function normalizeMotion(value = {}, previous = DEFAULT_MOTION) {
  object(value, '运动设置');
  const result = { ...DEFAULT_MOTION, ...previous, ...value };
  if (!['off', 'uniform', 'random'].includes(result.mode)) fail('请选择关闭、统一轨迹或每张图片随机。');
  if (!TRACKS.some(item => item.id === result.track)) fail('请选择有效的运动轨迹。');
  if (!['linear', 'smooth'].includes(result.easing)) fail('请选择匀速或缓入缓出。');
  if (!Number.isFinite(result.amount) || result.amount < 0 || result.amount > 20) fail('运动幅度需在 0–20% 之间。');
  if (result.track !== 'still' && result.amount === 0) result.amount = previous.amount > 0 ? previous.amount : 6;
  if (!Array.isArray(result.pool) || !result.pool.length || result.pool.some(id => !TRACKS.some(item => item.id === id && id !== 'still'))) fail('随机池至少选择一种非静止轨迹。');
  result.pool = [...new Set(result.pool)];
  if (![0, 250, 500].includes(result.fadeMs)) fail('统一淡入淡出仅支持关闭、250 毫秒或 500 毫秒。');
  return { mode: result.mode, track: result.track, amount: result.amount, easing: result.easing, pool: result.pool, fadeMs: result.fadeMs };
}

function normalizeSettings(value = {}) {
  object(value, '制作设置');
  const common = shared.normalizeProductionSettings(value);
  const stylePreset = value.stylePreset ?? 'none';
  const style = STYLES.find(item => item.id === stylePreset);
  if (!style) fail('请选择有效的生图风格。');
  const density = value.density ?? 'standard';
  if (!['relaxed', 'standard', 'compact'].includes(density)) fail('请选择舒缓、标准或紧凑画面密度。');
  return { ...common, stylePreset, style: structuredClone(style), customStyle: text(value.customStyle ?? '', '自定义画面要求', 4000, true),
    density, motion: normalizeMotion(value.motion) };
}

function normalizeInput(value = {}) {
  object(value, '创作输入');
  const inputMode = value.inputMode ?? 'topic';
  if (!['topic', 'text'].includes(inputMode)) fail('请选择主题或正文输入。');
  const rewritePolicy = inputMode === 'topic' ? 'generate' : (value.rewritePolicy ?? 'preserve');
  if (!['generate', 'preserve', 'polish'].includes(rewritePolicy) || (inputMode === 'text' && rewritePolicy === 'generate')) fail('正文请选择保留原文或润色口播。');
  const referenceRole = value.referenceRole ?? 'facts';
  if (!['facts', 'expression'].includes(referenceRole)) fail('参考文本请选择内容资料或表达方式参考。');
  if (value.useResearch !== undefined && typeof value.useResearch !== 'boolean') fail('联网开关无效。');
  return {
    inputMode, content: text(value.content, '创作内容', 50000), rewritePolicy,
    referenceText: text(value.referenceText ?? '', '参考文本', 40000, true), referenceRole,
    useResearch: value.useResearch === true, title: text(value.title ?? '', '作品标题', 120, true),
  };
}

const PLAN_SKELETON = {
  title: '作品标题', summary: '叙事安排与事实来源说明',
  scenes: [{ id: 'scene_1', title: '画面标题', text: '这一幕的完整旁白或字幕正文', visualIntent: '这一幕要表达的意思',
    imagePrompt: '独立完整的主体、环境、构图描述', negativePrompt: '不需要的元素', weight: 1 }],
};
function normalizePlan(value, input, { generated = false } = {}) {
  object(value, '文稿与分镜');
  const title = text(value.title, '作品标题', 120);
  const summary = text(value.summary ?? '', '方案摘要', 4000, true);
  if (!Array.isArray(value.scenes) || !value.scenes.length || value.scenes.length > 80) fail('分镜需包含 1–80 幕。');
  const ids = new Set();
  const scenes = value.scenes.map((item, index) => {
    object(item, '分镜');
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(item.id) || ids.has(item.id)) fail('分镜身份无效或重复，请刷新后重试。');
    ids.add(item.id);
    const weight = item.weight ?? 1;
    if (!Number.isFinite(weight) || weight < 0.25 || weight > 4) fail('分镜时长权重需在 0.25–4 之间。');
    const scene = { id: item.id, title: text(item.title || ('分镜 ' + (index + 1)), '分镜标题', 120),
      text: text(item.text, '分镜文稿', 10000), visualIntent: text(item.visualIntent ?? '', '画面意图', 2000, true),
      imagePrompt: text(item.imagePrompt, '图片提示词', 6000), negativePrompt: text(item.negativePrompt ?? '', '图片负向提示词', 3000, true), weight };
    if (!letters(scene.text).length) fail('分镜文稿需要包含可朗读或阅读的文字。');
    return scene;
  });
  const narrationText = scenes.map(scene => scene.text).join('\n');
  if (narrationText.length > 50000) fail('完整文稿不能超过 50000 个字符。');
  if (generated && input.inputMode === 'text' && input.rewritePolicy === 'preserve'
    && narrationText.replace(/\s/gu, '') !== input.content.replace(/\s/gu, '')) fail('保留原文模式不得改写、增删或重排正文。', 'PLAN_INVALID');
  const result = { title, summary, scenes };
  return { ...result, identity: hash(result), narrationText };
}

function sceneContentIdentity(scene) {
  return hash({ text: scene.text, visualIntent: scene.visualIntent, imagePrompt: scene.imagePrompt, negativePrompt: scene.negativePrompt });
}
function imageIdentity(scene, settings) {
  return hash({ scene: sceneContentIdentity(scene), style: settings.style, customStyle: settings.customStyle });
}
function imagePrompt(scene, settings) {
  const canvas = shared.canvasFor(settings.aspectRatio);
  return [
    '根据画面描述创作一张完整配图，画面不要出现尺寸标记、水印、视频播放器或设备边框。',
    '画幅 ' + settings.aspectRatio + '，输出目标 ' + canvas.width + '×' + canvas.height + '。保持比例，不拉伸。',
    '主体和关键文字保留至少 12% 边缘安全区，底部 18% 避免重要内容，预留字幕和轻微裁切。',
    settings.style.description ? '画风：' + settings.style.description : '',
    settings.customStyle ? '用户补充：' + settings.customStyle : '',
    '画面意图：' + scene.visualIntent, '具体画面：' + scene.imagePrompt,
    scene.negativePrompt ? '避免：' + scene.negativePrompt : '',
  ].filter(Boolean).join('\n');
}

function assignMotion(config, old = null, { force = false, previousTrack = '', random = crypto.randomInt } = {}) {
  if (old?.locked) return old;
  if (old && !force) return old;
  let track = config.mode === 'off' ? 'still' : config.track;
  if (config.mode === 'random') {
    let pool = config.pool.filter(id => id !== previousTrack && id !== old?.track);
    if (!pool.length) pool = config.pool.filter(id => id !== old?.track);
    if (!pool.length) pool = config.pool;
    track = pool[random(pool.length)];
  }
  return resolvedMotion({ track, amount: config.amount, easing: config.easing, locked: false, override: false, revision: (old?.revision || 0) + 1 });
}
function resolvedMotion(value, previous = {}) {
  const track = value.track ?? previous.track ?? 'zoom_in';
  if (!TRACKS.some(item => item.id === track)) fail('请选择有效运动轨迹。');
  let amount = value.amount ?? previous.amount ?? 6;
  if (!Number.isFinite(amount) || amount < 0 || amount > 20) fail('运动幅度需在 0–20% 之间。');
  if (track !== 'still' && amount === 0) amount = previous.amount > 0 ? previous.amount : 6;
  const easing = value.easing ?? previous.easing ?? 'smooth';
  if (!['linear', 'smooth'].includes(easing)) fail('运动节奏无效。');
  const direction = TRACKS.find(item => item.id === track);
  const zoom = 1 + amount / 100;
  const start = { zoom: track === 'zoom_out' || direction.kind === 'pan' ? zoom : 1, x: 0.5, y: 0.5 };
  const end = { zoom: track === 'zoom_in' || direction.kind === 'pan' ? zoom : 1, x: 0.5, y: 0.5 };
  // dx/dy 描述图片在屏幕上的位移；裁切窗口朝相反方向移动。
  if (direction.dx) { start.x = direction.dx > 0 ? 1 : 0; end.x = 1 - start.x; }
  if (direction.dy) { start.y = direction.dy > 0 ? 1 : 0; end.y = 1 - start.y; }
  return { version: MOTION_VERSION, track, amount, easing, locked: value.locked ?? previous.locked ?? false,
    override: value.override ?? previous.override ?? true, revision: value.revision ?? (previous.revision || 0) + 1,
    start, end };
}
function motionIdentity(motion) {
  const { revision, locked, override, ...rendered } = motion;
  return hash(rendered);
}
function readingBudget(scene, settings) {
  return splitCaption(scene.text, settings.narrationLanguage, settings.aspectRatio, shared.subtitleStyleFor(settings, settings.aspectRatio).fontSize)
    .reduce((sum, part) => sum + Math.max(500, Math.ceil(letters(part).length * 1000 / (settings.narrationLanguage === 'zh-CN' ? 10 : 20))), 0);
}
function catalog() {
  return { styles: structuredClone(STYLES), tracks: structuredClone(TRACKS), languages: shared.LANGUAGES,
    canvasFormats: shared.CANVAS_FORMATS, defaults: normalizeSettings(), fps: FPS, renderVersion: RENDER_VERSION,
    densities: [{ id: 'relaxed', label: '舒缓', description: '较少画面，留出思考时间' }, { id: 'standard', label: '标准', description: '按叙事自然换图' }, { id: 'compact', label: '紧凑', description: '更多画面，适合信息密集内容' }] };
}

module.exports = { ...shared, MODE, FPS, RENDER_VERSION, MOTION_VERSION, DEFAULT_MOTION, STAGES, STYLES, TRACKS,
  ErrorType, fail, hash, canonical, object, text, normalizeSettings, normalizeInput, normalizePlan, normalizeMotion, PLAN_SKELETON,
  sceneContentIdentity, imageIdentity, imagePrompt, assignMotion, resolvedMotion, motionIdentity, readingBudget, catalog };
