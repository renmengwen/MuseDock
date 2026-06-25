# 一键创作失败恢复与分阶段重试设计

## 背景

一键创作最近连续出现不同类型的失败：

- 视频时间轴异常：目标 `60.00` 秒，当前 `132.00` 秒。
- `provider_1781667270005 返回结果缺少文本内容。`

这两个错误看起来不一样，但根因不是“某一句提示词不够强”，而是当前一键创作缺少完整的失败恢复体系。

当前外层工作流在 `server/services/creativeWorkflows.js` 中按阶段执行：

```text
source -> research -> assets -> agent_run -> brief -> audio -> project -> check -> render -> inspect
```

其中 `project` 阶段调用 html-video production path，内部实际又执行：

```text
scene_spec
  -> template_select
  -> content_graph
  -> frame_html
  -> validate_project
  -> audio_bind_or_tts
  -> materialize
  -> frame_render
  -> compose
  -> duration_verify
  -> visual_inspect
```

这些是从当前代码中提炼出来的逻辑子阶段，不要求每个子阶段都对应一个现有函数。当前 `timeline_check` 和 `duration_verify` 都发生在 `projectOrchestrator.renderHtmlVideoProject()` 内部；`visual_inspect` 在 html-video lite 成功路径里会由外层直接标记为完成。

也就是说，当前链路方向已经接近 `D:\code3\html-video` 的核心流程：

```text
content-graph -> per-frame HTML -> MP4
```

但这些内部子阶段在一键创作任务记录里没有成为可恢复边界。外层只知道 `project` 成功或失败，不知道失败发生在 content graph、某一帧 HTML、时间轴校验、单帧渲染、合成还是 ffprobe 时长校验。因此失败后只能重新创建任务，导致前面已经消耗 token 的 AI 分析、改写、策划、TTS 产物被浪费。

参考工程 `D:\code3\html-video` 稳定的原因不是单纯提示词，而是工程机制：

- content graph、frame HTML、render output 是明确中间产物。
- 空回复有短 prompt 重试。
- content graph JSON 有宽容解析和修复。
- 每帧 HTML 可以单独生成、写入、重试。
- render 使用 explicit duration，合成后再校验。
- 失败类型会决定是重试、修复、回退，还是只重渲染。

本设计目标是把 MediaCrawler-GUI 的一键创作升级为可 checkpoint、可诊断、可修复、可从失败处继续的生产链路。checkpoint 首选写入现有 `project.json`，不新增独立 `checkpoint.json`，除非实现时证明 `project.json` 无法承载。

## 目标

- 一键创作失败后，用户可以点击“修复并重试”，不需要重新创建任务。
- 已成功的高成本 AI 阶段必须能复用，包括 source、research、agent_run、brief、audio、content_graph 和已生成帧 HTML。
- `project` 内部子阶段必须有可追踪状态、错误类型、产物路径和重试次数。
- 不同失败类型映射到不同恢复动作，避免“同样参数再跑一次仍然失败”。
- 支持从 `content_graph`、指定帧 `frame_html`、`timeline_check`、`frame_render`、`compose` 等子阶段继续。
- 时间轴异常必须进入修复路径，不能只重跑 project。
- 模型空响应、缺文本内容、HTML 无效、JSON 无效必须支持局部重试和 fallback。
- 前端失败详情必须展示将复用哪些阶段、将重跑哪些阶段、将修复什么。
- 后续子代理可以按本文档分阶段实现，不需要重新梳理当前链路。

## 非目标

- 不把 `D:\code3\html-video` 整仓库作为运行时依赖。
- 不在本设计中重写整个视频编辑器。
- 不要求历史所有失败任务自动迁移为可恢复任务；仅要求有足够产物的新任务可恢复。
- 不用“跳过校验”掩盖失败。
- 不通过降低目标时长要求来绕过时间轴错误。
- 不为少量状态判断新增数据库；继续使用当前本地 JSON workflow record 和 html-video project 文件结构。

## 术语表

- `scene_spec`：一键创作最终脚本/分镜规格，是旁白、字幕、场景顺序和 scene id 的权威源。
- `content_graph`：html-video 内容图，包含 `nodes` 和 `edges`，用于视觉规划，不允许改变 `scene_spec` 的脚本权威字段。
- `frame`：单个 scene 对应的 HTML 文件、frame metadata 和可选渲染 MP4。
- `generation_checkpoint`：嵌入 `project.json` 的生成恢复状态，不独立成文件。
- `retry plan`：只读恢复计划，描述复用、丢弃、修复动作；执行前必须重新生成。
- `resume executor`：执行 retry plan 的后台任务执行器，复用现有 task registry 和 SSE。
- `scene_spec_hash`：使用 `computeSceneSpecSpeechHash(sceneSpec)` 计算，与 `project.audio.scene_spec_hash` 保持一致。

## 当前关键文件

### 外层工作流

- `server/services/creativeWorkflows.js`
  - 当前负责 `source/research/assets/agent_run/brief/audio/project/check/render/inspect` 阶段。
  - `runStage()` 只记录外层 stage，失败时只保存 `record.error.stage` 和 `record.error.message`。
  - `project` 阶段调用 `agentRuns.generateDouyinRunHyperframesFreeformProject()`。

- `server/services/creativeWorkflowTasks.js`
  - 负责后台任务、SSE 事件、任务进度持久化。
  - 当前 html-video 内部进度会映射到 project 进度，但没有持久化子阶段状态。

- `server/routes/creativeWorkflows.js`
  - 当前创建任务接口是 `POST /api/creative-workflows`。
  - 已有 html-video project 编辑、渲染、导出接口。
  - 缺少 workflow retry/resume 接口。

### AI 与 agent run

- `server/services/agentRuns.js`
  - `createDouyinHyperframesFreeformRun()`
  - `generateDouyinRunHyperframesFreeformBrief()`
  - `synthesizeDouyinRunHyperframesFreeformAudio()`
  - `generateDouyinRunHyperframesFreeformProject()`

- `server/services/aiTextModel.js`
  - 当前已支持非流式缺文本重试。
  - 当前 stream 缺文本会直接返回失败。
  - 上层没有把“缺文本”分类为可恢复错误。

### html-video production path

- `server/services/creative-video/workflowFacade.js`
  - 负责从 freeform project stage 调用 html-video workflow。

- `server/services/creative-video/html-video/htmlVideoWorkflow.js`
  - 当前内部实际执行 template 选择、content graph、逐帧 HTML、音频绑定、render。
  - 子阶段只通过 progress event 暂时上报，不是可恢复 checkpoint。

