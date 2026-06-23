# 一键创作后台任务与 SSE Replay 设计

## 背景

最新一次一键创作失败表现为：

> 生成工程长时间未更新，后台任务可能已中断，请重新创建任务或稍后重试。

排查确认，失败不是前端误报，而是后端 `creativeWorkflows` 的 stale 检测只看 workflow stage 的 `updated_at`。`project` 阶段内部进入 html-video raw HTML 生成链路后，没有把 content graph、frame HTML、渲染和合成进度持续写回 workflow，因此前端轮询触发 `getCreativeWorkflow()` 时，后端认为阶段 10 分钟未更新并标失败。

当前项目未上线、无人依赖旧流程时，不建议继续在同步调用链上补临时心跳。应直接把一键创作改成后台任务模型。设计上采用 `D:\code3\html-video\packages\cli\src\task-registry.ts` 的 task replay 思路，并借鉴 `html-video` 主服务当前已经使用的 `fetch(... accept: text/event-stream ...)` 流式进度体验。

所有用户可见文案遵循项目 `AGENTS.md`：按钮、状态、错误、空状态、加载文案和操作结果默认使用中文；技术字段和第三方服务名可以保留英文。

## 目标

- 一键创作创建后立即返回 `workflow_id` 和 `task_id`，后台任务继续执行。
- 前端通过 SSE 订阅任务事件，断线重连后能按 `seq` replay 未消费事件。
- 后端任务与 HTTP 连接解耦，页面刷新、切换路由或 SSE 断开不影响任务继续。
- 任务事件覆盖一键创作全流程：source、research、assets、agent_run、brief、audio、project、check、render、inspect。
- html-video 细分进度必须可见：模板选择、content graph、每帧 HTML、每帧渲染、合成、混音、视觉质检。
- stale 判断改为基于 active task，而不是只看 workflow stage 的更新时间。
- 服务重启后，无法恢复的 running task 必须明确标记为中断，而不是继续悬挂。

## 非目标

- 不做分布式任务队列、Redis、数据库迁移或多进程 worker。
- 不支持服务重启后自动续跑正在执行的 AI/Playwright/ffmpeg 任务。
- 不重写 html-video 业务生成逻辑，只重构任务生命周期和事件传输。
- 不保留旧的一键创作同步等待体验作为主路径。

## 参考 html-video 方案

`D:\code3\html-video\packages\cli\src\task-registry.ts` 提供了完整的 task replay 设计，但当前未接入 `html-video` 主服务。本文档采用它的设计思路，而不是声称它是 `html-video` 当前生产路径。

- 长任务脱离 HTTP 请求运行。
- 事件保存在 task 内，订阅者可随时接入。
- SSE 断开不会终止任务。
- 订阅时按 `sinceSeq` replay 旧事件，然后继续 live tail。
- 任务结束后保留一段时间，便于前端补读最终事件。

`D:\code3\html-video\packages\cli\src\studio-server.ts` 的主服务当前实际使用：

- `GENERATING = new Set<string>()` 跟踪运行中的项目。
- 前端用 `fetch()` 发起 `POST`，通过 `accept: text/event-stream` 请求流式响应。
- 前端用 `response.body.getReader()` 手动解析 SSE 数据。
- 生成过程里用 `sseWrite()` 持续推送 progress、text、preview_ready、message_end 等事件。

它的多帧生成经验仍然有效：

- 不让 Agent 一次输出 content graph 和所有 HTML 帧。
- 先生成 content graph，再逐帧生成 HTML。
- 每一步写盘并发送事件。
- 多帧渲染时把单帧 adapter 进度映射成整体进度。

当前项目应采用 `task-registry.ts` 的 replay 能力，并选择 `fetch + ReadableStream` 作为传输方式，而不是直接使用浏览器 `EventSource`。这样能保留 POST、请求体、自定义头和未来认证能力。

## 总体架构

新增 `creativeTaskRegistry`，作为一键创作后台任务的进程内任务中心。

它负责：

- 创建 task。
- 保存 task 事件。
- 管理 SSE subscribers。
- 支持按 `sinceSeq` replay。
- 查询 active task。
- 结束后按 TTL 清理内存事件。

workflow JSON 仍然是长期状态来源，但它只保存摘要状态，不承担完整事件流：

