import { useEffect, useState } from 'react';

export function NarrationPanel({ narration, disabled, onSave, onRegenerate }) {
  const [draft, setDraft] = useState(narration?.text || narration || '');

  useEffect(() => {
    setDraft(narration?.text || narration || '');
  }, [narration]);

  return (
    <section className="creative-video-editor-panel html-video-narration">
      <div className="creative-video-editor-panel-header">
        <h3>旁白</h3>
        <div className="creative-video-editor-inline-actions">
          <button type="button" disabled={disabled} onClick={() => onRegenerate({ text: draft })}>重新生成旁白</button>
          <button type="button" disabled={disabled} onClick={() => onSave({ narration: { text: draft } })}>保存旁白</button>
        </div>
      </div>
      <textarea value={draft} disabled={disabled} rows={5} onChange={event => setDraft(event.target.value)} />
    </section>
  );
}
