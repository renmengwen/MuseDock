# HTML-Video Lite 一键成片重构设计

## 背景

当前一键成片已经从“AI 输出完整 HyperFrames 工程”尝试切到“AI 输出 `scene_spec`，后端确定性生成工程”。这个方向解决了一部分模型输出过大、超时、JSON 解析失败的问题，但最近一次实测暴露出新的严重问题：后端 composer 只是把字段拼成裸 HTML，最终渲染出白底黑字视频；同时 `visual_inspect` 只确认能抽帧和生成联系表，没有拦住不可交付的画面。

因此，旧的 `scene_spec -> 简单 index.html composer` 路线不再继续修补。当前项目如果没有线上用户依赖，可以直接进入新架构：借鉴 `html-video` 的 content graph、分帧、adapter 和多阶段生成思想，但裁剪成适合本项目“一键生成视频，生成后可编辑/二创”的稳定版本。

## 目标

- 首次一键生成继续对用户黑盒，用户不需要理解场景、帧、HTML 或 HyperFrames。
- 生成完成后保存可编辑工程源数据，支持字幕、旁白、画面文字、场景时长、场景顺序、单场景重写、局部 TTS 和二创版本。
- AI 不再输出完整工程，也不直接输出 HTML、CSS、JS 或 GSAP timeline。
- AI 输出结构化规格：`scene_spec` 和 `frame_specs`。
- AI 规格生成拆成两次调用：先生成 `scene_spec`，校验通过后再生成 `frame_specs`。
- 后端模板渲染器负责把规格确定性转换为 HyperFrames 工程。
- 渲染层通过 `RenderAdapter` 抽象，当前可继续接 HyperFrames，后续可切到 Playwright/逐帧渲染。
- 视觉质检必须能拦住白底文字、空白帧、低信息密度、帧间变化不足等坏成片。
- 前端组件化，所有接口交互必须有 loading、禁用态和成功/失败反馈。
- 后端按职责拆分，通用功能抽取复用，避免继续扩大几千行大文件。

## 非目标

- 首版不做完整开放式 Studio。
- 首版不开放任意 HTML 编辑。
- 首版不让用户直接编辑 GSAP timeline。
- 首版不引入 Remotion 作为默认渲染引擎。
- 首版不继续修旧的裸 HTML composer 作为生产路径。
- 首版不追求复杂时间轴拖拽；先做表单式/列表式编辑。

## 参考 html-video 的取舍

`html-video` 的关键经验是：复杂视频不要让模型一次输出所有工程文件。它把生成拆成两段：

1. 先输出 `content-graph`，作为多帧故事板中间表示。
2. 再按 graph node 单独生成 frame HTML。

本项目学习第一点，但不直接照搬第二点。原因是当前项目追求稳定一键成片，不是开放式 Studio。我们改为：

```text
AI 第一次输出 scene_spec JSON
 -> scene_spec 校验
AI 第二次输出 frame_specs JSON
 -> frame_specs 校验
后端 template_renderer 生成 HTML/CSS/GSAP
RenderAdapter 渲染视频
Visual QA 拦截坏画面
```

这样既保留 html-video 的“结构化中间层”和“分帧可编辑”，又避免让 AI 重新变成前端工程师。

## 新数据模型

### scene_spec

`scene_spec` 是内容源数据，负责全片结构、场景、旁白、字幕和用户可编辑文本。

```json
{
  "version": 1,
  "title": "视频标题",
  "aspect_ratio": "16:9",
  "target_duration_sec": 60,
  "scenes": [
    {
      "id": "scene_01",
      "order": 1,
      "start": 0,
      "duration": 8,
      "kind": "text",
      "narration_text": "旁白文案",
      "captions": [
        {
          "id": "cap_01_01",
          "start": 0,
          "end": 2,
          "text": "字幕文本"
        }
      ],
      "visual_text": {
        "headline": "画面标题",
        "keywords": ["关键词一", "关键词二"],
        "cards": ["内容卡片一", "内容卡片二"]
      }
    }
  ]
}
```

### frame_specs

`frame_specs` 是视觉源数据，负责每个场景拆成哪些帧、使用哪个模板、什么布局、什么背景、哪些文字层和视觉层。

