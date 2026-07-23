// html-video 画布 iframe 的运行时操作：播放/冻结、canvas viewport 安装、
// 元素几何换算、选择与序列化。全部为纯 DOM 函数，不依赖 React 状态。
import {
  canEditText,
  formatElementLabel,
  isCanvasEditableElement,
  nextEditId,
  parsePx,
} from './htmlVideoCanvasDom.mjs';

export function frameIdOf(frame) {
  return frame?.id || frame?.scene_id || '';
}

export function frameDurationMs(frame) {
  const duration = Number(frame?.duration_sec ?? frame?.durationSec ?? frame?.duration ?? 3);
  return Math.max(500, (Number.isFinite(duration) && duration > 0 ? duration : 3) * 1000);
}

export function serializeDocument(doc) {
  const root = doc.documentElement.cloneNode(true);
  root.querySelectorAll('[data-hv-canvas-freeze],[data-hv-canvas-editor-style],[data-hv-canvas-viewport-style],[data-hv-editor-overlay],[data-hv-canvas-base]').forEach(node => node.remove());
  root.querySelectorAll('[data-hv-canvas-selected],[data-hv-edit-id],[data-hv-canvas-hover]').forEach(node => {
    node.removeAttribute('data-hv-canvas-selected');
    node.removeAttribute('data-hv-edit-id');
    node.removeAttribute('data-hv-canvas-hover');
  });
  root.removeAttribute('data-hv-canvas-selected');
  const doctype = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}${doc.doctype.publicId ? ` PUBLIC "${doc.doctype.publicId}"` : ''}${doc.doctype.systemId ? ` "${doc.doctype.systemId}"` : ''}>`
    : '<!doctype html>';
  return `${doctype}\n${root.outerHTML}`;
}

export function getLoadedFrameHtml(result) {
  return result?.html || result?.data?.html || '';
}

function elementSelector(element) {
  if (!element) return '';
  if (element.dataset?.hvEditId) return `[data-hv-edit-id="${element.dataset.hvEditId}"]`;
  if (element.dataset?.assetId) return `[data-asset-id="${element.dataset.assetId}"]`;
  if (element.dataset?.textKey) return `[data-text-key="${element.dataset.textKey}"]`;
  if (element.dataset?.role) return `[data-role="${element.dataset.role}"]`;
  if (element.id) return `#${element.id}`;
  const firstClass = Array.from(element.classList || [])[0];
  return firstClass ? `${element.tagName.toLowerCase()}.${firstClass}` : element.tagName.toLowerCase();
}

function collectExistingEditIds(doc) {
  return new Set(Array.from(doc.querySelectorAll('[data-hv-edit-id]'))
    .map(element => element.getAttribute('data-hv-edit-id'))
    .filter(Boolean));
}

function ensureEditId(element) {
  if (!element || element.dataset?.hvEditId) return element?.dataset?.hvEditId || '';
  const doc = element.ownerDocument;
  // 文档级缓存已分配 id：避免每个新元素都全文档扫一遍（O(n²)），iframe 重载后自然重建
  if (!doc.__hvEditIdSet) doc.__hvEditIdSet = collectExistingEditIds(doc);
  const id = nextEditId(doc.__hvEditIdSet);
  doc.__hvEditIdSet.add(id);
  element.dataset.hvEditId = id;
  return id;
}

function cssNumber(value) {
  const number = Number.parseFloat(String(value || ''));
  return Number.isFinite(number) ? number : 0;
}

export function zIndexOf(element) {
  return cssNumber(element.style.zIndex || element.ownerDocument.defaultView.getComputedStyle(element).zIndex);
}

const excludedAncestorSelector = [
  '.hv-caption-layer',
  '.hv-caption-item',
  '[data-hv-managed="true"]',
  '[data-role="subtitle-caption"]',
].join(',');

export function isEditableElement(element) {
  if (!isCanvasEditableElement(element)) return false;
  if (element.closest(excludedAncestorSelector)) return false;
  return true;
}

