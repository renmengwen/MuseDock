export function Status({ status }) {
  if (!status?.message) return null;
  const typeClass = {
    loading: 'border-blue-100 bg-blue-50 text-blue-700',
    success: 'border-green-100 bg-green-50 text-green-700',
    error: 'border-red-100 bg-red-50 text-red-700',
    info: 'border-amber-100 bg-amber-50 text-amber-700',
  }[status.type || 'info'];
  return <div className={`mb-4 rounded-lg border px-4 py-3 text-[13px] font-semibold ${typeClass}`}>{status.message}</div>;
}