- `server/services/creative-video/html-video/contentGraphAgent.js`
  - 负责 content graph prompt 和 JSON parse。
  - 当前 JSON parse 只做基础 fenced block 提取和 `JSON.parse`。

- `server/services/creative-video/html-video/frameHtmlAgent.js`
  - 负责单帧 HTML 生成。
  - 当前支持一次 HTML 无效后的 retry prompt。
  - 不处理模型调用返回 `success:false` 的缺文本二次 fallback。

- `server/services/creative-video/html-video/projectOrchestrator.js`
  - 负责 materialize、时间轴校验、逐帧渲染、compose、duration verify。
  - 当前 timeline duration failure 会直接使 project stage 失败。

- `server/services/creative-video/html-video/projectStore.js`
  - 负责 html-video project 读写。

- `server/services/creative-video/html-video/diagnostics.js`
  - 已有 `createDiagnostic()`、`normalizeDiagnostics()`、`failureFromDiagnostics()`。
  - 本设计必须复用该体系，只扩展 retry 相关字段，不另建一套错误结构。

- `server/services/creative-video/html-video/timelineConsistency.js`
  - 已有 `validateSceneSpecTimelineConsistency()`。
  - 已能产生 `frame_scene_count_mismatch`、`frame_scene_order_mismatch`、`frame_scene_missing`、`frame_scene_duplicate`、`frame_narration_mismatch`、`frame_captions_mismatch`、`audio_scene_spec_hash_mismatch` 等错误。

- `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`
  - 当前已经逐帧写 HTML 文件到 `frames/<order>-<nodeId>.html`。
  - 缺口是写帧 HTML 时没有同步更新 `project.json` 内的可恢复状态。

## 核心设计原则

### 子阶段必须成为恢复边界

一键创作外层仍可展示十个大阶段，但后端必须在 `project` 阶段内持久化子阶段：

```text
template_select
content_graph
frame_html
validate_project
timeline_check
audio_bind_or_tts
materialize
frame_render
compose
duration_verify
visual_inspect
```

每个子阶段都必须记录：

```js
{
  id: 'frame_html',
  status: 'pending|running|done|failed|skipped',
  message: '第 3/6 帧 HTML 已生成。',
  started_at: '2026-06-25T...',
  completed_at: '2026-06-25T...',
  failed_at: null,
  retry_count: 0,
  input_hash: '...',
  output_hash: '...',
  artifacts: [],
  diagnostics: []
}
```

### 成功产物必须边生成边落盘

不能等所有帧 HTML 都生成完才写 project。正确流程是：

```text
content graph 成功 -> 写 content-graph.json，并更新 project.generation_checkpoint
第 1 帧 HTML 成功 -> 写 frames/01-scene_01.html，并更新 project.generation_checkpoint
第 2 帧 HTML 成功 -> 写 frames/02-scene_02.html，并更新 project.generation_checkpoint
第 N 帧失败 -> 保留前 N-1 帧
```

重试时从 `project.json` 的 `generation_checkpoint` 读取已有产物，只生成缺失或失效的部分。磁盘文件存在只能作为辅助证据，不能替代结构化状态。

### 失败必须结构化

所有失败都必须返回统一 diagnostic，不允许只返回一句错误文本。统一结构必须基于现有 `server/services/creative-video/html-video/diagnostics.js`，保留 `code`、`stage`、`user_message`、`details`、`fallback_allowed`、`severity`，并新增 retry 所需字段。

统一 diagnostic：

```js
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
  details: {
    provider: 'provider_1781667270005',
    attempt: 1
  },
  created_at: '2026-06-25T...'
}
```

`message` 可以给用户看，但代码判断必须使用 `code`、`stage`、`repair_action`。

`fallback_allowed` 的含义沿用现有 diagnostics：为 `false` 时代表不能自动降级或继续。`retryable` 表示是否能由 retry/resume 自动处理；两者不能混用。

### 重试必须先规划

“从失败处继续”不能等于“从失败 stage 重新跑一次”。每次恢复前必须生成 retry plan：

```js
{
  workflow_id: '20260625121115575391',
  can_retry: true,
  fallback_allowed: true,
  mode: 'repair_and_resume',
  retry_from: 'frame_html',
  repair_action: 'retry_frame_html',
  reuse: ['source', 'research', 'assets', 'agent_run', 'brief', 'audio', 'content_graph', 'frames:scene_01-scene_04'],
  discard: ['frames:scene_05', 'render_outputs', 'exports'],
  run_options: {
    max_attempts: 2,
    fallback_to_non_stream: true,
    use_short_prompt: true
  },
  user_message: '将复用已完成的分析、改写、策划、旁白和前 4 帧 HTML，只重新生成第 5 帧并重新渲染。'
}
```

用户点击“修复并重试”后执行 retry plan。

## 数据结构设计

### workflow record 新增字段

文件位置：

```text
data/creative-workflows/<workflow_id>.json
```

新增字段：

```js
{
  "retry": {
    "version": 1,
    "attempts": [
      {
        "id": "retry_20260625_123000",
        "created_at": "2026-06-25T12:30:00.000Z",
        "mode": "repair_and_resume",
        "reason_code": "provider_missing_text",
        "retry_from": "frame_html",
        "repair_action": "retry_frame_html",
        "reuse": ["source", "research", "brief", "audio", "content_graph"],
        "discard": ["frames:scene_05", "render_outputs"],
        "status": "done|failed|running",
        "message": "..."
      }
    ],
    "latest_plan": {}
  },
  "project_substages": [
    {
      "id": "content_graph",
      "status": "done",
      "message": "html-video 内容图已生成。",
      "artifacts": [
        {
          "kind": "content_graph",
          "path": "D:/code3/MediaCrawler-GUI/data/media/douyin/.../content-graph.json",
          "hash": "..."
        }
      ],
      "diagnostics": []
    }
  ],
  "last_failure": {
    "stage": "project",
    "sub_stage": "frame_html",
    "code": "provider_missing_text",
    "frame_id": "scene_05",
    "message": "provider_1781667270005 返回结果缺少文本内容。",
    "diagnostics": []
  }
}
```

### html-video project generation_checkpoint

文件位置：

```text
<html_video_project_path>/project.json
```

新增字段：

