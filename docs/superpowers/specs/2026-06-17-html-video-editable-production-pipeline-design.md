# html-video 可编辑生产链路接入设计

## 背景

当前项目的视频生成质量仍然偏“PPT 化”。最近一次改动把 `D:\code3\html-video` 的部分模板压平成 `server/templates/*/manifest.yaml + source.html`，并在现有 `creative-video` 工作流中加入了 “AI 选模板 -> AI 改完整 HTML -> 包装工程” 的 rich path。但这条路径还不是 `html-video` 的生产核心链路。

主要问题有四类：

- 生成结果不是稳定的可编辑工程。当前前端已有“编辑成片”入口，但新工作流里的 `rerenderCreativeVideoProject()` 和 `applyCreativeVideoEdit()` 仍是空壳，生成后缺少可追踪、可重渲、可局部编辑的工程源数据。
- AI 权限过大。当前 rich path 让 AI 直接返回完整 HTML，容易留下空 timeline、CSS 动画和 HyperFrames 根合成结构错误，系统只做弱校验。
- 只借用了模板外观，没有接入 `html-video` 的模板协议、project/frame 模型、Playwright + Chromium + ffmpeg 渲染技术、逐帧拼接和二次编辑模型。
- 当前 MP4 输出仍主要依赖 `npx hyperframes render` 路径，不能复用 `html-video` 对字体加载、动画起点、录屏裁剪、显式时长补齐和 ffmpeg 编码的控制能力。

因此，本设计不继续修补半成品 rich path，而是接入 `html-video` 的生产核心链路，并把输出物升级为“可编辑视频工程”，让一键生成后的编辑、重渲和版本追踪成为主流程的一部分。

## 目标

- 接入 `html-video` 的生产核心链路，而不是只复制模板文件。
- AI 继续拥有模板选择权，但不再直接生成或改写完整 HTML。
- AI 输出结构化 JSON：`scene_spec`、`template_id`、`template_inputs` 和可选的 `edit_patch`。
- 系统根据模板协议和 inputs 确定性生成 HTML/frame HTML。
- MP4 输出接入 `html-video` 的 Playwright + Chromium 录制和 ffmpeg 编码技术。
- 生成完成后保存可编辑工程，支持模板字段、帧字段、旁白、字幕、时长和基础模板替换的二次编辑。
- 编辑后可重新 materialize HTML、重渲 MP4，并保留 revisions/exports。
- 为拖拽时间线、毫秒级剪辑、源码编辑、元素级拖拽、复杂转场和 Remotion native enhancement 预留数据结构和 service 边界。
- 保留当前项目已有的业务入口、任务系统、TTS、混音、视觉 QA 和前端工作台体验。

## 非目标

- 不把 `D:\code3\html-video` 整个仓库完整搬进当前项目。
- 不接入 `html-video` 的 studio UI、CLI 命令体系、runtime agent 管理和研究文档作为当前项目的生产依赖。
- 首版不做 Premiere 式编辑器。
- 首版不开放普通用户直接编辑 HTML 源码。
- 首版不做元素级可视化拖拽。
- 首版不做复杂时间线拖拽和毫秒级剪辑。
- 首版不完整接入 Remotion native frame enhancement，但必须保留接口和 schema 空间。

## 核心原则

### AI 做导演和填表

AI 负责内容理解、模板选择、模板字段压缩和自然语言编辑意图解析：

```text
creativeContext
  -> scene_spec
  -> template_id
  -> template_inputs
  -> edit_patch
```

AI 不负责：

- 写最终 `index.html`
- 写 GSAP timeline
- 修改模板源码
- 拼接工程目录
- 决定 ffmpeg 参数
- 直接覆盖成片工程文件

### 模板负责视觉质量

模板使用 `html-video` 原生 `template.html-video.yaml` 协议，不再使用当前压缩后的弱 manifest 作为生产协议。模板必须保留：

- `engine`
- `engine_version`
- `source_entry`
- `output.resolution`
- `output.fps`
- `output.duration`
- `inputs.schema`
- `inputs.examples`
- `preview`
- `license`
- `assets_attribution`
- `__dir`

### 引擎负责确定性生产

系统负责把 `template_inputs` materialize 成 HTML/frame HTML，再用 Playwright/Chromium/ffmpeg 输出 MP4。生成后所有产物都可由 project schema 重新生产。

### JS 行为移植，不引入 TS monorepo 运行时依赖

首版采用“行为移植 + JS 本地实现”策略：

- 不把 `D:\code3\html-video` 的 TypeScript monorepo 作为当前项目运行时 workspace 依赖。
- 不要求当前项目启动、部署或测试时依赖 `html-video` 的 pnpm workspace、TS 编译产物或 ESM/CJS 互操作。
- 在当前项目内用 CommonJS/JavaScript 实现生产核心模块。
- 以 `html-video` 的 content graph、Project/FrameRecord、Playwright adapter、ffmpeg composer 为行为基准，不重新设计这些已验证过的技术逻辑。
- `contentGraph` 的 validate/topoSort/totalDuration、Playwright 渲染中的字体/动画/lead-in 处理、ffmpeg concat/mux 策略必须高保真移植。
- 长期如果 `html-video` 稳定发布为可独立消费的 npm 包，再评估替换为包依赖。

这意味着首版不是“重新发明一套视频引擎”，而是把 `html-video` 已经踩坑验证过的核心行为移植成当前项目可维护、可测试、可中文诊断的 JS service。

移植验证策略：

