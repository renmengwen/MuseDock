import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  canEditText,
  editableSelector,
  fitPreviewBox,
  isCanvasEditableElement,
  previewAspectRatio,
} from '../frontend-react/src/components/creative-video-editor/htmlVideoCanvasDom.mjs';

const frameStrip = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoFrameStrip.jsx', 'utf-8');
const canvasEditor = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx', 'utf-8');
// 画布编辑逻辑已拆为 视图(HtmlVideoCanvasEditor) + 状态hook(useCanvasEditing) + iframe运行时(htmlVideoCanvasRuntime)，
// 行为断言针对三者组合源
const canvasEditing = fs.readFileSync('frontend-react/src/components/creative-video-editor/useCanvasEditing.js', 'utf-8');
const canvasRuntime = fs.readFileSync('frontend-react/src/components/creative-video-editor/htmlVideoCanvasRuntime.mjs', 'utf-8');
const canvasUnit = canvasEditor + canvasEditing + canvasRuntime;
const inspector = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoElementInspector.jsx', 'utf-8');
const projectEditor = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx', 'utf-8');

assert.match(frameStrip, /export function HtmlVideoFrameStrip/);
assert.match(frameStrip, /frames\.map/);
assert.match(frameStrip, /onSelect/);
assert.match(frameStrip, /selectedFrameId/);

