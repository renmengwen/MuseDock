import { useEffect, useState } from 'react';
import { EditorSection } from './editorUi.jsx';

export function CaptionEditor({ captions = [], disabled, onChange }) {
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    const next = {};
    for (const caption of captions) {
      next[caption.id] = caption.text || '';
    }
    setDrafts(next);
  }, [captions]);

  function updateCaption(captionId, text) {
    const nextDrafts = { ...drafts, [captionId]: text };
    setDrafts(nextDrafts);
    onChange(captions.map(caption => (
      caption.id === captionId ? { ...caption, text } : caption
    )));
  }

  return (
    <EditorSection>
      <h4>字幕</h4>
      {captions.length ? captions.map(caption => (
        <label key={caption.id}>
          <span>{caption.id}</span>
          <input
            value={drafts[caption.id] || ''}
            disabled={disabled}
            onChange={event => updateCaption(caption.id, event.target.value)}
          />
        </label>
      )) : <p>暂无字幕</p>}
    </EditorSection>
  );
}