- 算法级对齐：`contentGraph.topoSort()` 必须使用与 `html-video/packages/content-graph/src/index.ts` 等价的 Kahn 拓扑排序；dependency edge 决定硬顺序，sequence edge 只作为 ready 队列中的软排序偏好；平局保持原始 node 数组顺序。
- 行为测试迁移：从 `html-video` content-graph 行为中抽取空 graph、重复 node id、unknown edge、自环、dependency cycle、单节点、多依赖、sequence tie-break、totalDuration 默认值等测试用例，移植到当前项目测试。
- 渲染时序对齐：JS 版 Playwright adapter 的代码注释必须逐段标明对应 `html-video/packages/adapter-hyperframes/src/render.ts` 中的关键步骤，包括 `page.addInitScript()` 冻结动画、等待 stylesheet、逐个 `fonts.load()`、等待 `fonts.ready`、释放动画、记录 `leadInMs`、ffmpeg `-ss` 裁剪 dead lead-in、显式 duration 使用 `tpad` 补齐尾帧。
- ffmpeg 行为对齐：concat demuxer、concat filter、音频 mux 的参数必须有 golden command 测试，避免未来实现时悄悄改掉编码参数、PTS 处理或 `-shortest` 行为。
- 关键差异显式记录：凡是当前项目因 JS/CommonJS、中文错误、workflow 目录或 TTS 集成而偏离 `html-video` 原实现的地方，必须在代码注释和测试名中说明原因。

### 变量化模板是本项目新增生产策略

`html-video` 现有 studio 流程支持 Agent 直接写完整 frame HTML，例如 `writeFrameHtml(projectId, graphNodeId, html)` 和 `writePreviewHtmlRaw(projectId, html)`。本项目默认生产路径不采用这种方式，因为它会削弱生成后的表单编辑、字段校验和可追踪重渲能力。

本项目首版默认采用：

```text
AI 选择 template_id
  -> AI 填 template_inputs JSON
  -> 系统 materialize HTML/frame HTML
```

`window.__HV_VARS__` / `template_inputs` 是为了“生成后可编辑、可校验、可重渲”引入的项目策略，不应被描述为 `html-video` 当前 agent 写 HTML 流程的原样照搬。raw HTML 和 frame HTML 写入能力仍作为高级 override 与兼容口保留。

## 总体流程

```text
用户输入 / 素材 / 评论 / 文案
  -> creativeContext
  -> AI 生成 scene_spec
  -> scene_spec 映射为 contentGraph
  -> html-video template registry 返回候选模板 compact index
  -> AI 选择 template_id
  -> 系统校验模板能力
  -> AI 根据 inputs.schema 填 template_inputs
  -> 系统创建 HtmlVideoProject
  -> materialize template/frame HTML
  -> Playwright + Chromium 渲染 HTML 为 webm
  -> ffmpeg 编码 mp4
  -> 多帧时 ffmpeg concat
  -> 当前项目 TTS / 混音
  -> 当前项目 visual QA
  -> 保存 revision/export
  -> 用户可点击“编辑成片”
```

## IR 分层

首版不把 `scene_spec` 直接等同于 `html-video` 的最终 IR。两者职责不同：

```text
scene_spec
  当前项目业务层 IR，承载场景、旁白、字幕、视觉文案、TTS 和现有编辑器兼容。

contentGraph
  html-video 工程层 IR，承载节点、边、帧顺序、依赖关系、对比关系和每帧时长。

frames[]
  可 materialize、可预览、可渲染、可重渲的具体帧记录。
```

映射规则：

```text
scene_spec.scenes[]       -> contentGraph.nodes[]
scene.order/start         -> sequence edges 或 topoSort 初始顺序
scene.duration            -> node.durationSec
scene.kind                -> node.kind / frameIntent
scene.visual_text.headline -> TextNode.text 或 frame inputs
scene.visual_text.cards   -> DataNode.data 或 frame inputs
scene.narration_text      -> project.audio / narrationByFrame / frame metadata
scene.captions            -> frame captions inputs
```

`contentGraph` 类型应复用 `html-video/packages/content-graph/src/index.ts` 的语义：

```text
Node.kind: entity | data | text
Edge.kind: sequence | dependency | contrast
validate(graph)
topoSort(graph)
totalDurationSec(graph)
```

首版可以先从 `scene_spec.scenes[]` 生成线性 `sequence` graph；后续再让 AI 直接输出更丰富的 `contentGraph`。

### scene_spec schema

`scene_spec` 是当前项目已有业务 IR，schema 以 [server/services/creative-video/sceneSpecService.js](../../../server/services/creative-video/sceneSpecService.js) 的 `normalizeSceneSpec()`、`validateSceneSpec()` 和 `applySceneEdit()` 为准。

首版字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | number | 默认 `1`。 |
| `title` | string | 视频标题。 |
| `aspect_ratio` | string | 默认 `16:9`。 |
| `target_duration_sec` | number | 全片目标时长，normalize 后按场景时长汇总。 |
| `scenes[]` | array | 场景列表，不能为空。 |
| `scenes[].id` | string | 场景稳定 ID，缺省时生成 `scene_01`。 |
| `scenes[].order` | number | 场景顺序，normalize 后重排。 |
| `scenes[].start` | number | 场景起点，normalize 后按顺序重算。 |
| `scenes[].duration` | number | 场景时长，必须大于 0。 |
| `scenes[].kind` | enum | 由 `specEnums.KINDS` 约束：`text`、`data`、`quote`、`steps`、`comparison`、`cta`。 |
| `scenes[].narration_text` | string | 旁白文本，编辑后需要重新 TTS 和重渲。 |
| `scenes[].captions[]` | array | 字幕块，必须落在场景时长范围内。 |
| `scenes[].captions[].id` | string | 字幕 ID。 |
| `scenes[].captions[].start` | number | 字幕相对场景起点。 |
| `scenes[].captions[].end` | number | 字幕结束时间，不能早于 start。 |
| `scenes[].captions[].text` | string | 字幕文本。 |
| `scenes[].visual_text.headline` | string | 画面主标题。 |
| `scenes[].visual_text.keywords[]` | string[] | 关键词。 |
| `scenes[].visual_text.cards[]` | string[] | 卡片文案。 |

