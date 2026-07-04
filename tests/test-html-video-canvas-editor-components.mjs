import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canEditText, fitPreviewBox, previewAspectRatio } from '../frontend-react/src/components/creative-video-editor/htmlVideoCanvasDom.mjs';

const frameStrip = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoFrameStrip.jsx', 'utf-8');
const canvasEditor = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoCanvasEditor.jsx', 'utf-8');
const inspector = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoElementInspector.jsx', 'utf-8');
const projectEditor = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx', 'utf-8');

assert.match(frameStrip, /export function HtmlVideoFrameStrip/);
assert.match(frameStrip, /frames\.map/);
assert.match(frameStrip, /onSelect/);
assert.match(frameStrip, /selectedFrameId/);

assert.match(canvasEditor, /export function HtmlVideoCanvasEditor/);
assert.match(canvasEditor, /from ['"]\.\/htmlVideoCanvasDom\.mjs['"]/);
assert.doesNotMatch(canvasEditor, /from ['"]\.\/htmlVideoCanvasDom\.js['"]/);
assert.match(canvasEditor, /跳到结尾并编辑/);
assert.match(inspector, /保存修改/);
assert.match(inspector, /删除元素/);
assert.match(inspector, /当前点击位置/);
assert.match(inspector, /当前帧图层/);
assert.match(inspector, /置顶/);
assert.match(inspector, /锁定/);
assert.match(canvasEditor, /deleteSelectedElement/);
assert.match(canvasEditor, /elementsFromPoint/);
assert.match(canvasEditor, /data-hv-editor-overlay/);
assert.match(canvasEditor, /data-hv-editor-handle/);
assert.match(canvasEditor, /updateSelectedGeometry/);
assert.match(canvasEditor, /moveSelectedLayer/);
assert.match(canvasEditor, /DialogTrigger/);
assert.match(canvasEditor, /帧字段 \/ 旁白 \/ 字幕/);
assert.match(canvasEditor, /grid h-full min-h-0 min-w-0 grid-rows-\[minmax\(0,1fr\)_auto\]/);
assert.match(canvasEditor, /w-\[min\(1040px,calc\(100vw-32px\)\)\]/);
assert.match(projectEditor, /grid h-full min-h-0 grid-rows-\[auto_auto_auto_minmax\(0,1fr\)\]/);
assert.doesNotMatch(canvasEditor, /<details/);
assert.doesNotMatch(canvasEditor, /TemplateInputsPanel/);
assert.doesNotMatch(canvasEditor, /保存为草稿/);
assert.match(canvasEditor, /saveAndAcceptFrameEdit/);
assert.match(canvasEditor, /editingReadyRef/);
assert.match(canvasEditor, /iframeKey/);
assert.match(canvasEditor, /saving/);
assert.match(canvasEditor, /previewError/);
assert.match(canvasEditor, /loadedFrameId/);
assert.match(canvasEditor, /正在加载当前镜头 HTML/);
assert.match(canvasEditor, /htmlLoadError/);
assert.match(canvasEditor, /当前镜头 HTML 加载失败，请重试。/);
assert.match(canvasEditor, /重新加载 HTML/);
assert.match(canvasEditor, /htmlReloadKey/);
assert.doesNotMatch(canvasEditor, /setHtml\(editor\.frameHtml\);\s*setLoadedFrameId\(frameId\);/);
assert.doesNotMatch(canvasEditor, /setHtml\(editor\.frameHtml \|\| ''\);/);
assert.match(canvasEditor, /onError/);
assert.match(canvasEditor, /HV-CANVAS-INJECT-STYLE-HERE/);
assert.match(canvasEditor, /data-hv-canvas-editor-style/);
assert.match(canvasEditor, /querySelectorAll\('\[data-hv-canvas-editor-style\]'\)/);
assert.match(canvasEditor, /doc\.head\.appendChild\(editorStyle\)/);
assert.match(canvasEditor, /data-hv-canvas-freeze/);
assert.match(canvasEditor, /data-hv-canvas-selected/);
assert.match(canvasEditor, /data-hv-canvas-viewport-style/);
assert.match(canvasEditor, /function installCanvasViewport/);
assert.match(canvasEditor, /__HV_CANVAS_SCALE__/);
assert.match(canvasEditor, /transform: scale/);
assert.match(canvasEditor, /\(event\.clientY - drag\.startY\) \/ scale/);
assert.match(canvasEditor, /parentCanvasTop/);
assert.match(canvasEditor, /minTop: geometry\.absolutePosition\.minTop/);
assert.match(canvasEditor, /maxTop: geometry\.absolutePosition\.maxTop/);
assert.doesNotMatch(canvasEditor, /offsetParent\.clientHeight/);
assert.match(canvasEditor, /absolutePositionFor/);
assert.match(canvasEditor, /viewportSize/);
assert.match(canvasEditor, /writeElementText/);
assert.match(canvasEditor, /serializeDocument/);
assert.match(canvasEditor, /function clearPlaybackTimer\(\)\s*\{\s*if \(playbackTimerRef\.current\) clearTimeout\(playbackTimerRef\.current\);\s*playbackTimerRef\.current = null;\s*\}/);
assert.match(canvasEditor, /function playFrame/);
assert.match(canvasEditor, /__hvPlayAll/);
assert.match(canvasEditor, /__hvPlayed = true/);
assert.match(canvasEditor, /useEffect\(\(\) => \{\s*const requestId = frameLoadRequestRef\.current \+ 1;[^]*?clearPlaybackTimer\(\);[^]*?setEditingReady\(false\);[^]*?\}, \[frameId, rawHtml, htmlReloadKey\]\);/);
assert.match(canvasEditor, /function beginPlayback\(\)\s*\{\s*clearPlaybackTimer\(\);/);
assert.match(canvasEditor, /function finishPlayback/);
assert.match(canvasEditor, /finishPlayback\(\);/);
assert.match(canvasEditor, /function replay\(\)\s*\{\s*clearPlaybackTimer\(\);/);
assert.match(canvasEditor, /ResizeObserver/);
assert.match(canvasEditor, /fitPreviewBox\(previewSlotSize, previewRatio\)/);
assert.doesNotMatch(canvasEditor, /aspect-video h-full max-h-full w-auto max-w-full/);
assert.match(canvasEditor, /content-start gap-3 overflow-auto pr-1/);
assert.match(canvasEditor, /const offsetLeft = Math\.max\(0, \(viewport\.width - canvasWidth\) \/ 2\)/);
assert.match(canvasEditor, /left: \$\{Math\.round\(offsetLeft\)\}px !important/);
assert.deepEqual(fitPreviewBox({ width: 1600, height: 480 }, 16 / 9), { width: 853, height: 480 });
assert.deepEqual(fitPreviewBox({ width: 500, height: 1000 }, 16 / 9), { width: 500, height: 281 });
assert.equal(previewAspectRatio({ output: { resolution: { width: 1080, height: 1920 } } }), 1080 / 1920);

// 二次编辑修复回归断言
assert.match(canvasEditor, /\[data-hv-canvas-selected\],\[data-hv-edit-id\]/, '保存时应剥离 data-hv-edit-id');
assert.match(canvasEditor, /Object\.assign\(existing\.style, rectStyle\)/, 'overlay 应原地更新以保住 pointer capture');
assert.match(canvasEditor, /nextLeft = drag\.startLeft \+ \(drag\.startWidth - nextWidth\)/, 'w-handle 钳制后需回算 left');
assert.match(canvasEditor, /nextTop = drag\.startTop \+ \(drag\.startHeight - nextHeight\)/, 'n-handle 钳制后需回算 top');
assert.match(canvasEditor, /clone\.querySelectorAll\('\[data-hv-editor-overlay\]'\)/, '撤销快照不应包含编辑器覆盖层');
assert.match(canvasEditor, /\}, \[Boolean\(frame\), rawHtml\]\);/, 'ResizeObserver 需跟随早退分支重挂');
assert.doesNotMatch(canvasEditor, /selectAndRender\(target\);[^]*?snapshotBeforeEdit\(\);[^]*?const geometry = dragGeometryFor\(target\);/, '纯点选不应创建撤销快照');
assert.match(canvasEditor, /if \(!drag\.changed\) \{\s*snapshotBeforeEdit\(\);\s*ensurePositionedForEdit\(drag\.element\);/);
assert.match(canvasEditor, /front: current > max \? current : max \+ 1/, '置顶不应无限膨胀 z-index');
assert.match(canvasEditor, /!canEditText\(element\)/, '容器元素不允许整体改文案');
assert.match(inspector, /textEditable/);
assert.match(canvasEditor, /onTextEditStart=\{snapshotBeforeEdit\}/, '文案编辑开始时需建撤销快照（快照已不在 pointerdown）');
assert.match(inspector, /onFocus=\{\(\) => onTextEditStart\?\.\(\)\}/, 'textarea 聚焦即开始一轮文案编辑');

// canEditText：容器/图形元素禁止整体文案编辑，叶子文本元素允许
assert.equal(canEditText({ tagName: 'H1', childNodes: [{ nodeType: 3 }], children: [] }), true);
assert.equal(canEditText({ tagName: 'IMG', childNodes: [{ nodeType: 3 }], children: [] }), false);
assert.equal(canEditText({ tagName: 'svg', childNodes: [{ nodeType: 3 }], children: [] }), false);
assert.equal(canEditText({ tagName: 'SECTION', childNodes: [{ nodeType: 3 }], children: [{ textContent: '子元素文本' }] }), false);
assert.equal(canEditText({ tagName: 'DIV', childNodes: [], children: [{ textContent: '  ' }] }), false);
assert.equal(canEditText({ tagName: 'BUTTON', childNodes: [{ nodeType: 1 }, { nodeType: 3 }], children: [{ textContent: '  ' }] }), true);
assert.equal(canEditText(null), false);

assert.match(inspector, /export function HtmlVideoElementInspector/);
assert.match(inspector, /当前元素/);
assert.match(inspector, /文案/);

assert.match(projectEditor, /HtmlVideoCanvasEditor/);
assert.doesNotMatch(projectEditor, /useState\(['"]canvas['"]\)/, 'project editor should not have canvas tab state');
assert.match(projectEditor, /Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger/, 'project editor should use Dialog components');
assert.match(projectEditor, /PanelDialog/, 'project editor should have PanelDialog component');
assert.doesNotMatch(projectEditor, /id: 'canvas', label: '画布'/, 'project editor should no longer have tab definitions');

for (const dialogLabel of ['源码', '草稿', '布局检查', 'AI 修改', '导出记录']) {
  assert.ok(projectEditor.includes(dialogLabel), `HtmlVideoProjectEditor should expose ${dialogLabel} as a dialog button`);
}

console.log('test-html-video-canvas-editor-components passed');
