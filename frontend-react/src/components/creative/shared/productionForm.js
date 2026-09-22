import defaults from '../../../../../server/resources/creative/production-defaults.json';
import canvasFormats from '../../../../../server/resources/whiteboard/canvas-formats.json';

export const PRODUCTION_DEFAULTS = defaults;
export const CANVAS_FORMATS = canvasFormats;
export const LANGUAGES = [{id:'zh-CN',label:'简体中文'},{id:'en-US',label:'英语（美国）'},{id:'en-GB',label:'英语（英国）'}];
export function validateSubtitleSettings(plan = {}) {
  const color = plan.subtitleColor === undefined ? '#FFFFFF' : plan.subtitleColor;
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return '请选择有效的字幕颜色。';
  if (plan.subtitleFontSize != null && (!Number.isInteger(plan.subtitleFontSize) || plan.subtitleFontSize < 24 || plan.subtitleFontSize > 96)) return '字幕字号需为 24–96 像素的整数，留空使用默认字号。';
  return '';
}
export function subtitleStyle(plan = {}, aspectRatio = '16:9') {
  return {color:/^#[0-9a-f]{6}$/i.test(plan.subtitleColor || '') ? plan.subtitleColor.toUpperCase() : '#FFFFFF',
    fontSize:Number.isInteger(plan.subtitleFontSize) && plan.subtitleFontSize>=24 && plan.subtitleFontSize<=96 ? plan.subtitleFontSize : aspectRatio==='9:16'?52:48};
}
export function productionError(settings) {
  if(!CANVAS_FORMATS.some(item=>item.id===settings.aspectRatio)) return '请选择支持的视频画幅。';
  if(!Number.isInteger(Number(settings.targetDurationSeconds)) || Number(settings.targetDurationSeconds)<15 || Number(settings.targetDurationSeconds)>600) return '目标时长需为 15–600 秒的整数。';
  return validateSubtitleSettings(settings);
}
