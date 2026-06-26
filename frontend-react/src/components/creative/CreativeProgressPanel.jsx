import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { STAGE_LABELS, getWorkflowStatusText, normalizeWorkflowStages } from './creativeDisplay.js';
import {
  formatWorkflowDurationLabel,
  normalizeWorkflowProgress,
  summarizeProgressEvent,
} from './creativeProgress.js';

function getActiveStage(workflow) {
  const stages = normalizeWorkflowStages(workflow);
  return stages.find(stage => ['running', 'queued', 'pending'].includes(stage.status))
    || stages.find(stage => stage.status === 'failed')
    || [...stages].reverse().find(stage => stage.status === 'done')
    || stages[0]
    || null;
}

export function CreativeProgressPanel({ workflow, status, message, progressEvents = [] }) {
  const [expanded, setExpanded] = useState(false);
  const activeStage = useMemo(() => getActiveStage(workflow), [workflow]);
  if (!workflow) return null;

  const stageId = workflow.current_stage || activeStage?.id || '';
  const stageLabel = STAGE_LABELS[stageId] || activeStage?.label || '创作任务';
  const progress = normalizeWorkflowProgress(workflow);
  const durationLabel = formatWorkflowDurationLabel(workflow);
  const currentMessage = workflow.current_stage_message
    || activeStage?.message
    || message
    || '正在获取最新进度...';

  return (
    <section className="creativeProgressPanel" aria-label="当前进展">
      <div className="creativeProgressHeader">
        <div>
          <h3>当前进展</h3>
          <p>{workflow.status === 'done' ? '创作任务已完成。' : currentMessage}</p>
        </div>
        <strong className="creativeProgressPercent">{progress}%</strong>
      </div>
      <div className="creativeProgressTrack" aria-label={`总进度 ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <dl className="creativeProgressFacts">
        <div>
          <dt>当前阶段</dt>
          <dd>{stageLabel}</dd>
        </div>
        <div>
          <dt>当前状态</dt>
          <dd>{getWorkflowStatusText(workflow, status)}</dd>
        </div>
        {durationLabel ? (
          <div>
            <dt>最终用时</dt>
            <dd>{durationLabel}</dd>
          </div>
        ) : null}
      </dl>
      <button className="creativeProgressToggle" type="button" onClick={() => setExpanded(value => !value)}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{expanded ? '收起详细进度' : '展开详细进度'}</span>
      </button>
      {expanded ? (
        <div className="creativeProgressDebug">
          <dl>
            <div>
              <dt>阶段 ID</dt>
              <dd>{stageId || '无'}</dd>
            </div>
            <div>
              <dt>事件序号</dt>
              <dd>{workflow.last_event_seq || 0}</dd>
            </div>
          </dl>
          {progressEvents.length ? (
            <ol>
              {progressEvents.map(event => (
                <li key={`${event.seq || 0}-${event.type}-${event.received_at || ''}`}>
                  <code>{event.type || 'unknown_event'}</code>
                  <span>{summarizeProgressEvent(event)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>暂无本次页面会话的详细事件。</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
