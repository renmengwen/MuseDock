---
name: frame-takram-organic
zh_name: "东方柔和有机帧"
en_name: "Takram Organic Frame"
emoji: "🌿"
description: "Soft-tech radial node graph as art — frosted rounded card, curved links drawing in, nodes popping outward, gentle float."
zh_description: "东方柔和有机帧:毛玻璃圆角卡 + 曲线连接描入 + 放射节点弹出 + 柔和漂浮, 米色自然色调"
en_description: "Soft-tech radial node graph as art — frosted rounded card, curved links drawing in, nodes popping outward, gentle float."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 0
recommended: 7
tags: ["organic", "soft-tech", "radial", "diagram", "takram", "beige", "frame"]
example_id: sample-frame-takram-organic
example_name: "柔和有机帧 · 节点图"
example_format: markdown
example_tagline: "毛玻璃圆角卡 + 放射节点弹出 + 柔和漂浮"
example_desc: "米色底 + 自然色 (sage/terracotta) + 八节点放射图作为艺术品"
example_source_url: "https://github.com/alchaincyf/huashu-design"
example_source_label: "huashu-design · Takram (MIT)"
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
  example_prompt: "Use the Takram Organic Frame template to turn my concept into a soft-tech radial node graph — a frosted rounded card with curved links drawing in and nodes popping outward around an evolving core. Preserve the template's visual signature, use real content, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「东方柔和有机帧」模板把我的概念做成一段柔和科技感放射节点图:毛玻璃圆角卡 + 曲线连接描入 + 节点围绕进化核心放射弹出。保持模板的视觉签名,使用真实内容,避免 lorem ipsum 和占位图片。"
---

【模板: 东方柔和有机帧 (Takram Organic)】
【意图】系统/架构概念揭示 / 温暖产品叙事 / 网络/记忆图解。视觉提炼自 huashu-design 的 Takram 流派 (MIT, © alchaincyf)。

【画布】1920×1080, 米色底 `#EFEAE0`; 右侧叠 sage 绿径向 wash (`rgba(122,158,127,0.10)`)。整体柔和、自然、有呼吸感。

【字体】西文 `Manrope` 700/600/400; 中文 `Noto Sans SC`。圆润, 不要太硬。

【主结构 (时间轴, 默认 5s)】
- **0.2s** 左侧毛玻璃圆角卡 (`rgba(255,253,248,0.66)` + blur 8px + border-radius 40px + 柔影) 从下方 26px + scale 0.985 升入。
- **0.7s** 绿色 eyebrow (`#7A9E7F`, uppercase, letter-spacing 4px) fadeUp。
- **0.9s** 卡标题 (92px, weight 700) fadeUp; 一个 accent 词用陶土橙 `#C98A5E`。
- **1.2s** caption (22px, `#8A867C`, line-height 1.8) fadeUp。
- **1.3s** 右侧放射图中心节点 (陶土橙, r=40) 弹出 (overshoot)。
- **1.4s 起** 8 条曲线 link (sage `#B8C9BA`, stroke-dasharray draw) 从中心错峰描出。
- **1.9s 起** 8 个外围节点 (sage 绿, r=22) 错峰 pop (scale 0→1, overshoot)。
- **2.0s 起** 整个放射图进入 7s 慢漂浮循环 (translateY 微动)。

【配色纪律】米色 `#EFEAE0` / 暖白卡 / sage 绿 `#7A9E7F`·`#B8C9BA` / 陶土橙 `#C98A5E` / 暖灰文字。**禁止**高饱和科技蓝/紫。绿是结构色, 橙是强调色 (核心节点 + 标题 accent 词)。

【内容纪律】
- 节点图是"艺术品", 节点数 4-8 按内容调 (改 SVG 里 node/link 数量 + 角度)。
- 必须用真实概念/关系, 严禁 lorem ipsum。
- 动效用 `@keyframes` + SVG stroke-dashoffset, `prefers-reduced-motion` 下全部停在终态。
- 单文件 HTML。