- `active_task_id`
- `active_operation_id`
- `task_status`
- `current_stage`
- `current_stage_message`
- `current_progress`
- `last_event_seq`
- `updated_at`
- `error`

run JSON 继续保存 `hyperframes_freeform` 结果和 html-video 工程路径。任务事件可以同时更新 workflow 摘要和 run 摘要，但前端实时展示以 SSE 事件为准。

### 内存事件与 workflow 摘要一致性

事件流和 workflow JSON 是双写关系，但二者职责不同：

- task registry 内存事件是当前进程内的实时真相。
- workflow JSON 是刷新、路由恢复、任务列表和服务重启恢复使用的持久化摘要。
- SSE replay 只依赖 task registry 的事件，不依赖 workflow JSON 的 `last_event_seq`。
- workflow JSON 的 `last_event_seq` 允许短暂滞后，但不能长期缺失或倒退。

统一使用 `emitAndPersistTaskEvent()` 写事件：

1. 先写入 registry 内存事件，分配递增 `seq`，并立即 fan-out 给 SSE subscribers。
2. 再异步写 workflow 摘要，包括 `last_event_seq`、`current_stage`、`current_stage_message`、`current_progress`、`updated_at`。
3. 如果 workflow 摘要写入失败，registry 保留事件，并追加一条内部 `workflow_persist_failed` 事件；该事件不作为用户失败结果，但要记录日志。
4. 下一次事件写入时再次尝试持久化最新摘要，摘要以最高 `seq` 覆盖，保证最终收敛。
5. `task_done`、`task_failed`、`workflow_deleted` 是终态事件，必须等待 workflow/run JSON 持久化完成后才返回 runner 完成；如果终态持久化失败，task 保持 `failed` 并记录持久化错误，避免前端看到 done 但刷新后状态丢失。

不要求内存事件和 workflow JSON 做文件级原子事务。首版接受“实时事件先到、持久化摘要稍后收敛”的模型，但终态必须强一致落盘。

## 后端模块

### `server/services/creativeTaskRegistry.js`

职责：

- `createTask({ workflowId, kind, operationId, runner })`
- `emit(taskId, event)`
- `subscribe(taskId, sinceSeq, onEvent)`
- `getTask(taskId)`
- `activeTaskForWorkflow(workflowId)`
- `markDone(taskId)`
- `markFailed(taskId, error)`
- `recoverOrphanedWorkflows()`

初始化流程：

- server 启动时创建 registry 单例。
- registry 初始化后由 server startup 显式调用 `recoverOrphanedWorkflows({ rootDir })`，不要依赖首次请求触发。
- 恢复过程扫描 workflow JSON，处理 running orphan、done/failed 残留 active task、摘要和 registry 不一致等情况。
- 恢复完成前，`POST /api/creative-workflows` 可以排队等待；`GET /api/creative-workflows/:id` 可以读取现有 workflow，但不能把 stale running 任务误报为仍在运行。

task 数据结构：

```js
{
  task_id: 'creative-task-...',
  workflow_id: '202606...',
  kind: 'creative_workflow',
  operation_id: 'workflow-...',
  status: 'running' | 'done' | 'failed',
  started_at: 'ISO',
  updated_at: 'ISO',
  ended_at: 'ISO|null',
  error: null,
  events: [
    { seq: 1, time: 'ISO', type: 'task_started', data: {} }
  ],
  subscribers: Set
}
```

事件保留策略：

- running task：保留全部事件。
- done/failed task：保留 10 分钟。
- 单 task 事件数量设置上限，例如 1000 条；超过后保留最近事件，并写 `events_truncated` 事件。
- 清理触发：
  - 每次 `createTask()` 前执行一次 `prune()`。
  - 每次 `emit()` 后，如果距离上次 prune 超过 60 秒，再异步执行一次 `prune()`。
  - 允许额外启动一个 `setInterval(..., 60_000)`，但必须 `unref()`，避免影响进程退出。
- 内存上限：
  - 单 task 默认最多保留 1000 条事件。
  - registry 默认最多保留 100 个已结束 task；超过后优先清理最早结束的 task。
  - running task 不按数量清理，只能由完成、失败、删除或服务重启结束。

### `server/services/creativeWorkflowTasks.js`

职责：

