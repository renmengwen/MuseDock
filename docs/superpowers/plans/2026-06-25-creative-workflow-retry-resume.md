# 一键创作失败恢复与分阶段重试实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 按 Task 逐项实施。所有步骤使用 checkbox (`- [ ]`) 追踪；实现时先写对应测试，再改业务代码。

**Goal:** 为一键创作增加失败诊断、`project.json.generation_checkpoint`、恢复计划和分阶段重试执行能力，让用户可点击“修复并重试”并复用已完成高成本产物。

**Architecture:** 外层 workflow record 只保存用户可见任务级状态：`retry.attempts`、`retry.latest_plan`、`project_substages`、`last_failure`。html-video project 级恢复状态只写入现有 `<projectDir>/project.json.generation_checkpoint`，不新增 `checkpoint.json`。所有失败沿用 `server/services/creative-video/html-video/diagnostics.js`，通过 `CreativeWorkflowStageError` 从 html-video 内部透传到 `record.last_failure`；`last_failure.project_dir` 是 retry planner 定位 `project.json` 的主入口。retry planner 生成 V1 唯一执行模式 `mode: "repair_and_resume"`，resume executor 复用现有 task registry、active task guard 和 SSE。

**Tech Stack:** Node.js 22、CommonJS、Express、React 19、Vite、现有 `tests/*.js` assert 脚本、现有 html-video project store、现有 `creativeWorkflowTasks.js` 后台任务系统。

**依赖关系总览:**

1. Task 1 `generation_checkpoint` 是所有 resume 判断的基础。
2. Task 2 diagnostics / errors / `ensureSuccess()` 透传是 planner 与 UI 展示的基础，依赖 Task 1 的 checkpoint 字段名。
3. Task 3 content graph、Task 4 frame HTML、Task 5 timeline repair 均依赖 Task 1 和 Task 2。
4. Task 6 retry planner 依赖 Task 1-5 的数据结构与诊断 code。
5. Task 7 resume executor + retry task 依赖 Task 6 的 plan schema。
6. Task 8 API 依赖 Task 6 和 Task 7。
7. Task 9 前端 UI 依赖 Task 8 的接口契约。
8. Task 10 端到端回归依赖 Task 1-9。

**并行子代理分组:**

- 串行基础：Task 1 -> Task 2。
- 并行组 1：Task 3、Task 4、Task 5 可在 Task 2 完成后并行实现。
- 并行组 1 合并顺序：先合并 Task 3 的 `htmlVideoWorkflow.js` content graph 段改动，再合并 Task 4 的 frame HTML loop 改动，最后合并 Task 5 的 render/timeline checkpoint 接线。冲突解决以 `sub_stage`、`frame_id`、`retryable`、`repair_action` 字段全部保留为准。
- 串行核心：Task 6 -> Task 7。planner 输出 schema 必须先冻结，executor 只执行该 schema，不再临时改 mode 或字段名。
- 并行组 2：Task 8 API/client 与 Task 9 前端 UI 可在 Task 7 完成后并行；Task 8 独占 `frontend-react/src/api/client.js` 新增 retry helper，Task 9 只消费这些 helper，不再修改 client 文件。合并顺序为 Task 8 -> Task 9。
- 收尾串行：Task 10 在 Task 8 和 Task 9 合并后执行。

**全局字段约束:**

- 持久化 JSON 和 diagnostics 扩展字段统一使用 snake_case。
- 统一使用 `sub_stage`、`fallback_allowed`、`user_message`。
- 禁止新增 `checkpoint.json`。
- `generation_checkpoint.stages.frame_html.frames` 和 `generation_checkpoint.stages.render.frames` 的 key 统一使用 `scene_id`。
- workflow record 不保存 project 级 checkpoint；project 只保存当前工程可恢复状态，不保存 retry history。
- `htmlVideoWorkflow.js` 与 `frameHtmlAgent.js` 中的 `callTextModel()` / `callModel()` wrapper 必须透传 `options` 参数，至少覆盖 `stream`、`temperature`；retry 逻辑通过 wrapper 透传 options 实现非流式/短 prompt 行为，禁止在 wrapper 外层写不生效的 stream 切换。
- `htmlVideoWorkflow.js` 新增 import 统一加在文件顶部现有 import 块末尾，并按 Task 编号顺序排列；`markCheckpointStage()` / `markCheckpointFrame()` 调用不得跨 Task 修改同一代码行，Task 3 只改 content graph 段，Task 4 只改 frame loop 段，Task 5 只改 render/compose/visual inspect 接线段。

---

### Task 1: `generation_checkpoint` schema 与 project 持久化

**目标:** 在 `project.json` 内新增并持久化 `generation_checkpoint`，覆盖 content graph、frame HTML、render、compose、duration verify、visual inspect 的最小恢复状态。

**修改文件:**

- `server/services/creative-video/html-video/projectSchema.js`
- `server/services/creative-video/html-video/projectStore.js`
- `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`

**新增文件:** 无。

**测试文件:**

- `tests/test-html-video-project-checkpoint-persistence.js`
- 扩展 `tests/test-html-video-project-schema.js`
- 扩展 `tests/test-html-video-project-store.js`

**具体实现步骤:**

- [x] 在 `tests/test-html-video-project-checkpoint-persistence.js` 写入 assert 测试：`createEmptyProject()` 默认包含 `generation_checkpoint.version === 1`，`stages.content_graph.status === 'pending'`，`stages.frame_html.frames` 和 `stages.render.frames` 是空对象。
- [x] 运行 `node tests/test-html-video-project-checkpoint-persistence.js`，预期失败信息包含 `generation_checkpoint` 不存在。
- [x] 在 `projectSchema.js` 新增 `normalizeGenerationCheckpoint(input, project)`，只保留恢复需要字段，未知字段不写入 project。
- [x] 在 `normalizeProject()` 返回值中加入 `generation_checkpoint: normalizeGenerationCheckpoint(input.generation_checkpoint, input)`。
- [x] 在 `projectStore.js` 新增 `writeProjectJson(projectDir, updater)`，内部 `loadProject()` -> 调用 updater -> `saveProject()`，复用 `resolveProjectPath()` 防止路径逃逸。
- [x] 在 `projectStore.js` 新增 `saveContentGraph(projectDir, graph)`，写 `content-graph.json` 后返回相对路径 `content-graph.json`。
- [x] 在 `htmlVideoWorkflow.js` content graph 成功后调用 `saveContentGraph()`，然后更新 `project.generation_checkpoint.stages.content_graph` 为 `done` 并 `saveProject()`。
- [x] 在 `htmlVideoWorkflow.js` 的逐帧 `generateFrameHtml()` loop 中完成“生成 HTML -> 注入字幕层 -> 写入 `frames/<order>-<scene_id>.html` -> 更新 `generation_checkpoint.stages.frame_html.frames[scene_id]` -> `saveProject()`”的闭环，确保第 N 帧失败时前 N-1 帧的 HTML 与 checkpoint 已落盘。
- [x] 明确 caption overlay 只有一个 owner：V1 恢复路径若由 `htmlVideoWorkflow.js` / `writeRawFrameHtml()` 写入最终 HTML，则该函数负责唯一一次 `applyCaptionLayer()`；`rawHtmlFrameBuilder.buildRawHtmlFrameProject()` 在恢复路径只读取已落盘 `html_path` 并组装 metadata，不再重新注入字幕、不覆盖 HTML 文件。
- [x] `writeRawFrameHtml({ projectDir, sceneId, order, html, captions, durationSec })` 放在 `projectStore.js`，复用 `resolveProjectPath()` 防路径逃逸，负责写 HTML 文件和唯一一次 `applyCaptionLayer()`，返回相对路径与 output hash。
- [x] 明确选定单一路径：V1 恢复路径中，frame loop 写盘后，`rawHtmlFrameBuilder.buildRawHtmlFrameProject()` 改为从已落盘 `frames/` HTML 路径构造 `frames`、`timeline`、`content_graph` 和 project，不再接收 `frameHtmlByNodeId`，不写盘，不注入字幕。
- [x] 如需兼容非恢复路径中“HTML 尚未写盘”的旧调用，新增独立 `buildRawHtmlFrameProjectFromMemory({ frameHtmlByNodeId, ... })`，内部先调用 `writeRawFrameHtml()` 后再委托 `buildRawHtmlFrameProject()`；不要让同一个函数同时承担内存 HTML 写盘和已落盘 HTML 组装两种模式。
- [x] 在 `htmlVideoWorkflow.js` 第 N 帧失败前，把当前失败帧写为 `status: 'failed'`、`diagnostic_code` 并立即 `saveProject()`，保留前 N-1 帧的 `done` 状态。
- [x] 在 `projectOrchestrator.js` 后续 Task 5 接入前，先由 Task 1 只初始化 `render`、`compose`、`duration_verify`、`visual_inspect` pending 结构，不改变渲染行为。
- [x] 运行本 Task 验收命令。

