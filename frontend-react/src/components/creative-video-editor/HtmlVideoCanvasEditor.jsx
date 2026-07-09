import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog.jsx';

import { HtmlVideoElementInspector } from './HtmlVideoElementInspector.jsx';
import { HtmlVideoFrameStrip } from './HtmlVideoFrameStrip.jsx';
import { FrameInputsPanel } from './FrameInputsPanel.jsx';
import { useCanvasEditing } from './useCanvasEditing.js';

const DARK_SCROLLBAR_CLASS = '[scrollbar-width:thin] [scrollbar-color:#64748b_#020617] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-slate-950 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb:hover]:bg-slate-500';

const secondaryButtonClass = 'min-h-7 rounded-md border border-slate-700 bg-slate-900 px-2.5 text-xs font-bold text-slate-100 transition hover:border-[#25f4ee]/60 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-55';

export function HtmlVideoCanvasEditor({ editor, onDirtyChange }) {
  const canvas = useCanvasEditing(editor, { onDirtyChange });
  const {
    frame,
    rawHtml,
    disabled,
    htmlReady,
    htmlLoadError,
    srcDoc,
    previewFrameStyle,
    previewError,
    setPreviewError,
    playbackState,
    editingReady,
    saving,
    dirty,
    canUndo,
    elementInfo,
    elementCandidates,
    layerItems,
    iframeKey,
    iframeRef,
    previewSlotRef,
    pendingFrameId,
    setPendingFrameId,
    replay,
    jumpToEnd,
    pauseAndEdit,
    autoEditOnLoad,
    setAutoEditOnLoad,
    reloadHtml,
    handleIframeLoad,
    undoEdit,
    snapshotBeforeEdit,
    updateSelectedText,
    updateSelectedGeometry,
    resetSelectedPosition,
    saveEdit,
    deleteSelectedElement,
    selectElementById,
    toggleSelectedLocked,
    toggleSelectedHidden,
    moveSelectedLayer,
    patchFrame,
    handleSelectFrame,
  } = canvas;

  if (!frame) {
    return <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-sm text-slate-300"><p className="m-0">请选择要编辑的帧。</p></section>;
  }

  if (!rawHtml) {
    return <section className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-sm text-slate-300"><p className="m-0">当前帧不是 raw_html，暂不支持画布编辑。</p></section>;
  }

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_260px] gap-2 overflow-hidden max-[1100px]:grid-cols-1 max-[1100px]:grid-rows-[minmax(0,1fr)_minmax(220px,40vh)]">
      <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-2 overflow-hidden">
        <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2.5 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
          <div className="flex items-center justify-between gap-2 border-b border-slate-700 bg-slate-800 px-2.5 py-2 max-[720px]:flex-col max-[720px]:items-start">
            <span className="text-xs text-slate-300">{previewError || (playbackState === 'playing' ? '正在播放镜头动画...' : editingReady ? '已停在镜头可编辑帧，可开始编辑。' : '正在准备预览...')}</span>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[#25f4ee]"
                  checked={autoEditOnLoad}
                  onChange={event => setAutoEditOnLoad(event.target.checked)}
                />
                <span>切帧后直接编辑</span>
              </label>
              <button className={secondaryButtonClass} type="button" disabled={disabled} onClick={replay}>重新播放</button>
              {playbackState === 'playing' ? (
                <button className={secondaryButtonClass} type="button" disabled={disabled} onClick={pauseAndEdit}>停在当前画面</button>
              ) : null}
              <button className={secondaryButtonClass} type="button" disabled={disabled} onClick={jumpToEnd}>跳到结尾并编辑</button>
            </div>
          </div>
          {!htmlReady && htmlLoadError ? (
            <div className="m-3 grid gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
              <p className="m-0">{htmlLoadError}</p>
              <button className="w-fit rounded-md bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled} onClick={reloadHtml}>重新加载 HTML</button>
            </div>
          ) : null}
          {!htmlReady && !htmlLoadError ? <p className="m-3 rounded-lg border border-slate-700 bg-slate-800 p-3 text-sm text-slate-300">正在加载当前镜头 HTML...</p> : null}
          <div ref={previewSlotRef} className="grid h-full min-h-0 place-items-center overflow-hidden px-2 pb-2">
            <iframe
              key={iframeKey}
              ref={iframeRef}
              className="block rounded-md border border-slate-700 bg-slate-950"
              style={previewFrameStyle}
              title="html-video 当前镜头画布"
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-same-origin"
              onLoad={handleIframeLoad}
              onError={() => setPreviewError('镜头预览加载失败，请检查 HTML 或重新播放。')}
            />
          </div>
        </div>
        <HtmlVideoFrameStrip
          frames={editor.frames}
          selectedFrameId={editor.selectedFrameId}
          disabled={disabled}
          onSelect={handleSelectFrame}
        />
      </div>
      <div className={`grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-hidden pr-1 ${DARK_SCROLLBAR_CLASS}`}>
        <div className={`min-h-0 overflow-y-auto overflow-x-hidden ${DARK_SCROLLBAR_CLASS}`}>
          <HtmlVideoElementInspector
            elementInfo={elementInfo}
            candidates={elementCandidates}
            layers={layerItems}
            editingReady={editingReady}
            disabled={disabled}
            saving={saving}
            dirty={dirty}
            canUndo={canUndo}
            onUndo={undoEdit}
            onTextChange={updateSelectedText}
            onTextEditStart={snapshotBeforeEdit}
            onGeometryChange={updateSelectedGeometry}
            onResetPosition={resetSelectedPosition}
            onSaveEdit={saveEdit}
            onDeleteSelected={deleteSelectedElement}
            onSelectCandidate={selectElementById}
            onSelectLayer={selectElementById}
            onToggleLocked={toggleSelectedLocked}
            onToggleHidden={toggleSelectedHidden}
            onMoveLayer={moveSelectedLayer}
          />
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <button className={`${secondaryButtonClass} w-full`} type="button" disabled={disabled}>帧字段</button>
          </DialogTrigger>
          <DialogContent className="grid max-h-[86vh] w-[min(760px,calc(100vw-32px))] max-w-[760px] grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-lg border-[#d9dde5] bg-[#f8fafc] p-0 text-[#111827] shadow-[0_24px_70px_rgba(15,23,42,.28)] sm:max-w-[760px]">
            <DialogHeader className="border-b border-[#e7e9ee] bg-white px-5 py-4 pr-12">
              <DialogTitle className="text-[15px]">帧字段</DialogTitle>
              <DialogDescription>编辑当前帧的模板字段。字幕和全片旁白在顶部“字幕 / 旁白”入口编辑。</DialogDescription>
            </DialogHeader>
            <div className="grid min-h-0 gap-3 overflow-auto p-4">
              <FrameInputsPanel frame={frame} disabled={disabled} onSave={patchFrame} />
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <ConfirmDialog
        open={pendingFrameId !== null}
        onOpenChange={value => {
          if (!value) setPendingFrameId(null);
        }}
        title="切换镜头"
        description="当前镜头有未保存的画布修改，切换后将丢失。"
        destructive
        confirmText="丢弃修改并切换"
        cancelText="留在当前镜头"
        onConfirm={() => {
          const nextId = pendingFrameId;
          setPendingFrameId(null);
          if (nextId !== null) editor.selectFrame(nextId);
        }}
      />
    </section>
  );
}
