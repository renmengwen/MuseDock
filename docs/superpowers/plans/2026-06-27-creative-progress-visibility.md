# Creative Progress Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a product-friendly one-click creation progress panel with expandable debug events, fix task list time to creation time, and show final duration after completion.

**Architecture:** Keep this frontend-only. `OneClickCreativePage` owns transient SSE event history, `CreativeProgressPanel` renders derived progress data, and existing workflow fields remain the source of persisted state.

**Tech Stack:** React 19, Vite, existing `lucide-react` icons, existing CSS in `frontend-react/src/styles.css`.

---

### Task 1: Add Progress Panel Component

**Files:**
- Create: `frontend-react/src/components/creative/CreativeProgressPanel.jsx`

- [ ] **Step 1: Create the component**

Create `CreativeProgressPanel.jsx` with these exports:

```jsx
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { STAGE_LABELS, getWorkflowStatusText, normalizeWorkflowStages } from './creativeDisplay.js';

function toValidDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  const restSeconds = seconds % 60;
  if (hours > 0) return `用时 ${hours} 小时 ${restMinutes} 分 ${restSeconds} 秒`;
  if (minutes > 0) return `用时 ${minutes} 分 ${restSeconds} 秒`;
  return `用时 ${restSeconds} 秒`;
}

function getDoneAt(workflow) {
  const stages = Array.isArray(workflow?.stages) ? workflow.stages : [];
  const completedStages = stages
    .map(stage => toValidDate(stage.completed_at))
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime());
  return completedStages[0] || toValidDate(workflow?.updated_at);
}

export function getWorkflowDurationLabel(workflow) {
  if (workflow?.status !== 'done') return '';
  const createdAt = toValidDate(workflow?.created_at);
  const doneAt = getDoneAt(workflow);
  if (!createdAt || !doneAt) return '';
  return formatDuration(doneAt.getTime() - createdAt.getTime());
}

function getActiveStage(workflow) {
  const stages = normalizeWorkflowStages(workflow);
  return stages.find(stage => ['running', 'queued', 'pending'].includes(stage.status))
    || stages.find(stage => stage.status === 'failed')
    || stages.findLast?.(stage => stage.status === 'done')
    || stages[0]
    || null;
}

function getProgress(workflow) {
  const value = Number(workflow?.current_progress);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function eventSummary(event) {
  const data = event?.data && typeof event.data === 'object' ? event.data : {};
  const parts = [
    Number.isFinite(Number(data.index)) && Number.isFinite(Number(data.total))
      ? `第 ${Number(data.index) + 1}/${data.total} 项`
      : '',
    Number.isFinite(Number(data.percent)) ? `${Math.round(Number(data.percent))}%` : '',
    data.error ? `错误：${data.error}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : (event?.message || '无附加信息');
}

