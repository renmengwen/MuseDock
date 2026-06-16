import { useState } from 'react';

export function NaturalLanguageEditBox({ disabled, editing, onSubmit }) {
  const [instruction, setInstruction] = useState('');
  const [localMessage, setLocalMessage] = useState('');

  async function submitEdit(event) {
    event.preventDefault();
    const trimmed = instruction.trim();
    if (!trimmed || disabled) return;
    setLocalMessage('正在解析编辑意图...');
    const result = await onSubmit(trimmed);
    if (result) {
      setLocalMessage(result.message || '编辑已应用，需要重新渲染。');
      setInstruction('');
    } else {
      setLocalMessage('编辑失败，请查看上方状态。');
    }
  }

  return (
    <form className="creative-video-editor-panel html-video-natural-edit" onSubmit={submitEdit}>
      <div className="creative-video-editor-panel-header">
        <h3>自然语言编辑</h3>
        <button type="submit" disabled={disabled || !instruction.trim()}>
          {editing ? '正在解析编辑意图...' : '应用编辑'}
        </button>
      </div>
      <textarea
        value={instruction}
        disabled={disabled}
        rows={3}
        placeholder="例如：把前三帧的标题改得更有冲击力"
        onChange={event => setInstruction(event.target.value)}
      />
      {localMessage ? <p aria-live="polite">{localMessage}</p> : null}
    </form>
  );
}
