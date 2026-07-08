---
name: frame-creative-voltage
zh_name: "创意电压分屏帧"
en_name: "Creative Voltage Frame"
emoji: "⚡"
description: "Electric split with hand-drawn script — offset panels slide in, display title rises with an outlined word, script strokes itself in."
zh_description: "创意电压分屏帧:电光蓝/暗错位分屏滑入 + 描边电光词 + 手写 script 自描, 复古现代有活力"
en_description: "Electric split with hand-drawn script — offset panels slide in, display title rises with an outlined word, script strokes itself in."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 6
tags: ["split-panel", "electric", "script", "retro-modern", "voltage", "frame"]
example_id: sample-frame-creative-voltage
example_name: "创意电压帧 · make it move"
example_format: markdown
example_tagline: "电光蓝/暗错位分屏 + 手写 script 自描"
example_desc: "能量感品牌标题 — 描边电光词 + 手写体描入 + 扫入下划线"
example_source_url: "https://github.com/zarazhangrui/frontend-slides"
example_source_label: "frontend-slides · Creative Voltage (MIT)"
od:
  mode: video
  surface: video
  scenario: video
  featured: 0
  upstream: "https://github.com/zarazhangrui/frontend-slides"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the Creative Voltage Frame template to turn my title into an energetic split reveal — electric-blue and dark panels sliding in offset, a display title rising with one outlined electric word, and a handwritten script stroking itself in. Preserve the template's visual signature, use real content, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「创意电压分屏帧」模板把我的标题做成一段能量感分屏揭示:电光蓝与暗色面板错位滑入 + 标题升起带一个描边电光词 + 手写体自描入。保持模板的视觉签名,使用真实内容,避免 lorem ipsum 和占位图片。"
---

【模板: 创意电压分屏帧 (Creative Voltage)】
【意图】能量感品牌/活动标题 / 带手写人味的创意揭示 / 复古现代 hero。视觉提炼自 frontend-slides 的 Creative Voltage 预设 (MIT, © Zara Zhang)。

【画布】1920×1080, 左电光蓝屏 (`#2f4bff`, 47%) + 右暗屏 (`#0d0d14`, 53%), 错位分割。

【字体】display `Syne` 800; mono `Space Mono`; 手写 `Caveat`。

【主结构 (时间轴, 默认 4s)】
- **0.1s** 左蓝屏从 translateX(-100%) 滑入; **0.25s** 右暗屏从 translateX(100%) 滑入 (错峰, expo-out)。
- **0.9s** 蓝屏左上电光高光 wash 淡入。
- **1.0s** 蓝屏左上 mono meta 行 (`// CREATIVE_MODE · ON`) 淡入。
- **1.0s 起** 右屏 display 标题逐行升起 (每行 .ln, 错峰 180ms); 一行用 `.volt` 描边电光词 (`-webkit-text-stroke` + 蓝色填充)。font-size 132px, 右对齐。
- **1.4s** 蓝屏手写 script (`Caveat`, rotate -7°) 弹入。
- **1.9s** script 下方手绘 underline (SVG path, stroke-dashoffset 描出)。
- **2.2s** 右下 mono caption 淡入。

【配色纪律】电光蓝 `#2f4bff`/`#6f86ff` / 暗 `#0d0d14` / 白。蓝是能量主色, 描边词与 script 制造"电压"对比。**禁止**杂色。

【内容纪律】
- display 拆 2-4 行, 选一个词做 `.volt` 描边强调。
- script 是短手写词组 (≤24 字符), 给画面人味。
- 必须用真实标题, 严禁 lorem ipsum。
- 动效用 `@keyframes` + SVG stroke, `prefers-reduced-motion` 下全部停在终态。
- 单文件 HTML。