```js
{
  "generation_checkpoint": {
    "version": 1,
    "workflow_id": "20260625121115575391",
    "run_id": "20260625-121140-792Z-2f7731-hyperframes_freeform",
    "scene_spec_hash": "...",
    "target": {
      "duration_sec": 60,
      "aspect_ratio": "9:16"
    },
    "stages": {
      "template_select": {
        "status": "done",
        "template_id": "news_signal_vertical"
      },
      "content_graph": {
        "status": "done",
        "path": "content-graph.json",
        "input_hash": "...",
        "output_hash": "..."
      },
      "frame_html": {
        "status": "partial",
        "frames": {
          "scene_01": {
            "status": "done",
            "html_path": "frames/01-scene_01.html",
            "input_hash": "...",
            "output_hash": "..."
          },
          "scene_05": {
            "status": "failed",
            "html_path": "",
            "diagnostic_code": "provider_missing_text"
          }
        }
      },
      "render": {
        "status": "partial",
        "frames": {
          "scene_01": {
            "status": "done",
            "mp4_path": "frames/scene_01.mp4",
            "output_hash": "..."
          },
          "scene_04": {
            "status": "failed",
            "mp4_path": "",
            "diagnostic_code": "render_failed_timeout"
          }
        }
      },
      "compose": {
        "status": "pending",
        "output_path": "",
        "output_audio_path": ""
      },
      "duration_verify": {
        "status": "pending",
        "expected_duration_sec": 60,
        "actual_duration_sec": null
      },
      "visual_inspect": {
        "status": "pending",
        "report_path": null
      }
    },
    "updated_at": "2026-06-25T..."
  }
}
```

checkpoint 只记录恢复需要的最小状态。它直接存进 `project.json`，复用 `projectStore.saveProject()` 的原子写入能力，避免新增 `checkpoint.json` 带来的双文件一致性问题。

`scene_spec_hash` 必须使用 `computeSceneSpecSpeechHash(sceneSpec)`。V1 中 `input_hash` 和 `output_hash` 是可选字段：没有稳定 hash helper 时可以先为空；如果实现，`input_hash` 优先使用 `scene_spec_hash + node id + target`，`output_hash` 使用 HTML 文件内容的 SHA-256。

`render.frames` 的 key 必须与 `frame_html.frames` 的 key 一致，统一使用 `scene_id`。`compose.output_path` 指无音频或中间合成视频；`compose.output_audio_path` 指最终混音导出视频。`duration_verify` 记录 ffprobe 校验结果，供 `recompose` 判断是否只需重新合成。

`retry.attempts`、`latest_plan`、`project_substages`、`last_failure` 保存在 workflow record；`generation_checkpoint` 保存在 html-video project。两者职责不能混用：

- workflow record 记录用户可见任务状态和 retry 历史。
- `generation_checkpoint` 记录当前 project 可以从哪里继续。
- `latest_plan` 只是展示缓存，执行前必须由 retry planner 基于当前 workflow + project 重新生成，不能直接信任旧 plan。

retry 成败规则：

```text
retry 成功：
  1. 将执行前的 last_failure 复制到 retry.attempts[last].previous_failure。
  2. 清空 workflow.last_failure。
  3. 将相关 project_substages 更新为 done/skipped。
  4. workflow.status 更新为 done。

retry 再次失败：
  1. 将执行前的 last_failure 复制到 retry.attempts[last].previous_failure。
  2. retry.attempts 新增 status=failed、message、diagnostics。
  3. workflow.last_failure 写入最新失败。
  4. 不覆盖 retry.attempts 中的原始失败信息。
```

### artifact 约定

html-video project 目录内应形成稳定结构：

```text
project.json
content-graph.json
frames/
  01-scene_01.html
  02-scene_02.html
  scene_01.mp4
exports/
  output.mp4
  output-audio.mp4
tts/
  audio_manifest.json
```

调试用 retry 详情优先写入 workflow record 的 `retry.attempts`。V1 不要求额外写 `diagnostics/retry_*.json`，避免新增可恢复状态之外的文件。

所有 `generation_checkpoint` 里的相对路径必须相对 project dir。写入和读取时必须用现有 projectStore/path guard，禁止路径逃逸。

## 错误分类

### provider_missing_text

触发条件：

- `aiTextModel.callTextModel()` 返回 `success:false`。
- message 匹配：
  - `返回结果缺少文本内容`
  - `流式返回结果缺少文本内容`

判断优先级：

```text
1. 优先使用上层封装出的 diagnostic.code === 'provider_missing_text'。
2. 没有 code 时，再匹配当前项目真实中文错误文案：
   - 返回结果缺少文本内容
   - 流式返回结果缺少文本内容
3. provider 名称前缀，例如 provider_1781667270005，只进入 details.provider，不参与分类。
```

恢复策略：

```text
如果发生在 content_graph：
  1. 同 stage 非流式重试一次。
  2. 使用更短 content graph prompt 重试一次。
  3. 仍失败则用 scene_spec 派生 content_graph。

如果发生在 frame_html：
  1. 只重试当前 frame。
  2. 第二次模型调用必须 forceNonStream=true 且 shortPrompt=true。
  3. 第二次仍失败则生成 template fallback HTML，标记 diagnostic warning。
```

`provider_missing_text at frame_html` 的尝试序列固定为：

```text
1. 第一次调用 generateFrameHtml({ frameId, attempt: 1 })，使用原始 prompt。
2. 如果 model 返回 success:false 且分类为 provider_missing_text，进入外层 retry。
3. 第二次调用 generateFrameHtml({ frameId, attempt: 2, forceNonStream: true, shortPrompt: true })，使用 skeleton prompt。
4. 如果仍失败，调用 frameFallbackBuilder.buildFallbackFrameHtml() 生成兜底 HTML。
```

最多消耗 2 次模型调用 + 1 次 fallback。`frameHtmlAgent.generateFrameHtml()` 内部针对“返回了文本但 HTML 无效”的 retry 不计入 provider_missing_text 的外层尝试序列。

不允许：

- 不允许重跑 source/research/brief/audio。
- 不允许删除已成功 frame HTML。

### content_graph_invalid

触发条件：

- AI 返回无法 JSON parse。
- JSON 缺少 `nodes`。
- content graph validation 失败。

恢复策略：

```text
1. 先 tolerant parse/repair。
2. 仍失败则短 prompt 重试 content graph。
3. 仍失败则调用 mapSceneSpecToContentGraph(sceneSpec)。
```

需要从 `D:\code3\html-video` 参考的能力：

