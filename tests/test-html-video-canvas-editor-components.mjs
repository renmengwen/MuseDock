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
assert.match(canvasEditor, /loadedFrameId/);
assert.match(canvasEditor, /正在加载当前镜头 HTML/);
assert.match(canvasEditor, /htmlLoadError/);
assert.match(canvasEditor, /当前镜头 HTML 加载失败，请重试。/);
assert.doesNotMatch(canvasEditor, /setHtml\(editor\.frameHtml\);\s*setLoadedFrameId\(frameId\);/);
assert.doesNotMatch(canvasEditor, /setHtml\(editor\.frameHtml \|\| ''\);/);
assert.match(canvasEditor, /onError/);
assert.match(canvasEditor, /HV-CANVAS-INJECT-STYLE-HERE/);
assert.match(canvasEditor, /data-hv-canvas-editor-style/);
assert.match(canvasEditor, /querySelectorAll\('\[data-hv-canvas-editor-style\]'\)/);
assert.match(canvasEditor, /doc\.head\.appendChild\(editorStyle\)/);
assert.match(canvasEditor, /data-hv-canvas-freeze/);
assert.match(canvasEditor, /data-hv-canvas-selected/);
assert.match(canvasEditor, /absolutePositionFor/);
assert.match(canvasEditor, /viewportSize/);
assert.match(canvasEditor, /writeElementText/);
assert.match(canvasEditor, /serializeDocument/);

assert.match(inspector, /export function HtmlVideoElementInspector/);
assert.match(inspector, /当前元素/);
assert.match(inspector, /文案/);

assert.match(projectEditor, /HtmlVideoCanvasEditor/);
assert.match(projectEditor, /useState\(['"]canvas['"]\)/);
assert.match(projectEditor, /id: 'canvas', label: '画布'/);
assert.ok(
  projectEditor.indexOf("{ id: 'canvas', label: '画布' }") < projectEditor.indexOf("{ id: 'source', label: '源码' }"),
  'canvas tab should render before source tab',
);
assert.match(projectEditor, /activeTab === 'canvas'[^]*<HtmlVideoCanvasEditor\s+editor=\{editor\}\s*\/>/);

for (const tabLabel of ['源码', '草稿', '布局检查', 'AI 修改', '字段', '导出']) {
  assert.ok(projectEditor.includes(tabLabel), `HtmlVideoProjectEditor should keep ${tabLabel} tab`);
}

console.log('test-html-video-canvas-editor-components passed');
