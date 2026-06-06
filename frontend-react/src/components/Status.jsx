export function Status({ status }) {
  if (!status?.message) return null;
  return <div className={`status ${status.type || 'info'}`}>{status.message}</div>;
}
