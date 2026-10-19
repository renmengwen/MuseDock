import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Loader2, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { cn } from '@/lib/utils.js';
import { dragRegion, resizedPolygon, reorderRegions } from './annotationGeometry.mjs';
import { WhiteboardFitFrame } from './WhiteboardFitFrame.jsx';

const COLORS = ['#e34d36', '#008baa', '#82752e', '#874cc0', '#168253', '#bc467e'];
const HANDLES = { tl: [0, 0], t: [0.5, 0], tr: [1, 0], r: [1, 0.5], br: [1, 1], b: [0.5, 1], bl: [0, 1], l: [0, 0.5] };
const CURSORS = { tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize' };

export function WhiteboardAnnotationEditor({ scene, annotationUrl, imageUrl, disabled, onSave, onDirtyChange, onSavingChange }) {
  const [source, setSource] = useState(null);
  const [elements, setElements] = useState([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [imageReady, setImageReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [screenScale, setScreenScale] = useState(1);
  const svg = useRef(null);
  const drag = useRef(null);
  const draggedRow = useRef(null);
  const saveLock = useRef(false);
  const reloadAfterSave = useRef(false);
  const baseIdentity = useRef('');
  const dirtyRef = useRef(false);
  const dirty = Boolean(source) && JSON.stringify(elements) !== JSON.stringify(source.elements.map(({ id, region }) => ({ id, region })));
  dirtyRef.current = dirty;
  const locked = disabled || saving || loading || !imageReady;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (dirtyRef.current && !reloadAfterSave.current) {
      setError('已保存的编排版本发生变化，本次修改已保留。请关闭并重新打开详情，再基于最新编排调整。');
      return;
    }
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(annotationUrl, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }).then(async response => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || '区域数据读取失败，请重新加载。');
      }
      const data = await response.json();
      if (!Array.isArray(data.elements) || !data.elements.length || !data.canvas?.width || !data.canvas?.height) throw new Error('区域数据不完整，无法编辑。');
      if (controller.signal.aborted) return;
      baseIdentity.current = scene.identity;
      reloadAfterSave.current = false;
      setSource(data); setElements(data.elements.map(({ id, region }) => ({ id, region })));
      setSelected(data.elements[0].id);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.message === 'Failed to fetch' ? '无法连接服务，请确认 MuseDock 正在运行后重新加载。' : failure.name === 'TimeoutError' ? '读取区域数据超时，请重新加载。' : failure.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [annotationUrl, reload]);
  useEffect(() => { setImageReady(false); }, [imageUrl]);
  useEffect(() => {
    if (!svg.current || !source) return;
    const observer = new ResizeObserver(() => {
      const width = svg.current?.getBoundingClientRect().width;
      if (width) setScreenScale(source.canvas.width / width);
    });
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, [source]);

  function point(event) {
    const bounds = svg.current.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * source.canvas.width / bounds.width,
      y: (event.clientY - bounds.top) * source.canvas.height / bounds.height };
  }
  function start(event, element, handle = 'move') {
    if (locked || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    setSelected(element.id); setNotice('');
    drag.current = { id: element.id, point: point(event), region: { ...element.region }, handle };
    svg.current.setPointerCapture(event.pointerId);
  }
  function move(event) {
    if (!drag.current || locked) return;
    const position = point(event); const initial = drag.current;
    const region = dragRegion(initial.region, initial.handle, position.x - initial.point.x, position.y - initial.point.y, source.canvas);
    setElements(current => current.map(element => element.id === initial.id ? { ...element, region } : element));
  }
  function reorder(from, to) {
    if (locked || from === to || from < 0 || to < 0 || to >= elements.length) return;
    setElements(current => reorderRegions(current, from, to)); setNotice('');
  }
  async function save() {
    if (saveLock.current || locked || !dirty) return;
    saveLock.current = true; reloadAfterSave.current = true; setSaving(true); onSavingChange(true); setError(''); setNotice('');
    try {
      await onSave(scene.sceneId, { expectedAnnotationIdentity: baseIdentity.current, elements });
      setNotice('已保存编排并更新预览。请检查覆盖率，确认后继续制作视频。');
    } catch (failure) {
      reloadAfterSave.current = false;
      setError(failure?.data?.message || failure?.message || '保存失败，请检查服务连接后重试。');
    } finally { saveLock.current = false; setSaving(false); onSavingChange(false); }
  }
  const active = elements.find(element => element.id === selected);
  const selectedIndex = elements.findIndex(element => element.id === selected);
  const original = id => source.elements.find(element => element.id === id);
  const activeOriginal = source && active && original(active.id);
  const ordered = [...elements.filter(element => element.id !== selected), ...elements.filter(element => element.id === selected)];
  return <section className="grid gap-3" aria-label="落墨区域编辑器">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="m-0 text-xs leading-6 text-fg-3">拖动区域框移动，拖动边缘控制点缩放；拖动下方列表调整落墨顺序。图片内容不移动。</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={locked || !dirty} onClick={() => { setElements(source.elements.map(({ id, region }) => ({ id, region }))); setNotice('已还原为上次保存的编排。'); setError(''); }}><RotateCcw size={14} />重置修改</Button>
        <Button size="sm" disabled={locked || !dirty} onClick={save}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{saving ? '正在保存并更新预览...' : '保存编排'}</Button>
      </div>
    </div>
    {loading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />正在加载落墨区域...</p> : null}
    {error ? <div role="alert" className="text-sm text-danger">{error}{!source ? <Button variant="outline" size="sm" className="ml-2" onClick={() => setReload(value => value + 1)}>重新加载</Button> : null}</div> : null}
    {source ? <>
      <WhiteboardFitFrame canvas={source.canvas}>
        <img src={imageUrl} alt="用于调整落墨区域的原始线稿" className="block h-full w-full object-contain" draggable={false}
          style={{ aspectRatio: `${source.canvas.width}/${source.canvas.height}` }}
          onLoad={() => setImageReady(true)} onError={() => { setImageReady(false); setError('线稿图片加载失败，请关闭详情后重试。'); }} />
        {!imageReady && !error ? <p role="status" className="absolute left-3 top-3 text-sm">正在加载原始线稿...</p> : null}
        <svg ref={svg} className="absolute inset-0 h-full w-full touch-none select-none" viewBox={`0 0 ${source.canvas.width} ${source.canvas.height}`}
          aria-label="拖动区域框调整落墨范围" onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
          {ordered.map(element => {
            const index = elements.findIndex(item => item.id === element.id); const color = COLORS[index % COLORS.length];
            const region = element.region; const current = element.id === selected; const shape = resizedPolygon(original(element.id), region);
            return <g key={element.id}>
              <rect {...region} fill={current ? `${color}18` : 'transparent'} stroke={color} strokeWidth={current ? 3 : 2} vectorEffect="non-scaling-stroke"
                style={{ cursor: locked ? 'default' : 'move' }} onPointerDown={event => start(event, element)} />
              {shape ? <polygon points={shape.map(p => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
              <text x={region.x + 6 * screenScale} y={region.y + Math.min(18 * screenScale, region.height)} fontSize={12 * screenScale} fill={color} stroke="white" strokeWidth={3} paintOrder="stroke" pointerEvents="none">{index + 1}. {original(element.id).label}</text>
              {current && !locked ? Object.entries(HANDLES).map(([handle, [x, y]]) => <rect key={handle} x={region.x + region.width * x - 6 * screenScale} y={region.y + region.height * y - 6 * screenScale}
                width={12 * screenScale} height={12 * screenScale} fill="white" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: CURSORS[handle] }} onPointerDown={event => start(event, element, handle)} />) : null}
            </g>;
          })}
          {activeOriginal?.reveal.protectedRegions?.map((region, index) => <rect key={index} {...region} fill="#64748b33" stroke="#64748b" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
        </svg>
      </WhiteboardFitFrame>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.65fr)]">
        <ol className="m-0 grid list-none gap-1 p-0" aria-label="落墨顺序">
          {elements.map((element, index) => <li key={element.id}
            className={cn('flex items-center gap-1 rounded-md border border-line-1 px-2 py-1', selected === element.id && 'bg-surface-2')}>
            <Button variant="ghost" size="icon" className="shrink-0 touch-none cursor-grab active:cursor-grabbing" disabled={locked} aria-label={`拖动调整区域 ${index + 1}`}
              onPointerDown={event => {
                if (locked || event.button !== 0) return;
                event.preventDefault(); draggedRow.current = index; event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerUp={event => {
                const from = draggedRow.current; draggedRow.current = null;
                if (from === null) return;
                const rows = [...event.currentTarget.closest('ol').children];
                const to = rows.findIndex(row => { const rect = row.getBoundingClientRect(); return event.clientY >= rect.top && event.clientY <= rect.bottom; });
                if (to >= 0) reorder(from, to);
              }} onPointerCancel={() => { draggedRow.current = null; }} onLostPointerCapture={() => { draggedRow.current = null; }}>
              <GripVertical size={14} />
            </Button>
            <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start whitespace-normal text-left text-xs" disabled={locked} onClick={() => setSelected(element.id)}>{index + 1}. {original(element.id).label}</Button>
            <Button variant="ghost" size="icon" disabled={locked || index === 0} aria-label={`上移区域 ${index + 1}`} onClick={() => reorder(index, index - 1)}><ArrowUp size={14} /></Button>
            <Button variant="ghost" size="icon" disabled={locked || index === elements.length - 1} aria-label={`下移区域 ${index + 1}`} onClick={() => reorder(index, index + 1)}><ArrowDown size={14} /></Button>
          </li>)}
        </ol>
        {active ? <div className="grid content-start gap-2 rounded-md border border-line-1 p-3">
          <strong className="text-xs">区域 {selectedIndex + 1} · 精确调整（像素）</strong>
          <div className="grid grid-cols-2 gap-2">{[['x', '横坐标'], ['y', '纵坐标'], ['width', '宽度'], ['height', '高度']].map(([key, label]) => <label key={key} className="grid gap-1 text-xs text-fg-3">{label}<Input type="number" step={1} min={key === 'x' || key === 'y' ? 0 : 1} value={active.region[key]} disabled={locked}
            onChange={event => {
              const value = Number(event.target.value); if (!Number.isInteger(value)) return;
              const region = { ...active.region, [key]: value };
              region.width = Math.max(1, Math.min(source.canvas.width, region.width)); region.height = Math.max(1, Math.min(source.canvas.height, region.height));
              region.x = Math.max(0, Math.min(source.canvas.width - region.width, region.x)); region.y = Math.max(0, Math.min(source.canvas.height - region.height, region.y));
              setElements(current => current.map(e => e.id === active.id ? { ...e, region } : e)); setNotice('');
            }} /></label>)}</div>
          <p className="m-0 text-xs leading-6 text-fg-3">虚线为多边形边界，灰色区域为保留的保护区。保存后按新顺序分配落墨时间，末尾保留半秒。</p>
        </div> : null}
      </div>
      <p role="status" className="m-0 text-xs leading-6 text-fg-3">{saving ? '正在本地校验区域、计算覆盖率并保存预览...' : notice || (dirty ? '有未保存的修改。保存后请检查更新的预览，再继续渲染视频。' : '当前显示已保存的编排。')}</p>
    </> : null}
  </section>;
}
