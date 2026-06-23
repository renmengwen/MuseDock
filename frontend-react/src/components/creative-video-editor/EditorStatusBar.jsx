export function EditorStatusBar({ status, message, dirtyRequiresRender }) {
  const text = message || (dirtyRequiresRender ? '内容已修改，需要重新渲染后才会更新成片。' : '可编辑工程已就绪。');
  return (
    <div className={`creative-video-editor-status ${status || 'idle'}`} role="status" aria-live="polite">
      <span>{text}</span>
    </div>
  );
}
