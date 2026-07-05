import { useState } from 'react';

export function NaturalLanguageEditBox({ disabled, editing, onSubmit, tone = 'dark' }) {
  const [instruction, setInstruction] = useState('');
  const [localMessage, setLocalMessage] = useState('');
  const light = tone === 'light';

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
    <form className={`grid gap-2 rounded-lg border p-2 min-[900px]:grid-cols-[auto_minmax(0,1fr)_auto] min-[900px]:items-center ${light ? 'border-[#e5e7eb] bg-[#fbfdff] text-[#111827]' : 'border-slate-700 bg-slate-800 text-slate-100'}`} onSubmit={submitEdit}>
      <h3 className="m-0 text-sm font-bold">自然语言编辑</h3>
      <textarea
        value={instruction}
        disabled={disabled}
        rows={1}
        className={`min-h-9 w-full resize-none rounded-md border px-2.5 py-2 text-sm leading-tight outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/20 disabled:cursor-not-allowed disabled:opacity-60 ${light ? 'border-[#d1d5db] bg-white text-[#111827] placeholder:text-[#69717e]' : 'border-slate-700 bg-slate-950/35 text-slate-100 placeholder:text-slate-500'}`}
        placeholder="例如：把前三帧的标题改得更有冲击力"
        onChange={event => setInstruction(event.target.value)}
      />
      <button
        className={`min-h-9 rounded-md border px-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-55 ${light ? 'border-[#111827] bg-[#111827] text-white hover:bg-[#1f2937]' : 'border-slate-100 bg-slate-100 text-slate-950 hover:border-white hover:bg-white'}`}
        type="submit"
        disabled={disabled || !instruction.trim()}
      >
        {editing ? '正在解析编辑意图...' : '应用编辑'}
      </button>
      {localMessage ? <p className={`m-0 text-xs min-[900px]:col-start-2 ${light ? 'text-[#4b5563]' : 'text-slate-300'}`} aria-live="polite">{localMessage}</p> : null}
    </form>
  );
}
