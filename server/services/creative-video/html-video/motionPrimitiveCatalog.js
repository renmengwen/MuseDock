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
    // CSS property 大小写不敏感：key 小写归一，BOTTOM:0 也要参与安全区判定（P2-6）
    if (key && value !== undefined) style[key.trim().toLowerCase()] = value.trim();
  }
  return style;
}

// P2-5/P2-6：按属性 token 解析 opening tag，返回 属性名(小写)→值 的 Map。
// 支持 name、name=unquoted、name="..."、name='...'；引号内内容整体跳过，
// 其他属性值中的 " data-mp-overlay " 子串不会被误认成属性。
function parseTagAttributes(tagText) {
  const attrs = new Map();
  const text = String(tagText || '');
  // 跳过 '<' 与 tag 名
  let i = text.search(/[\s/>]/);
  if (i === -1) return attrs;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '>') break;
    if (/[\s/]/.test(ch)) { i++; continue; }
    // 属性名
    let start = i;
    while (i < text.length && !/[\s=/>]/.test(text[i])) i++;
    const name = text.slice(start, i).toLowerCase();
    // 可选的 = 值（等号两侧允许空白）
    let j = i;
    while (j < text.length && /\s/.test(text[j])) j++;
    let value = '';
    if (text[j] === '=') {
      j++;
      while (j < text.length && /\s/.test(text[j])) j++;
      const quote = text[j];
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, j + 1);
        value = text.slice(j + 1, close === -1 ? text.length : close);
        i = close === -1 ? text.length : close + 1;
      } else {
        start = j;
        while (j < text.length && !/[\s>]/.test(text[j])) j++;
        value = text.slice(start, j);
        i = j;
      }
    }
    if (name && !attrs.has(name)) attrs.set(name, value);
  }
  return attrs;
}

// 引号感知的 opening tag 提取：属性值内的裸 > 不截断 tag（P2-6 边界）。
// 未闭合的 tag（扫到文本末尾仍无未在引号内的 >）按无效丢弃。
function extractOpeningTags(html) {
  const text = String(html || '');
  const tags = [];
  const startRe = /<[a-z]/gi;
  let match;
  while ((match = startRe.exec(text))) {
    let i = match.index + 1;
    let quote = null;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
    }
    if (i >= text.length) break;
    tags.push(text.slice(match.index, i + 1));
    startRe.lastIndex = i + 1;
  }
  return tags;
}

// CSS 值预处理：剥离尾部 !important（大小写不敏感、允许前置空白）
function stripImportant(value) {
  return String(value ?? '').replace(/\s*!\s*important\s*$/i, '').trim();
}

function pxNumber(value) {
  const text = stripImportant(value);
  // 缺失/空值不折算成 0：Number('')===0 会把无 bottom 的 top 布局误判成 bottom:0
  if (!text) return null;
  const number = Number(text.replace(/px$/i, '').trim());
  return Number.isFinite(number) ? number : null;
}

// 零长度归一判定：0 / 0px / 0PX / 0.0px / 0px !important 视为同一个零
function isZeroLength(value) {
  return pxNumber(value) === 0;
}

// 剥离注释与 <style>/<script> 内容：属性选择器、注释里的 data-mp-* 字样不算真实元素（P1-8）。
// 未闭合的 <style>/<script>/<!-- 按浏览器语义吞掉其后全部内容，一并剥到字符串末尾。
function stripNonElementHtml(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!--[\s\S]*$/, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<(?:script|style)\b[\s\S]*$/i, '');
}

// 是否存在带 data-mp-overlay 属性的真实 opening tag（供兜底注入与 validationGate 共用）
function hasRealOverlayElement(html) {
  return collectOverlayRootTags(html).length > 0;
}

function collectOverlayRootTags(html) {
  // P2-5：属性存在性按属性 token 解析判定，其他属性值中的子串不误命中
  return extractOpeningTags(stripNonElementHtml(html))
    .filter(tag => parseTagAttributes(tag).has('data-mp-overlay'));
}

function validateOverlayHtml(html = '', { height = 1920 } = {}) {
  const rootTags = collectOverlayRootTags(html);
  if (!rootTags.length) return { valid: false, reason_code: 'overlay_root_missing', message: '缺少 data-mp-overlay 根节点' };
  // P2-2：scene_html 标准结构是多 overlay，必须逐个校验，任一越界即整体 invalid
  for (const tag of rootTags) {
    const result = validateOverlayRootTag(tag, height);
    if (result.valid) continue;
    const beatScope = parseTagAttributes(tag).get('data-mp-beat-scope') || '';
    return {
      ...result,
      message: beatScope ? `${result.message}（beat：${beatScope}）` : result.message,
      details: { beat_scope: beatScope || null },
    };
  }
  return { valid: true };
}

// 单个 overlay opening tag 的安全区校验（原单元素逻辑不变）
function validateOverlayRootTag(rootTag, height) {
  // P2-6：style 属性经属性解析取值，兼容单引号/大写 STYLE/等号空白/无引号
  const style = parseStyle(parseTagAttributes(rootTag).get('style') || '');
  if (isZeroLength(style.inset) || (isZeroLength(style.top) && isZeroLength(style.bottom) && isZeroLength(style.left) && isZeroLength(style.right))) {
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
  hasRealOverlayElement,
  stripNonElementHtml,
};