- fenced JSON 提取。
- 去尾逗号。
- 修复未转义引号的有限场景。
- 输出 schema 归一化。

首版不要写复杂大模型 JSON repair。使用确定性字符串修复和 scene_spec fallback 即可。

### content graph retry prompt

新增能力：

```text
server/services/creative-video/html-video/contentGraphAgent.js
  -> buildRetryPrompt(sceneSpec, creativeContext, target, originalPrompt, attempt)
```

V1 短 prompt 原则：

- 只保留 scene id、scene 标题、scene duration、核心 narration_text。
- 去掉长篇设计指导、长示例和额外解释。
- 强制只输出 JSON。
- attempt >= 2 时，再次缩短到只保留 `nodes` 的最小 schema。

如果实现上不想新增独立函数，也可以在 `buildContentGraphPrompt()` 中增加 `mode: 'retry'` 参数，但必须把短 prompt 规则写在文档里，不能靠子代理猜。

### content_graph_scene_spec_mismatch

触发条件：

- graph nodes 数量和 scene_spec scenes 数量不一致。
- node 顺序或 scene_id 对不上。

恢复策略：

```text
1. 保留 AI graph 到 diagnostics/ai-content-graph-rejected.json。
2. 使用 mapSceneSpecToContentGraph(sceneSpec) 生成可信 graph。
3. 继续生成 frame HTML。
```

该错误默认不阻断，因为已有确定性 fallback。

当前 `htmlVideoWorkflow.js` 首次生成时已经会在 graph 与 scene_spec 不匹配时 fallback 到 `mapSceneSpecToContentGraph(sceneSpec)` 并继续。因此 `fallback_scene_spec_graph` 作为 retry action 只用于以下情况：

```text
1. content graph AI 返回空文本。
2. content graph JSON 解析失败。
3. retry_content_graph 已失败。
4. 系统仍有可用 scene_spec。
```

如果只是 `content_graph_scene_spec_mismatch`，首次运行应当记录 warning 并自动 fallback，不应让 workflow 失败。

### scene_spec timeline consistency mismatch

触发条件来自现有 `validateSceneSpecTimelineConsistency()`：

- `frame_scene_count_mismatch`
- `frame_scene_order_mismatch`
- `frame_scene_missing`
- `frame_scene_duplicate`
- `frame_narration_mismatch`
- `frame_captions_mismatch`
- `audio_scene_spec_hash_mismatch`

恢复策略：

```text
frame_scene_count_mismatch / frame_scene_order_mismatch / frame_scene_missing / frame_scene_duplicate:
  1. scene_spec 是权威源。
  2. 丢弃不匹配的 frame project 结构。
  3. 优先用 scene_spec 派生 content_graph。
  4. 复用仍匹配 scene_id 且可验证仍有效的 frame HTML。
  5. 缺失或错位 frame 进入 retry_frame_html。

frame_narration_mismatch / frame_captions_mismatch:
  1. scene_spec 是权威源。
  2. 同步 frame.narration_text 和 frame.captions。
  3. 重新 materialize。
  4. 不需要重跑 AI，除非 raw HTML 明文也需要同步。

audio_scene_spec_hash_mismatch:
  1. 旧音频不能复用。
  2. 重新按当前 scene_spec 生成 TTS。
  3. 然后从 materialize/render 继续。
```

V1 frame HTML 复用规则：

```text
优先：scene_id 匹配，且 frame_html.output_hash 非空，且与当前生成输入 hash 一致。
退化：scene_id 匹配，HTML 文件存在、非空，并通过基础 HTML document 校验。
如果 V1 未实现 output_hash，直接按“文件存在 + 基础 HTML 校验”复用。
```

### frame_html_invalid

触发条件：

- HTML 为空。
- 没有完整 `<!doctype html>` 或 `<html>...</html>`。
- 画幅尺寸不符合目标。

V1 不把以下问题作为 hard failure，只记录 warning：

- 缺少可编辑文本锚点。
- 没有可检测动效。
- 主体运动不足。

恢复策略：

```text
1. 当前 frame 使用校验原因进入 retry prompt。
2. retry 成功则继续。
3. retry 失败则生成 template fallback HTML。
4. fallback HTML 必须包含 data-text-key="headline|subtitle|body" 和基本动效。
```

### fallback HTML 生成器

新增文件：

```text
server/services/creative-video/html-video/frameFallbackBuilder.js
```

职责：

- 当 `provider_missing_text` 或 `frame_html_invalid` 连续失败时，生成一个最小可渲染 HTML。
- 输入当前 scene、当前 content graph node、目标分辨率、template metadata。
- 输出完整 HTML 字符串。

导出：

```js
function buildFallbackFrameHtml({ scene, node, target, template } = {})
```

V1 规则：

```text
1. 画幅必须匹配 target resolution。
2. 必须包含 <!doctype html>、<html>、<head>、<style>、<body>。
3. 必须包含 data-text-key="headline"、data-text-key="subtitle"、data-text-key="body"。
4. 文案从 scene.title / node.label / scene.narration_text / scene.captions 提取。
5. 有 template metadata 时只借用基础色彩/字体方向；不要依赖外部资源。
6. 没有 template 时使用最简垂直居中文字卡片。
7. CSS animation 只做基础入场，保证可渲染，不追求设计质量。
```

fallback HTML 是最后兜底，必须在 diagnostics 中标记 warning：

```js
{
  code: 'fallback_frame_html_used',
  stage: 'ai-frame-html',
  sub_stage: 'frame_html',
  frame_id: 'scene_05',
  severity: 'warning',
  retryable: false,
  user_message: '当前帧 AI 生成连续失败，已使用基础 HTML 兜底。'
}
```

### timeline_duration_unreasonable

触发条件：

- `projectOrchestrator.validateReasonableTimelineDuration()` 返回失败。
- 例如目标 60 秒，当前 132 秒。

恢复策略：

```text
1. 不重试 AI。
2. 读取 scene_spec、content_graph、project.frames、audio manifest。
3. 先调用或复用 projectOrchestrator 内部的 fitFrameDurationsToCaptions 结果，区分字幕导致超长还是帧时长分配导致超长。
4. 计算目标时长、scene 总时长、frame 总时长、audio 时长。
5. 判断权威源：
   - 有 scene_spec：scene_spec 是脚本权威。
   - 有音频且 hash 匹配 scene_spec：audio 可作为时长参考。
   - target.duration_sec 是最终上限。
6. 如果字幕或音频本身超目标：
   - `analyzeTimelineMismatch()` 返回 `requires_script_repair=true`。
   - retry planner 直接生成 `repair_action='repair_script_and_timeline'`。
   - 不生成单纯的 `repair_timeline` plan。
7. 如果只是 scene/frame 时长分配超目标：
   - 按 scene 数量重新分配 duration。
   - 优先保留每 scene 不低于 2 秒。
   - 如果 scene 数过多导致每帧低于 2 秒，先压缩 scene_spec 或合并短场景。
8. 保存修复后的 scene_spec/content_graph/project.frames。
9. 从 materialize/render 继续。
```

