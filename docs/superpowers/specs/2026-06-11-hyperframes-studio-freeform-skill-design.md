# 高级 HyperFrames 成片工作台设计

## 背景

当前项目已经能把抖音素材、转写、评论洞察、导演分镜、TTS 字幕和 HyperFrames 渲染串成一条稳定链路。但这条链路的最终画面来自项目内置的 `ai_storyboard_cards` 模板：模型输出结构化 JSON，后端把 JSON 填进固定 HTML/CSS/GSAP 模板，再调用 `hyperframes render`。

这条链路适合批量生成口播图文动效视频，但很难达到 Codex 使用 HyperFrames skill 时生成的定制短片效果。Codex 的工作方式更接近“导演 + 视觉设计师 + 前端动效工程师”：先产出导演级分镜、旁白和 `design.md`，再直接编写完整 `index.html`，并通过 HyperFrames 的 `lint`、`validate`、`inspect`、`render` 闭环迭代。

本设计新增一个独立页面“高级成片工作台”，用于承载自由 HyperFrames 工程生成链路。现有 AI 工作台和模板成片链路保留，作为快速稳定模式。

## 目标

- 新增独立页面，不把高级成片能力继续塞进现有 `AiWorkspace.jsx`。
- 新增自由工程链路：模型可以生成 `design.md`、`index.html`、`hyperframes.json`、`package.json` 等工程文件。
- 第一版先实现“内置高级模式”：项目读取 HyperFrames skill 内容作为知识库和规范输入，但不依赖外部 Agent runtime。
- 目录中保留 `.agents/skills` 快照，便于复现和后续切换到 Agent 托管模式。
- 接入 HyperFrames CLI 校验闭环：`lint`、`validate`、`inspect`、`render`。
- 每个接口请求都要有明确中文 loading、成功、失败和可恢复状态。
- 所有用户可见文案默认中文。

## 非目标

- 第一版不把 Codex CLI 或 Claude Code 作为必需运行时。
- 第一版不做复杂在线代码编辑器，只提供基础文本查看和保存能力。
- 第一版不替换现有 `ai_storyboard_cards` 模板链路。
- 第一版不实现多轮无限自动修复，最多预留有限重试接口和数据结构。

## 页面入口

新增路由：

```text
/hyperframes-studio/:awemeId?/:runId?
```

导航新增入口：

```text
高级成片
```

现有 AI 工作台中，在已生成导演分镜或视觉分镜的 run 上增加按钮：

```text
打开高级成片工作台
```

按钮跳转时带上当前 `aweme_id` 和 `run_id`。如果没有 `run_id`，页面允许用户输入 `aweme_id` 后选择历史 run。

## 页面布局

页面采用三栏工作台布局。

### 左栏：素材与控制

- 抖音视频 ID。
- 当前 run 选择器。
- 目标时长。
- 画幅选择：`16:9`、`9:16`。
- 风格要求输入框。
- 模式提示：第一版显示“内置高级模式”。
- 主操作按钮：
  - 生成导演策划
  - 生成 HyperFrames 工程
  - 校验工程
  - 渲染视频
  - 抽帧质检

每个按钮请求期间禁用相关操作，并显示明确 loading 文案，例如：

- 正在生成导演策划...
- 正在生成 HyperFrames 工程...
- 正在校验动画工程...
- 正在渲染视频...
- 正在抽帧质检...

### 中栏：导演内容

- 分镜策划预览。
- 旁白稿预览。
- `design.md` 查看和基础编辑。
- 保存修改按钮。
- 重新生成工程按钮。

如果内容为空，显示中文空状态：

```text
暂无导演策划，请先生成导演策划。
```

### 右栏：工程与预览

- 工程文件列表：
  - `index.html`
  - `design.md`
  - `hyperframes.json`
  - `package.json`
- 校验结果：
  - `lint`
  - `validate`
  - `inspect`
- 抽帧联系表。
- 视频预览。
- 下载 `output.mp4`。
- 打开工程目录。

## 后端接口

新增路由前缀：

```text
/api/agents/douyin/:aweme_id/runs/:run_id/hyperframes-freeform
```

接口：

```text
POST /brief
POST /project
POST /check
POST /render
POST /inspect
GET  /files/:file_name
PUT  /files/:file_name
```

