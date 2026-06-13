# 一键生成视频完成后可编辑设计

## 背景

当前一键创作的核心体验应该保持简单：用户输入主题、文案或视频来源后，系统黑盒完成素材准备、策划、配音、工程生成、校验、渲染和巡检。问题在于当前“生成工程”阶段让 AI 一次性输出完整 HyperFrames 工程文件，容易超时、解析失败或生成不符合 HyperFrames 合约的 HTML，导致大量任务走不到渲染阶段。

新的设计保留首次生成的黑盒体验，但把生成结果沉淀为可编辑的视频工程源数据。用户第一次只看结果；成片完成后，可以进入编辑模式修改字幕、旁白文案和画面文字，再由后端重新生成工程并渲染。

## 目标

- 首次一键生成仍然是黑盒流程，用户不需要理解分镜、帧、HTML 或 HyperFrames。
- 生成完成后支持基础编辑：字幕、旁白文案、画面标题、关键词、卡片文字、场景时长、场景顺序、单场景重写和局部重新 TTS。
- 以结构化 `scene_spec` 作为视频工程源文件，`index.html` 和 `output.mp4` 都是可再生产物。
- 降低“生成工程”阶段的模型输出压力，不再要求 AI 一次性输出完整多文件工程包。
- 为后续升级到类似 `html-video` 的 content graph、分帧预览、局部重试和模板系统保留架构空间。

## 非目标

- 首版不做时间轴拖拽、任意 HTML 编辑或元素级可视化编辑。
- 首版不做新增场景和删除场景，只支持已有场景的顺序调整、时长调整和单场景重写。
- 首版不提供任意 HTML 编辑器。
- 首版不替换现有 HyperFrames 渲染内核，但需要抽象统一的渲染接口，当前实现仍调用现有 HyperFrames CLI。
- 首版不引入 Remotion、Motion Canvas 或其他渲染引擎。

## 核心方案

采用“稳定模式”作为一键创作默认路径：

```text
输入
  -> 来源准备
  -> 导演简报
  -> TTS
  -> AI 生成 scene_spec
  -> 后端确定性生成 HyperFrames 工程
  -> 自动修复/校验
  -> 渲染
  -> 巡检
  -> 可编辑成片
```

`scene_spec` 是首版的工程源数据，包含：

- 视频全局信息：标题、目标时长、比例、风格、语言。
- 场景列表：场景 ID、标题、旁白文本、字幕块、画面文字、关键词、布局意图、动效意图。
- 字幕绑定：字幕文本、开始/结束时间、所属场景。
- 可编辑字段标记：哪些字段允许用户修改，修改后是否需要重新 TTS。

后端根据 `scene_spec` 生成：

- `index.html`
- `meta.json`
- `hyperframes.json`
- `design.md`
- `assets/narration.wav`

其中 `index.html` 由后端模板和确定性代码生成，确保根节点属性、GSAP timeline、字幕元素、clip 边界和字体约束符合 HyperFrames 校验要求。

## 编辑模式

首版编辑模式开放七类操作：

1. 修改字幕文本
   - 更新 `scene_spec.scenes[].captions[]`。
   - 不重新生成导演简报。
   - 不重新 TTS，除非用户选择“同步修改旁白”。
   - 重新生成 HyperFrames 工程并渲染。

2. 修改旁白文案
   - 更新 `scene_spec.scenes[].narration_text`。
   - 重新 TTS。
   - 基于新音频和字幕重新生成工程并渲染。

3. 修改画面文字
   - 更新 `scene_spec.scenes[].visual_text`，例如标题、关键词、步骤标签、卡片文案。
   - 不重新 TTS。
   - 重新生成工程并渲染。

4. 修改场景时长
   - 更新 `scene_spec.scenes[].duration`。
   - 自动重新计算后续场景的 `start`。
   - 不重新 TTS，除非该场景旁白发生变化。
   - 重新生成工程并渲染。

5. 调整场景顺序
   - 调整 `scene_spec.scenes[]` 顺序。
   - 保持每个场景的 ID、旁白、字幕和画面文字不变。
   - 自动重新计算所有场景的 `start`。
   - 不重新 TTS。
   - 重新生成工程并渲染。

