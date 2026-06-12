export function DirectorPanel({ freeform }) {
  const brief = freeform?.brief?.data;
  const audio = freeform?.audio || {};
  const captions = Array.isArray(audio.captions) ? audio.captions : [];

  return (
    <section className="agentPanel">
      <h3>导演策划</h3>
      {!brief ? (
        <p className="empty small">暂无导演策划，请先生成导演策划。</p>
      ) : (
        <pre className="jsonViewer">{JSON.stringify(brief, null, 2)}</pre>
      )}
      <div className="agentStep">
        <span>音频轨</span>
        <span className={`stepBadge ${audio.status || 'idle'}`}>{audio.status || '未生成'}</span>
        {audio.message ? <small>{audio.message}</small> : null}
      </div>
      {audio.url ? (
        <div className="ttsPlayback">
          <audio controls src={audio.url} />
          <div className="agentRunMeta">
            <span>{audio.voice || '使用导演策划'}</span>
            <span>{audio.duration ? `${audio.duration}s` : '未记录时长'}</span>
            <span>{captions.length ? `${captions.length} 条字幕` : '暂无字幕时间轴'}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
