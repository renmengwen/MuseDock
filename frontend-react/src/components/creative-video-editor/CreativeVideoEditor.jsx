import { useCreativeVideoEditor } from '../../hooks/useCreativeVideoEditor.js';
import { useHtmlVideoProject } from '../../hooks/useHtmlVideoProject.js';
import { EditorStatusBar } from './EditorStatusBar.jsx';
import { FrameEditPanel } from './FrameEditPanel.jsx';
import { FrameList } from './FrameList.jsx';
import { HtmlVideoProjectEditor } from './HtmlVideoProjectEditor.jsx';
import { RenderVersionPanel } from './RenderVersionPanel.jsx';
import { SceneEditPanel } from './SceneEditPanel.jsx';
import { SceneList } from './SceneList.jsx';

export function CreativeVideoEditor({ workflowId, api, onRendered }) {
  const htmlVideoEditor = useHtmlVideoProject({ workflowId, api });

  if (htmlVideoEditor.status === 'legacy_fallback') {
    // 404 / NO_HTML_VIDEO_PROJECT 说明这是旧版工程，继续使用原编辑器。
    return <LegacyCreativeVideoEditor workflowId={workflowId} api={api} onRendered={onRendered} />;
  }

  return <HtmlVideoProjectEditor editor={htmlVideoEditor} onExported={onRendered} />;
}

function LegacyCreativeVideoEditor({ workflowId, api, onRendered }) {
  const editor = useCreativeVideoEditor({ workflowId, api });
  const disabled = editor.loading || editor.saving;

  async function handleRerender() {
    await editor.rerender();
    onRendered?.();
  }

  return (
    <section className="grid gap-3 rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-100 shadow-[0_18px_48px_rgba(15,23,42,.18)]">
      <EditorStatusBar status={editor.status} message={editor.message} dirtyRequiresRender={editor.dirtyRequiresRender} />
      <div className="flex flex-wrap gap-2">
        <button className="min-h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-sm font-bold text-slate-100 transition hover:border-[#25f4ee]/60 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled} onClick={editor.load}>重新加载</button>
        <button className="min-h-9 rounded-md border border-slate-100 bg-slate-100 px-3 text-sm font-bold text-slate-950 transition hover:border-white hover:bg-white disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled || !editor.dirtyRequiresRender} onClick={handleRerender}>重新渲染</button>
        <button className="min-h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-sm font-bold text-slate-100 transition hover:border-[#25f4ee]/60 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-55" type="button" disabled={disabled} onClick={() => editor.remix({})}>创建二创</button>
      </div>
      <div className="grid grid-cols-[minmax(150px,.8fr)_minmax(260px,1.4fr)_minmax(150px,.8fr)_minmax(220px,1fr)] gap-3 max-[1100px]:grid-cols-2 max-[720px]:grid-cols-1">
        <SceneList
          scenes={editor.sceneSpec?.scenes || []}
          selectedSceneId={editor.selectedSceneId}
          disabled={disabled}
          onSelect={editor.selectScene}
        />
        <SceneEditPanel
          scene={editor.selectedScene}
          disabled={disabled}
          onSave={scene => editor.saveSceneEdit(scene.id, scene)}
        />
        <FrameList
          frames={editor.frameSpecs?.frames || []}
          selectedFrameId={editor.selectedFrameId}
          disabled={disabled}
          onSelect={editor.selectFrame}
        />
        <FrameEditPanel
          frame={editor.selectedFrame}
          disabled={disabled}
          onSave={frame => editor.saveFrameEdit(frame.id, frame)}
        />
      </div>
      <RenderVersionPanel versions={editor.renderVersions} />
    </section>
  );
}
