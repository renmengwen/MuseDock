import { ConfirmDialog } from '@/components/ui/confirm-dialog.jsx';

function getTargetLabel(target) {
  return target?.label || '数据';
}

function getEstimateText(estimate) {
  if (!estimate) return '';
  if (typeof estimate === 'string') return estimate;
  return estimate.path || estimate.display || '';
}

export function CleanupConfirmDialog({ target, open, loading, estimate, onCancel, onConfirm }) {
  const label = getTargetLabel(target);
  const estimateText = getEstimateText(estimate);

  return (
    <ConfirmDialog
      open={Boolean(open && target)}
      onOpenChange={value => {
        if (!value) onCancel();
      }}
      title={`确认清理${label}`}
      description="此操作不可恢复。"
      destructive
      loading={Boolean(loading)}
      confirmText={loading ? `正在清理${label}...` : `确认清理${label}`}
      onConfirm={onConfirm}
    >
      {estimateText ? <p className="m-0 text-sm text-fg-2">预计影响：{estimateText}</p> : null}
    </ConfirmDialog>
  );
}
