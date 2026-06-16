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

## 总体流程

```text
用户输入 / 素材 / 评论 / 文案
  -> creativeContext
  -> AI 生成 scene_spec
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

## 模块设计

新增服务目录：

```text
server/services/creative-video/html-video/
  index.js
  templateRegistry.js
  templateManifestService.js
  templateSelectorAgent.js
  templateInputAgent.js
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

### templateRegistry

职责：

- 扫描 `html-video` 风格模板目录。
- 读取 `template.html-video.yaml`。
- 使用标准 YAML parser，不再维护手写 YAML parser。
- 保存模板 `__dir`。
- 提供完整 manifest 和 AI 选择用 compact index。

接口：

```js
scanTemplates(rootDir)
listTemplates()
getTemplate(templateId)
hasTemplate(templateId)
buildCompactIndex({ aspectRatio, durationSec, engines })
validateTemplateCompatibility(template, target)
```

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

### hyperframesPlaywrightAdapter

职责：

- 复用 `html-video/packages/adapter-hyperframes/src/render.ts` 的核心技术，落地为当前项目可调用的 JS adapter。
- 启动 Playwright Chromium。
- 固定 viewport 和录制尺寸。
- `recordVideo` 输出 webm。
- `file://` 加载 HTML。
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
- 输出 MP4 存在且时长可读。
- 视觉 QA 没有空白、纯文字白底、低变化等严重问题。

## 可编辑工程模型

新增 `HtmlVideoProject`，保存到当前 workflow/run 的工程目录内。它不是用户直接感知的新产品，而是当前“编辑成片”和重渲的源数据。

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
    "title": "信号失控",
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
- 验证 AI 填表、materialize、Playwright render、ffmpeg export、编辑重渲全链路。

### 第三阶段：替换当前 rich path

- 废弃当前 `server/templates/*/manifest.yaml + source.html` 的生产用途。
- 只保留为迁移参考或测试 fixture。
- 删除 AI 直接改完整 HTML 的默认流程。

## 测试计划

### 单元测试

- template registry 能读取原生 `template.html-video.yaml`。
- compact index 只暴露 AI 选择需要的字段。
- 模板兼容性校验覆盖 aspect、duration、engine 和 source_entry。
- template input agent parse 只接受 JSON。
- JSON Schema 校验能拦住缺失必填、超长、类型错误。
- materializer 能生成包含 `window.__HV_VARS__`、`window.__HV_DURATION__` 和稳定元素标记的 HTML。
- edit patch 能正确更新 project、frame inputs、旁白和字幕。
- revisions/exports 不覆盖历史。

### 集成测试

- AI mock：scene_spec -> template_id -> template_inputs。
- 生成 HtmlVideoProject。
- materialize frame HTML。
- Playwright adapter mock 输出 MP4。
- ffmpeg composer mock 拼接多帧。
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
- 系统基于 `inputs.schema` 校验 AI 填表结果。
- 系统生成 `HtmlVideoProject` 并保存到 workflow/run 工程目录。
- 系统能把 `template_inputs` 变成可打开的 HTML/frame HTML。
- MP4 输出支持 Playwright + Chromium + ffmpeg 路径。
- 渲染过程处理字体加载、动画起点、录制时长、webm 到 mp4 转码。
- 生成后“编辑成片”能打开项目、展示字段、保存修改、重渲并生成新 export。
- 至少一个模板完整跑通“AI 选模板 -> AI 填表 -> 生成 HTML -> Playwright 录制 -> ffmpeg 输出 MP4 -> 混音 -> 编辑重渲”。
- project schema 为时间线、剪辑、源码编辑、元素拖拽、转场和 Remotion enhancement 保留字段。

## 风险与应对

- Playwright 和 ffmpeg 依赖缺失：启动时检测并给出中文错误，渲染任务进入“环境未配置”状态。
- 模板未变量化：首版只把少量模板列为 production-ready，其余模板不进入 AI 候选。
- 字体外链不稳定：Playwright adapter 等待 stylesheet/fonts 并设置超时；后续逐步本地化常用字体。
- 编辑后覆盖历史：所有 render/export 写入新 revision/export，不直接覆盖旧版本。
- 多帧拼接音画不同步：首版统一 fps、编码参数和显式 duration；导出后用 ffprobe 校验时长。
- AI patch 越权：patch 必须经过 schema 和白名单字段校验，不允许直接写任意路径或 HTML。

## 后续实施计划入口

本设计通过后，应进入实施计划阶段。计划应按以下批次拆分：

1. html-video template registry 和 manifest schema。
2. HtmlVideoProject schema、project store 和 revisions/exports。
3. AI 选模板与填表 JSON 流程。
4. materializer 和首个变量化模板样板。
5. Playwright/Chromium/ffmpeg render adapter。
6. 当前 workflowFacade 集成和 fallback 策略。
7. 编辑成片 API 与前端接入。
8. 验证、真实渲染测试和视觉 QA 接入。