**需要新增/修改的函数签名:**

```js
function normalizeGenerationCheckpoint(input = {}, project = {})
function createEmptyGenerationCheckpoint(project = {})
async function writeProjectJson(projectDir, updater)
async function saveContentGraph(projectDir, graph)
async function writeRawFrameHtml({ projectDir, sceneId, order, html, captions, durationSec })
async function buildRawHtmlFrameProject({ projectDir, workflowId, runId, graph, sceneSpec, target, template, mediaOptions })
async function buildRawHtmlFrameProjectFromMemory({ projectDir, workflowId, runId, graph, frameHtmlByNodeId, sceneSpec, target, template, mediaOptions })
function markCheckpointStage(project, stageId, patch = {})
function markCheckpointFrame(project, stageId, sceneId, patch = {})
```

**需要保存的数据结构:**

```js
{
  generation_checkpoint: {
    version: 1,
    workflow_id: '20260625121115575391',
    run_id: '20260625-121140-792Z-2f7731-hyperframes_freeform',
    scene_spec_hash: '',
    target: { duration_sec: 60, aspect_ratio: '9:16' },
    stages: {
      validate_project: { status: 'pending', diagnostic_code: '' },
      content_graph: { status: 'pending', path: '', input_hash: '', output_hash: '', diagnostic_code: '' },
      frame_html: { status: 'pending', frames: {} },
      render: { status: 'pending', frames: {} },
      compose: { status: 'pending', output_path: '', output_audio_path: '' },
      duration_verify: { status: 'pending', expected_duration_sec: null, actual_duration_sec: null },
      visual_inspect: { status: 'pending', report_path: null }
    },
    updated_at: ''
  }
}
```

`frame_html.frames[scene_id]`:

```js
{
  status: 'done|failed|pending',
  html_path: 'frames/01-scene_01.html',
  input_hash: '',
  output_hash: '',
  diagnostic_code: ''
}
```

`render.frames[scene_id]`:

```js
{
  status: 'done|failed|pending',
  mp4_path: 'frames/scene_01.mp4',
  output_hash: '',
  diagnostic_code: ''
}
```

**验收命令:**

```bash
node tests/test-html-video-project-checkpoint-persistence.js
node tests/test-html-video-project-schema.js
node tests/test-html-video-project-store.js
```

**预期结果:**

- 三条命令全部输出对应 passed 文案并退出码为 0。
- `project.json.generation_checkpoint` 在 `saveProject()` / `loadProject()` 后不丢失。
- content graph 成功后 `stages.content_graph.status === 'done'`。
- 单帧 HTML 成功后 `stages.frame_html.frames[scene_id].status === 'done'`。

---

### Task 2: diagnostics 扩展、`CreativeWorkflowStageError` 与 `last_failure`

**目标:** 复用现有 diagnostics 体系，扩展 retry 必需字段，并让 `ensureSuccess()` 失败时透传 html-video diagnostics 到 workflow record 的 `last_failure`。

**修改文件:**

- `server/services/creative-video/html-video/diagnostics.js`
- `server/services/creativeWorkflows.js`
- `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- `server/services/creative-video/html-video/projectOrchestrator.js`
- `server/services/creative-video/html-video/frameHtmlAgent.js`
- `server/services/creative-video/html-video/contentGraphAgent.js`

**新增文件:**

- `server/services/creative-video/errors.js`

**测试文件:**

- `tests/test-creative-workflow-diagnostics-last-failure.js`
- 扩展 `tests/test-html-video-workflow.js`
- 扩展 `tests/test-html-video-frame-html-agent.js`
- 扩展 `tests/test-html-video-content-graph-agent.js`

**具体实现步骤:**

- [x] 先写 `tests/test-creative-workflow-diagnostics-last-failure.js`：构造 `ensureSuccess({ success:false, html_video_project_path:'D:/tmp/project', diagnostics:[...] })` 经 `runCreativeWorkflow()` project 阶段失败后，workflow JSON 包含 `last_failure.stage`、`sub_stage`、`code`、`frame_id`、`project_dir`、`message`、`diagnostics`、`updated_at`。
- [x] 运行 `node tests/test-creative-workflow-diagnostics-last-failure.js`，预期失败为 `last_failure` 缺失或 diagnostics 丢失。
- [x] 新增 `server/services/creative-video/errors.js`，导出 `CreativeWorkflowStageError`，构造参数只使用 snake_case。
- [x] 修改 `diagnostics.js` 的 `createDiagnostic()` 与 `normalizeDiagnostic()`，把 `sub_stage`、`frame_id`、`retryable`、`repair_action` 保留为顶层字段；原有 `code`、`stage`、`user_message`、`details`、`fallback_allowed`、`severity` 行为保持兼容。
- [x] 修改 `createDiagnostic()` 返回值，显式读取 `input.sub_stage`、`input.frame_id`、`input.retryable`、`input.repair_action`；空字符串或未传入时不输出可选字段，`retryable` 只在布尔值时输出。
- [x] 修改 `normalizeDiagnostic()` 的 details 过滤列表，把 `sub_stage`、`frame_id`、`retryable`、`repair_action` 加入排除名单，确保它们不被塞进 `details`。
- [x] 在 `tests/test-creative-workflow-diagnostics-last-failure.js` 增加断言：`createDiagnostic({ sub_stage:'frame_html', frame_id:'scene_05', retryable:true, repair_action:'retry_frame_html' })` 返回对象顶层包含这四个字段。
- [x] 保持所有 html-video failure 继续通过 `failureFromDiagnostics()` 返回，并在调用前后使用 `normalizeDiagnostics()` 归一化 diagnostics；禁止新增第二套 error/diagnostic 格式。
- [x] 修改 `creativeWorkflows.js` 的 `ensureSuccess(result, fallbackMessage, context = {})`，失败时抛 `CreativeWorkflowStageError`，保留 `result.diagnostics || result.html_video_diagnostics`，并从 `result.project_dir || result.html_video_project_path || context.project_dir` 提取 `project_dir` 写入 error。
- [x] 只给 `creativeWorkflows.js` 的 project stage `ensureSuccess()` 调用传入 context：`{ stage:'project', sub_stage:'project', code:'html_video_project_failed' }`，其它 source/research/agent_run/brief/audio/check/render/inspect 调用保持旧签名。
- [x] 修改 `runStage()` catch：识别 `CreativeWorkflowStageError`，写入 `record.last_failure`；同时保留旧 `record.error` 兼容前端现有逻辑。`record.last_failure.project_dir` 必须优先来自 `error.project_dir`，planner 后续通过它定位 `<projectDir>/project.json`。
- [x] 修改 html-video failure 创建点：`provider_missing_text`、`content_graph_invalid`、`frame_html_invalid`、`timeline_duration_unreasonable`、`render_failed`、`compose_failed`、`duration_mismatch` 均写 `sub_stage`、可定位时写 `frame_id`、可自动恢复时写 `retryable: true` 和对应 `repair_action`。
- [x] 新增 `upsertProjectStageSummary(record, summary)` 与 `syncProjectStageSummariesFromCheckpoint(record, generationCheckpoint)`，把 `generation_checkpoint.stages` 映射成 workflow record 的用户可见 `project_substages`；它只复制 `id/status/message/artifacts/diagnostics`，不复制完整 checkpoint。
- [x] `runStage()` project 阶段失败时，如果 error/project result 有 project_dir 且能读取 project checkpoint，调用 `syncProjectStageSummariesFromCheckpoint()` 后再 persist workflow；retry executor 成功/失败时也复用同一 helper 更新 `record.project_substages`。
- [x] 修改 html-video progress event：content graph、frame HTML、render、compose、duration verify、visual inspect 事件增加 `sub_stage`。
- [x] 运行本 Task 验收命令。

**需要新增/修改的函数签名:**

```js
class CreativeWorkflowStageError extends Error {
  constructor(message, {
    stage = '',
    sub_stage = '',
    code = '',
    frame_id = '',
    project_dir = '',
    diagnostics = [],
    retryable = false,
    fallback_allowed = true,
  } = {})
}

