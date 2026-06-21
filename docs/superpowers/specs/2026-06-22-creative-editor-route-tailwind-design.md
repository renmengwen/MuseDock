# /creative 与 /editor/:workflowId 拆分重构设计

## 背景

当前 `/creative` 同时承担一键创作、任务状态展示、首版视频预览和二次编辑入口。二次编辑器短期内可以继续复用现有实现，但长期不应继续嵌在一键创作页面内，否则 `OneClickCreativePage.jsx` 会持续膨胀，页面职责也会混杂。

项目已接入 Tailwind CSS，但 `/creative` 主页面仍主要依赖 `frontend-react/src/styles.css` 中的大量 `creative*` 全局样式。后续 UI 基础层应转向官方 `shadcn/ui` 组件体系，而不是继续维护手写的“shadcn 风格”仿制组件。本次设计把路由职责拆分和 UI 样式治理放在同一方向上推进，但不在同一阶段重构视频编辑器内部。

`shadcn/ui` 接入默认参考 Vite 安装文档：https://www.shadcn-ui.cn/docs/installation/vite 。实施时应按该文档使用 `shadcn@latest` 初始化和添加组件，而不是继续手写本地仿制组件。

## 目标

- `/creative` 回归一键创作页面：创建任务、查看任务列表、展示生成进度、预览首版结果。
- 新增 `/editor/:workflowId` 作为独立视频编辑器路由。
- `/editor/:workflowId` 根据 `workflowId` 自行加载 workflow 与编辑器数据，支持刷新、直达和分享链接。
- `/creative` 生成完成后提供“继续编辑”入口，跳转到 `/editor/:workflowId`。
- `/creative` 主页面重构时优先使用 Tailwind CSS 与官方 `shadcn/ui` 组件，逐步减少 `styles.css` 中的 `creative*` 全局样式。

## 非目标

- 不重构 `frontend-react/src/components/creative-video-editor/` 内部 UI。
- 不迁移 `frontend-react/src/components/one-click-editor/`。
- 不改变后端 creative workflow API。
- 不改变 SSE 协议、任务状态机或生成流程。
- 不一次性迁移全站样式。
- 不要求把历史 CSS 一次性全部改成 Tailwind。

## 路由设计

保留现有一键创作路由：

```text
/creative
/creative/:workflowId
```

新增独立编辑器路由：

```text
/editor/:workflowId
```

`/creative/:workflowId` 仍用于查看某个创作任务的生成状态和结果详情。`/editor/:workflowId` 用于二次编辑，不再属于一键创作页面的内嵌面板。

### 路由行为约束

- `/creative` 没有选中任务时展示创作输入态和任务列表。
- `/creative/:workflowId` 用于展示指定 workflow 的生成状态、阶段进度、首版视频和“继续编辑”入口。
- `/editor/:workflowId` 必须可以从地址栏直接打开，不能要求用户先访问 `/creative`。
- `/editor/:workflowId` 的返回入口必须回到 `/creative/:workflowId`，不能只回到 `/creative`。
- `/editor/:workflowId` 不参与 `PersistentPages` 的隐藏挂载机制；编辑器页面应按普通路由独立挂载和卸载。

## 页面职责

### OneClickCreativePage

负责：

- 加载和维护创作任务列表。
- 创建 creative workflow。
- 订阅生成进度。
- 展示当前任务状态、阶段进度、错误信息和首版视频预览。
- 生成完成后提供“继续编辑”按钮。

不再负责：

- 渲染 `CreativeVideoEditor`。
- 管理编辑器内部状态。
- 处理场景、帧、字幕、旁白、导出等二次编辑 UI。

### CreativeEditorPage

新增页面，负责：

- 从路由读取 `workflowId`。
- 调用 `api.getCreativeWorkflow(workflowId)` 加载 workflow 基础信息。
- 展示页面级 loading、错误、未找到或 workflowId 缺失状态。
- 渲染 `CreativeVideoEditor`。
- 提供返回 `/creative/:workflowId` 的入口。
- 在 `onRendered` 后刷新 workflow 基础信息，保证标题、状态和结果信息同步。

`CreativeVideoEditor` 内部继续通过现有 hooks 加载编辑工程：

- `useHtmlVideoProject({ workflowId, api })` 优先加载 HTML video project。
- 当 HTML video project 不存在时，继续 fallback 到 legacy editor。
- `useCreativeVideoEditor({ workflowId, api })` 负责 legacy scene spec 与 video spec。

## 数据流

```text
/creative
  -> 创建或选择 workflow
  -> api.getCreativeWorkflow / streamCreativeWorkflowEvents
  -> 展示生成进度和首版结果
  -> 点击“继续编辑”
  -> navigate('/editor/:workflowId')

/editor/:workflowId
  -> useParams 读取 workflowId
  -> api.getCreativeWorkflow(workflowId)
  -> 渲染 CreativeVideoEditor
  -> CreativeVideoEditor 内部加载 html-video-project 或 legacy spec
```

