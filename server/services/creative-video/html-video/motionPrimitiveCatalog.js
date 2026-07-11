const fs = require('fs');
const path = require('path');

const CAPTION_SAFE_BOTTOM_PX = 140;
const PRIMITIVES_DIR = path.join(__dirname, '..', '..', '..', 'templates', 'motion-primitives');

const MOTION_PRIMITIVES = {
  concept_card: {
    best_for: ['concept', 'definition', 'term'],
    placements: ['center_card', 'right_panel', 'left_panel'],
    max_items: 1,
    hml_reference: 'concept-spotlight',
  },
  key_marker: {
    best_for: ['point', 'quote', 'warning', 'summary'],
    placements: ['lower_third', 'right_panel'],
    max_items: 1,
    hml_reference: 'key-point-marker',
  },
  three_step_flow: {
    best_for: ['steps', 'process', 'path'],
    placements: ['side_panel', 'top_band'],
    max_items: 3,
    hml_reference: 'three-step-flow',
  },
  cause_chain: {
    best_for: ['why', 'mechanism', 'result'],
    placements: ['center_band', 'right_panel'],
    max_items: 3,
    hml_reference: 'cause-chain',
  },
  checklist: {
    best_for: ['summary', 'takeaways'],
    placements: ['right_panel', 'center_card'],
    max_items: 3,
    hml_reference: 'checklist-pop',
  },
  stat_compare: {
    best_for: ['comparison', 'data'],
    placements: ['lower_third', 'side_panel'],
    max_items: 2,
    hml_reference: 'stat-duel',
  },
};

const CAUSE_HINT = /(为什么|因为|所以|导致|原因|机制)/;

function selectMotionPrimitive(beat = {}) {
  const kind = beat.kind || 'text';
  const cards = Array.isArray(beat.visual_text?.cards) ? beat.visual_text.cards.filter(Boolean) : [];
  let preset;
  if (kind === 'steps') preset = 'three_step_flow';
  else if (kind === 'comparison' || kind === 'data') preset = 'stat_compare';
  else if (kind === 'quote') preset = 'key_marker';
  else if (cards.length >= 3) preset = 'checklist';
  else if (CAUSE_HINT.test(String(beat.narration_text || ''))) preset = 'cause_chain';
  else preset = 'concept_card';
  return {
    preset,
    placement: MOTION_PRIMITIVES[preset].placements[0],
    max_items: MOTION_PRIMITIVES[preset].max_items,
    avoid_caption_bottom_px: CAPTION_SAFE_BOTTOM_PX,
  };
}

function loadOverlaySnippet(primitiveId) {
  const file = path.join(PRIMITIVES_DIR, primitiveId, 'overlay.html');
  return fs.readFileSync(file, 'utf8');
}

function loadDiagramSkeleton() {
  return fs.readFileSync(path.join(PRIMITIVES_DIR, 'diagram_base', 'skeleton.html'), 'utf8');
}

function parseStyle(styleText = '') {
  const style = {};
  for (const part of String(styleText).split(';')) {
    const [key, value] = part.split(':');
    if (key && value !== undefined) style[key.trim()] = value.trim();
  }
  return style;
}

function pxNumber(value) {
  const text = String(value ?? '').trim();
  // 缺失/空值不折算成 0：Number('')===0 会把无 bottom 的 top 布局误判成 bottom:0
  if (!text) return null;
  const number = Number(text.replace(/px$/, ''));
  return Number.isFinite(number) ? number : null;
}

function validateOverlayHtml(html = '', { height = 1920 } = {}) {
  const rootMatch = String(html).match(/<[^>]*data-mp-overlay[^>]*>/);
  if (!rootMatch) return { valid: false, reason_code: 'overlay_root_missing', message: '缺少 data-mp-overlay 根节点' };
  const styleMatch = rootMatch[0].match(/style="([^"]*)"/);
  const style = parseStyle(styleMatch ? styleMatch[1] : '');
  if (style.inset === '0' || (style.top === '0' && style.bottom === '0' && style.left === '0' && style.right === '0')) {
    return { valid: false, reason_code: 'overlay_covers_full_frame', message: 'overlay 不允许整屏覆盖主视觉' };
  }
  const bottom = pxNumber(style.bottom);
  const top = pxNumber(style.top);
  const overlayHeight = pxNumber(style.height);
  if (bottom !== null) {
    if (bottom < CAPTION_SAFE_BOTTOM_PX) {
      return {
        valid: false,
        reason_code: 'overlay_in_caption_safe_area',
        message: `overlay 底边距 ${bottom}px 侵入字幕安全区（需 >= ${CAPTION_SAFE_BOTTOM_PX}px）`,
      };
    }
  } else if (top !== null && overlayHeight !== null) {
    // 无 bottom 的 top+height 布局：下边缘 top+height 不得进入底部字幕安全区
    if (top + overlayHeight > height - CAPTION_SAFE_BOTTOM_PX) {
      return {
        valid: false,
        reason_code: 'overlay_in_caption_safe_area',
        message: `overlay 下边缘 ${top + overlayHeight}px 侵入字幕安全区（需 <= ${height - CAPTION_SAFE_BOTTOM_PX}px）`,
      };
    }
  }
  // bottom/top+height 都取不到时不判定该项，保持 valid
  if (overlayHeight !== null && overlayHeight > height * 0.6) {
    return { valid: false, reason_code: 'overlay_too_tall', message: 'overlay 高度超过画面 60%，会遮挡主体' };
  }
  return { valid: true };
}

module.exports = {
  CAPTION_SAFE_BOTTOM_PX,
  MOTION_PRIMITIVES,
  selectMotionPrimitive,
  loadOverlaySnippet,
  loadDiagramSkeleton,
  validateOverlayHtml,
};
