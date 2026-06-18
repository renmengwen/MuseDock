import { CaptionsPanel } from './CaptionsPanel.jsx';
import { ExportsPanel } from './ExportsPanel.jsx';
import { FrameInputsPanel } from './FrameInputsPanel.jsx';
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

  async function handleExport(payload) {
    const result = await editor.exportProject(payload);
    if (result) onExported?.(result);
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
      <div className="html-video-project-layout">
        <ProjectFramesList
          frames={editor.frames}
          selectedFrameId={editor.selectedFrameId}
          disabled={disabled}
          onSelect={editor.selectFrame}
        />
        <div className="html-video-project-main">
          <FrameInputsPanel
            frame={editor.selectedFrame}
            disabled={disabled}
            onSave={editor.saveFrame}
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
            captions={editor.project?.captions || []}
            disabled={disabled}
            onSave={editor.saveTemplateInputs}
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
