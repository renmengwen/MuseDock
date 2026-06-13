import { useEffect, useState } from 'react';

export function VisualTextEditor({ visualText = {}, disabled, onChange }) {
  const [headline, setHeadline] = useState(visualText.headline || '');
  const [keywords, setKeywords] = useState((visualText.keywords || []).join('\n'));
  const [cards, setCards] = useState((visualText.cards || []).join('\n'));

  useEffect(() => {
    setHeadline(visualText.headline || '');
    setKeywords((visualText.keywords || []).join('\n'));
    setCards((visualText.cards || []).join('\n'));
  }, [visualText]);

  function emit(next = {}) {
    onChange({
      headline,
      keywords: keywords.split('\n').map(item => item.trim()).filter(Boolean),
      cards: cards.split('\n').map(item => item.trim()).filter(Boolean),
      ...next,
    });
  }

  return (
    <section className="creative-video-editor-section">
      <h4>画面文字</h4>
      <label>
        <span>画面标题</span>
        <input
          value={headline}
          disabled={disabled}
          onChange={event => { setHeadline(event.target.value); emit({ headline: event.target.value }); }}
        />
      </label>
      <label>
        <span>关键词</span>
        <textarea
          value={keywords}
          disabled={disabled}
          rows={3}
          onChange={event => { setKeywords(event.target.value); emit({ keywords: event.target.value.split('\n').map(item => item.trim()).filter(Boolean) }); }}
        />
      </label>
      <label>
        <span>卡片文案</span>
        <textarea
          value={cards}
          disabled={disabled}
          rows={3}
          onChange={event => { setCards(event.target.value); emit({ cards: event.target.value.split('\n').map(item => item.trim()).filter(Boolean) }); }}
        />
      </label>
    </section>
  );
}
