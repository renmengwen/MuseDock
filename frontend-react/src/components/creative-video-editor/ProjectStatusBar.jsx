const STATUS_CLASS = {
  error: 'error',
  not_configured: 'error',
  needs_validation: 'error',
  loading: 'loading',
  saving: 'saving',
  editing: 'saving',
  materializing: 'saving',
  rendering: 'saving',
  exporting: 'saving',
  tts: 'saving',
};

export function ProjectStatusBar({ status, message, dirtyRequiresRender }) {
  return (
    <div className={`creative-video-editor-status ${STATUS_CLASS[status] || status || ''}`} aria-live="polite">
      <span>{message || '等待加载可编辑成片工程。'}</span>
      {dirtyRequiresRender ? <strong>需要重新导出</strong> : null}
    </div>
  );
}
