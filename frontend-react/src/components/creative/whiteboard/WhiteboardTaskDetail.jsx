import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, Check, FileClock, FileText, Loader2, PenLine, Settings2, Trash2 } from 'lucide-react';
import { api } from '@/api/client.js';
import { Button } from '@/components/ui/button.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { ConfirmDialog } from '@/components/ui/confirm-dialog.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog.jsx';
import { cn } from '@/lib/utils.js';
import { STATUS_TEXT } from '../creativeDisplay.js';
import { LabeledSelect, ProductionPlanFields } from './WhiteboardInputFields.jsx';
import { WhiteboardArtifact } from './WhiteboardArtifact.jsx';
import { WhiteboardConversationCard } from './WhiteboardConversationCard.jsx';
import { WhiteboardMediaPanel } from './WhiteboardMediaPanel.jsx';

export function WhiteboardTaskDetail({ workflow, message, deletingWorkflowId, onAction, onStopAndDelete, progressEvents = [] }) {
  const [revision, setRevision] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [editedPlan, setEditedPlan] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyArtifact, setHistoryArtifact] = useState(null);
  const [historyBusy, setHistoryBusy] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [sceneId, setSceneId] = useState('');
  const actionLock = useRef(false);
  const conversationRef = useRef(null);
  const followConversation = useRef(true);
  const historyRequest = useRef(0);
  const whiteboard = workflow.whiteboard;
  const media = whiteboard.media && !whiteboard.media.stale ? whiteboard.media : null;
  const interactions = whiteboard.interactions || [];
  const pendingInteraction = interactions.findLast(item => item.status === 'pending');
  const current = whiteboard.current;
  const attempts = whiteboard.attempts || [];
  const activeVersion = attempts.find(attempt => attempt.id === current?.attemptId);
  const artifact = current?.artifact;
  const aspectRatio = artifact?.aspectRatio || workflow.input?.aspectRatio || '16:9';
  const allowed = new Set((whiteboard.allowedActions || []).map(action => action.id));
  const running = ['queued', 'running'].includes(workflow.status);
  const locked = running || Boolean(busy) || Boolean(deletingWorkflowId);
  const latest = attempts.at(-1);
  const title = artifact?.title || workflow.title || '白板创作';
  const statusMessage = whiteboard.artifactError || workflow.current_stage_message || workflow.message || message;
  const canMessage = Boolean(artifact) && !['unknown_external_outcome', 'failed'].includes(workflow.status);
  const selectedScene = sceneId || artifact?.scenes[0]?.id || '';
  const needsAttention = Boolean(whiteboard.artifactError) || ['failed', 'unknown_external_outcome'].includes(workflow.status);
  const emptyTitle = running ? '正在整理正文与分镜' : workflow.status === 'unknown_external_outcome' ? '方案结果待核实' : workflow.status === 'failed' ? '方案生成未完成' : '等待生成方案';

  useEffect(() => () => { historyRequest.current += 1; }, []);
  useEffect(() => {
    const element = conversationRef.current;
    if (element && followConversation.current) element.scrollTop = element.scrollHeight;
  }, [whiteboard.messages.length, pendingInteraction?.id]);

  async function act(action, extras = {}) {
    if (actionLock.current || locked || (!allowed.has(action) && !(action === 'message' && canMessage))) return;
    actionLock.current = true;
    followConversation.current = true;
    setBusy(action);
    setError('');
    try {
      await onAction({ action, expectedIdentity: current?.identity || '', expectedAttemptId: latest?.id,
        expectedMediaIdentity: media?.identity, interactionId: pendingInteraction?.id,
        requestId: crypto.randomUUID(), ...extras });
      if (['revise', 'revise_media', 'message'].includes(action)) setRevision('');
      setConfirm('');
      setPlanOpen(false);
    } catch (failure) {
      setError(failure?.data?.message || failure?.message || '操作失败，请刷新当前任务后重试。');
    } finally {
      actionLock.current = false;
      setBusy('');
    }
  }

  async function viewVersion(attempt) {
    if (historyBusy) return;
    const request = ++historyRequest.current;
    setHistoryBusy(attempt.id);
    setHistoryError('');
    try {
      const result = await api.getWhiteboardArtifact(workflow.workflow_id, attempt.id);
      if (historyRequest.current === request) setHistoryArtifact({ ...result, number: attempt.number });
    } catch (failure) {
      if (historyRequest.current === request) setHistoryError(failure?.message || '读取版本失败，请稍后重试。');
    } finally {
      if (historyRequest.current === request) setHistoryBusy('');
    }
  }

  return (
    <div className="grid w-full min-w-0 gap-6 min-[1180px]:h-full min-[1180px]:min-h-0 min-[1180px]:grid-rows-[auto_auto_minmax(0,1fr)] max-[760px]:[&_button]:min-h-11">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3"><PenLine size={14} /><span>{workflow.creationModeDisplayNameSnapshot || '线稿白板动画'}</span><span>· {media ? '视频制作' : '内容与制作方案'}</span><span className="rounded border border-line-1 px-1.5 py-0.5">{aspectRatio === '9:16' ? '竖屏 9:16' : '横屏 16:9'}</span></div>
          <h1 className="m-0 break-words text-2xl font-bold leading-snug text-fg-1">{title}</h1>
          <p className="m-0 text-xs text-fg-3">{media ? '完整旁白 · 区域编排 · 连续落墨 · 成片' : '先确认内容，再进入媒体制作'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', workflow.status === 'phase0_complete' ? 'border-success/30 text-success' : ['failed', 'unknown_external_outcome'].includes(workflow.status) ? 'border-danger/25 text-danger' : 'border-line-2 text-fg-2')}>{STATUS_TEXT[workflow.status] || '处理中'}</span>
          <Button variant="ghost" size="icon" type="button" aria-label="停止并删除白板任务" className="max-[760px]:min-w-11" disabled={Boolean(deletingWorkflowId) || Boolean(busy)} onClick={() => onStopAndDelete(workflow.workflow_id)}><Trash2 size={16} /></Button>
        </div>
      </header>

      <ol className={cn('m-0 grid list-none gap-3 p-0', workflow.stages.length <= 3 ? 'grid-cols-3' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4')} aria-label="白板阶段进度">
        {workflow.stages.map((stage, index) => (
          <li key={stage.id} className={cn('grid gap-2 border-t-2 pt-3 text-xs', stage.status === 'done' ? 'border-ink text-fg-1' : stage.status === 'waiting_approval' || stage.status === 'running' ? 'border-ink text-fg-1' : 'border-line-1 text-fg-3')}>
            <span className="flex items-center gap-2 font-semibold">{stage.status === 'done' ? <Check size={14} /> : <span className="font-mono">0{index + 1}</span>}{stage.label}</span>
            <span className="text-fg-3">{STATUS_TEXT[stage.status] || '等待中'}</span>
          </li>
        ))}
      </ol>

      <div className="grid min-w-0 overflow-hidden rounded-lg border border-line-2 bg-surface-1 min-[1180px]:min-h-0 min-[1180px]:grid-cols-[400px_minmax(0,1fr)]" aria-label="白板创作工作区">
        <section className="flex min-h-0 min-w-0 flex-col border-b border-line-2 bg-page min-[1180px]:border-b-0 min-[1180px]:border-r" aria-label="白板创作 Agent">
          <div className="flex h-16 shrink-0 items-center gap-2 border-b border-line-2 px-5">
            <PenLine size={17} /><h2 className="m-0 text-base font-semibold">创作对话</h2><span className="rounded border border-line-2 bg-surface-1 px-1.5 py-0.5 text-xs text-fg-3">Agent</span>
          </div>
          <div ref={conversationRef} onScroll={event => { const element = event.currentTarget; followConversation.current = element.scrollHeight - element.clientHeight - element.scrollTop < 90; }} className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto overscroll-contain p-5 max-[1179px]:max-h-[420px] max-[560px]:p-4" aria-label="创作对话">
            {whiteboard.messages.map(item => (
              <article key={item.id} className={cn('grid min-w-0 gap-2', item.role === 'user' && 'rounded-md border border-line-1 bg-surface-1 p-3')}>
                <div className="text-xs font-semibold text-fg-3">{item.role === 'user' ? '你' : '白板创作 Agent'}</div>
                <p className="m-0 whitespace-pre-wrap break-words text-sm leading-7 text-fg-2">{item.text}</p>
                {item.interactionId && interactions.find(interaction => interaction.id === item.interactionId) ? <WhiteboardConversationCard
                  interaction={interactions.find(interaction => interaction.id === item.interactionId)}
                  active={pendingInteraction?.id === item.interactionId} artifact={artifact} disabled={locked}
                  allowed={allowed} onConfirm={setConfirm} onUpdatePlan={productionPlan => act('update_plan', { productionPlan })} /> : null}
              </article>
            ))}
            {progressEvents.length ? <details className="text-xs text-fg-3"><summary className="cursor-pointer">最近制作进度</summary><ol className="grid gap-2 pl-4">{progressEvents.slice(-8).map((event, index) => <li key={event.seq || index}>{event.message || event.type}</li>)}</ol></details> : null}
          </div>
          <div className="grid shrink-0 gap-3 border-t border-line-2 bg-surface-2 p-4">
            <div className={cn('flex items-start gap-2 text-xs leading-6', needsAttention ? 'text-danger' : 'text-fg-2')} role="status" aria-live="polite">
              {running || busy ? <Loader2 size={15} className="mt-1 shrink-0 animate-spin" /> : null}
              <span>{busy ? ({ approve_initial: '正在确认当前内容与制作方案...', update_plan: '正在保存新的制作方案...', revise: '正在创建修改版本...', retry: '正在重新启动方案任务...', authorize_new_attempt: '正在创建新的模型请求...', start_production: '正在检查环境并启动视频制作...', approve_media: '正在确认当前产物并准备下一步...', retry_media: '正在恢复未完成的媒体制作...', authorize_media_retry: '正在登记授权并继续制作...', revise_media: '正在创建本幕修改版本...', message: '正在处理你的消息...' })[busy] || '正在处理当前操作...' : statusMessage}</span>
            </div>
            {error ? <p className="m-0 text-sm text-danger" role="alert">{error}</p> : null}
            {error || workflow.error ? <Link to="/settings" state={{ from: `/creative/${workflow.workflow_id}` }} className="text-sm font-semibold text-ink underline underline-offset-4">打开模型与声音设置</Link> : null}

            {canMessage || allowed.has('revise_media') ? (
              <form className="grid gap-2" onSubmit={event => { event.preventDefault(); if (revision.trim()) act('message', { message: revision.trim(), ...(allowed.has('revise_media') ? { sceneId: selectedScene } : {}) }); }}>
                {allowed.has('revise_media') ? <LabeledSelect label="需要修改的分镜" value={selectedScene} disabled={locked} onChange={setSceneId} options={artifact.scenes.map((scene, index) => ({ id: scene.id, label: `${index + 1}. ${scene.title}` }))} /> : null}
                <label htmlFor="whiteboard-revision" className="sr-only">与白板创作 Agent 对话</label>
                <Textarea id="whiteboard-revision" value={revision} onChange={event => setRevision(event.target.value)} rows={3} maxLength={6000} disabled={locked} placeholder={media ? '检查产物后，提出本幕修改意见或询问当前安排。' : '提出修改意见，或询问当前方案与分镜安排...'} className="min-h-[88px] resize-none bg-surface-1" />
                <div className="flex items-center justify-between gap-3"><span className="text-xs leading-relaxed text-fg-3">讨论保留当前版本，修改生成新版本。</span><Button type="submit" size="sm" disabled={locked || !revision.trim()}>{busy === 'message' ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}{busy === 'message' ? '发送中...' : '发送'}</Button></div>
              </form>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {allowed.has('approve_initial') && !pendingInteraction ? <Button type="button" disabled={locked} onClick={() => { setError(''); setConfirm('approve_initial'); }}><Check size={15} />确认内容与制作方案</Button> : null}
              {allowed.has('update_plan') && artifact && (!pendingInteraction || media) ? <Button type="button" variant="outline" disabled={locked} onClick={() => { setEditedPlan({ ...artifact.productionPlan }); setPlanOpen(true); setError(''); }}><Settings2 size={14} />制作设置</Button> : null}
              {allowed.has('start_production') ? <Button type="button" disabled={locked} onClick={() => act('start_production')}>开始制作视频</Button> : null}
              {allowed.has('retry_media') ? <Button type="button" disabled={locked} onClick={() => act('retry_media')}>继续未完成的制作</Button> : null}
              {allowed.has('authorize_media_retry') ? <Button type="button" variant="outline" disabled={locked} onClick={() => setConfirm('authorize_media_retry')}>核实后授权新请求</Button> : null}
              {allowed.has('regenerate_narration') ? <Button type="button" variant="outline" disabled={locked} onClick={() => setConfirm('regenerate_narration')}>重新生成完整旁白</Button> : null}
              {allowed.has('retry') ? <Button type="button" disabled={locked} onClick={() => act('retry')}>重新生成方案</Button> : null}
              {allowed.has('authorize_new_attempt') ? <Button type="button" variant="outline" disabled={locked} onClick={() => setConfirm('authorize_new_attempt')}>确认后重新请求</Button> : null}
            </div>
          </div>
        </section>

        <section className="flex min-h-[400px] min-w-0 flex-col bg-surface-1 min-[1180px]:min-h-0" aria-label="当前白板方案">
          <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line-2 px-5 max-[560px]:px-4">
            <div className="flex flex-wrap items-center gap-2"><h2 className="m-0 text-base font-semibold">{current?.stale ? '上一版方案' : media ? '当前制作产物' : '当前方案'}</h2>{activeVersion ? <span className="rounded border border-line-1 px-1.5 py-0.5 font-mono text-xs text-fg-3">v{activeVersion.number}</span> : null}</div>
            <Button variant="ghost" type="button" size="sm" onClick={() => { setHistoryOpen(true); setHistoryArtifact(null); }}><FileClock size={14} />版本记录</Button>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 max-[560px]:p-4', !artifact && !whiteboard.artifactError && 'flex')}>
            {whiteboard.artifactError ? <p className="text-sm text-danger" role="alert">{whiteboard.artifactError}</p> : artifact ? <div className="grid min-w-0 content-start gap-5">
              {current?.stale ? <p className="m-0 text-xs leading-6 text-fg-3">此版本已因修改而失效，保留供对照。新方案需要重新确认。</p> : null}
              {media ? <>
                <WhiteboardMediaPanel media={media} scenes={artifact.scenes} /><details className="border-t border-line-1 pt-3 text-sm"><summary className="mb-4 cursor-pointer text-fg-3">查看已确认内容与制作方案</summary><WhiteboardArtifact artifact={artifact} /></details>
              </> : <WhiteboardArtifact artifact={artifact} />}
            </div> : <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-3 text-center" role="status" aria-live="polite">
              {running ? <Loader2 size={24} className="animate-spin text-fg-3" /> : <FileText size={26} className="text-fg-3" />}
              <h3 className="m-0 text-sm font-semibold text-fg-2">{emptyTitle}</h3>
              <p className="m-0 max-w-[320px] text-sm leading-7 text-fg-3">{needsAttention ? '请在左侧查看原因，并按提示继续处理。' : '方案准备好后，在这里查看旁白正文、分镜与制作设置。'}</p>
            </div>}
          </div>
        </section>
      </div>

      <ConfirmDialog open={Boolean(confirm)} onOpenChange={open => { if (!open) setConfirm(''); }}
        title={confirm === 'approve_initial' ? `确认第 ${activeVersion?.number || 1} 版内容与制作方案` : confirm === 'approve_media' ? pendingInteraction?.title || '确认当前媒体产物' : '同意发起一次新的外部请求'}
        description={confirm === 'approve_initial' ? '请确认已检查当前旁白正文、全部分镜和制作设置。确认后可以开始制作视频，首次语音动作直接生成完整旁白。' : confirm === 'approve_media' ? '请实际检查产物区的完整音频、图像或视频。确认将绑定当前版本，并进入下一步制作。' : '上次请求是否已经完成或计费尚不确定。再次请求可能产生重复费用；新请求将保留原版本及记录。'}
        confirmText={confirm === 'approve_initial' ? '确认当前方案' : confirm === 'approve_media' ? '确认当前产物' : '同意新请求与可能的重复费用'} loading={Boolean(busy)}
        onConfirm={() => act(confirm, { confirmed: true })}>
        {error ? <p className="m-0 text-sm text-danger" role="alert">{error}</p> : null}
      </ConfirmDialog>

      <Dialog open={planOpen} onOpenChange={open => { if (!busy) setPlanOpen(open); }}>
        <DialogContent className="w-[min(480px,calc(100vw-32px))] max-[760px]:[&_button]:min-h-11" showCloseButton={!busy}>
          <DialogHeader><DialogTitle>调整制作方案</DialogTitle><DialogDescription>保留旁白和分镜，生成新的待确认版本。</DialogDescription></DialogHeader>
          {editedPlan ? <ProductionPlanFields value={editedPlan} onChange={setEditedPlan} disabled={locked} /> : null}
          {error ? <p className="m-0 text-sm text-danger" role="alert">{error}</p> : null}
          <Button type="button" disabled={locked} onClick={() => act('update_plan', { productionPlan: editedPlan })}>{busy ? <Loader2 size={15} className="animate-spin" /> : null}{busy ? '正在保存制作方案...' : '保存为新的待确认版本'}</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[85vh] w-[min(760px,calc(100vw-32px))] max-w-none overflow-auto max-[760px]:[&_button]:min-h-11" showCloseButton>
          <DialogHeader><DialogTitle>{historyArtifact ? `第 ${historyArtifact.number} 版方案` : '方案版本记录'}</DialogTitle><DialogDescription>{historyArtifact ? (historyArtifact.current ? '这是当前方案，批准操作请返回任务页完成。' : '历史方案仅供查看，不能作为当前版本批准。') : '每次修改单独保存；历史版本不会覆盖当前方案。'}</DialogDescription></DialogHeader>
          {historyArtifact ? <><Button variant="ghost" className="justify-self-start" onClick={() => setHistoryArtifact(null)}>返回版本记录</Button><WhiteboardArtifact artifact={historyArtifact.artifact} /></> : (
            <div className="divide-y divide-line-1">
              {[...attempts].reverse().map(attempt => <div key={attempt.id} className="flex items-center justify-between gap-3 py-3"><div className="grid gap-1"><span className="text-sm font-semibold">第 {attempt.number} 版{current?.attemptId === attempt.id && !current.stale ? ' · 当前版本' : ''}</span><span className="text-xs text-fg-3">{({ prepared: '等待执行', preparing: '准备中', requesting: '请求模型中', validated: '方案已校验', failed: '生成失败', unknown_external_outcome: '外部结果待核实' })[attempt.status] || '处理中'}{attempt.stale ? ' · 已失效' : ''}</span></div><Button size="sm" variant="outline" disabled={!attempt.binding || Boolean(historyBusy)} onClick={() => viewVersion(attempt)}>{historyBusy === attempt.id ? '正在读取...' : '查看方案'}</Button></div>)}
            </div>
          )}
          {historyError ? <p className="text-sm text-danger" role="alert">{historyError}</p> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
