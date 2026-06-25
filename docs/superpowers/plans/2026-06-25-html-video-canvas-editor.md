# Html Video Canvas Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 6, 7, and 8 all modify `HtmlVideoCanvasEditor.jsx` and MUST run sequentially, not in parallel.

**Goal:** Add a html-video style visual secondary-editing canvas that plays each frame from start to end, then freezes the final frame for element-level drag and text edits, while preserving the existing source, draft, layout QA, AI edit, field, and export workflows.

**Architecture:** Implement the first version entirely on the frontend and reuse the existing HTML draft APIs: the canvas edits the current frame HTML in an iframe, saves the modified HTML as a frame draft, then uses the existing preview render, layout QA, accept, and discard flow. The feature is intentionally a repair editor, not a full design tool: one selected DOM element at a time, final-state layout edits only, no animation keyframe editing.

**Tech Stack:** React, existing `useHtmlVideoProject` hook, iframe `srcDoc`, DOM APIs, CSS overlays, existing `/html-video-project/frames/:frame_id/html`, draft, render, and layout QA endpoints, Node assert-based tests.

---

## Scope

Build this in the current project, on `dev`, without adding dependencies.

Included:

- A new `画布` tab in `HtmlVideoProjectEditor`.
- A large iframe preview for the selected raw HTML frame.
- Automatic frame playback from `0s` to `duration_sec`, then frozen editable mode.
- A `跳到结尾并编辑` shortcut.
- Click-to-select editable DOM elements inside the iframe.
- Drag selected element after playback finishes.
- Right-side element inspector with text, selector, X/Y, size, and action buttons.
- Bottom frame strip using existing `frames`.
- Save modified iframe DOM as an HTML draft with `saveFrameHtmlDraft`.
- Render draft with `renderFramePreview(..., { run_layout_qa: true })`.
- Accept/discard draft with the existing draft panel behavior.
- Focused tests for component wiring and core helper behavior.

Excluded from this plan:

- Multi-select.
- Snap lines.
- Layer tree.
- Timeline keyframe editing.
- Editing elements while animation is still playing.
- Backend element patch endpoint.
- New persistent project schema fields.
- New third-party drag/drop package.

Reason for exclusions: the current bug class is layout repair after generated animation settles. Existing draft APIs already solve persistence, review, and rollback.

## Existing Context

Current main editor:

- `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx`
  - Current tabs: `源码`, `草稿`, `布局检查`, `AI 修改`, `字段`, `导出`.
  - It already has `editor.loadFrameHtml`, `editor.saveFrameHtmlDraft`, `editor.renderFramePreview`, `editor.acceptFrameDraft`, `editor.discardFrameDraft`, `editor.inspectLayout`, and `editor.iterateFrame`.

Existing hook:

- `frontend-react/src/hooks/useHtmlVideoProject.js`
  - Stores `project`, `frames`, `selectedFrame`, `selectedFrameId`, `frameHtml`, `layoutQa`, `status`, `message`, and mutation helpers.
  - `loadFrameHtml(frameId)` loads current frame HTML.
  - `saveFrameHtmlDraft(frameId, payload)` saves an HTML draft.
  - `renderFramePreview(frameId, payload)` renders a frame preview.

Existing API client:

- `frontend-react/src/api/client.js`
  - `getHtmlVideoProjectFrameHtml(workflowId, frameId)`
  - `saveHtmlVideoProjectFrameHtml(workflowId, frameId, payload)`
  - `renderHtmlVideoProject(workflowId, payload)`
  - `inspectHtmlVideoProjectLayout(workflowId, payload)`

Current server routes already reserve element endpoint paths:

- `server/routes/creativeWorkflows.js`
  - Existing draft routes are implemented.
  - Reserved element route exists but is intentionally not used in this plan:
    `/html-video-project/frames/:frame_id/elements/:element_id`

## File Structure

Create:

- `frontend-react/src/components/creative-video-editor/htmlVideoCanvasDom.js`
  - Pure-ish helper functions for selector names, editable-element filtering, edit ids, safe numeric parsing, draft summary, style patching, and final HTML serialization.

- `frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx`
  - Main canvas tab component.
  - Owns iframe playback state, selected element state, drag interaction, and save/render actions.

- `frontend-react/src/components/creative-video-editor/HtmlVideoFrameStrip.jsx`
  - Bottom frame selector strip with compact frame cards.

- `frontend-react/src/components/creative-video-editor/HtmlVideoElementInspector.jsx`
  - Right-side selected-element panel.

- `tests/test-html-video-canvas-dom.js`
  - Unit tests for helper behavior that can run in Node without a browser.

- `tests/test-html-video-canvas-editor-components.mjs`
  - Static/component wiring tests matching the repo's existing frontend test style.

Modify:

- `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx`
  - Add the `画布` tab.
  - Make `画布` the default active tab.
  - Render `HtmlVideoCanvasEditor`.
  - Keep every existing tab and existing behavior.

