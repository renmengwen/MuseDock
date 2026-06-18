# Creative Task SSE Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one-click creative workflow polling/stale guessing with a background task registry, POST-based SSE event replay, and html-video sub-step progress.

**Architecture:** Add an in-process `creativeTaskRegistry` as the live task/event source, persist workflow JSON as a recoverable summary, and expose a `POST /api/creative-workflows/:workflow_id/events` SSE stream using `fetch + ReadableStream` on the frontend. Keep the existing workflow stages, but pass a task context through `runCreativeWorkflow()` and html-video services so all long-running steps emit events and update workflow/run summaries.

**Tech Stack:** Node.js CommonJS, Express, filesystem JSON stores, React 19, `fetch()` streaming, existing `node tests/*.js` and `node tests/*.mjs` test style.

---

## References

- Spec: `docs/superpowers/specs/2026-06-18-creative-task-sse-replay-design.md`
- html-video task replay design reference: `D:\code3\html-video\packages\cli\src\task-registry.ts`
- html-video actual streaming reference: `D:\code3\html-video\packages\cli\src\studio-server.ts`
- html-video frontend stream parsing reference: `D:\code3\html-video\packages\project-studio\public\app.js`

## File Map

- Create `server/services/creativeTaskEvents.js`: event normalization, stage weights, progress calculation, SSE formatting.
- Create `server/services/creativeTaskRegistry.js`: in-memory task registry with replay, subscribers, TTL pruning, terminal events.
- Create `server/services/creativeWorkflowTasks.js`: workflow-task orchestration, `emitAndPersistTaskEvent()`, start workflow task, recovery wrapper.
- Modify `server/services/creativeWorkflows.js`: task summary fields, stage reporting hooks, active-task-aware stale handling, startup orphan recovery helpers.
- Modify `server/routes/creativeWorkflows.js`: async create response with `task_id`, POST SSE route, active task route, stop/delete task notification.
- Modify `server/index.js`: initialize/recover task registry at startup.
- Modify `server/services/agentRuns.js`: pass html-video progress callback into `workflowFacade.generateCreativeVideoProject()`.
- Modify `server/services/creative-video/workflowFacade.js`: accept and forward `onProgress`.
- Modify `server/services/creative-video/html-video/htmlVideoWorkflow.js`: emit html-video graph/frame/render/compose progress and wrap AI sub-step timeouts.
- Modify `server/services/creative-video/html-video/projectOrchestrator.js`: forward render progress to frame renderer and compose/mux events.
- Modify `frontend-react/src/api/client.js`: add `streamCreativeWorkflowEvents()`.
- Modify `frontend-react/src/pages/OneClickCreativePage.jsx`: subscribe/reconnect to task SSE, keep polling as fallback, persist `lastSeq`.
- Tests:
  - Create `tests/test-creative-task-events.js`
  - Create `tests/test-creative-task-registry.js`
  - Create `tests/test-creative-workflow-tasks.js`
  - Extend `tests/test-creative-workflow-routes.js`
  - Extend `tests/test-creative-workflows.js`
  - Extend `tests/test-html-video-workflow.js`
  - Extend `tests/test-html-video-project-orchestrator-modes.js`
  - Extend `tests/test-one-click-creative-page.mjs`
  - Create `tests/test-creative-task-api-client.mjs`

---

### Task 1: Task Event Utilities

**Files:**
- Create: `server/services/creativeTaskEvents.js`
- Test: `tests/test-creative-task-events.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test-creative-task-events.js`:

```js
const assert = require('assert/strict');

const events = require('../server/services/creativeTaskEvents');

{
  assert.equal(events.normalizeSinceSeq(undefined), 0);
  assert.equal(events.normalizeSinceSeq('12'), 12);
  assert.equal(events.normalizeSinceSeq('-1'), 0);
  assert.equal(events.normalizeSinceSeq('bad'), 0);
}

{
  const event = events.createTaskEvent({
    seq: 3,
    taskId: 'creative-task-1',
    workflowId: '202606180000000001',
    operationId: 'workflow-op-1',
    type: 'stage_progress',
    stage: 'project',
    progress: 44.4,
    message: '正在生成第 1/3 帧 HTML...',
    data: { frame_id: 'scene_01' },
    now: () => '2026-06-18T00:00:00.000Z',
  });
  assert.equal(event.seq, 3);
  assert.equal(event.task_id, 'creative-task-1');
  assert.equal(event.workflow_id, '202606180000000001');
  assert.equal(event.operation_id, 'workflow-op-1');
  assert.equal(event.type, 'stage_progress');
  assert.equal(event.stage, 'project');
  assert.equal(event.progress, 44);
  assert.equal(event.message, '正在生成第 1/3 帧 HTML...');
  assert.deepEqual(event.data, { frame_id: 'scene_01' });
  assert.equal(event.time, '2026-06-18T00:00:00.000Z');
}

{
  assert.equal(events.isTerminalEvent({ type: 'task_done' }), true);
  assert.equal(events.isTerminalEvent({ type: 'task_failed' }), true);
  assert.equal(events.isTerminalEvent({ type: 'workflow_deleted' }), true);
  assert.equal(events.isTerminalEvent({ type: 'stage_progress' }), false);
}

{
  assert.equal(events.calculateWorkflowProgress({ stage: 'source', stageProgress: 100 }), 5);
  assert.equal(events.calculateWorkflowProgress({ stage: 'project', stageProgress: 50 }), 55);
  assert.equal(events.calculateWorkflowProgress({
    stage: 'project',
    stageProgress: events.calculateProjectProgress({ step: 'frame_html', index: 1, total: 4, stepProgress: 50 }),
  }), 50);
  assert.equal(events.calculateWorkflowProgress({ stage: 'inspect', stageProgress: 100 }), 100);
}

{
  const sse = events.formatSseEvent({ seq: 2, type: 'task_done', message: '完成' });
  assert.match(sse, /^id: 2\n/);
  assert.match(sse, /event: task_done\n/);
  assert.match(sse, /data: /);
  assert.match(sse, /\n\n$/);
}

console.log('creative task event tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-creative-task-events.js
```

Expected: FAIL with `Cannot find module '../server/services/creativeTaskEvents'`.

- [ ] **Step 3: Implement task event utilities**

Create `server/services/creativeTaskEvents.js`:

```js
const STAGE_WEIGHTS = {
  source: 5,
  research: 5,
  assets: 5,
  agent_run: 5,
  brief: 15,
  audio: 15,
  project: 35,
  check: 5,
  render: 5,
  inspect: 5,
};

const PROJECT_WEIGHTS = {
  template: 5,
  graph: 10,
  frame_html: 35,
  materialize: 5,
  frame_render: 30,
  compose: 10,
  inspect: 5,
};

const TERMINAL_TYPES = new Set(['task_done', 'task_failed', 'workflow_deleted']);

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function safeString(value) {
  return String(value || '').trim();
}

function normalizeSinceSeq(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function createTaskEvent(input = {}) {
  return {
    seq: Number(input.seq) || 0,
    time: typeof input.now === 'function' ? input.now() : new Date().toISOString(),
    task_id: safeString(input.taskId || input.task_id),
    workflow_id: safeString(input.workflowId || input.workflow_id),
    operation_id: safeString(input.operationId || input.operation_id),
    type: safeString(input.type || 'task_event'),
    stage: safeString(input.stage),
    progress: clampPercent(input.progress),
    message: safeString(input.message),
    data: input.data && typeof input.data === 'object' && !Array.isArray(input.data) ? input.data : {},
  };
}

function orderedStageIds() {
  return Object.keys(STAGE_WEIGHTS);
}

function calculateWorkflowProgress({ stage, stageProgress = 0, skippedStages = [] } = {}) {
  const skipped = new Set(Array.isArray(skippedStages) ? skippedStages : []);
  const activeStages = orderedStageIds().filter(id => !skipped.has(id));
  const totalWeight = activeStages.reduce((sum, id) => sum + STAGE_WEIGHTS[id], 0) || 100;
  let completedWeight = 0;
  for (const id of activeStages) {
    if (id === stage) break;
    completedWeight += STAGE_WEIGHTS[id] || 0;
  }
  const currentWeight = STAGE_WEIGHTS[stage] || 0;
  return clampPercent(((completedWeight + currentWeight * (clampPercent(stageProgress) / 100)) / totalWeight) * 100);
}

function calculateProjectProgress({ step, index = 0, total = 1, stepProgress = 0 } = {}) {
  const order = Object.keys(PROJECT_WEIGHTS);
  let completedWeight = 0;
  for (const id of order) {
    if (id === step) break;
    completedWeight += PROJECT_WEIGHTS[id] || 0;
  }

  const currentWeight = PROJECT_WEIGHTS[step] || 0;
  let normalizedStepProgress = clampPercent(stepProgress);
  if ((step === 'frame_html' || step === 'frame_render') && Number(total) > 0) {
    const safeIndex = Math.max(0, Math.min(Number(total) - 1, Number(index) || 0));
    normalizedStepProgress = ((safeIndex + normalizedStepProgress / 100) / Number(total)) * 100;
  }
  return clampPercent(completedWeight + currentWeight * (clampPercent(normalizedStepProgress) / 100));
}

function isTerminalEvent(event = {}) {
  return TERMINAL_TYPES.has(String(event.type || ''));
}

function formatSseEvent(event = {}) {
  const seq = Number(event.seq) || 0;
  const type = safeString(event.type || 'message');
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}

module.exports = {
  STAGE_WEIGHTS,
  PROJECT_WEIGHTS,
  normalizeSinceSeq,
  createTaskEvent,
  calculateWorkflowProgress,
  calculateProjectProgress,
  isTerminalEvent,
  formatSseEvent,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node tests/test-creative-task-events.js
```

