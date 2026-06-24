import { useEffect, useMemo, useRef, useState } from 'react';

import {
  clamp,
  createDraftSummary,
  editableSelector,
  excludedSelector,
  formatElementLabel,
  nextEditId,
  parsePx,
} from './htmlVideoCanvasDom.js';
import { HtmlVideoElementInspector } from './HtmlVideoElementInspector.jsx';
import { HtmlVideoFrameStrip } from './HtmlVideoFrameStrip.jsx';

function frameIdOf(frame) {
  return frame?.id || frame?.scene_id || '';
}

function frameDurationMs(frame) {
  const duration = Number(frame?.duration_sec ?? frame?.durationSec ?? frame?.duration ?? 3);
  return Math.max(500, (Number.isFinite(duration) && duration > 0 ? duration : 3) * 1000);
}

function serializeDocument(doc) {
  const doctype = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}${doc.doctype.publicId ? ` PUBLIC "${doc.doctype.publicId}"` : ''}${doc.doctype.systemId ? ` "${doc.doctype.systemId}"` : ''}>`
    : '<!doctype html>';
  return `${doctype}\n${doc.documentElement.outerHTML}`;
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

function freezeFrame(win) {
  const doc = win.document;
  doc.querySelectorAll('[data-hv-canvas-freeze]').forEach(node => node.remove());
  for (const animation of doc.getAnimations()) {
    try {
      const timing = animation.effect?.getTiming?.();
      if (Number.isFinite(timing?.duration)) animation.currentTime = timing.duration;
      animation.pause();
    } catch (_) {
      try { animation.pause(); } catch (_) {}
    }
  }
  if (win.gsap?.globalTimeline) {
    try { win.gsap.globalTimeline.pause(); } catch (_) {}
  }
  const style = doc.createElement('style');
  style.setAttribute('data-hv-canvas-freeze', 'true');
  style.textContent = '*{animation-play-state:paused!important;transition-property:none!important;}';
  doc.head.appendChild(style);
}

function viewportSize(win) {
  const doc = win.document;
  return {
    width: win.innerWidth || doc.documentElement.clientWidth || 0,
    height: win.innerHeight || doc.documentElement.clientHeight || 0,
  };
}

function absolutePositionFor(element) {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  const rect = element.getBoundingClientRect();
  const offsetParent = element.offsetParent || doc.body;
  const parentRect = offsetParent.getBoundingClientRect();
  const viewport = viewportSize(win);
  const parentIsBody = offsetParent === doc.body || offsetParent === doc.documentElement;
  return {
    left: rect.left - parentRect.left + offsetParent.scrollLeft,
    top: rect.top - parentRect.top + offsetParent.scrollTop,
    parentWidth: parentIsBody ? viewport.width : offsetParent.clientWidth,
    parentHeight: parentIsBody ? viewport.height : offsetParent.clientHeight,
  };
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
  const dragRef = useRef(null);
  const [html, setHtml] = useState('');
  const [iframeKey, setIframeKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [editingReady, setEditingReady] = useState(false);
  const [playbackState, setPlaybackState] = useState('idle');
  const [elementInfo, setElementInfo] = useState(null);

  const frame = editor.selectedFrame;
  const frameId = frameIdOf(frame);
  const rawHtml = frame?.source_mode === 'raw_html';
  const activeDraftId = frame?.active_draft_id || '';
  const disabled = editor.disabled;

  const srcDoc = useMemo(() => html || '<!doctype html><html><body></body></html>', [html]);

  useEffect(() => {
    if (!rawHtml || !html) return undefined;
    setPreviewError('');
    if (iframeLoadTimerRef.current) clearTimeout(iframeLoadTimerRef.current);
    iframeLoadTimerRef.current = setTimeout(() => {
      setPreviewError('镜头预览加载超时，请检查 HTML 或重新播放。');
    }, 8000);
    return () => {
      if (iframeLoadTimerRef.current) clearTimeout(iframeLoadTimerRef.current);
    };
  }, [rawHtml, html, iframeKey]);

  useEffect(() => {
    editingReadyRef.current = editingReady;
  }, [editingReady]);

  useEffect(() => {
    setHtml('');
    setPreviewError('');
    setEditingReady(false);
    setPlaybackState('idle');
    setElementInfo(null);
    selectedElementRef.current = null;
    if (frameId && rawHtml) editor.loadFrameHtml(frameId);
  }, [frameId, rawHtml]);

  useEffect(() => {
    setHtml(editor.frameHtml || '');
  }, [editor.frameHtml, frameId]);

  useEffect(() => () => {
    if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
    if (iframeLoadTimerRef.current) clearTimeout(iframeLoadTimerRef.current);
  }, []);

  function beginPlayback() {
    if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
    setEditingReady(false);
    setPlaybackState('playing');
    setElementInfo(null);
    selectedElementRef.current = null;
    playbackTimerRef.current = setTimeout(() => {
      jumpToEnd();
    }, frameDurationMs(frame));
  }

  function jumpToEnd() {
    if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
    const win = iframeRef.current?.contentWindow;
    if (win?.document) freezeFrame(win);
    setPlaybackState('ended');
    setEditingReady(true);
  }

  function replay() {
    setEditingReady(false);
    setPlaybackState('idle');
    setPreviewError('');
    setElementInfo(null);
    selectedElementRef.current = null;
    setHtml(editor.frameHtml || '');
    setIframeKey(key => key + 1);
  }

  function handleIframeLoad() {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !rawHtml) return;
    if (iframeLoadTimerRef.current) clearTimeout(iframeLoadTimerRef.current);
    setPreviewError('');
    // HV-CANVAS-INJECT-STYLE-HERE
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
        startLeft: parsePx(target.style.left || computed.left || absolutePosition.left),
        startTop: parsePx(target.style.top || computed.top || absolutePosition.top),
        parentWidth: absolutePosition.parentWidth,
        parentHeight: absolutePosition.parentHeight,
      };
      target.setPointerCapture?.(event.pointerId);
    }, true);
    doc.addEventListener('pointermove', event => {
      const drag = dragRef.current;
      if (!drag?.element) return;
      event.preventDefault();
      const rect = drag.element.getBoundingClientRect();
      const nextLeft = clamp(drag.startLeft + event.clientX - drag.startX, 0, Math.max(0, drag.parentWidth - rect.width));
      const nextTop = clamp(drag.startTop + event.clientY - drag.startY, 0, Math.max(0, drag.parentHeight - rect.height));
      drag.element.style.left = `${Math.round(nextLeft)}px`;
      drag.element.style.top = `${Math.round(nextTop)}px`;
      setElementInfo(readElementInfo(drag.element));
    }, true);
    doc.addEventListener('pointerup', event => {
      const drag = dragRef.current;
      if (drag?.element) {
        drag.element.releasePointerCapture?.(event.pointerId);
        setElementInfo(readElementInfo(drag.element));
      }
      dragRef.current = null;
    }, true);
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

  async function saveDraft() {
    if (saving) return null;
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !frameId) return null;
    setSaving(true);
    const label = elementInfo?.text || elementInfo?.label || '';
    try {
      return await editor.saveFrameHtmlDraft(frameId, {
        html: serializeDocument(doc),
        mode: 'draft',
        summary: createDraftSummary(label),
      });
    } finally {
      setSaving(false);
    }
  }

  function renderDraft() {
    if (!frameId || !activeDraftId) return null;
    return editor.renderFramePreview(frameId, { draft_id: activeDraftId, run_layout_qa: true });
  }

  if (!frame) {
    return <section className="creative-video-editor-panel"><p>请选择要编辑的帧。</p></section>;
  }

  if (!rawHtml) {
    return <section className="creative-video-editor-panel"><p>当前帧不是 raw_html，暂不支持画布编辑。</p></section>;
  }

  return (
    <section className="html-video-canvas-editor">
      <div className="html-video-canvas-workspace">
        <div className="html-video-canvas-stage">
          <div className="html-video-canvas-toolbar">
            <span>{previewError || (playbackState === 'playing' ? '正在播放镜头动画...' : editingReady ? '已停在镜头结束帧，可开始编辑。' : '正在准备预览...')}</span>
            <div className="creative-video-editor-inline-actions">
              <button type="button" disabled={disabled} onClick={replay}>重新播放</button>
              <button type="button" disabled={disabled} onClick={jumpToEnd}>跳到结尾并编辑</button>
              <button type="button" disabled={disabled || saving || !elementInfo} onClick={saveDraft}>{saving ? '正在保存...' : '保存为草稿'}</button>
              <button type="button" disabled={disabled || saving || !activeDraftId} onClick={renderDraft}>渲染草稿</button>
            </div>
          </div>
          <iframe
            key={iframeKey}
            ref={iframeRef}
            title="html-video 当前镜头画布"
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-same-origin"
            onLoad={handleIframeLoad}
            onError={() => setPreviewError('镜头预览加载失败，请检查 HTML 或重新播放。')}
          />
        </div>
        <HtmlVideoElementInspector
          elementInfo={elementInfo}
          editingReady={editingReady}
          disabled={disabled}
          saving={saving}
          activeDraftId={activeDraftId}
          onTextChange={updateSelectedText}
          onResetPosition={resetSelectedPosition}
          onSaveDraft={saveDraft}
          onRenderDraft={renderDraft}
        />
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