- `frontend-react/src/styles.css`
  - Add bounded styles for canvas editor, frame strip, iframe frame, overlay status, element inspector, and drag affordances.
  - Do not add broad global selectors.

- `tests/run-all.js`
  - Include the two new tests if this file enumerates tests explicitly. If it auto-discovers files, no change is required.

## Interaction Contract

Frame opening flow:

1. User opens `画布` tab.
2. If selected frame is raw HTML, call `editor.loadFrameHtml(frameId)` if `editor.frameHtml` is empty or belongs to another frame.
3. Render iframe with the loaded HTML.
4. Disable editing.
5. Let animation play from `0s` until `duration_sec`.
6. Freeze animations.
7. Enable editing.

Shortcut:

- `跳到结尾并编辑` immediately freezes animations and enables editing.

Drag flow:

1. User clicks an editable element.
2. The element gets a visible selection outline.
3. User drags it.
4. The element moves in the iframe.
5. User clicks `保存为草稿`.
6. Component serializes `<!doctype html>` plus iframe document HTML.
7. Call:

```js
editor.saveFrameHtmlDraft(frameId, {
  html,
  mode: 'draft',
  summary: `画布调整：${label}`,
});
```

8. If draft save returns an active draft id, call:

```js
editor.renderFramePreview(frameId, {
  draft_id: draftId,
  run_layout_qa: true,
});
```

9. User accepts or discards the draft using existing functions.

Editing mode semantics:

- The canvas edits the final stable layout, not animation keyframes.
- Editing is disabled during playback.
- The user can replay the frame; replay exits editing mode until playback completes again.
- Generated system caption layer is not editable.

## Editable Element Rules

Candidate selector:

```js
const EDITABLE_SELECTOR = [
  '[data-text-key]',
  '[data-role]',
  '.headline',
  '.subtitle',
  '.body-text',
  '.body-copy',
  '.card-title',
  '.complaint',
  '.badge',
  '.chip',
  'h1',
  'h2',
  'h3',
  'p',
  'li',
].join(',');
```

Selection priority:

1. Prefer semantic edit anchors: `[data-text-key]` and `[data-role]`.
2. Then use known generated classes such as `.card-title`, `.complaint`, `.badge`, and `.chip`.
3. Use broad tag selectors (`h1`, `h2`, `h3`, `p`, `li`) only as a fallback for generated raw HTML that lacks semantic anchors.
4. Never select system managed captions or document infrastructure elements.

Excluded selector:

```js
const EXCLUDED_SELECTOR = [
  'html',
  'body',
  'head',
  'style',
  'script',
  'link',
  'meta',
  '.hv-caption-layer',
  '.hv-caption-item',
  '[data-hv-managed="true"]',
  '[data-role="subtitle-caption"]',
].join(',');
```

Selection label priority:

1. `data-text-key`
2. `data-role`
3. `data-hv-edit-id`
4. First non-empty class name
5. tag name

When an element is first selected, ensure it has:

```html
data-hv-edit-id="hv_edit_001"
```

The id counter is per iframe document and stable after saving because the attribute remains in the draft HTML.

## Layout Mutation Rules

On drag start:

- Read element rect.
- Read iframe document body rect.
- Record pointer start.
- Record original inline styles.

On first drag move:

- If computed `position` is `static`, set:

```css
position: absolute;
left: <current containing-block x>px;
top: <current containing-block y>px;
margin: 0;
```

- Convert viewport coordinates from `getBoundingClientRect()` into the coordinate system used by `left/top`. Do not assign `rect.left` and `rect.top` directly unless the positioned containing block is the viewport.
- Use `offsetParent || doc.body` as the containing block for V1.
- Compute:

```js
const parentRect = offsetParent.getBoundingClientRect();
const nextLeft = rect.left - parentRect.left + offsetParent.scrollLeft;
const nextTop = rect.top - parentRect.top + offsetParent.scrollTop;
```

- Do not rewrite parent layout in V1.

On every drag move:

- Update `left` and `top`.
- Clamp within the element's positioned containing block. If the containing block is `body`, use the iframe viewport size from `win.innerWidth/innerHeight` or `doc.documentElement.clientWidth/clientHeight`, not `doc.documentElement.getBoundingClientRect()`.
- Do not write `transform`, because generated animations often use `transform`.
- Preserve original classes and data attributes.

On save:

- Serialize full HTML.
- Do not strip scripts.
- Do not remove generated animation CSS.
- Do not convert the current visual frame into a static screenshot.

## Playback and Freeze Rules

On iframe load:

Inject a helper into the iframe document by evaluating through `iframe.contentWindow`.

Freeze helper behavior:

