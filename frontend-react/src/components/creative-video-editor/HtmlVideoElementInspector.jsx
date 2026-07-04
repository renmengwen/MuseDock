import { BringToFront, Eye, EyeOff, Lock, MoveDown, MoveUp, SendToBack, Trash2, Unlock } from 'lucide-react';

const toolButtonClass = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 text-xs font-bold text-slate-100 transition hover:border-[#25f4ee]/60 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-55';

function NumberField({ label, value, disabled, onChange }) {
  return (
    <label className="grid gap-1 text-[12px] text-slate-400">
      {label}
      <input
        type="number"
        value={Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0}
        disabled={disabled}
        className="h-8 rounded-md border border-slate-700 bg-slate-950/35 px-2 text-[13px] font-semibold text-slate-100 outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/20 disabled:cursor-not-allowed disabled:opacity-60"
        onChange={event => onChange?.(Number(event.target.value))}
      />
    </label>
  );
}

function MiniList({ title, items, selectedId, emptyText, onSelect }) {
  if (!items?.length) return null;
  return (
    <div className="grid gap-1.5">
      <div className="text-xs font-bold text-slate-300">{title}</div>
      <div className="grid max-h-36 gap-1 overflow-auto rounded-md border border-slate-700 bg-slate-950/35 p-1">
        {items.map(item => (
          <button
            key={item.editId}
            type="button"
            className={`min-h-7 truncate rounded px-2 text-left text-xs transition ${item.editId === selectedId ? 'bg-[#25f4ee] text-slate-950' : 'text-slate-200 hover:bg-slate-700'}`}
            onClick={() => onSelect?.(item.editId)}
            title={item.label}
          >
            {item.hidden ? '隐藏 · ' : ''}{item.locked ? '锁定 · ' : ''}{item.label}
          </button>
        ))}
      </div>
      {!items.length ? <p className="m-0 text-xs text-slate-400">{emptyText}</p> : null}
    </div>
  );
}

export function HtmlVideoElementInspector({
  elementInfo,
  candidates,
  layers,
  editingReady,
  disabled,
  saving,
  dirty,
  canUndo,
  onUndo,
  onTextChange,
  onTextEditStart,
  onGeometryChange,
  onResetPosition,
  onSaveEdit,
  onDeleteSelected,
  onSelectCandidate,
  onSelectLayer,
  onToggleLocked,
  onToggleHidden,
  onMoveLayer,
}) {
  const deleted = Boolean(elementInfo?.deleted);
  const locked = Boolean(elementInfo?.locked);
  const hidden = Boolean(elementInfo?.hidden);
  const textEditable = elementInfo?.textEditable !== false;
  const selectedId = elementInfo?.editId || '';

  return (
    <aside className="grid min-w-0 content-start gap-2 rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-100" aria-label="元素属性">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-bold">当前元素</h3>
        <div className="flex items-center gap-2">
          {dirty ? <span className="text-xs font-bold text-amber-300">● 未保存</span> : null}
          {canUndo ? (
            <button
              type="button"
              className="min-h-7 rounded-md border border-slate-600 bg-slate-900 px-2 text-xs font-bold text-slate-100 transition hover:border-[#25f4ee]/60 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={disabled}
              onClick={onUndo}
            >
              撤销
            </button>
          ) : null}
        </div>
      </div>
      {!editingReady ? (
        <p className="m-0 text-sm leading-relaxed text-slate-300">镜头播放完毕后可选择并拖拽元素。</p>
      ) : null}
      {editingReady && !elementInfo ? (
        <p className="m-0 text-sm leading-relaxed text-slate-300">点击画面中的标题、标签或正文元素开始编辑。</p>
      ) : null}
      {editingReady ? (
        <MiniList
          title="当前点击位置"
          items={candidates}
          selectedId={selectedId}
          emptyText="当前点击位置没有可编辑元素。"
          onSelect={onSelectCandidate}
        />
      ) : null}
      {editingReady ? (
        <MiniList
          title="当前帧图层"
          items={layers}
          selectedId={selectedId}
          emptyText="当前帧没有可编辑图层。"
          onSelect={onSelectLayer}
        />
      ) : null}
      {editingReady && elementInfo ? (
        <>
          {deleted ? (
            <p className="m-0 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs leading-relaxed text-red-100">元素已删除，保存后生效。</p>
          ) : null}
          {locked ? (
            <p className="m-0 rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-xs leading-relaxed text-amber-100">该元素已锁定，解锁后可拖动或调整尺寸。</p>
          ) : null}
          <dl className="m-0 grid gap-2">
            <div>
              <dt className="text-xs text-slate-400">标识</dt>
              <dd className="m-0 break-all text-[13px] text-slate-100">{elementInfo.label}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">选择器</dt>
              <dd className="m-0 break-all text-[13px] text-slate-100">{elementInfo.selector}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">位置</dt>
              <dd className="m-0 break-all text-[13px] text-slate-100">
                {Math.round(elementInfo.left)} / {Math.round(elementInfo.top)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">尺寸</dt>
              <dd className="m-0 break-all text-[13px] text-slate-100">
                {Math.round(elementInfo.width)} × {Math.round(elementInfo.height)}
              </dd>
            </div>
          </dl>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="X" value={elementInfo.left} disabled={disabled || deleted || locked} onChange={value => onGeometryChange?.({ left: value })} />
            <NumberField label="Y" value={elementInfo.top} disabled={disabled || deleted || locked} onChange={value => onGeometryChange?.({ top: value })} />
            <NumberField label="宽" value={elementInfo.width} disabled={disabled || deleted || locked} onChange={value => onGeometryChange?.({ width: value })} />
            <NumberField label="高" value={elementInfo.height} disabled={disabled || deleted || locked} onChange={value => onGeometryChange?.({ height: value })} />
          </div>
          <label className="grid gap-1.5 text-[13px] text-slate-300">
            文案
            <textarea
              value={elementInfo.text || ''}
              disabled={disabled || deleted || locked || !textEditable}
              rows={4}
              className="w-full resize-y rounded-md border border-slate-700 bg-slate-950/35 p-2 text-sm text-slate-100 outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/20 disabled:cursor-not-allowed disabled:opacity-60"
              onFocus={() => onTextEditStart?.()}
              onChange={event => onTextChange?.(event.target.value)}
            />
            {!textEditable && !deleted ? (
              <p className="m-0 text-xs leading-relaxed text-slate-400">该元素的文案分布在子元素中，请在图层列表中选中具体文本元素后编辑。</p>
            ) : null}
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <button className={toolButtonClass} type="button" disabled={disabled || saving || deleted} onClick={onToggleLocked}>
              {locked ? <Unlock size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
              {locked ? '解锁' : '锁定'}
            </button>
            <button className={toolButtonClass} type="button" disabled={disabled || saving || deleted} onClick={onToggleHidden}>
              {hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
              {hidden ? '显示' : '隐藏'}
            </button>
            <button className={toolButtonClass} type="button" disabled={disabled || saving || deleted} onClick={() => onMoveLayer?.('up')}>
              <MoveUp size={14} aria-hidden="true" />
              上移
            </button>
            <button className={toolButtonClass} type="button" disabled={disabled || saving || deleted} onClick={() => onMoveLayer?.('down')}>
              <MoveDown size={14} aria-hidden="true" />
              下移
            </button>
            <button className={toolButtonClass} type="button" disabled={disabled || saving || deleted} onClick={() => onMoveLayer?.('front')}>
              <BringToFront size={14} aria-hidden="true" />
              置顶
            </button>
            <button className={toolButtonClass} type="button" disabled={disabled || saving || deleted} onClick={() => onMoveLayer?.('back')}>
              <SendToBack size={14} aria-hidden="true" />
              置底
            </button>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {!deleted ? (
              <button className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-red-500/50 bg-red-500/10 px-3 text-xs font-bold text-red-100 transition hover:border-red-400 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled || saving} onClick={onDeleteSelected}>
                <Trash2 size={14} aria-hidden="true" />
                删除元素
              </button>
            ) : null}
            <button className="min-h-8 rounded-md border border-slate-700 bg-slate-900 px-3 text-xs font-bold text-slate-100 transition hover:border-[#25f4ee]/60 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled || saving || deleted} onClick={onResetPosition}>重置位置</button>
            <button className="min-h-8 rounded-md border border-slate-100 bg-slate-100 px-3 text-xs font-bold text-slate-950 transition hover:border-white hover:bg-white disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled || saving} onClick={onSaveEdit}>
              {saving ? '正在保存...' : '保存修改'}
            </button>
          </div>
        </>
      ) : null}
    </aside>
  );
}
