import { useState } from 'react';

export function CaptionEditor({ captions, disabled, onSaveCaption }) {
  const [drafts, setDrafts] = useState({});

  if (!captions || captions.length === 0) return <div className="edit-section"><label>字幕</label><p>暂无字幕</p></div>;

  const getDraft = (captionId) => {
    if (drafts[captionId] !== undefined) return drafts[captionId];
    const caption = captions.find(c => c.id === captionId);
    return caption?.text || '';
  };

  return (
    <div className="edit-section">
      <label>字幕</label>
      {captions.map(caption => (
        <div key={caption.id} className="caption-row">
          <input
            type="text"
            value={getDraft(caption.id)}
            onChange={(e) => setDrafts(prev => ({ ...prev, [caption.id]: e.target.value }))}
            disabled={disabled}
          />
          <button
            disabled={disabled}
            onClick={() => onSaveCaption(caption.id, getDraft(caption.id))}
          >
            保存字幕
          </button>
        </div>
      ))}
    </div>
  );
}
