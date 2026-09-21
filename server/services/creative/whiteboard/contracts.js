const crypto = require('crypto');
const CANVAS_FORMATS = require('../../../resources/whiteboard/canvas-formats.json');
const HANDWRITTEN_PRESET_ID = 'whiteboard-handwritten-explainer-v1';
const handwrittenPreset = require('../../../resources/whiteboard/visual-presets.json').presets.find(item => item.id === HANDWRITTEN_PRESET_ID);

const CONTRACT_VERSION = 'musedock-whiteboard-phase0-v1';
// 上游路由规则的来源指纹；运行时只消费本仓库合同，不读取 Codex Skill 路径。
const SKILL_SOURCE_REVISION = 'sha256:08c007f42ce65edbbe823fcdd4eeec628e7f28b819aaf30f2275d8db05ab8ebd';
const VISUAL_PRESETS = [
  { id: 'warm-paper-minimal-v1', displayName: '暖米黄极简粗线', description: '粗黑轮廓，少量平涂，适合通用知识和流程说明。' },
  { id: 'warm-pencil-v1', displayName: '暖米黄铅笔素描', description: '石墨轮廓与克制排线，适合人物故事和历史回顾。' },
  { id: 'guofeng-flat-paper-v1', displayName: '粗线扁平国风', description: '现代国风造型，适合传统文化与东方哲思。' },
  { id: 'healing-journal-v1', displayName: '清新治愈手账', description: '柔和手绘与低饱和色彩，适合生活和成长叙事。' },
  { id: 'retro-newspaper-v1', displayName: '复古报纸拼贴', description: '油墨轮廓和局部拼贴，适合社会观察与人物纪实。' },
  { id: 'comic-ink-v1', displayName: '漫画墨线解释', description: '有变化的漫画墨线，适合机制解释与科技科普。' },
  { ...handwrittenPreset, promptRecipeSha256: sha256(handwrittenPreset.promptRecipe) },
];
const DEFAULT_PRESET = VISUAL_PRESETS[0].id;
const LANGUAGES = [{ id: 'zh-CN', label: '简体中文' }, { id: 'en-US', label: '英语（美国）' }, { id: 'en-GB', label: '英语（英国）' }];
const DEFAULT_PRODUCTION_PLAN = {
  bgmMode: 'disabled', handDisplayMode: 'show', agentApprovalEnabled: false,
  imageGenerationMode: 'per_scene', burnSubtitles: true,
  narrationMode: 'enabled', subtitleColor: '#FFFFFF', subtitleFontSize: null,
};

class WhiteboardError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function canvasFor(aspectRatio = '16:9') {
  const format = CANVAS_FORMATS.find(item => item.id === aspectRatio);
  if (!format) throw new WhiteboardError('INVALID_INPUT', `白板画幅仅支持${CANVAS_FORMATS.map(item => item.label).join('、')}。`);
  return { width: format.width, height: format.height };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WhiteboardError('INVALID_INPUT', `${label}格式无效。`);
}

function rejectExtraKeys(value, keys, label) {
  const extras = Object.keys(value).filter(key => !keys.includes(key));
  if (extras.length) throw new WhiteboardError('INVALID_INPUT', `${label}含有不支持的字段。`);
}

function parseSrt(content) {
  const blocks = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n/);
  if (blocks.length > 400) throw new WhiteboardError('INVALID_SRT', 'SRT 最多支持 400 条字幕，请拆分后再创建。');
  let lastEnd = 0;
  return blocks.map((block, index) => {
    const lines = block.split('\n');
    const match = /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3}) --> (\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/.exec(lines[1] || '');
    const text = lines.slice(2).join('\n').trim();
    if (Number(lines[0]) !== index + 1 || !match || !text) throw new WhiteboardError('INVALID_SRT', `第 ${index + 1} 条字幕格式无效，请使用连续序号和 HH:MM:SS,mmm 时间码。`);
    const ms = offset => ((Number(match[offset]) * 3600 + Number(match[offset + 1]) * 60 + Number(match[offset + 2])) * 1000 + Number(match[offset + 3]));
    const startMs = ms(1);
    const endMs = ms(5);
    if (endMs <= startMs || startMs < lastEnd) throw new WhiteboardError('INVALID_SRT', `第 ${index + 1} 条字幕时间倒序或与上一条重叠，请检查后重试。`);
    lastEnd = endMs;
    return { id: `cue_${index + 1}`, text, startMs, endMs };
  });
}

