import { useState } from 'react';
import { Check, Copy, Eye, Loader2, RefreshCcw, Trash2, X } from 'lucide-react';
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
  pending: 'bg-slate-100 text-slate-700 ring-slate-200',
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
            className="w-fit bg-[#111827] text-white hover:bg-[#020617]"
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

const IMAGE_ANALYSIS_STATUS_TEXT = {
  ready: '已完成',
  partial: '部分完成',
  failed: '失败后降级',
  disabled: '已关闭',
  skipped: '已跳过',
};

const IMAGE_ANALYSIS_STATUS_CLASS = {
  ready: 'bg-green-50 text-green-700 ring-green-200',
  partial: 'bg-amber-50 text-amber-700 ring-amber-200',
  failed: 'bg-red-50 text-red-700 ring-red-200',
  disabled: 'bg-slate-100 text-slate-700 ring-slate-200',
  skipped: 'bg-slate-100 text-slate-600 ring-slate-200',
  default: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const SOURCE_LABEL_TEXT = {
  article: '文章图片',
  github: 'GitHub 图片',
  github_readme: 'GitHub README',
  readme: 'README 图片',
  pexels: 'Pexels 补图',
  search: '搜索补图',
  upload: '上传图片',
};

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function formatImageAnalysisStatus(status) {
  return IMAGE_ANALYSIS_STATUS_TEXT[String(status || '').trim()] || '未分析';
}

function sourceLabel(source) {
  const key = String(source || '').trim();
  return SOURCE_LABEL_TEXT[key] || key || '来源图片';
}

function getAssetImageSrc(asset, assetId, workflowId) {
  if (assetId && workflowId) {
    return `/api/creative-workflows/${encodeURIComponent(workflowId)}/assets/${encodeURIComponent(assetId)}/file`;
  }
  const src = firstText(asset?.preview_url, asset?.thumbnail_url, asset?.url);
  return /^(https?:\/\/|\/api\/|data:image\/)/i.test(src) ? src : '';
}

function SourceImageThumbnail({ asset, assetId, workflowId, className }) {
  const [failed, setFailed] = useState(false);
  const src = getAssetImageSrc(asset, assetId, workflowId);
  if (src && !failed) {
    return (
      <img
        className={cn('h-full w-full rounded-md object-cover', className)}
        src={src}
        alt={firstText(asset.alt, asset.title, assetId, '来源图片')}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className={cn('grid h-full w-full place-items-center rounded-md bg-white px-2 text-center font-mono text-[11px] font-bold text-[#69717e]', className)}>
      {assetId}
    </div>
  );
}

function SourceImageAssetsDialog({ assets, diagnostics, usageById, workflowId }) {
  const sharedAnalysisMessage = Array.from(new Set(assets
    .map(asset => firstText(asset.image_analysis?.message))
    .filter(Boolean))).length === 1
    ? firstText(assets[0]?.image_analysis?.message)
    : '';

  return (
    <DialogContent className="max-h-[86vh] w-[min(1080px,calc(100vw-32px))] max-w-[calc(100vw-32px)] overflow-auto sm:max-w-[1080px]">
      <DialogHeader>
        <DialogTitle>来源图片列表</DialogTitle>
        <DialogDescription>查看已提取图片、分析状态和最终引用情况。</DialogDescription>
      </DialogHeader>

      {sharedAnalysisMessage ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-[#92400e]">
          分析说明：{sharedAnalysisMessage}
        </div>
      ) : null}

      {assets.length ? (
        <div className="grid gap-3">
          {assets.map((asset, index) => {
            const assetId = firstText(asset.id, asset.asset_id, `asset_${index + 1}`);
            const analysis = asset.image_analysis || {};
            const usage = usageById.get(assetId);
            const usedInFrames = Array.isArray(usage?.used_in_frames) ? usage.used_in_frames.filter(Boolean) : [];
            const used = usage?.used === true || usedInFrames.length > 0 || Number(usage?.usage_count || 0) > 0;
            const status = analysis.status || '';
            const title = firstText(asset.alt, asset.title, asset.name, asset.path, asset.url, assetId);
            const metaLine = [analysis.visual_type, analysis.best_usage, analysis.fit]
              .map(item => String(item || '').trim())
              .filter(Boolean)
              .join(' / ');

            return (
              <article key={`${assetId}-${index}`} className="grid grid-cols-[132px_minmax(0,1fr)] gap-3 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 max-[640px]:grid-cols-1">
                <div className="aspect-[16/10] w-full overflow-hidden rounded-md border border-[#d9dde5] bg-white">
                  <SourceImageThumbnail asset={asset} assetId={assetId} workflowId={workflowId} />
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <strong className="min-w-0 break-words text-[13px] leading-snug text-[#111827]">{title}</strong>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-[#5f6876] ring-1 ring-[#e1e5eb]">{sourceLabel(asset.source)}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold ring-1', IMAGE_ANALYSIS_STATUS_CLASS[status] || IMAGE_ANALYSIS_STATUS_CLASS.default)}>
                      {formatImageAnalysisStatus(status)}
                    </span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold ring-1', used ? 'bg-green-50 text-green-700 ring-green-200' : 'bg-slate-100 text-slate-700 ring-slate-200')}>
                      {usage ? (used ? '已用于镜头' : '最终未引用') : '未生成引用报告'}
                    </span>
                  </div>
                  {analysis.summary ? <p className="mt-2 text-[13px] leading-relaxed text-[#30343b]">{analysis.summary}</p> : null}
                  {metaLine ? <p className="mt-1 text-xs leading-relaxed text-[#69717e]">类型/用途/适配：{metaLine}</p> : null}
                  {usedInFrames.length ? <p className="mt-1 text-xs leading-relaxed text-[#69717e]">引用镜头：{usedInFrames.join('、')}</p> : null}
                  {analysis.message && analysis.message !== sharedAnalysisMessage ? <p className="mt-1 text-xs leading-relaxed text-[#b45309]">分析说明：{analysis.message}</p> : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[#d9dde5] bg-[#fafbfc] px-3 py-2 text-[13px] text-[#69717e]">暂无来源图片素材。</div>
      )}

      {diagnostics.length ? (
        <div className="grid gap-2 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3">
          <strong className="text-xs font-bold text-[#5f6876]">诊断信息</strong>
          {diagnostics.slice(0, 4).map((item, index) => {
            const code = firstText(item.code, item.type, item.status, 'diagnostic');
            const message = firstText(item.user_message, item.message, item.reason, item.url, '已记录素材处理诊断。');
            return (
              <div key={`${code}-${index}`} className="flex items-start justify-between gap-3 border-t border-[#edf0f4] pt-2 text-xs leading-relaxed max-[640px]:flex-col">
                <span className="min-w-0 break-words text-[#30343b]">{code === 'download_failed' ? '下载失败' : code}：{message}</span>
                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 font-bold text-[#5f6876] ring-1 ring-[#e1e5eb]">{code}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </DialogContent>
  );
}

function SourceImageAssetsPanel({ workflow }) {
  const assetContext = workflow?.asset_context || workflow?.creative_context?.asset_context || null;
  const assets = Array.isArray(assetContext?.assets) ? assetContext.assets : [];
  const diagnostics = Array.isArray(assetContext?.diagnostics) ? assetContext.diagnostics : [];
  const usageReport = assetContext?.asset_usage_report
    || workflow?.result?.hyperframes_freeform?.project?.asset_usage_report
    || workflow?.html_video_project?.asset_usage_report
    || null;
  const usageById = new Map((Array.isArray(usageReport?.assets) ? usageReport.assets : [])
    .map(item => [String(item.asset_id || item.id || '').trim(), item])
    .filter(([id]) => id));

  if (!assetContext && !assets.length && !diagnostics.length) return null;

  const contextStatus = assetContext?.image_analysis?.status || assetContext?.status || '';
  const assetWorkflowId = firstText(workflow?.workflow_id, workflow?.id);
  const usedAssetCount = assets.filter((asset, index) => {
    const assetId = firstText(asset.id, asset.asset_id, `asset_${index + 1}`);
    const usage = usageById.get(assetId);
    const usedInFrames = Array.isArray(usage?.used_in_frames) ? usage.used_in_frames.filter(Boolean) : [];
    return usage?.used === true || usedInFrames.length > 0 || Number(usage?.usage_count || 0) > 0;
  }).length;

  return (
    <section className="grid gap-3.5 rounded-lg border border-[#e7e9ee] bg-white p-4" aria-label="来源图片素材">
      <div className="flex items-start justify-between gap-3 max-[720px]:flex-col">
        <div className="min-w-0">
          <h3 className="m-0 text-[15px] font-bold leading-snug text-[#111827]">来源图片素材</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[#69717e]">
            {assetContext?.summary || assetContext?.image_analysis?.summary || '展示文章/GitHub 图片的分析状态、引用结果和准备诊断。'}
          </p>
        </div>
        <div className="inline-flex shrink-0 flex-wrap items-center justify-end gap-2 max-[720px]:justify-start">
          <span className={cn('rounded-full px-3 py-1 text-xs font-bold ring-1', IMAGE_ANALYSIS_STATUS_CLASS[contextStatus] || IMAGE_ANALYSIS_STATUS_CLASS.default)}>
            图片分析：{formatImageAnalysisStatus(contextStatus)}
          </span>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary" size="sm" type="button">
                <Eye size={14} />
                <span>{assets.length ? `查看图片列表（${assets.length}）` : '查看素材诊断'}</span>
              </Button>
            </DialogTrigger>
            <SourceImageAssetsDialog assets={assets} diagnostics={diagnostics} usageById={usageById} workflowId={assetWorkflowId} />
          </Dialog>
        </div>
      </div>

      {assets.length ? (
        <div className="grid grid-cols-3 gap-3 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3 text-[13px] max-[640px]:grid-cols-1">
          <div className="min-w-0">
            <div className="text-xs font-bold text-[#8a93a2]">图片素材</div>
            <div className="mt-1 font-semibold text-[#111827]">{assets.length} 张</div>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-[#8a93a2]">已用于镜头</div>
            <div className="mt-1 font-semibold text-[#111827]">{usedAssetCount} 张</div>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-[#8a93a2]">诊断信息</div>
            <div className="mt-1 font-semibold text-[#111827]">{diagnostics.length} 条</div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[#d9dde5] bg-[#fafbfc] px-3 py-2 text-[13px] text-[#69717e]">暂无来源图片素材。</div>
      )}
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
      <div className="creativeDetailMeta flex min-w-0 items-start justify-between gap-4 rounded-lg border border-[#e7e9ee] bg-white p-4 max-[720px]:flex-col">
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
              <Button variant="secondary" size="sm" type="button" className="creativePromptViewButton">
                <Eye size={14} />
                <span>查看提示词</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="creativePromptModal" showCloseButton={false}>
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
              <pre className="creativePromptModalText">{promptText || '暂无可显示的提示词。'}</pre>
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
      <SourceImageAssetsPanel workflow={workflow} />
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
