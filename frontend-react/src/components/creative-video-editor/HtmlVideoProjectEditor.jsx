import { CaptionsPanel } from './CaptionsPanel.jsx';
import { ExportsPanel } from './ExportsPanel.jsx';
import { FrameInputsPanel } from './FrameInputsPanel.jsx';
import { HtmlVideoAiEditPanel } from './HtmlVideoAiEditPanel.jsx';
import { HtmlVideoDraftPanel } from './HtmlVideoDraftPanel.jsx';
import { HtmlVideoQualityPanel } from './HtmlVideoQualityPanel.jsx';
import { HtmlVideoSourcePanel } from './HtmlVideoSourcePanel.jsx';
import { NarrationPanel } from './NarrationPanel.jsx';
import { NaturalLanguageEditBox } from './NaturalLanguageEditBox.jsx';
import { ProjectFramesList } from './ProjectFramesList.jsx';
import { ProjectStatusBar } from './ProjectStatusBar.jsx';
import { TemplateInputsPanel } from './TemplateInputsPanel.jsx';

function getTemplateSchema(project) {
  return project?.template_schema || project?.input_schema || project?.schema || project?.template?.schema || {};
}

function getTemplateValues(project) {
  return project?.inputs || project?.template_inputs || project?.values || {};
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

  function patchProject(payload) {
    if (editor.patchProject) return editor.patchProject(payload);
    if (payload?.type === 'frame_patch') {
      return editor.saveFrame(payload.frame_id, payload);
    }
    return editor.saveTemplateInputs(payload);
  }

  return (
    <section className="creative-video-editor html-video-project-editor">
      <ProjectStatusBar
        status={editor.status}
        message={editor.message}
        dirtyRequiresRender={editor.dirtyRequiresRender}
      />
      <div className="creative-video-editor-toolbar">
        <button type="button" disabled={disabled} onClick={editor.load}>重新加载</button>
        <button type="button" disabled={disabled} onClick={() => editor.materializeProject({})}>
          {editor.status === 'materializing' ? '正在重新生成 HTML...' : '重新生成 HTML'}
        </button>
        <button type="button" disabled={disabled} onClick={() => handleExport({})}>
          {editor.status === 'exporting' ? '正在导出成片...' : '导出成片'}
        </button>
      </div>
      <NaturalLanguageEditBox
        disabled={disabled}
        editing={editor.status === 'editing'}
        onSubmit={editor.applyNaturalLanguageEdit}
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
      <div className="html-video-project-layout">
        <ProjectFramesList
          frames={frames}
          selectedFrameId={editor.selectedFrameId}
          disabled={disabled}
          onSelect={editor.selectFrame}
        />
        <div className="html-video-project-main" aria-label="源码">
          <HtmlVideoSourcePanel
            frame={selectedFrame}
            html={editor.frameHtml}
            disabled={disabled}
            onLoad={editor.loadFrameHtml}
            onSaveDraft={editor.saveFrameHtmlDraft}
            onRenderDraft={(frameId, draftId) => editor.renderFramePreview(frameId, { draft_id: draftId, run_layout_qa: true })}
          />
          <HtmlVideoDraftPanel
            frame={selectedFrame}
            disabled={disabled}
            onRender={(frameId, draftId) => editor.renderFramePreview(frameId, { draft_id: draftId, run_layout_qa: true })}
            onAccept={editor.acceptFrameDraft}
            onDiscard={editor.discardFrameDraft}
          />
          <HtmlVideoQualityPanel
            frame={selectedFrame}
            layoutQa={editor.layoutQa}
            disabled={disabled}
            onInspectFrame={editor.inspectLayout}
            onFixFrame={(frameId) => editor.iterateFrame(frameId, {
              mode: 'layout_fix',
              preserve_text: true,
              run_layout_qa: true,
              render_preview: true,
              instruction: '修复当前帧文字错位、越界或遮挡问题，保留现有文案和整体风格。',
            })}
          />
          <FrameInputsPanel
            frame={selectedFrame}
            disabled={disabled}
            onSave={patchProject}
            onRenderPreview={editor.renderFramePreview}
          />
          <TemplateInputsPanel
            schema={getTemplateSchema(editor.project)}
            values={getTemplateValues(editor.project)}
            disabled={disabled}
            onSave={editor.saveTemplateInputs}
          />
        </div>
        <div className="html-video-project-side">
          <NarrationPanel
            narration={editor.project?.narration}
            disabled={disabled}
            onSave={editor.saveTemplateInputs}
            onRegenerate={editor.regenerateNarration}
          />
          <CaptionsPanel
            captions={selectedFrame?.captions || []}
            selectedFrameId={selectedFrame?.id || selectedFrame?.scene_id || ''}
            disabled={disabled}
            onSave={patchProject}
          />
          <ExportsPanel
            exportsList={editor.exportsList}
            disabled={disabled}
            exporting={editor.status === 'exporting'}
            onExport={handleExport}
            onRefresh={editor.refreshExports}
            getExportPlaybackUrl={editor.getExportPlaybackUrl}
          />
        </div>
      </div>
    </section>
  );
}
