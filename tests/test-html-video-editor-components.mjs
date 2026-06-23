import assert from 'node:assert/strict';
import fs from 'node:fs';

const { buildFrameSavePayload } = await import('../frontend-react/src/components/creative-video-editor/frameInputsPayload.mjs');

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
  '正在加载当前帧源码',
  '正在保存帧源码草稿',
  '正在接受草稿',
  '正在放弃草稿',
  '正在运行布局检查',
  '正在重写当前帧 HTML',
  '正在生成全片编辑计划',
  '正在执行全片编辑计划',
  '正在接受计划草稿',
  '正在放弃计划草稿',
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
  'getHtmlVideoProjectFrameHtml',
  'saveHtmlVideoProjectFrameHtml',
  'acceptHtmlVideoProjectFrameDraft',
  'discardHtmlVideoProjectFrameDraft',
  'inspectHtmlVideoProjectLayout',
  'iterateHtmlVideoProjectFrame',
  'createHtmlVideoProjectEditPlan',
  'runHtmlVideoProjectEditPlan',
  'acceptHtmlVideoProjectEditPlan',
  'discardHtmlVideoProjectEditPlan',
]) {
  assert.ok(hook.includes(method), `hook should call api.${method}`);
}

for (const hookSurface of [
  'frameHtml',
  'layoutQa',
  'editPlan',
  'loadFrameHtml',
  'saveFrameHtmlDraft',
  'acceptFrameDraft',
  'discardFrameDraft',
  'inspectLayout',
  'iterateFrame',
  'createEditPlan',
  'runEditPlan',
  'acceptEditPlan',
  'discardEditPlan',
]) {
  assert.ok(hook.includes(hookSurface), `hook should expose ${hookSurface}`);
}

