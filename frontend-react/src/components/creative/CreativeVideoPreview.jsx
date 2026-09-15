import { FileVideo, FolderOpen, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { resolveLocalFileUrl } from '@/api/client.js';
import { useLocalFileActions } from '@/hooks/useLocalFileActions.js';

export function CreativeVideoPreview({ videoUrl, posterUrl, width, height, showFileActions = true }) {
  const portrait = width > 0 && height > width;
  const fileActions = useLocalFileActions();
  const fileUrl = resolveLocalFileUrl(videoUrl);
  return (
    <section className="overflow-hidden rounded-lg border border-[#e7e9ee] bg-white shadow-[0_12px_32px_rgba(15,23,42,.08)]" style={portrait ? { width: '100%', maxWidth: `${60 * width / height}dvh`, marginInline: 'auto' } : undefined} aria-label="生成视频预览">
      <video className="h-full w-full max-h-[calc(100vh-340px)] object-contain bg-[#05070a]" style={portrait ? { maxHeight: '60dvh', aspectRatio: `${width} / ${height}` } : undefined} src={videoUrl} poster={posterUrl || undefined} controls controlsList="nodownload" playsInline preload="metadata">
        当前浏览器不支持直接播放视频。
      </video>
      {showFileActions && fileUrl ? <div className="grid gap-2 border-t border-line-1 p-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={fileActions.opening} onClick={() => void fileActions.openFile(fileUrl, '本地视频')}><FileVideo />打开本地视频</Button>
          <Button variant="outline" size="sm" disabled={fileActions.opening} onClick={() => void fileActions.openFile(fileUrl, '本地视频', 'folder')}><FolderOpen />打开所在文件夹</Button>
        </div>
        {fileActions.message && <p role={fileActions.error ? 'alert' : 'status'} className={`m-0 flex items-center gap-2 text-xs ${fileActions.error ? 'text-danger' : 'text-fg-3'}`}>
          {fileActions.opening && <LoaderCircle size={14} className="animate-spin" />}{fileActions.message}
        </p>}
      </div> : null}
    </section>
  );
}
