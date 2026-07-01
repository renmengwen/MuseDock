import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ExportsPanel } from './ExportsPanel.jsx';
import { HtmlVideoAiEditPanel } from './HtmlVideoAiEditPanel.jsx';
import { HtmlVideoCanvasEditor } from './HtmlVideoCanvasEditor.jsx';
import { HtmlVideoDraftPanel } from './HtmlVideoDraftPanel.jsx';
import { HtmlVideoQualityPanel } from './HtmlVideoQualityPanel.jsx';
import { HtmlVideoSourcePanel } from './HtmlVideoSourcePanel.jsx';
import { NaturalLanguageEditBox } from './NaturalLanguageEditBox.jsx';
import { ProjectStatusBar } from './ProjectStatusBar.jsx';

const TOOL_BUTTON_CLASS = 'min-h-8 rounded-md border border-slate-700 bg-slate-800 px-2.5 text-xs font-bold text-slate-100 transition hover:border-[#25f4ee]/60 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-55';
const PRIMARY_TOOL_BUTTON_CLASS = 'min-h-8 rounded-md border border-slate-100 bg-slate-100 px-2.5 text-xs font-bold text-slate-950 transition hover:border-white hover:bg-white disabled:cursor-not-allowed disabled:opacity-55';

function PanelDialog({ label, title, children }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className={TOOL_BUTTON_CLASS} type="button">{label}</button>
      </DialogTrigger>
      <DialogContent className="max-h-[84vh] overflow-auto">
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

  async function handleExport(payload) {
    const result = await editor.exportProject(payload);
    if (result) onExported?.(result);
  }

  return (
    <section className="grid gap-2 rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-100 shadow-[0_18px_48px_rgba(15,23,42,.18)]">
      <ProjectStatusBar status={editor.status} message={editor.message} dirtyRequiresRender={editor.dirtyRequiresRender} />
      <div className="flex flex-wrap gap-2">
        <button className={TOOL_BUTTON_CLASS} type="button" disabled={disabled} onClick={editor.load}>重新加载</button>
        <button className={TOOL_BUTTON_CLASS} type="button" disabled={disabled} onClick={() => editor.materializeProject({})}>
          {editor.status === 'materializing' ? '正在重新生成 HTML...' : '重新生成 HTML'}
        </button>
        <PanelDialog label="源码" title="帧源码">
          <HtmlVideoSourcePanel
            frame={selectedFrame}
            html={editor.frameHtml}
            disabled={disabled}
            onLoad={editor.loadFrameHtml}
            onSaveDraft={editor.saveFrameHtmlDraft}
            onRenderDraft={(frameId, draftId) => editor.renderFramePreview(frameId, { draft_id: draftId })}
          />
        </PanelDialog>
        <PanelDialog label="草稿" title="草稿">
          <HtmlVideoDraftPanel
            frame={selectedFrame}
            disabled={disabled}
            onRender={(frameId, draftId) => editor.renderFramePreview(frameId, { draft_id: draftId })}
            onAccept={editor.acceptFrameDraft}
            onDiscard={editor.discardFrameDraft}
          />
        </PanelDialog>
        <PanelDialog label="布局检查" title="布局检查">
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
        </PanelDialog>
        <PanelDialog label="AI 修改" title="AI 修改">
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
        </PanelDialog>
        <PanelDialog label="导出记录" title="导出记录">
          <ExportsPanel
            exportsList={editor.exportsList}
            disabled={disabled}
            exporting={editor.status === 'exporting'}
            onExport={handleExport}
            onRefresh={editor.refreshExports}
            getExportPlaybackUrl={editor.getExportPlaybackUrl}
          />
        </PanelDialog>
        <button className={PRIMARY_TOOL_BUTTON_CLASS} type="button" disabled={disabled} onClick={() => handleExport({})}>
          {editor.status === 'exporting' ? '正在导出成片...' : '导出成片'}
        </button>
      </div>
      <NaturalLanguageEditBox
        disabled={disabled}
        editing={editor.status === 'editing'}
        onSubmit={editor.applyNaturalLanguageEdit}
      />
      <div className="grid min-w-0 grid-cols-1">
        <HtmlVideoCanvasEditor editor={editor} />
      </div>
    </section>
  );
}
