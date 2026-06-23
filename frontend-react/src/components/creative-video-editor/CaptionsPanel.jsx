import { useEffect, useState } from 'react';

export function CaptionsPanel({ captions = [], selectedFrameId, disabled, onSave }) {
  const [drafts, setDrafts] = useState(captions);
  const canSave = Boolean(selectedFrameId) && !disabled;

  useEffect(() => {
    setDrafts(captions);
  }, [captions]);

  function updateCaption(index, patch) {
    setDrafts(prev => prev.map((caption, currentIndex) => (
      currentIndex === index ? { ...caption, ...patch } : caption
    )));
  }

  return (
    <section className="creative-video-editor-panel html-video-captions">
      <div className="creative-video-editor-panel-header">
        <h3>字幕</h3>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onSave({
            type: 'frame_patch',
            frame_id: selectedFrameId,
            captions: drafts,
          })}
        >
          保存字幕
        </button>
      </div>
      {!selectedFrameId ? <p className="muted">请选择一帧后编辑字幕。</p> : null}
      {drafts.length ? drafts.map((caption, index) => (
        <label key={caption.id || index}>
          <span>{caption.id || `字幕 ${index + 1}`}</span>
          <input
            value={caption.text || ''}
            disabled={disabled}
            onChange={event => updateCaption(index, { text: event.target.value })}
          />
        </label>
      )) : <p>暂无字幕</p>}
    </section>
  );
}
