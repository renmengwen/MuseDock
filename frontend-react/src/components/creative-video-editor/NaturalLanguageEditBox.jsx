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
    <form className="grid gap-2 rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-100 min-[900px]:grid-cols-[auto_minmax(0,1fr)_auto] min-[900px]:items-center" onSubmit={submitEdit}>
      <h3 className="m-0 text-sm font-bold">自然语言编辑</h3>
      <textarea
        value={instruction}
        disabled={disabled}
        rows={1}
        className="min-h-9 w-full resize-none rounded-md border border-slate-700 bg-slate-950/35 px-2.5 py-2 text-sm leading-tight text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/20 disabled:cursor-not-allowed disabled:opacity-60"
        placeholder="例如：把前三帧的标题改得更有冲击力"
        onChange={event => setInstruction(event.target.value)}
      />
      <button
        className="min-h-9 rounded-md border border-slate-100 bg-slate-100 px-3 text-xs font-bold text-slate-950 transition hover:border-white hover:bg-white disabled:cursor-not-allowed disabled:opacity-55"
        type="submit"
        disabled={disabled || !instruction.trim()}
      >
        {editing ? '正在解析编辑意图...' : '应用编辑'}
      </button>
      {localMessage ? <p className="m-0 text-xs text-slate-300 min-[900px]:col-start-2" aria-live="polite">{localMessage}</p> : null}
    </form>
  );
}