`scene_spec.visual_text` 禁止包含“背景、光效、动画、转场、镜头、布局、粒子”等制作说明。这类信息应由模板能力、template inputs 或后续 frame 层处理，避免把制作指令混入观众可见文案。

## 模块设计

新增服务目录：

```text
server/services/creative-video/html-video/
  index.js
  templateRegistry.js
  templateManifestService.js
  templateSelectorAgent.js
  templateInputAgent.js
  htmlVideoWorkflow.js
  projectSchema.js
  projectStore.js
  projectOrchestrator.js
  materializer.js
  hyperframesPlaywrightAdapter.js
  frameRenderer.js
  ffmpegComposer.js
  assetStore.js
  validationGate.js
  editPatchService.js
```

### contentGraph

职责：

- 将 `html-video/packages/content-graph` 的核心行为移植为 JS。
- 提供 `validate(graph)`、`topoSort(graph)`、`totalDurationSec(graph)`。
- 支持 `entity`、`data`、`text` 三类节点和 `sequence`、`dependency`、`contrast` 三类边。
- 作为 `scene_spec` 到 `frames[]` 的工程 IR。

首版可先支持线性 graph，但实现上必须保留 dependency cycle 检测和 sequence tie-break 规则，避免后续多节点依赖排序时重做底层模型。

### htmlVideoWorkflow

职责：

- 作为 `workflowFacade` 调用 html-video 生产链路的单一入口。
- 编排 `templateSelectorAgent`、`templateInputAgent`、`projectOrchestrator`、`validationGate` 和 render/export。
- 负责把当前项目的 workflowId/runId/rootDir/creativeContext 转换成 `HtmlVideoProject` 创建参数。
- 不直接写底层文件，不直接执行 Playwright/ffmpeg；这些由 `projectOrchestrator` 和 adapter 负责。

关系：

```text
workflowFacade
  -> htmlVideoWorkflow.generateProject()
  -> htmlVideoWorkflow.renderOrExport()
  -> projectOrchestrator.createProject()
  -> materializer / render adapter / ffmpeg composer
```

`projectOrchestrator` 是工程生命周期编排器；`htmlVideoWorkflow` 是当前业务工作流适配层。

### templateRegistry

职责：

- 扫描 `html-video` 风格模板目录。
- 读取 `template.html-video.yaml`。
- 使用标准 YAML parser，不再维护手写 YAML parser。
- 保存模板 `__dir`。
- 提供完整 manifest 和 AI 选择用 compact index。
- 根据 license、engine、aspect、duration 和 source_entry 过滤 production-ready 模板。

接口：

```js
scanTemplates(rootDir)
listTemplates()
getTemplate(templateId)
hasTemplate(templateId)
buildCompactIndex({ aspectRatio, durationSec, engines, licenseAllow, commercialOnly })
validateTemplateCompatibility(template, target)
```

首版 template engine 支持范围：

- production-ready 默认只接受 `engine: hyperframes`。
- `source_entry` 必须指向 HTML 文件，例如 `source/index.html`。
- `engine: remotion` 且 `source_entry` 指向 `source/entry.ts` / `source/entry.tsx` 的原生模板暂不进入 AI 默认候选。
- Remotion 模板只作为后续 `frame.enhancement` 的预留能力，需 feature flag 显式开启。

license 过滤：

- 默认只选择 `license.commercial_use === true` 的模板。
- 如果 `license.attribution_required === true`，导出记录必须保存 attribution metadata，前端或导出报告要能展示。
- AI compact index 不应包含被 license 策略屏蔽的模板。

engine 映射：

| 当前项目内部 engine | html-video 模板 engine | 说明 |
| --- | --- | --- |
| `hyperframes-playwright` | `hyperframes` | 首版默认渲染 engine，使用 Playwright/Chromium/ffmpeg JS adapter。 |
| `remotion-native` | `remotion` | 后续 Remotion native enhancement 使用，首版不进默认候选。 |

模板 manifest 中的 `engine: hyperframes` 不应直接与 project 内部的 `engine: hyperframes-playwright` 做字符串相等判断，必须通过映射层比较。

### templateSelectorAgent

职责：

- 基于 `scene_spec`、目标比例、目标时长、模板 compact index，让 AI 选择模板。
- 只接受 JSON。
- 系统验证 `template_id` 存在且能力匹配。

AI 输出：

```json
{
  "template_id": "frame-glitch-title",
  "reason": "内容偏科技感和冲突感，适合故障风标题模板",
  "confidence": 0.86
}
```

### templateInputAgent

职责：

- 根据模板 `inputs.schema`、`scene_spec` 和素材上下文填 `template_inputs`。
- 只接受 JSON。
- 使用 JSON Schema 校验必填字段、类型、长度、枚举和数值范围。

AI 输出示例：

```json
{
  "title": "信号失控",
  "subtitle": "评论区正在重塑品牌传播",
  "duration_sec": 6
}
```

### materializer

职责：

- 把 `template_inputs` 写入模板。
- 生成可打开、可录制、可重渲的 HTML/frame HTML。
- 生成稳定元素标记，为后续元素级编辑预留接口。

首版支持两种 materialize 策略：

1. 变量注入式，优先用于新适配模板：

```html
<script>
window.__HV_VARS__ = {"title":"信号失控","subtitle":"评论区正在重塑品牌传播"};
window.__HV_DURATION__ = 6;
</script>
```

模板源码读取 `window.__HV_VARS__` 并填充 DOM。

2. 兼容替换式，用于迁移静态 HTML 模板：

```text
{{title}}
{{subtitle}}
{{duration_sec}}
```

或者 manifest 中定义 selector 映射后由服务端替换节点文本。

首版不要求所有旧模板立刻变成完美变量模板，但至少要选 1-2 个模板做成标准样板。

