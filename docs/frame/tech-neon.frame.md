# Tech Neon Frame Profile

## 定位

`tech_neon` 是 MuseDock 当前默认的短视频 Frame Profile。它面向 9:16 口播型知识、工具、观点类视频，把 AI 分镜输出转换成带动态背景、丰富版式和可控转场的 HyperFrames 画面。

## 画面规则

- 画幅固定为 9:16，默认 1080x1920，可降级到 720x1280。
- 舞台根节点必须保留 `#stage`，并写入 `data-composition-id`、`data-frame-profile`、`data-width`、`data-height`、`data-duration`。
- 每个分镜使用 `.scene.clip`，每个场景主体使用 `.scene-content`。
- 背景必须至少包含网格、扫描线、能量光晕三层，避免纯静态深色底。
- 不允许引用原视频画面、原视频帧、截图或搬运素材。

## 版式规则

- `text_card`：用于核心观点，大标题优先，强调词逐个点亮。
- `quote_card`：用于定义、金句和判断，使用巨型引号与上边框构图。
- `contrast_card`：用于对比和转折，使用左右对照与 `VS` 中轴。
- `step_card`：用于步骤、注意事项和流程，使用编号圆环与进度线。
- 不要让连续场景全部使用同一种居中卡片结构。

## 动效规则

- 所有 timeline 必须是 paused GSAP timeline，并挂到 `window.__timelines['ai-storyboard-cards']`。
- 背景网格和能量光晕需要持续缓慢运动。
- 场景入场使用位移、缩放、轻微 3D 倾斜和 blur reveal。
- 转场使用 `.transition-layer`，`transitionStyle=glitch` 时优先表现为霓虹扫切。
- `captionMode=kinetic` 时，字幕拆成词块并逐个入场。
- `motionLevel` 只控制动效强度，不改变内容语义。

## 字幕规则

- `showCaptionBar=false` 时不得渲染 `.caption-bar`。
- 字幕文字必须来自 `tts.captions`，不得由 AI 或 Frame Profile 重新编写。
- 字幕条位于画面底部安全区，不能遮挡主体标题。

## 禁止项

- 不要输出像网页按钮或后台卡片一样的 UI。
- 不要所有 scene 只是一张半透明矩形卡。
- 不要让 AI prompt 决定最终渲染流程。
- 不要把 `Frame.md` 作为自由文本 prompt 编辑器暴露给用户。
