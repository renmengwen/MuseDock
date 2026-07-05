import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

import {
  canEditText,
  clamp,
  createDraftSummary,
  editableSelector,
  excludedSelector,
  fitPreviewBox,
  formatElementLabel,
  nextEditId,
  parsePx,
  previewAspectRatio,
} from './htmlVideoCanvasDom.mjs';
import { HtmlVideoElementInspector } from './HtmlVideoElementInspector.jsx';
import { HtmlVideoFrameStrip } from './HtmlVideoFrameStrip.jsx';
import { FrameInputsPanel } from './FrameInputsPanel.jsx';

function frameIdOf(frame) {
  return frame?.id || frame?.scene_id || '';
}

function frameDurationMs(frame) {
  const duration = Number(frame?.duration_sec ?? frame?.durationSec ?? frame?.duration ?? 3);
  return Math.max(500, (Number.isFinite(duration) && duration > 0 ? duration : 3) * 1000);
}

function serializeDocument(doc) {
  const root = doc.documentElement.cloneNode(true);
  root.querySelectorAll('[data-hv-canvas-freeze],[data-hv-canvas-editor-style],[data-hv-canvas-viewport-style],[data-hv-editor-overlay]').forEach(node => node.remove());
  root.querySelectorAll('[data-hv-canvas-selected],[data-hv-edit-id]').forEach(node => {
    node.removeAttribute('data-hv-canvas-selected');
    node.removeAttribute('data-hv-edit-id');
  });
  root.removeAttribute('data-hv-canvas-selected');
  const doctype = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}${doc.doctype.publicId ? ` PUBLIC "${doc.doctype.publicId}"` : ''}${doc.doctype.systemId ? ` "${doc.doctype.systemId}"` : ''}>`
    : '<!doctype html>';
  return `${doctype}\n${root.outerHTML}`;
}

function getLoadedFrameHtml(result) {
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
  const id = nextEditId(collectExistingEditIds(doc));
  element.dataset.hvEditId = id;
  return id;
}

function cssNumber(value) {
  const number = Number.parseFloat(String(value || ''));
  return Number.isFinite(number) ? number : 0;
}

function zIndexOf(element) {
  return cssNumber(element.style.zIndex || element.ownerDocument.defaultView.getComputedStyle(element).zIndex);
}

const excludedAncestorSelector = [
  '.hv-caption-layer',
  '.hv-caption-item',
  '[data-hv-managed="true"]',
  '[data-role="subtitle-caption"]',
].join(',');

function isEditableElement(element) {
  if (!element || element.nodeType !== 1) return false;
  if (element.matches(excludedSelector)) return false;
  if (element.closest(excludedAncestorSelector)) return false;
  return element.matches(editableSelector);
}

function freezeFrame(win, targetTimeMs) {
  const doc = win.document;
  const targetMs = Number.isFinite(targetTimeMs) && targetTimeMs >= 0 ? targetTimeMs : null;
  doc.querySelectorAll('[data-hv-canvas-freeze]').forEach(node => node.remove());
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

function playFrame(win) {
  try {
    if (typeof win.__hvPlayAll === 'function') {
      win.__hvPlayed = true;
      win.__hvPlayAll();
    }
  } catch (_) {}
  try {
    if (typeof win.__hvUnfreeze === 'function') win.__hvUnfreeze();
  } catch (_) {}
}

function viewportSize(win) {
  const doc = win.document;
  return {
    width: win.innerWidth || doc.documentElement.clientWidth || 0,
    height: win.innerHeight || doc.documentElement.clientHeight || 0,
  };
}

function canvasScale(win) {
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

function installCanvasViewport(doc) {
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

function absolutePositionFor(element) {
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

function stylePxOrFallback(value, fallback) {
  const normalized = String(value || '').trim();
  return !normalized || normalized === 'auto' ? fallback : parsePx(normalized);
}

function writeElementText(element, text) {
  const firstTextNode = Array.from(element.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
  if (firstTextNode) {
    firstTextNode.textContent = text;
    return;
  }
  element.textContent = text;
}

function readElementInfo(element) {
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

function selectElement(element) {
  const doc = element.ownerDocument;
  doc.querySelectorAll('[data-hv-canvas-selected="true"]').forEach(node => {
    delete node.dataset.hvCanvasSelected;
  });
  element.dataset.hvCanvasSelected = 'true';
  return readElementInfo(element);
}

function summarizeElement(element) {
  const info = readElementInfo(element);
  return info ? {
    editId: info.editId,
    label: info.label,
    selector: info.selector,
    locked: info.locked,
    hidden: info.hidden,
    zIndex: info.zIndex,
  } : null;
}

function uniqueElements(elements) {
  const seen = new Set();
  return elements.filter(element => {
    if (!element || seen.has(element)) return false;
    seen.add(element);
    return true;
  });
}

const secondaryButtonClass = 'min-h-7 rounded-md border border-slate-700 bg-slate-900 px-2.5 text-xs font-bold text-slate-100 transition hover:border-[#25f4ee]/60 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-55';

export function HtmlVideoCanvasEditor({ editor }) {
  const iframeRef = useRef(null);
  const previewSlotRef = useRef(null);
  const playbackTimerRef = useRef(null);
  const iframeLoadTimerRef = useRef(null);
  const selectedElementRef = useRef(null);
  const editingReadyRef = useRef(false);
  const frameLoadRequestRef = useRef(0);
  const dragRef = useRef(null);
  const undoStackRef = useRef([]);
  const [html, setHtml] = useState('');
  const [loadedFrameId, setLoadedFrameId] = useState('');
  const [iframeKey, setIframeKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [htmlLoadError, setHtmlLoadError] = useState('');
  const [htmlReloadKey, setHtmlReloadKey] = useState(0);
  const [editingReady, setEditingReady] = useState(false);
  const [playbackState, setPlaybackState] = useState('idle');
  const [elementInfo, setElementInfo] = useState(null);
  const [elementCandidates, setElementCandidates] = useState([]);
  const [layerItems, setLayerItems] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [previewSlotSize, setPreviewSlotSize] = useState({ width: 0, height: 0 });

  const frame = editor.selectedFrame;
  const frameId = frameIdOf(frame);
  const rawHtml = frame?.source_mode === 'raw_html';
  const disabled = editor.disabled;

  const htmlReady = Boolean(html && loadedFrameId === frameId);
  const srcDoc = useMemo(() => (
    htmlReady ? html : '<!doctype html><html><body></body></html>'
  ), [htmlReady, html]);
  const previewRatio = previewAspectRatio(editor.project);
  const previewSize = useMemo(
    () => fitPreviewBox(previewSlotSize, previewRatio),
    [previewSlotSize, previewRatio],
  );
  const previewFrameStyle = previewSize.width && previewSize.height
    ? { width: `${previewSize.width}px`, height: `${previewSize.height}px` }
    : { width: '100%', height: '100%' };

  function clearPlaybackTimer() {
    if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
    playbackTimerRef.current = null;
  }

  function snapshotBeforeEdit() {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    // 快照只存文档内容：剥掉覆盖层与选中标记，否则撤销会还原出幽灵选框/handle
    const clone = doc.body.cloneNode(true);
    clone.querySelectorAll('[data-hv-editor-overlay]').forEach(node => node.remove());
    clone.querySelectorAll('[data-hv-canvas-selected]').forEach(node => node.removeAttribute('data-hv-canvas-selected'));
    const snapshot = clone.innerHTML;
    if (undoStackRef.current.at(-1) === snapshot) return;
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > 30) undoStackRef.current.shift();
    setCanUndo(true);
  }

  function undoEdit() {
    const doc = iframeRef.current?.contentDocument;
    const prev = undoStackRef.current.pop();
    if (!doc?.body || prev === undefined) return;
    doc.body.innerHTML = prev;
    selectedElementRef.current = null;
    dragRef.current = null;
    setElementInfo(null);
    setElementCandidates([]);
    setCanUndo(undoStackRef.current.length > 0);
    setDirty(true);
    refreshLayerItems(doc);
  }

  function selectedDocument() {
    return iframeRef.current?.contentDocument || null;
  }

  function editableElements(doc) {
    if (!doc?.body) return [];
    return Array.from(doc.querySelectorAll(editableSelector)).filter(isEditableElement);
  }

  function refreshLayerItems(doc = selectedDocument()) {
    const items = editableElements(doc)
      .map(summarizeElement)
      .filter(Boolean)
      .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
    setLayerItems(items);
  }

  function findElementByEditId(editId, doc = selectedDocument()) {
    if (!editId || !doc?.body) return null;
    return editableElements(doc).find(element => element.dataset?.hvEditId === editId) || null;
  }

  function removeEditorOverlay(doc = selectedDocument()) {
    doc?.querySelectorAll?.('[data-hv-editor-overlay]').forEach(node => node.remove());
  }

  function canvasRectFor(element) {
    const doc = element.ownerDocument;
    const scale = canvasScale(doc.defaultView);
    const rect = element.getBoundingClientRect();
    const bodyRect = doc.body?.getBoundingClientRect?.() || doc.documentElement.getBoundingClientRect();
    return {
      left: (rect.left - bodyRect.left) / scale,
      top: (rect.top - bodyRect.top) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    };
  }

  function renderEditorOverlay(element) {
    const doc = element?.ownerDocument;
    if (!doc?.body || element.style.display === 'none') {
      removeEditorOverlay(doc);
      return;
    }
    const rect = canvasRectFor(element);
    const rectStyle = {
      left: `${Math.round(rect.left)}px`,
      top: `${Math.round(rect.top)}px`,
      width: `${Math.max(1, Math.round(rect.width))}px`,
      height: `${Math.max(1, Math.round(rect.height))}px`,
    };
    // 原地更新而不重建：resize 时 pointer capture 挂在 handle 按钮上，重建 overlay 会把
    // capture 目标移出 DOM 导致 capture 丢失（拖出 iframe 松手后出现粘滞拖拽）。
    const existing = doc.querySelector('[data-hv-editor-overlay]');
    if (existing) {
      Object.assign(existing.style, rectStyle);
      return;
    }
    const overlay = doc.createElement('div');
    overlay.setAttribute('data-hv-editor-overlay', 'true');
    overlay.style.cssText = [
      'position:absolute',
      `left:${rectStyle.left}`,
      `top:${rectStyle.top}`,
      `width:${rectStyle.width}`,
      `height:${rectStyle.height}`,
      'box-sizing:border-box',
      'border:1px solid #25f4ee',
      'pointer-events:none',
      'z-index:2147483646',
    ].join(';');
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      const node = doc.createElement('button');
      node.type = 'button';
      node.setAttribute('data-hv-editor-handle', handle);
      node.setAttribute('aria-label', `调整尺寸 ${handle}`);
      const cursor = `${handle}-resize`;
      const x = handle.includes('w') ? '-5px' : handle.includes('e') ? 'calc(100% - 5px)' : 'calc(50% - 5px)';
      const y = handle.includes('n') ? '-5px' : handle.includes('s') ? 'calc(100% - 5px)' : 'calc(50% - 5px)';
      node.style.cssText = [
        'position:absolute',
        `left:${x}`,
        `top:${y}`,
        'width:10px',
        'height:10px',
        'padding:0',
        'border:1px solid #0f172a',
        'border-radius:2px',
        'background:#25f4ee',
        `cursor:${cursor}`,
        'pointer-events:auto',
      ].join(';');
      overlay.appendChild(node);
    }
    doc.body.appendChild(overlay);
  }

  function selectAndRender(element) {
    if (!element) return;
    selectedElementRef.current = element;
    const info = selectElement(element);
    setElementInfo(info);
    renderEditorOverlay(element);
    refreshLayerItems(element.ownerDocument);
  }

  useEffect(() => {
    if (!rawHtml || !htmlReady) return undefined;
    setPreviewError('');
    if (iframeLoadTimerRef.current) clearTimeout(iframeLoadTimerRef.current);
    iframeLoadTimerRef.current = setTimeout(() => {
      setPreviewError('镜头预览加载超时，请检查 HTML 或重新播放。');
    }, 8000);
    return () => {
      if (iframeLoadTimerRef.current) clearTimeout(iframeLoadTimerRef.current);
    };
  }, [rawHtml, htmlReady, iframeKey]);

  useEffect(() => {
    editingReadyRef.current = editingReady;
  }, [editingReady]);

  useEffect(() => {
    const requestId = frameLoadRequestRef.current + 1;
    let cancelled = false;
    frameLoadRequestRef.current = requestId;
    clearPlaybackTimer();
    setHtml('');
    setLoadedFrameId('');
    setHtmlLoadError('');
    setPreviewError('');
    setEditingReady(false);
    setPlaybackState('idle');
    setElementInfo(null);
    setElementCandidates([]);
    setLayerItems([]);
    selectedElementRef.current = null;
    undoStackRef.current = [];
    setCanUndo(false);
    setDirty(false);
    if (frameId && rawHtml) {
      Promise.resolve()
        .then(() => editor.loadFrameHtml(frameId))
        .then(result => {
          if (cancelled || frameLoadRequestRef.current !== requestId) return;
          if (!result) {
            setHtmlLoadError('当前镜头 HTML 加载失败，请重试。');
            return;
          }
          const loadedHtml = getLoadedFrameHtml(result);
          if (!loadedHtml) {
            setHtmlLoadError('当前镜头暂无可加载 HTML。');
            return;
          }
          setHtml(loadedHtml);
          setLoadedFrameId(frameId);
        })
        .catch(() => {
          if (!cancelled && frameLoadRequestRef.current === requestId) {
            setHtmlLoadError('当前镜头 HTML 加载失败，请重试。');
          }
        })
        .finally(() => {
          if (!cancelled && frameLoadRequestRef.current === requestId) frameLoadRequestRef.current = 0;
        });
    } else {
      frameLoadRequestRef.current = 0;
    }
    return () => {
      cancelled = true;
    };
  }, [frameId, rawHtml, htmlReloadKey]);

  useEffect(() => () => {
    clearPlaybackTimer();
    if (iframeLoadTimerRef.current) clearTimeout(iframeLoadTimerRef.current);
  }, []);

  useEffect(() => {
    const node = previewSlotRef.current;
    if (!node) return undefined;
    const update = () => {
      const rect = node.getBoundingClientRect();
      const next = { width: Math.floor(rect.width), height: Math.floor(rect.height) };
      setPreviewSlotSize(prev => (
        prev.width === next.width && prev.height === next.height ? prev : next
      ));
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
    // 预览槽在 !frame / !rawHtml 早退分支下不渲染；分支切换会重建槽位节点，必须重挂观察
  }, [Boolean(frame), rawHtml]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function beginPlayback() {
    clearPlaybackTimer();
    const win = iframeRef.current?.contentWindow;
    if (win?.document) playFrame(win);
    removeEditorOverlay(win?.document);
    setEditingReady(false);
    setPlaybackState('playing');
    setElementInfo(null);
    setElementCandidates([]);
    selectedElementRef.current = null;
    playbackTimerRef.current = setTimeout(() => {
      finishPlayback();
    }, frameDurationMs(frame));
  }

  function finishPlayback(targetTimeMs = null) {
    clearPlaybackTimer();
    const win = iframeRef.current?.contentWindow;
    if (win?.document) {
      freezeFrame(win, targetTimeMs);
      refreshLayerItems(win.document);
    }
    setPlaybackState('ended');
    setEditingReady(true);
  }

  function jumpToEnd() {
    finishPlayback(frameDurationMs(frame));
  }

  function replay() {
    clearPlaybackTimer();
    setEditingReady(false);
    setPlaybackState('idle');
    setPreviewError('');
    setElementInfo(null);
    setElementCandidates([]);
    setLayerItems([]);
    selectedElementRef.current = null;
    setIframeKey(key => key + 1);
  }

  function reloadHtml() {
    setHtmlReloadKey(key => key + 1);
  }

  function candidatesFromPoint(doc, x, y) {
    return uniqueElements((doc.elementsFromPoint?.(x, y) || []).flatMap(node => {
      const matches = [];
      let current = node?.nodeType === 1 ? node : node?.parentElement;
      while (current && current !== doc.documentElement) {
        if (isEditableElement(current)) matches.push(current);
        current = current.parentElement;
      }
      return matches;
    }));
  }

  function dragGeometryFor(element) {
    const computed = element.ownerDocument.defaultView.getComputedStyle(element);
    const absolutePosition = absolutePositionFor(element);
    const scale = canvasScale(element.ownerDocument.defaultView);
    return {
      absolutePosition,
      left: stylePxOrFallback(element.style.left || computed.left, absolutePosition.left),
      top: stylePxOrFallback(element.style.top || computed.top, absolutePosition.top),
      width: element.getBoundingClientRect().width / scale,
      height: element.getBoundingClientRect().height / scale,
    };
  }

  // static → absolute 的转换只在真正发生编辑时执行，纯点选不动 DOM
  function ensurePositionedForEdit(element) {
    const computed = element.ownerDocument.defaultView.getComputedStyle(element);
    if (computed.position !== 'static') return;
    const absolutePosition = absolutePositionFor(element);
    element.style.position = 'absolute';
    element.style.left = `${Math.round(absolutePosition.left)}px`;
    element.style.top = `${Math.round(absolutePosition.top)}px`;
    element.style.margin = '0';
  }

  function handleIframeLoad() {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !rawHtml || !htmlReady) return;
    if (iframeLoadTimerRef.current) clearTimeout(iframeLoadTimerRef.current);
    setPreviewError('');
    installCanvasViewport(doc);
    doc.defaultView.addEventListener('resize', () => installCanvasViewport(doc));
    // HV-CANVAS-INJECT-STYLE-HERE
    doc.querySelectorAll('[data-hv-canvas-editor-style]').forEach(node => node.remove());
    const editorStyle = doc.createElement('style');
    editorStyle.setAttribute('data-hv-canvas-editor-style', 'true');
    editorStyle.textContent = `
  [data-hv-canvas-selected="true"] {
    outline: 2px solid #25f4ee !important;
    outline-offset: 4px !important;
    cursor: move !important;
  }