该类错误不能简单“从 project 继续”。必须先执行 `repair_timeline`。

`timeline_check` 在 V1 中保持当前代码位置：materialize 之后、逐帧 render 之前，对应 `projectOrchestrator.renderHtmlVideoProject()` 内部的 `fitFrameDurationsToCaptions()` 和 `validateReasonableTimelineDuration()`。如果后续要前置到 materialize 前，必须先证明能在前置阶段稳定拿到 frame duration、caption duration 和 audio duration。

### render_failed

触发条件：

- 单帧 Playwright/Hyperframes render 失败。
- 生成的 frame mp4 不存在或无 video stream。

恢复策略：

```text
render_failed_html_invalid:
  1. 回退到 retry_frame_html。
  2. 修复或重生当前帧 HTML 后再渲染。

render_failed_environment:
  1. 标记 can_retry=false。
  2. 给出中文环境修复提示。

render_failed_timeout:
  1. 只重渲染当前帧。
  2. 如果连续超时，降级为 retry_frame_html，要求生成更简单的当前帧 HTML。

render_failed_unknown:
  1. 最多重渲染当前帧一次。
  2. 再失败则保留 diagnostics，不无限重试。
```

### compose_failed

触发条件：

- frame concat 失败。
- mux audio 失败。

恢复策略：

```text
1. 不重跑 AI。
2. 检查 frame mp4 是否都存在。
3. 缺 frame mp4 则补渲染缺失帧。
4. frame 编码不一致则使用 reencode concat。
5. mux 失败则重新 resolve narration path 后再 mux。
```

### duration_mismatch

触发条件：

- ffprobe 实际输出时长和 expected duration 超出容差。

恢复策略：

```text
1. 不重跑 AI。
2. 重新 compose。
3. compose 时强制 expected duration。
4. 如果仍失败，记录 ffprobe diagnostics 并阻断。
```

### environment_unrecoverable

触发条件：

- `playwright_not_configured`
- `ffmpeg_not_configured`
- `engine_not_installed`
- ffprobe 缺失且当前步骤必须做时长校验。

恢复策略：

```text
1. retry planner 返回 can_retry=false。
2. fallback_allowed=false。
3. 前端不显示“修复并重试”，只显示具体环境修复提示。
4. 用户修复环境后，可重新点击普通重试入口重新规划。
```

## Retry Planner

新增文件：

```text
server/services/creative-video/retryPlanner.js
```

职责：

- 读取 workflow record、project.generation_checkpoint、last_failure。
- 对错误分类。
- 生成 retry plan。
- 明确复用、丢弃、修复、继续位置。
- 只做只读分析，不直接修改 project 或 workflow。

planner 可以调用 `timelineRepair.analyzeTimelineMismatch()` 得到分析结果，但不能执行 `repairProjectTimeline()`。

导出：

```js
function classifyCreativeWorkflowFailure(input)
function createCreativeWorkflowRetryPlan(input)
```

输入：

```js
{
  workflow,
  project,
  generation_checkpoint,
  error,
  diagnostics
}
```

输出：

```js
{
  success: true,
  can_retry: true,
  workflow_id: workflow.workflow_id,
  fallback_allowed: true,
  code: 'provider_missing_text',
  retry_from: 'frame_html',
  repair_action: 'retry_frame_html',
  reuse: [],
  discard: [],
  warnings: [],
  user_message: '...',
  executor_options: {}
}
```

不可自动重试时：

```js
{
  success: true,
  can_retry: false,
  fallback_allowed: false,
  code: 'environment_missing_ffmpeg',
  user_message: 'ffmpeg 不可用，请先在设置中心修复系统环境后再重试。'
}
```

### 失败分类优先级

按以下顺序分类，命中后停止：

1. diagnostic code 精确匹配。
2. diagnostic stage + message 组合。
3. workflow.error.code。
4. workflow.error.message 文本匹配。
5. project status / generation_checkpoint failed stage。
6. unknown_project_failure。

unknown 不允许盲目自动重试超过一次。

## Resume Executor

新增文件：

```text
server/services/creative-video/resumeExecutor.js
```

职责：

- 执行 retry planner 给出的计划。
- 尽量复用 project.generation_checkpoint。
- 只重跑必要子阶段。
- 将进度事件映射回现有 SSE。

导出：

```js
async function executeCreativeWorkflowRetryPlan(options)
```

输入：

```js
{
  workflowId,
  plan,
  rootDir,
  mediaRoot,
  services,
  taskContext
}
```

支持的 `repair_action`：

```text
retry_content_graph
fallback_scene_spec_graph
retry_frame_html
repair_timeline
repair_script_and_timeline
rerender_frames
recompose
rerun_visual_inspect
restart_project
```

统一 action 输入输出：

```js
// retry_content_graph / fallback_scene_spec_graph
{
  workflow,
  project,
  generationCheckpoint,
  sceneSpec,
  services,
}
// -> { success, project, generationCheckpoint, diagnostics }

// retry_frame_html
{
  workflow,
  project,
  generationCheckpoint,
  frameId,
  services,
}
// -> { success, project, generationCheckpoint, diagnostics }

// repair_timeline
{
  workflow,
  project,
  generationCheckpoint,
  sceneSpec,
  targetDurationSec,
  audioManifest,
  services,
}
// -> { success, project, generationCheckpoint, diagnostics }

// repair_script_and_timeline
{
  workflow,
  project,
  generationCheckpoint,
  sceneSpec,
  targetDurationSec,
  services,
}
// -> { success, project, generationCheckpoint, diagnostics }

// rerender_frames / recompose
{
  workflow,
  project,
  generationCheckpoint,
  frameIds,
  services,
}
// -> { success, project, generationCheckpoint, outputPath, diagnostics }
```

### 执行规则

#### retry_content_graph