- 创建一键创作后台任务。
- 包装现有 `runCreativeWorkflow()` 阶段执行。
- 提供统一 `emitProgress()` 给各阶段和 html-video 子链路使用。
- 把事件同步为 workflow JSON 的状态摘要。

建议保留 `runCreativeWorkflow()` 的阶段逻辑，但让它接受 `taskContext`：

```js
{
  taskId,
  operationId,
  emit,
  reportStage,
  isCurrentOperation
}
```

这样可以先少改业务逻辑，再逐步拆分阶段机。

### `server/routes/creativeWorkflows.js`

新增或调整接口：

- `POST /api/creative-workflows`
  - 创建 workflow。
  - 创建后台 task。
  - 返回 `202`、`workflow_id`、`task_id`、初始 workflow 摘要。

- `GET /api/creative-workflows/:workflow_id`
  - 返回 workflow 摘要。
  - 如果有 active task，返回 `active_task`。
  - 不再仅凭 stage `updated_at` 把任务判 stale。

- `POST /api/creative-workflows/:workflow_id/events`
  - SSE stream endpoint。
  - 请求头包含 `accept: text/event-stream`。
  - 请求体包含 `task_id`、`since_seq`。
  - 前端首次订阅传 `since_seq: 0`。
  - 前端已收到部分事件时传本地 `lastSeq`。
  - 后端 replay 所有 `seq > since_seq` 的事件。
  - 如果 task 已经结束，`since_seq: 0` 会 replay 全部保留事件，再发送 `task_stream_closed` 后关闭。
  - 再订阅 live events。
  - 选择 POST 而不是 GET，是为了保留请求体、自定义头和后续认证扩展能力。前端不用原生 `EventSource`，改用 `fetch()` + `ReadableStream` 手动解析事件。

- `GET /api/creative-workflows/:workflow_id/tasks/active`
  - 可选。用于前端刷新后找回 active task。

### `server/services/creative-video/html-video/*`

为 html-video 链路增加 `onProgress` 参数，不再只在顶层返回最终结果。

需要贯通：

- `workflowFacade.generateCreativeVideoProject({ onProgress })`
- `htmlVideoWorkflow.generateHtmlVideo({ onProgress })`
- `projectOrchestrator.renderHtmlVideoProject({ onProgress })`
- `frameRenderer.renderFrame(..., { onProgress })`
- `hyperframesPlaywrightAdapter.render(..., ctx.onProgress)`

html-video 事件示例：

```js
{ type: 'html_video_template_selected', template_id, message }
{ type: 'html_video_graph_started', message }
{ type: 'html_video_graph_done', frame_count }
{ type: 'html_video_frame_html_started', frame_id, index, total }
{ type: 'html_video_frame_html_done', frame_id, index, total }
{ type: 'html_video_frame_render_progress', frame_id, index, total, percent, message }
{ type: 'html_video_compose_started', message }
{ type: 'html_video_export_ready', output_path, output_url }
```

## 事件协议

所有事件统一包含：

```js
{
  seq: 12,
  time: '2026-06-18T02:00:00.000Z',
  task_id: 'creative-task-...',
  workflow_id: '202606...',
  operation_id: 'workflow-...',
  type: 'stage_progress',
  stage: 'project',
  progress: 56,
  message: '正在生成第 2/4 帧 HTML...',
  data: {}
}
```

事件类型：

- `task_started`
- `task_done`
- `task_failed`
- `stage_started`
- `stage_progress`
- `stage_done`
- `stage_failed`
- `html_video_template_selected`
- `html_video_graph_started`
- `html_video_graph_done`
- `html_video_frame_html_started`
- `html_video_frame_html_done`
- `html_video_frame_render_progress`
- `html_video_compose_started`
- `html_video_export_ready`
- `workflow_deleted`
- `task_stream_closed`
- `events_truncated`

进度范围：

- 总任务进度使用 `0..100`。
- stage 内可额外提供 `stage_progress`。
- html-video 帧渲染可提供 `frame_progress`。

