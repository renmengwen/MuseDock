import { Loader2 } from 'lucide-react';

export function Status({ status }) {
  if (!status?.message) return null;
  const type = status.type || 'info';
  const typeClass = {
    loading: 'border-line-2 bg-surface-2 text-fg-2',
    success: 'border-green-100 bg-green-50 text-green-700',
    error: 'border-red-100 bg-red-50 text-red-700',
    warning: 'border-amber-100 bg-amber-50 text-amber-700',
    info: 'border-line-2 bg-surface-2 text-fg-2',
  }[type] || 'border-line-2 bg-surface-2 text-fg-2';
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-[13px] font-semibold ${typeClass}`} role="status">
      {type === 'loading' ? <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true" /> : null}
      <span>{status.message}</span>
    </div>
  );
}
