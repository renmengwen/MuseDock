import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('frontend-react/src/pages/OneClickCreativePage.jsx', 'utf-8');
const hook = fs.readFileSync('frontend-react/src/hooks/useCreativeVideoEditor.js', 'utf-8');
const editor = fs.readFileSync('frontend-react/src/components/creative-video-editor/CreativeVideoEditor.jsx', 'utf-8');
const sceneList = fs.readFileSync('frontend-react/src/components/creative-video-editor/SceneList.jsx', 'utf-8');
const frameList = fs.readFileSync('frontend-react/src/components/creative-video-editor/FrameList.jsx', 'utf-8');
const status = fs.readFileSync('frontend-react/src/components/creative-video-editor/EditorStatusBar.jsx', 'utf-8');

assert.ok(page.includes('CreativeVideoEditor'));
assert.doesNotMatch(page, /caption_id|frame_specs|patchCreativeVideoSpec|selectedSceneId/);
assert.ok(hook.includes('getCreativeVideoSpec'));
assert.ok(hook.includes('patchCreativeVideoSpec'));
assert.ok(hook.includes('rerenderCreativeVideo'));
assert.ok(hook.includes('remixCreativeVideo'));
assert.ok(hook.includes('正在加载可编辑工程'));
assert.ok(hook.includes('正在保存编辑'));
assert.ok(hook.includes('正在重新渲染'));
assert.ok(hook.includes('内容已修改，需要重新渲染'));
assert.ok(editor.includes('SceneList'));
assert.ok(editor.includes('FrameList'));
assert.ok(editor.includes('EditorStatusBar'));
assert.ok(sceneList.includes('场景'));
assert.ok(frameList.includes('帧'));
assert.ok(status.includes('message'));

for (const componentPath of [
  'frontend-react/src/components/creative-video-editor/CreativeVideoEditor.jsx',
  'frontend-react/src/components/creative-video-editor/SceneList.jsx',
  'frontend-react/src/components/creative-video-editor/SceneEditPanel.jsx',
  'frontend-react/src/components/creative-video-editor/FrameList.jsx',
  'frontend-react/src/components/creative-video-editor/FrameEditPanel.jsx',
  'frontend-react/src/components/creative-video-editor/CaptionEditor.jsx',
  'frontend-react/src/components/creative-video-editor/VisualTextEditor.jsx',
  'frontend-react/src/components/creative-video-editor/RenderVersionPanel.jsx',
  'frontend-react/src/components/creative-video-editor/EditorStatusBar.jsx',
]) {
  const source = fs.readFileSync(componentPath, 'utf-8');
  assert.doesNotMatch(source, /fetch\(|from ['"]\.\.\/\.\.\/api\/client|api\./, `${componentPath} should not call API directly`);
}

console.log('creative video editor component tests passed');
