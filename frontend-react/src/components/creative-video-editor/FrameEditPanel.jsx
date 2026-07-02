import { useEffect, useState } from 'react';
import { EditorPanel, EditorPanelHeader } from './editorUi.jsx';

export function FrameEditPanel({ frame, disabled, onSave }) {
  const [draft, setDraft] = useState(frame || null);

  useEffect(() => {
    setDraft(frame || null);
  }, [frame]);

  if (!draft) {
    return <EditorPanel><p>请选择帧</p></EditorPanel>;
  }

  return (
    <EditorPanel>
      <EditorPanelHeader>
        <h3>帧编辑</h3>
        <button type="button" disabled={disabled} onClick={() => onSave(draft)}>保存帧</button>
      </EditorPanelHeader>
      <label>
        <span>模板</span>
        <input value={draft.template || ''} disabled={disabled} onChange={event => setDraft({ ...draft, template: event.target.value })} />
      </label>
      <label>
        <span>背景</span>
        <input value={draft.background || ''} disabled={disabled} onChange={event => setDraft({ ...draft, background: event.target.value })} />
      </label>
      <label>
        <span>动效</span>
        <input value={draft.motion || ''} disabled={disabled} onChange={event => setDraft({ ...draft, motion: event.target.value })} />
      </label>
    </EditorPanel>
  );
}