编辑器页面不得依赖 `/creative` 跳转时传入的内存 state。路由参数是唯一必需入口。

### /editor 数据加载契约

`CreativeEditorPage` 必须独立完成页面级数据加载：

- 使用 `useParams()` 读取 `workflowId`。
- `workflowId` 为空时，不发起请求，展示“缺少创作任务 ID。”。
- `workflowId` 存在时调用 `api.getCreativeWorkflow(workflowId)`。
- 请求期间展示“正在加载编辑任务...”。
- 请求成功后保存 workflow，用于标题、状态、返回链接和必要的上下文展示。
- 请求失败时展示中文错误；404 或等价未找到状态展示“未找到创作任务。”。
- `CreativeVideoEditor` 只在 workflow 成功加载后渲染。
- `CreativeVideoEditor` 继续接收 `workflowId`、`api` 和 `onRendered`，内部加载 HTML video project 或 legacy spec。
- `onRendered` 触发后，`CreativeEditorPage` 重新调用 `api.getCreativeWorkflow(workflowId)`，同步任务状态和结果信息。
- 不允许通过 `navigate('/editor/:workflowId', { state })` 传递必需数据。

`OneClickCreativePage` 中的“继续编辑”按钮只负责跳转：

```js
navigate(`/editor/${encodeURIComponent(workflowId)}`);
```

按钮可选地在 workflow 未完成或没有 `workflowId` 时禁用，但不得内嵌渲染 `CreativeVideoEditor`。

## UI 与样式策略

`/creative` 主页面重构遵循以下规则：

- 新增或重构 UI 默认使用 Tailwind CSS utility class。
- 通用控件优先通过 `shadcn@latest` CLI/registry 引入官方 `shadcn/ui` 组件。
- `Button`、`Textarea`、`Badge`、`Alert`、`Tabs`、`Tooltip`、`Dialog`、`DropdownMenu`、`Checkbox`、`Switch` 等通用组件应以官方 `shadcn/ui` 组件为来源；需要项目化调整时，在引入后的组件代码上做小范围修改，并保留清晰 API 边界。
- 不继续新增手写的“shadcn 风格”仿制基础组件。
- 避免继续向 `styles.css` 追加大段 `creative*` 全局样式。
- 每迁移一个区域，同步清理对应不再使用的旧 CSS。

### shadcn/ui 接入要求

当前项目已有 Tailwind 3 与 PostCSS 配置。给定的 Vite 安装文档使用最新 `shadcn/ui` 与 Tailwind/Vite 接入方式，因此实施计划中需要先处理 UI 基础设施：

- 按 Vite 文档补齐或调整 Tailwind 与 Vite 集成，实施前必须核对 `shadcn@latest` 对 Tailwind 版本和 Vite 插件的当前要求。
- 使用 `npx shadcn@latest init` 初始化 `components.json`、路径别名和全局 CSS 入口。
- 使用 `npx shadcn@latest add ...` 添加 `/creative` 需要的官方组件。
- 现有 `frontend-react/src/components/ui/` 下的手写仿制组件需要逐步替换为 `shadcn/ui` CLI 生成的组件；如果文件名相同，替换前必须检查调用方 API，避免破坏已有页面。
- README 中的 UI 技术栈只有在官方 `shadcn/ui` 接入完成后，才能从“本地 shadcn 风格组件”改成 `shadcn/ui`。

### Tailwind 版本策略

当前项目使用 Tailwind 3 与 `postcss.config.cjs`。实施时按以下顺序处理版本问题：

- 先运行或预演 `npx shadcn@latest init`，确认 CLI 对当前 Vite 项目的变更建议。
- 如果 CLI 和 Vite 文档要求 Tailwind 4，则把 Tailwind 4、`@tailwindcss/vite`、CSS 入口改造作为独立基础设施任务完成，并在该任务内单独验证构建。
- 不允许在同一个任务里同时升级 Tailwind、拆分 `/creative` 组件、迁移业务 UI。
- 如果 CLI 允许保留 Tailwind 3，则本轮不主动升级 Tailwind，只接入官方 `shadcn/ui` 组件并保留现有 PostCSS 流程。
- 无论 Tailwind 3 还是 Tailwind 4，`@` 别名都必须继续指向 `frontend-react/src`。

### components/ui 替换策略

`frontend-react/src/components/ui/` 目录继续作为 UI 基础组件目录，但组件来源必须切换为官方 `shadcn/ui`：

- 同名组件替换前，必须搜索所有调用方并记录使用到的 props。
- 如果官方组件 API 与当前仿制组件不兼容，优先调整调用方，避免长期保留兼容旧 API 的仿制封装。
- 替换 `Button` 时必须确认现有 `variant="login"`、`variant="secondary"`、`size="sm"`、`size="icon"` 的调用方；项目特有 variant 可以在官方组件基础上小范围扩展，但不得重新手写整套 Button。
- 替换 `DropdownMenu` 时必须使用官方 shadcn/Radix 行为，不继续保留当前手写 `document.addEventListener` 的仿制弹层实现。
- 替换 `Table`、`Input`、`Select` 时必须验证抓取页、记录页和数据表组件仍能构建。
- 本轮 `/creative` 需要的缺失组件优先通过 CLI 添加，不手写临时替代组件。

