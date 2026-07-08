import { useEffect, useMemo, useRef, useState } from 'react';
import {
  canEditText,
  clamp,
  createDraftSummary,
  fitPreviewBox,
  previewAspectRatio,
} from './htmlVideoCanvasDom.mjs';
import {
  absolutePositionFor,
  canvasScale,
  frameDurationMs,
  frameIdOf,
  freezeFrame,
  getLoadedFrameHtml,
  installCanvasViewport,
  isEditableElement,
  playFrame,
  readElementInfo,
  selectElement,
  serializeDocument,
  stylePxOrFallback,
  summarizeElement,
  uniqueElements,
  writeElementText,
  zIndexOf,
} from './htmlVideoCanvasRuntime.mjs';

// 预览槽在 !frame / !rawHtml 早退分支下不渲染；分支切换会重建槽位节点，必须重挂观察
function usePreviewSlotSize(frame, rawHtml) {
  const previewSlotRef = useRef(null);
  const [previewSlotSize, setPreviewSlotSize] = useState({ width: 0, height: 0 });

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
  }, [Boolean(frame), rawHtml]);

  return { previewSlotRef, previewSlotSize };
}

// HtmlVideoCanvasEditor 的交互核心：iframe 加载与播放控制、画布点选/拖拽/撤销、
// 元素编辑回调与保存。从组件里整体搬出，逻辑与搬出前保持一致。
export function useCanvasEditing(editor) {
  const iframeRef = useRef(null);
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
  const [pendingFrameId, setPendingFrameId] = useState(null);

  const frame = editor.selectedFrame;
  const frameId = frameIdOf(frame);
  const rawHtml = frame?.source_mode === 'raw_html';
  const disabled = editor.disabled;

  const { previewSlotRef, previewSlotSize } = usePreviewSlotSize(frame, rawHtml);

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
    return Array.from(doc.body.querySelectorAll('*')).filter(isEditableElement);
  }

  function refreshLayerItems(doc = selectedDocument()) {
    const items = editableElements(doc)
      .map(summarizeElement)
      .filter(Boolean)
      .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
    setLayerItems(items);
  }

  // 按键/数字微调的热路径只更新选中元素的条目，不全量重扫 DOM
  function updateLayerItem(element) {
    const summary = summarizeElement(element);
    if (!summary) return;
    setLayerItems(prev => prev.map(item => (item.editId === summary.editId ? summary : item)));
  }

  function findElementByEditId(editId, doc = selectedDocument()) {
    if (!editId || !doc?.body) return null;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(editId) : String(editId).replace(/"/g, '\\"');
    return doc.body.querySelector(`[data-hv-edit-id="${escaped}"]`);
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
    updateLayerItem(element);
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
    updateLayerItem(element);
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
    if (dirty) {
      setPendingFrameId(nextId);
      return;
    }
    editor.selectFrame(nextId);
  }

  return {
    frame,
    frameId,
    rawHtml,
    disabled,
    htmlReady,
    htmlLoadError,
    srcDoc,
    previewFrameStyle,
    previewError,
    setPreviewError,
    playbackState,
    editingReady,
    saving,
    dirty,
    canUndo,
    elementInfo,
    elementCandidates,
    layerItems,
    iframeKey,
    iframeRef,
    previewSlotRef,
    pendingFrameId,
    setPendingFrameId,
    replay,
    jumpToEnd,
    reloadHtml,
    handleIframeLoad,
    undoEdit,
    snapshotBeforeEdit,
    updateSelectedText,
    updateSelectedGeometry,
    resetSelectedPosition,
    saveEdit,
    deleteSelectedElement,
    selectElementById,
    toggleSelectedLocked,
    toggleSelectedHidden,
    moveSelectedLayer,
    patchFrame,
    handleSelectFrame,
  };
}
