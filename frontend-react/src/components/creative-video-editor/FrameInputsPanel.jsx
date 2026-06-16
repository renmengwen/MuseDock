import { useEffect, useState } from 'react';

export function FrameInputsPanel({ frame, disabled, onSave, onRenderPreview }) {
  const [draft, setDraft] = useState(frame || null);

  useEffect(() => {
    setDraft(frame || null);
  }, [frame]);

  if (!draft) {
    return <section className="creative-video-editor-panel"><p>请选择要编辑的帧</p></section>;
  }

  return (
    <section className="creative-video-editor-panel html-video-frame-inputs">
      <div className="creative-video-editor-panel-header">
        <h3>帧字段</h3>
        <div className="creative-video-editor-inline-actions">
          <button type="button" disabled={disabled} onClick={() => onRenderPreview(draft.id)}>渲染单帧预览</button>
          <button type="button" disabled={disabled} onClick={() => onSave(draft.id, draft)}>保存帧</button>
        </div>
      </div>
      <label>
        <span>模板</span>
        <input value={draft.template_id || draft.template || ''} disabled={disabled} onChange={event => setDraft({ ...draft, template_id: event.target.value })} />
      </label>
      <label>
        <span>时长（秒）</span>
        <input type="number" min="0" step="0.1" value={draft.duration || ''} disabled={disabled} onChange={event => setDraft({ ...draft, duration: Number(event.target.value) || 0 })} />
      </label>
      <label>
        <span>标题</span>
        <input value={draft.title || ''} disabled={disabled} onChange={event => setDraft({ ...draft, title: event.target.value })} />
      </label>
      <label>
        <span>帧输入 JSON</span>
        <textarea
          value={JSON.stringify(draft.inputs || {}, null, 2)}
          disabled={disabled}
          rows={6}
          onChange={event => {
            try {
              setDraft({ ...draft, inputs: JSON.parse(event.target.value || '{}') });
            } catch {
              setDraft({ ...draft, inputsText: event.target.value });
            }
          }}
        />
      </label>
    </section>
  );
}
