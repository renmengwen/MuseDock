export function FrameList({ frames = [], selectedFrameId, disabled, onSelect }) {
  return (
    <aside className="creative-video-editor-frame-list" aria-label="帧列表">
      <h3>帧</h3>
      {frames.length ? frames.map((frame, index) => (
        <button
          type="button"
          key={frame.id}
          className={frame.id === selectedFrameId ? 'active' : ''}
          disabled={disabled}
          onClick={() => onSelect(frame.id)}
        >
          <span>帧 {index + 1}</span>
          <strong>{frame.template || frame.id}</strong>
        </button>
      )) : <p>暂无帧</p>}
    </aside>
  );
}
