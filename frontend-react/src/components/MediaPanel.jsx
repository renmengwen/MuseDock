import { useMemo, useState } from 'react';
import { formatBytes, getDisplayFrames } from '../utils/mediaAssets.js';

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

function AssetRow({ label, step, detail, target, onOpenTarget, openingTarget }) {
  const canOpen = !!target && !!(step?.path || detail);
  const opening = openingTarget === target;
  return (
    <div className="assetRow">
      <div className="assetLabel">{label}</div>
      <StepBadge step={step} />
      <div className="assetDetail">{detail || step?.message || step?.error || step?.path || '-'}</div>
      {target ? (
        <button className="btn tiny secondary" disabled={!canOpen || !!openingTarget} onClick={() => onOpenTarget(target)}>
          {opening ? '正在打开...' : '打开位置'}
        </button>
      ) : null}
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
  onOpenTarget,
  openingTarget,
  onGoToAiWorkspace,
  onGoToHyperframesStudio,
}) {
  const [previewFrame, setPreviewFrame] = useState(null);
  const frames = useMemo(
    () => getDisplayFrames(status || {}),
    [status],
  );

  if (!status?.aweme_id) {
    return <div className="empty">请选择一个抖音视频后准备素材</div>;
  }

  const metadata = status.metadata || status.analysis_input?.video || {};
  const steps = status.steps || {};
  const transcript = status.transcript || {};
  const transcriptText = typeof transcript.text === 'string' ? transcript.text.trim() : '';
  const assets = status.assets || {};

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
        <div className="mediaActions primaryActionGroup">
          <button className="btn secondary" disabled={preparing || transcribing} onClick={onPrepare}>
            {preparing ? '准备中...' : '准备素材'}
          </button>
          <button className="btn primary" disabled={preparing || transcribing} onClick={onTranscribe}>
            {transcribing ? '转写中...' : '请求转写'}
          </button>
          {/* <button className="btn primary" disabled={preparing || transcribing} onClick={onGoToAiWorkspace}>进入 AI 工作台</button> */}
          <button className="btn primary" disabled={preparing || transcribing} onClick={onGoToHyperframesStudio}>打开高级成片</button>
        </div>
      </div>

      <div className="mediaUtilityBar">
        <button className="btn secondary" disabled={preparing || transcribing} onClick={onRefresh}>刷新状态</button>
        <button className="btn secondary" disabled={preparing || transcribing || !!openingTarget} onClick={() => onOpenTarget('dir')}>
          {openingTarget === 'dir' ? '正在打开...' : '打开本地目录'}
        </button>
        <button className="btn danger" disabled={preparing || transcribing} onClick={onForcePrepare}>重新生成素材</button>
      </div>

      <div className="assetGrid">
        <AssetRow label="元数据" step={steps.metadata} detail={assets.metadata ? formatBytes(assets.metadata.bytes) : ''} target="metadata" onOpenTarget={onOpenTarget} openingTarget={openingTarget} />
        <AssetRow label="视频下载" step={steps.video} detail={assets.video ? formatBytes(assets.video.bytes) : ''} target="video" onOpenTarget={onOpenTarget} openingTarget={openingTarget} />
        <AssetRow label="音频抽取" step={steps.audio} detail={assets.audio ? formatBytes(assets.audio.bytes) : ''} target="audio" onOpenTarget={onOpenTarget} openingTarget={openingTarget} />
        <AssetRow label="关键帧" step={steps.frames} detail={frames.length ? `共 ${frames.length} 张` : ''} target="frames" onOpenTarget={onOpenTarget} openingTarget={openingTarget} />
        <AssetRow label="转写" step={steps.transcript} detail={transcript.message || (assets.transcript ? formatBytes(assets.transcript.bytes) : '')} target="transcript" onOpenTarget={onOpenTarget} openingTarget={openingTarget} />
      </div>

      {transcriptText ? (
        <div className="transcriptBlock">
          <div className="transcriptHeader">
            <div className="assetLabel">转写文本</div>
            <span>{transcriptText.length} 字</span>
          </div>
          <pre>{transcriptText}</pre>
        </div>
      ) : null}

      <div className="pathBlock">
        <div className="pathHeader">
          <div className="assetLabel">本地素材目录</div>
          <button className="btn tiny secondary" disabled={!status.dir || !!openingTarget} onClick={() => onOpenTarget('dir')}>
            {openingTarget === 'dir' ? '正在打开...' : '打开资源管理器'}
          </button>
        </div>
        <code>{status.dir || assets.dir?.path || '-'}</code>
      </div>

      <div className="framesStrip">
        <div className="framesHeader">
          <div className="assetLabel">关键帧列表</div>
          <span>共 {frames.length} 张</span>
        </div>
        {frames.length === 0 ? <div className="empty small">暂无关键帧</div> : null}
        {frames.length ? (
          <div className="framesGrid">
            {frames.map(frame => (
              <button className="frameCard" key={frame.path || frame.name} onClick={() => setPreviewFrame(frame)} title={frame.path}>
                <img src={frame.preview_url} alt={frame.name || '关键帧'} loading="lazy" />
                <span className="frameName">{frame.name || '关键帧'}</span>
                <span className="frameMeta">{formatBytes(frame.bytes)}</span>
                <span className="framePath">{frame.path}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {previewFrame ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" onClick={() => setPreviewFrame(null)}>
          <div className="imagePreviewModal" onClick={event => event.stopPropagation()}>
            <div className="previewHeader">
              <div>
                <strong>{previewFrame.name || '关键帧预览'}</strong>
                <span>{formatBytes(previewFrame.bytes)}</span>
              </div>
              <button className="btn tiny secondary" onClick={() => setPreviewFrame(null)}>关闭</button>
            </div>
            <img src={previewFrame.preview_url} alt={previewFrame.name || '关键帧预览'} />
            <code>{previewFrame.path}</code>
          </div>
        </div>
      ) : null}
    </section>
  );
}
