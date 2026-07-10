import { cn } from '@/lib/utils.js';
import { CreativeProgressPanel } from './CreativeProgressPanel.jsx';
import { CreativeStatusMessage } from './CreativeStatusMessage.jsx';
import { CreativeVideoPreview } from './CreativeVideoPreview.jsx';
import { CreativeWorkflowStepper } from './CreativeWorkflowStepper.jsx';
import { CreativeRetryPlan } from './CreativeRetryPlan.jsx';
import { CreativeTaskSummary } from './CreativeTaskSummary.jsx';
import { SourceImageAssetsPanel } from './SourceImageAssetsPanel.jsx';

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
  if (!workflowId && !workflow) return null;

  const videoUrl = getWorkflowVideoUrl?.(workflow) || '';
  const isDone = workflow?.status === 'done';
  const shouldShowStatusMessage = status === 'failed' && workflow?.status !== 'failed';
  const visualRouteSummary = workflow?.result?.hyperframes_freeform?.project?.visual_route_summary;

  return (
    <div className={cn('grid w-full min-w-0 gap-6 px-1 pb-0 pt-1', workflow?.status === 'done' && videoUrl && 'min-h-[calc(100vh-176px)]')}>
      <CreativeTaskSummary
        status={status}
        message={message}
        workflowId={workflowId}
        workflow={workflow}
        deletingWorkflowId={deletingWorkflowId}
        retryPlan={retryPlan}
        retryPlanStatus={retryPlanStatus}
        retryPlanMessage={retryPlanMessage}
        onStopAndDelete={onStopAndDelete}
        onContinueEdit={onContinueEdit}
      />
      {visualRouteSummary ? (
        <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
          <div className="font-medium text-slate-900">视觉路由</div>
          <div className="mt-1">
            模板帧 {visualRouteSummary.template_inputs || 0} / 自由 HTML {visualRouteSummary.raw_html || 0}
            {visualRouteSummary.style_profile_id ? ` / 风格 ${visualRouteSummary.style_profile_id}` : ''}
          </div>
        </div>
      ) : null}
      {!isDone ? (
        <>
          <CreativeWorkflowStepper workflow={workflow} />
          <CreativeProgressPanel
            workflow={workflow}
            status={status}
            message={message}
            progressEvents={progressEvents}
          />
        </>
      ) : null}
      <SourceImageAssetsPanel workflow={workflow} />
      {workflow?.status === 'failed' ? (
        <CreativeRetryPlan
          workflow={workflow}
          retryPlan={retryPlan}
          retryPlanStatus={retryPlanStatus}
          retryPlanMessage={retryPlanMessage}
          message={message}
          retrying={retrying}
          onRetryWorkflow={onRetryWorkflow}
        />
      ) : null}
      {workflow?.status === 'done' && videoUrl ? (
        <CreativeVideoPreview
          videoUrl={videoUrl}
        />
      ) : shouldShowStatusMessage ? (
        // 工作流内失败已有进度面板和恢复建议；这里只承载页面级错误
        <CreativeStatusMessage status={status} message={message} />
      ) : null}
    </div>
  );
}
