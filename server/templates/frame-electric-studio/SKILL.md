---
name: frame-electric-studio
zh_name: "电光工作室分屏帧"
en_name: "Electric Studio Frame"
emoji: "🔷"
description: "Two-panel split with quote as hero — white/blue panels open from center, accent bar grows, quote reveals line by line."
zh_description: "电光工作室分屏帧:白/蓝双屏从中心开合 + 强调条生长 + 引言逐行浮现, 高对比专业感"
en_description: "Two-panel split with quote as hero — white/blue panels open from center, accent bar grows, quote reveals line by line."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 6
tags: ["split-panel", "quote", "blue", "high-contrast", "studio", "frame"]
example_id: sample-frame-electric-studio
example_name: "电光分屏帧 · 引言"
example_format: markdown
example_tagline: "白/蓝双屏开合 + 引言逐行浮现"
example_desc: "pull-quote / 使命陈述 — 黑色 accent 条 + 跨屏引言"
example_source_url: "https://github.com/zarazhangrui/frontend-slides"
example_source_label: "frontend-slides · Electric Studio (MIT)"
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
  example_prompt: "Use the Electric Studio Frame template to turn my quote into a two-panel split reveal — white top and electric-blue bottom panels opening from center, a black accent bar growing on the seam, and the quote revealing line by line. Preserve the template's visual signature, use real content, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「电光工作室分屏帧」模板把我的引言做成一段双屏开合揭示:白色上屏 + 电光蓝下屏从中心开合 + 接缝处黑色强调条生长 + 引言逐行浮现。保持模板的视觉签名,使用真实内容,避免 lorem ipsum 和占位图片。"
---

【模板: 电光工作室分屏帧 (Electric Studio)】
【意图】pull-quote / 推荐语 / 使命陈述 / 高对比标题。视觉提炼自 frontend-slides 的 Electric Studio 预设 (MIT, © Zara Zhang)。

【画布】1920×1080, 白色上屏 (540px) + 电光蓝下屏 (`#4361ee`, 540px), 中线分割。

【字体】display + body 都用 `Manrope` 800/700/500/400。

【主结构 (时间轴, 默认 4s)】
- **0.1s** 上屏从 translateY(-100%) 下落、下屏从 translateY(100%) 上升, 同时从中心"开合"到位 (expo-out)。
- **0.9s** 接缝处黑色 accent 条 (高 8px) 从宽 0 → 320px 生长。
- **1.0s 起** 引言逐行浮现 (每行 .ln, 错峰 150ms, translateY 26→0); 跨入蓝屏的行用白色 (`.on-blue`)。font-size 96px, weight 800。
- **2.2s** 下屏 attribution (name 28px 700 + role uppercase 0.7 opacity, 白色) 淡入。
- **2.5s** 右上品牌 mark (深色) + 右下品牌 mark (白 0.6) 淡入。

【配色纪律】白 / 电光蓝 `#4361ee` / 近黑 `#0a0a0a` 三色。accent 条与品牌词用黑/白, 蓝是大色块。**禁止**第四个主色。

【内容纪律】
- quote 拆成 2-4 行, 让 1-2 行落在蓝屏 (改 `.on-blue` class) 形成跨屏对比。
- 必须用真实引言/陈述, 严禁 lorem ipsum。
- 动效用 `@keyframes`, `prefers-reduced-motion` 下全部停在终态。
- 单文件 HTML。