function ensureSuccess(result, fallbackMessage, context = {})
function createLastFailureFromError(error, stageId, updatedAt)
function upsertProjectStageSummary(record, summary)
function syncProjectStageSummariesFromCheckpoint(record, generationCheckpoint)
function createDiagnostic(input = {})
function normalizeDiagnostic(input, defaults = {})
function normalizeDiagnostics(items, defaults = {})
function failureFromDiagnostics(message, diagnostics, extra = {})
```

**需要保存的数据结构:**

```js
{
  last_failure: {
    stage: 'project',
    sub_stage: 'frame_html',
    code: 'provider_missing_text',
    frame_id: 'scene_05',
    project_dir: 'D:/code3/MediaCrawler-GUI/data/media/douyin/.../agent_runs/run-html-video',
    message: 'provider_1781667270005 返回结果缺少文本内容。',
    diagnostics: [
      {
        code: 'provider_missing_text',
        stage: 'ai-frame-html',
        sub_stage: 'frame_html',
        frame_id: 'scene_05',
        severity: 'error',
        fallback_allowed: true,
        retryable: true,
        repair_action: 'retry_frame_html',
        user_message: '第 5 帧 HTML 生成时模型返回空内容，将只重试这一帧。',
        details: { provider: 'provider_1781667270005', attempt: 1 },
        created_at: '2026-06-25T00:00:00.000Z'
      }
    ],
    updated_at: '2026-06-25T00:00:00.000Z'
  }
}
```

**验收命令:**

```bash
node tests/test-creative-workflow-diagnostics-last-failure.js
node tests/test-html-video-workflow.js
node tests/test-html-video-frame-html-agent.js
node tests/test-html-video-content-graph-agent.js
```

**预期结果:**

- `provider_missing_text` 能在 workflow JSON 里看到 `last_failure.code === 'provider_missing_text'`。
- `timeline_duration_unreasonable` 能看到 `last_failure.sub_stage === 'timeline_check'`。
- `last_failure.diagnostics` 保留 html-video 内部 diagnostics 数组。
- 旧调用 `ensureSuccess(result, message)` 仍能工作。

---

### Task 3: content graph retry、tolerant parse 与 fallback 边界

**目标:** content graph 支持确定性 JSON 宽容解析、短 prompt 重试和 scene_spec fallback；`fallback_scene_spec_graph` 只作为 `retry_content_graph` 已失败后的恢复动作，不处理首次普通 mismatch。

**修改文件:**

- `server/services/creative-video/html-video/contentGraphAgent.js`
- `server/services/creative-video/html-video/htmlVideoWorkflow.js`

**新增文件:** 无。

**测试文件:**

- `tests/test-html-video-content-graph-retry.js`
- 扩展 `tests/test-html-video-content-graph-agent.js`
- 扩展 `tests/test-html-video-scene-spec-mapper.js`

**具体实现步骤:**

- [x] 写 `tests/test-html-video-content-graph-retry.js`：AI 返回带尾逗号 JSON 时 `parseContentGraphResponse()` 成功并保留 nodes。
- [x] 写同一测试：content graph 空文本第一次失败后，workflow 通过现有模型调用参数 `stream:false` 做非流式短 prompt 重试一次；第二次仍失败时使用 `mapSceneSpecToContentGraph(sceneSpec)`。
- [x] 写同一测试：`content_graph_scene_spec_mismatch` 首次运行记录 warning 并自动 fallback，不把 retry action 设为 `fallback_scene_spec_graph`。
- [x] 运行 `node tests/test-html-video-content-graph-retry.js`，预期失败为尾逗号无法解析或空文本未重试。
- [x] 在 `contentGraphAgent.js` 新增 `tolerantParseJson(text)`，只做 fenced JSON 提取、去尾逗号、有限未转义引号修复。
- [x] 在 `contentGraphAgent.js` 新增 `buildRetryPrompt(sceneSpec, creativeContext, target, originalPrompt, attempt)`；attempt 1 保留 scene id/title/duration/narration，attempt 2 只保留最小 `nodes` schema。
- [x] 修改 `parseContentGraphResponse()` 先调用 tolerant parse，再进入 `normalizeContentGraph()`。
- [x] 修改 `htmlVideoWorkflow.js` 的 `callTextModel(model, prompt, options = {})` wrapper，将 `options.stream`、`options.temperature` 等传给 `model.callTextModel()`；当前底层默认 `stream:false`，显式传参用于固定 retry 语义并防止未来默认值变化。
- [x] 修改 `htmlVideoWorkflow.js` content graph AI 调用失败路径：当 `graphAi.message` 匹配 `返回结果缺少文本内容` 或 `流式返回结果缺少文本内容` 时，diagnostic `code` 使用 `provider_missing_text`，否则保持 `content_graph_failed`。
- [x] 修改 `htmlVideoWorkflow.js` content graph 调用：provider missing text 时先非流式重试，再短 prompt 重试；仍失败则返回带 `repair_action: 'fallback_scene_spec_graph'` 的 diagnostic，或在首次运行可直接用 scene_spec graph 继续。
- [x] content graph 成功、fallback 成功、失败三种路径都更新 `generation_checkpoint.stages.content_graph`。
- [x] 运行本 Task 验收命令。

**需要新增/修改的函数签名:**

```js
function tolerantParseJson(text)
function buildRetryPrompt(sceneSpec, creativeContext, target, originalPrompt, attempt)
function parseContentGraphResponse(text, sceneSpec = {}, options = {})
async function callTextModel(model, prompt, options = {})
async function generateContentGraphWithRetry({ model, sceneSpec, creativeContext, target, onProgress, project, projectDir })
```

**需要保存的数据结构:**

```js
{
  generation_checkpoint: {
    stages: {
      content_graph: {
        status: 'done|failed',
        path: 'content-graph.json',
        input_hash: '',
        output_hash: '',
        diagnostic_code: 'content_graph_invalid'
      }
    }
  }
}
```

失败 diagnostic：

```js
{
  code: 'provider_missing_text',
  stage: 'ai-content-graph',
  sub_stage: 'content_graph',
  retryable: true,
  repair_action: 'retry_content_graph',
  fallback_allowed: true,
  user_message: 'content graph 生成时模型返回空内容，将重试内容图生成。'
}
```

**验收命令:**

```bash
node tests/test-html-video-content-graph-retry.js
node tests/test-html-video-content-graph-agent.js
node tests/test-html-video-scene-spec-mapper.js
```

**预期结果:**

- content graph JSON 尾逗号可解析成功。
- content graph 空文本最多触发两次模型调用后 fallback scene_spec graph。
- 首次 `content_graph_scene_spec_mismatch` 只记录 warning 并继续，不进入 retry API。

---

### Task 4: frame HTML 局部 resume、固定缺文本重试序列与 fallback HTML

**目标:** frame HTML 支持按失败帧局部重试，`provider_missing_text at frame_html` 固定为最多 2 次模型调用 + 1 次 fallback，且不与内部 HTML 无效 retry 混成无限重试。

**修改文件:**

- `server/services/creative-video/html-video/frameHtmlAgent.js`
- `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`

**新增文件:**

- `server/services/creative-video/html-video/frameFallbackBuilder.js`

**测试文件:**

- `tests/test-html-video-frame-html-resume.js`
- 扩展 `tests/test-html-video-frame-html-agent.js`
- 扩展 `tests/test-html-video-raw-html-frame-builder.js`

**具体实现步骤:**

- [x] 写 `tests/test-html-video-frame-html-resume.js`：`scene_01`、`scene_02` 已在 checkpoint 标记 done，`scene_03` 缺文本失败时，resume 只调用 `generateFrameHtml()` 一次处理 `scene_03`。
- [x] 写同一测试：第一次 `generateFrameHtml({ frameId:'scene_03', attempt:1 })` 返回 provider missing text，第二次调用参数必须包含 `attempt:2`、`modelOptions:{ stream:false }`、`shortPrompt:true`。
- [x] 写同一测试：第二次仍缺文本时调用 `frameFallbackBuilder.buildFallbackFrameHtml()`，checkpoint 写 warning diagnostic。
- [x] 运行 `node tests/test-html-video-frame-html-resume.js`，预期失败为 `attempt` 参数或 fallback builder 不存在。
- [x] 修改 `frameHtmlAgent.js` 的 `callModel(model, prompt, options = {})` wrapper，将 `options.stream` 传给 `model.callTextModel()`；当前底层默认 `stream:false`，显式传参用于固定 retry 语义。
- [x] 在 `frameHtmlAgent.js` 修改 `generateFrameHtml({ model, frameId, attempt = 1, modelOptions = {}, shortPrompt = false, ...args })`；非流式重试通过 `model.callTextModel({ ..., stream:false })` 或 wrapper 透传 `modelOptions.stream = false` 实现，禁止新增只在流程层存在但模型层不生效的伪参数。
- [x] 定义 `shortPrompt:true` 行为：使用 skeleton prompt，只保留 scene id、scene title、当前 scene narration/captions、target resolution、必须输出完整 HTML、必须包含 `data-text-key="headline|subtitle|body"` 和基础动画；移除 creativeContext 长文、content graph 全量 JSON、visual style reference HTML、previous frame HTML、长示例和设计解释。
- [x] 修改 `generateFrameHtml()` 内部调用 `callModel()` 的位置：当 `attempt >= 2` 且 `modelOptions.stream === false` 时，显式传递 `{ stream:false }`；普通 HTML 无效 retry 继续走原有 retry prompt，不计入 provider missing text 外层 attempt。
- [x] 明确调用计数边界：`provider_missing_text` 外层最多两次模型调用，分别是 attempt 1 原始 prompt 和 attempt 2 `modelOptions:{ stream:false }` + `shortPrompt:true`；只有模型返回了非空文本但 HTML 无效时，才允许执行现有 HTML 验证 retry，该内部 retry 不触发第三次 provider missing text 外层 attempt。
- [x] 新增 `frameFallbackBuilder.js`，导出 `buildFallbackFrameHtml({ scene, node, target, template } = {})`，生成完整 `<!doctype html>` 文档，包含 `data-text-key="headline"`、`subtitle`、`body`。
- [x] 修改 `htmlVideoWorkflow.js` frame HTML 失败路径：当 `htmlResult.message` 匹配 `返回结果缺少文本内容` 或 `流式返回结果缺少文本内容` 时，diagnostic `code` 使用 `provider_missing_text`，否则保持 `frame_html_invalid`。
- [x] 修改 `htmlVideoWorkflow.js` frame loop：读取 `generation_checkpoint.stages.frame_html.frames[scene_id]`，已 done 且 HTML 文件存在并通过基础校验时复用。
- [x] 失败帧只丢弃当前 `frames:<scene_id>` 和后续 render/export，不删除其它 frame HTML。
- [x] 运行本 Task 验收命令。
- [x] Task 4 closure audit、spec compliance review、code quality review 均通过；补齐 content graph 重新生成清理与 diagnostic code 优先级回归测试。

**需要新增/修改的函数签名:**

```js
async function generateFrameHtml({
  model,
  frameId,
  attempt = 1,
  modelOptions = {},
  shortPrompt = false,
  graph,
  node,
  index,
  total,
  sceneSpec,
  creativeContext,
  target,
  template,
  visualStyleReferenceHtml,
  previousFrameHtml,
} = {})

