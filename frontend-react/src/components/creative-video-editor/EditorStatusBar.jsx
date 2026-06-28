export function EditorStatusBar({ status, message, dirtyRequiresRender }) {
  const text = message || (dirtyRequiresRender ? '内容已修改，需要重新渲染后才会更新成片。' : '可编辑工程已就绪。');
  const isError = status === 'error' || status === 'not_configured' || status === 'needs_validation';
  return (
    <div
      className={`flex min-h-[38px] items-center rounded-lg border px-3 py-2 text-[13px] ${isError ? 'border-red-500/30 bg-red-500/10 text-red-100' : 'border-blue-400/30 bg-blue-400/10 text-blue-100'}`}
      role="status"
      aria-live="polite"
    >
      <span>{text}</span>
    </div>
  );
}
