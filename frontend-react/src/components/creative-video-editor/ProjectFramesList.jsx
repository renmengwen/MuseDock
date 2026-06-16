function getFrameTitle(frame, index) {
  return frame?.title || frame?.name || frame?.template_id || frame?.template || `第 ${index + 1} 帧`;
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
          <span>{frame.duration ? `${frame.duration}s` : '未设置时长'}</span>
        </button>
      )) : <p>暂无帧数据</p>}
    </aside>
  );
}
