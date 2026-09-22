const CANVAS_FORMATS = require('../../../resources/whiteboard/canvas-formats.json');
const LANGUAGES = [
  { id: 'zh-CN', label: '简体中文' }, { id: 'en-US', label: '英语（美国）' }, { id: 'en-GB', label: '英语（英国）' },
];
const DEFAULT_PRODUCTION_SETTINGS = Object.freeze(require('../../../resources/creative/production-defaults.json'));

class ProductionError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function canvasFor(aspectRatio = '16:9') {
  const format = CANVAS_FORMATS.find(item => item.id === aspectRatio);
  if (!format) throw new ProductionError('INVALID_INPUT', '画幅仅支持横屏 16:9、竖屏 9:16 和横屏 4:3。');
  return { width: format.width, height: format.height };
}

function subtitleStyleFor(plan = {}, aspectRatio = '16:9') {
  const color = plan.subtitleColor === undefined ? '#FFFFFF' : plan.subtitleColor;
  const fontSize = plan.subtitleFontSize ?? (aspectRatio === '9:16' ? 52 : 48);
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
    throw new ProductionError('INVALID_INPUT', '字幕颜色需为六位十六进制颜色，例如 #FFFFFF。');
  }
  if (!Number.isInteger(fontSize) || fontSize < 24 || fontSize > 96) {
    throw new ProductionError('INVALID_INPUT', '字幕字号需为 24–96 像素的整数，留空使用默认字号。');
  }
  return { color: color.toUpperCase(), fontSize };
}

function normalizeProductionSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProductionError('INVALID_INPUT', '制作设置格式无效。');
  const result = { ...DEFAULT_PRODUCTION_SETTINGS };
  for (const key of Object.keys(result)) if (value[key] !== undefined) result[key] = value[key];
  canvasFor(result.aspectRatio);
  if (!Number.isInteger(result.targetDurationSeconds) || result.targetDurationSeconds < 15 || result.targetDurationSeconds > 600) {
    throw new ProductionError('INVALID_INPUT', '目标时长必须是 15–600 秒的整数。');
  }
  if (!LANGUAGES.some(item => item.id === result.narrationLanguage)) throw new ProductionError('INVALID_INPUT', '请选择简体中文、美国英语或英国英语。');
  if (!['enabled', 'disabled'].includes(result.narrationMode) || !['enabled', 'disabled'].includes(result.bgmMode)
    || typeof result.burnSubtitles !== 'boolean') throw new ProductionError('INVALID_INPUT', '请检查配音、BGM 和字幕烧录开关。');
  result.subtitleColor = subtitleStyleFor(result, result.aspectRatio).color;
  result.subtitleFontSize ??= null;
  return result;
}

module.exports = { ProductionError, CANVAS_FORMATS, LANGUAGES, DEFAULT_PRODUCTION_SETTINGS, canvasFor, subtitleStyleFor, normalizeProductionSettings };
