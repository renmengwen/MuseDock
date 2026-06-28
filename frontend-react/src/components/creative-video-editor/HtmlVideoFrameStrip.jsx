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
    <div className="grid auto-cols-[minmax(120px,152px)] grid-flow-col gap-2 overflow-x-auto px-0.5 pb-1 pt-1.5" aria-label="镜头预览列表">
      {frames.map((frame, index) => {
        const frameId = frame?.id || frame?.scene_id || String(index);
        const selected = String(frameId) === String(selectedFrameId);
        const duration = frameDuration(frame);

        return (
          <button
            key={frameId}
            type="button"
            className={`grid min-w-0 gap-1 rounded-md border p-1.5 text-left transition hover:border-[#25f4ee]/70 disabled:cursor-not-allowed disabled:opacity-60 ${selected ? 'border-[#25f4ee] bg-slate-800 shadow-[0_0_0_2px_rgba(37,244,238,.16)]' : 'border-slate-700 bg-slate-800/70'}`}
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onSelect?.(frameId)}
          >
            <span className="grid h-9 place-items-center rounded-md bg-slate-950 text-xs font-bold text-slate-300">
              <span>{String(index + 1).padStart(2, '0')}</span>
            </span>
            <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-100">{frameTitle(frame, index)}</strong>
            <small className="text-xs text-slate-400">{duration ? `${duration.toFixed(1)}s` : '未设置时长'}</small>
          </button>
        );
      })}
    </div>
  );
}