async function callModel(model, prompt, options = {})
function buildFallbackFrameHtml({ scene, node, target, template } = {})
function shouldReuseFrameHtml({ projectDir, checkpointFrame, scene, node, target })
```

**需要保存的数据结构:**

```js
{
  generation_checkpoint: {
    stages: {
      frame_html: {
        status: 'partial',
        frames: {
          scene_03: {
            status: 'failed',
            html_path: '',
            input_hash: '',
            output_hash: '',
            diagnostic_code: 'provider_missing_text'
          }
        }
      }
    }
  }
}
```

fallback warning diagnostic：

```js
{
  code: 'fallback_frame_html_used',
  stage: 'ai-frame-html',
  sub_stage: 'frame_html',
  frame_id: 'scene_03',
  severity: 'warning',
  fallback_allowed: true,
  retryable: false,
  user_message: '当前帧 AI 生成连续失败，已使用基础 HTML 兜底。'
}
```

**验收命令:**

```bash
node tests/test-html-video-frame-html-resume.js
node tests/test-html-video-frame-html-agent.js
node tests/test-html-video-raw-html-frame-builder.js
```

**预期结果:**

- provider missing text at frame_html 只重试失败帧，不重跑 source/research/brief/audio/content_graph。
- 固定尝试序列为原始 prompt -> 非流式短 prompt -> fallback HTML。
- 最多 2 次模型调用 + 1 次 fallback。

---

### Task 5: timeline repair 与 render/compose/duration/visual checkpoint

**目标:** 将 timeline duration 异常拆成纯 `repair_timeline` 与跨阶段 `repair_script_and_timeline`，拆出局部 render/compose 能力，并补齐 validate_project、render、compose、duration_verify、visual_inspect checkpoint。

**修改文件:**

- `server/services/creative-video/html-video/projectOrchestrator.js`
- `server/services/creative-video/html-video/htmlVideoWorkflow.js`

**新增文件:**

- `server/services/creative-video/html-video/timelineRepair.js`

**测试文件:**

- `tests/test-html-video-timeline-repair.js`
- 扩展 `tests/test-html-video-project-orchestrator.js`
- 扩展 `tests/test-html-video-timeline-consistency.js`

**具体实现步骤:**

- [x] 写 `tests/test-html-video-timeline-repair.js`：target 60 秒、frames 总和 132 秒、audio 未超目标时，`analyzeTimelineMismatch()` 返回 `repair_action: 'repair_timeline'`。
- [x] 写同一测试：audio duration 超 60 秒时，`analyzeTimelineMismatch()` 返回 `requires_script_repair: true` 和 `repair_action: 'repair_script_and_timeline'`。
- [x] 写同一测试：`compressNarrationForTarget(sceneSpec, 60)` 返回保留 scene id/order/theme metadata 的 scene_spec，并缩短 `narration_text` 与 `captions`。
- [x] 写同一测试：`repairProjectTimeline()` 不调用 AI、不重新 TTS，只调整 scene/frame/content_graph duration。
- [x] 运行 `node tests/test-html-video-timeline-repair.js`，预期失败为 `timelineRepair.js` 不存在。
- [x] 新增 `timelineRepair.js`，实现 `analyzeTimelineMismatch()`、`compressNarrationForTarget()` 与 `repairProjectTimeline()`。
- [x] 修改 `htmlVideoWorkflow.js` 调用 `validateHtmlVideoProject()` 后立即更新 `generation_checkpoint.stages.validate_project`：成功写 `status:'done'`，失败写 `status:'failed'` 与首个 diagnostic code，避免 planner 把 validation failure 误判成未知 project failure。
- [x] 修改 `projectOrchestrator.js`：`validateReasonableTimelineDuration()` 失败时 diagnostic 使用 `sub_stage: 'timeline_check'`、`repair_action: 'repair_timeline'` 或 `repair_script_and_timeline`。
- [x] 在 `projectOrchestrator.js` 新增 `renderHtmlVideoFrames({ rootDir, workflowId, runId, projectDir, project, frameIds, templateRegistry, services, onProgress, materialize = false })`，只渲染 `frameIds` 指定帧，更新对应 `render.frames[scene_id]` checkpoint，不执行 compose。
- [x] `renderHtmlVideoFrames()` materialize 策略固定：`rerender_frames` 场景默认 `materialize:false`，直接使用已落盘 frame HTML 与 project frame metadata；`retry_frame_html`、`repair_timeline`、`repair_script_and_timeline` 修改了 HTML 或 project duration 时传 `materialize:true`，仅此时先调用 materializer。
- [x] 在 `projectOrchestrator.js` 新增 `composeHtmlVideoProject({ rootDir, workflowId, runId, projectDir, project, services, onProgress, targetDurationSec })`，复用已存在 frame mp4 执行 concat/mux/duration verify，更新 `compose` 和 `duration_verify` checkpoint，不调用 AI、不重新渲染 frame。
- [x] `composeHtmlVideoProject()` 必须复用现有完整 compose 段逻辑：收集 renderedFrames -> `concatFramesWithFfmpeg()` -> 判断 `audioDisabled` -> `resolveNarrationPath()` -> `muxAudioWithFfmpeg()` -> `verifyDurationWithFfprobe()` -> `addExport()` -> `addRevision()` -> `saveProject()`；不得只做 concat 后直接返回。
- [x] 保留现有 `renderHtmlVideoProject()` 作为完整路径入口，但内部改为顺序调用 materialize/timeline check -> `renderHtmlVideoFrames()` -> `composeHtmlVideoProject()`，避免三套渲染/合成逻辑分叉。
- [x] 修改 `projectOrchestrator.js` frame render loop：每帧成功写 `generation_checkpoint.stages.render.frames[scene_id] = { status:'done', mp4_path, output_hash, diagnostic_code:'' }`；失败写 `status:'failed'` 与具体 code。
- [x] 修改 compose 成功后写 `generation_checkpoint.stages.compose = { status:'done', output_path, output_audio_path }`；compose 失败写 `status:'failed'`。
- [x] 修改 duration verify 成功后写 `duration_verify.status = 'done'`、`expected_duration_sec`、`actual_duration_sec`；失败写 `status:'failed'`、`diagnostic_code:'duration_mismatch'`。
- [x] 修改 `htmlVideoWorkflow.js` visual inspect 成功后写 `visual_inspect.status = 'done'`、`report_path`；失败 warning 也写 checkpoint 状态，供 `rerun_visual_inspect` 使用。
- [x] 运行本 Task 验收命令。
- [x] Task 5 spec compliance review、code quality review 均通过；补齐局部 render 未命中、compose 缺帧、caption 缩放与 visual inspect checkpoint 回归测试。

**需要新增/修改的函数签名:**

```js
function analyzeTimelineMismatch({ project, sceneSpec, targetDurationSec, audioManifest })
function compressNarrationForTarget(sceneSpec, targetDurationSec)
function repairProjectTimeline({ project, sceneSpec, targetDurationSec, audioManifest })
async function renderHtmlVideoFrames({ rootDir, workflowId, runId, projectDir, project, frameIds, templateRegistry, services, onProgress, materialize = false })
// -> { success, project, project_dir, html_video_project_path, rendered_frames, diagnostics }

