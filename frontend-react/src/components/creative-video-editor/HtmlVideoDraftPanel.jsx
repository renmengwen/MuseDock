function activeDraft(frame) {
  const drafts = Array.isArray(frame?.drafts) ? frame.drafts : [];
  return drafts.find(draft => draft.id === frame?.active_draft_id) || null;
}

export function HtmlVideoDraftPanel({ frame, disabled, onAccept, onDiscard, onRender }) {
  const draft = activeDraft(frame);
  const frameId = frame?.id || frame?.scene_id || '';

  return (
    <section className="creative-video-editor-panel html-video-draft-panel">
      <div className="creative-video-editor-panel-header">
        <h3>草稿</h3>
        {draft ? (
          <div className="creative-video-editor-inline-actions">
            <button type="button" disabled={disabled} onClick={() => onRender(frameId, draft.id)}>渲染草稿</button>
            <button type="button" disabled={disabled} onClick={() => onAccept(frameId, draft.id)}>接受草稿</button>
            <button type="button" disabled={disabled} onClick={() => onDiscard(frameId, draft.id)}>放弃草稿</button>
          </div>
        ) : null}
      </div>
      {draft ? <p>{draft.summary || draft.instruction || draft.id}</p> : <p>当前帧没有待处理草稿。</p>}
    </section>
  );
}
