import { useState } from 'react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { CaptionsPanel } from './CaptionsPanel.jsx';
import { ExportsPanel } from './ExportsPanel.jsx';
import { HtmlVideoAiEditPanel } from './HtmlVideoAiEditPanel.jsx';
import { HtmlVideoCanvasEditor } from './HtmlVideoCanvasEditor.jsx';
import { HtmlVideoDraftPanel } from './HtmlVideoDraftPanel.jsx';
import { HtmlVideoQualityPanel } from './HtmlVideoQualityPanel.jsx';
import { HtmlVideoSourcePanel } from './HtmlVideoSourcePanel.jsx';
import { NarrationPanel } from './NarrationPanel.jsx';
import { NaturalLanguageEditBox } from './NaturalLanguageEditBox.jsx';
import { ProjectStatusBar } from './ProjectStatusBar.jsx';
import { SfxPanel } from './SfxPanel.jsx';

const TOOL_BUTTON_CLASS = 'min-h-8 rounded-md border border-slate-700 bg-slate-800 px-2.5 text-xs font-bold text-slate-100 transition hover:border-[#25f4ee]/60 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-55';
const PRIMARY_TOOL_BUTTON_CLASS = 'min-h-8 rounded-md border border-slate-100 bg-slate-100 px-2.5 text-xs font-bold text-slate-950 transition hover:border-white hover:bg-white disabled:cursor-not-allowed disabled:opacity-55';
const MENU_ITEM_CLASS = 'cursor-pointer rounded px-2.5 py-2 text-xs font-bold text-slate-100 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55 data-[highlighted]:bg-slate-700';
const LIGHT_SCROLLBAR_CLASS = '[scrollbar-width:thin] [scrollbar-color:#cbd5e1_#f8fafc] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-[#f8fafc] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb:hover]:bg-slate-400';

