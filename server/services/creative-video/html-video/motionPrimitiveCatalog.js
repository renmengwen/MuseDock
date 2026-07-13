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

function splitCssDeclarations(value) {
  const declarations = [];
  const text = String(value || '');
  let declaration = '';
  const blocks = [];
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (quote) {
      declaration += ch;
      if (ch === '\\' && index + 1 < text.length) declaration += text[index += 1];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && index + 1 < text.length) {
      declaration += ch + text[index += 1];
    } else if (ch === '/' && text[index + 1] === '*') {
      declaration += ' ';
      const close = text.indexOf('*/', index + 2);
      if (close < 0) break;
      index = close + 1;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      declaration += ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      blocks.push(ch === '(' ? ')' : ch === '[' ? ']' : '}');
      declaration += ch;
    } else if (blocks[blocks.length - 1] === ch) {
      blocks.pop();
      declaration += ch;
    } else if (ch === ';' && blocks.length === 0) {
      if (declaration.trim()) declarations.push(declaration);
      declaration = '';
    } else {
      declaration += ch;
    }
  }
  if (declaration.trim()) declarations.push(declaration);
  return declarations;
}

function splitCssValueTokens(value) {
  const tokens = [];
  let token = '';
  let depth = 0;
  let quote = null;
  for (const ch of String(value || '')) {
    if (quote) {
      token += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      token += ch;
    } else if (ch === '(') {
      depth += 1;
      token += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      token += ch;
    } else if (/\s/.test(ch) && depth === 0) {
      if (token) tokens.push(token);
      token = '';
    } else {
      token += ch;
    }
  }
  if (token) tokens.push(token);
  return tokens;
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

const CSS_LENGTH_UNITS = new Set([
  'px', 'cm', 'mm', 'q', 'in', 'pc', 'pt',
  'em', 'ex', 'ch', 'rem', 'lh', 'rlh', 'cap', 'ic', 'rex', 'rch', 'ric', 'rcap',
  'vw', 'vh', 'vi', 'vb', 'vmin', 'vmax',
  'svw', 'svh', 'svi', 'svb', 'svmin', 'svmax',
  'lvw', 'lvh', 'lvi', 'lvb', 'lvmin', 'lvmax',
  'dvw', 'dvh', 'dvi', 'dvb', 'dvmin', 'dvmax',
  'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax',
]);
const CSS_WIDE_KEYWORDS = new Set(['initial', 'inherit', 'unset', 'revert', 'revert-layer']);
const CSS_INTRINSIC_HEIGHT_KEYWORDS = new Set(['max-content', 'min-content', 'fit-content', 'stretch']);
const OPAQUE_LAYOUT_PROPERTY = /^(?:inset-(?:block|inline)(?:-(?:start|end))?|(?:min-|max-)?block-size|min-height|max-height|writing-mode)$/;

function parsePositionValue(value) {
  const text = stripImportant(value);
  if (!text) return { kind: 'missing' };
  const match = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)$/i);
  if (!match) return parseNonNumericPositionValue(text);
  const number = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!unit) return Number.isFinite(number) && number === 0 ? { kind: 'px', value: 0 } : { kind: 'invalid' };
  if (unit !== '%' && !CSS_LENGTH_UNITS.has(unit)) return { kind: 'invalid' };
  if (!Number.isFinite(number)) return { kind: 'indeterminate' };
  if (unit === 'px') return { kind: 'px', value: number };
  return number === 0 ? { kind: 'px', value: 0 } : { kind: 'indeterminate', number };
}

