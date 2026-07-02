export function RenderVersionPanel({ versions = [] }) {
  return (
    <section className="grid min-w-0 gap-2 [&_h3]:m-0 [&_h3]:text-sm [&>div]:flex [&>div]:justify-between [&>div]:gap-2 [&>div]:border-t [&>div]:border-[#e5e7eb] [&>div]:pt-2">
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