变量模板改造指南：

- 在 `source/index.html` 中保留可独立预览的默认文案；当 `window.__HV_VARS__` 未定义时使用默认值。
- 在 `<script>` 中读取 `const vars = window.__HV_VARS__ || {};`，只把 schema 允许字段写入 DOM。
- 使用 `window.__HV_DURATION__` 或 `vars.duration_sec` 控制总时长、CSS 动画时长或 GSAP timeline duration；如果缺失则使用模板默认 duration。
- 文本写入必须使用 `textContent` 或等价安全方式，避免把 AI 文案当 HTML 注入。
- 关键元素添加 `data-hv-element-id`，命名使用小写 snake/kebab 可读 ID，例如 `headline`、`subtitle`、`primary-stat`。
- 字段绑定添加 `data-hv-bind`，值必须对应 `inputs.schema.properties` 的字段名，例如 `title`、`subtitle`、`items[0].label`。
- 如果模板有多处同字段镜像，例如 glitch RGB 分层标题，所有镜像节点都应带同一 `data-hv-bind`，并由同一变量同步更新。
- 模板应暴露明确的 duration 常量或函数，方便 materializer 和 adapter 校验时长。

materializer 输出关键元素时必须尽量添加稳定绑定标记：

```html
<h1 data-hv-element-id="headline" data-hv-bind="title">信号失控</h1>
<p data-hv-element-id="subtitle" data-hv-bind="subtitle">评论区正在重塑品牌传播</p>
```

这为后续元素级拖拽、元素样式 patch 和局部文本编辑预留锚点。

### hyperframesPlaywrightAdapter

职责：

- 复用 `html-video/packages/adapter-hyperframes/src/render.ts` 的核心技术，落地为当前项目可调用的 JS adapter。
- 启动 Playwright Chromium。
- 固定 viewport 和录制尺寸。
- `recordVideo` 输出 webm。
- `file://` 加载 HTML。
- 渲染前执行 `prepareSourceHtml()` 行为，处理 `data-composition-src` 组合模板。
- 在页面解析前冻结 CSS/SMIL 动画。
- 等待 DOM、stylesheet 和字体加载。
- 探测 CSS animation / GSAP timeline 时长。
- 在录制起点释放动画或播放 `window.__hvPlayAll()`。
- 裁剪页面加载和字体等待造成的 dead lead-in。
- 对显式时长使用 `tpad` 补齐尾帧并用 `-t` 精准裁剪。
- ffmpeg 输出 MP4。

编码参数首版沿用 `html-video`：

```text
ffmpeg
  -c:v libx264
  -pix_fmt yuv420p
  -preset medium
  -crf 20
  -movflags +faststart
```

关键区别：

- 当前 `npx hyperframes render` 路径要求强依赖可 scrub 的 `window.__timelines["main"]`。
- `html-video` Playwright 录制路径允许 CSS animation 和 GSAP 真实播放，但必须控制页面加载、字体、动画起点和录制时长。

因此首版要把 Playwright adapter 作为新 html-video engine 默认渲染路径，而不是继续让新模板默认走旧 HyperFrames CLI。

`prepareSourceHtml()` 行为：

- 单文件模板直接加载 `source_entry`。
- 如果 HTML 中存在 `data-composition-src="compositions/x.html"`，Node 侧读取对应 composition 文件。
- 将 composition 文件内容内联到 `window.__COMPOSITIONS__`。
- 注入播放器脚本，把 `<template>` 内容挂载到 placeholder，并重新执行 composition script。
- 暴露 `window.__hvPlayAll()`，让 renderer 在字体和资源准备后统一播放所有 paused timeline。
- 写出临时 `.hv-render-*.html` 文件供 Chromium 通过 `file://` 加载，渲染后清理。

首版 production-ready 模板可以优先选择单文件模板，但 adapter 需要保留 `prepareSourceHtml()` 能力，避免第二批组合模板接入时重写渲染层。

### ffmpegComposer

职责：

- 单帧：webm -> mp4。
- 多帧：每帧 HTML -> frame mp4 -> concat。
- 音频：对接当前项目 TTS 后的音频 manifest，必要时吸收 `html-video` 的 mix filter graph。

多帧拼接策略：

```text
同一 engine、统一编码参数:
  ffmpeg concat demuxer + -c copy

混合 engine 或编码参数不一致:
  concat filter + libx264 re-encode
```

混合 engine 不能直接使用 concat demuxer 的原因必须写进代码注释和测试：HyperFrames/Playwright 与 Remotion 段可能带不同 h264 参数、timebase 或 PTS。concat demuxer 假设各段时间戳连续且兼容，可能错误累加 PTS，导致短视频时长膨胀，例如 8 秒片段被拼成 35 秒。混合 engine 或编码参数不一致时必须使用 concat filter 重建时间线并重新编码。

首版如果只支持 Playwright/HyperFrames engine，可固定统一编码参数，优先使用 concat demuxer。

### validationGate

职责：

- 生成前校验模板能力。
- AI 输出后校验 JSON Schema。
- materialize 后校验 HTML 结构。
- 渲染前校验资源和时长。
- 渲染后调用当前项目 visual QA。

校验项：

- 模板存在。
- engine 可用。
- aspect ratio 支持。
- duration 在模板范围内。
- `source_entry` 存在。
- `template_inputs` 满足 schema。
- HTML 可打开。
- 没有未处理的远程脚本。
- 字体外链有明确处理策略。
- 检测 `fonts.googleapis.com`、`fonts.gstatic.com` 和 `@import` 字体外链。
- 检测模板使用的 `font-family` 是否缺少本地 `@font-face` 或明确 fallback。
- 检测 `preview.poster` 是否存在于本地模板目录。
- 记录 FOUT/字体闪烁风险 warning。
- 输出 MP4 存在且时长可读。
- 视觉 QA 没有空白、纯文字白底、低变化等严重问题。

