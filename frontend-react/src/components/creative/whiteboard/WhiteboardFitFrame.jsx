import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils.js';

// 按详情滚动区的首屏剩余高度限制画布宽度，图片与编辑覆盖层共用同一比例。
export function WhiteboardFitFrame({ canvas, children, className }) {
  const frame = useRef(null);
  const [maxWidth, setMaxWidth] = useState(null);
  useLayoutEffect(() => {
    const element = frame.current;
    const viewport = element.closest('[data-scene-viewport]');
    if (!viewport) return;
    const measure = () => {
      const top = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
      const padding = parseFloat(getComputedStyle(viewport).paddingBottom) || 0;
      const available = Math.max(1, viewport.clientHeight - top - padding - 2);
      setMaxWidth(Math.floor(available * canvas.width / canvas.height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [canvas.width, canvas.height]);
  return <div ref={frame} data-fit-canvas className={cn('relative mx-auto w-full overflow-hidden rounded-md border border-line-1 bg-page', className)}
    style={{ aspectRatio: `${canvas.width} / ${canvas.height}`, maxWidth: maxWidth === null ? '100%' : `${maxWidth}px` }}>
    {children}
  </div>;
}