function subtitleStyleFor(plan = {}, aspectRatio = '16:9') {
  const color = plan.subtitleColor === undefined ? '#FFFFFF' : plan.subtitleColor;
  const fontSize = plan.subtitleFontSize ?? (aspectRatio === '9:16' ? 52 : 48);
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
    throw new WhiteboardError('INVALID_INPUT', '字幕颜色需为六位十六进制颜色，例如 #FFFFFF。');
  }
  if (!Number.isInteger(fontSize) || fontSize < 24 || fontSize > 96) {
    throw new WhiteboardError('INVALID_INPUT', '字幕字号需为 24–96 像素的整数，留空使用默认字号。');
  }
  return { color: color.toUpperCase(), fontSize };
}

function normalizeProductionPlan(value = {}) {
  assertObject(value, '制作设置');
  rejectExtraKeys(value, Object.keys(DEFAULT_PRODUCTION_PLAN), '制作设置');
  const plan = { ...DEFAULT_PRODUCTION_PLAN, ...value };
  if (!['disabled', 'enabled'].includes(plan.bgmMode)) throw new WhiteboardError('INVALID_INPUT', '请选择使用 BGM 或不使用 BGM。');
  if (!['show', 'hide'].includes(plan.handDisplayMode)
    || typeof plan.agentApprovalEnabled !== 'boolean' || plan.imageGenerationMode !== 'per_scene'
    || !['enabled', 'disabled'].includes(plan.narrationMode)
    || typeof plan.burnSubtitles !== 'boolean') {
    throw new WhiteboardError('INVALID_INPUT', '制作设置无效，请检查画笔、字幕和后续确认方式。');
  }
  plan.subtitleColor = subtitleStyleFor(plan).color;
  plan.subtitleFontSize ??= null;
  return plan;
}

function normalizeInput(value) {
  assertObject(value, '白板输入');
  rejectExtraKeys(value, ['inputMode', 'content', 'rewritePolicy', 'targetDurationSeconds', 'narrationLanguage', 'visualStylePreset', 'aspectRatio'], '白板输入');
  const inputMode = value.inputMode;
  if (!['topic', 'text', 'srt'].includes(inputMode)) throw new WhiteboardError('INVALID_INPUT', '请选择主题、正文或 SRT 字幕。');
  if (typeof value.content !== 'string' || !value.content.trim() || value.content.length > 50000) throw new WhiteboardError('INVALID_INPUT', '请输入创作内容，长度不能超过 50000 个字符。');
  const content = value.content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const narrationLanguage = value.narrationLanguage || 'zh-CN';
  const visualStylePreset = value.visualStylePreset || DEFAULT_PRESET;
  if (!LANGUAGES.some(item => item.id === narrationLanguage)) throw new WhiteboardError('INVALID_INPUT', '旁白语言仅支持简体中文、美国英语和英国英语。');
  if (!VISUAL_PRESETS.some(item => item.id === visualStylePreset)) throw new WhiteboardError('INVALID_INPUT', '请选择具体视觉模板，不能使用自动或未知模板。');
  const aspectRatio = value.aspectRatio ?? '16:9';
  canvasFor(aspectRatio);
  const normalized = { inputMode, content, narrationLanguage, visualStylePreset, aspectRatio };
  if (inputMode === 'srt') {
    if (value.rewritePolicy != null || value.targetDurationSeconds != null) throw new WhiteboardError('INVALID_INPUT', 'SRT 使用原有字幕和时间轴，不接受改写策略或目标时长。');
    parseSrt(content);
  } else {
    const rewritePolicy = value.rewritePolicy || (inputMode === 'topic' ? 'generate' : 'preserve');
    if ((inputMode === 'topic' && rewritePolicy !== 'generate') || (inputMode === 'text' && !['preserve', 'polish'].includes(rewritePolicy))) throw new WhiteboardError('INVALID_INPUT', '主题仅支持生成；正文仅支持保留原文或润色。');
    const duration = value.targetDurationSeconds ?? 60;
    if (!Number.isInteger(duration) || duration < 15 || duration > 600) throw new WhiteboardError('INVALID_INPUT', '目标时长必须是 15–600 秒的整数。');
    Object.assign(normalized, { rewritePolicy, targetDurationSeconds: duration });
  }
  return normalized;
}

const CANDIDATE_SKELETON = {
  schemaVersion: 1, title: '作品标题', summary: '内容与分镜安排说明',
  cues: [{ id: 'cue_1', text: '完整旁白的一段原文' }],
  scenes: [{ id: 'scene_1', title: '分镜标题', cueIds: ['cue_1'], imagePrompt: '自包含的主体、动作、空间关系与画面构图描述' }],
};