```text
复用：source、research、assets、agent_run、brief、audio、scene_spec、template
丢弃：content_graph、frame_html、render_outputs、exports
执行：重新生成 content graph -> 逐帧 HTML -> validate -> render -> compose -> inspect
```

#### fallback_scene_spec_graph

```text
触发：retry_content_graph 已失败，且 scene_spec 可用。
复用：source、research、assets、agent_run、brief、audio、scene_spec、template
丢弃：AI content_graph、frame_html、render_outputs、exports
执行：mapSceneSpecToContentGraph(sceneSpec) -> 逐帧 HTML -> validate -> render -> compose -> inspect
```

该动作不是处理 `content_graph_scene_spec_mismatch` 的常规路径；常规路径在首次运行时已自动 fallback 并继续。

#### retry_frame_html

```text
复用：source、research、assets、agent_run、brief、audio、scene_spec、template、content_graph、已成功 frames
丢弃：失败 frame HTML、render_outputs、exports
执行：只生成失败 frame HTML -> rebuild project -> validate -> render -> compose -> inspect
```

#### repair_timeline

```text
复用：source、research、assets、agent_run、brief、content_graph、frame_html
条件复用：audio hash 匹配且 duration 合理才复用
丢弃：render_outputs、exports
执行：修 scene/frame duration -> materialize -> render -> compose -> inspect
```

`repair_timeline` 不调用 AI、不重写 brief、不重新 TTS。若 `timelineRepair.analyzeTimelineMismatch()` 发现字幕或音频本身超出目标上限，retry planner 必须改选 `repair_script_and_timeline`。

#### repair_script_and_timeline

```text
触发：audio duration 或字幕文本本身超过 target 上限，单纯调整 frame duration 无法修复。
复用：source、research、assets、agent_run、scene_spec 的主题结构
丢弃：brief、audio、render_outputs、exports，以及依赖旧旁白时长的 duration 分配
执行：压缩旁白/重新生成 brief -> 重新 TTS -> repair_timeline -> materialize -> render -> compose -> inspect
```

该动作是跨阶段修复。planner 在生成计划时就必须明确它会回到 `brief/audio`，executor 只执行计划，不在 `repair_timeline` 内部临时决定跨阶段回退。

#### rerender_frames

```text
复用：所有 AI 产物、project.json、content_graph、frame HTML、audio
丢弃：失败 frame mp4、exports
执行：渲染缺失或失败 frame -> compose -> inspect
```

#### recompose

```text
复用：所有 AI 产物、frame mp4、audio
丢弃：exports/output.mp4、exports/output-audio.mp4
执行：concat/mux/duration verify -> inspect
```

#### rerun_visual_inspect

```text
复用：所有 AI 产物、project.json、frame mp4、exports/output.mp4 或 exports/output-audio.mp4
丢弃：旧 visual_inspect checkpoint 状态；历史报告可以保留在 revisions 或 reports 数组中
执行：重新调用 visualQaService.inspectRenderedVideo -> 更新 generation_checkpoint.stages.visual_inspect -> 更新 workflow inspect stage
触发：visual_inspect 子阶段失败，或其他修复动作完成后需要重新巡检
```

#### restart_project

仅用于 generation_checkpoint 缺失且 project 阶段无可复用产物的失败。

```text
复用：source、research、assets、agent_run、brief、audio（仅当 `project.audio.scene_spec_hash` 与当前 `scene_spec_hash` 一致）
丢弃：project artifacts
执行：从 scene_spec/template/content_graph 重新开始 project 阶段
```

如果 `scene_spec_hash` 不一致，audio 必须丢弃并回到 `brief -> audio` 重新生成，不能硬复用。

Resume executor 必须复用现有 `creativeWorkflowTasks.js` 后台任务系统。实现上可以新增 `startCreativeWorkflowRetryTask()`，但内部应继续使用同一个 task registry、active task guard、SSE 事件流和 `patchCreativeWorkflowTaskSummary()`，只在 task summary 中增加：

```js
{
  operation: 'retry',
  retry_attempt_id: 'retry_20260625_123000'
}
```

不要为 retry 建第二套并行任务注册表。

### 与外层 stage 的衔接

resume executor 有两种候选模式：

```text
A. 全工作流恢复：
   新增 runCreativeWorkflowFromStage(workflowId, 'project') 或等价入口。
   project 成功后自然继续外层 check -> render -> inspect。

B. 局部 project 恢复：
   只跑 html-video 内部子阶段。
   成功后由 executor 主动标记 project/check/render/inspect。
```

V1 推荐模式 B，因为当前 html-video lite 成功时已经由 `markHtmlVideoLiteFinalStages()` 将外层 `check` 标记为 skipped、`render` 和 `inspect` 标记为 done。resume executor 应复用该语义，不要再走 legacy `checkDouyinRunHyperframesFreeformProject()` / `renderDouyinRunHyperframesFreeformVideo()`。

验收要求：

- retry project 成功后，外层 `project` stage 为 `done`。
- html-video lite 路径下，外层 `check` 为 `skipped`，`render` 为 `done`，`inspect` 为 `done`。
- workflow `status` 更新为 `done`。
- 如果后续引入 `runCreativeWorkflowFromStage()`，必须确保不会重跑 source/research/brief/audio。

## API 设计

### 查询重试计划

新增：

```http
GET /api/creative-workflows/:workflow_id/retry-plan
```

响应：

```js
{
  "success": true,
  "workflow_id": "20260625121115575391",
  "plan": {
    "can_retry": true,
    "fallback_allowed": true,
    "code": "provider_missing_text",
    "retry_from": "frame_html",
    "repair_action": "retry_frame_html",
    "reuse": ["source", "research", "brief", "audio", "content_graph", "frames:scene_01-scene_04"],
    "discard": ["frames:scene_05", "render_outputs", "exports"],
    "user_message": "将复用已完成内容，只重新生成失败帧并重新导出。"
  }
}
```

失败：

```js
{
  "success": false,
  "workflow_id": "20260625121115575391",
  "message": "当前任务未失败，无需重试。"
}
```

### 执行修复并重试

新增：

```http
POST /api/creative-workflows/:workflow_id/retry
```

请求：

```js
{
  "mode": "repair_and_resume",
  "confirm_plan_code": "provider_missing_text"
}
```

V1 仅支持 `mode: "repair_and_resume"`。如果未来增加 `rerun_only`、`inspect_only` 等模式，必须先扩展 retry planner 的枚举和前端文案。

响应：