Expected: PASS with `creative task event tests passed`.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creativeTaskEvents.js tests/test-creative-task-events.js
git commit -m "新增创作任务事件工具"
```

---

### Task 2: In-Memory Task Registry With Replay

**Files:**
- Create: `server/services/creativeTaskRegistry.js`
- Test: `tests/test-creative-task-registry.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test-creative-task-registry.js`:

```js
const assert = require('assert/strict');

const { createCreativeTaskRegistry } = require('../server/services/creativeTaskRegistry');

async function waitImmediate() {
  await new Promise(resolve => setImmediate(resolve));
}

(async () => {
  const times = [
    '2026-06-18T00:00:00.000Z',
    '2026-06-18T00:00:01.000Z',
    '2026-06-18T00:00:02.000Z',
    '2026-06-18T00:00:03.000Z',
  ];
  const registry = createCreativeTaskRegistry({
    now: () => times.shift() || '2026-06-18T00:00:04.000Z',
    ttlMs: 10 * 60 * 1000,
    maxFinishedTasks: 10,
    maxEventsPerTask: 3,
    idFactory: () => 'creative-task-test',
  });

  const taskId = registry.createTask({
    workflowId: '202606180000000001',
    operationId: 'workflow-op-1',
    runner: async ({ emit }) => {
      emit({ type: 'stage_started', stage: 'source', message: '正在准备来源资料...' });
      emit({ type: 'stage_done', stage: 'source', message: '来源资料已准备完成。' });
    },
  });

  assert.equal(taskId, 'creative-task-test');
  assert.deepEqual(registry.activeTaskForWorkflow('202606180000000001'), {
    task_id: 'creative-task-test',
    workflow_id: '202606180000000001',
    operation_id: 'workflow-op-1',
    kind: 'creative_workflow',
    status: 'running',
  });

  await waitImmediate();
  await waitImmediate();

  const task = registry.getTask(taskId);
  assert.equal(task.status, 'done');
  assert.equal(task.events.at(-1).type, 'task_done');

  const replayed = [];
  const subscription = registry.subscribe(taskId, 1, event => replayed.push(event));
  assert.equal(subscription.finished, true);
  assert.deepEqual(replayed.map(event => event.seq), [2, 3]);
  assert.equal(replayed.at(-1).type, 'task_done');

  const liveRegistry = createCreativeTaskRegistry({
    now: () => '2026-06-18T00:00:00.000Z',
    idFactory: () => 'creative-task-live',
  });
  const liveTaskId = liveRegistry.createDetachedTask({
    workflowId: '202606180000000002',
    operationId: 'workflow-op-2',
  });
  const liveEvents = [];
  const liveSubscription = liveRegistry.subscribe(liveTaskId, 0, event => liveEvents.push(event));
  liveRegistry.emit(liveTaskId, { type: 'stage_progress', stage: 'project', message: '正在生成工程...' });
  assert.equal(liveEvents.at(-1).type, 'stage_progress');
  liveSubscription.unsubscribe();
  liveRegistry.emit(liveTaskId, { type: 'stage_progress', stage: 'project', message: '不会收到' });
  assert.equal(liveEvents.filter(event => event.message === '不会收到').length, 0);
  liveRegistry.markFailed(liveTaskId, new Error('失败测试'));
  assert.equal(liveRegistry.getTask(liveTaskId).status, 'failed');
  assert.equal(liveRegistry.getTask(liveTaskId).events.at(-1).type, 'task_failed');

  console.log('creative task registry tests passed');
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-creative-task-registry.js
```

Expected: FAIL with `Cannot find module '../server/services/creativeTaskRegistry'`.

- [ ] **Step 3: Implement registry**

Create `server/services/creativeTaskRegistry.js`:

```js
const crypto = require('crypto');
const { createTaskEvent, isTerminalEvent } = require('./creativeTaskEvents');

function defaultIdFactory() {
  const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]+/g, '-');
  return `creative-task-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function cloneTaskSummary(task) {
  if (!task) return null;
  return {
    task_id: task.task_id,
    workflow_id: task.workflow_id,
    operation_id: task.operation_id,
    kind: task.kind,
    status: task.status,
  };
}

function createCreativeTaskRegistry(options = {}) {
  const tasks = new Map();
  let seq = 0;
  let lastPruneAt = 0;
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : defaultIdFactory;
  const ttlMs = Number(options.ttlMs) || 10 * 60 * 1000;
  const maxEventsPerTask = Number(options.maxEventsPerTask) || 1000;
  const maxFinishedTasks = Number(options.maxFinishedTasks) || 100;

  function appendEvent(task, input) {
    const event = createTaskEvent({
      ...input,
      seq: ++seq,
      taskId: task.task_id,
      workflowId: task.workflow_id,
      operationId: task.operation_id,
      now,
    });
    task.events.push(event);
    if (task.events.length > maxEventsPerTask) {
      task.events.splice(0, task.events.length - maxEventsPerTask);
      task.truncated = true;
    }
    task.updated_at = event.time;
    for (const subscriber of task.subscribers) {
      try { subscriber(event); } catch {}
    }
    const pruneTime = Date.parse(event.time) || Date.now();
    if (pruneTime - lastPruneAt > 60_000) prune(pruneTime);
    return event;
  }

  function createDetachedTask({ workflowId, operationId, kind = 'creative_workflow' } = {}) {
    prune();
    const taskId = idFactory();
    const timestamp = now();
    tasks.set(taskId, {
      task_id: taskId,
      workflow_id: String(workflowId || ''),
      operation_id: String(operationId || ''),
      kind,
      status: 'running',
      started_at: timestamp,
      updated_at: timestamp,
      ended_at: null,
      error: null,
      events: [],
      subscribers: new Set(),
      truncated: false,
    });
    return taskId;
  }

  function createTask({ workflowId, operationId, kind = 'creative_workflow', runner } = {}) {
    const taskId = createDetachedTask({ workflowId, operationId, kind });
    const emit = event => appendEvent(tasks.get(taskId), event);
    appendEvent(tasks.get(taskId), { type: 'task_started', message: '后台创作任务已启动。' });
    Promise.resolve()
      .then(() => runner({ taskId, emit }))
      .then(() => markDone(taskId))
      .catch(error => markFailed(taskId, error));
    return taskId;
  }

  function emit(taskId, event) {
    const task = tasks.get(taskId);
    if (!task) return null;
    return appendEvent(task, event);
  }

  function markDone(taskId, message = '后台创作任务已完成。') {
    const task = tasks.get(taskId);
    if (!task || task.status !== 'running') return null;
    task.status = 'done';
    task.ended_at = now();
    return appendEvent(task, { type: 'task_done', progress: 100, message });
  }

  function markFailed(taskId, error) {
    const task = tasks.get(taskId);
    if (!task || task.status !== 'running') return null;
    const message = error && error.message ? error.message : String(error || '后台创作任务失败。');
    task.status = 'failed';
    task.error = message;
    task.ended_at = now();
    return appendEvent(task, { type: 'task_failed', message });
  }

  function subscribe(taskId, sinceSeq, onEvent) {
    const task = tasks.get(taskId);
    if (!task) return null;
    const threshold = Number(sinceSeq) || 0;
    for (const event of task.events) {
      if (event.seq > threshold) onEvent(event);
    }
    // Keep this check after replay and before adding the live subscriber.
    // The function is synchronous, so no task event can interleave between this
    // status check and subscriber registration in the same Node.js event-loop turn.
    if (task.status !== 'running') {
      return { unsubscribe: () => {}, finished: true };
    }
    task.subscribers.add(onEvent);
    return {
      unsubscribe: () => task.subscribers.delete(onEvent),
      finished: false,
    };
  }

  function getTask(taskId) {
    return tasks.get(taskId) || null;
  }

  function activeTaskForWorkflow(workflowId) {
    let newest = null;
    for (const task of tasks.values()) {
      if (task.workflow_id !== String(workflowId || '')) continue;
      if (task.status !== 'running') continue;
      if (!newest || Date.parse(task.started_at) > Date.parse(newest.started_at)) newest = task;
    }
    return cloneTaskSummary(newest);
  }

  function prune(nowMs = Date.now()) {
    lastPruneAt = Number(nowMs) || Date.now();
    const finished = [];
    for (const [taskId, task] of tasks.entries()) {
      if (task.status === 'running') continue;
      const ended = Date.parse(task.ended_at || task.updated_at);
      if (Number.isFinite(ended) && lastPruneAt - ended > ttlMs) tasks.delete(taskId);
      else finished.push(task);
    }
    finished
      .sort((a, b) => Date.parse(a.ended_at || a.updated_at) - Date.parse(b.ended_at || b.updated_at))
      .slice(0, Math.max(0, finished.length - maxFinishedTasks))
      .forEach(task => tasks.delete(task.task_id));
  }

  return {
    createTask,
    createDetachedTask,
    emit,
    markDone,
    markFailed,
    subscribe,
    getTask,
    activeTaskForWorkflow,
    prune,
    isTerminalEvent,
  };
}

const defaultRegistry = createCreativeTaskRegistry();

module.exports = {
  createCreativeTaskRegistry,
  defaultRegistry,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node tests/test-creative-task-registry.js
```

Expected: PASS with `creative task registry tests passed`.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creativeTaskRegistry.js tests/test-creative-task-registry.js
git commit -m "新增创作后台任务注册表"
```

---

### Task 3: Workflow Task Summary Persistence

**Files:**
- Modify: `server/services/creativeWorkflows.js`
- Create: `tests/test-creative-workflow-task-summary.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test-creative-workflow-task-summary.js`:

```js
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workflows = require('../server/services/creativeWorkflows');

const WORKFLOW_ID = '202606180000000001';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'creative-workflow-task-summary-'));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