### `/brief`

生成导演策划和 `design.md` 草稿。

输入包括：

- `targetDurationSec`
- `aspectRatio`
- `stylePrompt`
- `sourceRunId`

输出写入 run JSON 的 `hyperframes_freeform.brief`。

### `/project`

读取导演策划、skill 上下文和素材摘要，生成工程文件：

- `index.html`
- `design.md`
- `hyperframes.json`
- `package.json`
- `meta.json`

输出写入 `hyperframes_freeform.project`。

### `/check`

在工程目录内执行：

```bash
hyperframes lint
hyperframes validate
hyperframes inspect --samples 12
```

结果写入 `checks/`，并同步到 run JSON。

### `/render`

调用现有 `hyperframesRenderer.renderHyperframesProject` 或其自由工程包装方法，生成 `output.mp4`。

### `/inspect`

对 `output.mp4` 每 0.3 秒抽帧，生成：

```text
inspect/frames/
inspect/contact_sheet.jpg
checks/visual_report.json
```

第一版视觉报告只做确定性检查：

- 视频文件是否存在。
- 视频时长是否大于 3 秒。
- 抽帧是否成功。
- 联系表是否生成。
- 是否出现明显全黑或全白帧。

## 目录结构

自由工程目录独立于现有模板目录：

```text
agent_runs/
  <run_id>-hyperframes-freeform/
    .agents/
      skills/
        hyperframes/
        hyperframes-cli/
        gsap/
    index.html
    design.md
    hyperframes.json
    package.json
    meta.json
    assets/
      narration.wav
    checks/
      lint.txt
      validate.txt
      inspect.txt
      visual_report.json
    inspect/
      frames/
      contact_sheet.jpg
    renders/
      final.mp4
    output.mp4
```

现有模板目录继续使用：

```text
<run_id>-hyperframes/
```

## Skill 读取策略

第一版实现“读取 skill 内容，不原生激活 skill”。

服务启动或生成工程时，从配置中解析 HyperFrames skill 来源。优先级：

1. 用户配置路径。
2. 项目内置路径 `server/resources/hyperframes-skills/`。
3. 最近一次生成目录中的 `.agents/skills/` 快照。

读取内容包括：

- `SKILL.md`
- 直接相关的 `references/`
- 直接相关的 `templates/`
- 直接相关的 `palettes/`

读取后生成精简上下文，传给模型。上下文必须控制长度，禁止一次性塞入整个 skill 目录。

第一版只读取这些主题：

- HyperFrames 工程结构。
- HTML/CSS/GSAP 编写要求。
- seekable animation 要求。
- `lint`、`validate`、`inspect`、`render` 工作流。
- 字幕、构图、转场和 typography 的核心规则。

## Agent 托管模式预留

后续可以新增“Agent 托管模式”：

```text
项目后端 -> 创建临时工作目录 -> 复制 .agents/skills -> 调用 Codex CLI 或 Claude Code -> 等待 Agent 生成工程 -> 项目接管校验和渲染
```

第一版只预留字段：

```json
{
  "hyperframes_freeform": {
    "mode": "builtin_skill_context",
    "agent_runtime": null
  }
}
```

未来可扩展为：

```json
{
  "mode": "agent_managed",
  "agent_runtime": "codex_cli"
}
```

## Run 数据结构

在 run JSON 中新增：

```json
{
  "hyperframes_freeform": {
    "mode": "builtin_skill_context",
    "status": "idle",
    "project_dir": "",
    "brief": {
      "status": "idle",
      "design_path": "",
      "summary": ""
    },
    "project": {
      "status": "idle",
      "index_path": "",
      "files": []
    },
    "checks": {
      "status": "idle",
      "lint": "pending",
      "validate": "pending",
      "inspect": "pending",
      "message": ""
    },
    "render": {
      "status": "idle",
      "output_path": "",
      "output_url": ""
    },
    "visual_inspect": {
      "status": "idle",
      "contact_sheet_path": "",
      "contact_sheet_url": "",
      "issues": []
    }
  }
}
```

状态枚举：

```text
idle
generating
ready
checking
passed
failed
rendering
rendered
inspecting
```

## 服务层拆分

