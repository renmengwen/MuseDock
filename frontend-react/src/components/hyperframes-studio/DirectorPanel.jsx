export function DirectorPanel({ freeform }) {
  const brief = freeform?.brief?.data;

  return (
    <section className="agentPanel">
      <h3>导演策划</h3>
      {!brief ? (
        <p className="empty small">暂无导演策划，请先生成导演策划。</p>
      ) : (
        <pre className="jsonViewer">{JSON.stringify(brief, null, 2)}</pre>
      )}
    </section>
  );
}