(async () => {
  const rootDir = tempRoot();
  const services = {
    idFactory: () => WORKFLOW_ID,
    researchService: {
      createResearchContext: async ({ now }) => ({ status: 'disabled', query: '', sources: [], summary: '', updated_at: now }),
    },
  };

  await workflows.createCreativeWorkflow({ input: '测试后台任务', useResearch: false }, { rootDir, services });

  const updated = await workflows.patchCreativeWorkflowTaskSummary(WORKFLOW_ID, {
    active_task_id: 'creative-task-1',
    active_operation_id: 'workflow-op-1',
    task_status: 'running',
    current_stage: 'project',
    current_stage_message: '正在生成第 1/2 帧 HTML...',
    current_progress: 55,
    last_event_seq: 7,
    updated_at: '2026-06-18T00:00:00.000Z',
  }, { rootDir });

  assert.equal(updated.success, true);
  assert.equal(updated.data.active_task_id, 'creative-task-1');
  assert.equal(updated.data.current_progress, 55);
  assert.equal(updated.data.last_event_seq, 7);

  const persisted = readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
  assert.equal(persisted.active_task_id, 'creative-task-1');
  assert.equal(persisted.active_operation_id, 'workflow-op-1');
  assert.equal(persisted.task_status, 'running');
  assert.equal(persisted.current_stage, 'project');
  assert.equal(persisted.current_stage_message, '正在生成第 1/2 帧 HTML...');
  assert.equal(persisted.current_progress, 55);
  assert.equal(persisted.last_event_seq, 7);

  const cleared = await workflows.clearCreativeWorkflowTaskSummary(WORKFLOW_ID, { rootDir });
  assert.equal(cleared.success, true);
  const clearedPersisted = readJson(workflows.getWorkflowPath(WORKFLOW_ID, rootDir));
  assert.equal(clearedPersisted.active_task_id, '');
  assert.equal(clearedPersisted.task_status, '');

  console.log('creative workflow task summary tests passed');
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-creative-workflow-task-summary.js
```

Expected: FAIL because `patchCreativeWorkflowTaskSummary` is not defined.

- [ ] **Step 3: Add task summary fields and helpers**

Modify `server/services/creativeWorkflows.js`:

Add to `createWorkflowSummary(record)`:

```js
    active_task_id: record.active_task_id || '',
    active_operation_id: record.active_operation_id || '',
    task_status: record.task_status || '',
    current_stage: record.current_stage || '',
    current_stage_message: record.current_stage_message || '',
    current_progress: Number.isFinite(record.current_progress) ? record.current_progress : 0,
    last_event_seq: Number.isFinite(record.last_event_seq) ? record.last_event_seq : 0,
```

Add to the new workflow record in `createCreativeWorkflow()`:

```js
    active_task_id: '',
    active_operation_id: '',
    task_status: '',
    current_stage: '',
    current_stage_message: '',
    current_progress: 0,
    last_event_seq: 0,
```

Add helper functions before `deleteCreativeWorkflow()`:

```js
async function patchCreativeWorkflowTaskSummary(workflowId, patch = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  try {
    const record = await readWorkflow(workflowId, rootDir);
    const now = safeString(patch.updated_at) || getNow(resolveServices(options)) || new Date().toISOString();
    record.active_task_id = safeString(patch.active_task_id ?? record.active_task_id);
    record.active_operation_id = safeString(patch.active_operation_id ?? record.active_operation_id);
    record.task_status = safeString(patch.task_status ?? record.task_status);
    record.current_stage = safeString(patch.current_stage ?? record.current_stage);
    record.current_stage_message = safeString(patch.current_stage_message ?? record.current_stage_message);
    const progress = Number(patch.current_progress ?? record.current_progress);
    record.current_progress = Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : 0;
    const seq = Number(patch.last_event_seq ?? record.last_event_seq);
    record.last_event_seq = Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : 0;
    if (patch.status) record.status = safeString(patch.status);
    if (patch.message) record.message = safeString(patch.message);
    if (Object.prototype.hasOwnProperty.call(patch, 'error')) record.error = patch.error || null;
    record.updated_at = now;
    const persisted = await persistWorkflow(record, rootDir);
    return { success: true, workflow_id: record.workflow_id, data: persisted };
  } catch (error) {
    return { success: false, workflow_id: safeString(workflowId), message: `更新创作任务进度失败：${error.message}` };
  }
}

async function clearCreativeWorkflowTaskSummary(workflowId, options = {}) {
  return patchCreativeWorkflowTaskSummary(workflowId, {
    active_task_id: '',
    active_operation_id: '',
    task_status: '',
    current_stage: '',
    current_stage_message: '',
    current_progress: 0,
    last_event_seq: 0,
  }, options);
}
```

Export both functions in `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node tests/test-creative-workflow-task-summary.js
```

Expected: PASS with `creative workflow task summary tests passed`.

- [ ] **Step 5: Run existing workflow tests**

Run:

```powershell
node tests/test-creative-workflows.js
```

Expected: PASS with `creative workflow tests passed`.

- [ ] **Step 6: Commit**

```powershell
git add server/services/creativeWorkflows.js tests/test-creative-workflow-task-summary.js
git commit -m "为创作任务保存后台进度摘要"
```

---

### Task 4: Workflow Task Orchestrator and Active-Task-Aware Stale Handling

**Files:**
- Create: `server/services/creativeWorkflowTasks.js`
- Modify: `server/services/creativeWorkflows.js`
- Test: `tests/test-creative-workflow-tasks.js`
- Test: `tests/test-creative-workflows.js`

- [ ] **Step 1: Write failing tests for task start, event persistence, and stale bypass**

Create `tests/test-creative-workflow-tasks.js`:

```js
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workflows = require('../server/services/creativeWorkflows');
const { createCreativeTaskRegistry } = require('../server/services/creativeTaskRegistry');
const workflowTasks = require('../server/services/creativeWorkflowTasks');

const WORKFLOW_ID = '202606180000000001';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'creative-workflow-tasks-'));
}

function services(now = '2026-06-18T00:00:00.000Z') {
  return {
    idFactory: () => WORKFLOW_ID,
    now: () => now,
    researchService: {
      createResearchContext: async ({ now: n }) => ({ status: 'disabled', query: '', sources: [], summary: '', updated_at: n }),
    },
  };
}

(async () => {
  const rootDir = tempRoot();
  await workflows.createCreativeWorkflow({ input: '测试后台任务', useResearch: false }, { rootDir, services: services() });
  const registry = createCreativeTaskRegistry({
    idFactory: () => 'creative-task-test',
    now: () => '2026-06-18T00:00:00.000Z',
  });
  const runCalls = [];

  const started = await workflowTasks.startCreativeWorkflowTask(WORKFLOW_ID, {
    rootDir,
    registry,
    services: {
      ...services(),
      creativeWorkflows: {
        runCreativeWorkflow: async (workflowId, options) => {
          runCalls.push({ workflowId, hasTaskContext: Boolean(options.taskContext) });
          options.taskContext.emit({
            type: 'stage_progress',
            stage: 'project',
            progress: 50,
            message: '正在生成第 1/2 帧 HTML...',
          });
          return { success: true, workflow_id: workflowId, status: 'done', message: '完成' };
        },
      },
    },
  });

  assert.equal(started.success, true);
  assert.equal(started.task_id, 'creative-task-test');
  assert.equal(started.active_task.status, 'running');
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(runCalls, [{ workflowId: WORKFLOW_ID, hasTaskContext: true }]);

  const task = registry.getTask(started.task_id);
  assert.equal(task.status, 'done');
  assert.equal(task.events.some(event => event.message === '正在生成第 1/2 帧 HTML...'), true);

  const fetched = await workflows.getCreativeWorkflow(WORKFLOW_ID, {
    rootDir,
    services: { now: () => '2026-06-18T00:20:00.000Z' },
    taskRegistry: registry,
  });
  assert.equal(fetched.success, true);
  assert.notEqual(fetched.data.status, 'failed');

  console.log('creative workflow task tests passed');
})();
```

Extend `tests/test-creative-workflows.js` near the stale test with a test that a running stage is not marked stale when `taskRegistry.activeTaskForWorkflow()` returns a running task:

```js
async function testDoesNotMarkRunningStageStaleWhenActiveTaskExists() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices({
    services: {
      now: () => '2026-06-12T12:20:00.000Z',
    },
  });

  await createCreativeWorkflow({ input: '做一期关于 AI 视频生产的知识科普' }, { rootDir, mediaRoot, services });
  const filePath = getWorkflowPath(WORKFLOW_ID, rootDir);
  const record = readJson(filePath);
  record.status = 'running';
  record.active_task_id = 'creative-task-running';
  record.stages = record.stages.map(stage => (
    stage.id === 'project'
      ? { ...stage, status: 'running', updated_at: '2026-06-12T12:00:00.000Z', started_at: '2026-06-12T12:00:00.000Z' }
      : stage
  ));
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');

  const fetched = await getCreativeWorkflow(WORKFLOW_ID, {
    rootDir,
    services,
    taskRegistry: {
      activeTaskForWorkflow: () => ({
        task_id: 'creative-task-running',
        workflow_id: WORKFLOW_ID,
        operation_id: 'workflow-op',
        kind: 'creative_workflow',
        status: 'running',
      }),
    },
  });

  assert.equal(fetched.success, true);
  assert.equal(fetched.data.status, 'running');
  assert.equal(fetched.data.stages.find(stage => stage.id === 'project').status, 'running');
}
```

Add the new test call in the `run()` list.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
node tests/test-creative-workflow-tasks.js
node tests/test-creative-workflows.js
```

