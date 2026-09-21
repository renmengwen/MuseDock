// Adapted from nexu-io/html-video @ c414ecc07f795add03807d5d9ce4baefd807cea2:
// packages/project-studio/public/app.js renderConfirmCard/renderFormCard and
// confirmInFlight/formSubmitted interaction patterns. Rendering is React/shadcn;
// pending/answered/superseded always comes from MuseDock's persisted interaction.
import { useState } from 'react';
import { Check, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { ProductionPlanFields } from './WhiteboardInputFields.jsx';
import { whiteboardCanvasLabel, subtitleStyleLabel, validateSubtitleSettings } from './whiteboardForm.js';

export function WhiteboardConversationCard({ interaction, active, artifact, disabled, allowed, onConfirm, onUpdatePlan }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const pending = active && interaction.status === 'pending';
  const plan = interaction.kind === 'plan_review';
  const coverage = interaction.kind === 'annotation_coverage_review';
  return (
    <div className="grid gap-3 rounded-lg border border-line-2 bg-surface-1 p-4" data-interaction-id={interaction.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm text-fg-1">{interaction.title}</strong>
        {!pending ? <span className="text-xs text-fg-3">{interaction.status === 'superseded' ? '已被新版本替代' : interaction.response || '已处理'}</span> : null}
      </div>
      {interaction.summary ? <p className="m-0 text-xs leading-6 text-fg-3">{interaction.summary}</p> : null}
      {pending && plan && artifact ? <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
        <dt className="text-fg-3">制作规模</dt><dd className="m-0">{artifact.scenes.length} 幕 · 约 {Math.round(artifact.durationMs / 1000)} 秒</dd>
        <dt className="text-fg-3">视频画幅</dt><dd className="m-0">{whiteboardCanvasLabel(artifact.aspectRatio)} · {artifact.canvas?.width || 1920} × {artifact.canvas?.height || 1080}</dd>
        <dt className="text-fg-3">视觉模板</dt><dd className="m-0">{artifact.visualStyle.displayName}</dd>
        <dt className="text-fg-3">旁白</dt><dd className="m-0">{artifact.productionPlan.narrationMode === 'disabled' ? (artifact.timingKind === 'source_srt' ? '无旁白，使用 SRT 时间轴' : '无旁白，使用计划时间轴') : artifact.narrationService?.displayName || '未配置'}</dd>
        <dt className="text-fg-3">背景音乐</dt><dd className="m-0">{artifact.productionPlan.bgmMode === 'enabled' ? '使用 BGM（内置轻钢琴）' : '不使用 BGM'}</dd>
        <dt className="text-fg-3">成片字幕</dt><dd className="m-0">{artifact.productionPlan.burnSubtitles ? `单行短句 · ${subtitleStyleLabel(artifact.productionPlan, artifact.aspectRatio)}` : '不烧录字幕'}</dd>
        <dt className="text-fg-3">后续流程</dt><dd className="m-0">{artifact.productionPlan.agentApprovalEnabled ? '按授权自动推进，异常时暂停' : '逐阶段确认产物'}</dd>
      </dl> : null}
      {pending && editing && form ? <form className="grid gap-3 border-t border-line-1 pt-3" onSubmit={event => { event.preventDefault(); if (!validateSubtitleSettings(form)) onUpdatePlan(form); }}>
        <ProductionPlanFields value={form} aspectRatio={artifact.aspectRatio} onChange={setForm} disabled={disabled} />
        <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={disabled || Boolean(validateSubtitleSettings(form))}>{disabled ? '正在保存制作方案...' : '保存为新的待确认版本'}</Button><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setEditing(false)}>取消调整</Button></div>
      </form> : null}
      {pending && !editing ? <div className="flex flex-wrap gap-2">
        {coverage && allowed.has('accept_low_coverage') ? <Button type="button" size="sm" disabled={disabled} onClick={() => onConfirm('accept_low_coverage')}>查看预览并处理</Button> : null}
        {allowed.has(plan ? 'approve_initial' : 'approve_media') ? <Button type="button" size="sm" disabled={disabled} onClick={() => onConfirm(plan ? 'approve_initial' : 'approve_media')}><Check size={14} />{plan ? '确认内容与制作方案' : interaction.stage === 'final_approval' ? '确认最终成片' : '确认当前产物并继续'}</Button> : null}
        {plan && allowed.has('update_plan') ? <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { setForm({ ...artifact.productionPlan }); setEditing(true); }}><Settings2 size={14} />调整制作设置</Button> : null}
      </div> : null}
      {pending && !plan ? <p className="m-0 text-xs leading-6 text-fg-3">{coverage ? '打开预览，对照当前落墨效果与红色遗漏标记，再选择接受、重新编排或暂不决定。' : '在产物区检查当前文件。确认会绑定本次产物；重新生成后，旧卡片自动失效。'}</p> : null}
    </div>
  );
}
