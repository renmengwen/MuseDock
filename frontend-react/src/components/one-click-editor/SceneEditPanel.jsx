import { useEffect, useState } from 'react';
import { CaptionEditor } from './CaptionEditor.jsx';
import { VisualTextEditor } from './VisualTextEditor.jsx';

export function SceneEditPanel({ scene, disabled, onCaptionText, onNarrationText, onVisualText, onDuration, onRewrite, onTts, onRerender }) {
  const [narrationDraft, setNarrationDraft] = useState(scene?.narration_text || '');
  const [durationDraft, setDurationDraft] = useState(String(scene?.duration || ''));

  useEffect(() => {
    setNarrationDraft(scene?.narration_text || '');
    setDurationDraft(String(scene?.duration || ''));
  }, [scene?.narration_text, scene?.duration]);

  if (!scene) return null;

  return (
    <div className="one-click-editor-edit-panel">
      <h3>场景编辑: {scene.id}</h3>

      <div className="edit-section">
        <label>场景时长（秒）</label>
        <input
          type="number"
          value={durationDraft}
          onChange={(e) => setDurationDraft(e.target.value)}
          disabled={disabled}
          step="0.01"
          min="0"
        />
        <button disabled={disabled} onClick={() => {
          const val = parseFloat(durationDraft);
          if (!isNaN(val) && val > 0) onDuration(val);
        }}>
          保存时长
        </button>
      </div>

      <div className="edit-section">
        <label>旁白文本</label>
        <textarea
          value={narrationDraft}
          onChange={(e) => setNarrationDraft(e.target.value)}
          disabled={disabled}
          rows={4}
        />
        <button disabled={disabled} onClick={() => onNarrationText(narrationDraft)}>
          保存旁白
        </button>
      </div>

      <VisualTextEditor
        visualText={scene.visual_text}
        disabled={disabled}
        onSave={onVisualText}
      />

      <CaptionEditor
        captions={scene.captions}
        disabled={disabled}
        onSaveCaption={onCaptionText}
      />

      <div className="edit-actions">
        <button disabled={disabled} onClick={() => onRewrite({})}>
          重写本场景
        </button>
        <button disabled={disabled} onClick={() => onTts({})}>
          重新配音本场景
        </button>
        <button disabled={disabled} onClick={onRerender}>
          重新渲染成片
        </button>
      </div>
    </div>
  );
}