### diagnostics

所有阶段失败都返回结构化 diagnostics，避免只把 stderr 原样抛给前端：

```json
{
  "code": "template_schema_invalid",
  "stage": "template_input_validation",
  "message": "模板字段校验失败",
  "user_message": "模板字段不符合要求，已尝试重新生成。",
  "details": {
    "template_id": "frame-glitch-title",
    "errors": [
      { "path": "/title", "message": "字段超过最大长度 80" }
    ]
  },
  "fallback_allowed": true
}
```

首版错误码：

```text
template_not_found
template_engine_unsupported
template_license_blocked
template_schema_invalid
ai_json_parse_failed
content_graph_invalid
materialize_failed
source_entry_missing
prepare_source_failed
playwright_missing
ffmpeg_missing
render_failed
concat_failed
mux_failed
visual_qa_failed
fallback_to_legacy
```

前端展示 `user_message`；后端日志保存 `details`、stderr、stdout、workflowId、runId 和 projectId。

### visual QA

新链路渲染后继续调用当前项目视觉 QA，但首版需要固定至少以下检查项：

- 空白帧：抽样帧中纯白、纯黑或近似单色帧比例超过阈值时失败；首帧连续空白超过 0.5 秒时失败。
- CSS/字体失效迹象：检测明显白底黑字、默认 Times/Arial 风格大段文字、布局未加载导致的左上角堆叠。
- 动画未运行：抽样帧之间像素差异低于阈值且模板声明了动画时，返回 warning 或失败。
- 时长偏差：输出 MP4 时长与 `duration_target_sec` 或 frames 汇总时长偏差超过 0.5 秒或 5% 时失败。
- 分辨率偏差：输出视频分辨率必须等于 project preferences 中的 width/height。
- 内容可见性：主要文本区域不可全被裁切，联系表中至少能看到 headline 或核心视觉元素。

这些检查项的阈值应在 `validationGate` 或 `visualQaService` 中集中配置，失败时返回结构化 diagnostics。

## 可编辑工程模型

新增 `HtmlVideoProject`，保存到当前 workflow/run 的工程目录内。它不是用户直接感知的新产品，而是当前“编辑成片”和重渲的源数据。

首版存储路径：

```text
{rootDir}/
  {workflowId}/
    agent_runs/
      {runId}-html-video/
        html-video-project.json
        content-graph.json
        template-inputs.json
        scene_spec.json
        frames/
          01-{frameId}.html
          01-{frameId}.mp4
          01-{frameId}.preview.mp4
        assets/
        overrides/
          {frameId}.html
        checks/
        exports/
          output-{timestamp}.mp4
        output.mp4
```

说明：

- 继续沿用当前项目 `{rootDir}/{workflowId}/agent_runs/` 目录习惯。
- 新链路目录后缀使用 `-html-video`，与现有 `-hyperframes-lite`、`-hyperframes-freeform` 区分。
- `html-video-project.json` 是可编辑工程主文件。
- `output.mp4` 是最新导出的稳定别名，`exports/` 保留历史版本。
- 写入时应采用临时目录 + rename 策略，避免渲染中断留下半成品主工程。

示例：

```json
{
  "schema_version": 1,
  "project_id": "hv_abc123",
  "workflow_id": "wf_001",
  "run_id": "run_001",
  "template_id": "frame-glitch-title",
  "engine": "hyperframes-playwright",
  "source_mode": "template_inputs",
  "preferences": {
    "aspect_ratio": "16:9",
    "resolution": { "width": 1920, "height": 1080 },
    "fps": 60,
    "duration_target_sec": 6,
    "language": "zh-CN"
  },
  "scene_spec": {},
  "template_inputs": {
    "title": "信号失控",
    "subtitle": "评论区正在重塑品牌传播",
    "duration_sec": 6
  },
  "content_graph": null,
  "frames": [
    {
      "id": "intro",
      "graph_node_id": "intro",
      "order": 0,
      "template_id": "frame-glitch-title",
      "engine": "hyperframes-playwright",
      "html_path": "frames/01-intro.html",
      "mp4_path": "frames/01-intro.mp4",
      "preview_mp4_path": null,
      "duration_sec": 6,
      "inputs": {
        "title": "信号失控",
        "subtitle": "评论区正在重塑品牌传播"
      },
      "transition_in": { "type": "cut", "duration_sec": 0, "params": {} },
      "transition_out": { "type": "cut", "duration_sec": 0, "params": {} },
      "trim": { "in_sec": 0, "out_sec": null },
      "speed": 1,
      "loop": false,
      "enhancement": {
        "enabled": false,
        "engine": null,
        "template_id": null,
        "data": null,
        "preview_mp4_path": null
      }
    }
  ],
  "timeline": {
    "tracks": [
      {
        "id": "main",
        "type": "video",
        "items": [
          {
            "id": "item_intro",
    "kind": "frame",
            "frame_id": "intro",
            "start_sec": 0,
            "duration_sec": 6,
            "locked": false
          }
        ]
      },
      { "id": "voice", "type": "audio", "items": [] },
      { "id": "music", "type": "audio", "items": [] }
    ]
  },
  "assets": [],
  "audio": {
    "tts_manifest_path": null,
    "narration_path": null,
    "music_path": null,
    "mix": {
      "music_volume_db": -18,
      "narration_volume_db": 0,
      "fade_in_sec": 0,
      "fade_out_sec": 1.5
    }
  },
  "overrides": {
    "html": {
      "enabled": false,
      "frames": {}
    },
    "elements": {},
    "transitions": {}
  },
  "revisions": [
    {
      "id": "rev_001",
      "created_at": "2026-06-17T00:00:00.000Z",
      "changed_by": "ai",
      "reason": "首次生成",
      "summary": "AI 选择模板并填写模板字段",
      "requires_tts": true,
      "requires_render": true
    }
  ],
  "exports": [
    {
      "id": "export_001",
      "path": "exports/output-2026-06-17_00-00-00.mp4",
      "created_at": "2026-06-17T00:00:00.000Z",
      "reason": "首次生成",
      "source_revision_id": "rev_001"
    }
  ],
  "status": "rendered"
}
```