async function composeHtmlVideoProject({ rootDir, workflowId, runId, projectDir, project, services, onProgress, targetDurationSec })
// -> { success, project, project_dir, html_video_project_path, output_path, diagnostics, duration_check }
function markRenderCheckpoint(project, sceneId, patch = {})
function markComposeCheckpoint(project, patch = {})
function markDurationVerifyCheckpoint(project, patch = {})
function markVisualInspectCheckpoint(project, patch = {})
```

**需要保存的数据结构:**

```js
{
  generation_checkpoint: {
    stages: {
      validate_project: {
        status: 'done|failed',
        diagnostic_code: ''
      },
      render: {
        status: 'partial',
        frames: {
          scene_04: {
            status: 'failed',
            mp4_path: '',
            output_hash: '',
            diagnostic_code: 'render_failed_timeout'
          }
        }
      },
      compose: {
        status: 'done',
        output_path: 'exports/output.mp4',
        output_audio_path: 'exports/output-audio.mp4'
      },
      duration_verify: {
        status: 'done',
        expected_duration_sec: 60,
        actual_duration_sec: 60.4
      },
      visual_inspect: {
        status: 'done',
        report_path: 'inspect/visual-report.json'
      }
    }
  }
}
```

**验收命令:**

```bash
node tests/test-html-video-timeline-repair.js
node tests/test-html-video-project-orchestrator.js
node tests/test-html-video-timeline-consistency.js
```

**预期结果:**

- target 60 秒、frames 总和 132 秒时 planner 可得到 `repair_timeline` 或 `repair_script_and_timeline` 的明确输入。
- audio duration 超目标时不会生成 `repair_timeline`。
- 单帧 render timeout 只标记该帧 render checkpoint failed。
- compose duration mismatch 写入 `duration_verify` failed，不调用 AI。

---

### Task 6: retry planner

**目标:** 新增只读 retry planner，根据 workflow、project checkpoint、last_failure 和 diagnostics 生成 V1 `repair_and_resume` 计划。

**修改文件:**

- `server/services/creativeWorkflows.js`

**新增文件:**

- `server/services/creative-video/retryPlanner.js`

**测试文件:**

- `tests/test-creative-workflow-retry-planner.js`

**具体实现步骤:**

- [x] 写 `tests/test-creative-workflow-retry-planner.js`：provider missing text at frame_html 输出 `can_retry:true`、`mode:'repair_and_resume'`、`repair_action:'retry_frame_html'`、`retry_from:'frame_html'`。
- [x] 写同一测试：content graph 空文本先输出 `retry_content_graph`；模拟 retry 已失败且 scene_spec 可用时输出 `fallback_scene_spec_graph`。
- [x] 写同一测试：content graph JSON 尾逗号 tolerant parse 成功不需要 retry plan。
- [x] 写同一测试：target 60 秒、frames 132 秒且 audio 未超目标输出 `repair_timeline`。
- [x] 写同一测试：audio duration 超目标输出 `repair_script_and_timeline`。
- [x] 写同一测试：单帧 render timeout 输出 `rerender_frames` 且 `executor_options.frame_ids` 只含失败帧。
- [x] 写同一测试：compose duration mismatch 输出 `recompose`。
- [x] 写同一测试：workflow project stage 失败且只有 `last_failure.project_dir` 时，现有 `extractHtmlVideoProjectPathFromWorkflow(record)` 能定位并读取 `<projectDir>/project.json`。
- [x] 写同一测试：`generation_checkpoint.stages.validate_project.status === 'failed'` 时，planner 输出 `restart_project` 或对应可恢复 action，不落入 `unknown_project_failure`。
- [x] 写同一测试：`ffmpeg_not_configured`、`playwright_not_configured` 输出 `can_retry:false`、`fallback_allowed:false`。
- [x] 运行 `node tests/test-creative-workflow-retry-planner.js`，预期失败为模块不存在。
- [x] 实现 `retryPlanner.js`，分类优先级固定为 diagnostic code -> diagnostic stage + message -> workflow.error.code -> workflow.error.message -> checkpoint failed stage -> `unknown_project_failure`。
- [x] 在 `creativeWorkflows.js` 新增纯读 `getCreativeWorkflowRetryPlan(workflowId, options)`，只读取 workflow 与 html-video project 并返回 plan，不修改文件。
- [x] 在 `creativeWorkflows.js` 新增 `refreshCreativeWorkflowRetryPlan(workflowId, options)`，内部调用纯读 planner，然后显式写回 `record.retry.latest_plan` 与 `record.updated_at`；只有 GET `/retry-plan` 和 POST `/retry` 执行前允许调用这个刷新函数。
- [x] POST `/retry` 执行前必须重新调用 `refreshCreativeWorkflowRetryPlan()`，再校验 `confirm_plan_code`；不得直接信任旧 `latest_plan`。
- [x] 修改现有 `creativeWorkflows.js` 的 `extractHtmlVideoProjectPathFromWorkflow(record)`，定位优先级为 `record.last_failure.project_dir` -> `record.result.hyperframes_freeform.project.html_video_project_path` -> `record.result.hyperframes_freeform.project.project_dir` -> `record.result.hyperframes_freeform.html_video_project_path` -> `record.result.hyperframes_freeform.project_dir` -> stage result 中的 `html_video_project_path` / `project_dir` -> `''`。
- [x] planner、retry API、编辑、渲染、导出等所有 html-video project 读取路径都复用 `extractHtmlVideoProjectPathFromWorkflow(record)`；不要新增并维护第二套 `resolveHtmlVideoProjectFromWorkflow()`。首次 project stage 失败时 `record.result` 通常为空，必须依赖 `last_failure.project_dir`。
- [x] unknown 失败只允许 `can_retry:false`，除非已有 checkpoint 明确定位到可恢复 stage。
- [x] 运行本 Task 验收命令。

**需要新增/修改的函数签名:**

```js
function classifyCreativeWorkflowFailure(input)
function createCreativeWorkflowRetryPlan(input)
async function getCreativeWorkflowRetryPlan(workflowId, options = {})
async function refreshCreativeWorkflowRetryPlan(workflowId, options = {})
function extractHtmlVideoProjectPathFromWorkflow(record)
```

**需要保存的数据结构:**

planner 输出：

```js
{
  success: true,
  workflow_id: '20260625121115575391',
  can_retry: true,
  fallback_allowed: true,
  mode: 'repair_and_resume',
  code: 'provider_missing_text',
  retry_from: 'frame_html',
  repair_action: 'retry_frame_html',
  reuse: ['source', 'research', 'assets', 'agent_run', 'brief', 'audio', 'content_graph', 'frames:scene_01-scene_04'],
  discard: ['frames:scene_05', 'render_outputs', 'exports'],
  warnings: [],
  user_message: '将复用已完成内容，只重新生成失败帧并重新导出。',
  executor_options: {
    frame_ids: ['scene_05'],
    max_attempts: 2,
    model_options: { stream: false },
    use_short_prompt: true
  }
}
```

不可自动重试：

```js
{
  success: true,
  workflow_id: '20260625121115575391',
  can_retry: false,
  fallback_allowed: false,
  mode: 'repair_and_resume',
  code: 'ffmpeg_not_configured',
  user_message: 'ffmpeg 不可用，请先在设置中心修复系统环境后再重试。'
}
```

**验收命令:**

```bash
node tests/test-creative-workflow-retry-planner.js
```

**预期结果:**

- 所有设计要求的 repair action 均有稳定输出。
- V1 只出现 `mode: "repair_and_resume"`。
- `fallback_scene_spec_graph` 只在 `retry_content_graph` 已失败且 scene_spec 可用时输出。

---

### Task 7: resume executor 与 retry task

**目标:** 新增 resume executor 执行 planner 输出，并通过现有 `creativeWorkflowTasks.js` registry、active task guard、SSE 和 `patchCreativeWorkflowTaskSummary()` 启动 retry 后台任务。

**修改文件:**

- `server/services/creativeWorkflows.js`
- `server/services/creativeWorkflowTasks.js`
- `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- `server/services/creative-video/html-video/projectOrchestrator.js`