export function CreativeProgressPanel({ workflow, status, message, progressEvents = [] }) {
  const [expanded, setExpanded] = useState(false);
  const activeStage = useMemo(() => getActiveStage(workflow), [workflow]);
  if (!workflow) return null;

  const stageId = workflow.current_stage || activeStage?.id || '';
  const stageLabel = STAGE_LABELS[stageId] || activeStage?.label || '创作任务';
  const progress = getProgress(workflow);
  const durationLabel = getWorkflowDurationLabel(workflow);
  const currentMessage = workflow.current_stage_message || activeStage?.message || message || '正在获取最新进度...';

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
            <div><dt>阶段 ID</dt><dd>{stageId || '无'}</dd></div>
            <div><dt>事件序号</dt><dd>{workflow.last_event_seq || 0}</dd></div>
          </dl>
          {progressEvents.length ? (
            <ol>
              {progressEvents.map(event => (
                <li key={`${event.seq || 0}-${event.type}-${event.received_at || ''}`}>
                  <code>{event.type || 'unknown_event'}</code>
                  <span>{eventSummary(event)}</span>
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
```

- [ ] **Step 2: Run frontend build**

Run: `npm run build:frontend`

Expected: build succeeds.

### Task 2: Wire Progress Events Into Page

**Files:**
- Modify: `frontend-react/src/pages/OneClickCreativePage.jsx`
- Modify: `frontend-react/src/components/creative/CreativeTaskDetail.jsx`

- [ ] **Step 1: Store recent events in `OneClickCreativePage`**

Add state near other task state:

```jsx
const [progressEventsByWorkflow, setProgressEventsByWorkflow] = useState({});
```

Add helper:

```jsx
const appendProgressEvent = useCallback((event) => {
  if (!event?.workflow_id || !event?.type) return;
  setProgressEventsByWorkflow(prev => {
    const current = prev[event.workflow_id] || [];
    const nextEvent = { ...event, received_at: new Date().toISOString() };
    return {
      ...prev,
      [event.workflow_id]: [...current, nextEvent].slice(-30),
    };
  });
}, []);
```

Call it at the start of `applyTaskEvent` after workflow/task filtering.

- [ ] **Step 2: Clear events when deleting or starting fresh**

When `startNewTask()` resets the page, call:

```jsx
setProgressEventsByWorkflow({});
```

When a workflow is deleted, remove that workflow key.

- [ ] **Step 3: Pass events to detail**

Pass:

```jsx
progressEvents={progressEventsByWorkflow[selectedWorkflowId] || []}
```

- [ ] **Step 4: Render progress panel in `CreativeTaskDetail`**

Import:

```jsx
import { CreativeProgressPanel } from './CreativeProgressPanel.jsx';
```

Accept `progressEvents` prop and render after `CreativeWorkflowStepper`:

```jsx
<CreativeProgressPanel
  workflow={workflow}
  status={status}
  message={message}
  progressEvents={progressEvents}
/>
```

- [ ] **Step 5: Run frontend build**

Run: `npm run build:frontend`

Expected: build succeeds.

### Task 3: Fix Sidebar Time and Add Styles

**Files:**
- Modify: `frontend-react/src/pages/OneClickCreativePage.jsx`
- Modify: `frontend-react/src/styles.css`

- [ ] **Step 1: Fix task list time source**

Change sidebar task mapping to:

```jsx
timeLabel: getTaskTimeLabel(task.created_at || task.updated_at),
```

- [ ] **Step 2: Add progress panel CSS**

Add a small CSS block near existing `.creativeRetryPanel` styles:

```css
.creativeProgressPanel {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fbff;
}
.creativeProgressHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.creativeProgressHeader h3 {
  margin: 0;
  color: #111827;
  font-size: 15px;
  line-height: 1.35;
}
.creativeProgressHeader p {
  margin: 4px 0 0;
  color: #4b5563;
  font-size: 13px;
  line-height: 1.6;
}
.creativeProgressPercent {
  color: #1d4ed8;
  font-size: 18px;
  line-height: 1.2;
}
.creativeProgressTrack {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #e5e7eb;
}
.creativeProgressTrack span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #2563eb;
  transition: width .2s ease;
}
.creativeProgressFacts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 14px;
  margin: 0;
}
.creativeProgressFacts dt,
.creativeProgressDebug dt {
  margin: 0 0 4px;
  color: #8a93a2;
  font-size: 12px;
  font-weight: 700;
}
.creativeProgressFacts dd,
.creativeProgressDebug dd {
  margin: 0;
  color: #1f2937;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}
.creativeProgressToggle {
  justify-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #1d4ed8;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.creativeProgressDebug {
  display: grid;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid #dbeafe;
}
.creativeProgressDebug dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  margin: 0;
}
.creativeProgressDebug ol {
  display: grid;
  gap: 8px;
  max-height: 220px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
.creativeProgressDebug li {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
}
.creativeProgressDebug code {
  color: #111827;
  font-size: 12px;
  word-break: break-all;
}
.creativeProgressDebug span,
.creativeProgressDebug p {
  margin: 0;
  color: #4b5563;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}
```

- [ ] **Step 3: Run frontend build**

Run: `npm run build:frontend`

Expected: build succeeds.

### Task 4: Final Verification

**Files:**
- Verify: `frontend-react/src/components/creative/CreativeProgressPanel.jsx`
- Verify: `frontend-react/src/pages/OneClickCreativePage.jsx`
- Verify: `frontend-react/src/components/creative/CreativeTaskDetail.jsx`
- Verify: `frontend-react/src/styles.css`

- [ ] **Step 1: Run frontend build**

Run: `npm run build:frontend`

Expected: build succeeds.

- [ ] **Step 2: Check git diff**

Run: `git diff -- frontend-react/src/pages/OneClickCreativePage.jsx frontend-react/src/components/creative/CreativeTaskDetail.jsx frontend-react/src/components/creative/CreativeProgressPanel.jsx frontend-react/src/styles.css`

Expected: diff only includes progress panel, event cache, fixed task time source, and CSS.