```json
{
  "frames": [
    {
      "id": "frame_01_01",
      "scene_id": "scene_01",
      "order": 1,
      "start": 0,
      "duration": 4,
      "kind": "text",
      "template": "hero_title",
      "layout": "center_stack",
      "background": "dark_gradient",
      "motion": "fade_up",
      "text_layers": [
        {
          "id": "headline",
          "role": "headline",
          "text": "画面标题",
          "emphasis": "primary"
        }
      ],
      "visual_layers": [
        {
          "id": "accent_01",
          "type": "glow_panel",
          "variant": "cyan_pink"
        }
      ]
    }
  ]
}
```

### render_versions

每次渲染生成一个版本记录。

```json
{
  "id": "render_001",
  "source_version": 1,
  "status": "rendered",
  "output_path": "output.mp4",
  "contact_sheet_path": "contact_sheet.jpg",
  "created_at": "2026-06-14T00:00:00.000Z",
  "message": "渲染完成"
}
```

## AI 输出约束

AI 只输出 JSON，不输出工程文件。

必须明确告诉 AI：

- 这是用于 HyperFrames 视频生成管线的结构化规格。
- 输出会被后端转换为 HyperFrames 工程。
- 不要输出 HTML、CSS、JavaScript、GSAP timeline、`index.html`、`hyperframes.json`、`package.json` 或 `files` 数组。
- `template`、`layout`、`background`、`motion`、`visual_layers.type` 必须从允许枚举中选择。
- 不要把视觉意图写进 `cards` 文本。例如“深色科技背景”“光晕扩散效果”不能作为卡片文案。
- 如果想表达视觉效果，必须用 `background`、`motion`、`visual_layers` 表达。
- `visual_text.cards` 里的每个字符串都必须是最终观众能看到的实际内容文案，不能是制作说明、镜头说明或视觉效果描述。
- 输出前必须自检：如果某个字段包含“背景”“光效”“动画”“转场”“布局”“发光”“粒子”“镜头”等制作词汇，必须确认它位于 `background`、`motion` 或 `visual_layers`，不能位于 `headline`、`keywords`、`cards`、`caption.text` 或 `narration_text`。

允许枚举首版固定为：

```json
{
  "kind": ["text", "data", "quote", "steps", "comparison", "cta"],
  "template": ["hero_title", "keyword_burst", "process_steps", "compare_split", "quote_focus", "data_cards", "cta_end"],
  "layout": ["center_stack", "left_title_right_cards", "three_step_grid", "split_compare", "bottom_caption", "stat_focus"],
  "background": ["dark_gradient", "soft_grid", "radial_spotlight", "brand_blocks", "clean_light"],
  "motion": ["fade_up", "slide_in", "scale_pop", "stagger_cards", "glow_pulse", "fade_out"],
  "visual_layer_type": ["glow_panel", "grid_lines", "shape_blocks", "number_counter", "progress_bar", "connector_lines"]
}
```

## AI 调用拆分

首版使用两次 AI 调用，不能一次性要求模型输出完整 `scene_spec + frame_specs` 大 JSON。

### 第一次调用：scene_spec

输入：

- 用户主题/文案/来源摘要
- 创作上下文
- 目标比例和时长
- 字幕和旁白要求

输出：

```json
{
  "scene_spec": {
    "version": 1,
    "title": "视频标题",
    "aspect_ratio": "16:9",
    "target_duration_sec": 60,
    "scenes": [
      {
        "id": "scene_01",
        "order": 1,
        "start": 0,
        "duration": 8,
        "kind": "text",
        "narration_text": "旁白文案",
        "captions": [],
        "visual_text": {
          "headline": "观众可见标题",
          "keywords": ["观众可见关键词"],
          "cards": ["观众可见卡片文案"]
        }
      }
    ]
  }
}
```

要求：

- `scene_spec.scenes[].kind` 必须从 `text/data/quote/steps/comparison/cta` 中选择。
- `visual_text` 只能放观众可见内容。
- 不允许输出 `frame_specs`。
- 不允许输出任何 HTML 或工程文件。

### 第二次调用：frame_specs

输入：