`preferences.language` 使用 BCP 47 语言标签；示例值 `zh-CN` 表示简体中文/中国地区，保留语言小写、地区大写的标准写法。

`frames[].enhancement.data` 是源 DataNode 的数据快照。后续启用 Remotion native enhancement 时，导出阶段必须使用这个快照作为 native template 的 input props / `variables.data`，让导出自包含，不依赖重新读取或重新计算 `contentGraph`。

`timeline.tracks[].items[].kind` 首版只支持：

```text
frame
```

后续可扩展：

```text
clip
image
video
audio
caption
overlay
```

首版如果遇到非 `frame` item，应返回 `timeline_item_kind_unsupported` diagnostics，不应静默忽略。

### Asset schema

`assets[]` 首版可以为空，但 schema 需要先固定，方便后续接入图片、视频、音频、数据文件和模板本地资源：

本工程 JSON schema 字段统一使用 snake_case，与 `template_id`、`source_mode`、`duration_target_sec` 等字段保持一致。

```json
{
  "id": "asset_001",
  "type": "image",
  "path": "assets/cover.png",
  "source": "uploaded",
  "mime_type": "image/png",
  "size_bytes": 12345,
  "metadata": {
    "filename": "cover.png",
    "width": 1080,
    "height": 1080,
    "duration_sec": null,
    "user_caption": "封面图"
  },
  "usage": [
    {
      "frame_id": "intro",
      "role": "background"
    }
  ],
  "license": {
    "spdx": null,
    "attribution_required": false,
    "source_url": null
  }
}
```

字段约束：

- `type` 首版枚举：`image`、`video`、`audio`、`data`、`text`、`template-asset`。
- `path` 必须是 project 目录内相对路径，禁止 `..` 和绝对路径。
- `source` 首版枚举：`uploaded`、`generated`、`template`、`external-cached`。
- `metadata.filename` 是用户上传或模板原始文件名，用于展示和审计；不能简单等同于 `path` 的 basename，因为 `path` 可能是去重、脱敏或转码后的工程内路径。
- 首版如果没有素材输入，可保留 `assets: []`，但 projectStore 和 validationGate 必须能读写该字段。

## 与 html-video 类型对齐

| 当前设计字段 | html-video 对应 | 说明 |
| --- | --- | --- |
| `HtmlVideoProject.template_id` | `Project.templateId` | 当前项目命名更贴近 workflow。 |
| `HtmlVideoProject.template_inputs` | `Project.variables` | 本项目将 variables 作为可编辑表单输入。 |
| `HtmlVideoProject.content_graph` | `Project.contentGraphPath` + content graph JSON | 首版可内嵌保存，同时允许落盘为 `content-graph.json`。 |
| `HtmlVideoProject.frames[]` | `Project.frames: FrameRecord[]` | 基本对齐。 |
| `frames[].html_path` | `FrameRecord.htmlPath` | 具体 frame HTML 路径。 |
| `frames[].duration_sec` | `FrameRecord.durationSec` | 导出时的显式帧时长。 |
| `frames[].order` | `FrameRecord.order` | topoSort 后的播放顺序。 |
| `frames[].engine` | `FrameRecord.engine` | 首版默认 `hyperframes-playwright`，后续可映射为 `hyperframes` / `remotion`。 |
| `frames[].enhancement.template_id` | `FrameRecord.nativeTemplateId` | 嵌套封装，便于当前项目扩展。 |
| `frames[].enhancement.data` | `FrameRecord.data` | 源 DataNode 数据快照，导出自包含。 |
| `frames[].enhancement.preview_mp4_path` | `FrameRecord.previewMp4Path` | 单帧增强预览视频。 |
| `audio` | `Project.soundtrack` | 当前项目还要记录 TTS manifest 和旁白分段。 |
| `exports[]` | `Project.exports[]` | 导出历史，避免覆盖旧成片。 |
| `overrides.html` | `writePreviewHtmlRaw()` / `writeFrameHtml()` | 高级 HTML override 入口。 |

## 二次编辑设计

### 用户可见编辑能力

首版开放：

- 修改模板全局字段。
- 修改单帧字段。
- 修改字幕。
- 修改旁白。
- 修改帧时长。
- 替换单帧模板，限兼容 schema 的模板。
- 全片重渲。
- 单帧预览重渲，若当前视频是多帧。
- 查看导出版本。

### 自然语言编辑

用户可以输入：

```text
把标题改得更狠一点
第二帧数据更突出
整体节奏快一点
换成更科技感的模板
```

AI 输出 `edit_patch`，不直接改 HTML：

```json
{
  "edit_type": "frame_inputs_patch",
  "frame_id": "intro",
  "patch": {
    "title": "信号已失控",
    "subtitle": "评论区正在改写品牌叙事"
  },
  "requires_tts": false,
  "requires_render": true
}
```

旁白编辑示例：

```json
{
  "edit_type": "narration_patch",
  "frame_id": "intro",
  "text": "真正影响品牌传播的，不是广告，而是评论区。",
  "requires_tts": true,
  "requires_render": true
}
```

### 编辑服务

`editPatchService` 负责：

- 校验 patch 类型。
- 校验目标 frame/template/input 是否存在。
- 应用 patch 到 project schema。
- 创建 revision。
- 标记 `requires_tts` / `requires_render`。
- 触发 materialize 和 render。

接口：