6. 单场景重写
   - 只把目标场景、全片上下文摘要和风格约束传给 AI。
   - AI 返回该场景的 `narration_text`、`captions`、`visual_text`、`layout` 和 `motion`。
   - 不重跑全片导演简报。
   - 默认需要重新 TTS 该场景。

7. 局部重新 TTS
   - 只针对被修改或重写的场景重新合成音频。
   - 合成后重新拼接旁白音轨，并更新该场景字幕时间。
   - 其他场景沿用已有音频和字幕。

## 后端组件

### Scene Spec Agent

替代当前“AI 输出完整 files JSON”的工程生成 Agent。它只负责输出结构化 `scene_spec`，不输出 HTML、CSS、JS 或工程文件。

输出要求：

- 只返回 JSON 对象。
- 字段规模受控，避免长 HTML 字符串。
- 每个场景必须有稳定 ID。
- 每个可编辑文本字段必须有明确路径。

### HyperFrames Project Composer

新增后端 composer，根据 `scene_spec` 确定性生成 HyperFrames 工程。

职责：

- 生成标准 `index.html`。
- 写入根合成属性：`data-composition-id`、`data-duration`、`data-width`、`data-height`。
- 注册 `window.__timelines["main"]`。
- 生成字幕层、场景层、画面文字层和元素级 GSAP 动效。
- 禁止生成非确定性动画代码，例如 `performance.now()`、`requestAnimationFrame()`、`setInterval()`。

### Edit Service

新增编辑服务，负责读取和更新 `scene_spec`。

职责：

- 校验编辑路径是否合法。
- 区分“需要重新 TTS”和“只需重渲染”的改动。
- 记录编辑版本。
- 触发重新生成工程、校验和渲染。

### Quality Repair

校验失败时先进行一次自动修复，再决定是否失败。

首版自动修复范围：

- 补齐根节点尺寸和时长属性。
- 补齐 timeline registry。
- 移除或替换明显非确定性脚本。
- 标准化字体别名。
- 标准化 clip 的 `data-start` 和 `data-duration` 小数位。

### Render Adapter

新增统一渲染接口，避免 workflow、编辑服务和工程生成逻辑直接依赖 `npx hyperframes render`、`renders/*.mp4` 或固定 `output.mp4` 目录结构。

首版实现：

- `HyperFramesCliAdapter`
- 内部继续调用现有 HyperFrames CLI。
- 兼容当前工程目录、`output.mp4` 和已有前端播放路径。

接口输入：

- `projectDir`
- `outputPath`
- `fps`
- `duration`
- `audio`
- `onProgress`

接口输出：

- `success`
- `outputPath`
- `stdout`
- `stderr`
- `diagnostics`
- `meta`

后续可以新增：

- `PlaywrightHyperFramesAdapter`：参考 `html-video`，用 headless Chromium 录制 HTML，再通过 ffmpeg 编码。
- `FrameSequenceAdapter`：逐帧渲染，再通过 ffmpeg concat 拼接。
- `RemotionAdapter`：为数据帧或特定模板接入 React/Remotion 渲染。

上层只依赖 `RenderAdapter.render()`，因此后续替换渲染内核时，不需要改一键创作 workflow、编辑服务和前端接口。

## 数据结构草案

```json
{
  "version": 1,
  "title": "视频标题",
  "aspect_ratio": "9:16",
  "target_duration_sec": 60,
  "style": {
    "template": "stable_brutalist",
    "palette": ["#101216", "#fe2c55", "#25f4ee"]
  },
  "scenes": [
    {
      "id": "scene_01",
      "order": 1,
      "start": 0,
      "duration": 8,
      "narration_text": "旁白文案",
      "captions": [
        {
          "id": "cap_01_01",
          "start": 0.2,
          "end": 2.4,
          "text": "字幕文本"
        }
      ],
      "visual_text": {
        "headline": "画面标题",
        "keywords": ["关键词一", "关键词二"],
        "cards": ["卡片文案"]
      },
      "layout": "headline_keywords",
      "motion": "staggered_reveal",
      "editable": {
        "narration_text": true,
        "captions": true,
        "visual_text": true,
        "duration": true,
        "order": true,
        "rewrite_scene": true,
        "local_tts": true
      }
    }
  ]
}
```

