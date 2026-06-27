import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ExportsPanel } from './ExportsPanel.jsx';
import { HtmlVideoAiEditPanel } from './HtmlVideoAiEditPanel.jsx';
import { HtmlVideoCanvasEditor } from './HtmlVideoCanvasEditor.jsx';
import { HtmlVideoDraftPanel } from './HtmlVideoDraftPanel.jsx';
import { HtmlVideoQualityPanel } from './HtmlVideoQualityPanel.jsx';
import { HtmlVideoSourcePanel } from './HtmlVideoSourcePanel.jsx';
import { NaturalLanguageEditBox } from './NaturalLanguageEditBox.jsx';
import { ProjectStatusBar } from './ProjectStatusBar.jsx';

function PanelDialog({ label, title, children }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button">{label}</button>
      </DialogTrigger>
      <DialogContent className="html-video-panel-dialog">
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
    <section className="creative-video-editor html-video-project-editor">
      <ProjectStatusBar status={editor.status} message={editor.message} dirtyRequiresRender={editor.dirtyRequiresRender} />
      <div className="creative-video-editor-toolbar">
        <button type="button" disabled={disabled} onClick={editor.load}>重新加载</button>
        <button type="button" disabled={disabled} onClick={() => editor.materializeProject({})}>
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
        <button type="button" disabled={disabled} onClick={() => handleExport({})}>
          {editor.status === 'exporting' ? '正在导出成片...' : '导出成片'}
        </button>
      </div>
      <NaturalLanguageEditBox
        disabled={disabled}
        editing={editor.status === 'editing'}
        onSubmit={editor.applyNaturalLanguageEdit}
      />
      <div className="html-video-project-layout html-video-project-canvas-layout">
        <HtmlVideoCanvasEditor editor={editor} />
      </div>
    </section>
  );
}