```js
{
  "success": true,
  "workflow_id": "20260625121115575391",
  "task_id": "workflow-20260625121115575391-...",
  "active_task": {},
  "message": "已开始修复并重试。"
}
```

规则：

- 如果已有 active task，返回 409 风格错误：

```js
{
  "success": false,
  "message": "当前创作任务仍在运行，请等待结束后再重试。"
}
```

- 如果 plan code 已变化，要求前端刷新 retry plan。
- retry 后仍使用现有 SSE `/events`。

## 前端 UI 设计

### 失败详情

`CreativeTaskDetail` 在 workflow failed 时新增“恢复建议”区域。

展示：

```text
失败位置：生成工程 / 第 5 帧 HTML
失败类型：模型返回空内容
处理方式：只重试失败帧，复用已生成内容
```

展示复用内容：

```text
将复用：
- 来源资料
- 联网研究
- 导演改写
- 成片策划
- 旁白音频
- content graph
- 已生成的 4/6 帧 HTML
```

展示重跑内容：

```text
将重新执行：
- 第 5 帧 HTML
- 工程校验
- 渲染与合成
- 视觉巡检
```

按钮：

```text
修复并重试
```

loading 文案：

```text
正在生成恢复计划...
正在修复并重试...
```

失败文案：

```text
无法自动重试：ffmpeg 不可用，请先到设置中心修复系统环境。
```

### 状态更新

retry 期间沿用现有任务进度，但消息必须体现恢复动作：

```text
正在复用已生成的 content graph...
正在重新生成第 5/6 帧 HTML...
正在修复时间轴...
正在重新合成成片...
```

## 后端实现分解

### 第一阶段：generation checkpoint 持久化

修改文件：

- `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`
- `server/services/creative-video/html-video/projectStore.js`
- `server/services/creative-video/html-video/projectSchema.js`

新增要求：

- 在 `project.json` 中新增 `generation_checkpoint`。
- content graph 成功后写 `content-graph.json` 并更新 `generation_checkpoint.stages.content_graph`。
- 每帧 HTML 成功写入后，同步更新 `generation_checkpoint.stages.frame_html.frames[frameId]`。
- 第 N 帧失败时，前 N-1 帧 HTML 文件仍存在，且 project 能知道哪些帧已完成。
- 所有 checkpoint 路径必须相对 project dir。

验收：

- content graph 成功后 `project.json.generation_checkpoint.stages.content_graph.status === 'done'`。
- 每帧 HTML 成功后对应 frame checkpoint 状态为 `done`。
- 第 N 帧失败时，前 N-1 帧 HTML 文件仍存在，project checkpoint 仍可读取。

### 第二阶段：错误诊断结构化

修改文件：

