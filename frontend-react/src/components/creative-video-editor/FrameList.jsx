export function FrameList({ frames = [], selectedFrameId, disabled, onSelect }) {
  return (
    <aside className="grid min-w-0 gap-2 [&_h3]:m-0 [&_h3]:text-sm [&_button]:grid [&_button]:w-full [&_button]:cursor-pointer [&_button]:gap-[3px] [&_button]:rounded-md [&_button]:border [&_button]:border-[#d8dee8] [&_button]:bg-[#f8fafc] [&_button]:p-2 [&_button]:text-left [&_button]:text-[#233044] [&_button.active]:border-[#2563eb] [&_button.active]:bg-[#eff6ff] [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-[.55]" aria-label="帧列表">
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
