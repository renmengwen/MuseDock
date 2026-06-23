function getFrameTitle(frame, index) {
  return frame?.title
    || frame?.metadata?.visual_text?.headline
    || frame?.inputs?.headline
    || frame?.inputs?.title
    || frame?.name
    || frame?.template_id
    || frame?.template
    || `第 ${index + 1} 帧`;
}

function getFrameDuration(frame) {
  const duration = Number(frame?.duration_sec ?? frame?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return '';
  return Number.isInteger(duration) ? String(duration) : duration.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function ProjectFramesList({ frames = [], selectedFrameId, disabled, onSelect }) {
  return (
    <aside className="creative-video-editor-frame-list html-video-project-frames">
      <h3>帧列表</h3>
      {frames.length ? frames.map((frame, index) => (
        <button
          type="button"
          key={frame.id || index}
          className={String(frame.id) === String(selectedFrameId) ? 'active' : ''}
          disabled={disabled}
          onClick={() => onSelect(frame.id)}
        >
          <strong>{getFrameTitle(frame, index)}</strong>
          <span>{getFrameDuration(frame) ? `${getFrameDuration(frame)}s` : '未设置时长'}</span>
          {frame.active_draft_id ? <span className="creative-video-editor-frame-status">有草稿</span> : null}
        </button>
      )) : <p>暂无帧数据</p>}
    </aside>
  );
}