```js
function freezeFrame(win) {
  const doc = win.document;
  doc.getAnimations().forEach(animation => {
    try {
      animation.pause();
      animation.currentTime = animation.effect?.getTiming?.().duration || animation.currentTime;
    } catch (_) {
      try { animation.pause(); } catch (_) {}
    }
  });
  if (win.gsap?.globalTimeline) {
    try { win.gsap.globalTimeline.pause(); } catch (_) {}
  }
  const style = doc.createElement('style');
  style.setAttribute('data-hv-canvas-freeze', 'true');
  style.textContent = '*{animation-play-state:paused!important;transition-property:none!important;}';
  doc.head.appendChild(style);
}
```

Limit: this freezes CSS Animations, Web Animations API animations, and GSAP global timeline when present. It does not guarantee stopping custom `requestAnimationFrame` loops, Three.js render loops, Anime.js timelines, or arbitrary timer-driven animation libraries in generated HTML. Those are known V1 constraints.

Replay helper behavior:

- Remove `[data-hv-canvas-freeze]`.
- Reload iframe `srcDoc` from the original loaded HTML.
- Force iframe remount with a React `key`; setting the same `srcDoc` string is not enough because React may skip the iframe reload.
- Disable editing.
- Start the playback timer again.

Playback timer:

```js
const durationMs = Math.max(500, Number(frame.duration_sec || frame.duration || 3) * 1000);
```

When timer completes, call `freezeFrame()` and enable editing.

## Task 1: Canvas DOM Helpers

**Files:**

- Create: `frontend-react/src/components/creative-video-editor/htmlVideoCanvasDom.js`
- Test: `tests/test-html-video-canvas-dom.js`

- [ ] **Step 1: Create failing helper test**

Create `tests/test-html-video-canvas-dom.js`:

```js
const assert = require('assert');
const {
  clamp,
  createDraftSummary,
  editableSelector,
  excludedSelector,
  formatElementLabel,
  nextEditId,
  parsePx,
} = require('../frontend-react/src/components/creative-video-editor/htmlVideoCanvasDom.js');

assert.equal(clamp(5, 1, 4), 4);
assert.equal(clamp(-2, 1, 4), 1);
assert.equal(clamp(3, 1, 4), 3);

assert.equal(parsePx('12px'), 12);
assert.equal(parsePx(''), 0);
assert.equal(parsePx('auto'), 0);
assert.equal(parsePx('3.5px'), 3.5);

assert.ok(editableSelector.includes('[data-text-key]'));
assert.ok(editableSelector.includes('[data-role]'));
assert.ok(excludedSelector.includes('.hv-caption-layer'));
assert.ok(excludedSelector.includes('[data-hv-managed="true"]'));

assert.equal(formatElementLabel({
  textKey: 'headline',
  role: 'title',
  editId: 'hv_edit_001',
  className: 'card-title',
  tagName: 'h1',
}), 'headline');

assert.equal(formatElementLabel({
  textKey: '',
  role: 'complaint',
  editId: 'hv_edit_001',
  className: 'complaint',
  tagName: 'div',
}), 'complaint');

assert.equal(formatElementLabel({
  textKey: '',
  role: '',
  editId: '',
  className: 'card-title primary',
  tagName: 'h1',
}), '.card-title');

assert.equal(nextEditId(new Set()), 'hv_edit_001');
assert.equal(nextEditId(new Set(['hv_edit_001', 'hv_edit_002'])), 'hv_edit_003');
assert.equal(createDraftSummary('太重'), '画布调整：太重');
assert.equal(createDraftSummary(''), '画布调整：元素位置');

console.log('test-html-video-canvas-dom passed');
```

- [ ] **Step 2: Run test and confirm it fails**

Run:

```powershell
node tests/test-html-video-canvas-dom.js
```

Expected:

```text
Error: Cannot find module '../frontend-react/src/components/creative-video-editor/htmlVideoCanvasDom.js'
```

- [ ] **Step 3: Implement helpers with CommonJS-compatible exports**

Create `frontend-react/src/components/creative-video-editor/htmlVideoCanvasDom.js`:

