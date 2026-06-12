# 一键创作成片与自定义素材预留设计

## 背景

当前项目已经具备抖音素材准备、ASR 转写、评论洞察、Agent 改写、导演分镜、分段 TTS、HyperFrames 工程生成、工程校验、渲染和视频巡检能力。但这些能力分散在多个页面和按钮里，用户需要理解流程后逐步触发。

新的产品方向是把首个使用链路收敛为“一键创作成片”：用户进入项目后输入想生成的视频方向，这个输入可以是纯文本方向，也可以是抖音视频 ID 或链接。用户可以选择是否联网获取最新资料，默认关闭；也可以选择是否上传图片素材。第一期先实现一键入口与统一流程，第二期接入图片素材上传和多模态分析，但第一期必须预留完整数据结构、接口字段和 Agent 上下文，避免第二期大改。

## 目标

- 提供一个统一创作入口，支持纯文本方向和抖音 ID / 链接两种输入。
- 把现有高级成片流程串成后端统一编排的一键工作流。
- 联网获取最新资料由用户显式选择，默认关闭，不做自动检测提醒。
- 关键帧抽取不作为一键成片主链路依赖。
- 第一阶段不实现图片素材分析，但保留 `asset_context`、接口字段、任务状态和 Agent prompt 入口。
- 保持现有 HyperFrames 工程校验、渲染和巡检流程正常运行。

## 非目标

- 第一阶段不实现图片上传、多模态图片分析、素材自动插入和素材动画编辑。
- 第一阶段不实现长期素材库、素材标签管理或素材复用。
- 第一阶段不让前端直接调用大模型或暴露 API Key。
- 第一阶段不把原视频关键帧作为创作主输入。
- 第一阶段不要求所有模型供应商都支持联网工具调用。

## 核心用户链路

### 无素材链路

1. 用户打开一键创作入口。
2. 用户输入视频方向、抖音 ID 或抖音链接。
3. 用户可选择开启“联网获取最新资料”，默认关闭。
4. 用户不上传图片素材。
5. 后端创建创作工作流。
6. 如果输入是抖音 ID / 链接，后端抓取视频信息、执行 ASR、抓取评论并形成 `source_context`。
7. 如果输入是纯文本，后端直接把用户输入形成 `source_context`。
8. 如果开启联网，后端执行 Research Service 并形成 `research_context`。
9. 后端生成空的 `asset_context`。
10. 导演 Agent 汇总上下文生成导演 brief / storyboard plan。
11. 后端生成分段 TTS 和时间轴。
12. 后端生成 HyperFrames 工程。
13. 后端执行工程校验、渲染和视频巡检。
14. 前端展示最终视频、阶段状态和调试信息。

### 预留素材链路

第二阶段启用图片素材后，主链路只在第 8 步后增加素材分析：

1. 用户上传 1 到多张图片。
2. 后端保存图片并生成素材记录。
3. 多模态模型分析图片主体、风格、可表达概念、适合场景、建议动效和使用限制。
4. 后端把结果写入 `asset_context.assets`。
5. 导演 Agent 根据 `asset_context` 决定素材适合哪一幕、用作背景、主体、贴片、证据图还是产品图。
6. HyperFrames 工程生成阶段把素材复制到工程 `assets/` 并作为 image layer 使用。

## 架构设计

新增一层 `Creative Workflow Orchestrator`，负责统一编排输入解析、上下文构建、Agent 调用、TTS、工程生成、校验、渲染和巡检。

推荐模块边界：

- `creativeWorkflow`：创建和推进一键工作流。
- `creativeContext`：构建和规范化 `creative_context`。
- `researchService`：在用户开启联网时获取最新资料，第一阶段可先接单一 provider。
- `assetContext`：第一阶段只提供空上下文与结构校验，第二阶段接入上传和多模态分析。
- `agentRuns`：复用现有 run 持久化、HyperFrames Freeform 和传统 HyperFrames 工作流能力。

现有能力尽量复用：

- 抖音素材准备复用 `mediaPipeline.prepareDouyinMedia`。
- ASR 复用 `mediaPipeline.transcribeAudio`。
- Agent run、TTS、HyperFrames project、render、inspect 复用 `agentRuns` 中已有能力。
- 工程校验复用 `hyperframesFreeformQuality` 和现有渲染巡检能力。

## 数据模型

第一阶段新增或持久化一个稳定的 `creative_context`。该对象必须在无素材时也存在完整字段。

```json
{
  "input": {
    "mode": "text",
    "raw_text": "",
    "aweme_id": "",
    "douyin_url": "",
    "use_research": false,
    "created_at": ""
  },
  "source_context": {
    "status": "ready",
    "kind": "text",
    "summary": "",
    "transcript": "",
    "comments_summary": "",
    "douyin_metadata": {},
    "diagnostics": {}
  },
  "research_context": {
    "status": "disabled",
    "query": "",
    "sources": [],
    "summary": "",
    "updated_at": ""
  },
  "asset_context": {
    "status": "disabled",
    "assets": [],
    "updated_at": ""
  }
}
```

### 输入模式

- `text`：用户输入纯文本方向。
- `douyin`：用户输入抖音 ID 或链接。

输入解析只负责识别类型，不做“是否需要联网”的自动判断。联网完全由 `use_research` 控制。

### Research Context

`research_context.status` 可取值：

- `disabled`：用户未开启联网。
- `ready`：联网资料已生成。
- `failed`：联网资料获取失败。

`sources` 预留结构：

```json
[
  {
    "title": "",
    "url": "",
    "published_at": "",
    "retrieved_at": "",
    "summary": "",
    "evidence": ""
  }
]
```