`;
    doc.head.appendChild(editorStyle);
    doc.addEventListener('pointerdown', event => {
      if (!editingReadyRef.current) return;
      const handle = event.target?.getAttribute?.('data-hv-editor-handle');
      const candidates = handle ? null : candidatesFromPoint(doc, event.clientX, event.clientY);
      const target = handle ? selectedElementRef.current : candidates[0];
      if (!isEditableElement(target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (candidates) setElementCandidates(candidates.map(summarizeElement).filter(Boolean));
      selectAndRender(target);
      if (target.dataset?.hvEditorLocked === 'true') return;
      const geometry = dragGeometryFor(target);
      dragRef.current = {
        element: target,
        mode: handle ? 'resize' : 'move',
        handle,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: geometry.left,
        startTop: geometry.top,
        startWidth: geometry.width,
        startHeight: geometry.height,
        minLeft: geometry.absolutePosition.minLeft,
        minTop: geometry.absolutePosition.minTop,
        maxLeft: geometry.absolutePosition.maxLeft,
        maxTop: geometry.absolutePosition.maxTop,
        scale: canvasScale(doc.defaultView),
        changed: false,
        captureTarget: event.target,
      };
      event.target.setPointerCapture?.(event.pointerId);
    }, true);
    doc.addEventListener('pointermove', event => {
      const drag = dragRef.current;
      if (!drag?.element) return;
      event.preventDefault();
      if (!drag.changed) {
        snapshotBeforeEdit();
        ensurePositionedForEdit(drag.element);
      }
      const scale = drag.scale || 1;
      const dx = (event.clientX - drag.startX) / scale;
      const dy = (event.clientY - drag.startY) / scale;
      let nextLeft = drag.startLeft;
      let nextTop = drag.startTop;
      let nextWidth = drag.startWidth;
      let nextHeight = drag.startHeight;
      if (drag.mode === 'resize') {
        if (drag.handle.includes('e')) {
          nextWidth = clamp(drag.startWidth + dx, 16, Math.max(16, drag.maxLeft - drag.startLeft));
        }
        if (drag.handle.includes('s')) {
          nextHeight = clamp(drag.startHeight + dy, 16, Math.max(16, drag.maxTop - drag.startTop));
        }
        if (drag.handle.includes('w')) {
          // 先钳宽度再回算 left：否则宽度到底后 left 仍随 dx 增长，元素会滑走
          nextWidth = clamp(drag.startWidth - dx, 16, Math.max(16, drag.startLeft + drag.startWidth - drag.minLeft));
          nextLeft = drag.startLeft + (drag.startWidth - nextWidth);
        }
        if (drag.handle.includes('n')) {
          nextHeight = clamp(drag.startHeight - dy, 16, Math.max(16, drag.startTop + drag.startHeight - drag.minTop));
          nextTop = drag.startTop + (drag.startHeight - nextHeight);
        }
        drag.element.style.width = `${Math.round(nextWidth)}px`;
        drag.element.style.height = `${Math.round(nextHeight)}px`;
      } else {
        const rect = drag.element.getBoundingClientRect();
        nextLeft = clamp(
          drag.startLeft + dx,
          drag.minLeft,
          Math.max(drag.minLeft, drag.maxLeft - rect.width / scale),
        );
        nextTop = clamp(
          drag.startTop + dy,
          drag.minTop,
          Math.max(drag.minTop, drag.maxTop - rect.height / scale),
        );
      }
      drag.element.style.left = `${Math.round(nextLeft)}px`;
      drag.element.style.top = `${Math.round(nextTop)}px`;
      drag.changed = true;
      setElementInfo(readElementInfo(drag.element));
      renderEditorOverlay(drag.element);
    }, true);
    function endDrag(event) {
      const drag = dragRef.current;
      if (drag?.element) {
        drag.captureTarget?.releasePointerCapture?.(event.pointerId);
        setElementInfo(readElementInfo(drag.element));
        renderEditorOverlay(drag.element);
        refreshLayerItems(doc);
        if (drag.changed) setDirty(true);
      }
      dragRef.current = null;
    }
    doc.addEventListener('pointerup', endDrag, true);
    doc.addEventListener('pointercancel', endDrag, true);
    beginPlayback();
  }

  function updateSelectedText(text) {
    const element = selectedElementRef.current;
    if (!element || element.dataset?.hvEditorLocked === 'true' || !canEditText(element)) return;
    writeElementText(element, text);
    setElementInfo(readElementInfo(element));
    renderEditorOverlay(element);
    refreshLayerItems(element.ownerDocument);
    setDirty(true);
  }

  function updateSelectedGeometry(next) {
    const element = selectedElementRef.current;
    if (!element || element.dataset?.hvEditorLocked === 'true') return;
    snapshotBeforeEdit();
    ensurePositionedForEdit(element);
    if (Number.isFinite(next.left)) element.style.left = `${Math.round(next.left)}px`;
    if (Number.isFinite(next.top)) element.style.top = `${Math.round(next.top)}px`;
    if (Number.isFinite(next.width)) element.style.width = `${Math.max(16, Math.round(next.width))}px`;
    if (Number.isFinite(next.height)) element.style.height = `${Math.max(16, Math.round(next.height))}px`;
    setElementInfo(readElementInfo(element));
    renderEditorOverlay(element);
    refreshLayerItems(element.ownerDocument);
    setDirty(true);
  }

  function resetSelectedPosition() {
    const element = selectedElementRef.current;
    if (!element) return;
    snapshotBeforeEdit();
    element.style.left = '';
    element.style.top = '';
    element.style.position = '';
    element.style.margin = '';
    setElementInfo(readElementInfo(element));
    renderEditorOverlay(element);
    refreshLayerItems(element.ownerDocument);
    setDirty(true);
  }

  function deleteSelectedElement() {
    const element = selectedElementRef.current;
    if (!element) return;
    snapshotBeforeEdit();
    const deletedInfo = { ...(elementInfo || readElementInfo(element)), deleted: true, text: '', width: 0, height: 0 };
    element.remove();
    selectedElementRef.current = null;
    dragRef.current = null;
    removeEditorOverlay(element.ownerDocument);
    setElementInfo(deletedInfo);
    refreshLayerItems(element.ownerDocument);
    setDirty(true);
  }

  function selectElementById(editId) {
    const element = findElementByEditId(editId);
    if (!element) return;
    selectAndRender(element);
  }

  function toggleSelectedLocked() {
    const element = selectedElementRef.current;
    if (!element) return;
    snapshotBeforeEdit();
    if (element.dataset.hvEditorLocked === 'true') delete element.dataset.hvEditorLocked;
    else element.dataset.hvEditorLocked = 'true';
    setElementInfo(readElementInfo(element));
    renderEditorOverlay(element);
    refreshLayerItems(element.ownerDocument);
    setDirty(true);
  }

  function toggleSelectedHidden() {
    const element = selectedElementRef.current;
    if (!element) return;
    snapshotBeforeEdit();
    if (element.style.display === 'none') {
      element.style.display = element.dataset.hvEditorDisplay || '';
      delete element.dataset.hvEditorDisplay;
    } else {
      element.dataset.hvEditorDisplay = element.style.display || '';
      element.style.display = 'none';
    }
    setElementInfo(readElementInfo(element));
    renderEditorOverlay(element);
    refreshLayerItems(element.ownerDocument);
    setDirty(true);
  }

  function moveSelectedLayer(direction) {
    const element = selectedElementRef.current;
    if (!element) return;
    snapshotBeforeEdit();
    const doc = element.ownerDocument;
    const values = editableElements(doc).filter(item => item !== element).map(zIndexOf);
    const current = zIndexOf(element);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    if (doc.defaultView.getComputedStyle(element).position === 'static') {
      element.style.position = 'relative';
    }
    // 已在最顶/最底时保持不变，避免反复点击让 z-index 无限膨胀
    const next = {
      up: current + 1,
      down: current - 1,
      front: current > max ? current : max + 1,
      back: current < min ? current : min - 1,
    }[direction] ?? current;
    element.style.zIndex = String(next);
    setElementInfo(readElementInfo(element));
    renderEditorOverlay(element);
    refreshLayerItems(doc);
    setDirty(true);
  }

  async function saveEdit() {
    if (saving) return null;
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !frameId) return null;
    setSaving(true);
    setPreviewError('');
    const label = elementInfo?.text || elementInfo?.label || '';
    try {
      const result = await editor.saveAndAcceptFrameEdit(frameId, {
        html: serializeDocument(doc),
        mode: 'draft',
        summary: createDraftSummary(label),
      });
      if (!result || result.success === false) {
        setPreviewError('保存修改失败，请稍后重试。');
        return null;
      }
      setDirty(false);
      undoStackRef.current = [];
      setCanUndo(false);
      return result;
    } catch (_) {
      setPreviewError('保存修改失败，请稍后重试。');
      return null;
    } finally {
      setSaving(false);
    }
  }

  function patchFrame(payload) {
    if (payload?.type === 'frame_patch') return editor.saveFrame(payload.frame_id, payload);
    return editor.saveTemplateInputs(payload);
  }

  function handleSelectFrame(nextId) {
    if (String(nextId) === String(frameId)) return;
    if (dirty && !window.confirm('当前镜头有未保存的画布修改，切换镜头将丢失，确定继续？')) return;
    editor.selectFrame(nextId);
  }

  if (!frame) {
    return <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-sm text-slate-300"><p className="m-0">请选择要编辑的帧。</p></section>;
  }

  if (!rawHtml) {
    return <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-sm text-slate-300"><p className="m-0">当前帧不是 raw_html，暂不支持画布编辑。</p></section>;
  }

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-2">
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_260px] gap-2 overflow-hidden max-[1100px]:grid-cols-1">
        <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2.5 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
          <div className="flex items-center justify-between gap-2 border-b border-slate-700 bg-slate-800 px-2.5 py-2 max-[720px]:flex-col max-[720px]:items-start">
            <span className="text-xs text-slate-300">{previewError || (playbackState === 'playing' ? '正在播放镜头动画...' : editingReady ? '已停在镜头可编辑帧，可开始编辑。' : '正在准备预览...')}</span>
            <div className="flex flex-wrap justify-end gap-1.5">
              <button className={secondaryButtonClass} type="button" disabled={disabled} onClick={replay}>重新播放</button>
              <button className={secondaryButtonClass} type="button" disabled={disabled} onClick={jumpToEnd}>跳到结尾并编辑</button>
            </div>
          </div>
          {!htmlReady && htmlLoadError ? (
            <div className="m-3 grid gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
              <p className="m-0">{htmlLoadError}</p>
              <button className="w-fit rounded-md bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled} onClick={reloadHtml}>重新加载 HTML</button>
            </div>
          ) : null}
          {!htmlReady && !htmlLoadError ? <p className="m-3 rounded-lg border border-slate-700 bg-slate-800 p-3 text-sm text-slate-300">正在加载当前镜头 HTML...</p> : null}
          <div ref={previewSlotRef} className="grid h-full min-h-0 place-items-center overflow-hidden px-2 pb-2">
            <iframe
              key={iframeKey}
              ref={iframeRef}
              className="block rounded-md border border-slate-700 bg-slate-950"
              style={previewFrameStyle}
              title="html-video 当前镜头画布"
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-same-origin"
              onLoad={handleIframeLoad}
              onError={() => setPreviewError('镜头预览加载失败，请检查 HTML 或重新播放。')}
            />
          </div>
        </div>
        <div className="grid min-h-0 min-w-0 content-start gap-3 overflow-auto pr-1">
          <HtmlVideoElementInspector
            elementInfo={elementInfo}
            candidates={elementCandidates}
            layers={layerItems}
            editingReady={editingReady}
            disabled={disabled}
            saving={saving}
            dirty={dirty}
            canUndo={canUndo}
            onUndo={undoEdit}
            onTextChange={updateSelectedText}
            onTextEditStart={snapshotBeforeEdit}
            onGeometryChange={updateSelectedGeometry}
            onResetPosition={resetSelectedPosition}
            onSaveEdit={saveEdit}
            onDeleteSelected={deleteSelectedElement}
            onSelectCandidate={selectElementById}
            onSelectLayer={selectElementById}
            onToggleLocked={toggleSelectedLocked}
            onToggleHidden={toggleSelectedHidden}
            onMoveLayer={moveSelectedLayer}
          />
          <Dialog>
            <DialogTrigger asChild>
              <button className={`${secondaryButtonClass} w-full`} type="button" disabled={disabled}>帧字段</button>
            </DialogTrigger>
            <DialogContent className="grid max-h-[86vh] w-[min(760px,calc(100vw-32px))] max-w-[760px] grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-lg border-[#d9dde5] bg-[#f8fafc] p-0 text-[#111827] shadow-[0_24px_70px_rgba(15,23,42,.28)] sm:max-w-[760px]">
              <DialogHeader className="border-b border-[#e7e9ee] bg-white px-5 py-4 pr-12">
                <DialogTitle className="text-[15px]">帧字段</DialogTitle>
                <DialogDescription>编辑当前帧的模板字段。字幕和全片旁白在顶部“字幕 / 旁白”入口编辑。</DialogDescription>
              </DialogHeader>
              <div className="grid min-h-0 gap-3 overflow-auto p-4">
                <FrameInputsPanel frame={frame} disabled={disabled} onSave={patchFrame} />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <HtmlVideoFrameStrip
        frames={editor.frames}
        selectedFrameId={editor.selectedFrameId}
        disabled={disabled}
        onSelect={handleSelectFrame}
      />
    </section>
  );
}