Expected: first fails because `creativeWorkflowTasks` does not exist; second fails because active task does not bypass stale.

- [ ] **Step 3: Implement workflow task service**

Create `server/services/creativeWorkflowTasks.js`:

```js
const defaultCreativeWorkflows = require('./creativeWorkflows');
const { defaultRegistry } = require('./creativeTaskRegistry');
const { calculateProjectProgress, calculateWorkflowProgress, isTerminalEvent } = require('./creativeTaskEvents');

function createOperationId(workflowId) {
  const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]+/g, '-');
  return `workflow-${workflowId}-${stamp}`;
}

function htmlVideoProjectProgress(event = {}) {
  const data = event.data || {};
  switch (event.type) {
    case 'html_video_template_selected':
      return calculateProjectProgress({ step: 'template', stepProgress: 100 });
    case 'html_video_graph_started':
      return calculateProjectProgress({ step: 'graph', stepProgress: 10 });
    case 'html_video_graph_done':
      return calculateProjectProgress({ step: 'graph', stepProgress: 100 });
    case 'html_video_frame_html_started':
      return calculateProjectProgress({ step: 'frame_html', index: data.index || 0, total: data.total || 1, stepProgress: 10 });
    case 'html_video_frame_html_done':
      return calculateProjectProgress({ step: 'frame_html', index: data.index || 0, total: data.total || 1, stepProgress: 100 });
    case 'html_video_frame_render_progress':
      return calculateProjectProgress({ step: 'frame_render', index: data.index || 0, total: data.total || 1, stepProgress: data.percent || event.frame_progress || 0 });
    case 'html_video_compose_started':
      return calculateProjectProgress({ step: 'compose', stepProgress: 10 });
    case 'html_video_export_ready':
      return calculateProjectProgress({ step: 'compose', stepProgress: 100 });
    default:
      return null;
  }
}

function taskEventProgress(event = {}) {
  if (Number.isFinite(event.progress)) return event.progress;
  const projectProgress = String(event.type || '').startsWith('html_video_')
    ? htmlVideoProjectProgress(event)
    : null;
  if (Number.isFinite(projectProgress)) {
    return calculateWorkflowProgress({ stage: 'project', stageProgress: projectProgress });
  }
  return calculateWorkflowProgress({ stage: event.stage, stageProgress: event.stage_progress || 0 });
}

async function emitAndPersistTaskEvent({ registry, taskId, workflowId, operationId, event, rootDir, creativeWorkflows = defaultCreativeWorkflows }) {
  const emitted = registry.emit(taskId, { ...event, operation_id: operationId });
  if (!emitted) return null;
  const progress = taskEventProgress(event);
  const result = await creativeWorkflows.patchCreativeWorkflowTaskSummary(workflowId, {
    active_task_id: taskId,
    active_operation_id: operationId,
    task_status: event.type === 'task_failed' ? 'failed' : event.type === 'task_done' ? 'done' : 'running',
    current_stage: event.stage || '',
    current_stage_message: event.message || '',
    current_progress: progress,
    last_event_seq: emitted.seq,
  }, { rootDir });
  if (!result.success) {
    registry.emit(taskId, {
      type: 'workflow_persist_failed',
      stage: event.stage,
      message: `保存任务进度失败：${result.message}`,
      data: { failed_event_seq: emitted.seq },
    });
  }
  return emitted;
}

async function startCreativeWorkflowTask(workflowId, options = {}) {
  const rootDir = options.rootDir;
  const registry = options.registry || defaultRegistry;
  const creativeWorkflows = options.services?.creativeWorkflows || defaultCreativeWorkflows;
  const operationId = options.operationId || createOperationId(workflowId);
  const taskId = registry.createDetachedTask({
    workflowId,
    operationId,
    kind: 'creative_workflow',
  });

  await creativeWorkflows.patchCreativeWorkflowTaskSummary(workflowId, {
    active_task_id: taskId,
    active_operation_id: operationId,
    task_status: 'running',
    current_stage: 'queued',
    current_stage_message: '后台创作任务已启动。',
    current_progress: 0,
  }, { rootDir });

  registry.emit(taskId, { type: 'task_started', message: '后台创作任务已启动。' });

  setImmediate(async () => {
    const taskContext = {
      taskId,
      operationId,
      emit: event => emitAndPersistTaskEvent({
        registry,
        taskId,
        workflowId,
        operationId,
        event,
        rootDir,
        creativeWorkflows,
      }),
    };

    try {
      await creativeWorkflows.runCreativeWorkflow(workflowId, {
        ...(options.workflowOptions || {}),
        taskContext,
      });
      await taskContext.emit({ type: 'task_done', progress: 100, message: '创作任务已完成。' });
      registry.markDone(taskId, '创作任务已完成。');
      await creativeWorkflows.patchCreativeWorkflowTaskSummary(workflowId, {
        active_task_id: '',
        active_operation_id: operationId,
        task_status: 'done',
        current_stage_message: '创作任务已完成。',
        current_progress: 100,
      }, { rootDir });
    } catch (error) {
      await taskContext.emit({ type: 'task_failed', message: error.message || '创作任务失败。' });
      registry.markFailed(taskId, error);
    }
  });

  return {
    success: true,
    workflow_id: workflowId,
    task_id: taskId,
    active_task: registry.activeTaskForWorkflow(workflowId),
  };
}

module.exports = {
  startCreativeWorkflowTask,
  emitAndPersistTaskEvent,
};
```

When implementing, keep task service options and workflow runner options separate. `startCreativeWorkflowTask()` uses `options.rootDir` only for workflow-summary writes. Any `rootDir`, `mediaRoot`, `skipValidation`, or `services` needed by `runCreativeWorkflow()` must be passed through `options.workflowOptions`. The exact runner call is:

```js
await creativeWorkflows.runCreativeWorkflow(workflowId, {
  ...(options.workflowOptions || {}),
  taskContext,
});
```

The test fake ignores `rootDir`; the real route will pass `workflowOptions` containing any needed values.

- [ ] **Step 4: Make stale handling active-task aware**

Modify `server/services/creativeWorkflows.js`:

`runCreativeWorkflow(workflowId, options = {})` already accepts an options object; do not change the exported function arity. Inside the function, read the new optional task context once near the existing `rootDir`, `mediaRoot`, and `services` setup:

```js
const taskContext = options.taskContext || null;
```

In `getCreativeWorkflow()` pass `options.taskRegistry` to stale handling:

```js
const nextRecord = await markStaleRunningStageFailed(record, rootDir, services, options);
```

Modify `markStaleRunningStageFailed()` before `findStaleRunningStage()`:

```js
  const activeTask = options.taskRegistry?.activeTaskForWorkflow?.(record.workflow_id);
  if (activeTask && activeTask.status === 'running') {
    record.active_task = activeTask;
    return record;
  }
```

Include `active_task` in `createWorkflowSummary(record)`:

```js
    active_task: record.active_task || null,
```

Add `taskContext` reporting to `runStage()`. Replace the current function declaration with the same parameters plus `taskContext = null`, then add the event calls at the current start/success/failure points:

```js
async function runStage(record, stageId, rootDir, handler, services, taskContext = null) {
  const startedAt = getNow(services);
  await markStage(record, stageId, 'running', `${STAGE_LABELS[stageId]}进行中。`, startedAt, {
    started_at: startedAt,
  });
  record.status = 'running';
  record.updated_at = startedAt;
  await persistWorkflow(record, rootDir);

  if (taskContext?.emit) {
    await taskContext.emit({
      type: 'stage_started',
      stage: stageId,
      stage_progress: 0,
      message: `正在${STAGE_LABELS[stageId]}...`,
    });
  }

  const reportStage = async (message, progress = 50, data = {}) => {
    if (taskContext?.emit) {
      await taskContext.emit({
        type: 'stage_progress',
        stage: stageId,
        stage_progress: progress,
        message,
        data,
      });
    }
  };

  const result = await handler({ reportStage, taskContext });

  if (result === WORKFLOW_STOPPED || result === null) return result;
  const completedAt = getNow(services);
  await markStage(record, stageId, 'done', result?.message || `${STAGE_LABELS[stageId]}完成。`, completedAt, {
    completed_at: completedAt,
    result,
  });
  record.updated_at = completedAt;
  await persistWorkflow(record, rootDir);

  if (taskContext?.emit) {
    await taskContext.emit({
      type: 'stage_done',
      stage: stageId,
      stage_progress: 100,
      message: result?.message || `${STAGE_LABELS[stageId]}完成。`,
    });
  }
  return result;
}
```

Inside the existing `catch` branch of `runStage()`, emit failure before returning `null`:

```js
    if (taskContext?.emit) {
      await taskContext.emit({
        type: 'stage_failed',
        stage: stageId,
        stage_progress: 100,
        message,
      });
    }
    return null;
```