```js
const editableParts = [
  '[data-text-key]',
  '[data-role]',
  '.headline',
  '.subtitle',
  '.body-text',
  '.body-copy',
  '.card-title',
  '.complaint',
  '.badge',
  '.chip',
  'h1',
  'h2',
  'h3',
  'p',
  'li',
];

const excludedParts = [
  'html',
  'body',
  'head',
  'style',
  'script',
  'link',
  'meta',
  '.hv-caption-layer',
  '.hv-caption-item',
  '[data-hv-managed="true"]',
  '[data-role="subtitle-caption"]',
];

const editableSelector = editableParts.join(',');
const excludedSelector = excludedParts.join(',');

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function parsePx(value) {
  const number = Number(String(value || '').replace(/px$/i, ''));
  return Number.isFinite(number) ? number : 0;
}

function formatElementLabel(info = {}) {
  if (info.textKey) return String(info.textKey);
  if (info.role) return String(info.role);
  if (info.editId) return String(info.editId);
  const firstClass = String(info.className || '').trim().split(/\s+/).filter(Boolean)[0];
  if (firstClass) return `.${firstClass}`;
  return String(info.tagName || 'element').toLowerCase();
}

function nextEditId(existingIds = new Set()) {
  let index = 1;
  while (existingIds.has(`hv_edit_${String(index).padStart(3, '0')}`)) {
    index += 1;
  }
  return `hv_edit_${String(index).padStart(3, '0')}`;
}

function createDraftSummary(label = '') {
  const safe = String(label || '').trim();
  return `画布调整：${safe || '元素位置'}`;
}

module.exports = {
  clamp,
  createDraftSummary,
  editableSelector,
  excludedSelector,
  formatElementLabel,
  nextEditId,
  parsePx,
};
```

- [ ] **Step 4: Run helper test**

Run:

```powershell
node tests/test-html-video-canvas-dom.js
```

Expected:

```text
test-html-video-canvas-dom passed
```

- [ ] **Step 5: Commit**

```powershell
git add frontend-react/src/components/creative-video-editor/htmlVideoCanvasDom.js tests/test-html-video-canvas-dom.js
git commit -m "添加 html-video 画布编辑工具函数"
```

## Task 2: Frame Strip Component

**Files:**

- Create: `frontend-react/src/components/creative-video-editor/HtmlVideoFrameStrip.jsx`

- [ ] **Step 1: Implement frame strip**

Create `frontend-react/src/components/creative-video-editor/HtmlVideoFrameStrip.jsx`:

```jsx
function frameTitle(frame, index) {
  return frame?.title
    || frame?.metadata?.visual_text?.headline
    || frame?.inputs?.headline
    || frame?.inputs?.title
    || frame?.label
    || frame?.id
    || `镜头 ${index + 1}`;
}

function frameDuration(frame) {
  const duration = Number(frame?.duration_sec ?? frame?.durationSec ?? frame?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

export function HtmlVideoFrameStrip({ frames = [], selectedFrameId = '', disabled = false, onSelect }) {
  return (
    <div className="html-video-canvas-frame-strip" aria-label="镜头预览列表">
      {frames.map((frame, index) => {
        const frameId = frame?.id || frame?.scene_id || String(index);
        const selected = String(frameId) === String(selectedFrameId);
        const duration = frameDuration(frame);
        return (
          <button
            key={frameId}
            type="button"
            className={selected ? 'active' : ''}
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onSelect?.(frameId)}
          >
            <span className="html-video-canvas-frame-thumb">
              <span>{String(index + 1).padStart(2, '0')}</span>
            </span>
            <strong>{frameTitle(frame, index)}</strong>
            <small>{duration ? `${duration.toFixed(1)}s` : '未设置时长'}</small>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Defer component wiring test**

Do not create or commit `tests/test-html-video-canvas-editor-components.mjs` in this task. That test references components created in later tasks and would intentionally fail if committed now.

- [ ] **Step 3: Commit**

```powershell
git add frontend-react/src/components/creative-video-editor/HtmlVideoFrameStrip.jsx
git commit -m "添加 html-video 画布镜头条"
```

## Task 3: Element Inspector Component

**Files:**

- Create: `frontend-react/src/components/creative-video-editor/HtmlVideoElementInspector.jsx`

- [ ] **Step 1: Implement inspector**

Create `frontend-react/src/components/creative-video-editor/HtmlVideoElementInspector.jsx`:

```jsx
export function HtmlVideoElementInspector({
  elementInfo,
  editingReady,
  disabled,
  saving,
  onTextChange,
  onResetPosition,
  onSaveDraft,
  onRenderDraft,
  activeDraftId,
}) {
  return (
    <aside className="html-video-element-inspector" aria-label="元素属性">
      <div className="creative-video-editor-panel-header">
        <h3>当前元素</h3>
      </div>
      {!editingReady ? (
        <p>镜头播放完毕后可选择并拖拽元素。</p>
      ) : null}
      {editingReady && !elementInfo ? (
        <p>点击画面中的标题、标签或正文元素开始编辑。</p>
      ) : null}
      {editingReady && elementInfo ? (
        <>
          <dl>
            <div>
              <dt>标识</dt>
              <dd>{elementInfo.label}</dd>
            </div>
            <div>
              <dt>选择器</dt>
              <dd>{elementInfo.selector}</dd>
            </div>
            <div>
              <dt>位置</dt>
              <dd>{Math.round(elementInfo.left)} / {Math.round(elementInfo.top)}</dd>
            </div>
            <div>
              <dt>尺寸</dt>
              <dd>{Math.round(elementInfo.width)} × {Math.round(elementInfo.height)}</dd>
            </div>
          </dl>
          <label>
            文案
            <textarea
              value={elementInfo.text || ''}
              disabled={disabled}
              rows={4}
              onChange={event => onTextChange?.(event.target.value)}
            />
          </label>
          <div className="creative-video-editor-inline-actions">
            <button type="button" disabled={disabled || saving} onClick={onResetPosition}>重置位置</button>
            <button type="button" disabled={disabled || saving} onClick={onSaveDraft}>{saving ? '正在保存...' : '保存为草稿'}</button>
            <button type="button" disabled={disabled || saving || !activeDraftId} onClick={onRenderDraft}>渲染草稿</button>
          </div>
        </>
      ) : null}
    </aside>
  );
}
```

- [ ] **Step 2: Defer component wiring test**

Do not run or commit the component wiring test yet. `HtmlVideoCanvasEditor.jsx` and the project editor integration are created in later tasks.

- [ ] **Step 3: Commit**

```powershell
git add frontend-react/src/components/creative-video-editor/HtmlVideoElementInspector.jsx
git commit -m "添加 html-video 元素属性面板"
```

## Task 4: Canvas Editor Component

**Files:**

- Create: `frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx`
- Modify: no existing files in this task

Prerequisite: complete Task 2 and Task 3 first. `HtmlVideoCanvasEditor.jsx` imports both `HtmlVideoFrameStrip.jsx` and `HtmlVideoElementInspector.jsx`.

- [ ] **Step 1: Implement canvas editor**

Create `frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx`:

```jsx
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

