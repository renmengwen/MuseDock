import { useEffect, useMemo, useRef, useState } from 'react';

import {
  clamp,
  createDraftSummary,
  editableSelector,
  excludedSelector,
  formatElementLabel,
  nextEditId,
  parsePx,
} from './htmlVideoCanvasDom.mjs';
import { HtmlVideoElementInspector } from './HtmlVideoElementInspector.jsx';
import { HtmlVideoFrameStrip } from './HtmlVideoFrameStrip.jsx';
import { FrameInputsPanel } from './FrameInputsPanel.jsx';
import { TemplateInputsPanel } from './TemplateInputsPanel.jsx';
import { NarrationPanel } from './NarrationPanel.jsx';
import { CaptionsPanel } from './CaptionsPanel.jsx';

function frameIdOf(frame) {
  return frame?.id || frame?.scene_id || '';
}

function frameDurationMs(frame) {
  const duration = Number(frame?.duration_sec ?? frame?.durationSec ?? frame?.duration ?? 3);
  return Math.max(500, (Number.isFinite(duration) && duration > 0 ? duration : 3) * 1000);
}

function serializeDocument(doc) {
  const root = doc.documentElement.cloneNode(true);
  root.querySelectorAll('[data-hv-canvas-freeze],[data-hv-canvas-editor-style],[data-hv-canvas-viewport-style]').forEach(node => node.remove());
  root.querySelectorAll('[data-hv-canvas-selected]').forEach(node => {
    node.removeAttribute('data-hv-canvas-selected');
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

function installCanvasViewport(doc) {
  const win = doc.defaultView;
  const viewport = viewportSize(win);
  const body = doc.body;
  const designWidth = Math.max(
    doc.documentElement.scrollWidth,
    doc.documentElement.clientWidth,
    body?.scrollWidth || 0,
    body?.offsetWidth || 0,
    1,
  );
  const designHeight = Math.max(
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
  const editId = ensureEditId(element);
  const info = {
    editId,
    textKey: element.dataset?.textKey || '',
    role: element.dataset?.role || '',
    className: element.className || '',
    tagName: element.tagName || '',
    text: (element.innerText || element.textContent || '').trim(),
    selector: elementSelector(element),
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
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

export function HtmlVideoCanvasEditor({ editor }) {
  const iframeRef = useRef(null);
  const playbackTimerRef = useRef(null);
  const iframeLoadTimerRef = useRef(null);
  const selectedElementRef = useRef(null);
  const editingReadyRef = useRef(false);
  const frameLoadRequestRef = useRef(0);
  const dragRef = useRef(null);
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

  const frame = editor.selectedFrame;
  const frameId = frameIdOf(frame);
  const rawHtml = frame?.source_mode === 'raw_html';
  const disabled = editor.disabled;

  const htmlReady = Boolean(html && loadedFrameId === frameId);
  const srcDoc = useMemo(() => (
    htmlReady ? html : '<!doctype html><html><body></body></html>'
  ), [htmlReady, html]);

  function clearPlaybackTimer() {
    if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
    playbackTimerRef.current = null;
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
    selectedElementRef.current = null;
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

  function beginPlayback() {
    clearPlaybackTimer();
    const win = iframeRef.current?.contentWindow;
    if (win?.document) playFrame(win);
    setEditingReady(false);
    setPlaybackState('playing');
    setElementInfo(null);
    selectedElementRef.current = null;
    playbackTimerRef.current = setTimeout(() => {
      finishPlayback();
    }, frameDurationMs(frame));
  }

  function finishPlayback(targetTimeMs = null) {
    clearPlaybackTimer();
    const win = iframeRef.current?.contentWindow;
    if (win?.document) freezeFrame(win, targetTimeMs);
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
    selectedElementRef.current = null;
    setIframeKey(key => key + 1);
  }

  function reloadHtml() {
    setHtmlReloadKey(key => key + 1);
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
    outline: 3px solid #10b981 !important;
    outline-offset: 4px !important;
    cursor: move !important;
  }
`;
    doc.head.appendChild(editorStyle);
    doc.addEventListener('click', event => {
      if (!editingReadyRef.current) return;
      const target = event.target?.closest?.(editableSelector);
      if (!isEditableElement(target)) return;
      event.preventDefault();
      event.stopPropagation();
      selectedElementRef.current = target;
      setElementInfo(selectElement(target));
    }, true);
    doc.addEventListener('pointerdown', event => {
      if (!editingReadyRef.current) return;
      const target = event.target?.closest?.(editableSelector);
      if (!isEditableElement(target)) return;
      event.preventDefault();
      event.stopPropagation();
      selectedElementRef.current = target;
      setElementInfo(selectElement(target));
      const rect = target.getBoundingClientRect();
      const computed = doc.defaultView.getComputedStyle(target);
      const absolutePosition = absolutePositionFor(target);
      if (computed.position === 'static') {
        target.style.position = 'absolute';
        target.style.left = `${Math.round(absolutePosition.left)}px`;
        target.style.top = `${Math.round(absolutePosition.top)}px`;
        target.style.margin = '0';
      }
      dragRef.current = {
        element: target,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: stylePxOrFallback(target.style.left || computed.left, absolutePosition.left),
        startTop: stylePxOrFallback(target.style.top || computed.top, absolutePosition.top),
        minLeft: absolutePosition.minLeft,
        minTop: absolutePosition.minTop,
        maxLeft: absolutePosition.maxLeft,
        maxTop: absolutePosition.maxTop,
        scale: canvasScale(doc.defaultView),
      };
      target.setPointerCapture?.(event.pointerId);
    }, true);
    doc.addEventListener('pointermove', event => {
      const drag = dragRef.current;
      if (!drag?.element) return;
      event.preventDefault();
      const rect = drag.element.getBoundingClientRect();
      const scale = drag.scale || 1;
      const nextLeft = clamp(
        drag.startLeft + (event.clientX - drag.startX) / scale,
        drag.minLeft,
        Math.max(drag.minLeft, drag.maxLeft - rect.width / scale),
      );
      const nextTop = clamp(
        drag.startTop + (event.clientY - drag.startY) / scale,
        drag.minTop,
        Math.max(drag.minTop, drag.maxTop - rect.height / scale),
      );
      drag.element.style.left = `${Math.round(nextLeft)}px`;
      drag.element.style.top = `${Math.round(nextTop)}px`;
      setElementInfo(readElementInfo(drag.element));
    }, true);
    function endDrag(event) {
      const drag = dragRef.current;
      if (drag?.element) {
        drag.element.releasePointerCapture?.(event.pointerId);
        setElementInfo(readElementInfo(drag.element));
      }
      dragRef.current = null;
    }
    doc.addEventListener('pointerup', endDrag, true);
    doc.addEventListener('pointercancel', endDrag, true);
    beginPlayback();
  }

  function updateSelectedText(text) {
    const element = selectedElementRef.current;
    if (!element) return;
    writeElementText(element, text);
    setElementInfo(readElementInfo(element));
  }

  function resetSelectedPosition() {
    const element = selectedElementRef.current;
    if (!element) return;
    element.style.left = '';
    element.style.top = '';
    element.style.position = '';
    element.style.margin = '';
    setElementInfo(readElementInfo(element));
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

  if (!frame) {
    return <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-sm text-slate-300"><p className="m-0">请选择要编辑的帧。</p></section>;
  }

  if (!rawHtml) {
    return <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-sm text-slate-300"><p className="m-0">当前帧不是 raw_html，暂不支持画布编辑。</p></section>;
  }

  return (
    <section className="grid min-w-0 gap-2">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_260px] gap-2 max-[1100px]:grid-cols-1">
        <div className="grid min-w-0 gap-2.5 rounded-lg border border-slate-700 bg-slate-950">
          <div className="flex items-center justify-between gap-2 border-b border-slate-700 bg-slate-800 px-2.5 py-2 max-[720px]:flex-col max-[720px]:items-start">
            <span className="text-xs text-slate-300">{previewError || (playbackState === 'playing' ? '正在播放镜头动画...' : editingReady ? '已停在镜头可编辑帧，可开始编辑。' : '正在准备预览...')}</span>
            <div className="flex flex-wrap justify-end gap-1.5">
              <button className="min-h-7 rounded-md border border-slate-700 bg-slate-900 px-2.5 text-xs font-bold text-slate-100 transition hover:border-[#25f4ee]/60 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled} onClick={replay}>重新播放</button>
              <button className="min-h-7 rounded-md border border-slate-700 bg-slate-900 px-2.5 text-xs font-bold text-slate-100 transition hover:border-[#25f4ee]/60 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled} onClick={jumpToEnd}>跳到结尾并编辑</button>
              <button className="min-h-7 rounded-md bg-[#fe2c55] px-2.5 text-xs font-bold text-white transition hover:bg-[#f2214b] disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled || saving || !elementInfo} onClick={saveEdit}>{saving ? '正在保存...' : '保存修改'}</button>
            </div>
          </div>
          {!htmlReady && htmlLoadError ? (
            <div className="m-3 grid gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
              <p className="m-0">{htmlLoadError}</p>
              <button className="w-fit rounded-md bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled} onClick={reloadHtml}>重新加载 HTML</button>
            </div>
          ) : null}
          {!htmlReady && !htmlLoadError ? <p className="m-3 rounded-lg border border-slate-700 bg-slate-800 p-3 text-sm text-slate-300">正在加载当前镜头 HTML...</p> : null}
          <iframe
            key={iframeKey}
            ref={iframeRef}
            className="mx-auto mb-2.5 mt-0 aspect-video w-full max-w-[min(560px,65vh)] rounded-md border border-slate-700 bg-slate-950"
            title="html-video 当前镜头画布"
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-same-origin"
            onLoad={handleIframeLoad}
            onError={() => setPreviewError('镜头预览加载失败，请检查 HTML 或重新播放。')}
          />
        </div>
        <div className="grid min-w-0 content-start gap-3">
          <HtmlVideoElementInspector
            elementInfo={elementInfo}
            editingReady={editingReady}
            disabled={disabled}
            saving={saving}
            onTextChange={updateSelectedText}
            onResetPosition={resetSelectedPosition}
            onSaveEdit={saveEdit}
          />
          <details className="rounded-lg border border-slate-700 bg-slate-800 p-3 text-slate-100">
            <summary className="cursor-pointer text-sm font-bold">帧字段 / 旁白 / 字幕</summary>
            <FrameInputsPanel frame={frame} disabled={disabled} onSave={patchFrame} />
            <NarrationPanel narration={editor.project?.narration} disabled={disabled} onSave={editor.saveTemplateInputs} onRegenerate={editor.regenerateNarration} />
            <CaptionsPanel captions={frame?.captions || []} selectedFrameId={frameId} disabled={disabled} onSave={patchFrame} />
            <TemplateInputsPanel schema={editor.project?.template_schema || editor.project?.input_schema || {}} values={editor.project?.inputs || {}} disabled={disabled} onSave={editor.saveTemplateInputs} />
          </details>
        </div>
      </div>
      <HtmlVideoFrameStrip
        frames={editor.frames}
        selectedFrameId={editor.selectedFrameId}
        disabled={disabled}
        onSelect={editor.selectFrame}
      />
    </section>
  );
}
