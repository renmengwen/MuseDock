import { useEffect, useState } from 'react';

export function VisualTextEditor({ visualText, disabled, onSave }) {
  const [headline, setHeadline] = useState(visualText?.headline || '');
  const [keywords, setKeywords] = useState((visualText?.keywords || []).join(', '));
  const [cards, setCards] = useState((visualText?.cards || []).join('\n'));

  useEffect(() => {
    setHeadline(visualText?.headline || '');
    setKeywords((visualText?.keywords || []).join(', '));
    setCards((visualText?.cards || []).join('\n'));
  }, [visualText?.headline, visualText?.keywords?.join(','), visualText?.cards?.join('\n')]);

  const handleSave = () => {
    onSave({
      headline,
      keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
      cards: cards.split('\n').map(c => c.trim()).filter(Boolean),
    });
  };

  return (
    <div className="edit-section">
      <label>画面标题</label>
      <input
        type="text"
        value={headline}
        onChange={(e) => setHeadline(e.target.value)}
        disabled={disabled}
      />

      <label>关键词（逗号分隔）</label>
      <input
        type="text"
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        disabled={disabled}
      />

      <label>卡片（每行一个）</label>
      <textarea
        value={cards}
        onChange={(e) => setCards(e.target.value)}
        disabled={disabled}
        rows={3}
      />

      <button disabled={disabled} onClick={handleSave}>
        保存画面文字
      </button>
    </div>
  );
}