- 已校验通过的 `scene_spec`
- 模板枚举
- 布局/背景/动效/视觉层枚举
- 每种模板的简短能力说明

输出：

```json
{
  "frame_specs": [
    {
      "id": "frame_01_01",
      "scene_id": "scene_01",
      "order": 1,
      "start": 0,
      "duration": 4,
      "kind": "text",
      "template": "hero_title",
      "layout": "center_stack",
      "background": "dark_gradient",
      "motion": "fade_up",
      "text_layers": [],
      "visual_layers": []
    }
  ]
}
```

要求：

- `frame_specs[].kind` 必须与所属 scene 的 `kind` 兼容。
- frame 的 `start + duration` 必须落在所属 scene 时间范围内。
- 所有视觉效果只能通过枚举字段表达。
- 不允许改写 `scene_spec` 文案。
- 不允许输出 HTML、CSS、JS 或工程文件。

这两次调用之间必须有确定性校验。第一次失败只重试 `scene_spec`，第二次失败只重试 `frame_specs`。

## 后端架构

后端拆成小服务，不把逻辑继续堆到 `agentRuns.js`、`creativeWorkflows.js` 或单个大 service 中。

### sceneSpecService

职责：

- normalize/validate `scene_spec`
- 编辑字幕、旁白、视觉文字、时长、顺序
- 计算 `requires_tts`、`requires_render`

禁止：

- 文件写入
- Express `req/res`
- AI 调用
- 渲染调用

### frameSpecService

职责：

- normalize/validate `frame_specs`
- 检查 frame 是否覆盖所有 scene
- 检查 frame 时间是否落在所属 scene 内
- 根据场景顺序和时长重排 frame

禁止：

- HTML 生成
- 渲染调用
- workflow 持久化

### creativeSpecAgent

职责：

- 构造 AI prompt
- 解析 AI 返回 JSON
- 对 `scene_spec` 和 `frame_specs` 做结构校验

禁止：

- 写 HyperFrames 工程
- 调用 render
- 把 AI 返回的自由视觉描述直接写入 cards

### templateRegistry

职责：

- 注册可用模板
- 定义每个模板支持的 `kind/layout/background/motion`
- 提供模板默认 token，例如颜色、字体、字幕位置、动效参数
- 提供背景、布局、动效和视觉层的查表映射，禁止 renderer 临时自由拼接未登记样式。

首版模板库必须至少包含：

| template | 适用 kind | 默认布局 | 默认背景 | 默认动效 | 用途 |
| --- | --- | --- | --- | --- | --- |
| `hero_title` | `text/quote` | `center_stack` | `dark_gradient` | `fade_up` | 开场标题、核心观点 |
| `keyword_burst` | `text` | `center_stack` | `radial_spotlight` | `stagger_cards` | 关键词爆发、卖点罗列 |
| `process_steps` | `steps` | `three_step_grid` | `soft_grid` | `slide_in` | 步骤、流程、教程 |
| `compare_split` | `comparison` | `split_compare` | `brand_blocks` | `slide_in` | 前后对比、方案对比 |
| `data_cards` | `data` | `stat_focus` | `dark_gradient` | `scale_pop` | 数字、指标、排行榜 |
| `cta_end` | `cta` | `center_stack` | `radial_spotlight` | `glow_pulse` | 结尾行动号召 |

首版样式映射必须是预置表：

```text
background = "dark_gradient"
  -> 固定 CSS 渐变、暗色底、可读文字色

motion = "fade_up"
  -> 固定 GSAP fromTo 配置

visual_layer.type = "glow_panel"
  -> 固定 DOM 结构 + 固定 CSS class + 固定 timeline 片段
```

renderer 只能查表和填充数据，不允许根据 AI 文本动态生成未知 CSS 或未知 GSAP。

### hyperframesTemplateRenderer

职责：

- 把 `scene_spec + frame_specs` 转成真实 HyperFrames HTML/CSS/GSAP
- 输出 `index.html`、`meta.json`、`hyperframes.json`、`scene_spec.json`、`frame_specs.json`
- 生成有效背景、布局、字幕层、文字层、视觉层和 timeline

要求：

