import { FileVideo, FolderOpen, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { resolveLocalFileUrl } from '@/api/client.js';
import { useLocalFileActions } from '@/hooks/useLocalFileActions.js';
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

export function ExportsPanel({
  exportsList = [],
  disabled,
  exporting,
  onExport,
  onRefresh,
  getExportPlaybackUrl: resolveExportPlaybackUrl,
}) {
  const fileActions = useLocalFileActions();
  return (
    <EditorPanel>
      <EditorPanelHeader>
        <h3>导出记录</h3>
        <EditorInlineActions>
          <Button variant="outline" size="sm" disabled={disabled || fileActions.opening} onClick={onRefresh}>刷新</Button>
          <Button variant="outline" size="sm" disabled={disabled || fileActions.opening} onClick={() => onExport({})}>
            {exporting ? '正在导出成片...' : '导出成片'}
          </Button>
        </EditorInlineActions>
      </EditorPanelHeader>
      {exportsList.length ? exportsList.map((item, index) => {
        const playbackUrl = getExportPlaybackUrl(item, resolveExportPlaybackUrl);
        const fileUrl = resolveLocalFileUrl(playbackUrl);
        return (
          <div className="grid gap-2 border-t border-[#e5e7eb] pt-2 text-xs text-[#4b5563] [&_strong]:break-all [&_strong]:text-[#111827]" key={item.id || item.path || index}>
            <div className="grid min-w-0 gap-[3px]">
              <strong>{getExportLabel(item, index)}</strong>
              <span>{formatExportTime(item.created_at) || item.status || '已生成'}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={disabled || fileActions.opening || !fileUrl}
                title={fileUrl ? '用系统默认程序打开导出成片' : '暂无可打开的本地文件'}
                aria-label={`打开本地视频：${getExportLabel(item, index)}`}
                onClick={() => void fileActions.openFile(fileUrl, '导出成片')}><FileVideo size={14} />打开本地视频</Button>
              <Button variant="outline" size="sm" disabled={disabled || fileActions.opening || !fileUrl}
                aria-label={`打开所在文件夹：${getExportLabel(item, index)}`}
                onClick={() => void fileActions.openFile(fileUrl, '导出成片', 'folder')}><FolderOpen size={14} />打开所在文件夹</Button>
            </div>
          </div>
        );
      }) : <p>暂无导出记录</p>}
      {fileActions.message && <p role={fileActions.error ? 'alert' : 'status'} className={`m-0 flex items-center gap-2 text-xs ${fileActions.error ? 'text-danger' : 'text-fg-3'}`}>
        {fileActions.opening && <LoaderCircle size={14} className="animate-spin" />}{fileActions.message}
      </p>}
    </EditorPanel>
  );
}
