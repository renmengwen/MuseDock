import assert from 'node:assert/strict';
import fs from 'node:fs';

const hook = fs.readFileSync('frontend-react/src/hooks/useHtmlVideoProject.js', 'utf-8');
const shell = fs.readFileSync('frontend-react/src/components/creative-video-editor/CreativeVideoEditor.jsx', 'utf-8');
const editor = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx', 'utf-8');

const componentPaths = [
  'frontend-react/src/components/creative-video-editor/ProjectStatusBar.jsx',
  'frontend-react/src/components/creative-video-editor/TemplateInputsPanel.jsx',
  'frontend-react/src/components/creative-video-editor/FrameInputsPanel.jsx',
  'frontend-react/src/components/creative-video-editor/NarrationPanel.jsx',
  'frontend-react/src/components/creative-video-editor/CaptionsPanel.jsx',
  'frontend-react/src/components/creative-video-editor/ProjectFramesList.jsx',
  'frontend-react/src/components/creative-video-editor/ExportsPanel.jsx',
  'frontend-react/src/components/creative-video-editor/NaturalLanguageEditBox.jsx',
];

for (const componentPath of componentPaths) {
  assert.ok(fs.existsSync(componentPath), `missing component ${componentPath}`);
}

for (const status of [
  'loading',
  'saving',
  'editing',
  'materializing',
  'rendering',
  'exporting',
  'tts',
  'error',
  'not_configured',
  'needs_validation',
  'ready',
]) {
  assert.ok(hook.includes(status), `hook should handle status ${status}`);
}

for (const message of [
  '正在加载可编辑成片工程',
  '可编辑成片工程已加载',
  '正在保存模板字段',
  '正在应用编辑',
  '正在重新生成 HTML',
  '正在渲染单帧预览',
  '正在导出成片',
  '正在重新生成旁白',
  '渲染环境未配置',
  '工程需要验证',
]) {
  assert.ok(hook.includes(message), `hook should expose Chinese message: ${message}`);
}

for (const method of [
  'getHtmlVideoProject',
  'patchHtmlVideoProjectInputs',
  'patchHtmlVideoProjectFrame',
  'editHtmlVideoProject',
  'renderHtmlVideoProject',
  'exportHtmlVideoProject',
  'listHtmlVideoProjectExports',
]) {
  assert.ok(hook.includes(method), `hook should call api.${method}`);
}

assert.match(hook, /useRef\(/, 'hook should use refs for duplicate request protection');
assert.match(hook, /mutatingRef|actionRef|inFlightRef/, 'hook should keep a mutating ref');
assert.match(hook, /isMutating/, 'hook should expose mutating disabled state');

for (const componentName of [
  'ProjectStatusBar',
  'ProjectFramesList',
  'TemplateInputsPanel',
  'FrameInputsPanel',
  'NarrationPanel',
  'CaptionsPanel',
  'ExportsPanel',
  'NaturalLanguageEditBox',
]) {
  assert.ok(editor.includes(componentName), `HtmlVideoProjectEditor should compose ${componentName}`);
}

assert.doesNotMatch(editor, /ReservedCapabilitiesPanel/, 'advanced reserved panel should not be shown by default');
assert.doesNotMatch(editor, /源码|sourceHtml|html_source|contentEditable/, 'editor should not expose HTML source editing');

const templateInputs = fs.readFileSync('frontend-react/src/components/creative-video-editor/TemplateInputsPanel.jsx', 'utf-8');
for (const inputType of ['string', 'number', 'boolean', 'enum', 'array']) {
  assert.ok(templateInputs.includes(inputType), `TemplateInputsPanel should render ${inputType} fields`);
}

const naturalEdit = fs.readFileSync('frontend-react/src/components/creative-video-editor/NaturalLanguageEditBox.jsx', 'utf-8');
assert.ok(naturalEdit.includes('正在解析编辑意图'), 'natural language edit should show loading text');
assert.ok(naturalEdit.includes('编辑已应用，需要重新渲染'), 'natural language edit should show success text');

const exportsPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/ExportsPanel.jsx', 'utf-8');
assert.ok(exportsPanel.includes('正在导出成片'), 'exports panel should show export loading text');
assert.ok(exportsPanel.includes('导出成片'), 'exports panel should provide export action');

assert.ok(shell.includes('useHtmlVideoProject'), 'CreativeVideoEditor should try HtmlVideoProject first');
assert.ok(shell.includes('HtmlVideoProjectEditor'), 'CreativeVideoEditor should render HtmlVideoProjectEditor');
assert.match(shell, /NO_HTML_VIDEO_PROJECT|status\s*===\s*404|\.status\s*===\s*404/, 'CreativeVideoEditor should fallback on missing HtmlVideoProject');

for (const componentPath of [
  'frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx',
  ...componentPaths,
]) {
  const source = fs.readFileSync(componentPath, 'utf-8');
  assert.doesNotMatch(source, /fetch\(|from ['"]\.\.\/\.\.\/api\/client|api\./, `${componentPath} should not call API directly`);
}

console.log('html video editor component tests passed');