export function freezeFrame(win, targetTimeMs) {
  const doc = win.document;
  const targetMs = Number.isFinite(targetTimeMs) && targetTimeMs >= 0 ? targetTimeMs : null;
  const targetSec = targetMs === null ? null : targetMs / 1000;
  doc.querySelectorAll('[data-hv-canvas-freeze]').forEach(node => node.remove());
  try {
    const clock = win.__hvPlaybackClock;
    if (clock && typeof clock.pause === 'function' && typeof clock.setTime === 'function') {
      if (targetSec !== null) clock.setTime(targetSec);
      clock.pause();
    } else if (targetSec !== null && typeof win.__mpSetTimelineTime === 'function') {
      win.__mpSetTimelineTime(targetSec);
    }
  } catch (_) {}
  for (const animation of doc.getAnimations()) {
    try {
      const timing = animation.effect?.getTiming?.();
      const duration = Number(timing?.duration);
      if (targetMs !== null) {
        animation.currentTime = targetMs;
      } else if (animation.playState === 'idle' && Number.isFinite(duration)) {
        animation.currentTime = duration;
      }
      animation.pause();
    } catch (_) {
      try { animation.pause(); } catch (_) {}
    }
  }
  Object.values(win.__timelines || {}).forEach(timeline => {
    try {
      if (timeline && typeof timeline.seek === 'function') {
        if (targetMs !== null) timeline.seek(targetMs / 1000, false);
        timeline.pause?.();
      } else if (timeline && typeof timeline.progress === 'function') {
        if (targetMs !== null) timeline.progress(1);
        timeline.pause?.();
      }
    } catch (_) {}
  });
  if (win.gsap?.globalTimeline) {
    try { win.gsap.globalTimeline.pause(); } catch (_) {}
  }
  const style = doc.createElement('style');
  style.setAttribute('data-hv-canvas-freeze', 'true');
  style.textContent = '*{animation-play-state:paused!important;transition-property:none!important;}';
  doc.head.appendChild(style);
}

export function playFrame(win) {
  try {
    if (typeof win.__hvPlayAll === 'function') {
      win.__hvPlayed = true;
      win.__hvPlayAll();
    }
  } catch (_) {}
  try {
    if (typeof win.__hvUnfreeze === 'function') win.__hvUnfreeze();
  } catch (_) {}
  try {
    if (win.__hvPlaybackClock && typeof win.__hvPlaybackClock.play === 'function') {
      win.__hvPlaybackClock.play();
    } else if (typeof win.__mpStartBeatClock === 'function') {
      win.__mpStartBeatClock();
    }
  } catch (_) {}
}

function viewportSize(win) {
  const doc = win.document;
  return {
    width: win.innerWidth || doc.documentElement.clientWidth || 0,
    height: win.innerHeight || doc.documentElement.clientHeight || 0,
  };
}

