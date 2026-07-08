---
name: frame-data-rollup
zh_name: "数据滚动帧"
en_name: "Data Rollup Frame"
emoji: "📊"
description: "A native Remotion data frame — bars grow from zero by real data via spring physics while the figures roll 0→target in sync. The numbers come alive in a way a static HTML chart can't."
zh_description: "数据滚动帧:原生 Remotion 数据动画 — 柱子按真实数据用 spring 从 0 长上去、数字同步从 0 滚到目标值。静态 HTML 图表做不出的'数字活起来'效果。"
en_description: "A native Remotion data frame — bars grow from zero by real data via spring physics while the figures roll 0→target in sync."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9), also 9:16 / 1:1"
featured: 0
recommended: 5
tags: ["data", "chart", "bar", "rollup", "count-up", "remotion", "native", "kpi", "frame"]
example_id: sample-frame-data-rollup
example_name: "数据滚动帧 · This week on GitHub"
example_format: markdown
example_tagline: "柱子生长 + 数字滚动 (原生 Remotion)"
example_desc: "数据展示帧 — 柱子按真数据从 0 长出 + 数字 0→目标同步滚动"
od:
  mode: video
  surface: video
  scenario: video
  featured: 0
  upstream: "https://github.com/nexu-io/html-video"
  preview:
    # Native Remotion template: no HTML iframe preview. Static poster only.
    type: poster
    entry: preview.png
  design_system:
    requires: false
  example_prompt: "Use the Data Rollup Frame to show my weekly metrics as a bar chart where the bars grow from zero and the numbers count up to their real values. Feed it the actual data; keep it to a handful of bars. This is a Remotion-enhanced data frame — the animation should make the figures feel alive."
  example_prompt_i18n:
    zh-CN: "用「数据滚动帧」把我的每周指标做成柱状图:柱子从 0 长上去、数字滚动到真实数值。喂真实数据,柱子控制在几根以内。这是 Remotion 增强的数据帧,动画要让数字有'活起来'的感觉。"
---

【模板: 数据滚动帧 (Data Rollup)】
【类型】**原生 Remotion 模板 (RFC-08 Phase 2)** — 不是 HTML+GSAP,而是 React-tsx 直接吃 Remotion 的帧时钟 (`useCurrentFrame` + `interpolate` + `spring`)。这是让用户**主动给数据帧挂上**的动效增强:hyperframes 出静态/CSS 图表,本模板让柱子真的按数据长出来、数字真的滚动,一眼可辨。

【意图】数据展示帧 — 每周指标 / 增长柱 / KPI,数值应该动起来而不是干放着。适合塞进一条以 hyperframes 为主的视频里的某一个数据段。

【画布】默认 1920×1080,布局全部基于真实画布尺寸 (`useVideoConfig`) 计算,9:16 / 1:1 也不会压扁。

【数据契约 (inputProps)】
- `data.items[]` — 每项 `{label, value}`,就是要画的柱子;最多约 7 根,多了会挤。
- `data.title?` — 左上标题。
- `data.unit?` — 数字后缀,如 `K` / `%`。
- `accent?` / `background?` / `foreground?` — 配色,默认番橙 `#FF5A2C` / 近黑 `#0E0E10` / 纸白 `#F5F5F2`。

【动效结构】
- 每根柱子按 `spring()` 从 0 长到 `value/maxValue` 高度,逐根错峰 (0.12s 一根) 级联进场。
- 数字用与柱子同一条 growth 曲线从 0 滚到 `value`,柱子和数字同时落定。
- 标题 spring 淡入 + 上移;label 在柱子长到 40% 时淡入。

【内容纪律】
- 喂真实数据,别用占位数字。
- `value` 必须是数;非数会被当 0(`enhanceFrameNative` 应在绑定前归一/校验)。
- 柱子数控制在 7 根内。

【离线确定性】纯系统字体栈、内联样式,无外部字体 / 资源 / 网络 — 保证 headless 渲染确定、不黑屏 (对齐桥接的 neutralizeBlockingResources 教训)。

【原创】原创 React-tsx,标准动画柱状图词汇 (count-up + spring 生长) 从零实现,无特定上游来源 (provenance origin = none)。