新增：

```text
server/services/hyperframesSkillContext.js
server/services/hyperframesFreeformAgent.js
server/services/hyperframesFreeformProject.js
server/services/hyperframesFreeformQuality.js
```

职责：

- `hyperframesSkillContext.js`：读取和压缩 skill 上下文。
- `hyperframesFreeformAgent.js`：生成导演策划、`design.md` 和工程 HTML。
- `hyperframesFreeformProject.js`：创建目录、写文件、复制 skill 快照、读取工程文件。
- `hyperframesFreeformQuality.js`：运行 check、抽帧、生成视觉报告。

复用：

```text
server/services/hyperframesRenderer.js
server/services/agentRuns.js
```

`agentRuns.js` 只负责路由编排和 run JSON 状态写回，不承载 HTML 生成细节。

## 前端文件

新增：

```text
frontend-react/src/pages/HyperframesStudioPage.jsx
```

如果页面继续增长，再拆：

```text
frontend-react/src/components/hyperframes-studio/StudioSidebar.jsx
frontend-react/src/components/hyperframes-studio/DirectorPanel.jsx
frontend-react/src/components/hyperframes-studio/ProjectPanel.jsx
frontend-react/src/components/hyperframes-studio/RenderPreview.jsx
```

API 方法添加到现有：

```text
frontend-react/src/api/client.js
```

新增方法命名：

```js
generateHyperframesFreeformBrief
generateHyperframesFreeformProject
checkHyperframesFreeformProject
renderHyperframesFreeformProject
inspectHyperframesFreeformVideo
getHyperframesFreeformFile
saveHyperframesFreeformFile
```

## 错误处理

所有失败都返回中文 `message`，并尽量附带可操作原因。

示例：

- 未找到 HyperFrames skill：`未找到 HyperFrames skill，请在设置中配置 skill 目录，或使用项目内置模板。`
- 工程生成失败：`HyperFrames 工程生成失败，请检查模型配置或减少风格要求。`
- 校验失败：`动画工程校验未通过，请查看 lint 和 validate 结果。`
- 渲染失败：`视频渲染失败，请查看 HyperFrames 渲染日志。`
- 抽帧失败：`视频已生成，但抽帧质检失败，请手动预览 output.mp4。`

如果高级模式失败，页面提供：

```text
使用快速模板模式生成
```

## 测试计划

后端测试：

- skill 上下文读取：存在、缺失、路径非法、内容过长。
- 自由工程目录创建和路径安全。
- 工程文件读写白名单。
- `check` 命令成功和失败。
- `render` 成功和失败。
- `inspect` 抽帧成功和失败。
- run JSON 状态写回。

前端测试：

- 新路由可进入页面。
- 没有 `aweme_id` 时显示输入空状态。
- 每个请求期间按钮禁用并显示 loading。
- 接口失败时显示中文错误。
- 有 `output_url` 时展示视频预览。
- 有 `contact_sheet_url` 时展示联系表。

## 实施顺序

第一阶段：

1. 新增设计中的后端数据结构和目录工具。
2. 新增 skill 上下文读取服务。
3. 新增自由工程生成接口。
4. 新增新页面和路由。
5. 接入 check、render 和 inspect。

第二阶段：

1. 增加一次自动修复：把 `lint`、`validate`、`inspect` 错误喂回模型，只修工程文件。
2. 增加联系表视觉质检。
3. 增加工程文件在线保存和重新校验。

第三阶段：

1. 增加 Agent 托管模式。
2. 支持配置 Codex CLI 或 Claude Code runtime。
3. 支持按项目复制 `.agents/skills` 并由外部 Agent 原生使用 skill。

## 验收标准

- 用户可以从导航进入“高级成片”页面。
- 用户可以从 AI 工作台打开某个 run 的高级成片工作台。
- 页面可以生成自由 HyperFrames 工程目录。
- 工程目录包含 `index.html`、`design.md`、`hyperframes.json`、`package.json`。
- 工程目录包含 `.agents/skills` 快照或明确记录 skill 来源。
- 页面可以执行校验并展示中文状态。
- 页面可以渲染 `output.mp4`。
- 页面可以抽帧生成联系表。
- 现有快速模板模式不受影响。
