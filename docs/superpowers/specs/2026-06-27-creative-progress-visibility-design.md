# 一键创作进度可见性设计

## 背景

一键创作创建任务后，用户只能看到任务状态、十个大阶段 Stepper 和一条状态消息。后端已经通过 workflow 记录和 SSE 事件维护了更细的运行信息，包括 `current_stage`、`current_stage_message`、`current_progress`、`last_event_seq` 和 `html_video_*` 事件。当前体验的黑盒感主要来自前端没有把这些信息组织成可读的运行视图。

任务列表还有一个独立问题：列表时间优先使用 `updated_at`，运行中的任务会频繁刷新 `updated_at`，导致列表时间看起来一直是当前时间，而不是任务创建时间。

## 目标

- 一键创作运行中默认展示产品化进度，用户能知道系统正在做什么。
- 支持展开查看详细调试进度，方便排障时看到内部事件。
- 任务列表主时间固定展示创建时间，不再被运行进度刷新影响。
- 任务完成后展示最终用时，让用户知道本次生成总耗时。
- 首版复用现有后端字段和 SSE 事件，不新增后端持久化日志协议。

## 非目标

- 不新增完整后端事件日志回放。
- 不把 `html-video` 内部步骤提升为新的顶层 Stepper。
- 不重构一键创作页面整体布局。
- 不改变任务执行、重试、删除和编辑流程。

## 交互设计

在任务详情页的 `CreativeWorkflowStepper` 下方新增“当前进展”面板。

默认视图显示产品化信息：

- 当前阶段：从 `workflow.current_stage` 或当前 running stage 推导，例如“正在生成视频工程”。
- 当前动作：优先使用 `workflow.current_stage_message`，否则使用页面最新 message。
- 总进度：使用 `workflow.current_progress`，展示进度条和百分比。
- 状态：使用 workflow/status 的中文状态。
- 最终用时：任务完成后显示从 `created_at` 到完成时间的耗时，例如“用时 12 分 36 秒”。

面板提供“展开详细进度”按钮。展开后显示调试信息：

- 原始阶段 ID：`current_stage`。
- 事件序号：`last_event_seq`。
- 最近事件列表：本次页面收到的最近 30 条 SSE 事件。
- 事件类型保留原始 type，例如 `html_video_graph_started`、`html_video_frame_html_done`、`html_video_compose_started`。
- 事件数据展示为简短 JSON 摘要，包含 frame index、total、percent、error 等关键字段。

刷新页面后，最近事件列表不补全历史，只展示 workflow 已持久化的当前状态。后续如果需要完整追溯，再新增后端持久化事件日志。

最终用时优先从 `created_at` 和完成阶段的 `completed_at` 推导；如果没有完成阶段时间，则使用 workflow 的 `updated_at`。时间缺失或无法解析时不显示用时，避免展示误导性数字。

## 数据流

`OneClickCreativePage` 继续负责订阅 SSE：

1. 收到任务事件后，现有逻辑继续更新 status、message 和最终 workflow。
2. 同时把事件追加到本地 `progressEvents` 状态。
3. 每个 workflow 只保留最近 30 条事件。
4. 切换任务、创建新任务、删除任务时清理或切换对应事件缓存。

`CreativeTaskDetail` 接收：

- `progressEvents`
- `status`
- `message`
- `workflow`

并渲染当前进展面板。

## 任务列表时间

任务列表主时间改为优先使用 `created_at`：

```js
timeLabel: getTaskTimeLabel(task.created_at || task.updated_at)
```

运行中的 `updated_at` 仍可保留在任务数据里，用于排序或后续次要文案，但不再作为主时间展示。

## 文件范围

- `frontend-react/src/pages/OneClickCreativePage.jsx`
  - 保存最近 SSE 事件。
  - 把最近事件传给详情组件。
  - 修正任务列表时间来源。
- `frontend-react/src/components/creative/CreativeTaskDetail.jsx`
  - 渲染进度面板或引入小组件。
- `frontend-react/src/components/creative/CreativeProgressPanel.jsx`
  - 新增小组件，负责默认进度和详细进度展示。
- `frontend-react/src/styles.css`
  - 补充小范围样式，贴合现有详情页风格。

## 验证

- 前端构建通过。
- 创建任务后，详情页能看到当前进展面板。
- SSE 事件到达时，详细进度列表追加事件。
- 任务列表时间保持创建时间，不随运行中进度刷新变化。
- 任务完成后显示最终用时；运行中、失败和时间缺失时不显示最终用时。
- 完成、失败、删除任务流程不受影响。
