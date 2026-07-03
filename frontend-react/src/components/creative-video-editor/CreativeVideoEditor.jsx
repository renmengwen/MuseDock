import { useHtmlVideoProject } from '../../hooks/useHtmlVideoProject.js';
import { HtmlVideoProjectEditor } from './HtmlVideoProjectEditor.jsx';

export function CreativeVideoEditor({ workflowId, api, onRendered }) {
  const htmlVideoEditor = useHtmlVideoProject({ workflowId, api });

  if (htmlVideoEditor.status === 'no_html_video_project') {
    return (
      <section className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">
        {htmlVideoEditor.message || '未找到 html-video 工程。'}
      </section>
    );
  }

  return <HtmlVideoProjectEditor editor={htmlVideoEditor} onExported={onRendered} />;
}
