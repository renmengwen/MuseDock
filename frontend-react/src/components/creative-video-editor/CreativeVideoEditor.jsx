import { useCreativeVideoEditor } from '../../hooks/useCreativeVideoEditor.js';
import { EditorStatusBar } from './EditorStatusBar.jsx';
import { FrameEditPanel } from './FrameEditPanel.jsx';
import { FrameList } from './FrameList.jsx';
import { RenderVersionPanel } from './RenderVersionPanel.jsx';
import { SceneEditPanel } from './SceneEditPanel.jsx';
import { SceneList } from './SceneList.jsx';

export function CreativeVideoEditor({ workflowId, api, onRendered }) {
  const editor = useCreativeVideoEditor({ workflowId, api });
  const disabled = editor.loading || editor.saving;

  async function handleRerender() {
    await editor.rerender();
    onRendered?.();
  }

  return (
    <section className="creative-video-editor">
      <EditorStatusBar status={editor.status} message={editor.message} dirtyRequiresRender={editor.dirtyRequiresRender} />
      <div className="creative-video-editor-toolbar">
        <button type="button" disabled={disabled} onClick={editor.load}>重新加载</button>
        <button type="button" disabled={disabled || !editor.dirtyRequiresRender} onClick={handleRerender}>重新渲染</button>
        <button type="button" disabled={disabled} onClick={() => editor.remix({})}>创建二创</button>
      </div>
      <div className="creative-video-editor-grid">
        <SceneList
          scenes={editor.sceneSpec?.scenes || []}
          selectedSceneId={editor.selectedSceneId}
          disabled={disabled}
          onSelect={editor.selectScene}
        />
        <SceneEditPanel
          scene={editor.selectedScene}
          disabled={disabled}
          onSave={scene => editor.saveSceneEdit(scene.id, scene)}
        />
        <FrameList
          frames={editor.frameSpecs?.frames || []}
          selectedFrameId={editor.selectedFrameId}
          disabled={disabled}
          onSelect={editor.selectFrame}
        />
        <FrameEditPanel
          frame={editor.selectedFrame}
          disabled={disabled}
          onSave={frame => editor.saveFrameEdit(frame.id, frame)}
        />
      </div>
      <RenderVersionPanel versions={editor.renderVersions} />
    </section>
  );
}
