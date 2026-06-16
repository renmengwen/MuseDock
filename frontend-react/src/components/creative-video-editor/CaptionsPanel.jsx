import { useEffect, useState } from 'react';

export function CaptionsPanel({ captions = [], disabled, onSave }) {
  const [drafts, setDrafts] = useState(captions);

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
        <button type="button" disabled={disabled} onClick={() => onSave({ captions: drafts })}>保存字幕</button>
      </div>
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