Update every existing `runStage(record, stageId, rootDir, handler, services)` call in `runCreativeWorkflow()` so the final argument is the local `taskContext`. Existing inline handlers can ignore the `{ reportStage, taskContext }` argument. Do not rely on existing handlers calling `reportStage`; the required baseline events come from `runStage()` start/done/fail, and html-video sub-step events are added by Task 8 through `onProgress`.

- [ ] **Step 5: Run tests to verify they pass**

Run:

```powershell
node tests/test-creative-workflow-tasks.js
node tests/test-creative-workflows.js
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```powershell
git add server/services/creativeWorkflowTasks.js server/services/creativeWorkflows.js tests/test-creative-workflow-tasks.js tests/test-creative-workflows.js
git commit -m "接入创作后台任务状态"
```

---

### Task 5: Creative Workflow Routes and SSE Stream

**Files:**
- Modify: `server/routes/creativeWorkflows.js`
- Modify: `tests/test-creative-workflow-routes.js`

- [ ] **Step 1: Extend route tests**

Modify `tests/test-creative-workflow-routes.js`.

Add helper:

```js
async function requestSse(server, pathName, body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: text, headers: res.headers }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body || {}));
    req.end();
  });
}
```

Extend `createFakeCreativeWorkflows()` service with:

```js
      startCreativeWorkflowTask: async id => ({
        success: true,
        workflow_id: id,
        task_id: 'creative-task-route',
        active_task: {
          task_id: 'creative-task-route',
          workflow_id: id,
          operation_id: 'workflow-op-route',
          kind: 'creative_workflow',
          status: 'running',
        },
      }),
      subscribeCreativeWorkflowEvents: async ({ workflowId, taskId, sinceSeq, writeEvent }) => {
        writeEvent({ seq: sinceSeq + 1, type: 'stage_progress', workflow_id: workflowId, task_id: taskId, message: '正在生成工程...' });
        writeEvent({ seq: sinceSeq + 2, type: 'task_stream_closed', workflow_id: workflowId, task_id: taskId, status: 'done', final_seq: sinceSeq + 2, message: '任务事件流已结束。' });
      },
      getActiveCreativeWorkflowTask: async id => ({
        success: true,
        workflow_id: id,
        active_task: { task_id: 'creative-task-route', workflow_id: id, status: 'running' },
      }),
```

Update `assertMountedPost()` expectations:

```js
  assert.strictEqual(createResponse.statusCode, 202);
  assert.strictEqual(createResponse.body.task_id, 'creative-task-route');
  assert.strictEqual(createResponse.body.active_task.status, 'running');
```

Remove the assertion that `runCreativeWorkflow` was called by `setImmediate`, because route creation now delegates to `startCreativeWorkflowTask()`.

Add SSE assertion in `runIsolatedRouterTests()`:

```js
    const sseResponse = await requestSse(server, `/api/creative-workflows/${fake.workflowId}/events`, {
      task_id: 'creative-task-route',
      since_seq: 0,
    });
    assert.strictEqual(sseResponse.statusCode, 200);
    assert.match(sseResponse.headers['content-type'], /text\/event-stream/);
    assert.match(sseResponse.body, /event: stage_progress/);
    assert.match(sseResponse.body, /任务事件流已结束/);

    const activeResponse = await requestJson(server, 'GET', `/api/creative-workflows/${fake.workflowId}/tasks/active`);
    assert.strictEqual(activeResponse.statusCode, 200);
    assert.strictEqual(activeResponse.body.active_task.task_id, 'creative-task-route');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-creative-workflow-routes.js
```

Expected: FAIL because route still returns 200 and lacks `/events`.

- [ ] **Step 3: Implement routes**

Modify `server/routes/creativeWorkflows.js`:

Import task service:

```js
const defaultCreativeWorkflowTasks = require('../services/creativeWorkflowTasks');
const { formatSseEvent, normalizeSinceSeq } = require('../services/creativeTaskEvents');
```

Add service getters:

```js
function getTaskService(req) {
  return req.app?.locals?.creativeWorkflowTasks || defaultCreativeWorkflowTasks;
}
```

Change `router.post('/')` after create success:

```js
    const taskService = getTaskService(req);
    const workflowOptions = {};
    if (req.body && req.body.skipValidation === true) workflowOptions.skipValidation = true;
    const started = await taskService.startCreativeWorkflowTask(result.workflow_id, { workflowOptions });
    if (!started.success) {
      return res.status(500).json({
        success: false,
        workflow_id: result.workflow_id,
        message: started.message || '创建后台创作任务失败。',
      });
    }
    return res.status(202).json({
      ...result,
      task_id: started.task_id,
      active_task: started.active_task,
      message: result.message || '创作任务已创建，正在后台执行。',
    });
