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
    <div className="modalBackdrop" role="presentation">
      <div className="modalPanel" role="dialog" aria-modal="true" aria-labelledby="cleanup-confirm-title">
        <h3 id="cleanup-confirm-title">确认清理{label}</h3>
        <p>此操作不可恢复。</p>
        {estimateText ? <p>预计影响：{estimateText}</p> : null}
        <div className="settingsActions" style={{ justifyContent: 'center', marginTop: 18 }}>
          <button className="btn secondary" type="button" disabled={loading} onClick={onCancel}>
            取消
          </button>
          <button className="btn primary" type="button" disabled={loading} onClick={onConfirm}>
            {loading ? `正在清理${label}...` : `确认清理${label}`}
          </button>
        </div>
      </div>
    </div>
  );
}
