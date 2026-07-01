import { useState } from 'react';
import { Check, Copy, Eye, Loader2, RefreshCcw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.jsx';
import { cn } from '@/lib/utils.js';
import { getStatusClass, getWorkflowStatusText } from './creativeDisplay.js';
import { CreativeProgressPanel } from './CreativeProgressPanel.jsx';
import { CreativeStatusMessage } from './CreativeStatusMessage.jsx';
import { CreativeVideoPreview } from './CreativeVideoPreview.jsx';
import { CreativeWorkflowStepper } from './CreativeWorkflowStepper.jsx';

const RETRY_ACTION_TEXT = {
  retry_frame_html: '只重试失败帧，复用已生成内容',
  retry_content_graph: '重新生成内容图并继续后续步骤',
  fallback_scene_spec_graph: '使用脚本结构恢复内容图并继续生成',
  repair_timeline: '修复时间轴后重新渲染',
  repair_script_and_timeline: '压缩旁白并重新生成音频与时间轴',
  rerender_frames: '只重渲染失败镜头',
  recompose: '重新合成成片',
  rerun_visual_inspect: '重新执行视觉巡检',
  restart_project: '从工程阶段重新开始',
};

const RETRY_STAGE_TEXT = {
  source: '素材解析',
  research: '资料检索',
  agent_run: '脚本生成',
  brief: '视频脚本',
  audio: '旁白音频',
  content_graph: '内容图',
  frame_html: '镜头 HTML',
  scene_spec: '分镜脚本',
  timeline: '时间轴',
  render: '镜头渲染',
  render_outputs: '渲染输出',
  compose: '成片合成',
  exports: '成片文件',
  duration_verify: '时长校验',
  visual_inspect: '视觉巡检',
  html_video_project: '视频工程',
  project: '视频工程',
};

const RETRY_CODE_TEXT = {
  provider_missing_text: '模型返回内容为空',
  content_graph_invalid: '内容图格式异常',
  frame_html_invalid: '镜头 HTML 生成异常',
  html_document_extract_failed: '镜头 HTML 文档提取失败',
  html_validation_failed: '镜头 HTML 校验失败',
  timeline_duration_unreasonable: '时间轴时长异常',
  render_failed: '镜头渲染失败',
  compose_failed: '成片合成失败',
  duration_mismatch: '成片时长不匹配',
  visual_inspect_failed: '视觉巡检失败',
};

const STATUS_CHIP_CLASS = {
  done: 'bg-green-50 text-green-700 ring-green-200',
  pending: 'bg-[#fff1f3] text-[#fe2c55] ring-[#ffd6df]',
  failed: 'bg-red-50 text-red-700 ring-red-200',
  '': 'bg-slate-100 text-slate-600 ring-slate-200',
};

function formatRetryItem(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (RETRY_STAGE_TEXT[text]) return RETRY_STAGE_TEXT[text];
  if (text.startsWith('frames:')) return `镜头 ${text.slice('frames:'.length)}`;
  if (text.startsWith('render:')) return `渲染镜头 ${text.slice('render:'.length)}`;
  if (text.startsWith('frame_html:')) return `镜头 HTML ${text.slice('frame_html:'.length)}`;
  return text;
}

function formatRetryList(items) {
  const values = Array.isArray(items) ? items.map(formatRetryItem).filter(Boolean) : [];
  return values.length ? values.join('、') : '无';
}

function CreativeRetryPlan({
  retryPlan,
  retryPlanStatus,
  retryPlanMessage,
  retrying,
  onRetryWorkflow,
}) {
  const canRetry = retryPlanStatus === 'ready' && retryPlan?.can_retry === true;
  const cannotRetry = retryPlanStatus === 'ready' && retryPlan?.can_retry === false;

  return (
    <section className="grid gap-3.5 rounded-lg border border-amber-200 bg-amber-50 p-4" aria-label="恢复建议">
      <div className="flex justify-between gap-3">
        <div>
          <h3 className="m-0 text-[15px] font-bold leading-snug text-[#111827]">恢复建议</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6b7280]">{retryPlanMessage || retryPlan?.user_message || '系统会优先复用已完成内容，减少重复生成。'}</p>
        </div>
      </div>

      {retryPlanStatus === 'idle' || retryPlanStatus === 'loading' ? (
        <div className="inline-flex items-center gap-2 text-[13px] leading-normal text-amber-800">
          <Loader2 size={14} className="spinIcon" />
          <span>正在生成恢复计划...</span>
        </div>
      ) : null}

      {retryPlanStatus === 'failed' ? (
        <div className="text-[13px] leading-normal text-red-700">
          {retryPlanMessage || '恢复计划生成失败，请稍后重试。'}
        </div>
      ) : null}

      {cannotRetry ? (
        <div className="text-[13px] leading-normal text-amber-800">
          {retryPlan?.user_message || retryPlanMessage || '当前失败暂不支持自动恢复。'}
        </div>
      ) : null}

      {canRetry ? (
        <>
          <dl className="m-0 grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">失败位置</dt>
              <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{formatRetryItem(retryPlan.retry_from) || '视频工程'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">失败类型</dt>
              <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{RETRY_CODE_TEXT[retryPlan.code] || retryPlan.user_message || retryPlan.code || '未知失败'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">处理方式</dt>
              <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{RETRY_ACTION_TEXT[retryPlan.repair_action] || '按最新恢复计划继续执行'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">将复用</dt>
              <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{formatRetryList(retryPlan.reuse)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-1 text-xs font-bold text-[#8a93a2]">将重新执行</dt>
              <dd className="m-0 break-words text-[13px] leading-normal text-[#1f2937]">{formatRetryList(retryPlan.discard)}</dd>
            </div>
          </dl>
          <Button
            type="button"
            size="sm"
            className="w-fit bg-[#fe2c55] text-white hover:bg-[#f2214b]"
            disabled={retrying}
            onClick={onRetryWorkflow}
          >
            {retrying ? <Loader2 size={14} className="spinIcon" /> : <RefreshCcw size={14} />}
            <span>{retrying ? '正在修复并重试...' : '修复并重试'}</span>
          </Button>
        </>
      ) : null}
    </section>
  );
}

export function CreativeTaskDetail({
  status,
  message,
  workflowId,
  workflow,
  deletingWorkflowId,
  retryPlan,
  retryPlanStatus = 'idle',
  retryPlanMessage = '',
  retrying = false,
  progressEvents = [],
  onStopAndDelete,
  onContinueEdit,
  onRetryWorkflow,
  getWorkflowVideoUrl,
}) {
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [promptCopyStatus, setPromptCopyStatus] = useState('idle');
  if (!workflowId && !workflow) return null;

  const videoUrl = getWorkflowVideoUrl?.(workflow) || '';
  const canStopAndDelete = workflowId && workflow?.status !== 'done';
  const promptText = workflow?.creative_context?.input?.raw_text?.trim() || '';
  const editableWorkflowId = workflowId || workflow?.workflow_id || workflow?.id || '';

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

  function continueEdit() {
    onContinueEdit?.(editableWorkflowId);
  }

  const statusClass = getStatusClass(workflow?.status);

  return (
    <div className={cn('grid w-full min-w-0 gap-6 px-1 pb-0 pt-1', workflow?.status === 'done' && videoUrl && 'min-h-[calc(100vh-176px)]')}>
      <div className="flex min-w-0 items-start justify-between gap-4 rounded-lg border border-[#e7e9ee] bg-white p-4 max-[720px]:flex-col">
        <div className="grid min-w-0 gap-1">
          <span className="text-xs font-bold text-[#8a93a2]">任务 ID</span>
          <strong className="min-w-0 break-words font-mono text-base leading-snug text-[#111827]">{workflowId || '尚未创建'}</strong>
        </div>
        <strong className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-bold ring-1', STATUS_CHIP_CLASS[statusClass])}>
          {getWorkflowStatusText(workflow, status)}
        </strong>
        <div className="inline-flex shrink-0 flex-wrap items-center justify-end gap-2 max-[720px]:justify-start">
          <Dialog open={promptModalOpen} onOpenChange={setPromptModalOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" size="sm" type="button" className="border border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100">
                <Eye size={14} />
                <span>查看提示词</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="grid max-h-[82vh] w-[min(92vw,680px)] grid-rows-[auto_1fr_auto] overflow-hidden rounded-[14px] border border-[#e5e7eb] bg-white shadow-[0_24px_70px_rgba(15,23,42,.24)]" showCloseButton={false}>
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
              <pre className="m-0 overflow-auto whitespace-pre-wrap break-words bg-[#f8fafc] p-[18px] font-sans text-sm leading-relaxed text-[#111827]">{promptText || '暂无可显示的提示词。'}</pre>
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
          {canStopAndDelete ? (
            <Button
              variant="destructive"
              size="sm"
              type="button"
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deletingWorkflowId === workflowId}
              onClick={() => onStopAndDelete(workflowId)}
            >
              {deletingWorkflowId === workflowId ? <Loader2 size={14} className="spinIcon" /> : <Trash2 size={14} />}
              <span>{deletingWorkflowId === workflowId ? '正在删除' : '停止并删除'}</span>
            </Button>
          ) : null}
        </div>
      </div>
      <CreativeWorkflowStepper workflow={workflow} />
      <CreativeProgressPanel
        workflow={workflow}
        status={status}
        message={message}
        progressEvents={progressEvents}
      />
      {workflow?.status === 'failed' ? (
        <CreativeRetryPlan
          retryPlan={retryPlan}
          retryPlanStatus={retryPlanStatus}
          retryPlanMessage={retryPlanMessage}
          retrying={retrying}
          onRetryWorkflow={onRetryWorkflow}
        />
      ) : null}
      {workflow?.status === 'done' && videoUrl ? (
        <CreativeVideoPreview
          videoUrl={videoUrl}
          onEdit={continueEdit}
          disabled={!editableWorkflowId}
          title={editableWorkflowId ? '继续编辑视频' : '缺少创作任务 ID，无法进入编辑器。'}
        />
      ) : (
        <CreativeStatusMessage status={status} message={message} />
      )}
    </div>
  );
}