### /creative 本轮迁移范围

本轮纳入 `/creative` 主页面迁移的区域：

- 左侧任务栏：品牌区域、折叠按钮、新建任务、任务列表、删除任务、空状态。
- 创作输入区：标题、模式切换、提示词输入、联网研究开关、提交按钮、专家模式占位提示。
- 任务详情区：任务元信息、删除/停止入口、状态消息、生成阶段进度、首版视频预览。
- 继续编辑入口：生成完成后跳转到 `/editor/:workflowId`。
- 状态展示：loading、success、error、info 文案和按钮禁用态。

本轮不迁移：

- `CreativeVideoEditor` 及其子组件。
- `HtmlVideoProjectEditor`。
- `creative-video-editor-*` CSS。
- `one-click-editor` 目录。
- 生成 workflow 的后端接口、SSE 事件协议和服务器状态机。

### /creative 组件拆分边界

拆分组件时遵循以下职责边界：

- `OneClickCreativePage.jsx` 保留路由参数、任务列表状态、接口调用、SSE 订阅、localStorage 持久化和页面级派发函数。
- `CreativeSidebar.jsx` 只负责展示任务列表和触发 `onSelectTask`、`onNewTask`、`onDeleteTask`、`onToggleCollapsed`。
- `CreativeComposer.jsx` 只负责输入表单、模式切换、联网研究开关和提交事件。
- `CreativeTaskDetail.jsx` 只负责展示当前 workflow 的详情区域和组合子组件。
- `CreativeWorkflowStepper.jsx` 只负责把 stages 渲染成进度步骤，不发起请求。
- `CreativeVideoPreview.jsx` 只负责视频预览和“继续编辑”操作入口。
- `CreativeStatusMessage.jsx` 只负责统一状态文案展示。

子组件不直接调用 `api`，不直接读写 localStorage，不直接订阅 SSE。

视频编辑器内部暂时保持现状：

- 保留 `creative-video-editor-*` 样式。
- 不在本轮迁移中改写编辑器布局。
- 后续单独规划编辑器工作台重构。

## 组件拆分建议

`/creative` 主页面可以逐步拆成：

```text
frontend-react/src/components/creative/CreativeSidebar.jsx
frontend-react/src/components/creative/CreativeComposer.jsx
frontend-react/src/components/creative/CreativeTaskDetail.jsx
frontend-react/src/components/creative/CreativeWorkflowStepper.jsx
frontend-react/src/components/creative/CreativeVideoPreview.jsx
frontend-react/src/components/creative/CreativeStatusMessage.jsx
```

新增编辑器页面：

```text
frontend-react/src/pages/CreativeEditorPage.jsx
```

保留现有编辑器目录：

```text
frontend-react/src/components/creative-video-editor/
```

## 状态与错误处理

- `/creative` 中所有接口请求继续显示明确 loading 文案。
- `/editor/:workflowId` 加载 workflow 时展示“正在加载编辑任务...”。
- workflowId 缺失时展示“缺少创作任务 ID。”。
- workflow 不存在或接口返回 404 时展示“未找到创作任务。”。
- 编辑器工程加载、保存、渲染、导出继续使用现有编辑器内部状态文案。
- 后端英文错误需要补充中文解释或转换为中文提示。

## 测试与验证

实现后至少验证：

- `npm run build:frontend` 通过。
- `npm test` 通过，或记录失败原因是否与本轮改动无关。
- `/creative` 可以创建任务、选择任务、查看已有任务。
- `/creative/:workflowId` 生成完成后显示首版结果和“继续编辑”入口。
- 点击“继续编辑”进入 `/editor/:workflowId`。
- 直接刷新 `/editor/:workflowId` 后编辑器仍能重新加载。
- 无效 workflowId 显示明确中文错误。
- 视频编辑器现有 HTML video project 和 legacy fallback 路径不回归。
- 搜索确认 `/creative` 主页面不再渲染 `CreativeVideoEditor`。
- 搜索确认本轮迁移区域对应的废弃 `creative*` CSS 已清理，未清理项必须说明仍被哪个文件使用。

## 迁移顺序

1. 新增 `/editor/:workflowId` 页面和路由。
2. 将 `/creative` 内嵌编辑器替换为“继续编辑”跳转入口。
3. 保留 `CreativeVideoEditor` 内部实现和样式。
4. 按 Vite 文档接入官方 `shadcn/ui`，并用 CLI 添加本轮需要的基础组件。
5. 拆分 `/creative` 主页面 UI 组件。
6. 用 Tailwind CSS 与官方 `shadcn/ui` 组件迁移 `/creative` 主页面样式。
7. 清理已不再使用的 `creative*` 主页面 CSS。
8. 后续单独规划视频编辑器 UI 重构。