export function canvasScale(win) {
  const scale = Number(win?.__HV_CANVAS_SCALE__);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function canvasSize(win) {
  const size = win?.__HV_CANVAS_SIZE__;
  return {
    width: Number.isFinite(size?.width) && size.width > 0 ? size.width : viewportSize(win).width,
    height: Number.isFinite(size?.height) && size.height > 0 ? size.height : viewportSize(win).height,
  };
}

function readCanvasContract(doc) {
  const el = doc.querySelector('[data-hv-canvas]') || doc.body || doc.documentElement;
  const width = Number(el?.getAttribute?.('data-width'));
  const height = Number(el?.getAttribute?.('data-height'));
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  return null;
}

export function installCanvasViewport(doc) {
  const win = doc.defaultView;
  const viewport = viewportSize(win);
  const body = doc.body;
  // 画布尺寸优先读渲染契约（data-hv-canvas / data-width / data-height），与 Playwright 渲染端同源，
  // 契约缺失时才回退到 DOM 尺寸估算，避免二次编辑拖拽定位「所见非所得」。
  const contract = readCanvasContract(doc);
  const designWidth = contract?.width ?? Math.max(
    doc.documentElement.scrollWidth,
    doc.documentElement.clientWidth,
    body?.scrollWidth || 0,
    body?.offsetWidth || 0,
    1,
  );
  const designHeight = contract?.height ?? Math.max(
    doc.documentElement.scrollHeight,
    doc.documentElement.clientHeight,
    body?.scrollHeight || 0,
    body?.offsetHeight || 0,
    1,
  );
  const scale = viewport.width && viewport.height
    ? Math.min(viewport.width / designWidth, viewport.height / designHeight)
    : 1;

  win.__HV_CANVAS_SCALE__ = scale > 0 ? scale : 1;
  win.__HV_CANVAS_SIZE__ = { width: designWidth, height: designHeight };
  const canvasWidth = designWidth * win.__HV_CANVAS_SCALE__;
  const canvasHeight = designHeight * win.__HV_CANVAS_SCALE__;
  const offsetLeft = Math.max(0, (viewport.width - canvasWidth) / 2);
  const offsetTop = Math.max(0, (viewport.height - canvasHeight) / 2);
  doc.querySelectorAll('[data-hv-canvas-viewport-style]').forEach(node => node.remove());
  const style = doc.createElement('style');
  style.setAttribute('data-hv-canvas-viewport-style', 'true');
  style.textContent = `
html {
  width: 100% !important;
  height: 100% !important;
  overflow: hidden !important;
}
body {
  margin: 0 !important;
  position: absolute !important;
  left: ${Math.round(offsetLeft)}px !important;
  top: ${Math.round(offsetTop)}px !important;
  width: ${Math.round(designWidth)}px !important;
  height: ${Math.round(designHeight)}px !important;
  transform: scale(${win.__HV_CANVAS_SCALE__}) !important;
  transform-origin: 0 0 !important;
  overflow: hidden !important;
}
`;
  doc.head.appendChild(style);
}

export function absolutePositionFor(element) {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  const rect = element.getBoundingClientRect();
  const offsetParent = element.offsetParent || doc.body;
  const parentRect = offsetParent.getBoundingClientRect();
  const scale = canvasScale(win);
  const size = canvasSize(win);
  const parentIsBody = offsetParent === doc.body || offsetParent === doc.documentElement;
  const bodyRect = doc.body?.getBoundingClientRect?.() || doc.documentElement.getBoundingClientRect();
  const parentCanvasLeft = parentIsBody ? 0 : (parentRect.left - bodyRect.left) / scale;
  const parentCanvasTop = parentIsBody ? 0 : (parentRect.top - bodyRect.top) / scale;
  const minLeft = parentIsBody ? 0 : -parentCanvasLeft + offsetParent.scrollLeft;
  const minTop = parentIsBody ? 0 : -parentCanvasTop + offsetParent.scrollTop;
  const maxLeft = parentIsBody ? size.width : size.width - parentCanvasLeft + offsetParent.scrollLeft;
  const maxTop = parentIsBody ? size.height : size.height - parentCanvasTop + offsetParent.scrollTop;
  return {
    left: (rect.left - parentRect.left) / scale + offsetParent.scrollLeft,
    top: (rect.top - parentRect.top) / scale + offsetParent.scrollTop,
    minLeft,
    minTop,
    maxLeft,
    maxTop,
  };
}

export function stylePxOrFallback(value, fallback) {
  const normalized = String(value || '').trim();
  return !normalized || normalized === 'auto' ? fallback : parsePx(normalized);
}

export function writeElementText(element, text) {
  const firstTextNode = Array.from(element.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
  if (firstTextNode) {
    firstTextNode.textContent = text;
    return;
  }
  element.textContent = text;
}

export function readElementInfo(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const scale = canvasScale(element.ownerDocument.defaultView);
  const position = absolutePositionFor(element);
  const editId = ensureEditId(element);
  const info = {
    editId,
    textKey: element.dataset?.textKey || '',
    role: element.dataset?.role || '',
    assetId: element.dataset?.assetId || '',
    className: element.className || '',
    tagName: element.tagName || '',
    text: (element.innerText || element.textContent || '').trim(),
    selector: elementSelector(element),
    left: position.left,
    top: position.top,
    width: rect.width / scale,
    height: rect.height / scale,
    zIndex: zIndexOf(element),
    locked: element.dataset?.hvEditorLocked === 'true',
    hidden: element.style.display === 'none',
    textEditable: canEditText(element),
  };
  return {
    ...info,
    label: formatElementLabel(info),
  };
}

export function selectElement(element) {
  const doc = element.ownerDocument;
  doc.querySelectorAll('[data-hv-canvas-selected="true"]').forEach(node => {
    delete node.dataset.hvCanvasSelected;
  });
  element.dataset.hvCanvasSelected = 'true';
  return readElementInfo(element);
}

export function summarizeElement(element) {
  const info = readElementInfo(element);
  const text = String(info?.text || '').replace(/\s+/g, ' ').trim();
  return info ? {
    editId: info.editId,
    label: text && text !== info.label ? `${info.label} · ${text.slice(0, 32)}` : info.label,
    selector: info.selector,
    locked: info.locked,
    hidden: info.hidden,
    zIndex: info.zIndex,
  } : null;
}

export function uniqueElements(elements) {
  const seen = new Set();
  return elements.filter(element => {
    if (!element || seen.has(element)) return false;
    seen.add(element);
    return true;
  });
}
