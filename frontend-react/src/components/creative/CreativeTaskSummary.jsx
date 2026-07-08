import { useState } from 'react';
import { Check, Copy, Eye, FileText, Loader2, PencilLine, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.jsx';
import { cn } from '@/lib/utils.js';
import { getStatusClass, getWorkflowStatusText } from './creativeDisplay.js';
import { formatWorkflowDurationLabel } from './creativeProgress.js';
import { buildWorkflowErrorLog } from './creativeErrorLog.js';
import { CreativeTitlePanel } from './CreativeTitlePanel.jsx';
import { SourceImageAssetsPanel } from './SourceImageAssetsPanel.jsx';

const STATUS_CHIP_CLASS = {
  done: 'bg-green-50 text-green-700 ring-green-200',
  pending: 'bg-slate-100 text-slate-700 ring-slate-200',
  failed: 'bg-red-50 text-red-700 ring-red-200',
  '': 'bg-slate-100 text-slate-600 ring-slate-200',
};

export function CreativeTaskSummary({
  status,
  message,
  workflowId,
  workflow,
  deletingWorkflowId,
  retryPlan,
  retryPlanStatus,
  retryPlanMessage,
  onStopAndDelete,
  onContinueEdit,
}) {
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [promptCopyStatus, setPromptCopyStatus] = useState('idle');
  const [errorLogCopyStatus, setErrorLogCopyStatus] = useState('idle');

  const canStopAndDelete = workflowId && workflow?.status !== 'done';
  const promptInput = workflow?.creative_context?.input || {};
  const promptText = (promptInput.raw_text || promptInput.douyin_url || promptInput.source_url || promptInput.aweme_id || '').trim();
  const editableWorkflowId = workflowId || workflow?.workflow_id || workflow?.id || '';
  const isDone = workflow?.status === 'done';
  const durationLabel = formatWorkflowDurationLabel(workflow);
  const errorLogText = buildWorkflowErrorLog({
    workflowId: editableWorkflowId,
    workflow,
    retryPlan,
    retryPlanStatus,
    retryPlanMessage,
    status,
    message,
  });

  async function copyPrompt() {
    if (!promptText) return;
    try {
      await navigator.clipboard.writeText(promptText);
      setPromptCopyStatus('copied');
    } catch {
      setPromptCopyStatus('failed');
    }
    setTimeout(() => setPromptCopyStatus('idle'), 2000);
  }

  async function copyErrorLog() {
    if (!errorLogText) return;
    try {
      await navigator.clipboard.writeText(errorLogText);
      setErrorLogCopyStatus('copied');
    } catch {
      setErrorLogCopyStatus('failed');
    }
    setTimeout(() => setErrorLogCopyStatus('idle'), 2000);
  }

  function continueEdit() {
    onContinueEdit?.(editableWorkflowId);
  }

  const statusClass = getStatusClass(workflow?.status);

  return (
    <section className="grid gap-4 rounded-lg border border-[#e7e9ee] bg-white p-4" aria-label="任务摘要">
      <div className="flex min-w-0 items-start justify-between gap-4 max-[720px]:flex-col">
        <div className="grid min-w-0 gap-1">
          <span className="text-xs font-bold text-[#8a93a2]">任务 ID</span>
          <strong className="min-w-0 break-words font-mono text-base leading-snug text-[#111827]">{workflowId || '尚未创建'}</strong>
        </div>
        <div className="inline-flex shrink-0 flex-wrap items-center justify-end gap-2 max-[720px]:justify-start">
          {durationLabel ? (
            <span className="rounded-full bg-[#f8fafc] px-3 py-1 text-xs font-bold text-[#4b5563] ring-1 ring-[#e7e9ee]">
              {durationLabel}
            </span>
          ) : null}
          <strong className={cn('rounded-full px-3 py-1 text-xs font-bold ring-1', STATUS_CHIP_CLASS[statusClass])}>
            {getWorkflowStatusText(workflow, status)}
          </strong>
          {isDone ? (
            <Button
              type="button"
              size="sm"
              className="min-h-[30px] flex-none gap-1.5 rounded-lg bg-[#111827] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#020617]"
              disabled={!editableWorkflowId}
              title={editableWorkflowId ? '二次编辑视频' : '缺少创作任务 ID，无法进入编辑器。'}
              onClick={continueEdit}
            >
              <PencilLine size={14} />
              <span>二次编辑</span>
            </Button>
          ) : null}
          <Dialog open={promptModalOpen} onOpenChange={setPromptModalOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" size="sm" type="button" className="min-h-[30px] flex-none gap-1.5 rounded-lg border border-line-2 bg-white px-2.5 py-1.5 text-xs font-bold text-fg-2 hover:bg-surface-2 hover:text-fg-1">
                <Eye size={14} />
                <span>查看提示词</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="grid max-h-[min(82vh,640px)] w-[min(92vw,680px)] max-w-[680px] grid-rows-[auto_1fr] overflow-hidden rounded-[14px] border border-[#e5e7eb] bg-white shadow-[0_24px_70px_rgba(15,23,42,.24)]" showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>当前任务提示词</DialogTitle>
              </DialogHeader>
              <DialogClose asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  className="absolute right-4 top-4"
                  aria-label="关闭提示词弹框"
                >
                  <X size={16} />
                  <span className="sr-only">关闭提示词弹框</span>
                </Button>
              </DialogClose>
              <pre className="m-0 overflow-auto whitespace-pre-wrap break-words bg-[#f8fafc] p-[18px] text-sm leading-[1.7] text-[#111827] [font-family:inherit]">{promptText || '暂无可显示的提示词。'}</pre>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={copyPrompt}
                disabled={!promptText}
              >
                {promptCopyStatus === 'copied' ? <Check size={14} /> : <Copy size={14} />}
                <span>{promptCopyStatus === 'copied' ? '已复制' : promptCopyStatus === 'failed' ? '复制失败' : '复制提示词'}</span>
              </Button>
            </DialogContent>
          </Dialog>
          {workflow?.status === 'failed' ? (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary" size="sm" type="button" className="min-h-[30px] flex-none gap-1.5 rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-700 hover:border-red-200 hover:bg-red-100">
                  <FileText size={14} />
                  <span>查看错误日志</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="grid max-h-[min(86vh,720px)] w-[min(92vw,820px)] max-w-[820px] grid-rows-[auto_1fr_auto] overflow-hidden rounded-[14px] border border-[#e5e7eb] bg-white shadow-[0_24px_70px_rgba(15,23,42,.24)]" showCloseButton={false}>
                <DialogHeader>
                  <DialogTitle>当前任务错误日志</DialogTitle>
                  <DialogDescription>用于排查无法恢复的创作失败，可复制后发送给开发者。</DialogDescription>
                </DialogHeader>
                <DialogClose asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    className="absolute right-4 top-4"
                    aria-label="关闭错误日志弹框"
                  >
                    <X size={16} />
                    <span className="sr-only">关闭错误日志弹框</span>
                  </Button>
                </DialogClose>
                <pre className="m-0 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#0f172a] p-[18px] font-mono text-xs leading-[1.65] text-[#e5e7eb]">{errorLogText}</pre>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={copyErrorLog}
                >
                  {errorLogCopyStatus === 'copied' ? <Check size={14} /> : <Copy size={14} />}
                  <span>{errorLogCopyStatus === 'copied' ? '已复制' : errorLogCopyStatus === 'failed' ? '复制失败' : '复制错误日志'}</span>
                </Button>
              </DialogContent>
            </Dialog>
          ) : null}
          {canStopAndDelete ? (
            <Button
              variant="destructive"
              size="sm"
              type="button"
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deletingWorkflowId === workflowId}
              onClick={() => onStopAndDelete(workflowId)}
            >
              {deletingWorkflowId === workflowId ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              <span>{deletingWorkflowId === workflowId ? '正在删除' : '停止并删除'}</span>
            </Button>
          ) : null}
        </div>
      </div>
      <CreativeTitlePanel workflow={workflow} />
      {isDone ? <SourceImageAssetsPanel workflow={workflow} compact /> : null}
    </section>
  );
}
