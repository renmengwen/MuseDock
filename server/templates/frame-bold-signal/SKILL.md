---
name: frame-bold-signal
zh_name: "大胆信号卡帧"
en_name: "Bold Signal Frame"
emoji: "🔶"
description: "Bold colored card on a dark gradient — big section number, nav breadcrumb, orange card sliding in, title rising."
zh_description: "大胆信号卡帧:暗渐变底 + 大编号 + 导航面包屑 + 橙色卡片滑入 + 标题升起, 高冲击力"
en_description: "Bold colored card on a dark gradient — big section number, nav breadcrumb, orange card sliding in, title rising."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 6
tags: ["bold", "card", "dark", "orange", "section", "signal", "frame"]
example_id: sample-frame-bold-signal
example_name: "大胆信号帧 · 01/04"
example_format: markdown
example_tagline: "暗渐变底 + 橙色焦点卡 + 大编号"
example_desc: "章节分隔 / 大胆陈述 — 橙卡从右滑入 + 标题升起"
example_source_url: "https://github.com/zarazhangrui/frontend-slides"
example_source_label: "frontend-slides · Bold Signal (MIT)"
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
  example_prompt: "Use the Bold Signal Frame template to turn my section into a bold colored-card divider — a big section number, a nav breadcrumb, and a vibrant orange card sliding in from the right with the title rising. Preserve the template's visual signature, use real content, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「大胆信号卡帧」模板把我的章节做成一段大胆色卡分隔:大编号 + 导航面包屑 + 鲜橙卡片从右滑入 + 标题升起。保持模板的视觉签名,使用真实内容,避免 lorem ipsum 和占位图片。"
---

【模板: 大胆信号卡帧 (Bold Signal)】
【意图】章节/段落分隔 / 大胆 launch 陈述 / 高冲击标题卡。视觉提炼自 frontend-slides 的 Bold Signal 预设 (MIT, © Zara Zhang)。

【画布】1920×1080, 暗底 `#1a1a1a` + 135° 渐变 (`#1a1a1a → #2d2d2d → #1a1a1a`)。

【字体】display `Archivo Black` (900); body `Space Grotesk` 400/500/700。

【主结构 (时间轴, 默认 4s)】
- **0.2s** 左上巨大 section number (`Archivo Black` 96px, 如 `01/04`, 斜杠后半 opacity 0.3) 从上方 rollIn。
- **0.4s 起** 右上 nav breadcrumb 错峰淡入: active 项 `#FF5722` 橙 opacity 1, 其余白 opacity 0.35。
- **0.6s** 橙色焦点卡 (`#FF5722`, 圆角 36px 仅左侧, 占右 ~1180px) 从 translateX(110%) 滑入, 带橙色柔影。
- **1.15s** 卡内 label (uppercase, letter-spacing 4px) fadeUp。
- **1.3s** 卡内大标题 (`Archivo Black` 130px, 深色 `#1a1a1a` on 橙) fadeUp。
- **1.6s** 左下 footer (橙色 tick 短条 + system 标签) 淡入。

【配色纪律】暗底灰阶 + 唯一强调色 `#FF5722` 橙 (焦点卡 / active nav / footer tick)。可换成 coral/vibrant accent 但**全片只用一个**强调色。卡上文字用深色保证对比。

【内容纪律】
- title 1-2 行, 必须用真实标题, 严禁 lorem ipsum。
- nav 面包屑反映真实章节结构, 第一项 active。
- 动效用 `@keyframes`, `prefers-reduced-motion` 下全部停在终态。
- 单文件 HTML。
