import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, Check, FileClock, FileText, ListOrdered, Loader2, PenLine, Settings2, Trash2 } from 'lucide-react';
import { api } from '@/api/client.js';
import { Button } from '@/components/ui/button.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { ConfirmDialog } from '@/components/ui/confirm-dialog.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog.jsx';
import { Message, MessageContent, MessageHeader } from '@/components/ui/message.jsx';
import { Bubble, BubbleContent } from '@/components/ui/bubble.jsx';
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent,
  MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport,
} from '@/components/ui/message-scroller.jsx';
import { cn } from '@/lib/utils.js';
import { STATUS_TEXT } from '../creativeDisplay.js';
import { ProductionPlanFields } from './WhiteboardInputFields.jsx';
import { WhiteboardArtifact } from './WhiteboardArtifact.jsx';
import { WhiteboardConversationCard } from './WhiteboardConversationCard.jsx';
import { WhiteboardMediaPanel } from './WhiteboardMediaPanel.jsx';
import { WhiteboardCoverageReview } from './WhiteboardCoverageReview.jsx';
import { whiteboardCanvasLabel } from './whiteboardForm.js';

export function WhiteboardTaskDetail({ workflow, message, deletingWorkflowId, onAction, onStopAndDelete, progressEvents = [] }) {
  const [revision, setRevision] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');
  const [coverageReview, setCoverageReview] = useState(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [editedPlan, setEditedPlan] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySource, setHistorySource] = useState('history');
  const [historyArtifact, setHistoryArtifact] = useState(null);
  const [historyBusy, setHistoryBusy] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [progressOpen, setProgressOpen] = useState(false);
  const [streamReply, setStreamReply] = useState({ phase: '', text: '' });
  const actionLock = useRef(false);
  const historyRequest = useRef(0);
  const historyTrigger = useRef(null);
  const progressTrigger = useRef(null);
  const whiteboard = workflow.whiteboard;
  const media = whiteboard.media && !whiteboard.media.stale ? whiteboard.media : null;
  const interactions = whiteboard.interactions || [];
  const pendingInteraction = interactions.findLast(item => item.status === 'pending');
  const current = whiteboard.current;
  const attempts = whiteboard.attempts || [];
  const activeVersion = attempts.find(attempt => attempt.id === current?.attemptId);
  const artifact = current?.artifact;
  const silent = artifact?.productionPlan?.narrationMode === 'disabled';
  const aspectRatio = artifact?.aspectRatio || workflow.input?.aspectRatio || '16:9';
  const allowed = new Set((whiteboard.allowedActions || []).map(action => action.id));
  const running = ['queued', 'running'].includes(workflow.status);
  const locked = running || Boolean(busy) || Boolean(deletingWorkflowId);
  const latest = attempts.at(-1);
  const title = artifact?.title || workflow.title || '白板创作';
  const statusMessage = whiteboard.artifactError || workflow.current_stage_message || workflow.message || message;
  const canMessage = Boolean(artifact) && !['unknown_external_outcome', 'failed'].includes(workflow.status);
  const needsAttention = Boolean(whiteboard.artifactError) || ['failed', 'unknown_external_outcome'].includes(workflow.status);
  const emptyTitle = running ? '正在整理正文与分镜' : workflow.status === 'unknown_external_outcome' ? '方案结果待核实' : workflow.status === 'failed' ? '方案生成未完成' : '等待生成方案';
  const recentProgress = progressEvents.slice(-8);
  const viewedPlanIsCurrent = Boolean(historyArtifact) && !current?.stale
    && historyArtifact.attemptId === current?.attemptId && historyArtifact.identity === current?.identity;
  const viewedPlanIsApproved = viewedPlanIsCurrent && Boolean(whiteboard.initialApproval)
    && !whiteboard.initialApproval.stale && whiteboard.initialApproval.identity === historyArtifact.identity;

  useEffect(() => () => { historyRequest.current += 1; }, []);

  function sendAction(action, extras = {}, handlers = {}) {
    return onAction({ action, expectedIdentity: current?.identity || '', expectedAttemptId: latest?.id,
      expectedMediaIdentity: media?.identity, interactionId: pendingInteraction?.id,
      requestId: crypto.randomUUID(), ...extras }, handlers);
  }

  function openCoverageReview() {
    if (locked || !allowed.has('accept_low_coverage')) return;
    // 弹窗和确认请求使用同一份版本快照，后台更新不能悄悄换掉用户正在检查的图。
    setCoverageReview(structuredClone({ identity: media.identity, recipe: media.recipe,
      lowCoverage: media.lowCoverage, artifacts: media.artifacts,
      planIdentity: current.identity, planAttemptId: latest.id, interactionId: media.interactionId }));
    setError('');
    setConfirm('accept_low_coverage');
  }

  async function act(action, extras = {}) {
    if (actionLock.current || locked || (!allowed.has(action) && !(action === 'message' && canMessage))) return;
    actionLock.current = true;
    setBusy(action);
    setError('');
    if (action === 'message') setStreamReply({ phase: 'intent', text: '' });
    try {
      await sendAction(action, extras, action === 'message' ? {
        onEvent: event => {
          if (event.type === 'chat_intent') setStreamReply({ phase: event.action, text: '' });
          if (event.type === 'chat_message_delta') setStreamReply(prev => ({ phase: 'answer', text: prev.text + (event.delta || '') }));
        },
      } : undefined);
      if (['revise', 'revise_media', 'message'].includes(action)) setRevision('');
      setConfirm('');
      setPlanOpen(false);
    } catch (failure) {
      setError(failure?.data?.message || failure?.message || '操作失败，请刷新当前任务后重试。');
    } finally {
      actionLock.current = false;
      setBusy('');
      setStreamReply({ phase: '', text: '' });
    }
  }

  // 方案确认与开始制作在服务端仍是两个动作：先 approve_initial 冻结方案，再 start_production 触发执行，
  // 这里合并为一次点击；制作启动失败时方案保持已确认状态，可稍后用“开始制作视频”重试。
  async function approveInitial({ startProduction }) {
    if (actionLock.current || locked) return;
    actionLock.current = true;
    setBusy('approve_initial');
    setError('');
    try {
      await sendAction('approve_initial', { confirmed: true });
      setConfirm('');
      if (startProduction) {
        setBusy('start_production');
        await sendAction('start_production', { interactionId: undefined, expectedMediaIdentity: undefined });
      }
    } catch (failure) {
      setError(failure?.data?.message || failure?.message || '操作失败，请刷新当前任务后重试。');
    } finally {
      actionLock.current = false;
      setBusy('');
    }
  }

  function openPlanViewer(source, trigger) {
    historyRequest.current += 1;
    historyTrigger.current = trigger;
    setHistorySource(source);
    setHistoryBusy('');
    setHistoryError('');
    setHistoryArtifact(source === 'current' ? structuredClone({
      artifact, number: activeVersion?.number || 1, attemptId: current.attemptId, identity: current.identity,
    }) : null);
    setHistoryOpen(true);
  }

  function changeHistoryOpen(open) {
    if (!open) {
      historyRequest.current += 1;
      setHistoryBusy('');
    }
    setHistoryOpen(open);
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
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3"><PenLine size={14} /><span>{workflow.creationModeDisplayNameSnapshot || '线稿白板动画'}</span><span>· {media ? '视频制作' : '内容与制作方案'}</span><span className="rounded border border-line-1 px-1.5 py-0.5">{whiteboardCanvasLabel(aspectRatio)}</span></div>
          <h1 className="m-0 break-words text-2xl font-bold leading-snug text-fg-1">{title}</h1>
          <p className="m-0 text-xs text-fg-3">{media ? (silent ? '字幕与时间轴 · 区域编排 · 连续落墨 · 成片' : '完整旁白 · 区域编排 · 连续落墨 · 成片') : '先确认内容，再进入媒体制作'}</p>
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
          <MessageScrollerProvider>
            <MessageScroller className="min-h-0 flex-1 max-[1179px]:max-h-[420px]">
            <MessageScrollerViewport className="p-5 max-[560px]:p-4">
              <MessageScrollerContent className="gap-5">
                {whiteboard.messages.map(item => (
                  <MessageScrollerItem key={item.id}>
                    <Message align={item.role === 'user' ? 'end' : 'start'}>
                      <MessageContent>
                        <MessageHeader className="px-0 text-fg-3">{item.role === 'user' ? '你' : '白板创作 Agent'}</MessageHeader>
                        <Bubble variant={item.role === 'user' ? 'outline' : 'ghost'} className={item.role === 'user' ? 'border-line-1 bg-surface-1' : undefined}>
                          <BubbleContent className="max-w-full whitespace-pre-wrap break-words text-sm leading-7 text-fg-2">{item.text}</BubbleContent>
                        </Bubble>
                        {item.interactionId && interactions.find(interaction => interaction.id === item.interactionId) ? <WhiteboardConversationCard
                          interaction={interactions.find(interaction => interaction.id === item.interactionId)}
                          active={pendingInteraction?.id === item.interactionId} artifact={artifact} disabled={locked}
                          allowed={allowed} onConfirm={confirmId => { if (confirmId === 'accept_low_coverage') openCoverageReview(); else { setError(''); setConfirm(confirmId); } }} onUpdatePlan={productionPlan => act('update_plan', { productionPlan })} /> : null}
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                ))}
                {busy === 'message' ? (
                  <MessageScrollerItem>
                    <Message>
                      <MessageContent>
                        <MessageHeader className="px-0 text-fg-3">白板创作 Agent</MessageHeader>
                        <Bubble>
                          <BubbleContent className="max-w-full whitespace-pre-wrap break-words text-sm leading-7 text-fg-2">
                            {streamReply.text || (streamReply.phase === 'revise_scenes' ? '已识别修改意图，正在创建幕修改版本...' : streamReply.phase === 'revise_plan' ? '已识别方案修改意图，正在创建新版本...' : '正在理解你的消息...')}
                            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-fg-3 align-middle" aria-hidden />
                          </BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                ) : null}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton direction="end" variant="outline" />
            </MessageScroller>
          </MessageScrollerProvider>
          <div className="grid shrink-0 gap-3 border-t border-line-2 bg-surface-2 p-4">
            <div className={cn('flex items-start gap-2 text-xs leading-6', needsAttention ? 'text-danger' : 'text-fg-2')} role="status" aria-live="polite">
              {running || busy ? <Loader2 size={15} className="mt-1 shrink-0 animate-spin" /> : null}
              <span>{busy ? ({ approve_initial: '正在确认当前内容与制作方案...', update_plan: '正在保存新的制作方案...', revise: '正在创建修改版本...', retry: '正在重新启动方案任务...', authorize_new_attempt: '正在创建新的模型请求...', start_production: '正在检查环境并启动视频制作...', approve_media: '正在确认当前产物并准备下一步...', retry_media: '正在恢复未完成的媒体制作...', recover_annotation_preview: '正在使用已保存的编排恢复落墨预览...', accept_low_coverage: '正在接受当前落墨并继续制作...', authorize_media_retry: '正在登记授权并继续制作...', revise_media: '正在创建本幕修改版本...', message: '正在理解并处理你的消息...' })[busy] || '正在处理当前操作...' : statusMessage}</span>
            </div>
            {error ? <p className="m-0 text-sm text-danger" role="alert">{error}</p> : null}
            {error || workflow.error ? <Link to="/settings" state={{ from: `/creative/${workflow.workflow_id}` }} className="text-sm font-semibold text-ink underline underline-offset-4">打开模型与声音设置</Link> : null}

            {canMessage ? (
              <form className="grid gap-2" onSubmit={event => { event.preventDefault(); if (revision.trim()) act('message', { message: revision.trim() }); }}>
                <label htmlFor="whiteboard-revision" className="sr-only">与白板创作 Agent 对话</label>
                <Textarea id="whiteboard-revision" value={revision} onChange={event => setRevision(event.target.value)} rows={3} maxLength={6000} disabled={locked} placeholder={media ? '用自然语言描述，例如：1、2、6、7生成的图片为什么有手机边框？重新生成' : '用自然语言提出修改意见，或询问当前方案与分镜安排...'} className="min-h-[88px] resize-none bg-surface-1" />
                <div className="flex items-center justify-between gap-3"><span className="text-xs leading-relaxed text-fg-3">直接描述要改哪些幕、怎么改，Agent 会理解并执行；讨论保留当前版本。</span><Button type="submit" size="sm" disabled={locked || !revision.trim()}>{busy === 'message' ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}{busy === 'message' ? '发送中...' : '发送'}</Button></div>
              </form>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {allowed.has('approve_initial') && !pendingInteraction ? <Button type="button" disabled={locked} onClick={() => { setError(''); setConfirm('approve_initial'); }}><Check size={15} />确认内容与制作方案</Button> : null}
              {allowed.has('update_plan') && artifact && (!pendingInteraction || media) ? <Button type="button" variant="outline" disabled={locked} onClick={() => { setEditedPlan({ ...artifact.productionPlan }); setPlanOpen(true); setError(''); }}><Settings2 size={14} />制作设置</Button> : null}
              {allowed.has('start_production') ? <Button type="button" disabled={locked} onClick={() => act('start_production')}>开始制作视频</Button> : null}
              {allowed.has('recover_annotation_preview') ? <Button type="button" disabled={locked} onClick={() => act('recover_annotation_preview')}>恢复落墨预览</Button> : null}
              {allowed.has('retry_media') ? <Button type="button" variant={allowed.has('accept_low_coverage') ? 'outline' : 'default'} disabled={locked} onClick={() => act('retry_media')}>{allowed.has('accept_low_coverage') ? '重新编排未通过的幕' : '继续未完成的制作'}</Button> : null}
              {allowed.has('accept_low_coverage') ? <Button type="button" variant="outline" disabled={locked} onClick={openCoverageReview}>查看预览后接受当前落墨</Button> : null}
              {allowed.has('authorize_media_retry') ? <Button type="button" variant="outline" disabled={locked} onClick={() => setConfirm('authorize_media_retry')}>核实后授权新请求</Button> : null}
              {allowed.has('regenerate_narration') ? <Button type="button" variant="outline" disabled={locked} onClick={() => setConfirm('regenerate_narration')}>重新生成完整旁白</Button> : null}
              {allowed.has('retry') ? <Button type="button" disabled={locked} onClick={() => act('retry')}>重新生成方案</Button> : null}
              {allowed.has('authorize_new_attempt') ? <Button type="button" variant="outline" disabled={locked} onClick={() => setConfirm('authorize_new_attempt')}>确认后重新请求</Button> : null}
            </div>
          </div>
        </section>

        <section className="flex min-h-[400px] min-w-0 flex-col bg-surface-1 min-[1180px]:min-h-0" aria-label="当前白板方案">
          <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line-2 px-5 py-3 max-[560px]:px-4">
            <div className="flex flex-wrap items-center gap-2"><h2 className="m-0 text-base font-semibold">{current?.stale ? '上一版方案' : media ? '当前制作产物' : '当前方案'}</h2>{activeVersion ? <span className="rounded border border-line-1 px-1.5 py-0.5 font-mono text-xs text-fg-3">v{activeVersion.number}</span> : null}</div>
            <div className="flex flex-wrap items-center gap-1" aria-label="方案与制作记录">
              {media && artifact ? <Button variant="ghost" type="button" size="sm" onClick={event => openPlanViewer('current', event.currentTarget)}><FileText size={14} />查看方案</Button> : null}
              <Button variant="ghost" type="button" size="sm" onClick={event => openPlanViewer('history', event.currentTarget)}><FileClock size={14} />版本记录</Button>
              <Button ref={progressTrigger} variant="ghost" type="button" size="sm" onClick={() => setProgressOpen(true)}><ListOrdered size={14} />制作记录</Button>
            </div>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 max-[560px]:p-4', !artifact && !whiteboard.artifactError && 'flex')}>
            {whiteboard.artifactError ? <p className="text-sm text-danger" role="alert">{whiteboard.artifactError}</p> : artifact ? <div className="grid min-w-0 content-start gap-5">
              {current?.stale ? <p className="m-0 text-xs leading-6 text-fg-3">此版本已因修改而失效，保留供对照。新方案需要重新确认。</p> : null}
              {media ? <WhiteboardMediaPanel media={media} scenes={artifact.scenes} onReviewLowCoverage={allowed.has('accept_low_coverage') ? openCoverageReview : undefined}
                onRecoverAnnotationPreview={allowed.has('recover_annotation_preview') ? sceneId => act('recover_annotation_preview', { sceneId }) : undefined}
                recoveringPreview={busy === 'recover_annotation_preview'} actionsDisabled={locked} /> : <WhiteboardArtifact artifact={artifact} />}
            </div> : <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-3 text-center" role="status" aria-live="polite">
              {running ? <Loader2 size={24} className="animate-spin text-fg-3" /> : <FileText size={26} className="text-fg-3" />}
              <h3 className="m-0 text-sm font-semibold text-fg-2">{emptyTitle}</h3>
              <p className="m-0 max-w-[320px] text-sm leading-7 text-fg-3">{needsAttention ? '请在左侧查看原因，并按提示继续处理。' : '方案准备好后，在这里查看正文、分镜与制作设置。'}</p>
            </div>}
          </div>
        </section>
      </div>

      <Dialog open={confirm === 'approve_initial'} onOpenChange={open => { if (!open && !busy) setConfirm(''); }}>
        <DialogContent className="w-[min(480px,calc(100vw-32px))]" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>确认第 {activeVersion?.number || 1} 版内容与制作方案</DialogTitle>
            <DialogDescription>{silent ? '请确认已检查当前字幕正文、全部分镜时长和制作设置。确认后按当前时间轴开始制作视频，将发起图像生成与视觉分析请求；也可以仅确认方案，稍后再开始制作。' : '请确认已检查当前旁白正文、全部分镜和制作设置。确认后立即开始制作视频，将发起语音与图像生成的外部请求；也可以仅确认方案，稍后再开始制作。'}</DialogDescription>
          </DialogHeader>
          {error ? <p className="m-0 text-sm text-danger" role="alert">{error}</p> : null}
          <div className="grid gap-2">
            <Button type="button" disabled={locked} onClick={() => approveInitial({ startProduction: true })}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {busy === 'approve_initial' ? '正在确认方案...' : busy === 'start_production' ? '正在启动制作...' : '确认并开始制作视频'}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" disabled={locked} onClick={() => approveInitial({ startProduction: false })}>仅确认，稍后制作</Button>
              <Button type="button" variant="ghost" disabled={locked} onClick={() => setConfirm('')}>取消</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {confirm === 'accept_low_coverage' && coverageReview ? <WhiteboardCoverageReview review={coverageReview} scenes={artifact?.scenes}
        current={coverageReview.identity === media?.identity && allowed.has('accept_low_coverage')}
        busy={busy} error={error} onClose={() => setConfirm('')}
        onAccept={() => act('accept_low_coverage', { confirmed: true, expectedMediaIdentity: coverageReview.identity,
          expectedIdentity: coverageReview.planIdentity, expectedAttemptId: coverageReview.planAttemptId, interactionId: coverageReview.interactionId })}
        onRetry={() => act('retry_media', { expectedMediaIdentity: coverageReview.identity,
          expectedIdentity: coverageReview.planIdentity, expectedAttemptId: coverageReview.planAttemptId, interactionId: coverageReview.interactionId })} /> : null}

      <ConfirmDialog open={Boolean(confirm) && !['approve_initial', 'accept_low_coverage'].includes(confirm)} onOpenChange={open => { if (!open) setConfirm(''); }}
        title={confirm === 'approve_media' ? pendingInteraction?.title || '确认当前媒体产物' : '同意发起一次新的外部请求'}
        description={confirm === 'approve_media' ? (silent ? '请检查产物区的字幕、分镜时长、图像或视频。确认将绑定当前版本，并进入下一步制作。' : '请实际检查产物区的完整音频、图像或视频。确认将绑定当前版本，并进入下一步制作。')
          : '上次请求是否已经完成或计费尚不确定。再次请求可能产生重复费用；新请求将保留原版本及记录。'}
        confirmText={confirm === 'approve_media' ? '确认当前产物' : '同意新请求与可能的重复费用'} loading={Boolean(busy)}
        onConfirm={() => act(confirm, { confirmed: true })}>
        {error ? <p className="m-0 text-sm text-danger" role="alert">{error}</p> : null}
      </ConfirmDialog>

      <Dialog open={planOpen} onOpenChange={open => { if (!busy) setPlanOpen(open); }}>
        <DialogContent className="max-h-[calc(100dvh-32px)] w-[min(480px,calc(100vw-32px))] overflow-y-auto max-[760px]:[&_button]:min-h-11" showCloseButton={!busy}>
          <DialogHeader><DialogTitle>调整制作方案</DialogTitle><DialogDescription>保留正文和分镜，生成新的待确认版本。</DialogDescription></DialogHeader>
          {editedPlan ? <ProductionPlanFields value={editedPlan} onChange={setEditedPlan} disabled={locked} /> : null}
          {error ? <p className="m-0 text-sm text-danger" role="alert">{error}</p> : null}
          <Button type="button" disabled={locked} onClick={() => act('update_plan', { productionPlan: editedPlan })}>{busy ? <Loader2 size={15} className="animate-spin" /> : null}{busy ? '正在保存制作方案...' : '保存为新的待确认版本'}</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={changeHistoryOpen}>
        <DialogContent className="flex max-h-[85dvh] w-[min(760px,calc(100vw-32px))] max-w-none flex-col overflow-hidden sm:max-w-none max-[760px]:[&_button]:min-h-11" showCloseButton
          onCloseAutoFocus={event => { event.preventDefault(); historyTrigger.current?.focus(); }}>
          <DialogHeader className="shrink-0 pr-6 text-left">
            <DialogTitle>{historyArtifact ? `第 ${historyArtifact.number} 版方案${viewedPlanIsApproved ? ' · 已确认' : ''}` : '方案版本记录'}</DialogTitle>
            <DialogDescription>{historyArtifact ? (viewedPlanIsApproved ? '这是当前制作使用的已确认内容与制作方案。' : viewedPlanIsCurrent ? '这是当前方案，确认操作请返回任务页完成。' : '历史方案仅供查看，不能作为当前版本批准。') : '每次修改单独保存；历史版本不会覆盖当前方案。'}</DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain">
            {historyArtifact ? <>
              {historySource === 'history' ? <Button variant="ghost" className="justify-self-start" onClick={() => setHistoryArtifact(null)}>返回版本记录</Button> : null}
              <WhiteboardArtifact artifact={historyArtifact.artifact} />
            </> : (
              <div className="divide-y divide-line-1">
                {[...attempts].reverse().map(attempt => <div key={attempt.id} className="flex items-center justify-between gap-3 py-3"><div className="grid gap-1"><span className="text-sm font-semibold">第 {attempt.number} 版{current?.attemptId === attempt.id && !current.stale ? ' · 当前版本' : ''}</span><span className="text-xs text-fg-3">{({ prepared: '等待执行', preparing: '准备中', requesting: '请求模型中', validated: '方案已校验', failed: '生成失败', unknown_external_outcome: '外部结果待核实' })[attempt.status] || '处理中'}{attempt.stale ? ' · 已失效' : ''}</span></div><Button size="sm" variant="outline" disabled={!attempt.binding || Boolean(historyBusy)} onClick={() => viewVersion(attempt)}>{historyBusy === attempt.id ? '正在读取...' : '查看方案'}</Button></div>)}
              </div>
            )}
            {historyError ? <p className="text-sm text-danger" role="alert">{historyError}</p> : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={progressOpen} onOpenChange={setProgressOpen}>
        <DialogContent className="flex max-h-[85dvh] w-[min(640px,calc(100vw-32px))] max-w-none flex-col overflow-hidden sm:max-w-none max-[760px]:[&_button]:min-h-11" showCloseButton
          onCloseAutoFocus={event => { event.preventDefault(); progressTrigger.current?.focus(); }}>
          <DialogHeader className="shrink-0 pr-6 text-left">
            <DialogTitle>最近制作记录</DialogTitle>
            <DialogDescription>显示当前任务最近 8 条制作事件，制作期间会自动更新。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain" role="log" aria-label="最近制作记录" aria-live="polite">
            {recentProgress.length ? <ol className="m-0 list-none divide-y divide-line-1 p-0">
              {recentProgress.map((event, index) => <li key={event.seq || index} className="whitespace-pre-wrap break-words py-3 text-sm leading-7 text-fg-2">{event.message || '制作状态已更新。'}</li>)}
            </ol> : <p className="m-0 py-8 text-center text-sm leading-7 text-fg-3">暂无最近制作记录。制作过程中收到的进度会显示在这里。</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
