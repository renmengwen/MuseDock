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
      {!isDone ? <SourceImageAssetsPanel workflow={workflow} /> : null}
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
        />
      ) : workflow?.status === 'failed' ? null : (
        // 失败时错误信息已由进度面板和恢复建议承载，不再重复渲染底部状态条
        <CreativeStatusMessage status={status} message={message} />
      )}
    </div>
  );
}
