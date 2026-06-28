export function HtmlVideoElementInspector({
  elementInfo,
  editingReady,
  disabled,
  saving,
  onTextChange,
  onResetPosition,
  onSaveEdit,
}) {
  return (
    <aside className="grid min-w-0 content-start gap-2 rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-100" aria-label="元素属性">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-bold">当前元素</h3>
      </div>
      {!editingReady ? (
        <p className="m-0 text-sm leading-relaxed text-slate-300">镜头播放完毕后可选择并拖拽元素。</p>
      ) : null}
      {editingReady && !elementInfo ? (
        <p className="m-0 text-sm leading-relaxed text-slate-300">点击画面中的标题、标签或正文元素开始编辑。</p>
      ) : null}
      {editingReady && elementInfo ? (
        <>
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
              disabled={disabled}
              rows={4}
              className="w-full resize-y rounded-md border border-slate-700 bg-slate-950/35 p-2 text-sm text-slate-100 outline-none transition focus:border-[#25f4ee] focus:ring-2 focus:ring-[#25f4ee]/20 disabled:cursor-not-allowed disabled:opacity-60"
              onChange={event => onTextChange?.(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button className="min-h-8 rounded-md border border-slate-700 bg-slate-900 px-3 text-xs font-bold text-slate-100 transition hover:border-[#25f4ee]/60 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled || saving} onClick={onResetPosition}>重置位置</button>
            <button className="min-h-8 rounded-md bg-[#fe2c55] px-3 text-xs font-bold text-white transition hover:bg-[#f2214b] disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled || saving} onClick={onSaveEdit}>
              {saving ? '正在保存...' : '保存修改'}
            </button>
          </div>
        </>
      ) : null}
    </aside>
  );
}
