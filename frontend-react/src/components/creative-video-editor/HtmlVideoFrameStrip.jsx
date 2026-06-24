function frameTitle(frame, index) {
  return frame?.title
    || frame?.metadata?.visual_text?.headline
    || frame?.inputs?.headline
    || frame?.inputs?.title
    || frame?.label
    || frame?.id
    || `镜头 ${index + 1}`;
}

function frameDuration(frame) {
  const duration = Number(frame?.duration_sec ?? frame?.durationSec ?? frame?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

export function HtmlVideoFrameStrip({ frames = [], selectedFrameId = '', disabled = false, onSelect }) {
  return (
    <div className="html-video-canvas-frame-strip" aria-label="镜头预览列表">
      {frames.map((frame, index) => {
        const frameId = frame?.id || frame?.scene_id || String(index);
        const selected = String(frameId) === String(selectedFrameId);
        const duration = frameDuration(frame);

        return (
          <button
            key={frameId}
            type="button"
            className={selected ? 'active' : ''}
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onSelect?.(frameId)}
          >
            <span className="html-video-canvas-frame-thumb">
              <span>{String(index + 1).padStart(2, '0')}</span>
            </span>
            <strong>{frameTitle(frame, index)}</strong>
            <small>{duration ? `${duration.toFixed(1)}s` : '未设置时长'}</small>
          </button>
        );
      })}
    </div>
  );
}
