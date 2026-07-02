import { useEffect, useState } from 'react';
import { EditorInlineActions, EditorPanel, EditorPanelHeader } from './editorUi.jsx';

export function HtmlVideoSourcePanel({ frame, html, disabled, onLoad, onSaveDraft, onRenderDraft }) {
  const [draft, setDraft] = useState(html || '');

  useEffect(() => {
    setDraft(html || '');
  }, [html, frame?.id, frame?.scene_id]);

  const frameId = frame?.id || frame?.scene_id || '';
  const rawHtml = frame?.source_mode === 'raw_html';
  if (!frame) return <EditorPanel><p>请选择要编辑的帧。</p></EditorPanel>;
  if (!rawHtml) return <EditorPanel><p>当前帧不是 raw_html，暂不支持源码编辑。</p></EditorPanel>;

  return (
    <EditorPanel>
      <EditorPanelHeader>
        <h3>源码</h3>
        <EditorInlineActions>
          <button type="button" disabled={disabled} onClick={() => onLoad(frameId)}>加载源码</button>
          <button type="button" disabled={disabled || !draft.trim()} onClick={() => onSaveDraft(frameId, { html: draft, mode: 'draft' })}>保存为草稿</button>
          <button type="button" disabled={disabled || !frame.active_draft_id} onClick={() => onRenderDraft(frameId, frame.active_draft_id)}>渲染草稿</button>
        </EditorInlineActions>
      </EditorPanelHeader>
      <textarea value={draft} disabled={disabled} rows={16} spellCheck={false} onChange={event => setDraft(event.target.value)} />
    </EditorPanel>
  );
}
