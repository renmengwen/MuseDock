---
name: frame-build-minimal
zh_name: "奢华极简留白帧"
en_name: "Build Minimal Frame"
emoji: "◇"
description: "Luxury-minimal whitespace hero — single word reveals letter by letter, warm-gold hairline, breathing indicators."
zh_description: "奢华极简留白帧:单词逐字浮现 + 暖金细线 + 呼吸感细线指示器, 70%+ 留白"
en_description: "Luxury-minimal whitespace hero — single word reveals letter by letter, warm-gold hairline, breathing indicators."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 7
tags: ["minimal", "luxury", "whitespace", "hero", "gold", "build", "frame"]
example_id: sample-frame-build-minimal
example_name: "奢华极简帧 · Agent"
example_format: markdown
example_tagline: "超细 Inter 单词逐字浮现 + 暖金细线"
example_desc: "70% 留白 + 角标 + 侧边竖排标签 + 8 条呼吸细线"
example_source_url: "https://github.com/alchaincyf/huashu-design"
example_source_label: "huashu-design · Build (MIT)"
od:
  mode: video
  surface: video
  scenario: video
  featured: 0
  upstream: "https://github.com/alchaincyf/huashu-design"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the Build Minimal Frame template to turn my brand word into a luxury-minimal whitespace hero — a single word revealing letter by letter in ultra-thin type, a warm-gold hairline, and breathing indicators. Preserve the template's visual signature, use real content, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「奢华极简留白帧」模板把我的品牌词做成一段奢华极简留白 hero:超细字重单词逐字浮现 + 暖金细线 + 呼吸感指示器。保持模板的视觉签名,使用真实内容,避免 lorem ipsum 和占位图片。"
---

【模板: 奢华极简留白帧 (Build Minimal)】
【意图】高端品牌 hero / 单词陈述 / 优雅标题卡。视觉提炼自 huashu-design 的 Build Studio 流派 (MIT, © alchaincyf)。

【画布】1920×1080, 暖白底 `#FAFAF8`; 左上叠暖金径向 wash (`rgba(212,165,116,0.07)`)。**70%+ 留白是这套风格的灵魂**, 不要填满。

【字体】西文 `Inter` weight 200/300 (超细); 中文 `Noto Sans SC` Light。字距收紧 (-4 ~ -7px)。

【主结构 (时间轴, 默认 5s)】
- **0.2s** 四角 corner marks (暖金 0.5px 描边 L 形) + 暖金 wash 淡入。
- **0.5s** eyebrow (uppercase, letter-spacing 9px, `#B0ACA4`) fadeUp。
- **0.6s 起** hero 单词逐字符浮现 (每字 .ch span, 错峰 80ms, translateY 30→0, expo-out)。font-size ~220px, weight 200。
- **1.9s** 暖金细线 (`#D4A574`, 高 1px) 从宽 0 → 88px 居中生长。
- **2.2s** 两行 desc (weight 300, `#A8A4A0`, line-height 2) fadeUp。
- **1.8s** 侧边竖排小标签 (左右各一, rotate ±90°) 淡入。
- **2.4s 起** 底部 7 条细竖线 (1.5px, 部分暖金) 错峰升起, 随后进入 4s 慢呼吸循环 (opacity 1↔0.45)。

【配色纪律】仅用 暖白 `#FAFAF8` / 近黑 `#1A1A18` / 暖金 `#D4A574` / 暖灰 `#A8A4A0`/`#B0ACA4`。**禁止**鲜艳色。暖金是唯一强调, 极克制 (细线 / 角标 / 个别指示器)。

【内容纪律】
- hero 是一个词 (≤16 字符), 必须用用户真实品牌词/主题词。
- desc 两行短句, 严禁 lorem ipsum。
- 动效用 `@keyframes`, `prefers-reduced-motion` 下全部停在终态。
- 单文件 HTML。
