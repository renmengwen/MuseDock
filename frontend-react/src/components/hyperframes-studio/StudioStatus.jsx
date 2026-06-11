export function StudioStatus({ status }) {
  const type = status?.type || 'idle';
  const message = status?.message || '等待选择素材和运行记录。';

  return (
    <div className={`status ${type}`} role={type === 'error' ? 'alert' : 'status'}>
      {message}
    </div>
  );
}
