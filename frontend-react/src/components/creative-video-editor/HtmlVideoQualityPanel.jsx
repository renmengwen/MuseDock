export function HtmlVideoQualityPanel({ frame, layoutQa, disabled, onInspectFrame, onFixFrame }) {
  const frameId = frame?.id || frame?.scene_id || '';
  const issues = Array.isArray(layoutQa?.issues) ? layoutQa.issues : [];

  return (
    <section className="creative-video-editor-panel html-video-quality-panel">
      <div className="creative-video-editor-panel-header">
        <h3>布局检查</h3>
        <div className="creative-video-editor-inline-actions">
          <button type="button" disabled={disabled || !frameId} onClick={() => onInspectFrame({ frame_id: frameId })}>运行布局检查</button>
          <button type="button" disabled={disabled || !frameId} onClick={() => onFixFrame?.(frameId)}>用 AI 修复当前帧</button>
        </div>
      </div>
      {issues.length ? (
        <ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message || issue.code}</li>)}</ul>
      ) : <p>暂无布局检查问题。</p>}
    </section>
  );
}
