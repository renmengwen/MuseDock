import STYLES from '../../../../../server/resources/creative/illustrated-presets.json';
import TRACKS from '../../../../../server/resources/creative/motion-tracks.json';
import {PRODUCTION_DEFAULTS,productionError} from '../shared/productionForm.js';

export const ILLUSTRATED_MODE='illustrated-narration-v1';
export {STYLES,TRACKS};
export const MOTION_DEFAULTS={mode:'random',track:'zoom_in',amount:6,easing:'smooth',pool:TRACKS.filter(item=>item.id!=='still').map(item=>item.id),fadeMs:250};
export function createIllustratedDraft(defaults={}) {
  let remembered={};
  try {remembered=JSON.parse(localStorage.getItem('musedock:illustrated-style')||'{}');}catch{}
  return {inputMode:'topic',contents:{topic:'',text:''},rewritePolicy:'preserve',referenceText:'',referenceRole:'facts',useResearch:true,title:'',
    settings:{...PRODUCTION_DEFAULTS,...defaults,stylePreset:STYLES.some(item=>item.id===remembered.stylePreset)?remembered.stylePreset:'none',
      customStyle:typeof remembered.customStyle==='string'?remembered.customStyle:'',density:'standard',motion:structuredClone(MOTION_DEFAULTS)}};
}
export function rememberStyle(draft) {
  try {localStorage.setItem('musedock:illustrated-style',JSON.stringify({stylePreset:draft.settings.stylePreset,customStyle:draft.settings.customStyle}));}catch{}
}
export function validateIllustratedDraft(draft) {
  const content=draft.contents[draft.inputMode]?.trim();
  if(!content) return '请输入主题或正文。';
  if(content.length>50000) return '创作内容不能超过 50000 个字符。';
  if(draft.referenceText.length>40000) return '参考文本不能超过 40000 个字符。';
  return productionError(draft.settings);
}
export function illustratedPayload(draft) {
  return {creationModeId:ILLUSTRATED_MODE,input:{inputMode:draft.inputMode,content:draft.contents[draft.inputMode].trim(),
    rewritePolicy:draft.inputMode==='topic'?'generate':draft.rewritePolicy,referenceText:draft.referenceText,referenceRole:draft.referenceRole,
    useResearch:draft.useResearch,title:draft.title},settings:{...draft.settings,targetDurationSeconds:Number(draft.settings.targetDurationSeconds)}};
}
export function durationLabel(ms) {
  const tenths=Math.round((ms||0)/100);
  return tenths<600?tenths/10+' 秒':Math.floor(tenths/600)+' 分 '+String((tenths%600)/10).padStart(2,'0')+' 秒';
}
export function downloadName(type) {return ({image:'图片',fragment:'运动片段',preview:'整片预览',narration:'完整旁白',subtitles:'字幕'})[type]||'媒体';}