```

Add SSE route before `router.get('/:workflow_id')`:

```js
router.post('/:workflow_id/events', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const taskId = safeString(req.body?.task_id);
  const sinceSeq = normalizeSinceSeq(req.body?.since_seq);
  if (!taskId) {
    return res.status(400).json({ success: false, workflow_id: validation.workflow_id, message: '缺少后台任务 ID。' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let subscriptionResult = null;
  let streamWriteFailed = false;
  const writeEvent = event => {
    try {
      if (res.writableEnded || res.destroyed) return false;
      res.write(formatSseEvent(event));
      return true;
    } catch {
      streamWriteFailed = true;
      subscriptionResult?.unsubscribe?.();
      if (!res.writableEnded) res.end();
      return false;
    }
  };

  req.on('close', () => {
    subscriptionResult?.unsubscribe?.();
  });

  try {
    subscriptionResult = await getTaskService(req).subscribeCreativeWorkflowEvents({
      workflowId: validation.workflow_id,
      taskId,
      sinceSeq,
      writeEvent,
      onClose: () => {
        if (!res.writableEnded) res.end();
      },
    });
    if (streamWriteFailed) subscriptionResult?.unsubscribe?.();
  } catch (error) {
    writeEvent({
      seq: sinceSeq + 1,
      type: 'task_stream_closed',
      workflow_id: validation.workflow_id,
      task_id: taskId,
      status: 'failed',
      final_seq: sinceSeq + 1,
      message: `读取任务事件失败：${error.message}`,
    });
    if (!res.writableEnded) res.end();
  }
});

router.get('/:workflow_id/tasks/active', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const result = await getTaskService(req).getActiveCreativeWorkflowTask(validation.workflow_id);
  return res.json(result);
});
```

Implement route-facing wrappers in `server/services/creativeWorkflowTasks.js`:

```js
async function subscribeCreativeWorkflowEvents({ workflowId, taskId, sinceSeq, writeEvent, onClose, registry = defaultRegistry }) {
  const task = registry.getTask(taskId);
  if (!task || task.workflow_id !== String(workflowId)) {
    writeEvent({ seq: sinceSeq + 1, type: 'task_stream_closed', workflow_id: workflowId, task_id: taskId, status: 'failed', final_seq: sinceSeq + 1, message: '未找到后台任务事件流。' });
    onClose?.();
    return { success: false };
  }
  let closed = false;
  let subscription = null;
  const safeWrite = event => {
    if (closed) return false;
    try {
      return writeEvent(event) !== false;
    } catch {
      closed = true;
      subscription?.unsubscribe?.();
      onClose?.();
      return false;
    }
  };
  const closeStream = finalEvent => {
    if (closed) return;
    const finalSeq = finalEvent?.seq || task.events.at(-1)?.seq || sinceSeq;
    safeWrite({
      seq: finalSeq + 1,
      type: 'task_stream_closed',
      workflow_id: workflowId,
      task_id: taskId,
      status: finalEvent?.type === 'workflow_deleted' ? 'deleted' : task.status,
      final_seq: finalSeq,
      message: '任务事件流已结束。',
    });
    closed = true;
    onClose?.();
  };
  subscription = registry.subscribe(taskId, sinceSeq, event => {
    if (!safeWrite(event)) {
      closed = true;
      subscription?.unsubscribe?.();
      onClose?.();
      return;
    }
    if (isTerminalEvent(event)) {
      closeStream(event);
    }
  });
  if (closed) {
    subscription?.unsubscribe?.();
    return { success: true, unsubscribe: () => {} };
  }
  if (!subscription || subscription.finished) {
    closeStream(task.events.at(-1));
    return { success: true };
  }
  return {
    success: true,
    unsubscribe: () => {
      closed = true;
      subscription.unsubscribe();
    },
  };
}

async function getActiveCreativeWorkflowTask(workflowId, options = {}) {
  const registry = options.registry || defaultRegistry;
  return { success: true, workflow_id: String(workflowId), active_task: registry.activeTaskForWorkflow(workflowId) };
}

module.exports = {
  startCreativeWorkflowTask,
  emitAndPersistTaskEvent,
  subscribeCreativeWorkflowEvents,
  getActiveCreativeWorkflowTask,
};
```

Replace the earlier `module.exports` block in this file with the four-function export shown above.

- [ ] **Step 4: Run route tests**

Run:

```powershell
node tests/test-creative-workflow-routes.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/routes/creativeWorkflows.js server/services/creativeWorkflowTasks.js tests/test-creative-workflow-routes.js
git commit -m "新增创作任务事件流接口"
```

---

### Task 6: Startup Recovery and Delete Checkpoints

**Files:**
- Modify: `server/index.js`
- Modify: `server/services/creativeWorkflowTasks.js`
- Modify: `server/services/creativeWorkflows.js`
- Test: `tests/test-creative-workflow-tasks.js`

- [ ] **Step 1: Add failing recovery tests**

Append to `tests/test-creative-workflow-tasks.js` before the final log:

```js
  const recoveryRoot = tempRoot();
  await workflows.createCreativeWorkflow({ input: '重启恢复测试', useResearch: false }, {
    rootDir: recoveryRoot,
    services: services('2026-06-18T00:00:00.000Z'),
  });
  await workflows.patchCreativeWorkflowTaskSummary(WORKFLOW_ID, {
    active_task_id: 'lost-task',
    active_operation_id: 'lost-op',
    task_status: 'running',
    current_stage: 'project',
    current_stage_message: '正在生成工程...',
    current_progress: 60,
  }, { rootDir: recoveryRoot });
  const recovered = await workflowTasks.recoverOrphanedWorkflows({
    rootDir: recoveryRoot,
    services: { now: () => '2026-06-18T00:05:00.000Z' },
    registry: createCreativeTaskRegistry(),
  });
  assert.equal(recovered.recovered, 1);
  const recoveredWorkflow = await workflows.getCreativeWorkflow(WORKFLOW_ID, { rootDir: recoveryRoot });
  assert.equal(recoveredWorkflow.data.status, 'failed');
  assert.match(recoveredWorkflow.data.message, /服务器重启/);
  assert.equal(recoveredWorkflow.data.active_task_id, '');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-creative-workflow-tasks.js
```

Expected: FAIL because `recoverOrphanedWorkflows` does not exist.

- [ ] **Step 3: Implement recovery**

In `server/services/creativeWorkflows.js`, export a helper:

```js
async function listCreativeWorkflowRecords(options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  let files;
  try { files = await fsp.readdir(rootDir); } catch { return []; }
  const records = [];
  for (const file of files.filter(name => WORKFLOW_ID_PATTERN.test(path.basename(name, '.json')) && name.endsWith('.json'))) {
    try { records.push(await readJson(path.join(rootDir, file))); } catch {}
  }
  return records;
}
```

`DEFAULT_ROOT` is the existing `server/services/creativeWorkflows.js` workflow store root, currently `path.join(__dirname, '../../data/creative-workflows')`. Do not scan `data/`, `data/media/`, or any caller-provided parent directory unless tests explicitly pass a temporary workflow root. Export `listCreativeWorkflowRecords`.

In `server/services/creativeWorkflowTasks.js` add:

```js
async function recoverOrphanedWorkflows(options = {}) {
  const registry = options.registry || defaultRegistry;
  const creativeWorkflows = options.creativeWorkflows || defaultCreativeWorkflows;
  const rootDir = options.rootDir;
  const records = await creativeWorkflows.listCreativeWorkflowRecords({ rootDir });
  let recovered = 0;
  for (const record of records) {
    if (record.status === 'running' && record.active_task_id && !registry.getTask(record.active_task_id)) {
      await creativeWorkflows.patchCreativeWorkflowTaskSummary(record.workflow_id, {
        active_task_id: '',
        active_operation_id: '',
        task_status: 'failed',
        current_stage_message: '服务器重启，后台创作任务被中断，请重新创建任务。',
        status: 'failed',
        message: '服务器重启，后台创作任务被中断，请重新创建任务。',
        error: {
          stale: true,
          reason: 'server_restart',
          message: '服务器重启，后台创作任务被中断，请重新创建任务。',
          updated_at: options.services?.now?.() || new Date().toISOString(),
        },
      }, { rootDir });
      recovered += 1;
    } else if ((record.status === 'done' || record.status === 'failed') && record.active_task_id) {
      await creativeWorkflows.clearCreativeWorkflowTaskSummary(record.workflow_id, { rootDir });
      recovered += 1;
    }
  }
  return { success: true, recovered };
}
```

Add `recoverOrphanedWorkflows` to the existing exports:

```js
module.exports = {
  startCreativeWorkflowTask,
  emitAndPersistTaskEvent,
  subscribeCreativeWorkflowEvents,
  getActiveCreativeWorkflowTask,
  recoverOrphanedWorkflows,
};
```

Modify `server/index.js` startup:

```js
const creativeWorkflowTasks = require('./services/creativeWorkflowTasks');

async function runStartupRecovery() {
  await creativeWorkflowTasks.recoverOrphanedWorkflows();
  await creativeWorkflows.recoverStaleWorkflowsOnStartup();
}

runStartupRecovery().catch(err => {
  console.error('[startup] 清理卡死的创作任务失败:', err.message);
});
```

- [ ] **Step 4: Run tests**

Run:

```powershell
node tests/test-creative-workflow-tasks.js
node tests/test-dev-startup.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/index.js server/services/creativeWorkflowTasks.js server/services/creativeWorkflows.js tests/test-creative-workflow-tasks.js
git commit -m "恢复重启中断的创作后台任务"
```

---

### Task 7: html-video Progress Plumbing

**Files:**
- Modify: `server/services/agentRuns.js`
- Modify: `server/services/creative-video/workflowFacade.js`
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Modify: `server/services/creative-video/html-video/projectOrchestrator.js`
- Test: `tests/test-html-video-workflow.js`
- Test: `tests/test-html-video-project-orchestrator-modes.js`

- [ ] **Step 1: Add failing html-video progress tests**

In `tests/test-html-video-workflow.js`, add a new raw HTML workflow test after the existing raw path test:

```js
  const progressEvents = [];
  const progressResult = await workflow.generateHtmlVideo({
    workflowId: '202606170000000003_progress',
    runId: 'run_progress',
    rootDir,
    sceneSpec: {
      title: '进度测试',
      aspect_ratio: '9:16',
      scenes: [{ id: 'scene_01', duration: 2, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '进度' } }],
    },
    creativeContext: { input: { raw_text: '进度测试' } },
    target: {},
    templateRegistry,
    skipValidation: true,
    onProgress: event => progressEvents.push(event),
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          if (prompt.includes('"template_id"')) return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏' }) };
          if (prompt.startsWith('你是 html-video 的 content graph')) {
            return { success: true, text: JSON.stringify({ synopsis: '进度', nodes: [{ id: 'scene_01', kind: 'text', label: '进度', durationSec: 2, text: '进度' }], edges: [] }) };
          }
          return { success: true, text: '<!doctype html><html><body><main data-frame-id="scene_01">进度</main></body></html>' };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      frameRenderer: {
        renderFrame: async (frame, options) => {
          options.onProgress?.({ frame, percent: 50, message: '正在录制 html-video 帧...' });
          return { success: true, frame_id: frame.id, output_path: path.join(options.projectDir, 'frames', `${frame.id}.mp4`), diagnostics: [] };
        },
      },
      ffmpegComposer: {
        concatFramesWithFfmpeg: async (frames, outputPath) => { await writeFile(outputPath, 'mp4'); return { success: true, output_path: outputPath }; },
        muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
      },
      visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
    },
  });
  assert.equal(progressResult.success, true);
  assert.ok(progressEvents.some(event => event.type === 'html_video_graph_started'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_frame_html_started'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_frame_render_progress'));
  assert.ok(progressEvents.some(event => event.type === 'html_video_export_ready'));
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected: FAIL because no progress events are emitted.

- [ ] **Step 3: Add onProgress plumbing**

In `workflowFacade.generateCreativeVideoProject()` add `onProgress` to the destructured options:

```js
async function generateCreativeVideoProject({
  workflowId,
  runId,
  creativeContext = {},
  target = {},
  rootDir,
  services = {},
  skipValidation = false,
  onProgress,
} = {}) {
  const resolved = getServices(services);
  let htmlVideoDiagnostics = [];
  let htmlVideoProjectPath = null;
  let legacyFallbackReason = null;
```

Pass `onProgress` into the existing html-video workflow call:

```js
  htmlVideoResult = await resolved.htmlVideoWorkflow.generateHtmlVideo({
    workflowId,
    runId,
    sceneSpec: sceneParsed.scene_spec,
    creativeContext,
    target,
    rootDir,
    services,
    skipValidation,
    onProgress,
  });
```

In `agentRuns.generateDouyinRunHyperframesFreeformProject()`, before calling facade:

```js
const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
```

Pass it into facade:

```js
onProgress: event => {
  if (onProgress) onProgress({ stage: 'project', ...event });
},
```

In `htmlVideoWorkflow.generateHtmlVideo()` accept `onProgress`:

```js
function report(onProgress, event) {
  if (typeof onProgress === 'function') onProgress(event);
}
```

Emit events at key points:

```js
report(onProgress, { type: 'html_video_template_selected', stage: 'project', message: `已选择 html-video 模板：${template.id}。`, data: { template_id: template.id } });
report(onProgress, { type: 'html_video_graph_started', stage: 'project', message: '正在规划 content graph...' });
report(onProgress, { type: 'html_video_graph_done', stage: 'project', message: `content graph 已生成：${nodes.length} 帧。`, data: { frame_count: nodes.length } });
report(onProgress, { type: 'html_video_frame_html_started', stage: 'project', message: `正在生成第 ${index + 1}/${nodes.length} 帧 HTML...`, data: { frame_id: nodes[index].id, index, total: nodes.length } });
report(onProgress, { type: 'html_video_frame_html_done', stage: 'project', message: `第 ${index + 1}/${nodes.length} 帧 HTML 已生成。`, data: { frame_id: nodes[index].id, index, total: nodes.length } });
```

