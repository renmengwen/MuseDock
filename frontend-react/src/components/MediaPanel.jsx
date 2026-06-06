function translateStepStatus(status) {
  const map = {
    done: '已完成',
    exists: '已存在',
    available: '可用',
    failed: '失败',
    unavailable: '不可用',
    skipped: '已跳过',
    not_requested: '未请求',
    not_configured: '未配置',
    missing: '缺失',
  };
  return map[status] || status || '缺失';
}

function StepBadge({ step }) {
  const status = step?.status || 'missing';
  return <span className={`stepBadge ${status}`}>{translateStepStatus(status)}</span>;
}

function AssetRow({ label, step, detail }) {
  return (
    <div className="assetRow">
      <div className="assetLabel">{label}</div>
      <StepBadge step={step} />
      <div className="assetDetail">{detail || step?.message || step?.error || step?.path || '-'}</div>
    </div>
  );
}

export function MediaPanel({
  status,
  preparing,
  transcribing,
  onRefresh,
  onPrepare,
  onForcePrepare,
  onTranscribe,
}) {
  if (!status?.aweme_id) {
    return <div className="empty">请选择一个抖音视频后准备素材</div>;
  }

  const metadata = status.metadata || status.analysis_input?.video || {};
  const steps = status.steps || {};
  const frames = status.frames || status.analysis_input?.local_assets?.frames || [];
  const transcript = status.transcript || {};

  return (
    <section className="mediaPanel">
      <div className="mediaHeader">
        <div>
          <h2>{metadata.title || `抖音视频 ${status.aweme_id}`}</h2>
          <p>
            {metadata.author?.nickname ? `${metadata.author.nickname} · ` : ''}
            <a href={metadata.aweme_url || `https://www.douyin.com/video/${status.aweme_id}`} target="_blank" rel="noreferrer">打开原视频</a>
          </p>
        </div>
        <div className="mediaActions">
          <button className="btn secondary" disabled={preparing || transcribing} onClick={onRefresh}>刷新状态</button>
          <button className="btn secondary" disabled={preparing || transcribing} onClick={onPrepare}>
            {preparing ? '准备中...' : '准备素材'}
          </button>
          <button className="btn danger" disabled={preparing || transcribing} onClick={onForcePrepare}>重新生成素材</button>
          <button className="btn primary" disabled={preparing || transcribing} onClick={onTranscribe}>
            {transcribing ? '转写中...' : '请求转写'}
          </button>
        </div>
      </div>

      <div className="assetGrid">
        <AssetRow label="元数据" step={steps.metadata} />
        <AssetRow label="视频下载" step={steps.video} />
        <AssetRow label="音频抽取" step={steps.audio} />
        <AssetRow label="关键帧" step={steps.frames} detail={frames.length ? `${frames.length} 张` : ''} />
        <AssetRow label="转写" step={steps.transcript} detail={transcript.message || ''} />
      </div>

      <div className="pathBlock">
        <div className="assetLabel">本地素材目录</div>
        <code>{status.dir || '-'}</code>
      </div>

      <div className="framesStrip">
        {frames.length === 0 ? <div className="empty small">暂无关键帧</div> : null}
        {frames.slice(0, 12).map(frame => (
          <div className="framePath" key={frame}>{frame}</div>
        ))}
      </div>
    </section>
  );
}