- 不允许生成白底裸 HTML。
- 每个 frame 必须有稳定尺寸、背景、主要文本层和时间控制。
- 字幕必须有清晰样式、位置和显示时段。
- 生成 HTML 必须可通过 HyperFrames lint/validate/inspect。
- 每个 frame 必须根据 `frame_spec.template` 选择一个模板定义。
- `text_layers` 必须映射为真实 DOM 元素，例如标题、副标题、卡片、数字、步骤项。
- `layout` 必须映射为预置 CSS class 或 style token。
- `background` 必须映射为预置 CSS 背景代码。
- `motion` 必须映射为预置 GSAP timeline 片段。
- `visual_layers` 必须映射为预置装饰 DOM 和 timeline 片段。

renderer 的实现模型：

```text
frame_spec.template
 -> templateRegistry.getTemplate()
 -> template.renderFrame(frame_spec, scene_spec)
 -> HTML fragments + CSS fragments + timeline fragments
 -> composeDocument()
 -> index.html
```

renderer 不是自由生成器，只做模板查表、数据绑定和文档组装。

### renderAdapter

职责：

- 统一渲染接口。
- 当前实现接现有 HyperFrames 渲染器。
- 未来可新增 Playwright/逐帧/Remotion adapter。
- 接收 TTS 服务生成的旁白音频路径，并把音频传给当前渲染链路或通过 ffmpeg 混流。

输出统一为：

```json
{
  "success": true,
  "output_path": "output.mp4",
  "stdout": "",
  "stderr": "",
  "diagnostics": [],
  "meta": {}
}
```

### ttsService

职责：

- 根据 `scene_spec.scenes[].narration_text` 生成逐场景音频。
- 把音频写入工程目录，例如 `tts/scene_01.mp3` 或 `tts/scene_01.wav`。
- 返回每个场景的音频路径、时长和字幕时间修正信息。
- 局部 TTS 只重算目标 scene，不影响其他 scene 的音频文件。

禁止：

- 直接渲染视频。
- 直接修改 React 状态。
- 把 TTS 失败覆盖到上一版可播放视频。

### visualQaService

职责：

- 抽帧
- 生成 contact sheet
- 检测坏画面

首版必须检测：

- 近白/近黑空白帧占比过高
- 文字或主体面积过小
- 连续帧变化过低
- contact sheet 文件过小
- 没有明显背景或视觉层
- 画面主体集中在左上角的默认文档流风险

只要这些检查失败，就不能把 workflow 标记为最终成功。

首版量化阈值：

- 平均亮度 `> 230` 判定为近白帧。
- 平均亮度 `< 25` 判定为近黑帧。
- 近白帧或近黑帧占抽样帧比例 `> 30%`，质检失败。
- contact sheet 文件小于 `20KB`，质检失败。
- 单帧亮度标准差 `< 12` 且边缘/颜色变化很低，判定为低信息帧。
- 低信息帧比例 `> 40%`，质检失败。
- 首版不使用 OCR，使用像素级分析；可用 `sharp`、`jimp` 或已有图像处理能力实现。

### creativeWorkflowFacade

职责：

- 读取/保存 workflow
- 调用 agent、template renderer、project writer、checker、TTS、render adapter、quality
- 维护 `render_versions`
- 顺序必须是：生成 specs -> 渲染工程文件 -> 写入工程 -> 校验工程 -> 生成 TTS -> 渲染视频 -> 视觉质检。
- 工程校验失败时不进入 TTS 和视频渲染。
- TTS 失败时不覆盖上一版可播放视频。

禁止：

- 直接拼 HTML
- 直接构造复杂 prompt
- 直接处理 React 组件字段

### routes

职责：

- 参数校验
- 调用 facade
- 返回中文错误

禁止：

- 直接改 scene/frame
- 直接写文件
- 直接调用 render

## 前端架构

前端必须组件化。页面只做编排，编辑器和交互逻辑拆到组件和 hook。

### 页面层

`OneClickCreativePage.jsx` 只负责：

- 创建一键创作任务
- 轮询 workflow 状态
- 展示阶段进度
- 打开编辑器入口

禁止：

- 管理字幕编辑 draft
- 直接拼 scene/frame payload
- 直接写复杂编辑表单

