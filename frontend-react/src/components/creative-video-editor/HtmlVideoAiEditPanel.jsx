import { useState } from 'react';

function getFrameId(frame) {
  return frame?.id || frame?.scene_id || '';
}

function getPlanId(editPlan) {
  return editPlan?.id || editPlan?.plan_id || editPlan?.session_id || '';
}

function summarizePlan(editPlan) {
  if (!editPlan) return '';
  if (editPlan.summary) return editPlan.summary;
  if (editPlan.instruction) return editPlan.instruction;
  if (Array.isArray(editPlan.steps)) {
    return editPlan.steps.map((step, index) => `${index + 1}. ${step.summary || step.instruction || step.action || '未命名步骤'}`).join('\n');
  }
  return JSON.stringify(editPlan, null, 2);
}

export function HtmlVideoAiEditPanel({
  frame,
  editPlan,
  disabled,
  onIterateFrame,
  onCreatePlan,
  onRunPlan,
  onAcceptPlan,
  onDiscardPlan,
}) {
  const [frameMode, setFrameMode] = useState('layout_fix');
  const [preserveText, setPreserveText] = useState(true);
  const [frameInstruction, setFrameInstruction] = useState('');
  const [planInstruction, setPlanInstruction] = useState('');

  const frameId = getFrameId(frame);
  const planId = getPlanId(editPlan);
  const trimmedFrameInstruction = frameInstruction.trim();
  const trimmedPlanInstruction = planInstruction.trim();
  const canIterateFrame = Boolean(frameId && trimmedFrameInstruction && !disabled);
  const canCreatePlan = Boolean(trimmedPlanInstruction && !disabled);
  const canUsePlan = Boolean(planId && !disabled);

  async function submitFrameDraft(event) {
    event.preventDefault();
    if (!canIterateFrame) return;
    const result = await onIterateFrame?.(frameId, {
      mode: frameMode,
      preserve_text: preserveText,
      run_layout_qa: true,
      render_preview: true,
      instruction: trimmedFrameInstruction,
    });
    if (result) setFrameInstruction('');
  }

  async function submitEditPlan(event) {
    event.preventDefault();
    if (!canCreatePlan) return;
    const payload = {
      instruction: trimmedPlanInstruction,
    };
    if (frameId) payload.selected_frame_id = frameId;
    const result = await onCreatePlan?.(payload);
    if (result) setPlanInstruction('');
  }

  return (
    <section className="creative-video-editor-panel html-video-ai-edit-panel">
      <div className="creative-video-editor-panel-header">
        <h3>AI 修改</h3>
      </div>

      <form onSubmit={submitFrameDraft}>
        <div className="creative-video-editor-panel-header">
          <h4>当前帧</h4>
          <button type="submit" disabled={!canIterateFrame}>生成当前帧草稿</button>
        </div>
        <label>
          修改模式
          <select value={frameMode} disabled={disabled} onChange={event => setFrameMode(event.target.value)}>
            <option value="layout_fix">修复布局</option>
            <option value="visual_rewrite">重写视觉</option>
            <option value="content_rewrite">改写内容</option>
            <option value="style_match">匹配风格</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={preserveText}
            disabled={disabled}
            onChange={event => setPreserveText(event.target.checked)}
          />
          保留文案
        </label>
        <textarea
          value={frameInstruction}
          disabled={disabled}
          rows={3}
          placeholder="例如：修复布局错位，标题不要遮挡人物主体。"
          onChange={event => setFrameInstruction(event.target.value)}
        />
      </form>

      <form onSubmit={submitEditPlan}>
        <div className="creative-video-editor-panel-header">
          <h4>全片</h4>
          <button type="submit" disabled={!canCreatePlan}>生成全片编辑计划</button>
        </div>
        <textarea
          value={planInstruction}
          disabled={disabled}
          rows={3}
          placeholder="例如：全片统一改成更干净的科技资讯风格，并检查所有字幕遮挡。"
          onChange={event => setPlanInstruction(event.target.value)}
        />
      </form>

      {editPlan ? (
        <div className="html-video-ai-edit-plan">
          <div className="creative-video-editor-panel-header">
            <h4>计划草稿</h4>
            <div className="creative-video-editor-inline-actions">
              <button type="button" disabled={!canUsePlan} onClick={() => onRunPlan?.(planId, { confirm: true })}>
                执行全片编辑计划
              </button>
              <button type="button" disabled={!canUsePlan || editPlan.status !== 'drafts_ready'} onClick={() => onAcceptPlan?.(planId)}>接受计划草稿</button>
              <button type="button" disabled={!canUsePlan || !editPlan.generated_drafts?.length} onClick={() => onDiscardPlan?.(planId)}>放弃计划草稿</button>
            </div>
          </div>
          <pre>{summarizePlan(editPlan)}</pre>
        </div>
      ) : null}
    </section>
  );
}
