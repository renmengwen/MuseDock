import { useEffect, useState } from 'react';
import { buildFrameSavePayload, updateHeadline } from './frameInputsPayload.mjs';

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getFrameDuration(frame) {
  const duration = Number(frame?.duration_sec ?? frame?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : '';
}

function getFrameTitle(frame) {
  return frame?.title
    || frame?.metadata?.visual_text?.headline
    || frame?.inputs?.headline
    || frame?.inputs?.title
    || '';
}

function getFrameInputs(frame) {
  const inputs = objectOrEmpty(frame?.inputs);
  if (Object.keys(inputs).length > 0) return inputs;
  return objectOrEmpty(frame?.metadata?.visual_text);
}

function createDraft(frame) {
  if (!frame) return null;
  const inputs = getFrameInputs(frame);
  return {
    ...frame,
    title: getFrameTitle(frame),
    headline: getFrameTitle(frame),
    duration_sec: getFrameDuration(frame),
    inputs,
    inputsText: JSON.stringify(inputs, null, 2),
    narration_text: frame.narration_text || '',
  };
}

export function FrameInputsPanel({ frame, disabled, onSave, onRenderPreview }) {
  const [draft, setDraft] = useState(() => createDraft(frame));

  useEffect(() => {
    setDraft(createDraft(frame));
  }, [frame]);

  if (!draft) {
    return <section className="creative-video-editor-panel"><p>请选择要编辑的帧</p></section>;
  }

  return (
    <section className="creative-video-editor-panel html-video-frame-inputs">
      <div className="creative-video-editor-panel-header">
        <h3>帧字段</h3>
        <div className="creative-video-editor-inline-actions">
          <button type="button" disabled={disabled} onClick={() => onRenderPreview(draft.id)}>渲染单帧预览</button>
          <button type="button" disabled={disabled} onClick={() => onSave(buildFrameSavePayload(draft))}>保存帧</button>
        </div>
      </div>
      <label>
        <span>模板</span>
        <input value={draft.template_id || draft.template || ''} disabled={disabled} onChange={event => setDraft({ ...draft, template_id: event.target.value })} />
      </label>
      <label>
        <span>时长（秒）</span>
        <input type="number" min="0" step="0.1" value={draft.duration_sec || ''} disabled={disabled} onChange={event => setDraft({ ...draft, duration_sec: event.target.value === '' ? '' : Number(event.target.value) })} />
      </label>
      <label>
        <span>标题</span>
        <input
          value={draft.title || ''}
          disabled={disabled}
          onChange={event => {
            const title = event.target.value;
            setDraft({
              ...draft,
              title,
              headline: title,
              inputs: updateHeadline(draft.inputs, title),
              inputsText: JSON.stringify(updateHeadline(draft.inputs, title), null, 2),
            });
          }}
        />
      </label>
      <label>
        <span>旁白</span>
        <textarea
          value={draft.narration_text || ''}
          disabled={disabled}
          rows={3}
          onChange={event => setDraft({ ...draft, narration_text: event.target.value })}
        />
      </label>
      <label>
        <span>帧输入 JSON</span>
        <textarea
          value={draft.inputsText}
          disabled={disabled}
          rows={6}
          onChange={event => {
            const inputsText = event.target.value;
            try {
              setDraft({ ...draft, inputs: JSON.parse(inputsText || '{}'), inputsText });
            } catch {
              setDraft({ ...draft, inputsText });
            }
          }}
        />
      </label>
    </section>
  );
}