function parseNonNumericPositionValue(value) {
  const text = stripImportant(value);
  const lower = text.toLowerCase();
  if (lower === 'auto') return { kind: 'indeterminate' };
  if (CSS_WIDE_KEYWORDS.has(lower)) return { kind: 'css-wide' };
  if (/^var\(/i.test(text)) return { kind: 'unresolved' };
  if (/^(?:calc|min|max|clamp|env)\(/i.test(text)) return { kind: 'indeterminate' };
  return { kind: 'invalid' };
}

function isZeroLength(value) {
  const parsed = parsePositionValue(value);
  return parsed.kind === 'px' && parsed.value === 0;
}

function positionPx(value) {
  const parsed = parsePositionValue(value);
  return parsed.kind === 'px' ? parsed.value : null;
}

function expandInset(value) {
  const parts = splitCssValueTokens(value);
  if (parts.length < 1 || parts.length > 4) return null;
  const parsed = parts.map(parsePositionValue);
  if (parsed.some(item => ['invalid', 'missing'].includes(item.kind))) return null;
  const cssWideCount = parsed.filter(item => item.kind === 'css-wide').length;
  if (cssWideCount && (parts.length !== 1 || cssWideCount !== 1)) return null;
  const unresolvedIndex = parsed.findIndex(item => item.kind === 'unresolved');
  if (unresolvedIndex >= 0) return Array(4).fill(parts[unresolvedIndex]);
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  return parts;
}

function parseStyle(styleText = '') {
  const state = {};
  let opaqueLayout = false;
  const assign = (property, value, important) => {
    const normalized = stripImportant(value).toLowerCase();
    const parsed = property === 'height' && (
      CSS_INTRINSIC_HEIGHT_KEYWORDS.has(normalized)
      || /^(?:fit-content|anchor-size|calc-size)\(/.test(normalized)
    )
      ? { kind: 'indeterminate' }
      : parsePositionValue(value);
    if (parsed.kind === 'invalid' || parsed.kind === 'missing') return;
    const numericValue = parsed.kind === 'px' ? parsed.value : parsed.number;
    if (property === 'height' && Number.isFinite(numericValue) && numericValue < 0) {
      if (!state.height) state.height = { value: 'external_or_auto', important: false };
      return;
    }
    if (state[property]?.important && !important) return;
    state[property] = { value, important };
  };
  for (const declaration of splitCssDeclarations(styleText)) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const rawValue = declaration.slice(colon + 1).trim();
    const important = /\s*!\s*important\s*$/i.test(rawValue);
    const value = stripImportant(rawValue);
    if (OPAQUE_LAYOUT_PROPERTY.test(property)) {
      opaqueLayout = true;
    } else if (property === 'all') {
      const parsed = parsePositionValue(value);
      if (!['css-wide', 'unresolved'].includes(parsed.kind)) continue;
      ['top', 'right', 'bottom', 'left', 'height'].forEach(key => assign(key, value, important));
    } else if (property === 'inset') {
      const expanded = expandInset(value);
      if (!expanded) continue;
      ['top', 'right', 'bottom', 'left'].forEach((key, index) => assign(key, expanded[index], important));
    } else if (['top', 'right', 'bottom', 'left', 'height'].includes(property)) {
      assign(property, value, important);
    }
  }
  return {
    ...Object.fromEntries(Object.entries(state).map(([key, entry]) => [key, entry.value])),
    ...(opaqueLayout ? { __opaque_layout: true } : {}),
  };
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
  const indeterminatePairs = [];
  for (const tag of rootTags) {
    const result = validateOverlayRootTag(tag, height);
    if (result.valid) {
      // Finding 1：非 px 非零定位值无法静态确认，收集为非阻断的 indeterminate 标记
      if (Array.isArray(result.indeterminate_pairs)) indeterminatePairs.push(...result.indeterminate_pairs);
      continue;
    }
    const beatScope = parseTagAttributes(tag).get('data-mp-beat-scope') || '';
    return {
      ...result,
      message: beatScope ? `${result.message}（beat：${beatScope}）` : result.message,
      details: { beat_scope: beatScope || null },
    };
  }
  if (indeterminatePairs.length) {
    return {
      valid: true,
      indeterminate: true,
      message: `overlay 定位值无法静态确认安全区合规（${[...new Set(indeterminatePairs)].join('、')}），请人工复核`,
      details: { indeterminate_props: [...new Set(indeterminatePairs.map(pair => pair.split(':')[0]))] },
    };
  }
  return { valid: true };
}

// 单个 overlay opening tag 的安全区校验（原单元素逻辑不变）
function validateOverlayRootTag(rootTag, height) {
  // P2-6：style 属性经属性解析取值，兼容单引号/大写 STYLE/等号空白/无引号
  const attrs = parseTagAttributes(rootTag);
  const rawStyle = attrs.get('style') || '';
  const style = parseStyle(rawStyle);
  const hasExternalSelector = ['class', 'id'].some(name => String(attrs.get(name) || '').trim());
  const hasOpaqueSyntax = rawStyle.includes('\\')
    || /&(?:#(?:x[\da-f]+|\d+)|[a-z][\w-]*);/i.test(rawStyle);
  // ponytail: 不解析外部级联、CSS escape 或 HTML character reference；遇到即非阻断人工复核。
  if (hasExternalSelector || hasOpaqueSyntax || style.__opaque_layout) {
    return {
      valid: true,
      indeterminate_pairs: [
        hasExternalSelector ? 'selector:external_styles' : null,
        hasOpaqueSyntax ? 'syntax:escaped_or_encoded' : null,
        style.__opaque_layout ? 'layout:logical_or_constrained' : null,
      ].filter(Boolean),
    };
  }
  if (isZeroLength(style.top) && isZeroLength(style.bottom) && isZeroLength(style.left) && isZeroLength(style.right)) {
    return { valid: false, reason_code: 'overlay_covers_full_frame', message: 'overlay 不允许整屏覆盖主视觉' };
  }
  const bottom = positionPx(style.bottom);
  const top = positionPx(style.top);
  const overlayHeight = positionPx(style.height);
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
  const indeterminatePairs = [];
  for (const prop of ['bottom', 'top', 'height']) {
    const value = stripImportant(style[prop]);
    if (value && positionPx(value) === null) indeterminatePairs.push(`${prop}:${value}`);
  }
  // ponytail: 内联值不足时降级人工复核，误报率不可接受再改用 Playwright computedStyle。
  if (!style.bottom && !(style.top && style.height)) indeterminatePairs.push('position:external_or_missing');
  if (indeterminatePairs.length) return { valid: true, indeterminate_pairs: indeterminatePairs };
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