In `htmlVideoWorkflow.generateHtmlVideo()`, add `onProgress` to the destructured options:

```js
async function generateHtmlVideo({
  workflowId,
  runId,
  rootDir,
  sceneSpec = null,
  creativeContext = {},
  target = {},
  templateRegistry,
  services = {},
  skipValidation = false,
  onProgress,
} = {}) {
```

Pass to orchestrator by adding `onProgress` to the existing `renderHtmlVideoProject()` call:

```js
const rendered = await projectOrchestrator.renderHtmlVideoProject({
  rootDir,
  workflowId,
  runId,
  projectDir,
  project,
  templateRegistry: registry,
  services,
  onProgress,
});
```

In `projectOrchestrator.renderHtmlVideoProject()` add `onProgress` to the destructured options:

```js
async function renderHtmlVideoProject({
  rootDir,
  workflowId,
  runId,
  projectDir,
  project,
  templateRegistry,
  services = {},
  skipRender = false,
  onProgress,
} = {}) {
```

Pass to `frameRenderer.renderFrame()` by adding the callback to the existing options object:

```js
const rendered = await frameRenderer.renderFrame(frame, {
  projectDir: resolvedProjectDir,
  workflowId,
  runId,
  onProgress: progress => {
    onProgress?.({
      type: 'html_video_frame_render_progress',
      stage: 'project',
      message: progress.message || '正在渲染 html-video 帧...',
      data: {
        frame_id: frame.id,
        index: renderedFrames.length,
        total: nextProject.frames.length,
        percent: progress.percent,
      },
    });
  },
});
```

Emit compose/export:

```js
onProgress?.({ type: 'html_video_compose_started', stage: 'project', message: '正在合成 html-video 视频...' });
onProgress?.({ type: 'html_video_export_ready', stage: 'project', message: 'html-video 成片已导出。', data: { output_path: finalOutput } });
```

- [ ] **Step 4: Run html-video tests**

Run:

```powershell
node tests/test-html-video-workflow.js
node tests/test-html-video-project-orchestrator-modes.js
node tests/test-creative-video-workflow-facade.js
node tests/test-agent-runs.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/agentRuns.js server/services/creative-video/workflowFacade.js server/services/creative-video/html-video/htmlVideoWorkflow.js server/services/creative-video/html-video/projectOrchestrator.js tests/test-html-video-workflow.js tests/test-html-video-project-orchestrator-modes.js tests/test-creative-video-workflow-facade.js tests/test-agent-runs.js
git commit -m "贯通 html-video 生成进度事件"
```

---

### Task 8: Connect Workflow Task Context to html-video Progress

**Files:**
- Modify: `server/services/creativeWorkflows.js`
- Modify: `server/services/creativeWorkflowTasks.js`
- Test: `tests/test-creative-workflow-tasks.js`

- [ ] **Step 1: Add failing test for html-video project progress reaching task events**

Extend `tests/test-creative-workflow-tasks.js` with:

```js
  const progressRoot = tempRoot();
  await workflows.createCreativeWorkflow({ input: 'html-video 进度测试', useResearch: false }, {
    rootDir: progressRoot,
    services: services('2026-06-18T00:00:00.000Z'),
  });
  const progressRegistry = createCreativeTaskRegistry({ idFactory: () => 'creative-task-progress' });
  const startedProgress = await workflowTasks.startCreativeWorkflowTask(WORKFLOW_ID, {
    rootDir: progressRoot,
    registry: progressRegistry,
    workflowOptions: {
      rootDir: progressRoot,
      services: {
        ...services('2026-06-18T00:00:00.000Z'),
        agentRuns: {
          createDouyinHyperframesFreeformRun: async () => ({ success: true, run_id: 'run-progress', message: '已创建运行记录。' }),
          generateDouyinRunHyperframesFreeformBrief: async () => ({ success: true, message: 'brief 完成。' }),
          synthesizeDouyinRunHyperframesFreeformAudio: async () => ({ success: true, message: '音频完成。' }),
          generateDouyinRunHyperframesFreeformProject: async (awemeId, runId, options) => {
            await options.onProgress?.({ type: 'html_video_graph_started', message: '正在规划 content graph...' });
            return {
              success: true,
              message: 'html-video 完成。',
              hyperframes_freeform: {
                project: { status: 'ready', render_mode: 'html-video', html_video_project_path: 'project-dir' },
                render: { status: 'rendered' },
                visual_inspect: { status: 'passed' },
              },
            };
          },
        },
      },
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const progressTask = progressRegistry.getTask(startedProgress.task_id);
  assert.ok(progressTask.events.some(event => event.type === 'html_video_graph_started'));
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-creative-workflow-tasks.js
```

Expected: FAIL because task context is not passed as `onProgress` into project generation.

- [ ] **Step 3: Wire task context into project stage**

In `runCreativeWorkflow()` project stage call in `server/services/creativeWorkflows.js`, pass `onProgress`:

```js
      onProgress: async event => {
        if (options.taskContext?.emit) {
          await options.taskContext.emit({
            ...event,
            type: event.type || 'stage_progress',
            stage: 'project',
            message: event.message || '正在生成 html-video 工程...',
          });
        }
      },
```

This goes inside options passed to:

```js
services.agentRuns.generateDouyinRunHyperframesFreeformProject(record.aweme_id, record.run_id, {
  rootDir: mediaRoot,
  useHtmlVideoLiteWorkflow: true,
  skipValidation,
  projectOptions: {
    creative_context: record.creative_context,
  },
  onProgress: async event => {
    if (options.taskContext?.emit) {
      await options.taskContext.emit({
        ...event,
        type: event.type || 'stage_progress',
        stage: 'project',
        message: event.message || '正在生成 html-video 工程...',
      });
    }
  },
})
```

Ensure `runStage()` report does not duplicate every html-video sub-event as generic `stage_progress`; html-video events should keep their own `type`.

This depends on Task 4's `taskEventProgress()` implementation. Do not remove the `htmlVideoProjectProgress()` mapping there: `emitAndPersistTaskEvent()` must accept raw `html_video_*` events, preserve their event type for replay/UI logs, and calculate workflow progress from `event.data.index`, `event.data.total`, and `event.data.percent`. If a new html-video event type is added later, add it to `htmlVideoProjectProgress()` instead of converting it to generic `stage_progress`.

- [ ] **Step 4: Run task tests**

Run:

```powershell
node tests/test-creative-workflow-tasks.js
node tests/test-creative-workflows.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creativeWorkflows.js tests/test-creative-workflow-tasks.js
git commit -m "同步 html-video 进度到创作任务事件"
```

---

### Task 9: API Client Streaming Helper

**Files:**
- Modify: `frontend-react/src/api/client.js`
- Create: `tests/test-creative-task-api-client.mjs`

- [ ] **Step 1: Write failing static API client test**

Create `tests/test-creative-task-api-client.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../frontend-react/src/api/client.js'), 'utf8');

assert.match(source, /streamCreativeWorkflowEvents\(workflowId,\s*payload,\s*handlers\s*=\s*\{\}\)/);
assert.match(source, /Accept['"]?\s*:\s*['"]text\/event-stream['"]/);
assert.match(source, /method:\s*'POST'/);
assert.match(source, /response\.body\.getReader\(\)/);
assert.match(source, /since_seq/);
assert.match(source, /onEvent/);
assert.match(source, /AbortController/);

console.log('creative task api client tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-creative-task-api-client.mjs
```

Expected: FAIL because `streamCreativeWorkflowEvents` does not exist.

- [ ] **Step 3: Implement streaming helper**

Modify `frontend-react/src/api/client.js`, add helper before `export const api`:

```js
function parseSseChunk(buffer, onEvent) {
  const parts = buffer.split(/\n\n/);
  const rest = parts.pop() || '';
  for (const part of parts) {
    const dataLine = part.split(/\n/).find(line => line.startsWith('data: '));
    if (!dataLine) continue;
    try {
      onEvent(JSON.parse(dataLine.slice(6)));
    } catch {
      onEvent({ type: 'task_stream_parse_failed', message: '任务事件解析失败。' });
    }
  }
  return rest;
}

async function streamJsonSse(url, payload, handlers = {}) {
  const controller = new AbortController();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`任务事件流连接失败：HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let closed = false;
  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseChunk(buffer, event => handlers.onEvent?.(event));
      }
      if (buffer.trim()) parseSseChunk(`${buffer}\n\n`, event => handlers.onEvent?.(event));
      closed = true;
      handlers.onClose?.();
    } catch (error) {
      if (!closed) handlers.onError?.(error);
    }
  };
  pump();
  return {
    abort: () => {
      closed = true;
      controller.abort();
      reader.cancel().catch(() => {});
    },
  };
}
```

Add API method:

```js
  streamCreativeWorkflowEvents(workflowId, payload, handlers = {}) {
    return streamJsonSse(`/api/creative-workflows/${encodeURIComponent(workflowId)}/events`, {
      task_id: payload?.task_id || payload?.taskId || '',
      since_seq: payload?.since_seq ?? payload?.sinceSeq ?? 0,
    }, handlers);
  },