**新增文件:**

- `server/services/creative-video/resumeExecutor.js`

**测试文件:**

- `tests/test-creative-workflow-retry-task.js`
- 扩展 `tests/test-creative-workflow-tasks.js`
- 扩展 `tests/test-creative-workflow-task-summary.js`

**具体实现步骤:**

- [x] 写 `tests/test-creative-workflow-retry-task.js`：已有 active running task 时 `startCreativeWorkflowRetryTask()` 返回失败，不创建新 task。
- [x] 写同一测试：retry task summary 包含 `operation:'retry'` 和 `retry_attempt_id`。
- [x] 写同一测试：`retry_frame_html` 成功后 workflow `status === 'done'`，project/check/render/inspect 符合 html-video lite 语义：project done、check skipped、render done、inspect done。
- [x] 写同一测试：retry 失败时 `retry.attempts[last].status === 'failed'`，`previous_failure` 保留执行前的 `last_failure`，新的 `last_failure` 写最新 diagnostics。
- [x] 运行 `node tests/test-creative-workflow-retry-task.js`，预期失败为 retry task API 不存在。
- [x] 新增 `resumeExecutor.js`，导出 `executeCreativeWorkflowRetryPlan(options)`，只接受 planner schema，不自行创建 mode。
- [x] 实现 action：`retry_content_graph`、`fallback_scene_spec_graph`、`retry_frame_html`、`repair_timeline`、`repair_script_and_timeline`、`rerender_frames`、`recompose`、`rerun_visual_inspect`、`restart_project`。
- [x] `rerender_frames` 固定调用 Task 5 新增的 `projectOrchestrator.renderHtmlVideoFrames({ frameIds, materialize:false })` 后再调用 `composeHtmlVideoProject()` 和 visual inspect；不得调用完整 `renderHtmlVideoProject()` 导致全部帧重渲染。
- [x] `retry_frame_html`、`repair_timeline`、`repair_script_and_timeline` 在修改 HTML 或 duration 后调用 `renderHtmlVideoFrames({ frameIds, materialize:true })`，再 compose/inspect。
- [x] `recompose` 固定调用 Task 5 新增的 `projectOrchestrator.composeHtmlVideoProject()` 和 visual inspect；不得调用 AI、frame HTML 或 frame render。
- [x] executor 执行 visual inspect 时直接调用 `services.visualQaService.inspectRenderedVideo({ projectDir, outputPath, expectedAspectRatio })`；`outputPath` 来自 `composeHtmlVideoProject()` 返回的 `output_path`，`expectedAspectRatio` 优先使用 `project.target?.aspect_ratio || project.output?.aspect_ratio`，返回值作为 `visualInspectResult` 传给 `buildHtmlVideoLiteProjectStageResult()`。
- [x] `rerun_visual_inspect` 不调用 render/compose，只从 `project.exports` 或 checkpoint `compose.output_path` 找到现有视频输出文件，然后调用 `services.visualQaService.inspectRenderedVideo()` 并更新 `generation_checkpoint.stages.visual_inspect`。
- [x] `restart_project` V1 仅用于 `generation_checkpoint` 缺失、`validate_project` failed 且无法局部定位、或 project artifacts 不可读的失败：复用 source/research/assets/agent_run/brief/audio（仅当 audio `scene_spec_hash` 与当前 scene_spec hash 一致），丢弃旧 project artifacts，从 scene_spec/template/content_graph 重新开始 project 阶段。
- [x] `repair_timeline` 内部禁止调用 AI 和 TTS；`repair_script_and_timeline` 才允许压缩旁白或重新生成 brief -> TTS -> timeline repair。
- [x] `repair_script_and_timeline` V1 使用确定性压缩，不复用 `runCreativeWorkflow()` 里的 brief stage handler：scene_spec 来源优先级为 `project.scene_spec` / project metadata -> `workflow.result.hyperframes_freeform.scene_spec` -> run artifacts 中的 scene spec；读取后调用 `timelineRepair.compressNarrationForTarget(sceneSpec, targetDurationSec)` 按目标时长比例压缩 `narration_text` 与 `captions`，保留 scene id、order、主题结构和 visual metadata。
- [x] 压缩后重新计算 `scene_spec_hash`，更新 project 内 scene_spec/audio 相关字段，丢弃旧 `brief`、`audio`、`render_outputs`、`exports` 和依赖旧旁白时长的 duration 分配。
- [x] 重新 TTS 固定调用 `services.ttsService.synthesizeSceneNarration({ projectDir, sceneSpec })`；不要调用 `agentRuns.synthesizeDouyinRunHyperframesFreeformAudio()`，避免回到外层 workflow audio stage。
- [x] TTS 成功后更新 `project.audio.scene_spec_hash`、`project.audio.scene_count`、`project.audio.scene_ids`、`project.audio.status`、`project.audio.narration_path`、`project.audio.tts_manifest_path`，再调用 `timelineRepair.repairProjectTimeline()`，最后从 materialize -> render -> compose -> inspect 继续。
- [x] `rerun_visual_inspect` 复用所有 AI 产物、project.json、frame mp4、exports/output.mp4；只清理旧 `visual_inspect` checkpoint 状态，历史报告保留在 revisions 或 reports 数组。
- [x] 在 `creativeWorkflows.js` 新增 `retryCreativeWorkflow(workflowId, payload, options)`，执行前重新生成 plan，校验 `payload.mode === 'repair_and_resume'` 和 `confirm_plan_code`。
- [x] 在 `creativeWorkflowTasks.js` 新增 `startCreativeWorkflowRetryTask(workflowId, options)`，复用 `startCreativeWorkflowTask()` 的 registry、SSE、terminal patch 写法，但 active task guard 是 retry 新增行为，不是 registry 或原启动函数已有能力；task kind 仍使用现有 registry 支持的 workflow task，summary 增加 retry 字段。
- [x] `startCreativeWorkflowRetryTask()` 创建 task 前必须先调用 `registry.activeTaskForWorkflow(workflowId)`；如果存在 `status === 'running'` 的 active task，直接返回 `{ success:false, workflow_id, message:'当前创作任务仍在运行，请等待结束后再重试。', active_task }`，不得调用 `registry.createDetachedTask()`。
- [x] 新增 `buildHtmlVideoLiteProjectStageResult({ project, projectDir, renderResult, visualInspectResult })`，构造 `markHtmlVideoLiteFinalStages()` 需要的最小结构：`{ hyperframes_freeform:{ project:{ render_mode:'html-video', html_video_project_path: projectDir, project_dir: projectDir }, render:{ status:'rendered', message:'html-video production 成片已导出。', output_path }, visual_inspect:{ status:'done', message:'html-video production 视觉质检通过。', report_path } } }`。
- [x] retry 成功时在 `creativeWorkflows.js` 同模块内调用现有 `markHtmlVideoLiteFinalStages(record, now, buildHtmlVideoLiteProjectStageResult(...))`；如果 `resumeExecutor.js` 必须跨模块调用，则从 `creativeWorkflows.js` 显式导出该 helper。禁止重新手写三段 check/render/inspect 标记逻辑。
- [x] retry 成功时调用 `syncProjectStageSummariesFromCheckpoint(record, project.generation_checkpoint)` 更新 `record.project_substages`，清空 `workflow.last_failure`，把执行前 failure 写入 attempt 的 `previous_failure`，更新 `workflow.status = 'done'`。
- [x] retry 失败时同样调用 `syncProjectStageSummariesFromCheckpoint()`，保留最新 failed project stage summary，写入新的 `workflow.last_failure`。
- [x] 运行本 Task 验收命令。

