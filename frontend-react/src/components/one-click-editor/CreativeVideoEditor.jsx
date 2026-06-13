import { useCreativeVideoEditor } from '../../hooks/useCreativeVideoEditor.js';
import { SceneList } from './SceneList.jsx';
import { SceneEditPanel } from './SceneEditPanel.jsx';
import { EditorStatusBar } from './EditorStatusBar.jsx';

export function CreativeVideoEditor({ workflowId, api, onRendered }) {
  const editor = useCreativeVideoEditor({ workflowId, api });

  return (
    <div className="one-click-editor">
      <EditorStatusBar status={editor.status} message={editor.message} />
      <div className="one-click-editor-body">
        <SceneList
          scenes={editor.sceneSpec?.scenes || []}
          selectedSceneId={editor.selectedSceneId}
          onSelect={editor.selectScene}
          onMove={editor.moveScene}
          disabled={editor.saving}
        />
        {editor.selectedScene && (
          <SceneEditPanel
            scene={editor.selectedScene}
            disabled={editor.saving}
            onCaptionText={(captionId, text) => editor.saveCaptionText(editor.selectedSceneId, captionId, text)}
            onNarrationText={(text) => editor.saveNarrationText(editor.selectedSceneId, text)}
            onVisualText={(visual_text) => editor.saveVisualText(editor.selectedSceneId, visual_text)}
            onDuration={(duration) => editor.saveDuration(editor.selectedSceneId, duration)}
            onRewrite={(payload) => editor.rewriteScene(editor.selectedSceneId, payload)}
            onTts={(payload) => editor.ttsScene(editor.selectedSceneId, payload)}
            onRerender={() => editor.rerender()}
          />
        )}
      </div>
    </div>
  );
}