const ID_SCHEMA = { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,39}$' };
const CANDIDATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: Object.keys(CANDIDATE_SKELETON),
  properties: {
    schemaVersion: { const: 1 }, title: { type: 'string', minLength: 1, maxLength: 120 },
    summary: { type: 'string', minLength: 1, maxLength: 2000 },
    cues: { type: 'array', minItems: 1, maxItems: 400, items: {
      type: 'object', additionalProperties: false, required: ['id', 'text'],
      properties: { id: ID_SCHEMA, text: { type: 'string', minLength: 1, maxLength: 3000 } },
    } },
    scenes: { type: 'array', minItems: 1, maxItems: 80, items: {
      type: 'object', additionalProperties: false, required: ['id', 'title', 'cueIds', 'imagePrompt'],
      properties: {
        id: ID_SCHEMA, title: { type: 'string', minLength: 1, maxLength: 120 },
        cueIds: { type: 'array', minItems: 1, items: ID_SCHEMA },
        imagePrompt: { type: 'string', minLength: 8, maxLength: 6000 },
      },
    } },
  },
};

function candidateContractFor(input) {
  if (input.visualStylePreset !== HANDWRITTEN_PRESET_ID) return { skeleton: CANDIDATE_SKELETON, schema: CANDIDATE_SCHEMA };
  const skeleton = structuredClone(CANDIDATE_SKELETON);
  skeleton.scenes[0].imageTexts = ['画面中需要逐字呈现的短句'];
  const schema = structuredClone(CANDIDATE_SCHEMA);
  const scene = schema.properties.scenes.items;
  scene.required.push('imageTexts');
  scene.properties.imageTexts = { type: 'array', maxItems: 24, items: { type: 'string', minLength: 1, maxLength: 80 } };
  return { skeleton, schema };
}

function renderingFor(visualStyle) {
  if (visualStyle?.id !== HANDWRITTEN_PRESET_ID) return null;
  if (visualStyle.rendererCompatibility !== handwrittenPreset.rendererCompatibility
    || canonicalJson(visualStyle.rendering) !== canonicalJson(handwrittenPreset.rendering)
    || typeof visualStyle.promptRecipe !== 'string' || sha256(visualStyle.promptRecipe) !== visualStyle.promptRecipeSha256) {
    throw new WhiteboardError('CONTRACT_UNSUPPORTED', '白底手写图解缺少有效的冻结模板参数，请重新确认制作方案。', 409);
  }
  return structuredClone(visualStyle.rendering);
}

function textTokens(text) {
  return String(text).match(/[\p{Script=Han}]|[\p{L}\p{N}]+|[^\s]/gu) || [];
}

function validateCandidate(candidate, input) {
  const errors = [];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return ['候选必须是 JSON 对象。'];
  const keys = (value, allowed, label) => {
    if (Object.keys(value).some(key => !allowed.includes(key))) errors.push(`${label}包含合同外字段。`);
  };
  keys(candidate, Object.keys(CANDIDATE_SKELETON), '候选');
  if (candidate.schemaVersion !== 1) errors.push('schemaVersion 必须为 1。');
  for (const key of ['title', 'summary']) {
    if (typeof candidate[key] !== 'string' || !candidate[key].trim() || candidate[key].length > (key === 'title' ? 120 : 2000)) errors.push(`${key} 必须是有效文本且不能过长。`);
  }
  const cues = Array.isArray(candidate.cues) ? candidate.cues : [];
  const scenes = Array.isArray(candidate.scenes) ? candidate.scenes : [];
  if (!cues.length || cues.length > 400) errors.push('cues 必须包含 1–400 条字幕。');
  if (!scenes.length || scenes.length > 80) errors.push('scenes 必须包含 1–80 幕。');
  const validId = id => typeof id === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(id);
  const cueIds = new Set();
  cues.forEach((cue, index) => {
    if (!cue || typeof cue !== 'object' || Array.isArray(cue)) { errors.push(`字幕 ${index + 1} 必须为对象。`); return; }
    keys(cue, ['id', 'text'], `字幕 ${index + 1}`);
    if (!validId(cue.id) || cueIds.has(cue.id)) errors.push(`字幕 ${index + 1} 的 id 无效或重复。`);
    cueIds.add(cue.id);
    if (typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 3000) errors.push(`字幕 ${index + 1} 文本无效或过长。`);
  });
  const sceneIds = new Set();
  const covered = [];
  scenes.forEach((scene, index) => {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) { errors.push(`分镜 ${index + 1} 必须为对象。`); return; }
    const handwritten = input.visualStylePreset === HANDWRITTEN_PRESET_ID;
    keys(scene, ['id', 'title', 'cueIds', 'imagePrompt', ...(handwritten ? ['imageTexts'] : [])], `分镜 ${index + 1}`);
    if (!validId(scene.id) || sceneIds.has(scene.id)) errors.push(`分镜 ${index + 1} 的 id 无效或重复。`);
    sceneIds.add(scene.id);
    if (typeof scene.title !== 'string' || !scene.title.trim() || scene.title.length > 120) errors.push(`分镜 ${index + 1} 缺少有效标题。`);
    if (!Array.isArray(scene.cueIds) || !scene.cueIds.length) errors.push(`分镜 ${index + 1} 必须引用字幕。`);
    else covered.push(...scene.cueIds);
    if (typeof scene.imagePrompt !== 'string' || scene.imagePrompt.trim().length < 8 || scene.imagePrompt.length > 6000 || /同上|沿用上一幕|参见上一幕/.test(scene.imagePrompt)) errors.push(`分镜 ${index + 1} 需要独立、完整的画面描述。`);
    if (handwritten && (!Array.isArray(scene.imageTexts) || scene.imageTexts.length > 24
      || scene.imageTexts.some(text => typeof text !== 'string' || !text.trim() || text.length > 80))) {
      errors.push(`分镜 ${index + 1} 的 imageTexts 必须列出需要逐字呈现的画内原文，最多 24 条、每条 1–80 字；无文字时用空数组。`);
    }
  });
  if (JSON.stringify(covered) !== JSON.stringify(cues.map(cue => cue?.id))) errors.push('分镜必须按顺序完整覆盖每条字幕，不能遗漏、重复或重排。');
  const narration = cues.map(cue => cue?.text || '').join('\n');
  if (narration.length > 50000) errors.push('旁白总长度不能超过 50000 字符。');
  if (input.inputMode === 'text' && input.rewritePolicy === 'preserve' && JSON.stringify(textTokens(narration)) !== JSON.stringify(textTokens(input.content))) errors.push('保留原文模式不得改写、增删或重排正文。');
  if (input.inputMode === 'srt') {
    const source = parseSrt(input.content);
    if (JSON.stringify(cues.map(cue => ({ id: cue?.id, text: cue?.text }))) !== JSON.stringify(source.map(({ id, text }) => ({ id, text })))) errors.push('SRT 字幕 id、文本和顺序必须与输入完全一致。');
  }
  return errors;
}

