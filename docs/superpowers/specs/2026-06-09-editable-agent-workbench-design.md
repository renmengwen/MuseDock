# 可编辑 Agent 工作台设计

## 背景

当前 `/ai` 页面已经串起了素材状态、任务 Agent、TTS、AI 分镜、HyperFrames 视频工程和渲染。下一步不新增独立调试台，而是把现有 AI 工作台重构为“可编辑 Agent 工作台”：用户可以在正式链路中编辑任务 Agent 和分镜 Agent 的 prompt、参数和分镜结果，同时每次运行保存配置快照，保证历史结果可复现。

## 目标

- 保留现有 AI 工作台主流程：选择素材、运行任务 Agent、合成 TTS、生成分镜、生成视频工程、渲染视频。
- 让任务模板 Agent 可编辑，包括 `system prompt`、`user prompt 模板`、输出字段说明和模型参数。
- 让分镜 Agent 可编辑，包括 `system prompt`、`user prompt 模板`、Frame Profile 引用、视觉约束和模型参数。
- 生成分镜后允许编辑每条 scene 的标题、字幕覆盖范围、画面类型、布局、背景提示和强调词。
- 每次任务 Agent 和分镜 Agent 运行都保存当时的配置快照、最终 messages、原始输出、解析状态和 schema 校验结果。
- 支持恢复默认配置和保存为当前模板配置。

## 非目标

- 第一版不做独立 `/ai/debug` 调试台。
- 第一版不做模板市场、多人协作、云端同步或权限系统。
- 第一版不允许用户直接修改正式运行记录中的 `start`、`end`、`duration`。时间轴仍以后端字幕和分镜归一化结果为准。
- 第一版不把实验模板自动应用到正式链路，必须由用户显式保存。

## 产品结构

现有 `/ai` 页面保留，三栏含义调整。

### 左栏：Agent 配置区

左栏从“任务模板列表”升级为“Agent 配置区”。

- 选择任务模板：`爆款拆解 + 改写脚本`、`评论洞察`。
- 展示当前模板来源：默认模板 / 已保存自定义配置 / 本次临时编辑。
- 提供“高级编辑”折叠区。
- 高级编辑中支持编辑：
  - `system prompt`
  - `user prompt 模板`
  - 输出字段说明
  - 模型参数，例如 `temperature`、`stream`、`maxRetries`
  - 现有 `promptOptions` 表单字段
- 提供操作：
  - “恢复默认”
  - “保存为当前模板配置”
  - “预览 messages”
  - “运行当前 Agent”

### 中栏：流程与历史运行

中栏继续承载执行过程和历史记录，但步骤更细。

- 素材检查
- 转写检查
- 评论检查
- 构造 messages
- 模型调用
- JSON 解析
- schema 校验
- 保存结果

历史运行记录需要展示：

- 运行状态
- 运行时间
- 模板 id
- 配置来源：默认 / 已保存自定义 / 本次临时编辑
- 是否存在解析失败或 schema 校验错误

### 右栏：结果与可编辑后处理

右栏从“结果展示”升级为“结果 + 可编辑后处理区”。

- 任务 Agent 结果继续按结构化字段展示。
- 新增调试信息页签：
  - 最终 messages
  - 模型原始输出
  - JSON 解析结果
  - schema 校验错误
  - 归一化结果
- TTS、分镜、成片流程继续保留在右栏。
- 分镜生成后提供 scene 编辑器：
  - 标题 `headline`
  - 字幕覆盖范围 `caption_indexes`
  - 画面类型 `visual_type`
  - 布局 `layout`
  - 背景提示 `background_prompt`
  - 强调词 `emphasis_words`
- 修改分镜后可以重新生成视频工程。

## 后端设计

后端采用三层结构：默认模板、用户覆盖配置、运行快照。

### 默认模板

默认模板继续保留在代码中：

- `server/services/agentTemplates.js`
- `server/services/storyboardAgent.js`

默认模板提供系统默认 prompt、用户 prompt 生成逻辑、默认模型参数、结果字段和归一化逻辑。

### 用户覆盖配置

新增本地覆盖配置文件：

```text
data/config/agent_templates.json
```

建议结构：

```json
{
  "task_agents": {
    "viral_rewrite": {
      "systemPrompt": "...",
      "userPromptTemplate": "...",
      "resultSchema": {},
      "modelOptions": {
        "temperature": 0.4,
        "stream": true,
        "maxRetries": 1
      },
      "updatedAt": "2026-06-09T00:00:00.000Z"
    }
  },
  "storyboard_agent": {
    "systemPrompt": "...",
    "userPromptTemplate": "...",
    "useFrameProfile": true,
    "modelOptions": {
      "temperature": 0.35,
      "stream": true,
      "maxRetries": 1
    },
    "updatedAt": "2026-06-09T00:00:00.000Z"
  }
}
```

新增服务：

```text
server/services/agentTemplateOverrides.js
```

职责：

- 读取当前覆盖配置。
- 保存任务 Agent 覆盖配置。
- 保存分镜 Agent 覆盖配置。
- 恢复默认配置。
- 合并默认模板和覆盖配置，产出当前可运行配置。
- 根据运行上下文构造最终 messages。
- 校验必要字段是否为空。

### API

