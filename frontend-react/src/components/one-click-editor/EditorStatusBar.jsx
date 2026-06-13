export function EditorStatusBar({ status, message }) {
  if (!message) return null;

  const statusText = {
    loading: '正在加载...',
    saving: '正在保存...',
    rewriting: '正在重写本场景...',
    tts: '正在重新配音本场景...',
    rerendering: '正在重新渲染成片...',
    ready: '就绪',
    error: '错误',
  };

  return (
    <div className={`one-click-editor-status ${status}`} role="status" aria-live="polite">
      <span>{statusText[status] || status}: </span>
      <span>{message}</span>
    </div>
  );
}
