import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.jsx';

function CoverageImage({ file, src, label, canvas, onImageState }) {
  const [status, setStatus] = useState('loading');
  const update = next => {
    setStatus(next);
    onImageState?.(file.id, next === 'ready');
  };
  return <figure className="m-0 grid min-w-0 content-start gap-2">
    <figcaption className="text-xs font-semibold leading-6 text-fg-2">{label}</figcaption>
    <div className="relative mx-auto w-full overflow-hidden rounded-md border border-line-1 bg-page"
      style={{ aspectRatio: `${canvas.width} / ${canvas.height}`,
        ...(canvas.height > canvas.width ? { maxWidth: `${55 * canvas.width / canvas.height}dvh` } : {}) }}>
      {src ? <img src={src} alt={label} onLoad={() => update('ready')} onError={() => update('failed')}
        className={status === 'failed' ? 'hidden' : 'block h-full w-full object-contain'} /> : null}
      {src && status === 'loading' ? <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 bg-page p-4 text-xs text-fg-3"><Loader2 size={15} className="shrink-0 animate-spin" />正在加载{label}...</div> : null}
      {!src || status === 'failed' ? <div role="alert" className="absolute inset-0 flex items-center justify-center bg-page p-4 text-center text-xs leading-6 text-danger">图片读取失败，请关闭预览后重试；文件缺失时需重新编排本幕。</div> : null}
    </div>
  </figure>;
}

export function WhiteboardCoverageImages({ scene, canvas, getUrl, onImageState }) {
  return <div className="grid min-w-0 gap-4 sm:grid-cols-2">
    <CoverageImage key={scene.resultPreview?.id || 'result'} file={scene.resultPreview} src={getUrl(scene.resultPreview)}
      label="当前落墨最终效果" canvas={canvas} onImageState={onImageState} />
    <CoverageImage key={scene.preview?.id || 'annotation'} file={scene.preview} src={getUrl(scene.preview)}
      label="原图标注与遗漏（红色墨迹）" canvas={canvas} onImageState={onImageState} />
  </div>;
}

export function WhiteboardCoverageReview({ review, scenes = [], current, busy, error, onClose, onAccept, onRetry }) {
  const [loaded, setLoaded] = useState({});
  const files = new Map(review.artifacts.map(file => [file.id, file]));
  const getUrl = file => files.get(file?.id)?.url || '';
  const canvas = { width: review.recipe.width, height: review.recipe.height };
  const order = new Map(scenes.map((scene, index) => [scene.id, index]));
  const entries = [...review.lowCoverage].sort((a, b) => (order.get(a.sceneId) ?? Infinity) - (order.get(b.sceneId) ?? Infinity));
  const previews = entries.flatMap(entry => [entry.resultPreview, entry.preview]);
  const ready = entries.length > 0 && previews.every(file => getUrl(file) && loaded[file.id]);
  const onImageState = (id, value) => setLoaded(previous => ({ ...previous, [id]: value }));
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="flex max-h-[90dvh] w-[min(1100px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[1100px]" showCloseButton={!busy}>
      <DialogHeader className="shrink-0 border-b border-line-1 p-5 pr-12 text-left">
        <DialogTitle>检查 {entries.length} 幕低覆盖率落墨</DialogTitle>
        <DialogDescription>请对照下面的最终效果与原图标注。接受后使用当前已标注内容继续制作，遗漏部分保持空白，不会在片尾突然补显；也可以重新编排未通过的幕。</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 gap-6 overflow-y-auto overscroll-contain p-5 max-[560px]:p-3">
        {entries.map(entry => <section key={entry.identity || entry.attemptId} className="grid gap-3" aria-label={`${entry.title}覆盖情况`}>
          <h3 className="m-0 text-sm font-semibold">第 {(order.get(entry.sceneId) ?? 0) + 1} 幕 · {entry.title}</h3>
          <p className="m-0 text-xs leading-6 text-danger">{entry.coverage.regions} 个区域 · 已覆盖 {(entry.coverage.coverageRatio * 100).toFixed(1)}% · 未覆盖 {((1 - entry.coverage.coverageRatio) * 100).toFixed(1)}%</p>
          <WhiteboardCoverageImages scene={entry} canvas={canvas} getUrl={getUrl} onImageState={onImageState} />
        </section>)}
      </div>
      <DialogFooter className="shrink-0 flex-wrap gap-2 border-t border-line-1 p-4">
        {!current ? <p role="alert" className="m-0 w-full text-sm text-danger">预览对应的版本已变化，请关闭后重新查看当前产物。</p> : null}
        {error ? <p role="alert" className="m-0 w-full text-sm text-danger">{error}</p> : null}
        {busy ? <p role="status" className="m-0 flex w-full items-center gap-2 text-sm text-fg-2"><Loader2 size={15} className="animate-spin" />{busy === 'accept_low_coverage' ? '正在登记接受决定并继续制作...' : '正在重新编排未通过的幕...'}</p> : null}
        <Button variant="ghost" disabled={Boolean(busy)} onClick={onClose}>暂不决定</Button>
        <Button variant="outline" disabled={Boolean(busy) || !current} onClick={onRetry}>重新编排未通过的幕</Button>
        <Button disabled={Boolean(busy) || !current || !ready} onClick={onAccept}>接受这 {entries.length} 幕当前落墨并继续</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