```

- [ ] **Step 4: Run test**

Run:

```powershell
node tests/test-creative-task-api-client.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend-react/src/api/client.js tests/test-creative-task-api-client.mjs
git commit -m "新增创作任务事件流客户端"
```

---

### Task 10: OneClickCreativePage SSE Subscription and Fallback Polling

**Files:**
- Modify: `frontend-react/src/pages/OneClickCreativePage.jsx`
- Modify: `tests/test-one-click-creative-page.mjs`

- [ ] **Step 1: Update frontend static test expectations**

Modify `tests/test-one-click-creative-page.mjs`:

Add assertions:

```js
assert.match(page, /ACTIVE_CREATIVE_TASK_STORAGE_KEY/, 'OneClickCreativePage should persist active creative task stream state');
assert.match(page, /streamCreativeWorkflowEvents/, 'OneClickCreativePage should subscribe to creative workflow event stream');
assert.match(page, /lastSeqRef/, 'OneClickCreativePage should track last received task event sequence');
assert.match(page, /activeTaskRef/, 'OneClickCreativePage should compare stream events against the active task ref');
assert.match(page, /loadActiveCreativeTask/, 'OneClickCreativePage should recover active stream state after refresh');
assert.match(page, /task_stream_closed/, 'OneClickCreativePage should stop reconnecting when stream closes normally');
assert.match(page, /streamClosedNormallyRef/, 'OneClickCreativePage should distinguish normal stream closure from errors');
assert.match(page, /since_seq/, 'OneClickCreativePage should reconnect with since_seq');
assert.match(page, /window\.setTimeout/, 'OneClickCreativePage should schedule SSE reconnects');
```

Keep the existing `setInterval` assertion because polling remains a fallback.

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-one-click-creative-page.mjs
```

Expected: FAIL because page lacks streaming subscription.

- [ ] **Step 3: Implement page state and subscription**

Modify `frontend-react/src/pages/OneClickCreativePage.jsx`:

Update the React import to include `useRef`:

```js
import { useEffect, useMemo, useRef, useState } from 'react';
```

Add key near `CREATIVE_TASKS_STORAGE_KEY`:

```js
const ACTIVE_CREATIVE_TASK_STORAGE_KEY = 'musedock.creative.activeTask.v1';
```

Add helpers:

```js
function saveActiveCreativeTask(value) {
  if (typeof window === 'undefined') return;
  if (!value?.workflow_id || !value?.task_id) {
    window.localStorage.removeItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY, JSON.stringify({
    workflow_id: value.workflow_id,
    task_id: value.task_id,
    last_seq: Number(value.last_seq || 0),
    updated_at: new Date().toISOString(),
  }));
}

function loadActiveCreativeTask() {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVE_CREATIVE_TASK_STORAGE_KEY) || 'null');
    return parsed?.workflow_id && parsed?.task_id ? parsed : null;
  } catch {
    return null;
  }
}
```

Inside component add refs/state:

```js
  const activeStreamRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const lastSeqRef = useRef(0);
  const activeTaskRef = useRef(null);
  const streamClosedNormallyRef = useRef(false);
  const [activeTask, setActiveTask] = useState(null);
```

Add event handler:

```js
  function applyTaskEvent(event) {
    const expectedWorkflowId = activeTaskRef.current?.workflow_id || workflowId;
    if (!event || (expectedWorkflowId && event.workflow_id !== expectedWorkflowId)) return;
    if (Number(event.seq) > 0) {
      lastSeqRef.current = Number(event.seq);
      saveActiveCreativeTask({ workflow_id: event.workflow_id, task_id: event.task_id, last_seq: lastSeqRef.current });
    }
    if (event.message) setMessage(event.message);
    if (event.type === 'stage_progress' || event.type?.startsWith('html_video_')) {
      setStatus('polling');
    }
    if (event.type === 'task_failed') {
      setStatus('failed');
      setMessage(event.message || '创作任务失败。');
    }
    if (event.type === 'task_done') {
      setStatus('done');
      setMessage(event.message || '创作任务已完成。');
    }
    if (event.type === 'task_stream_closed') {
      streamClosedNormallyRef.current = true;
      window.clearTimeout(reconnectTimerRef.current);
      if (activeStreamRef.current) activeStreamRef.current.abort();
      activeStreamRef.current = null;
      if (event.status === 'done') setStatus('done');
      if (event.status === 'failed') setStatus('failed');
    }
  }
```

Add subscribe function:

```js
  async function subscribeTaskEvents(nextTask) {
    if (!nextTask?.workflow_id || !nextTask?.task_id || !api?.streamCreativeWorkflowEvents) return;
    if (activeStreamRef.current) activeStreamRef.current.abort();
    window.clearTimeout(reconnectTimerRef.current);
    streamClosedNormallyRef.current = false;
    activeTaskRef.current = nextTask;
    setActiveTask(nextTask);
    activeStreamRef.current = await api.streamCreativeWorkflowEvents(nextTask.workflow_id, {
      task_id: nextTask.task_id,
      since_seq: lastSeqRef.current,
    }, {
      onEvent: applyTaskEvent,
      onClose: () => {
        activeStreamRef.current = null;
      },
      onError: () => {
        activeStreamRef.current = null;
        if (streamClosedNormallyRef.current) return;
        reconnectTimerRef.current = window.setTimeout(() => {
          subscribeTaskEvents(nextTask);
        }, 1500);
      },
    });
  }
```

When create response returns `task_id`, set:

```js
      if (json.task_id) {
        const nextTask = { workflow_id: json.workflow_id, task_id: json.task_id };
        lastSeqRef.current = 0;
        activeTaskRef.current = nextTask;
        saveActiveCreativeTask({ ...nextTask, last_seq: 0 });
        subscribeTaskEvents(nextTask);
      }
```

Add a mount-time recovery effect after `subscribeTaskEvents` is defined. It should restore `lastSeq` and subscribe only when the route/current workflow matches the stored task; it must not switch the visible page to a different workflow solely because localStorage contains another task:

```js
  useEffect(() => {
    const stored = loadActiveCreativeTask();
    if (!stored?.workflow_id || !stored?.task_id) return undefined;
    const currentWorkflowId = workflowId || routeWorkflowId || selectedWorkflowId;
    if (currentWorkflowId && currentWorkflowId !== stored.workflow_id) return undefined;
    lastSeqRef.current = Number(stored.last_seq || 0);
    activeTaskRef.current = { workflow_id: stored.workflow_id, task_id: stored.task_id };
    subscribeTaskEvents(activeTaskRef.current);
    return undefined;
  }, [workflowId, routeWorkflowId, selectedWorkflowId]);
```

When polling workflow finds `json.data.active_task`, subscribe if not already:

```js
        if (nextWorkflow?.active_task?.task_id && nextWorkflow.workflow_id) {
          const nextTask = { workflow_id: nextWorkflow.workflow_id, task_id: nextWorkflow.active_task.task_id };
          if (activeTaskRef.current?.task_id !== nextTask.task_id) subscribeTaskEvents(nextTask);
        }
```

Add cleanup effect:

```js
  useEffect(() => () => {
    if (activeStreamRef.current) activeStreamRef.current.abort();
    window.clearTimeout(reconnectTimerRef.current);
  }, []);
```

- [ ] **Step 4: Run frontend static test**

Run:

```powershell
node tests/test-one-click-creative-page.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend-react/src/pages/OneClickCreativePage.jsx tests/test-one-click-creative-page.mjs
git commit -m "接入一键创作任务事件流"
```

---

### Task 11: End-to-End Regression Suite

**Files:**
- Modify: `tests/run-all.js`
- Run existing test suite

- [ ] **Step 1: Register new tests in the full suite**

Open `tests/run-all.js` and add these entries to the existing test list, preserving the file's current style:

```js
'test-creative-task-events.js',
'test-creative-task-registry.js',
'test-creative-workflow-task-summary.js',
'test-creative-workflow-tasks.js',
```

- [ ] **Step 2: Run focused backend tests**

Run:

```powershell
node tests/test-creative-task-events.js
node tests/test-creative-task-registry.js
node tests/test-creative-workflow-task-summary.js
node tests/test-creative-workflow-tasks.js
node tests/test-creative-workflow-routes.js
node tests/test-creative-workflows.js
```

Expected: all PASS.

- [ ] **Step 3: Run focused html-video tests**

Run:

```powershell
node tests/test-html-video-workflow.js
node tests/test-html-video-project-orchestrator-modes.js
node tests/test-html-video-frame-renderer.js
node tests/test-html-video-production-regression.js
```

Expected: all PASS.

- [ ] **Step 4: Run focused frontend/static tests**

Run:

```powershell
node tests/test-creative-task-api-client.mjs
node tests/test-one-click-creative-page.mjs
node tests/test-html-video-api-client.mjs
```

Expected: all PASS.

- [ ] **Step 5: Run full test suite**

Run:

```powershell
node tests/run-all.js
```

Expected: all tests PASS. If unrelated pre-existing tests fail, capture exact failures and do not claim full suite success.

- [ ] **Step 6: Build frontend**

Run:

```powershell
npm run build:frontend
```

Expected: Vite build completes successfully.

- [ ] **Step 7: Commit final verification adjustments**

Only if files changed during fixes:

```powershell
git add server frontend-react tests
git commit -m "完善创作任务事件流回归验证"
```

---

## Implementation Notes

- Keep all user-visible text in Chinese.
- Do not remove legacy polling until SSE is verified; keep polling as a fallback.
- Do not attempt cross-process task recovery in this implementation. On restart, mark running task summaries interrupted.
- Avoid broad refactors of `creativeWorkflows.js`; add task hooks around existing stage flow first.
- Preserve `operation_id` checks whenever an old task can overlap a new task.
- Do not mark terminal task events successful before workflow/run JSON terminal state is persisted.