阶段权重首版可以固定：

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
```

权重逻辑封装成独立函数，不在 UI 或业务分支里散落硬编码：

```js
calculateWorkflowProgress({ stage, stageProgress, skippedStages })
```

`project` 阶段内部首版按固定子权重映射到该阶段的 35%：

```js
template: 5
graph: 10
frame_html: 35
materialize: 5
frame_render: 30
compose: 10
inspect: 5
```

`frame_html` 和 `frame_render` 按帧数平均分摊。如果 html-video production 在 `project` 阶段内完成 render/inspect，可以把旧 `check/render/inspect` 标为 skipped，整体进度计算时跳过这些阶段并把最终进度归一到 100。

## 前端设计

`OneClickCreativePage.jsx` 当前通过 workflow 状态轮询展示任务。改造后：

- 创建任务后保存 `workflow_id` 和 `task_id`。
- 用 `fetch()` 请求 `POST /events`，请求头设置 `accept: text/event-stream`，并用 `response.body.getReader()` 解析 SSE。
- 本地维护 `lastSeq`。
- SSE 断开后自动重连，请求体带 `since_seq: lastSeq`。
- `lastSeq` 优先存在组件内存状态中，连接断开前的最新事件立即更新内存。
- localStorage 的 `last_seq` 只用于页面刷新后的恢复，不作为多个标签页之间的共享锁。
- 如果用户清空浏览器缓存或 localStorage 丢失，前端以 `since_seq: 0` 重新订阅；后端 replay 当前仍保留的全部事件，这是正确行为。
- 多标签页可以同时订阅同一个 task；每个标签页维护自己的内存 `lastSeq`。写 localStorage 时只写当前 URL workflow 对应的辅助恢复信息，不要求多个标签页互相同步。
- 刷新页面后：
  - 优先从 URL route 参数恢复 `workflow_id`。
  - localStorage 只作为同一浏览器会话的辅助恢复，不作为权威来源。
  - 建议 key 使用 `musedock.creative.activeTask.v1`，内容包含 `workflow_id`、`task_id`、`last_seq`、`updated_at`。
  - 请求 workflow 详情。
  - 如果存在 `active_task`，订阅该 task。
  - 如果 task 已结束，展示 workflow 最终状态。

前端展示：

- 顶部总进度。
- 当前阶段中文文案。
- html-video 子阶段日志，例如“第 2/4 帧 HTML 已生成”。
- 错误状态展示真实失败原因，不再只显示 stale。

重复点击保护：

- 若 workflow 有 active task，创建按钮禁用。
- 用户显式“重新创建任务”时，新任务生成新的 `operation_id`。
- 旧任务事件到达时，后端和前端都按 `operation_id` 忽略。
- 多标签页同时打开时，以 URL 当前 workflow 为准；localStorage 恢复到不同 workflow 时不自动切换页面，只提示有其他创作任务在运行。

## stale 和恢复策略

### 正常运行

只要内存中存在 active task，`getCreativeWorkflow()` 不应把 workflow 标 stale。

### SSE 断开

不影响 task。前端重连后 replay。

### 服务重启

内存 task 丢失。启动时扫描 workflow：

- `status === running` 且 `active_task_id` 存在，但 registry 中没有该 task：标记为中断。
- `status === done/failed` 但 `active_task_id` 仍存在：清空 `active_task_id`、`task_status`，保留最终状态。
- workflow JSON 的 `active_task_id` 指向一个已结束内存 task：以 task 的 `done/failed` 结果为准，补写 workflow 摘要后清空 active task。
- workflow JSON 和内存 registry 不一致时，内存 registry 是当前进程的实时真相；registry 没有对应 running task，就不能继续宣称任务仍在运行。

则标记为：

```js
status: 'failed',
message: '服务器重启，后台创作任务被中断，请重新创建任务。',
error: { stale: true, reason: 'server_restart' }
```

### workflow 删除

如果用户删除 workflow：

- workflow 文件删除。
- task 发送 `workflow_deleted`。
- task runner 在下一个 checkpoint 停止。
- SSE 关闭。

checkpoint 至少包括：

- 每个 stage 开始前。
- 每个 stage 结束写盘前。
- content graph AI 调用前后。
- 每个 frame HTML AI 调用前后。
- 每个 frame render 前后。
- compose/mux/inspect 前后。

首版不强制中断已经发出的 fetch/Playwright/ffmpeg 子进程，但每个 checkpoint 必须检查 workflow 是否仍存在、operation 是否仍是当前 operation。

### stream 正常关闭

`task_stream_closed` 用于告诉前端“这是正常结束，不需要重连”：

```js
{
  type: 'task_stream_closed',
  task_id,
  workflow_id,
  status: 'done' | 'failed' | 'deleted',
  final_seq: 128,
  message: '任务事件流已结束。'
}
```

前端收到后停止重连。如果连接异常断开但没有收到 `task_stream_closed`，才按 `lastSeq` 重连。

## 错误处理

AI 调用必须有明确超时和中文错误：

- content graph 超时：`content graph 生成超时，请稍后重试或切换文本模型。`
- frame HTML 超时：`第 X/Y 帧 HTML 生成超时，请稍后重试或切换文本模型。`
- Playwright 未配置：沿用现有中文诊断。
- ffmpeg 失败：返回 stderr 摘要和中文解释。

错误必须同时：

- emit `stage_failed` 或 `task_failed`
- 写 workflow `status = failed`
- 写 run `hyperframes_freeform.project.status = failed`
- 保留 html-video diagnostics

## 测试计划

后端单元测试：

- `creativeTaskRegistry` 创建 task、emit、subscribe、replay、done、failed、TTL prune。
- SSE route 能 replay `since_seq` 之后的事件。
- SSE route 在 task 已结束时 replay 后关闭。
- workflow 有 active task 时不会被 stale 标失败。
- 服务启动恢复 orphan running workflow。
- workflow 删除后 active task 发出 deleted 并停止后续阶段。

集成测试：

- 创建 workflow 返回 `task_id`。
- 模拟完整任务事件流，前端可读到 stage 进度。
- 模拟 SSE 断线后用 `since_seq` 重连，不丢事件。
- 模拟 html-video raw_html：graph、frame HTML、render、compose 都发事件。
- 模拟 content graph 超时，workflow 和 run 都落失败状态。

前端静态/组件测试：

- `OneClickCreativePage` 创建任务后订阅 SSE。
- 重连时携带 lastSeq。
- active task 时按钮禁用。
- task_failed 显示中文错误。
- 刷新后从 workflow active_task 恢复订阅。

## 实施阶段

### 阶段 1：任务注册表和 SSE 基础设施

- 新增 `creativeTaskRegistry`。
- 新增 task event schema helper。
- 新增 SSE route。
- 补 registry 和 SSE route 测试。

### 阶段 2：一键创作后台任务入口

- 新增 `creativeWorkflowTasks`。
- 创建 workflow 后启动后台 task。
- `runCreativeWorkflow()` 接收 task context。
- workflow JSON 写入 `active_task_id` 和最近进度。
- 调整 stale 判断。

### 阶段 3：html-video 进度贯通

- `workflowFacade`、`htmlVideoWorkflow`、`projectOrchestrator`、`frameRenderer` 贯通 `onProgress`。
- raw_html content graph 和每帧 HTML 生成发事件。
- frame render progress 映射到 task progress。
- AI 子步骤增加外层超时和明确失败落盘。

### 阶段 4：前端 SSE 接入

- `OneClickCreativePage` 创建任务后订阅 SSE。
- 添加重连和 replay。
- 替换纯轮询 loading。
- 保留 workflow 详情轮询作为兜底。

### 阶段 5：恢复和回归

- 启动恢复 orphan running workflow。
- 删除 workflow 时通知 task。
- 补完整一键创作和 html-video production 回归测试。

## 风险与取舍

- 改动面较大，但当前未上线时成本可控，且能避免后续在同步链路上重复补丁。
- 纯内存 task 无法跨重启恢复执行，这是首版接受的限制；workflow JSON 会明确告诉用户任务被重启中断。
- SSE 在某些代理环境可能断线，replay 和 fallback workflow polling 可以降低风险。
- 事件协议一旦前端接入后会成为内部契约，应保持字段稳定。

## 成功标准

- 最新失败场景不再被 10 分钟 stale 误判；用户能看到卡在 content graph、frame HTML、render 还是 compose。
- 前端刷新或切换页面后，任务继续运行，回到页面能 replay 进度。
- html-video 多帧生成期间至少每个子步骤都有事件。
- AI/Playwright/ffmpeg 失败显示真实中文错误并落盘。
- 服务重启后 running workflow 被明确标记为中断。
- 相关后端和前端测试通过。
