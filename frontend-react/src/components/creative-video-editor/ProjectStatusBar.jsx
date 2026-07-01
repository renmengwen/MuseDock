const STATUS_CLASS = {
  error: 'border-red-500/30 bg-red-500/10 text-red-100',
  not_configured: 'border-red-500/30 bg-red-500/10 text-red-100',
  needs_validation: 'border-red-500/30 bg-red-500/10 text-red-100',
  loading: 'border-slate-600 bg-slate-800 text-slate-100',
  saving: 'border-slate-600 bg-slate-800 text-slate-100',
  editing: 'border-slate-600 bg-slate-800 text-slate-100',
  materializing: 'border-slate-600 bg-slate-800 text-slate-100',
  rendering: 'border-slate-600 bg-slate-800 text-slate-100',
  exporting: 'border-slate-600 bg-slate-800 text-slate-100',
  tts: 'border-slate-600 bg-slate-800 text-slate-100',
};

export function ProjectStatusBar({ status, message, dirtyRequiresRender }) {
  return (
    <div className={`flex min-h-8 items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${STATUS_CLASS[status] || 'border-slate-600 bg-slate-800 text-slate-100'}`} aria-live="polite">
      <span>{message || '等待加载可编辑成片工程。'}</span>
      {dirtyRequiresRender ? <strong className="ml-auto shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs text-amber-100">需要重新导出</strong> : null}
    </div>
  );
}