function PanelDialog({ label, title, contentClassName = '', children }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className={TOOL_BUTTON_CLASS} type="button">{label}</button>
      </DialogTrigger>
      <DialogContent className={`max-h-[84vh] overflow-y-auto overflow-x-hidden ${LIGHT_SCROLLBAR_CLASS} ${contentClassName}`}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function HtmlVideoProjectEditor({ editor, onExported }) {
  const disabled = editor.disabled;
  const frames = Array.isArray(editor.frames) ? editor.frames : [];
  const selectedFrame = frames.find(frame => (
    frame.id === editor.selectedFrameId || frame.scene_id === editor.selectedFrameId
  )) || editor.selectedFrame || null;
  const selectedFrameId = selectedFrame?.id || selectedFrame?.scene_id || '';

  // 低频面板收进“更多”菜单，菜单项打开受控 Dialog；
  // onSelect 必须 preventDefault，否则菜单关闭的焦点归还会和 Dialog 焦点陷阱竞态
  const [activePanel, setActivePanel] = useState(null);

  function openPanel(event, panel) {
    event.preventDefault();
    setActivePanel(panel);
    // 源码面板依赖手动加载的 frameHtml，打开时自动加载当前帧，避免展示上一帧的旧源码
    if (panel === 'source' && selectedFrameId) editor.loadFrameHtml(selectedFrameId);
  }

  async function handleExport(payload) {
    const result = await editor.exportProject(payload);
    if (result) onExported?.(result);
  }

  function patchFrame(payload) {
    if (payload?.type === 'frame_patch') return editor.saveFrame(payload.frame_id, payload);
    return editor.saveTemplateInputs(payload);
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-2 rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-100 shadow-[0_18px_48px_rgba(15,23,42,.18)]">
      <ProjectStatusBar status={editor.status} message={editor.message} dirtyRequiresRender={editor.dirtyRequiresRender} />
      <div className="flex flex-wrap items-center gap-2">
        <PanelDialog label="字幕 / 旁白" title="字幕 / 旁白">
          <div className="grid content-start gap-3">
            <CaptionsPanel captions={selectedFrame?.captions || []} selectedFrameId={selectedFrameId} disabled={disabled} onSave={patchFrame} />
            <NarrationPanel
              narration={selectedFrame?.narration_text || ''}
              disabled={disabled || !selectedFrameId}
              onSave={(payload) => editor.saveFrame(selectedFrameId, {
                type: 'frame_patch',
                narration_text: payload.text || '',
              })}
              onRegenerate={(payload) => editor.regenerateNarration(selectedFrameId, payload)}
            />
          </div>
        </PanelDialog>
        <PanelDialog label="AI 修改" title="AI 修改" contentClassName="w-[min(720px,calc(100vw-32px))] max-w-[720px] bg-[#f8fafc] text-[#111827] sm:max-w-[720px]">
          <div className="grid content-start gap-3">
            <NaturalLanguageEditBox
              tone="light"
              disabled={disabled}
              editing={editor.status === 'editing'}
              onSubmit={editor.applyNaturalLanguageEdit}
            />
            <HtmlVideoDraftPanel
              frame={selectedFrame}
              disabled={disabled}
              onRender={(frameId, draftId) => editor.renderFramePreview(frameId, { draft_id: draftId })}
              onAccept={editor.acceptFrameDraft}
              onDiscard={editor.discardFrameDraft}
            />
            <HtmlVideoAiEditPanel
              frame={selectedFrame}
              editPlan={editor.editPlan}
              disabled={disabled}
              onIterateFrame={editor.iterateFrame}
              onCreatePlan={editor.createEditPlan}
              onRunPlan={editor.runEditPlan}
              onAcceptPlan={editor.acceptEditPlan}
              onDiscardPlan={editor.discardEditPlan}
            />
          </div>
        </PanelDialog>
        <DropdownMenuPrimitive.Root>
          <DropdownMenuPrimitive.Trigger asChild>
            <button className={TOOL_BUTTON_CLASS} type="button" disabled={disabled}>更多 ▾</button>
          </DropdownMenuPrimitive.Trigger>
          <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content align="start" sideOffset={6} className="z-50 min-w-[168px] rounded-md border border-slate-700 bg-slate-800 p-1 shadow-[0_16px_40px_rgba(2,6,23,.5)]">
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={(event) => openPanel(event, 'layout-qa')}>布局检查</DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={(event) => openPanel(event, 'source')}>源码</DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={(event) => openPanel(event, 'exports')}>导出记录</DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={(event) => openPanel(event, 'sfx')}>音效</DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Separator className="my-1 h-px bg-slate-700" />
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={() => editor.materializeProject({})}>
                {editor.status === 'materializing' ? '正在重新生成 HTML...' : '重新生成 HTML'}
              </DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Item className={MENU_ITEM_CLASS} onSelect={editor.load}>重新加载</DropdownMenuPrimitive.Item>
            </DropdownMenuPrimitive.Content>
          </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Root>
        <button className={`${PRIMARY_TOOL_BUTTON_CLASS} ml-auto`} type="button" disabled={disabled} onClick={() => handleExport({})}>
          {editor.status === 'exporting' ? '正在导出成片...' : '导出成片'}
        </button>
      </div>
      <Dialog open={activePanel === 'layout-qa'} onOpenChange={(open) => { if (!open) setActivePanel(null); }}>
        <DialogContent className={`max-h-[84vh] overflow-y-auto overflow-x-hidden ${LIGHT_SCROLLBAR_CLASS}`}>
          <DialogHeader><DialogTitle>布局检查</DialogTitle></DialogHeader>
          <HtmlVideoQualityPanel
            frame={selectedFrame}
            layoutQa={editor.layoutQa}
            disabled={disabled}
            onInspectFrame={editor.inspectLayout}
            onFixFrame={(frameId) => editor.iterateFrame(frameId, {
              mode: 'layout_fix', preserve_text: true, run_layout_qa: true, render_preview: true,
              instruction: '修复当前帧文字错位、越界或遮挡问题，保留现有文案和整体风格。',
            })}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={activePanel === 'source'} onOpenChange={(open) => { if (!open) setActivePanel(null); }}>
        <DialogContent className={`max-h-[84vh] overflow-y-auto overflow-x-hidden ${LIGHT_SCROLLBAR_CLASS}`}>
          <DialogHeader><DialogTitle>帧源码</DialogTitle></DialogHeader>
          <HtmlVideoSourcePanel
            frame={selectedFrame}
            html={editor.frameHtml}
            disabled={disabled}
            onLoad={editor.loadFrameHtml}
            onSaveDraft={editor.saveFrameHtmlDraft}
            onRenderDraft={(frameId, draftId) => editor.renderFramePreview(frameId, { draft_id: draftId })}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={activePanel === 'exports'} onOpenChange={(open) => { if (!open) setActivePanel(null); }}>
        <DialogContent className={`max-h-[84vh] overflow-y-auto overflow-x-hidden ${LIGHT_SCROLLBAR_CLASS}`}>
          <DialogHeader><DialogTitle>导出记录</DialogTitle></DialogHeader>
          <ExportsPanel
            exportsList={editor.exportsList}
            disabled={disabled}
            exporting={editor.status === 'exporting'}
            onExport={handleExport}
            onRefresh={editor.refreshExports}
            getExportPlaybackUrl={editor.getExportPlaybackUrl}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={activePanel === 'sfx'} onOpenChange={(open) => { if (!open) setActivePanel(null); }}>
        <DialogContent className={`max-h-[84vh] w-[min(560px,calc(100vw-32px))] max-w-[560px] overflow-y-auto overflow-x-hidden bg-[#f8fafc] text-[#111827] sm:max-w-[560px] ${LIGHT_SCROLLBAR_CLASS}`}>
          <DialogHeader><DialogTitle>自动音效</DialogTitle></DialogHeader>
          <SfxPanel
            project={editor.project}
            frames={frames}
            disabled={disabled}
            deletingSfxEventId={editor.deletingSfxEventId}
            onDisableEvent={editor.disableSfxEvent}
          />
        </DialogContent>
      </Dialog>
      <div className="grid min-h-0 min-w-0 grid-cols-1">
        <HtmlVideoCanvasEditor editor={editor} />
      </div>
    </section>
  );
}
