import { useEffect, useState } from 'react';
import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';

export function NarrationPanel({ narration, disabled, onSave, onRegenerate }) {
  const [draft, setDraft] = useState(narration?.text || narration || '');

  useEffect(() => {
    setDraft(narration?.text || narration || '');
  }, [narration]);

  return (
    <EditorPanel className="[&_textarea]:resize-y">
      <EditorPanelHeader>
        <h3>旁白</h3>
        <EditorInlineActions>
          <button type="button" disabled={disabled} onClick={() => onRegenerate({ text: draft })}>重新生成旁白</button>
          <button type="button" disabled={disabled} onClick={() => onSave({ text: draft })}>保存旁白</button>
        </EditorInlineActions>
      </EditorPanelHeader>
      <textarea value={draft} disabled={disabled} rows={5} onChange={event => setDraft(event.target.value)} />
    </EditorPanel>
  );
}