**需要新增/修改的函数签名:**

```js
async function executeCreativeWorkflowRetryPlan({
  workflowId,
  plan,
  rootDir,
  mediaRoot,
  services,
  taskContext,
} = {})

async function retryCreativeWorkflow(workflowId, payload = {}, options = {})
async function startCreativeWorkflowRetryTask(workflowId, options = {})
function buildHtmlVideoLiteProjectStageResult({ project, projectDir, renderResult, visualInspectResult })
function markHtmlVideoLiteFinalStages(record, now, projectStageResult = {})
```

action 输入输出：

```js
async function executeRetryFrameHtml({ workflow, project, generation_checkpoint, frame_id, services, taskContext })
// -> { success, project, generation_checkpoint, diagnostics }

async function executeRerenderFrames({ workflow, project, generation_checkpoint, frame_ids, services, taskContext })
// -> { success, project, generation_checkpoint, output_path, diagnostics }
```

**需要保存的数据结构:**

```js
{
  retry: {
    version: 1,
    attempts: [
      {
        id: 'retry_20260625_123000',
        created_at: '2026-06-25T12:30:00.000Z',
        mode: 'repair_and_resume',
        reason_code: 'provider_missing_text',
        retry_from: 'frame_html',
        repair_action: 'retry_frame_html',
        reuse: ['source', 'research', 'brief', 'audio', 'content_graph'],
        discard: ['frames:scene_05', 'render_outputs'],
        status: 'running|done|failed',
        message: '正在重新生成第 5 帧 HTML...',
        previous_failure: {}
      }
    ],
    latest_plan: {}
  },
  project_substages: [
    {
      id: 'frame_html',
      status: 'done|partial|failed|skipped',
      message: '第 5 帧 HTML 已恢复。',
      artifacts: [
        { kind: 'frame_html', path: 'frames/05-scene_05.html', hash: '' }
      ],
      diagnostics: []
    },
    {
      id: 'render',
      status: 'partial',
      message: '第 4 帧渲染失败。',
      artifacts: [],
      diagnostics: [
        { code: 'render_failed_timeout', sub_stage: 'render', frame_id: 'scene_04' }
      ]
    }
  ]
}
```

task summary patch：

```js
{
  operation: 'retry',
  retry_attempt_id: 'retry_20260625_123000',
  active_task_id: 'workflow-20260625121115575391-...',
  active_operation_id: '...'
}
```

**验收命令:**

```bash
node tests/test-creative-workflow-retry-task.js
node tests/test-creative-workflow-tasks.js
node tests/test-creative-workflow-task-summary.js
```

**预期结果:**

- retry task 使用现有 SSE 事件流，不出现第二套 task registry。
- active task guard 阻止并发 retry。
- retry 成功后 workflow done，html-video lite 外层 check skipped、render done、inspect done。
- retry 失败不会覆盖原始 failure 诊断。

---

### Task 8: retry API 与前端 client

**目标:** 增加 retry plan 查询和执行接口，V1 POST 只支持 `mode: "repair_and_resume"`，并在前端 client 暴露稳定函数。

**修改文件:**

- `server/routes/creativeWorkflows.js`
- `frontend-react/src/api/client.js`

**新增文件:** 无。

**测试文件:**

- 扩展 `tests/test-creative-workflow-routes.js`
- 扩展 `tests/test-creative-workflow-retry-task.js`

**具体实现步骤:**

- [x] 在 `tests/test-creative-workflow-routes.js` 增加 GET `/api/creative-workflows/:workflow_id/retry-plan` 成功用例：failed workflow 返回 `success:true` 和 `plan.can_retry`。
- [x] 在同一 GET 用例中读取 workflow JSON，断言 `record.retry.latest_plan.code === response.plan.code`，确认 GET 只刷新 plan 缓存、不启动 task。
- [x] 增加 GET 失败用例：非 failed workflow 返回 `success:false`、中文 message `当前任务未失败，无需重试。`。
- [x] 增加 POST `/api/creative-workflows/:workflow_id/retry` 用例：`mode:'repair_and_resume'` 返回 task id。
- [x] 增加 POST mode 非法用例：`mode:'rerun_only'` 返回 400，message 明确 V1 仅支持 `repair_and_resume`。
- [x] 增加 active task 用例：返回 409，message 为 `当前创作任务仍在运行，请等待结束后再重试。`。
- [x] 运行 `node tests/test-creative-workflow-routes.js`，预期 retry routes 不存在。
- [x] 在 `creativeWorkflows.js` 导出 `getCreativeWorkflowRetryPlan()`、`refreshCreativeWorkflowRetryPlan()` 与 `retryCreativeWorkflow()`。
- [x] 在 `creativeWorkflowTasks.js` 导出 `startCreativeWorkflowRetryTask()`。
- [x] 在 `server/routes/creativeWorkflows.js` 新增 GET retry-plan route，调用 `refreshCreativeWorkflowRetryPlan()` 生成 plan、写入 `record.retry.latest_plan`，再返回 plan；该 GET 不启动后台 task。
- [x] 在 `server/routes/creativeWorkflows.js` 新增 POST retry route，校验 mode，先重新调用 `refreshCreativeWorkflowRetryPlan()`，再校验 `confirm_plan_code` 并调用 task service 启动 retry task。
- [x] 在 `frontend-react/src/api/client.js` 新增 `getCreativeWorkflowRetryPlan(workflowId)` 和 `retryCreativeWorkflow(workflowId, payload)`。
- [x] 运行本 Task 验收命令。

**需要新增/修改的函数签名:**

```js
// server/routes/creativeWorkflows.js
router.get('/:workflow_id/retry-plan', async (req, res) => {})
router.post('/:workflow_id/retry', async (req, res) => {})

// frontend-react/src/api/client.js
getCreativeWorkflowRetryPlan(workflowId)
retryCreativeWorkflow(workflowId, { mode = 'repair_and_resume', confirm_plan_code } = {})
```

**需要保存的数据结构:**

GET response：

```js
{
  success: true,
  workflow_id: '20260625121115575391',
  plan: {
    can_retry: true,
    fallback_allowed: true,
    mode: 'repair_and_resume',
    code: 'provider_missing_text',
    retry_from: 'frame_html',
    repair_action: 'retry_frame_html',
    reuse: [],
    discard: [],
    user_message: '将复用已完成内容，只重新生成失败帧并重新导出。'
  }
}
```

POST request：

