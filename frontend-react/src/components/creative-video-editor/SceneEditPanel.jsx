import { useEffect, useState } from 'react';
import { CaptionEditor } from './CaptionEditor.jsx';
import { VisualTextEditor } from './VisualTextEditor.jsx';

export function SceneEditPanel({ scene, disabled, onSave }) {
  const [draft, setDraft] = useState(scene || null);

  useEffect(() => {
    setDraft(scene || null);
  }, [scene]);

  if (!draft) {
    return <section className="creative-video-editor-panel"><p>请选择场景</p></section>;
  }

  return (
    <section className="creative-video-editor-panel">
      <div className="creative-video-editor-panel-header">
        <h3>场景编辑</h3>
        <button type="button" disabled={disabled} onClick={() => onSave(draft)}>保存场景</button>
      </div>
      <label>
        <span>场景时长</span>
        <input
          type="number"
          min="0.5"
          step="0.1"
          value={draft.duration || ''}
          disabled={disabled}
          onChange={event => setDraft({ ...draft, duration: Number(event.target.value) })}
        />
      </label>
      <label>
        <span>旁白文本</span>
        <textarea
          value={draft.narration_text || ''}
          disabled={disabled}
          rows={4}
          onChange={event => setDraft({ ...draft, narration_text: event.target.value })}
        />
      </label>
      <VisualTextEditor
        visualText={draft.visual_text}
        disabled={disabled}
        onChange={visual_text => setDraft({ ...draft, visual_text })}
      />
      <CaptionEditor
        captions={draft.captions || []}
        disabled={disabled}
        onChange={captions => setDraft({ ...draft, captions })}
      />
    </section>
  );
}