assert.match(hook, /useRef\(/, 'hook should use refs for duplicate request protection');
assert.match(hook, /mutatingRef|actionRef|inFlightRef/, 'hook should keep a mutating ref');
assert.match(hook, /isMutating/, 'hook should expose mutating disabled state');
assert.match(hook, /html_video_project/, 'hook should parse API html_video_project payloads');
assert.match(hook, /data\?\.html_video_project/, 'hook should parse nested data.html_video_project payloads');

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
assert.match(templateInputs, /schema\?\.properties/, 'TemplateInputsPanel should read schema.properties');
assert.ok(templateInputs.includes('当前模板未声明可编辑字段'), 'TemplateInputsPanel should show Chinese empty schema state');

const naturalEdit = fs.readFileSync('frontend-react/src/components/creative-video-editor/NaturalLanguageEditBox.jsx', 'utf-8');
assert.ok(naturalEdit.includes('正在解析编辑意图'), 'natural language edit should show loading text');
assert.ok(naturalEdit.includes('编辑已应用，需要重新渲染'), 'natural language edit should show success text');

const exportsPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/ExportsPanel.jsx', 'utf-8');
assert.ok(exportsPanel.includes('正在导出成片'), 'exports panel should show export loading text');
assert.ok(exportsPanel.includes('导出成片'), 'exports panel should provide export action');
assert.ok(exportsPanel.includes('播放'), 'exports panel should provide a playback action for each export record');
assert.ok(exportsPanel.includes('formatExportTime'), 'exports panel should format export timestamps before rendering');
assert.match(exportsPanel, /toLocaleString\('zh-CN'/, 'exports panel should render export timestamps in local Chinese format');
assert.ok(exportsPanel.includes('getExportPlaybackUrl'), 'exports panel should resolve a safe playback URL for exported videos');

const frameInputsPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/FrameInputsPanel.jsx', 'utf-8');
const frameInputsPayload = fs.readFileSync('frontend-react/src/components/creative-video-editor/frameInputsPayload.mjs', 'utf-8');
assert.match(frameInputsPanel, /duration_sec/, 'FrameInputsPanel should edit html-video duration_sec values returned by the project schema');
assert.match(frameInputsPanel, /metadata\?\.visual_text\?\.headline/, 'FrameInputsPanel should project raw_html visual headline into the title field');
assert.match(frameInputsPanel, /buildFrameSavePayload/, 'FrameInputsPanel should use the tested frame payload helper');
assert.doesNotMatch(frameInputsPanel, /template_id:\s*draft\.template_id\s*\|\|\s*draft\.template\s*\|\|\s*''/, 'FrameInputsPanel should not send empty template_id values');
assert.match(frameInputsPayload, /type:\s*'frame_patch'/, 'Frame payload helper should send explicit frame_patch payloads');
assert.match(frameInputsPayload, /frame_id:\s*draft\.id\s*\|\|\s*draft\.scene_id/, 'Frame payload helper should include the edited frame id');
assert.match(frameInputsPayload, /if\s*\(templateId\)/, 'Frame payload helper should only include non-empty template_id values');
assert.doesNotMatch(frameInputsPanel, /duration_sec:\s*Number\(draft\.duration_sec\)/, 'FrameInputsPanel should not always send empty duration as 0');
assert.match(frameInputsPayload, /duration\s*>\s*0/, 'Frame payload helper should only include duration_sec when the draft duration is positive');
assert.match(frameInputsPayload, /metadata_patch:\s*\{[^]*visual_text:\s*\{[^]*headline/s, 'Frame payload helper should save headline through frame metadata_patch');

{
  const payload = buildFrameSavePayload({
    id: 'frame_01',
    duration_sec: '',
    title: '新标题',
    narration_text: '新旁白',
    inputs: { headline: '旧标题', body: '正文' },
  });
  assert.equal(payload.type, 'frame_patch');
  assert.equal(payload.frame_id, 'frame_01');
  assert.equal(payload.narration_text, '新旁白');
  assert.equal(payload.inputs.headline, '新标题');
  assert.equal(payload.inputs.body, '正文');
  assert.equal(payload.metadata_patch.visual_text.headline, '新标题');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'template_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'duration_sec'), false);
}

{
  const payload = buildFrameSavePayload({
    scene_id: 'scene_01',
    template_id: ' template_a ',
    duration_sec: 2.5,
    headline: '标题',
    inputs: {},
  });
  assert.equal(payload.frame_id, 'scene_01');
  assert.equal(payload.template_id, 'template_a');
  assert.equal(payload.duration_sec, 2.5);
  assert.equal(payload.metadata_patch.visual_text.headline, '标题');
}

for (const invalidDuration of [0, -1, '0', '-1', 'abc']) {
  const payload = buildFrameSavePayload({
    id: 'frame_invalid_duration',
    duration_sec: invalidDuration,
    title: '标题',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'duration_sec'), false, `invalid duration should be omitted: ${invalidDuration}`);
}

const captionsPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/CaptionsPanel.jsx', 'utf-8');
assert.match(captionsPanel, /selectedFrameId/, 'CaptionsPanel should require a selected frame before saving captions');
assert.match(captionsPanel, /type:\s*'frame_patch'/, 'CaptionsPanel should save captions through frame_patch');
assert.match(captionsPanel, /frame_id:\s*selectedFrameId/, 'CaptionsPanel should target the selected frame id');
assert.doesNotMatch(captionsPanel, /onSave\(\{\s*captions:\s*drafts\s*\}\)/, 'CaptionsPanel should not save project-level captions');
assert.ok(captionsPanel.includes('请选择一帧后编辑字幕。'), 'CaptionsPanel should show a Chinese empty selection state');

assert.match(editor, /frames\s*=\s*Array\.isArray\(editor\.frames\)\s*\?\s*editor\.frames\s*:\s*\[\]/, 'HtmlVideoProjectEditor should fallback to an empty frames array');
assert.match(editor, /selectedFrame\s*=\s*frames\.find/, 'HtmlVideoProjectEditor should resolve captions from the selected frame');
assert.match(editor, /frames=\{frames\}/, 'HtmlVideoProjectEditor should pass the safe frames array to ProjectFramesList');
assert.match(editor, /captions=\{selectedFrame\?\.captions\s*\|\|\s*\[\]\}/, 'HtmlVideoProjectEditor should pass selected frame captions to CaptionsPanel');
assert.match(editor, /selectedFrameId=\{selectedFrame\?\.id\s*\|\|\s*selectedFrame\?\.scene_id\s*\|\|\s*''\}/, 'HtmlVideoProjectEditor should pass selected frame id to CaptionsPanel');

const projectFramesList = fs.readFileSync('frontend-react/src/components/creative-video-editor/ProjectFramesList.jsx', 'utf-8');
assert.match(projectFramesList, /duration_sec/, 'ProjectFramesList should display duration_sec values returned by html-video projects');
assert.match(projectFramesList, /metadata\?\.visual_text\?\.headline/, 'ProjectFramesList should use raw_html visual headline as the frame title');

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