新增或扩展以下接口：

```text
GET /api/agents/templates
GET /api/agents/templates/:id
PUT /api/agents/templates/:id
DELETE /api/agents/templates/:id/override

GET /api/agents/storyboard-template
PUT /api/agents/storyboard-template
DELETE /api/agents/storyboard-template/override
```

运行接口保持现有路径，但允许传入一次性覆盖配置：

```text
POST /api/agents/douyin/:aweme_id/runs
POST /api/agents/douyin/:aweme_id/runs/:run_id/storyboard
```

请求体扩展：

```json
{
  "template": "viral_rewrite",
  "promptOptions": {},
  "agentConfigOverride": {
    "systemPrompt": "...",
    "userPromptTemplate": "...",
    "modelOptions": {}
  }
}
```

分镜接口请求体扩展：

```json
{
  "storyboardOptions": {},
  "storyboardConfigOverride": {
    "systemPrompt": "...",
    "userPromptTemplate": "...",
    "useFrameProfile": true,
    "modelOptions": {}
  }
}
```

### 运行快照

每次任务 Agent 运行保存配置快照：

```json
{
  "agent_config_snapshot": {
    "templateId": "viral_rewrite",
    "source": "default",
    "systemPrompt": "...",
    "userPromptTemplate": "...",
    "modelOptions": {}
  },
  "messages": [],
  "raw_output": "...",
  "parse": {
    "success": true,
    "error": ""
  },
  "schema_validation": {
    "success": true,
    "errors": []
  }
}
```

每次分镜 Agent 运行保存配置快照：

```json
{
  "storyboard_config_snapshot": {
    "source": "override",
    "systemPrompt": "...",
    "userPromptTemplate": "...",
    "useFrameProfile": true,
    "modelOptions": {}
  },
  "storyboard_messages": [],
  "storyboard_raw_output": "...",
  "storyboard_parse": {
    "success": true,
    "error": ""
  },
  "storyboard_schema_validation": {
    "success": true,
    "errors": []
  }
}
```

## 分镜编辑

分镜编辑不直接修改字幕时间轴。用户只能编辑 scene 的可控字段：

- `caption_indexes`
- `headline`
- `visual_type`
- `layout`
- `background_prompt`
- `emphasis_words`

保存分镜修改时，后端调用 `storyboardSchema.normalizeStoryboard` 重新归一化。

校验规则：

- `caption_indexes` 必须引用现有字幕 index。
- 同一个字幕 index 不能被多个 scene 重复使用。
- 空 scene 会被拒绝。
- 未覆盖字幕可以由后端继续补齐默认 scene。
- `start`、`end`、`duration` 由后端根据字幕重新计算。

建议新增接口：

```text
PUT /api/agents/douyin/:aweme_id/runs/:run_id/storyboard
```

请求体：

```json
{
  "storyboard": {
    "template": "ai_storyboard_cards",
    "style": {},
    "scenes": []
  }
}
```

响应返回归一化后的 storyboard 和校验结果。

## 错误处理

- 接口请求期间必须展示明确 loading 文案，例如“正在保存 Agent 模板配置...”“正在预览 messages...”“正在校验分镜...”“正在重新生成视频工程...”。
- 请求完成后必须更新为成功、失败、未配置、需登录、需验证等明确状态。
- JSON 解析失败时展示中文错误，同时保留模型原始输出。
- schema 校验失败时展示具体字段和原因。
- 用户 prompt 模板为空、system prompt 为空、模型参数非法时，保存和运行都应给出中文提示。

## 测试计划

后端：

- 覆盖配置读取、保存、恢复默认。
- 默认模板和覆盖配置合并。
- 任务 Agent 一次性覆盖配置运行。
- 运行记录保存 `agent_config_snapshot`、`messages`、`raw_output`、解析状态和 schema 校验结果。
- 分镜 Agent 一次性覆盖配置运行。
- 手动保存分镜时重新归一化并拒绝非法 `caption_indexes`。

前端：

- Agent 配置区字段渲染和状态切换。
- 保存模板配置、恢复默认、预览 messages。
- 运行当前 Agent 时按钮禁用和 loading 状态。
- 结果页签展示 messages、原始输出、解析状态和校验错误。
- 分镜 scene 编辑、保存、重新生成视频工程。

## 分阶段实施

### 第一阶段：任务 Agent 可编辑

- 新增覆盖配置服务和模板 API。
- 前端左栏增加高级编辑。
- 运行记录保存任务 Agent 配置快照、messages、原始输出和解析状态。
- 暂不改分镜编辑器。

### 第二阶段：分镜 Agent 可编辑

- 分镜 Agent 支持覆盖配置和运行快照。
- 前端分镜区域增加高级编辑。
- 展示分镜 messages、原始输出、解析状态和校验错误。

### 第三阶段：分镜结果可编辑

- 前端增加 scene 编辑器。
- 后端增加保存分镜接口。
- 修改后支持重新生成 HyperFrames 工程和视频。

### 第四阶段：体验收口

- 优化历史运行的配置来源展示。
- 增加“恢复默认”“保存为当前模板配置”的确认和反馈。
- 补齐错误提示、空状态、重复点击保护。
- 根据真实使用情况决定是否再拆出独立 AI 调试台。