- `server/services/creativeWorkflows.js`
- `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- `server/services/creative-video/html-video/projectOrchestrator.js`
- `server/services/creative-video/html-video/frameHtmlAgent.js`
- `server/services/creative-video/html-video/contentGraphAgent.js`

新增要求：

- 所有 failure 返回现有 diagnostics.js 结构。
- 扩展 diagnostics 字段：`sub_stage`、`frame_id`、`retryable`、`repair_action`。
- `runStage()` 捕获失败时，将 `diagnostics` 写入 `record.last_failure`。
- `ensureSuccess()` 不能丢弃 result 内部 diagnostics。
- html-video progress event 增加 `sub_stage`。

新增错误类文件：

```text
server/services/creative-video/errors.js
```

导出：

```js
class CreativeWorkflowStageError extends Error {
  constructor(message, {
    stage = '',
    sub_stage = '',
    code = '',
    diagnostics = [],
    retryable = false,
    fallbackAllowed = true,
  } = {}) {
    super(message);
    this.stage = stage;
    this.sub_stage = sub_stage;
    this.code = code;
    this.diagnostics = diagnostics;
    this.retryable = retryable;
    this.fallback_allowed = fallbackAllowed;
  }
}
```

`creativeWorkflows.js` 和 html-video 路径需要引用该错误类，不要把类直接定义在 `creativeWorkflows.js` 内。

`ensureSuccess(result, fallbackMessage, context = {})` 应在 `result.success === false` 时抛出该错误，并保留 `result.diagnostics || result.html_video_diagnostics`：

```js
function ensureSuccess(result, fallbackMessage, context = {}) {
  if (!result || result.success === false) {
    const diagnostics = result?.diagnostics || result?.html_video_diagnostics || [];
    throw new CreativeWorkflowStageError(
      safeString(result && result.message) || fallbackMessage,
      {
        stage: context.stage || '',
        sub_stage: context.sub_stage || '',
        code: context.code || diagnostics[0]?.code || 'unknown_failure',
        diagnostics,
        retryable: context.retryable ?? diagnostics.some(item => item.retryable === true),
        fallbackAllowed: context.fallbackAllowed ?? diagnostics.every(item => item.fallback_allowed !== false),
      },
    );
  }
  return result;
}
```

为降低改动风险，可以保留旧签名兼容所有调用点；只有 project/html-video 相关调用必须传入 `context`。

验收：

- `provider_missing_text` 能在 workflow JSON 里看到结构化 code。
- `timeline_duration_unreasonable` 能在 workflow JSON 里看到 `sub_stage=timeline_check`。
- `last_failure.diagnostics` 保留 html-video 内部 diagnostics。

### 第三阶段：content graph 可恢复

修改文件：

- `server/services/creative-video/html-video/contentGraphAgent.js`
- `server/services/creative-video/html-video/htmlVideoWorkflow.js`

新增能力：

- tolerant parse。
- scene_spec fallback graph。
- graph generation_checkpoint reuse。

验收：

- AI 返回尾逗号 JSON 时可以修复。
- AI 返回空文本时 retry 一次。
- retry 仍失败时使用 scene_spec graph 继续。

### 第四阶段：frame HTML 可恢复

修改文件：

- `server/services/creative-video/html-video/frameHtmlAgent.js`
- `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`
- `server/services/creative-video/html-video/frameFallbackBuilder.js`

新增能力：

- `generateFrameHtml()` 支持 `frameId`、`attempt`、`forceNonStream`、`shortPrompt`。
- 已成功 frame HTML 从 generation_checkpoint 复用。
- 失败 frame 单独重试。
- fallback HTML 生成器。

验收：

- 第 3 帧 provider missing text，不重跑第 1、2 帧。
- retry 成功后 project 使用全部帧继续渲染。

### 第五阶段：timeline repair

新增文件：

- `server/services/creative-video/html-video/timelineRepair.js`

修改文件：

- `server/services/creative-video/html-video/projectOrchestrator.js`
- `server/services/creative-video/html-video/htmlVideoWorkflow.js`

导出：

```js
function analyzeTimelineMismatch({ project, sceneSpec, targetDurationSec, audioManifest })
function repairProjectTimeline({ project, sceneSpec, targetDurationSec, audioManifest })
```

修复规则：

- frame duration 总和必须接近 target。
- scene duration 总和必须接近 target。
- content_graph node duration 同步到 scene/frame duration。
- 如果 audio duration 超出 target 上限，返回 `requires_script_repair`。

验收：

- 目标 60 秒，frame 总和 132 秒时，生成 repair plan。
- repair 后不再触发 `timeline_duration_unreasonable`。

### 第六阶段：retry planner

新增文件：

- `server/services/creative-video/retryPlanner.js`

测试文件：

- `tests/test-creative-workflow-retry-planner.js`

验收：

- provider missing text -> `retry_frame_html`。
- timeline unreasonable -> `repair_timeline`。
- compose failed -> `recompose`。
- environment missing -> `can_retry=false`。

### 第七阶段：resume executor

新增文件：

- `server/services/creative-video/resumeExecutor.js`

修改文件：

- `server/services/creativeWorkflows.js`
- `server/services/creativeWorkflowTasks.js`

新增能力：

- `retryCreativeWorkflow(workflowId, payload, options)`
- `startCreativeWorkflowRetryTask(workflowId, options)`

验收：

- 失败任务可以启动 retry 后台任务。
- retry task 使用 SSE 上报进度。
- retry 成功后 workflow status 变为 `done`。

### 第八阶段：API 与前端

修改文件：

- `server/routes/creativeWorkflows.js`
- `frontend-react/src/api/client.js`
- `frontend-react/src/components/creative/CreativeTaskDetail.jsx`
- `frontend-react/src/pages/OneClickCreativePage.jsx`

新增接口：

- `GET /api/creative-workflows/:workflow_id/retry-plan`
- `POST /api/creative-workflows/:workflow_id/retry`

验收：

- failed workflow 显示“修复并重试”。
- 点击后显示 loading。
- retry task 进度能实时更新。
- active task 运行中时按钮禁用。

## 测试设计

### 单元测试

新增：

```text
tests/test-creative-workflow-retry-planner.js
tests/test-html-video-project-checkpoint-persistence.js
tests/test-html-video-content-graph-retry.js
tests/test-html-video-frame-html-resume.js
tests/test-html-video-timeline-repair.js
tests/test-creative-workflow-retry-task.js
```

### 必测场景

#### provider missing text at frame_html

输入：

- content graph 已成功。
- `scene_01`、`scene_02` HTML 已成功。
- `scene_03` 模型返回缺文本。

期望：

- workflow failed 记录 `code=provider_missing_text`。
- retry plan 为 `retry_frame_html`。
- retry 只调用 `scene_03` 的 HTML 生成。
- 不重新调用 source/research/brief/audio。

#### provider missing text at content_graph

输入：

- scene_spec 已成功。
- content graph 模型返回缺文本。

期望：

- retry plan 为 `retry_content_graph` 或 `fallback_scene_spec_graph`。
- 不重新生成 audio。

#### invalid content graph JSON

输入：

- AI 返回带尾逗号 JSON。

期望：

- tolerant parse 修复。
- `project.json.generation_checkpoint` 写入 content graph 状态。

#### timeline unreasonable

输入：

- target 60 秒。
- project frames 总和 132 秒。

期望：

- retry plan 为 `repair_timeline`。
- repair 后 frame 总和接近 60 秒。
- 不调用 frameHtmlAgent。

#### render failed one frame

输入：

- frame HTML 全部存在。
- `scene_04.mp4` 渲染失败。

期望：

- retry plan 为 `rerender_frames`。
- 只重渲染 `scene_04`。
- compose 重新执行。

#### compose duration mismatch

输入：

- 所有 frame mp4 存在。
- ffprobe 输出超出 expected duration。

期望：

- retry plan 为 `recompose`。
- 不调用任何 AI 模型。

#### active task guard

输入：

- workflow failed，但仍有 active task。

期望：

- retry API 返回失败。
- 中文提示“当前创作任务仍在运行，请等待结束后再重试。”

## 子代理执行建议

为避免返工，后续实现应拆成独立子代理任务，每个任务必须先写测试再改代码：

1. `project.json.generation_checkpoint` 持久化。
2. 诊断结构化与 `last_failure` 持久化。
3. content graph / frame HTML 局部重试能力。
4. timeline repair。
5. retry planner，含 content graph / frame HTML / timeline 分类。
6. resume executor 与现有后台 task 复用。
7. API + 前端失败恢复 UI。
8. 端到端测试与文档更新。

每个子代理只处理自己的文件范围。跨任务共享的数据结构以本文档为准，不得在实现中临时改字段名。

## 验收标准

完成后，以下场景必须成立：

- 一键创作在 `provider 返回结果缺少文本内容` 失败后，可以复用已成功阶段并继续。
- 一键创作在目标 60 秒、当前 132 秒的时间轴错误后，会先修复时间轴再渲染。
- 用户在失败页能看到明确恢复计划，而不是只看到“重新创建任务”。
- retry 成功不会重新消耗 source/research/brief/audio 的 token。
- retry 失败会更新新的 `last_failure` 和 retry attempt，不覆盖原始失败诊断。
- 旧的普通创建任务流程不受影响。

## 风险与边界

- 如果失败发生在 source/research/agent_run/brief 之前，没有可复用的高价值产物，只能从对应外层 stage 重试。
- 如果用户手动删除了 html-video project 目录，retry planner 应降级为 `restart_project` 或提示无法恢复。
- 如果模型连续返回空文本，最多自动重试两次，然后写清楚 provider 和阶段，避免无限消耗 token。
- 如果时间轴修复要求压缩旁白，必须重新 TTS；不能复用旧音频。
- 如果 ffmpeg、ffprobe、Playwright 缺失，不能自动重试，应提示用户修复系统环境。

## 推荐实现顺序

最稳顺序：

```text
generation_checkpoint
  -> diagnostics
  -> content/frame retry
  -> timeline repair
  -> planner
  -> executor
  -> API/UI
```

不要先做前端按钮。没有 planner 和 executor 的按钮只会变成“重新跑 project”，仍然会浪费 token，也无法解决时间轴类错误。