## 接口兼容

首版保持现有一键创作接口和阶段语义：

- `source`
- `research`
- `assets`
- `agent_run`
- `brief`
- `audio`
- `project`
- `check`
- `render`
- `inspect`

前端可以继续轮询现有 workflow。后端只改变 `project` 阶段内部实现。

新增编辑接口可以后置实现：

- `GET /api/creative-workflows/:workflow_id/scene-spec`
- `PATCH /api/creative-workflows/:workflow_id/scene-spec`
- `POST /api/creative-workflows/:workflow_id/scenes/:scene_id/rewrite`
- `POST /api/creative-workflows/:workflow_id/scenes/:scene_id/tts`
- `POST /api/creative-workflows/:workflow_id/rerender`

## 前端体验

首版首次生成无需新增前端页面。

成片完成后，在任务详情中增加“编辑成片”入口。编辑页可以先做表单式，不做复杂时间轴：

- 左侧：场景列表。
- 中间：当前场景可编辑字段。
- 右侧：当前渲染视频或场景预览。
- 场景列表支持上移、下移和时长输入，不做自由拖拽时间轴。
- 当前场景提供“重写本场景”和“重新配音本场景”操作。

如果首版希望最小改动，可以先只在现有详情页展示可编辑表单，保存后触发重新渲染。

## 错误处理

- `scene_spec` 生成失败：提示“生成场景规格失败”，允许重试该阶段。
- `scene_spec` 校验失败：展示具体字段错误，允许重新生成规格。
- 编辑旁白后 TTS 失败：保留旧成片，标记编辑版本为未渲染。
- 局部 TTS 失败：保留该场景旧音频，编辑版本不进入可渲染状态。
- 场景顺序或时长非法：拒绝保存，并提示具体场景。
- 单场景重写失败：保留原场景，不影响旧成片。
- 工程校验失败：先自动修复一次；仍失败时展示 lint/validate/inspect 的中文摘要。
- 重新渲染失败：保留上一版可播放视频，不覆盖旧输出。

## 测试策略

- 为 `scene_spec` schema 增加单元测试。
- 为 composer 增加快照或结构测试，确认生成 HTML 包含必要 HyperFrames 合约。
- 为编辑服务增加测试，覆盖字幕、旁白和画面文字三类修改。
- 为场景编排增加测试，覆盖顺序调整、时长调整、起始时间重算和非法时长拒绝。
- 为单场景重写增加测试，确认只更新目标场景。
- 为局部 TTS 增加测试，确认只替换目标场景音频和字幕。
- 为 workflow 增加集成测试，确认一键生成仍走完整阶段。
- 为失败路径增加测试，确认旧视频不会被失败的重渲染覆盖。

## 后续升级路线

第二阶段：

- 新增场景。
- 删除场景。
- 场景级预览。
- 编辑版本对比。

第三阶段：

- 将 `scene_spec` 演进为 `content_graph + frames`。
- 支持分帧预览。
- 支持局部重试。
- 增加模板 manifest。
- 将稳定 composer、AI frame composer 和未来多引擎 adapter 并存。
- 将 `HyperFramesCliAdapter` 替换或并行为 `PlaywrightHyperFramesAdapter`，逐步学习 `html-video` 的完整渲染链路。

## 设计结论

首版应以“一键黑盒生成，完成后可编辑”为产品边界。编辑范围直接覆盖字幕、旁白、画面文字、场景时长、场景顺序、单场景重写和局部重新 TTS，但仍限制在 `scene_spec` 层，不开放任意 HTML 或时间轴编辑。后端先掌握工程结构和 HyperFrames 合约，AI 只输出结构化场景规格或单场景规格。这样能提升一键生成成功率，同时保留后续向 `html-video` 式开放 Studio 架构升级的空间。
