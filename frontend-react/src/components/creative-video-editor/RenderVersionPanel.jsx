export function RenderVersionPanel({ versions = [] }) {
  return (
    <section className="creative-video-editor-render-versions">
      <h3>渲染版本</h3>
      {versions.length ? versions.map(version => (
        <div key={version.id || version.output_path}>
          <strong>{version.id || '未命名版本'}</strong>
          <span>{version.status || '未知状态'}</span>
        </div>
      )) : <p>暂无渲染版本</p>}
    </section>
  );
}
