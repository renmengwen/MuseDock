import { Play } from 'lucide-react';

function getExportLabel(item, index) {
  return item?.path || item?.url || item?.file || `导出 ${index + 1}`;
}

export function formatExportTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function getExportPlaybackUrl(item, resolver) {
  if (typeof resolver === 'function') return resolver(item);
  return item?.url || item?.output_url || item?.playback_url || '';
}

function openPlaybackUrl(url) {
  if (!url || typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function ExportsPanel({
  exportsList = [],
  disabled,
  exporting,
  onExport,
  onRefresh,
  getExportPlaybackUrl: resolveExportPlaybackUrl,
  onPlay = openPlaybackUrl,
}) {
  return (
    <section className="creative-video-editor-panel html-video-exports">
      <div className="creative-video-editor-panel-header">
        <h3>导出记录</h3>
        <div className="creative-video-editor-inline-actions">
          <button type="button" disabled={disabled} onClick={onRefresh}>刷新</button>
          <button type="button" disabled={disabled} onClick={() => onExport({})}>
            {exporting ? '正在导出成片...' : '导出成片'}
          </button>
        </div>
      </div>
      {exportsList.length ? exportsList.map((item, index) => {
        const playbackUrl = getExportPlaybackUrl(item, resolveExportPlaybackUrl);
        return (
          <div className="creative-video-editor-export-item" key={item.id || item.path || index}>
            <div className="creative-video-editor-export-summary">
              <strong>{getExportLabel(item, index)}</strong>
              <span>{formatExportTime(item.created_at) || item.status || '已生成'}</span>
            </div>
            <button
              type="button"
              className="creative-video-editor-export-play"
              disabled={disabled || !playbackUrl}
              title={playbackUrl ? '播放导出成片' : '暂无可播放文件'}
              aria-label={`播放导出成片：${getExportLabel(item, index)}`}
              onClick={() => onPlay(playbackUrl, item)}
            >
              <Play size={14} aria-hidden="true" />
              播放
            </button>
          </div>
        );
      }) : <p>暂无导出记录</p>}
    </section>
  );
}