function isEditableElement(element) {
  if (!element || element.nodeType !== 1) return false;
  if (element.matches(excludedSelector)) return false;
  if (element.closest(excludedSelector)) return false;
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
```

- [ ] **Step 2: Defer component wiring test**

Do not run `tests/test-html-video-canvas-editor-components.mjs` yet. That file is created after project editor integration in Task 5 so the test suite never contains an intentionally failing committed test.

- [ ] **Step 3: Commit**

```powershell
git add frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx
git commit -m "添加 html-video 可视化画布编辑器"
```

## Task 5: Integrate Canvas Tab Without Removing Existing Features

**Files:**

- Modify: `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx`
- Test: `tests/test-html-video-canvas-editor-components.mjs`

For Steps 1-4, inspect the current `HtmlVideoProjectEditor.jsx` first. If the matching import area, active tab state, tabs list, or panel render location cannot be identified safely, stop and report the mismatch instead of forcing an edit.

- [ ] **Step 1: Add import**

Modify imports near the existing html-video panel imports:

```jsx
import { HtmlVideoAiEditPanel } from './HtmlVideoAiEditPanel.jsx';
import { HtmlVideoCanvasEditor } from './HtmlVideoCanvasEditor.jsx';
import { HtmlVideoDraftPanel } from './HtmlVideoDraftPanel.jsx';
```

- [ ] **Step 2: Make canvas the default tab**

Change:

```jsx
const [activeTab, setActiveTab] = useState('source');
```

to:

```jsx
const [activeTab, setActiveTab] = useState('canvas');
```

- [ ] **Step 3: Add tab entry before source**

Change `tabs` to:

```jsx
const tabs = [
  { id: 'canvas', label: '画布' },
  { id: 'source', label: '源码' },
  { id: 'draft', label: '草稿' },
  { id: 'quality', label: '布局检查' },
  { id: 'ai', label: 'AI 修改' },
  { id: 'fields', label: '字段' },
  { id: 'export', label: '导出' },
];
```

- [ ] **Step 4: Render canvas panel before source panel**

Inside `.html-video-project-main`, before the `activeTab === 'source'` block, add:

```jsx
{activeTab === 'canvas' ? (
  <HtmlVideoCanvasEditor editor={editor} />
) : null}
```

- [ ] **Step 5: Create component wiring test**

Create `tests/test-html-video-canvas-editor-components.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const frameStrip = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoFrameStrip.jsx', 'utf-8');
const canvasEditor = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx', 'utf-8');
const inspector = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoElementInspector.jsx', 'utf-8');
const projectEditor = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx', 'utf-8');

assert.match(frameStrip, /export function HtmlVideoFrameStrip/);
assert.match(frameStrip, /frames\.map/);
assert.match(frameStrip, /onSelect/);
assert.match(frameStrip, /selectedFrameId/);

assert.match(canvasEditor, /export function HtmlVideoCanvasEditor/);
assert.match(canvasEditor, /跳到结尾并编辑/);
assert.match(canvasEditor, /保存为草稿/);
assert.match(canvasEditor, /renderFramePreview/);
assert.match(canvasEditor, /editingReadyRef/);
assert.match(canvasEditor, /iframeKey/);
assert.match(canvasEditor, /saving/);
assert.match(canvasEditor, /previewError/);
assert.match(canvasEditor, /onError/);
assert.match(canvasEditor, /HV-CANVAS-INJECT-STYLE-HERE/);
assert.match(canvasEditor, /absolutePositionFor/);
assert.match(canvasEditor, /viewportSize/);
assert.match(canvasEditor, /writeElementText/);
assert.match(canvasEditor, /serializeDocument/);

assert.match(inspector, /export function HtmlVideoElementInspector/);
assert.match(inspector, /当前元素/);
assert.match(inspector, /文案/);

assert.match(projectEditor, /HtmlVideoCanvasEditor/);
assert.match(projectEditor, /id: 'canvas', label: '画布'/);

console.log('test-html-video-canvas-editor-components passed');
```

- [ ] **Step 6: Run component wiring test**

Run:

```powershell
node tests/test-html-video-canvas-editor-components.mjs
```

Expected:

```text
test-html-video-canvas-editor-components passed
```

- [ ] **Step 7: Commit**

```powershell
git add frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx tests/test-html-video-canvas-editor-components.mjs
git commit -m "接入 html-video 画布编辑标签页"
```

## Task 6: Canvas Styles

**Files:**

- Modify: `frontend-react/src/styles.css`

- [ ] **Step 1: Add bounded styles near existing html-video editor styles**

Append near the current `.html-video-project-layout` section:

```css
.html-video-canvas-editor {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.html-video-canvas-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 12px;
  min-width: 0;
}

.html-video-canvas-stage {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.html-video-canvas-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
}

.html-video-canvas-toolbar span {
  color: #374151;
  font-size: 13px;
}

.html-video-canvas-stage iframe {
  width: 100%;
  aspect-ratio: 16 / 9;
  min-height: 420px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #111827;
}

.html-video-element-inspector {
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
}

.html-video-element-inspector dl {
  display: grid;
  gap: 8px;
  margin: 0;
}

.html-video-element-inspector dl div {
  display: grid;
  gap: 2px;
}

.html-video-element-inspector dt {
  color: #6b7280;
  font-size: 12px;
}

.html-video-element-inspector dd {
  margin: 0;
  color: #111827;
  font-size: 13px;
  word-break: break-all;
}

.html-video-element-inspector label {
  display: grid;
  gap: 6px;
  color: #374151;
  font-size: 13px;
}

.html-video-element-inspector textarea {
  width: 100%;
  resize: vertical;
}

.html-video-canvas-frame-strip {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(150px, 190px);
  gap: 10px;
  overflow-x: auto;
  padding: 10px 2px 4px;
}

.html-video-canvas-frame-strip button {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.html-video-canvas-frame-strip button.active {
  border-color: #10b981;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, .16);
}

.html-video-canvas-frame-strip button:disabled {
  cursor: not-allowed;
  opacity: .65;
}

.html-video-canvas-frame-thumb {
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  background: #111827;
  color: #fff;
  font-weight: 700;
}

.html-video-canvas-frame-strip strong {
  overflow: hidden;
  color: #111827;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.html-video-canvas-frame-strip small {
  color: #6b7280;
  font-size: 12px;
}

@media (max-width: 1100px) {
  .html-video-canvas-workspace {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Add iframe selection style injection**

In `HtmlVideoCanvasEditor.jsx`, find the unique `// HV-CANVAS-INJECT-STYLE-HERE` anchor inside `handleIframeLoad()` and insert this code immediately after it. Keep the anchor comment in place.

```jsx
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
```

- [ ] **Step 3: Run component wiring test**

Run:

```powershell
node tests/test-html-video-canvas-editor-components.mjs
```

Expected:

```text
test-html-video-canvas-editor-components passed
```

- [ ] **Step 4: Commit**

```powershell
git add frontend-react/src/styles.css frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx
git commit -m "补充 html-video 画布编辑样式"
```

## Task 7: Improve Draft Render After Save

**Files:**

- Modify: `frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx`

- [ ] **Step 1: Make save action render the returned active draft**

Replace `saveDraft()` with:

```jsx
async function saveDraft() {
  if (saving) return null;
  const doc = iframeRef.current?.contentDocument;
  if (!doc || !frameId) return null;
  setSaving(true);
  setPreviewError('');
  const label = elementInfo?.text || elementInfo?.label || '';
  try {
    const result = await editor.saveFrameHtmlDraft(frameId, {
      html: serializeDocument(doc),
      mode: 'draft',
      summary: createDraftSummary(label),
    });
    const nextProject = result?.html_video_project || result?.project || result?.data?.project || result?.data;
    const nextFrame = Array.isArray(nextProject?.frames)
      ? nextProject.frames.find(item => String(item.id || item.scene_id) === String(frameId))
      : null;
    const draftId = nextFrame?.active_draft_id || result?.draft_id || result?.draft?.id || activeDraftId;
    if (draftId) {
      try {
        await editor.renderFramePreview(frameId, { draft_id: draftId, run_layout_qa: true });
      } catch (_) {
        setPreviewError('草稿已保存，但渲染预览失败，请点击“渲染草稿”重试。');
      }
    }
    return result;
  } catch (_) {
    setPreviewError('保存草稿失败，请稍后重试。');
    return null;
  } finally {
    setSaving(false);
  }
}
```

This preserves the existing draft flow, prevents duplicate save clicks, and shows a Chinese retry hint if automatic render fails.

- [ ] **Step 2: Keep manual render button**

Do not remove `渲染草稿`. It remains useful if render fails or the user switches back to a draft later.

- [ ] **Step 3: Run component wiring test**

Run:

```powershell
node tests/test-html-video-canvas-editor-components.mjs
```

Expected:

```text
test-html-video-canvas-editor-components passed
```

- [ ] **Step 4: Commit**

```powershell
git add frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx
git commit -m "保存画布草稿后自动渲染预览"
```

## Task 8: Add Source Ownership Guard

**Files:**

- Modify: `frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx`
- Test: `tests/test-html-video-canvas-editor-components.mjs`

- [ ] **Step 1: Prevent stale HTML from previous selected frame**

Modify the existing frame-loading state and effects in place. Preserve the `saving`, `previewError`, playback, selection, and iframe reload behavior from earlier tasks; do not replace the whole component from an older snapshot.

Add local state:

```jsx
const [loadedFrameId, setLoadedFrameId] = useState('');
```

Find the `useEffect` whose dependency array is `[frameId, rawHtml]`. Update it so it clears `loadedFrameId` whenever the selected frame changes:

```jsx
useEffect(() => {
  setHtml('');
  setLoadedFrameId('');
  setPreviewError('');
  setEditingReady(false);
  setPlaybackState('idle');
  setElementInfo(null);
  selectedElementRef.current = null;
  if (frameId && rawHtml) editor.loadFrameHtml(frameId);
}, [frameId, rawHtml]);
```

Find the `useEffect` whose dependency array is `[editor.frameHtml, frameId]`. Update it so successful HTML assignment also records the owning frame id:

```jsx
useEffect(() => {
  if (!editor.frameHtml || !frameId) return;
  setHtml(editor.frameHtml);
  setLoadedFrameId(frameId);
}, [editor.frameHtml, frameId]);
```

Find the existing `srcDoc` declaration. Replace it with an `htmlReady` guard so the iframe never renders HTML loaded for a different frame:

```jsx
const htmlReady = Boolean(html && loadedFrameId === frameId);
const srcDoc = useMemo(() => (
  htmlReady ? html : '<!doctype html><html><body></body></html>'
), [htmlReady, html]);
```

Update render body to show a loading message when `!htmlReady`:

```jsx
{!htmlReady ? <p className="html-video-canvas-loading">正在加载当前镜头 HTML...</p> : null}
```

- [ ] **Step 2: Extend static test**

Modify `tests/test-html-video-canvas-editor-components.mjs` and add:

```js
assert.match(canvasEditor, /loadedFrameId/);
assert.match(canvasEditor, /正在加载当前镜头 HTML/);
```

- [ ] **Step 3: Run tests**

Run:

```powershell
node tests/test-html-video-canvas-editor-components.mjs
node tests/test-html-video-canvas-dom.js
```

Expected:

```text
test-html-video-canvas-editor-components passed
test-html-video-canvas-dom passed
```

- [ ] **Step 4: Commit**

```powershell
git add frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx tests/test-html-video-canvas-editor-components.mjs
git commit -m "避免画布编辑加载旧镜头源码"
```

## Task 9: Manual QA Checklist

**Files:**

- No file changes expected.

- [ ] **Step 1: Start frontend/backend as the project normally does**

Use the existing project command from `package.json`. If the project uses a single dev command, run it. If it uses separate frontend/backend commands, run both.

Record the exact URLs in the execution notes.

- [ ] **Step 2: Open an existing html-video workflow with raw HTML frames**

Use a workflow that has:

- Multiple frames.
- `source_mode: "raw_html"`.
- At least one visible animated text element.
- At least one active or createable draft.

- [ ] **Step 3: Verify playback gate**

Expected:

- Opening `画布` shows the selected frame.
- During playback, inspector says `镜头播放完毕后可选择并拖拽元素。`
- Elements cannot be selected during playback.
- After duration elapses, toolbar says `已停在镜头结束帧，可开始编辑。`
- Elements can be selected after playback ends.

- [ ] **Step 4: Verify skip shortcut**

Expected:

- Click `重新播放`.
- Click `跳到结尾并编辑`.
- Playback stops.
- Editing becomes available immediately.

- [ ] **Step 5: Verify element selection**

Expected:

- Click a headline or tag.
- The element receives a green outline in iframe.
- Inspector shows label, selector, position, size, and text.

- [ ] **Step 6: Verify drag**

Expected:

- Drag the selected element.
- It follows the pointer.
- Inspector X/Y values update.
- Element stays inside the iframe viewport.

- [ ] **Step 7: Verify text edit**

Expected:

- Edit inspector `文案`.
- Selected DOM element text changes in iframe.

- [ ] **Step 8: Verify draft save and render**

Expected:

- Click `保存为草稿`.
- UI shows `正在保存帧源码草稿...`.
- After save, render starts with `正在渲染单帧预览...`.
- Layout QA runs because payload includes `run_layout_qa: true`.
- Draft tab shows an active draft.

- [ ] **Step 9: Verify existing tabs still work**

Expected:

- `源码` still loads source and saves draft.
- `草稿` still accepts and discards draft.
- `布局检查` still runs.
- `AI 修改` still generates frame drafts.
- `字段` still saves frame/template/caption/narration edits.
- `导出` still exports.

- [ ] **Step 10: Commit manual QA notes if the project keeps QA notes**

If no QA note file exists for this feature, do not create one. Put results in the final implementation response.

## Task 10: Full Verification

**Files:**

- No file changes expected unless tests reveal a defect.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
node tests/test-html-video-canvas-dom.js
node tests/test-html-video-canvas-editor-components.mjs
```

Expected:

```text
test-html-video-canvas-dom passed
test-html-video-canvas-editor-components passed
```

- [ ] **Step 2: Run existing html-video editor component test**

Run:

```powershell
node tests/test-html-video-editor-components.mjs
```

Expected: pass.

- [ ] **Step 3: Run API client tests**

Run:

```powershell
node tests/test-html-video-api-client.mjs
node tests/test-creative-api-client.mjs
```

Expected: pass.

- [ ] **Step 4: Run all tests only if time permits**

The required verification is the targeted test set above. Do not block completion on a slow full-suite run unless the changed files indicate broader risk.

Run:

```powershell
npm test
```

Expected: pass.

If `npm test` is too slow or fails for unrelated existing reasons, capture the exact failing command and the first relevant failure line in the final response.

- [ ] **Step 5: Final git status**

Run:

```powershell
git status --short
```

Expected: only intended files are modified if not committed; otherwise clean.

## Acceptance Criteria

- `画布` is the first tab in the html-video project editor.
- Existing tabs remain available and functional.
- Raw HTML frame loads into iframe.
- Frame plays first, then editing becomes available.
- `跳到结尾并编辑` works.
- User can select a visible eligible DOM element after playback ends.
- User can drag one selected element.
- Drag updates final layout, not animation keyframes.
- User can edit selected element text.
- User can save modified HTML as a draft.
- Draft save triggers preview render with layout QA.
- User can still accept/discard draft using existing controls.
- No new backend route is required.
- No new dependency is added.
- Focused tests pass.

## Known Constraints

- Mid-animation-only issues may not be visible on the final frame. Existing and future layout QA must inspect multiple timestamps to catch those.
- Dragging elements out of flex/grid flow can change responsive behavior. V1 is a repair tool for generated video frames, not a responsive website editor.
- Text editing preserves the first direct text node when one exists. If the selected element has no direct text node, replacing text will flatten that element's children; users should use the source editor for rich nested text structures in V1.
- Elements whose visible text is generated only by pseudo-elements or canvas cannot be edited in V1.
- Freeze support covers CSS Animations, Web Animations API animations, and GSAP global timelines when present. It does not reliably stop custom `requestAnimationFrame` loops, Three.js render loops, Anime.js timelines, or arbitrary timer-driven scripts.
- If generated HTML blocks iframe access with unusual browser behavior, the canvas should fail closed with the existing source editor still available.

## Self-Review

Spec coverage:

- html-video style preview: covered by `HtmlVideoCanvasEditor` and `HtmlVideoFrameStrip`.
- Play frame from start to end before editing: covered by Task 4 playback gate.
- Element-level drag: covered by Task 4 drag handlers and layout mutation rules.
- Preserve existing functions: covered by Task 5 and Task 9.
- Save as draft instead of destructive overwrite: covered by Task 4 and Task 7.
- Detailed subagent execution: tasks include exact files, snippets, commands, and expected results.

Placeholder scan:

- No forbidden placeholder markers.
- No unspecified “handle edge cases” step.
- Excluded work is explicitly scoped out.

Type and name consistency:

- Component names match imports:
  - `HtmlVideoCanvasEditor`
  - `HtmlVideoFrameStrip`
  - `HtmlVideoElementInspector`
- Existing hook names match current code:
  - `loadFrameHtml`
  - `saveFrameHtmlDraft`
  - `renderFramePreview`
  - `acceptFrameDraft`
  - `discardFrameDraft`
  - `inspectLayout`
- Existing frame fields match current project schema:
  - `id`
  - `scene_id`
  - `source_mode`
  - `duration_sec`
  - `active_draft_id`