```js
applyTemplateInputsPatch(project, patch)
applyFrameInputsPatch(project, frameId, patch)
applyNarrationPatch(project, frameId, text)
applyCaptionPatch(project, frameId, captionPatch)
replaceFrameTemplate(project, frameId, templateId, inputs)
createRevision(project, change)
```

## 后置能力预留

首版不做高级编辑 UI，但必须保留字段、接口和 service 边界。

### 拖拽时间线

预留 `timeline.tracks[]`。首版仍按 `frames[].order + duration_sec` 导出，后续拖拽时间线时改 `timeline.tracks[].items[].start_sec` 和 `duration_sec`。

### 毫秒级剪辑

预留：

```json
{
  "trim": { "in_sec": 0, "out_sec": null },
  "speed": 1,
  "loop": false
}
```

首版不消费这些字段。

### HTML 源码编辑

预留：

```json
{
  "overrides": {
    "html": {
      "enabled": false,
      "frames": {
        "intro": {
          "html_path": "overrides/intro.html",
          "base_frame_html_path": "frames/01-intro.html",
          "updated_at": "2026-06-17T00:00:00.000Z",
          "reason": "用户手动编辑 HTML"
        }
      }
    }
  }
}
```

普通用户首版不开放源码编辑。后续启用后，进入 HTML override 的 frame 应明确标记，不再被纯 template inputs 覆盖。

### 元素级拖拽

materializer 输出关键元素时添加稳定标记：

```html
<h1 data-hv-element-id="headline" data-hv-bind="title">信号失控</h1>
<p data-hv-element-id="subtitle" data-hv-bind="subtitle">评论区正在重塑品牌传播</p>
```

预留：

```json
{
  "overrides": {
    "elements": {
      "intro": {
        "headline": {
          "x": null,
          "y": null,
          "scale": null,
          "opacity": null,
          "style_patch": {}
        }
      }
    }
  }
}
```

### 复杂转场

首版默认 `cut`，但 frame schema 保留：

```json
{
  "transition_in": { "type": "cut", "duration_sec": 0, "params": {} },
  "transition_out": { "type": "cut", "duration_sec": 0, "params": {} }
}
```

后续扩展 `fade`、`slide`、`wipe`、`shader`、`match-cut`、`motion-blur`。

### Remotion native frame enhancement

预留：

```json
{
  "enhancement": {
    "enabled": false,
    "engine": null,
    "template_id": null,
    "data": null,
    "preview_mp4_path": null
  }
}
```

这与 `html-video` 的 `enhanceFrameNative()` / `unenhanceFrame()` / `renderFrameNativePreview()` 对齐。首版不开放操作面板。

## API 设计

在当前 creative workflow 下新增 html-video project API：

```text
GET    /api/creative-workflows/:workflowId/html-video-project
PATCH  /api/creative-workflows/:workflowId/html-video-project/inputs
PATCH  /api/creative-workflows/:workflowId/html-video-project/frames/:frameId
POST   /api/creative-workflows/:workflowId/html-video-project/edit
POST   /api/creative-workflows/:workflowId/html-video-project/render
POST   /api/creative-workflows/:workflowId/html-video-project/export
GET    /api/creative-workflows/:workflowId/html-video-project/exports
```

为后续能力预留但首版可返回 501：

```text
PATCH  /api/creative-workflows/:workflowId/html-video-project/timeline
PATCH  /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/html
PATCH  /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/elements/:elementId
PATCH  /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/transition
POST   /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/enhance
POST   /api/creative-workflows/:workflowId/html-video-project/frames/:frameId/unenhance
```

所有会触发接口请求的用户操作必须展示中文 loading 文案，例如：

- 正在加载可编辑成片工程...
- 正在保存模板字段...
- 正在重新生成 HTML...
- 正在渲染单帧预览...
- 正在导出成片...
- 正在重新生成旁白...

请求完成后必须进入明确状态：成功、失败、未配置、需登录、需验证或已取消。

## 与现有系统集成

### workflowFacade

`workflowFacade` 不再直接承载 rich path 细节，而是调用新的 html-video engine：

```text
generateCreativeVideoProject()
  -> generate scene_spec
  -> htmlVideoWorkflow.generateProject()
  -> ttsService
  -> htmlVideoWorkflow.renderOrExport()
  -> muxAudio
  -> visualQa
```

如果 html-video engine 失败，可配置是否 fallback 到 legacy。默认开发阶段应暴露失败详情，不静默吞掉关键错误。

### 当前 TTS 和混音

保留当前项目的 TTS 服务。html-video project 的 `audio` 字段记录 TTS manifest 和混音配置。ffmpeg mux 可以复用当前 `concatAndMuxAudio()`，也可以逐步吸收 `html-video` 的 `muxAudioWithFfmpeg()` filter graph。

### 当前编辑器

现有 `creative-video-editor` 前端组件继续复用，但数据源从单纯 `scene_spec/frame_specs` 扩展为 `HtmlVideoProject`：

- 左侧场景/帧列表读取 `project.frames`。
- 右侧表单读取 `template_inputs` 或 `frame.inputs`。
- 字幕/旁白读取 `scene_spec` 和 audio manifest。
- 重新渲染调用新 html-video project render/export API。

## 迁移策略

### 第一阶段：并行新链路

- 新增 html-video engine 服务。
- 不删除 legacy path。
- 新工作流优先尝试 html-video production path。
- 失败时根据配置 fallback 到 legacy，并记录 diagnostics。

### 第二阶段：迁移模板

- 选择 1-2 个模板做标准样板，例如 `frame-glitch-title` 和 `frame-bold-signal`。
- 保留原生 `template.html-video.yaml`。
- 改造成可读取 `window.__HV_VARS__` 的变量模板。
- 首批模板必须是 `engine: hyperframes` 且 `source_entry` 指向 HTML。
- 首批模板必须通过 license 过滤，且 `commercial_use` 为 true。
- 首批模板需要明确字体策略：可等待外链字体但要有 fallback warning；后续逐步本地化常用字体。
- 验证 AI 填表、materialize、Playwright render、ffmpeg export、编辑重渲全链路。

