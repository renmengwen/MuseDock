import { useState } from 'react';
import { Eye, Loader2, RefreshCcw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.jsx';
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
  timeline_duration_unreasonable: '时间轴时长异常',
  render_failed: '镜头渲染失败',
  compose_failed: '成片合成失败',
  duration_mismatch: '成片时长不匹配',
  visual_inspect_failed: '视觉巡检失败',
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
    <section className="creativeRetryPanel" aria-label="恢复建议">
      <div className="creativeRetryHeader">
        <div>
          <h3>恢复建议</h3>
          <p>{retryPlanMessage || retryPlan?.user_message || '系统会优先复用已完成内容，减少重复生成。'}</p>
        </div>
      </div>

      {retryPlanStatus === 'idle' || retryPlanStatus === 'loading' ? (
        <div className="creativeRetryState">
          <Loader2 size={14} className="spinIcon" />
          <span>正在生成恢复计划...</span>
        </div>
      ) : null}

      {retryPlanStatus === 'failed' ? (
        <div className="creativeRetryState isError">
          {retryPlanMessage || '恢复计划生成失败，请稍后重试。'}
        </div>
      ) : null}

      {cannotRetry ? (
        <div className="creativeRetryState">
          {retryPlan?.user_message || retryPlanMessage || '当前失败暂不支持自动恢复。'}
        </div>
      ) : null}

      {canRetry ? (
        <>
          <dl className="creativeRetryFacts">
            <div>
              <dt>失败位置</dt>
              <dd>{formatRetryItem(retryPlan.retry_from) || '视频工程'}</dd>
            </div>
            <div>
              <dt>失败类型</dt>
              <dd>{RETRY_CODE_TEXT[retryPlan.code] || retryPlan.user_message || retryPlan.code || '未知失败'}</dd>
            </div>
            <div>
              <dt>处理方式</dt>
              <dd>{RETRY_ACTION_TEXT[retryPlan.repair_action] || '按最新恢复计划继续执行'}</dd>
            </div>
            <div>
              <dt>将复用</dt>
              <dd>{formatRetryList(retryPlan.reuse)}</dd>
            </div>
            <div>
              <dt>将重新执行</dt>
              <dd>{formatRetryList(retryPlan.discard)}</dd>
            </div>
          </dl>
          <Button
            type="button"
            size="sm"
            className="creativeRetryButton"
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
  if (!workflowId && !workflow) return null;

  const videoUrl = getWorkflowVideoUrl?.(workflow) || '';
  const canStopAndDelete = workflowId && workflow?.status !== 'done';
  const promptText = workflow?.creative_context?.input?.raw_text?.trim() || '';
  const editableWorkflowId = workflowId || workflow?.workflow_id || workflow?.id || '';

  function continueEdit() {
    onContinueEdit?.(editableWorkflowId);
  }

  return (
    <div className={`creativeTaskDetail ${workflow?.status === 'done' && videoUrl ? 'hasVideo' : ''}`}>
      <div className="creativeDetailMeta">
        <div>
          <span>任务 ID</span>
          <strong>{workflowId || '尚未创建'}</strong>
        </div>
        <strong className={`stepBadge ${getStatusClass(workflow?.status)}`}>
          {getWorkflowStatusText(workflow, status)}
        </strong>
        <div className="creativeTaskActions">
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
            </DialogContent>
          </Dialog>
          {canStopAndDelete ? (
            <Button
              variant="destructive"
              size="sm"
              type="button"
              className="creativeStopDeleteButton"
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
