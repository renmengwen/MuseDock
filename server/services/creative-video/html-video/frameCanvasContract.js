function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resolveResolution(target = {}) {
  const resolution = objectOrEmpty(target.resolution || target.output?.resolution);
  const width = Number(target.width || resolution.width || 1920);
  const height = Number(target.height || resolution.height || 1080);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1920,
    height: Number.isFinite(height) && height > 0 ? height : 1080,
  };
}

function hasViewportMeta(html = '') {
  return /<meta\b[^>]*name=["']viewport["'][^>]*>/i.test(String(html || ''));
}

function hasCanvasContract(html = '') {
  return /\bdata-hv-canvas(?:\s|=|>)/i.test(String(html || ''))
    || /<[^>]+\bid=["']root["'][^>]+\bdata-width=["']?\d{2,5}["']?[^>]+\bdata-height=["']?\d{2,5}["']?/i.test(String(html || ''));
}

function appendMissingAttr(tag, name, value = '') {
  const attrPattern = new RegExp(`\\b${name}(?:\\s*=|\\b)`, 'i');
  if (attrPattern.test(tag)) return tag;
  const suffix = value === '' ? ` ${name}` : ` ${name}="${value}"`;
  return tag.replace(/>$/, `${suffix}>`);
}

function normalizeBodyTag(tag, resolution) {
  let next = appendMissingAttr(tag, 'data-hv-canvas');
  next = appendMissingAttr(next, 'data-width', String(resolution.width));
  next = appendMissingAttr(next, 'data-height', String(resolution.height));
  return next;
}

function normalizeHtmlCanvasContract(html = '', target = {}) {
  const resolution = resolveResolution(target);
  let next = String(html || '');
  if (!next.trim()) return next;

  if (!hasViewportMeta(next)) {
    const viewport = `<meta name="viewport" content="width=${resolution.width},height=${resolution.height},initial-scale=1.0">`;
    if (/<head\b[^>]*>/i.test(next)) {
      next = next.replace(/<head\b[^>]*>/i, match => `${match}\n${viewport}`);
    } else {
      next = next.replace(/<html\b[^>]*>/i, match => `${match}\n<head>${viewport}</head>`);
    }
  }

  const contractStyle = [
    '<style data-hv-canvas-contract="true">',
    `html,body{margin:0;width:${resolution.width}px;height:${resolution.height}px;overflow:hidden;}`,
    '</style>',
  ].join('');
  if (!/data-hv-canvas-contract=["']true["']/i.test(next)) {
    if (/<\/head>/i.test(next)) {
      next = next.replace(/<\/head>/i, `${contractStyle}\n</head>`);
    } else {
      next = next.replace(/<body\b[^>]*>/i, `${contractStyle}\n$&`);
    }
  }

  if (!hasCanvasContract(next)) {
    next = next.replace(/<body\b[^>]*>/i, match => normalizeBodyTag(match, resolution));
  } else if (/<body\b[^>]*\bdata-hv-canvas\b[^>]*>/i.test(next)) {
    next = next.replace(/<body\b[^>]*\bdata-hv-canvas\b[^>]*>/i, match => normalizeBodyTag(match, resolution));
  }

  return next;
}

function attr(tag = '', name = '') {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']?([^"'\\s>]+)`, 'i'))?.[1] || '';
}

function hasAttr(tag = '', name = '') {
  return new RegExp(`\\b${name}(?:\\s|=|>)`, 'i').test(String(tag || ''));
}

function extractViewportDimensions(html = '') {
  const pairs = [];
  const metaPattern = /<meta\b[^>]*name=["']viewport["'][^>]*>/gi;
  for (const match of String(html || '').matchAll(metaPattern)) {
    const tag = match[0];
    const content = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1] || tag;
    const width = Number(content.match(/\bwidth\s*=\s*(\d{2,5})\b/i)?.[1]);
    const height = Number(content.match(/\bheight\s*=\s*(\d{2,5})\b/i)?.[1]);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      pairs.push({ source: 'viewport', width, height });
    }
  }
  return pairs;
}

function extractDataCanvasDimensions(html = '') {
  const pairs = [];
  const tagPattern = /<([a-z][\w:-]*)\b[^>]*>/gi;
  for (const match of String(html || '').matchAll(tagPattern)) {
    const tag = match[0];
    const id = attr(tag, 'id');
    const hasHvCanvas = hasAttr(tag, 'data-hv-canvas');
    const hasComposition = /\bdata-composition-id\s*=/i.test(tag);
    const isRoot = /^root$/i.test(id);
    if (!hasHvCanvas && !isRoot && !hasComposition) continue;
    if (!hasAttr(tag, 'data-width') || !hasAttr(tag, 'data-height')) continue;
    const width = Number(attr(tag, 'data-width'));
    const height = Number(attr(tag, 'data-height'));
    if (Number.isFinite(width) && Number.isFinite(height)) {
      const source = hasHvCanvas ? 'data-hv-canvas' : (isRoot ? 'data:#root' : 'data-composition');
      pairs.push({ source, width, height });
    }
  }
  return pairs;
}

function cssCanvasSelectorKind(selector = '') {
  let hasFallback = false;
  return String(selector || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .reduce((kind, item) => {
      if (kind === 'authoritative') return kind;
      if (!item || /[\s>+~]/.test(item)) return kind;
      if (item === 'html' || item === 'body' || item === ':root') return 'authoritative';
      if (/^#(app|root|stage|scene|canvas|screen|page|video|container)$/.test(item)) return 'authoritative';
      if (/^\.(app|root|stage|scene|canvas|screen|page|video|container)$/.test(item)) hasFallback = true;
      return kind;
    }, '') || (hasFallback ? 'fallback' : '');
}

function isRootCanvasSelector(selector = '') {
  return Boolean(cssCanvasSelectorKind(selector));
}

function extractCssRootDimensions(html = '') {
  const pairs = [];
  const blocks = [...String(html || '').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map(match => match[1] || '');
  const sources = blocks.length ? blocks : [String(html || '')];
  const rulePattern = /([^{}]+)\{([^{}]+)\}/g;
  for (const source of sources) {
    for (const match of source.matchAll(rulePattern)) {
      const selector = match[1] || '';
      const body = match[2] || '';
      const kind = cssCanvasSelectorKind(selector);
      if (!kind) continue;
      const width = Number(body.match(/(?:^|[;\s])width\s*:\s*(\d{2,5})px\b/i)?.[1]);
      const height = Number(body.match(/(?:^|[;\s])height\s*:\s*(\d{2,5})px\b/i)?.[1]);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        pairs.push({ source: `css:${selector.trim().replace(/\s+/g, ' ')}`, width, height, kind });
      }
    }
  }
  return pairs;
}

function validateHtmlCanvasContract(html, target = {}) {
  const resolution = resolveResolution(target);
  const expectedWidth = resolution.width;
  const expectedHeight = resolution.height;
  const cssPairs = extractCssRootDimensions(html);
  const authoritativePairs = [
    ...extractViewportDimensions(html),
    ...extractDataCanvasDimensions(html),
    ...cssPairs.filter(pair => pair.kind === 'authoritative'),
  ];
  const pairs = authoritativePairs.length
    ? authoritativePairs
    : cssPairs.filter(pair => pair.kind === 'fallback');
  const mismatched = pairs.find(pair => pair.width !== expectedWidth || pair.height !== expectedHeight);
  if (!mismatched) return { success: true };
  const reversed = mismatched.width === expectedHeight && mismatched.height === expectedWidth;
  return {
    success: false,
    message: [
      `HTML 画幅尺寸不符合目标 ${expectedWidth}x${expectedHeight}。`,
      `${mismatched.source} 使用 ${mismatched.width}x${mismatched.height}。`,
      reversed ? `不能使用 ${expectedHeight}x${expectedWidth}，这会把横屏画面裁进竖屏。` : '',
    ].filter(Boolean).join(''),
    expected: { width: expectedWidth, height: expectedHeight },
    actual: { width: mismatched.width, height: mismatched.height, source: mismatched.source },
  };
}

module.exports = {
  normalizeHtmlCanvasContract,
  validateHtmlCanvasContract,
  resolveResolution,
};
