import { useEffect, useState } from 'react';

export function FrameEditPanel({ frame, disabled, onSave }) {
  const [draft, setDraft] = useState(frame || null);

  useEffect(() => {
    setDraft(frame || null);
  }, [frame]);

  if (!draft) {
    return <section className="creative-video-editor-panel"><p>请选择帧</p></section>;
  }

  return (
    <section className="creative-video-editor-panel">
      <div className="creative-video-editor-panel-header">
        <h3>帧编辑</h3>
        <button type="button" disabled={disabled} onClick={() => onSave(draft)}>保存帧</button>
      </div>
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
    </section>
  );
}
