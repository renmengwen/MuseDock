# 布局 QA 单次忽略恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复文本容器空白区造成的布局遮挡误报，为目标错误提供一次性忽略入口，并恢复任务 `20260716090239578354`。

**Architecture:** 保留现有布局 QA、恢复计划、后台任务和 SSE 链路。候选收集只排除已有后代文本候选的空父容器；恢复接口只为 `frame_layout_qa_unresolved` 接受 `ignore_layout_qa_once`，并把该标记传给既有 `retry_frame_html` 动作，使本次失败帧重生成时不运行布局 QA，后续渲染、合成和视觉巡检保持不变。

**Tech Stack:** Node.js、Express、React、Tailwind CSS、shadcn/ui、Playwright Chromium、assert 测试。

---

### Task 1: 修复布局 QA 误报与恢复计划映射

**Files:**
- Modify: `server/services/creative-video/html-video/layoutQaService.js`
- Modify: `server/services/creative-video/retryPlanner.js`
- Test: `tests/test-html-video-layout-qa-service.js`
- Test: `tests/fixtures/html-video-layout-qa/text-container-sibling.html`
- Test: `tests/test-creative-workflow-retry-planner.js`

- [ ] **Step 1: 运行已写好的失败用例**

Run: `node tests/test-html-video-layout-qa-service.js`

Expected: FAIL，提示“文本容器的空白区域不应与兄弟文本产生遮挡误报”。

Run: `node tests/test-creative-workflow-retry-planner.js`

Expected: FAIL，`frame_layout_qa_unresolved` 的 `can_retry` 不是 `true`。

- [ ] **Step 2: 排除空父容器候选**

在 `collectCandidates` 已收集的 records 中保留“有直接文本”或“没有后代候选”的记录；父容器自身没有直接文本且后代已被收集时跳过父容器。

```js
const textRecords = records.filter(record => (
  record.hasDirectText
  || !records.some(other => other !== record && record.element.contains(other.element))
));
```

- [ ] **Step 3: 映射真实布局错误码**

在现有帧 HTML 可恢复错误列表中加入：

```js
|| code === 'frame_layout_qa_unresolved'
```

- [ ] **Step 4: 运行两个测试确认 GREEN**

Run: `node tests/test-html-video-layout-qa-service.js`

Expected: `html-video layout QA service tests passed`

Run: `node tests/test-creative-workflow-retry-planner.js`

Expected: `creative workflow retry planner tests passed`

### Task 2: 增加受限的单次忽略后端参数

**Files:**
- Modify: `server/routes/creativeWorkflows.js`
- Modify: `server/services/creative/creativeWorkflows.js`
- Test: `tests/test-creative-workflow-routes.js`
- Test: `tests/test-creative-workflow-retry-task.js`

- [ ] **Step 1: 写路由和服务失败用例**

覆盖以下契约：

```js
assert.equal(startedPayload.ignore_layout_qa_once, true);
assert.equal(result.retry.attempts.at(-1).ignore_layout_qa_once, true);
assert.equal(generateArgs.runLayoutQa, false);
```

并验证非 `frame_layout_qa_unresolved` 计划携带忽略参数时返回中文错误且不启动任务。

- [ ] **Step 2: 运行用例确认 RED**

Run: `node tests/test-creative-workflow-routes.js`

Run: `node tests/test-creative-workflow-retry-task.js`

Expected: 新增断言失败，原因是参数尚未校验和透传。

- [ ] **Step 3: 实现路由校验和透传**

解析布尔标记，只允许目标错误码，并放入后台任务 payload：

```js
const ignoreLayoutQaOnce = payload.ignore_layout_qa_once === true;
if (ignoreLayoutQaOnce && plan.code !== 'frame_layout_qa_unresolved') {
  return res.status(400).json({
    success: false,
    workflow_id: workflowId,
    plan,
    message: '只有布局自动修复后仍失败的任务，才能忽略本次布局警告。',
  });
}
```

- [ ] **Step 4: 在服务层重复校验并记录审计字段**

服务不能信任仅由路由调用；在 `retryCreativeWorkflow` 再校验一次，并给执行计划和 attempt 增加一次性字段：

```js
const ignoreLayoutQaOnce = payload.ignore_layout_qa_once === true;
const executionPlan = ignoreLayoutQaOnce
  ? { ...plan, executor_options: { ...plan.executor_options, ignore_layout_qa_once: true } }
  : plan;
```

- [ ] **Step 5: 仅关闭本次失败帧布局 QA**