### 与 Hyperframes Studio 的关系

首版 `CreativeVideoEditor` 不替换现有 `HyperframesStudioPage`。

- `OneClickCreativePage` 是一键生成入口。
- `CreativeVideoEditor` 是一键生成完成后的结构化编辑入口。
- `HyperframesStudioPage` 保持为自由工程/高级 Studio 能力。
- 首版不在两个页面之间共享复杂组件；只复用通用 API client、状态组件、预览组件和基础 UI 组件。
- 后续如果要统一 Studio 和一键编辑，需要单独设计迁移计划。

### hook 层

新增 `useCreativeVideoEditor`：

- 加载 `scene_spec/frame_specs`
- 保存编辑
- 重写单场景
- 局部 TTS
- 重新渲染
- 管理 loading/saving/error/success 状态

所有接口动作必须有：

- loading 文案
- 禁用重复点击
- 成功反馈
- 失败反馈

### 组件层

首版组件：

- `CreativeVideoEditor`
- `SceneList`
- `SceneEditPanel`
- `FrameList`
- `FrameEditPanel`
- `CaptionEditor`
- `VisualTextEditor`
- `RenderVersionPanel`
- `EditorStatusBar`

组件只接收 props 和回调，不直接调用 API。

## 数据流

首次生成：

```text
用户输入
 -> creative_context
 -> creativeSpecAgent 输出 scene_spec + frame_specs
 -> schema validation
 -> templateRenderer 生成 HyperFrames 工程
 -> hyperframes lint/validate/inspect
 -> renderAdapter 渲染
 -> visualQaService 视觉质检
 -> 保存 render_version
 -> workflow done
```

生成后编辑：

```text
用户编辑 scene/frame
 -> 更新 scene_spec/frame_specs
 -> 根据改动判断 requires_tts/requires_render
 -> 局部 TTS 或直接重渲染
 -> 新 render_version
 -> 保留旧 render_version
```

二创：

```text
选择已有 workflow/render_version
 -> 复制 scene_spec + frame_specs
 -> 创建 remix workflow
 -> 用户修改
 -> 渲染新版本
```

## 旧问题转成新验收用例

以下旧问题不单独修旧实现，但必须作为新架构验收用例：

1. 不能生成白底黑字裸 HTML。
2. 视觉意图不能被当作普通卡片文本。
3. `visual_inspect` 不能只因 contact sheet 存在就通过。
4. 默认 rerender 不能返回“缺少 composer 服务”。
5. 局部 TTS 更新时间不能出现 `retimeScenes is not a function`。
6. AI 输出不能包含 `files`、`index.html` 或完整工程。
7. 后端服务不能继续把 AI、文件写入、渲染、路由逻辑耦合在一个大文件里。
8. 前端接口操作不能没有 loading 和反馈。

## 测试策略

后端测试：

- `scene_spec` schema 校验
- `frame_specs` schema 校验
- AI prompt 禁止 HTML/files 输出
- template registry 枚举校验
- renderer 生成 HTML 结构测试
- HyperFrames lint/validate/inspect 真实校验
- visual QA 白底文字回归测试
- rerender 默认路径测试
- 局部 TTS retime 测试
- workflow 集成测试

前端测试：

- 页面只引用编辑器，不包含编辑细节状态
- hook 覆盖 loading/saving/success/failed
- 每个组件只通过 props/callback 通信
- 所有接口按钮有禁用态
- build 通过

手工验收：

- 跑一次真实一键生成。
- 查看 output.mp4。
- 查看 contact sheet。
- 确认不是白底文字。
- 修改字幕后生成新版本。
- 修改场景顺序后生成新版本。
- 局部 TTS 后生成新版本。

## 设计结论

当前项目可以不再修补旧的裸 HTML composer，直接切到 html-video lite 架构。新架构的核心不是完整照搬 html-video，而是学习它的“结构化中间层、分帧、adapter、可编辑工程源数据”思想，并把 AI 控制在 JSON 规格层。后端必须提供真正的视频模板渲染能力和视觉质检，前端必须组件化并提供明确 loading/反馈，后端通用能力必须拆小复用，避免继续扩大已有大文件。
