import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('frontend-react/src/pages/OneClickCreativePage.jsx', 'utf-8');
const editorPage = fs.readFileSync('frontend-react/src/pages/CreativeEditorPage.jsx', 'utf-8');
const hook = fs.readFileSync('frontend-react/src/hooks/useCreativeVideoEditor.js', 'utf-8');
const shell = fs.readFileSync('frontend-react/src/components/one-click-editor/CreativeVideoEditor.jsx', 'utf-8');
const sceneList = fs.readFileSync('frontend-react/src/components/one-click-editor/SceneList.jsx', 'utf-8');
const editPanel = fs.readFileSync('frontend-react/src/components/one-click-editor/SceneEditPanel.jsx', 'utf-8');
const captions = fs.readFileSync('frontend-react/src/components/one-click-editor/CaptionEditor.jsx', 'utf-8');
const visual = fs.readFileSync('frontend-react/src/components/one-click-editor/VisualTextEditor.jsx', 'utf-8');
const status = fs.readFileSync('frontend-react/src/components/one-click-editor/EditorStatusBar.jsx', 'utf-8');

assert.ok(editorPage.includes('CreativeVideoEditor'), 'CreativeEditorPage should own CreativeVideoEditor rendering');
assert.ok(!page.includes('<CreativeVideoEditor'), 'OneClickCreativePage should not render CreativeVideoEditor inline');
assert.ok(
  page.includes('navigate(`/editor/${encodeURIComponent(id)}`)'),
  'OneClickCreativePage should navigate to the editor route',
);
assert.doesNotMatch(page, /patchCreativeWorkflowSceneSpec|caption_id|selectedEditSceneId/);
assert.ok(hook.includes('useCreativeVideoEditor'));
assert.ok(hook.includes('getCreativeWorkflowSceneSpec'));
assert.ok(hook.includes('patchCreativeWorkflowSceneSpec'));
assert.ok(hook.includes('rewriteCreativeWorkflowScene'));
assert.ok(hook.includes('ttsCreativeWorkflowScene'));
assert.ok(hook.includes('rerenderCreativeWorkflow'));
assert.ok(shell.includes('SceneList'));
assert.ok(shell.includes('SceneEditPanel'));
assert.ok(shell.includes('EditorStatusBar'));
assert.ok(sceneList.includes('上移'));
assert.ok(sceneList.includes('下移'));
assert.ok(editPanel.includes('场景时长'));
assert.ok(editPanel.includes('重写本场景'));
assert.ok(editPanel.includes('重新配音本场景'));
assert.ok(captions.includes('字幕'));
assert.ok(visual.includes('画面标题'));
assert.ok(status.includes('正在'));

console.log('one click editor component tests passed');