`defaultRetryFrameHtmlAction` 调用现有工作流时传入：

```js
runLayoutQa: executorOptions.ignore_layout_qa_once !== true,
```

不修改最终 `visualQaService.inspectRenderedVideo` 链路。

- [ ] **Step 6: 运行后端测试确认 GREEN**

Run: `node tests/test-creative-workflow-routes.js`

Run: `node tests/test-creative-workflow-retry-task.js`

Expected: 两个测试均通过。

### Task 3: 增加“忽略本次布局警告并继续”按钮

**Files:**
- Modify: `frontend-react/src/pages/OneClickCreativePage.jsx`
- Modify: `frontend-react/src/components/creative/CreativeTaskDetail.jsx`
- Modify: `frontend-react/src/components/creative/CreativeRetryPlan.jsx`
- Test: `tests/test-one-click-creative-page.mjs`

- [ ] **Step 1: 写前端失败用例**

静态契约检查以下中文文案、显示边界和请求参数：

```js
assert.match(creativeRetryPlan, /retryPlan\?\.code === 'frame_layout_qa_unresolved'/);
assert.match(creativeRetryPlan, /忽略本次布局警告并继续/);
assert.match(page, /ignore_layout_qa_once: ignoreLayoutQaOnce/);
assert.match(page, /正在忽略布局警告并继续/);
```

- [ ] **Step 2: 运行前端用例确认 RED**

Run: `node tests/test-one-click-creative-page.mjs`

Expected: FAIL，缺少忽略按钮和请求参数。

- [ ] **Step 3: 复用一个恢复处理函数**

把页面处理函数改为接受布尔参数：

```js
async function handleRetryWorkflow(ignoreLayoutQaOnce = false) {
  const actionMessage = ignoreLayoutQaOnce
    ? '正在忽略布局警告并继续...'
    : '正在修复并重试...';
  // 现有状态更新和 SSE 订阅保持不变
  await api.retryCreativeWorkflow(targetWorkflowId, {
    mode: 'repair_and_resume',
    confirm_plan_code: retryPlan.code,
    ignore_layout_qa_once: ignoreLayoutQaOnce,
  });
}
```

- [ ] **Step 4: 在恢复卡片增加次按钮和说明**

只在目标错误码显示，使用现有 Button：

```jsx
{retryPlan.code === 'frame_layout_qa_unresolved' ? (
  <Button type="button" size="sm" variant="outline" disabled={retrying} onClick={onIgnoreLayoutQa}>
    忽略本次布局警告并继续
  </Button>
) : null}
```

说明文案为“仅跳过本次失败帧的布局检查，后续仍会执行渲染和视觉巡检。”

- [ ] **Step 5: 运行前端测试和构建确认 GREEN**

Run: `node tests/test-one-click-creative-page.mjs`

Expected: `one click creative page tests passed`

Run: `npm run build:frontend`

Expected: Vite build 成功。

### Task 4: 综合验证并恢复真实任务

**Files:**
- Verify only: all files above and `data/creative-workflows/20260716090239578354.json`

- [ ] **Step 1: 运行相关测试集合**

Run: `node tests/test-html-video-layout-qa-service.js && node tests/test-creative-workflow-retry-planner.js && node tests/test-creative-workflow-routes.js && node tests/test-creative-workflow-retry-task.js && node tests/test-one-click-creative-page.mjs`

Expected: 全部通过。

- [ ] **Step 2: 运行仓库检查**

Run: `npm run build:frontend`

Run: `git diff --check`

Expected: 构建成功且无空白错误。

- [ ] **Step 3: 只重启后端并验证健康状态**

检查 `3000`/`5173`，只终止监听 `3000` 的后端进程并按现有启动方式重启；验证 `http://localhost:3000/api/health` 或项目现有健康端点返回 `200`，并确认前端 `5173` 的进程未变化。

- [ ] **Step 4: 刷新并执行真实恢复计划**

先请求 `GET /api/creative-workflows/20260716090239578354/retry-plan`，确认计划为 `frame_layout_qa_unresolved`、`retry_frame_html`、目标帧 `scene_02_b3`；再调用普通恢复。若仍被布局 QA 阻断，调用同一恢复接口并增加 `ignore_layout_qa_once: true`。

- [ ] **Step 5: 监控至终态**

轮询任务/工作流，确认任务进入 `done`，输出视频存在，渲染和最终视觉巡检完成；若出现新的真实阻断问题，保留现场并报告准确错误码和阶段。