```js
{
  mode: 'repair_and_resume',
  confirm_plan_code: 'provider_missing_text'
}
```

**验收命令:**

```bash
node tests/test-creative-workflow-routes.js
node tests/test-creative-workflow-retry-task.js
```

**预期结果:**

- GET retry-plan 不启动后台任务，但会刷新 `record.retry.latest_plan`，便于前端展示与审计。
- POST retry 启动现有 registry task。
- V1 非 `repair_and_resume` mode 被拒绝。
- active task 运行中时不会启动新任务。

---

### Task 9: 失败恢复 UI

**目标:** 在一键创作失败详情中展示恢复建议、复用内容、将重跑内容和“修复并重试”按钮；所有用户可见文案使用中文，并显示明确 loading / success / failure 状态。

**修改文件:**

- `frontend-react/src/components/creative/CreativeTaskDetail.jsx`
- `frontend-react/src/pages/OneClickCreativePage.jsx`

**新增文件:** 无。

**测试文件:**

- `tests/test-creative-workflow-routes.js` 覆盖 API 文案。
- 前端手动验收命令使用 `npm run build:frontend`。

**具体实现步骤:**

- [x] 在 `CreativeTaskDetail.jsx` 增加 props：`retryPlan`、`retryPlanStatus`、`retryPlanMessage`、`retrying`、`onRetryWorkflow`。
- [x] 在 workflow `status === 'failed'` 时展示“恢复建议”区域。
- [x] 当 retry plan loading 时展示 `正在生成恢复计划...`。
- [x] 当 retry 执行中时按钮 disabled，按钮文案展示 `正在修复并重试...`。
- [x] `plan.can_retry === false` 时隐藏按钮，展示 `plan.user_message`；环境错误示例为 `无法自动重试：ffmpeg 不可用，请先到设置中心修复系统环境。`。
- [x] `plan.can_retry === true` 时展示失败位置、失败类型、处理方式、将复用、将重新执行。
- [x] 在 `OneClickCreativePage.jsx` 失败状态下调用 Task 8 已加入的 `api.getCreativeWorkflowRetryPlan(workflowId)`，并防止重复请求。
- [x] 点击“修复并重试”调用 Task 8 已加入的 `api.retryCreativeWorkflow(workflowId, { mode:'repair_and_resume', confirm_plan_code: retryPlan.code })`，成功后订阅现有 SSE。
- [x] retry API 返回 plan code 已变化时，重新拉取 retry plan，并展示中文提示 `恢复计划已变化，请确认最新建议后再重试。`。
- [x] 运行本 Task 验收命令。

**需要新增/修改的函数签名:**

```js
export function CreativeTaskDetail({
  workflow,
  stages,
  status,
  retryPlan,
  retryPlanStatus,
  retryPlanMessage,
  retrying,
  onRetryWorkflow,
})

async function loadRetryPlan(workflowId)
async function handleRetryWorkflow()
```

**需要保存的数据结构:**

前端 state：

```js
{
  retryPlan: null,
  retryPlanStatus: 'idle|loading|ready|failed',
  retryPlanMessage: '',
  retrying: false
}
```

UI 文案映射：

```js
{
  retry_frame_html: '只重试失败帧，复用已生成内容',
  retry_content_graph: '重新生成内容图并继续后续步骤',
  fallback_scene_spec_graph: '使用脚本结构恢复内容图并继续生成',
  repair_timeline: '修复时间轴后重新渲染',
  repair_script_and_timeline: '压缩旁白并重新生成音频与时间轴',
  rerender_frames: '只重渲染失败镜头',
  recompose: '重新合成成片',
  rerun_visual_inspect: '重新执行视觉巡检',
  restart_project: '从工程阶段重新开始'
}
```

**验收命令:**

```bash
npm run build:frontend
```

**预期结果:**

- 构建成功。
- failed workflow 页面显示“恢复建议”和“修复并重试”。
- 接口请求期间有明确 loading 文案，按钮禁用防重复点击。
- `can_retry=false` 时不显示可点击 retry 按钮。

---

### Task 10: 端到端测试与回归验证

**目标:** 将关键恢复场景串成最小端到端测试集合，确认普通创建任务流程不受影响。

**修改文件:**

- 无。

**新增文件:**

- `tests/test-creative-workflow-retry-e2e.js`

**测试文件:**

- `tests/test-creative-workflow-retry-e2e.js`
- 所有 Task 1-9 新增测试文件

**具体实现步骤:**

- [ ] 新增 `tests/test-creative-workflow-retry-e2e.js`，使用 fake services 构造 workflow failed -> retry plan -> retry task -> done 的完整流程。
- [ ] 覆盖 provider missing text at frame_html：只重试失败帧，不调用 source/research/brief/audio fake service。
- [ ] 覆盖 content graph 空文本：先 retry，仍失败后 `fallback_scene_spec_graph`。
- [ ] 覆盖 content graph JSON 尾逗号：tolerant parse 成功，无需 retry。
- [ ] 覆盖 target 60 秒、frames 总和 132 秒：planner 输出 `repair_timeline`。
- [ ] 覆盖 audio duration 超目标：planner 输出 `repair_script_and_timeline`。
- [ ] 覆盖单帧 render timeout：只重渲染该帧。
- [ ] 覆盖 compose duration mismatch：只 recompose，不调用 AI。
- [ ] 覆盖 environment missing ffmpeg/playwright：`can_retry === false`。
- [ ] 覆盖 active task guard：已有 task running 时 retry API 不启动新 task。
- [ ] 覆盖 retry 成功后 workflow `status === 'done'`，project/check/render/inspect stage 状态符合 html-video lite 语义。
- [ ] 确认所有新增测试文件名以 `test-` 开头；`tests/run-all.js` 会自动发现并按字母序运行，无需手动注册或改成手动排序。
- [ ] 运行本 Task 验收命令。

**需要新增/修改的函数签名:**

```js
async function createFailedWorkflowFixture(overrides = {})
async function runRetryE2eScenario(name, fixture)
```

**需要保存的数据结构:**

端到端 fixture 固定包含：

```js
{
  workflow: {
    workflow_id: 'workflow_retry_e2e',
    status: 'failed',
    stages: [],
    retry: { version: 1, attempts: [], latest_plan: {} },
    last_failure: {}
  },
  project: {
    generation_checkpoint: {}
  },
  fakeCalls: {
    source: 0,
    research: 0,
    brief: 0,
    audio: 0,
    content_graph: 0,
    frame_html: {}
  }
}
```

**验收命令:**

```bash
node tests/test-creative-workflow-retry-e2e.js
npm test
npm run build:frontend
```

**预期结果:**

- retry e2e 测试覆盖所有必测场景并通过。
- `npm test` 全量通过。
- 前端构建通过。
- 普通一键创作创建流程、html-video project store、现有 rerender/editor 路由测试不回归。

---

## 最终实现顺序

1. `generation_checkpoint` 持久化。
2. diagnostics / `CreativeWorkflowStageError` / `ensureSuccess()` / `last_failure`。
3. content graph retry/fallback。
4. frame HTML resume/fallback HTML。
5. timeline repair 与 render/compose/duration/visual checkpoint。
6. retry planner。
7. resume executor + retry task。
8. API + client。
9. 前端失败恢复 UI。
10. 端到端测试与全量回归。

## 自检清单

- [ ] 全文统一使用 `sub_stage` 字段名。
- [ ] 全文只使用 `fallback_allowed`，没有驼峰字段。
- [ ] diagnostics 扩展字段只有 `sub_stage`、`frame_id`、`retryable`、`repair_action`。
- [ ] 没有设计独立 `checkpoint.json`。
- [ ] `retry` API V1 只有 `mode: "repair_and_resume"`。
- [ ] executor 复用 `creativeWorkflowTasks.js`、active task guard、SSE、`patchCreativeWorkflowTaskSummary()`。
- [ ] `repair_timeline` 不调用 AI、不重新 TTS。
- [ ] `repair_script_and_timeline` 明确丢弃 brief/audio/render_outputs/exports 并重新 TTS。
- [ ] `rerun_visual_inspect` 复用所有 AI 产物、project.json、frame mp4 和 exports。
- [ ] 每个 Task 的修改文件不与并行任务隐式冲突；有共同文件时按合并顺序处理。
