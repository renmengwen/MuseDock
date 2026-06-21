import { useState } from 'react';
import { Eye, Loader2, Trash2, X } from 'lucide-react';
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
import { CreativeStatusMessage } from './CreativeStatusMessage.jsx';
import { CreativeVideoPreview } from './CreativeVideoPreview.jsx';
import { CreativeWorkflowStepper } from './CreativeWorkflowStepper.jsx';

export function CreativeTaskDetail({
  status,
  message,
  workflowId,
  workflow,
  deletingWorkflowId,
  onStopAndDelete,
  onContinueEdit,
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