### 第三阶段：替换当前 rich path

- 废弃当前 `server/templates/*/manifest.yaml + source.html` 的生产用途。
- 只保留为迁移参考或测试 fixture。
- 删除 AI 直接改完整 HTML 的默认流程。

## 测试计划

### 单元测试

- contentGraph validate/topoSort/totalDuration 行为与 `html-video` 语义一致。
- scene_spec 到 contentGraph 的线性映射能保留 order、duration、kind、narration 和 captions。
- template registry 能读取原生 `template.html-video.yaml`。
- compact index 只暴露 AI 选择需要的字段。
- 模板兼容性校验覆盖 aspect、duration、engine、source_entry 和 license。
- template input agent parse 只接受 JSON。
- JSON Schema 校验能拦住缺失必填、超长、类型错误。
- materializer 能生成包含 `window.__HV_VARS__`、`window.__HV_DURATION__` 和稳定元素标记的 HTML。
- prepareSourceHtml 能内联 `data-composition-src` composition，并注册 `window.__hvPlayAll()`。
- validationGate 能识别远程字体、缺失 preview poster 和 unsupported engine。
- diagnostics 错误结构包含 code、stage、user_message、details 和 fallback_allowed。
- edit patch 能正确更新 project、frame inputs、旁白和字幕。
- revisions/exports 不覆盖历史。

### 集成测试

- AI mock：scene_spec -> template_id -> template_inputs。
- 生成 HtmlVideoProject。
- materialize frame HTML。
- prepareSourceHtml 处理单文件模板和组合模板。
- Playwright adapter mock 输出 MP4。
- ffmpeg composer mock 拼接多帧。
- 混合 engine 或编码参数不一致时选择 concat filter + re-encode。
- 编辑 inputs 后重新生成 HTML 并新增 revision。
- 旁白 patch 后标记 `requires_tts: true`。

### 真实渲染测试

至少一个模板必须跑通：

```text
AI mock 选择模板
  -> 填 template_inputs
  -> materialize HTML
  -> Playwright/Chromium 录制
  -> ffmpeg 输出 mp4
  -> 当前 visual QA
```

成功标准：

- MP4 文件存在。
- 时长接近预期。
- 分辨率正确。
- 没有空白帧。
- 首帧没有字体闪烁导致的明显跳变。
- CSS animation 或 GSAP 动画能真实出现在视频中。
- 编辑字段后可重渲生成新 export。

## 验收标准

- AI 不再返回完整 HTML 作为默认生产路径。
- AI 选模板只返回 `template_id` 等 JSON。
- AI 填内容只返回 `template_inputs` JSON。
- 系统读取原生 `template.html-video.yaml`。
- 首版默认只将 `engine: hyperframes` 且 `source_entry` 为 HTML 的模板列入生产候选。
- 模板候选受 license 策略过滤。
- 系统基于 `inputs.schema` 校验 AI 填表结果。
- 系统把 `scene_spec` 映射成 `contentGraph`，再生成 `frames[]`。
- 系统生成 `HtmlVideoProject` 并保存到 workflow/run 工程目录。
- 系统能把 `template_inputs` 变成可打开的 HTML/frame HTML。
- MP4 输出支持 Playwright + Chromium + ffmpeg 路径。
- 渲染过程处理 prepareSourceHtml、字体加载、动画起点、录制时长、webm 到 mp4 转码。
- 生成后“编辑成片”能打开项目、展示字段、保存修改、重渲并生成新 export。
- 至少一个模板完整跑通“AI 选模板 -> AI 填表 -> 生成 HTML -> Playwright 录制 -> ffmpeg 输出 MP4 -> 混音 -> 编辑重渲”。
- 所有失败阶段返回结构化 diagnostics 和中文 `user_message`。
- project schema 为时间线、剪辑、源码编辑、元素拖拽、转场和 Remotion enhancement 保留字段。

## 风险与应对

- Playwright 和 ffmpeg 依赖缺失：启动时检测并给出中文错误，渲染任务进入“环境未配置”状态。
- 模板未变量化：首版只把少量模板列为 production-ready，其余模板不进入 AI 候选。
- 字体外链不稳定：Playwright adapter 等待 stylesheet/fonts 并设置超时；后续逐步本地化常用字体。
- 编辑后覆盖历史：所有 render/export 写入新 revision/export，不直接覆盖旧版本。
- 多帧拼接音画不同步：首版统一 fps、编码参数和显式 duration；导出后用 ffprobe 校验时长。
- 混合 engine concat 时长膨胀：混引擎或编码参数不一致时不用 concat demuxer，改用 concat filter 并重新编码。
- TS monorepo 运行时依赖复杂：首版不接 workspace，按 `html-video` 行为本地 JS 移植，长期再评估 npm 包化。
- Remotion source_entry 误入首版候选：registry 默认隐藏 `engine: remotion` 模板，只为 enhancement feature flag 预留。
- AI patch 越权：patch 必须经过 schema 和白名单字段校验，不允许直接写任意路径或 HTML。

## 后续实施计划入口

本设计通过后，应进入实施计划阶段。计划应按以下批次拆分：

1. html-video template registry 和 manifest schema。
2. contentGraph JS 行为移植和 scene_spec 映射。
3. HtmlVideoProject schema、project store 和 revisions/exports。
4. AI 选模板与填表 JSON 流程。
5. materializer 和首个变量化模板样板。
6. Playwright/Chromium/ffmpeg render adapter，包括 prepareSourceHtml。
7. 当前 workflowFacade 集成和 fallback/diagnostics 策略。
8. 编辑成片 API 与前端接入。
9. 验证、真实渲染测试和视觉 QA 接入。