第一阶段如果 Research Service 失败，应允许用户选择继续使用非联网上下文生成，或停止流程。

### Asset Context

第一阶段默认：

```json
{
  "status": "disabled",
  "assets": [],
  "updated_at": ""
}
```

第二阶段启用后，`assets` 结构预留为：

```json
[
  {
    "asset_id": "",
    "file_name": "",
    "mime_type": "",
    "url": "",
    "path": "",
    "analysis": {
      "summary": "",
      "subjects": [],
      "visual_style": "",
      "use_cases": [],
      "suggested_scenes": [],
      "animation_suggestions": [],
      "constraints": []
    }
  }
]
```

## API 设计

第一阶段建议新增一组一键工作流接口，也可以挂在现有 `/api/agents` 下。

### 创建一键工作流

`POST /api/creative-workflows`

请求：

```json
{
  "input": "用户输入的视频方向、抖音 ID 或抖音链接",
  "useResearch": false,
  "assetIds": [],
  "renderOptions": {},
  "workflowOptions": {}
}
```

响应：

```json
{
  "success": true,
  "workflow_id": "",
  "run_id": "",
  "status": "queued",
  "creative_context": {},
  "message": "创作任务已创建。"
}
```

### 查询工作流

`GET /api/creative-workflows/:workflow_id`

返回完整阶段状态、`creative_context`、当前 run、视频输出和错误信息。

### 后续素材接口预留

第二阶段可新增：

- `POST /api/creative-assets`：上传图片素材。
- `GET /api/creative-assets/:asset_id`：读取素材分析结果。
- `POST /api/creative-assets/:asset_id/analyze`：重新分析素材。

第一阶段不需要实现这些接口，但 `POST /api/creative-workflows` 需要保留 `assetIds` 字段并校验为空数组或暂不支持。

## 前端设计

新增或改造一个“一键创作”入口，第一阶段表单保持克制：

- 一个主输入框：`输入视频方向、抖音 ID 或抖音链接`
- 一个开关：`联网获取最新资料`，默认关闭
- 一个素材区域：第一阶段显示“图片素材将在下一阶段开放”，或显示禁用上传入口
- 一个主按钮：`一键生成视频`
- 一个工作流进度面板：展示资料准备、联网研究、素材分析、导演规划、配音、工程生成、校验、渲染、巡检

前端不要展示关键帧作为主流程资产。关键帧可保留在媒体素材调试页或隐藏在已有素材状态中。

## Agent 上下文约束

导演 Agent、HyperFrames Freeform brief Agent 和工程生成 Agent 都应接收 `creative_context`。

Prompt 规则：

- 如果 `research_context.status` 是 `disabled`，不要编造最新事实。
- 如果 `research_context.status` 是 `ready`，涉及实时事实时优先使用 `research_context.sources`。
- 如果 `asset_context.assets` 为空，不要声称使用了用户素材。
- 如果未来 `asset_context.assets` 非空，可以根据素材分析规划画面，但不得虚构未上传素材。
- 抖音来源只作为创作参考，不要求复刻原视频画面。

## 错误处理

- 输入为空：前端阻止提交，提示“请输入视频方向、抖音 ID 或抖音链接”。
- 抖音抓取失败：工作流失败，提示登录、验证、视频不存在或抓取失败原因。
- ASR 未配置：允许走没有转写的降级链路，或提示用户先配置 ASR，具体由当前高级成片所需上下文决定。
- 联网研究失败：如果 `useResearch=true`，展示失败原因，并允许用户关闭联网后重试。
- Agent 生成失败：记录 raw output、parse error 和 prompt messages。
- 工程校验失败：保留现有校验结果，允许用户查看 debug 信息。
- 渲染失败：保留项目目录和错误日志，允许重试渲染。

所有用户可见文案必须使用中文。

## 测试策略

第一阶段至少覆盖：

- 纯文本输入创建工作流。
- 抖音 ID / 链接识别。
- `useResearch=false` 时 `research_context.status=disabled`。
- `asset_context` 在第一阶段稳定返回 `{ status: "disabled", assets: [] }`。
- Agent prompt 构造包含 `creative_context`。
- 无素材时不会生成素材相关虚假描述。
- 工作流状态能从创建推进到工程生成或失败。
- 渲染校验流程仍使用现有 HyperFrames 检查。

第二阶段扩展测试：

- 图片上传路径安全。
- 多张图片素材分析。
- `asset_context.assets` schema 规范化。
- 素材插入分镜建议。
- HyperFrames 工程 `assets/` 文件复制和相对路径引用。
- 图片素材 image layer 动画输出。

## 分阶段落地

### 第一阶段

- 新增一键创作入口。
- 支持纯文本和抖音 ID / 链接输入。
- 联网开关默认关闭。
- 实现 `creative_context`。
- 预留 `asset_context`。
- 复用现有高级成片逻辑串成后端工作流。
- 保持工程校验、渲染和巡检。

### 第二阶段

- 实现图片素材上传。
- 接入多模态图片分析。
- 将素材分析写入 `asset_context.assets`。
- 让导演 Agent 规划素材插入位置。
- 让 HyperFrames 工程生成 image layer、动画和效果。

### 第三阶段

- 素材库、素材复用、素材标签。
- 用户手动指定素材插入某一幕。
- 素材动画高级编辑。
- 联网研究 provider 可配置。

## 设计结论

第一阶段不是只做一个按钮，而是建立一条可扩展的一键创作主链路。即使暂不实现图片上传，也必须让 `asset_context` 成为工作流协议的一部分。这样第二阶段只需要填充素材上下文和工程 image layer，不需要重做接口、数据结构和 Agent 调用边界。