assert.match(canvasUnit, /export function HtmlVideoCanvasEditor/);
assert.match(canvasUnit, /from ['"]\.\/htmlVideoCanvasDom\.mjs['"]/);
assert.doesNotMatch(canvasUnit, /from ['"]\.\/htmlVideoCanvasDom\.js['"]/);
assert.match(canvasUnit, /跳到结尾并编辑/);
assert.match(inspector, /保存修改/);
assert.match(inspector, /删除元素/);
assert.match(inspector, /当前点击位置/);
assert.match(inspector, /当前帧图层/);
assert.match(inspector, /置顶/);
assert.match(inspector, /锁定/);
assert.match(canvasUnit, /deleteSelectedElement/);
assert.match(canvasUnit, /elementsFromPoint/);
assert.match(canvasUnit, /data-hv-editor-overlay/);
assert.match(canvasUnit, /data-hv-editor-handle/);
assert.match(canvasUnit, /updateSelectedGeometry/);
assert.match(canvasUnit, /moveSelectedLayer/);
assert.match(canvasUnit, /DialogTrigger/);
assert.match(canvasUnit, /帧字段/);
assert.doesNotMatch(canvasUnit, /帧字段 \/ 旁白 \/ 字幕/);
assert.match(canvasUnit, /grid h-full min-h-0 min-w-0 grid-cols-\[minmax\(0,1fr\)_260px\]/);
assert.match(canvasUnit, /grid min-h-0 min-w-0 grid-rows-\[minmax\(0,1fr\)_auto\] gap-2 overflow-hidden/);
assert.match(canvasUnit, /w-\[min\(760px,calc\(100vw-32px\)\)\]/);
assert.match(projectEditor, /grid h-full min-h-0 grid-rows-\[auto_auto_minmax\(0,1fr\)\]/);
assert.doesNotMatch(canvasUnit, /<details/);
assert.doesNotMatch(canvasUnit, /TemplateInputsPanel/);
assert.doesNotMatch(canvasUnit, /保存为草稿/);
assert.match(canvasUnit, /saveAndAcceptFrameEdit/);
assert.match(canvasUnit, /editingReadyRef/);
assert.match(canvasUnit, /iframeKey/);
assert.match(canvasUnit, /saving/);
assert.match(canvasUnit, /previewError/);
assert.match(canvasUnit, /loadedFrameId/);
assert.match(canvasUnit, /正在加载当前镜头 HTML/);
assert.match(canvasUnit, /htmlLoadError/);
assert.match(canvasUnit, /当前镜头 HTML 加载失败，请重试。/);
assert.match(canvasUnit, /重新加载 HTML/);
assert.match(canvasUnit, /htmlReloadKey/);
assert.doesNotMatch(canvasUnit, /setHtml\(editor\.frameHtml\);\s*setLoadedFrameId\(frameId\);/);
assert.doesNotMatch(canvasUnit, /setHtml\(editor\.frameHtml \|\| ''\);/);
assert.match(canvasUnit, /onError/);
assert.match(canvasUnit, /HV-CANVAS-INJECT-STYLE-HERE/);
assert.match(canvasUnit, /data-hv-canvas-editor-style/);
assert.match(canvasUnit, /querySelectorAll\('\[data-hv-canvas-editor-style\]'\)/);
assert.match(canvasUnit, /doc\.head\.appendChild\(editorStyle\)/);
assert.match(canvasUnit, /data-hv-canvas-freeze/);
assert.match(canvasUnit, /data-hv-canvas-selected/);
assert.match(canvasUnit, /data-hv-canvas-viewport-style/);
assert.match(canvasUnit, /function installCanvasViewport/);
assert.match(canvasUnit, /__HV_CANVAS_SCALE__/);
assert.match(canvasUnit, /transform: scale/);
assert.match(canvasUnit, /\(event\.clientY - drag\.startY\) \/ scale/);
assert.match(canvasUnit, /parentCanvasTop/);
assert.match(canvasUnit, /minTop: geometry\.absolutePosition\.minTop/);
assert.match(canvasUnit, /maxTop: geometry\.absolutePosition\.maxTop/);
assert.doesNotMatch(canvasUnit, /offsetParent\.clientHeight/);
assert.match(canvasUnit, /absolutePositionFor/);
assert.match(canvasUnit, /viewportSize/);
assert.match(canvasUnit, /writeElementText/);
assert.match(canvasUnit, /serializeDocument/);
assert.match(canvasUnit, /querySelectorAll\('\*'\)/, '图层列表应包含未带语义 class 的叶子文本元素');
assert.match(canvasUnit, /isCanvasEditableElement/, '可编辑判断应复用 DOM helper');
assert.match(canvasUnit, /function clearPlaybackTimer\(\)\s*\{\s*if \(playbackTimerRef\.current\) clearTimeout\(playbackTimerRef\.current\);\s*playbackTimerRef\.current = null;\s*\}/);
assert.match(canvasUnit, /function playFrame/);
assert.match(canvasUnit, /__hvPlayAll/);
assert.match(canvasUnit, /__hvPlayed = true/);
assert.match(canvasUnit, /useEffect\(\(\) => \{\s*const requestId = frameLoadRequestRef\.current \+ 1;[^]*?clearPlaybackTimer\(\);[^]*?setEditingReady\(false\);[^]*?\}, \[frameId, rawHtml, htmlReloadKey\]\);/);
assert.match(canvasUnit, /function beginPlayback\(\)\s*\{\s*clearPlaybackTimer\(\);/);
assert.match(canvasUnit, /function finishPlayback/);
assert.match(canvasUnit, /finishPlayback\(\);/);
assert.match(canvasUnit, /function replay\(\)\s*\{\s*clearPlaybackTimer\(\);/);
assert.match(canvasUnit, /ResizeObserver/);
assert.match(canvasUnit, /fitPreviewBox\(previewSlotSize, previewRatio\)/);
assert.doesNotMatch(canvasUnit, /aspect-video h-full max-h-full w-auto max-w-full/);
assert.match(canvasUnit, /grid-rows-\[minmax\(0,1fr\)_auto\] gap-3 overflow-hidden pr-1/);
assert.match(canvasUnit, /min-h-0 overflow-y-auto overflow-x-hidden/, '元素详情应独立滚动，避免 sticky 操作区遮住帧字段入口');
assert.match(inspector, /sticky bottom-0/, '检查器保存和删除操作应固定在底部可见');
assert.match(canvasUnit, /const offsetLeft = Math\.max\(0, \(viewport\.width - canvasWidth\) \/ 2\)/);
assert.match(canvasUnit, /left: \$\{Math\.round\(offsetLeft\)\}px !important/);
assert.deepEqual(fitPreviewBox({ width: 1600, height: 480 }, 16 / 9), { width: 853, height: 480 });
assert.deepEqual(fitPreviewBox({ width: 500, height: 1000 }, 16 / 9), { width: 500, height: 281 });
assert.equal(previewAspectRatio({ output: { resolution: { width: 1080, height: 1920 } } }), 1080 / 1920);

// 二次编辑修复回归断言
assert.match(canvasUnit, /\[data-hv-canvas-selected\],\[data-hv-edit-id\]/, '保存时应剥离 data-hv-edit-id');
assert.match(canvasUnit, /Object\.assign\(existing\.style, rectStyle\)/, 'overlay 应原地更新以保住 pointer capture');
assert.match(canvasUnit, /nextLeft = drag\.startLeft \+ \(drag\.startWidth - nextWidth\)/, 'w-handle 钳制后需回算 left');
assert.match(canvasUnit, /nextTop = drag\.startTop \+ \(drag\.startHeight - nextHeight\)/, 'n-handle 钳制后需回算 top');
assert.match(canvasUnit, /clone\.querySelectorAll\('\[data-hv-editor-overlay\]'\)/, '撤销快照不应包含编辑器覆盖层');
assert.match(canvasUnit, /\}, \[Boolean\(frame\), rawHtml\]\);/, 'ResizeObserver 需跟随早退分支重挂');
assert.doesNotMatch(canvasUnit, /selectAndRender\(target\);[^]*?snapshotBeforeEdit\(\);[^]*?const geometry = dragGeometryFor\(target\);/, '纯点选不应创建撤销快照');
assert.match(canvasUnit, /if \(!drag\.changed\) \{\s*snapshotBeforeEdit\(\);\s*ensurePositionedForEdit\(drag\.element\);/);
assert.match(canvasUnit, /front: current > max \? current : max \+ 1/, '置顶不应无限膨胀 z-index');
assert.match(canvasUnit, /!canEditText\(element\)/, '容器元素不允许整体改文案');
assert.match(inspector, /textEditable/);
assert.match(canvasUnit, /onTextEditStart=\{snapshotBeforeEdit\}/, '文案编辑开始时需建撤销快照（快照已不在 pointerdown）');
assert.match(inspector, /onFocus=\{\(\) => onTextEditStart\?\.\(\)\}/, 'textarea 聚焦即开始一轮文案编辑');

// canEditText：容器/图形元素禁止整体文案编辑，叶子文本元素允许
assert.equal(canEditText({ tagName: 'H1', childNodes: [{ nodeType: 3, textContent: '标题' }], children: [] }), true);
assert.equal(canEditText({ tagName: 'IMG', childNodes: [{ nodeType: 3, textContent: '标题' }], children: [] }), false);
assert.equal(canEditText({ tagName: 'svg', childNodes: [{ nodeType: 3, textContent: '标题' }], children: [] }), false);
assert.equal(canEditText({ tagName: 'SECTION', childNodes: [{ nodeType: 3, textContent: '标题' }], children: [{ textContent: '子元素文本' }] }), false);
assert.equal(canEditText({ tagName: 'DIV', childNodes: [], children: [{ textContent: '  ' }] }), false);
assert.equal(canEditText({ tagName: 'DIV', childNodes: [{ nodeType: 3, textContent: '\n  ' }], children: [{ textContent: '  ' }] }), false);
assert.equal(canEditText({ tagName: 'BUTTON', childNodes: [{ nodeType: 1 }, { nodeType: 3, textContent: '按钮' }], children: [{ textContent: '  ' }] }), true);
assert.equal(canEditText(null), false);
assert.equal(isCanvasEditableElement({
  nodeType: 1,
  tagName: 'DIV',
  childNodes: [{ nodeType: 3, textContent: '叶子文本' }],
  children: [],
  matches: () => false,
}), true, '普通叶子文本 div 也应进入可编辑候选');
assert.equal(isCanvasEditableElement({
  nodeType: 1,
  tagName: 'DIV',
  childNodes: [{ nodeType: 3, textContent: '容器文本' }],
  children: [{ textContent: '子元素文本' }],
  matches: selector => selector === editableSelector,
}), true, '已有语义选择器的容器仍应可选中做位置编辑');

assert.match(inspector, /export function HtmlVideoElementInspector/);
assert.match(inspector, /当前元素/);
assert.match(inspector, /文案/);
assert.match(inspector, /SelectTrigger/);
assert.doesNotMatch(inspector, /function MiniList/);

assert.match(projectEditor, /HtmlVideoCanvasEditor/);
assert.doesNotMatch(projectEditor, /useState\(['"]canvas['"]\)/, 'project editor should not have canvas tab state');
assert.match(projectEditor, /Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger/, 'project editor should use Dialog components');
assert.match(projectEditor, /PanelDialog/, 'project editor should have PanelDialog component');
assert.doesNotMatch(projectEditor, /id: 'canvas', label: '画布'/, 'project editor should no longer have tab definitions');

for (const dialogLabel of ['字幕 / 旁白', 'AI 修改', '源码', '布局检查', '导出记录']) {
  assert.ok(projectEditor.includes(dialogLabel), `HtmlVideoProjectEditor should expose ${dialogLabel}`);
}

console.log('test-html-video-canvas-editor-components passed');
