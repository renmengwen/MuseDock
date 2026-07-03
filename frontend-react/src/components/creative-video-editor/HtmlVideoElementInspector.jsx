import { Trash2 } from 'lucide-react';

export function HtmlVideoElementInspector({
  elementInfo,
  editingReady,
  disabled,
  saving,
  dirty,
  canUndo,
  onUndo,
  onTextChange,
  onResetPosition,
  onSaveEdit,
  onDeleteSelected,
}) {
  const deleted = Boolean(elementInfo?.deleted);

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
      {editingReady && elementInfo ? (
        <>
          {deleted ? (
            <p className="m-0 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs leading-relaxed text-red-100">元素已删除，保存后生效。</p>
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
          <label className="grid gap-1.5 text-[13px] text-slate-300">
            文案
            <textarea
              value={elementInfo.text || ''}
              disabled={disabled || deleted}
              rows={4}
              className="w-full resize-y rounded-md border border-slate-700 bg-slate-950/35 p-2 text-sm text-slate-100 outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/20 disabled:cursor-not-allowed disabled:opacity-60"
              onChange={event => onTextChange?.(event.target.value)}
            />
          </label>
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