function materializeCandidate(candidate, input, productionPlan, narrationService = { configured: false, displayName: '未配置', contractHash: '' }) {
  const errors = validateCandidate(candidate, input);
  if (errors.length) throw new WhiteboardError('CANDIDATE_INVALID', errors.join('\n'));
  const sourceCues = input.inputMode === 'srt' ? parseSrt(input.content) : null;
  const durationMs = sourceCues ? sourceCues.at(-1).endMs : input.targetDurationSeconds * 1000;
  const totalWeight = candidate.cues.reduce((sum, cue) => sum + cue.text.length, 0);
  // 每条 cue 先分配 1ms，再按文字长度分配余量，避免极短 cue 舍入后变成零长度。
  const weightedDurationMs = durationMs - candidate.cues.length;
  let weight = 0;
  const cues = sourceCues || candidate.cues.map((cue, index) => {
    const startMs = index + Math.round(weightedDurationMs * weight / totalWeight);
    weight += cue.text.length;
    return { ...cue, startMs, endMs: index + 1 + Math.round(weightedDurationMs * weight / totalWeight) };
  });
  const byId = new Map(cues.map(cue => [cue.id, cue]));
  return {
    schemaVersion: 1, contractVersion: CONTRACT_VERSION,
    aspectRatio: input.aspectRatio || '16:9', canvas: canvasFor(input.aspectRatio),
    title: candidate.title.trim(), summary: candidate.summary.trim(),
    narrationText: cues.map(cue => cue.text).join('\n'), narrationLanguage: input.narrationLanguage,
    sourceTextSha256: sha256(input.content), timingKind: sourceCues ? 'source_srt' : 'provisional', durationMs,
    visualStyle: { rendererCompatibility: 'warm-paper-stream-v1', ...structuredClone(VISUAL_PRESETS.find(preset => preset.id === input.visualStylePreset)) },
    productionPlan: normalizeProductionPlan(productionPlan),
    narrationService,
    cues, scenes: candidate.scenes.map(scene => ({
      ...scene, startMs: byId.get(scene.cueIds[0]).startMs, endMs: byId.get(scene.cueIds.at(-1)).endMs,
    })),
  };
}

module.exports = {
  CONTRACT_VERSION, SKILL_SOURCE_REVISION, VISUAL_PRESETS, DEFAULT_PRESET, LANGUAGES, CANVAS_FORMATS, canvasFor,
  HANDWRITTEN_PRESET_ID, candidateContractFor, renderingFor, subtitleStyleFor,
  DEFAULT_PRODUCTION_PLAN, CANDIDATE_SKELETON, CANDIDATE_SCHEMA, WhiteboardError, canonicalJson, sha256,
  normalizeInput, normalizeProductionPlan, parseSrt, validateCandidate, materializeCandidate,
};
