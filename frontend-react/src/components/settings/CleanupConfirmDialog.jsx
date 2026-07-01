function getTargetLabel(target) {
  return target?.label || '数据';
}

function getEstimateText(estimate) {
  if (!estimate) return '';
  if (typeof estimate === 'string') return estimate;
  return estimate.path || estimate.display || '';
}

export function CleanupConfirmDialog({ target, open, loading, estimate, onCancel, onConfirm }) {
  if (!open || !target) return null;

  const label = getTargetLabel(target);
  const estimateText = getEstimateText(estimate);

  return (
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/45 p-4" role="presentation">
      <div className="max-h-[calc(100vh-32px)] w-[min(520px,100%)] overflow-auto rounded-lg bg-white p-5 shadow-[0_12px_36px_rgba(15,17,21,.18)]" role="dialog" aria-modal="true" aria-labelledby="cleanup-confirm-title">
        <h3 className="m-0 text-lg font-bold" id="cleanup-confirm-title">确认清理{label}</h3>
        <p className="mt-2 text-sm text-[#4b5563]">此操作不可恢复。</p>
        {estimateText ? <p className="mt-2 text-sm text-[#4b5563]">预计影响：{estimateText}</p> : null}
        <div className="mt-[18px] flex justify-center gap-2">
          <button className="min-h-9 rounded-lg border border-[#d9dde5] bg-white px-4 text-sm font-semibold text-[#30343b] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={loading} onClick={onCancel}>
            取消
          </button>
          <button className="min-h-9 rounded-lg bg-red-600 px-4 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={loading} onClick={onConfirm}>
            {loading ? `正在清理${label}...` : `确认清理${label}`}
          </button>
        </div>
      </div>
    </div>
  );
}
