import { Play } from 'lucide-react';
import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';

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
    <EditorPanel>
      <EditorPanelHeader>
        <h3>导出记录</h3>
        <EditorInlineActions>
          <button type="button" disabled={disabled} onClick={onRefresh}>刷新</button>
          <button type="button" disabled={disabled} onClick={() => onExport({})}>
            {exporting ? '正在导出成片...' : '导出成片'}
          </button>
        </EditorInlineActions>
      </EditorPanelHeader>
      {exportsList.length ? exportsList.map((item, index) => {
        const playbackUrl = getExportPlaybackUrl(item, resolveExportPlaybackUrl);
        return (
          <div className="flex items-center justify-between gap-2 border-t border-[#e5e7eb] pt-2 text-xs text-[#4b5563] [&_strong]:break-all [&_strong]:text-[#111827]" key={item.id || item.path || index}>
            <div className="grid min-w-0 gap-[3px]">
              <strong>{getExportLabel(item, index)}</strong>
              <span>{formatExportTime(item.created_at) || item.status || '已生成'}</span>
            </div>
            <button
              type="button"
              className="inline-flex flex-none items-center gap-1"
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
    </EditorPanel>
  );
}
