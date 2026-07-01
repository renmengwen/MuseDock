# OpenMontage 分析与 MuseDock 口播模式方向

日期：2026-07-02

## 背景

本次讨论围绕 [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage) 展开。用户认为 OpenMontage 的方向很好，希望结合当前 MuseDock 代码判断下一步产品和工程方向。

结论是：OpenMontage 最值得借鉴的不是“多接几个视频模型”，而是把 AI 视频生产做成一条可审计、可恢复、可质检的生产线。MuseDock 不适合照搬 OpenMontage 的 agent-first 架构，更适合吸收它的 pipeline、artifact、能力检查和质量门禁思想，并落到现有 Web GUI、一键创作、html-video 工程和二次编辑器里。

## OpenMontage 的核心价值

OpenMontage 的强项主要有：

1. Pipeline-first  
   视频生产被拆成 `research -> proposal -> script -> scene_plan -> assets -> edit -> compose -> publish`，每一步都有产物、质量标准和 checkpoint。

2. Artifact-first  
   它把 `brief`、`script`、`scene_plan`、`asset_manifest`、`edit_decisions`、`render_report` 等作为正式产物。失败时可以定位是哪一层坏了，而不是重新问一遍 AI。

3. Tool registry / capability envelope  
   每个工具声明能力、依赖、provider、运行环境、成本、fallback、适合什么、不适合什么。系统可以回答当前机器和配置到底能做什么视频。

4. Provider selector  
   工具选择不是硬编码，而是按任务适配度、质量、控制力、可靠性、成本、延迟和连续性打分。

5. 质量门禁  
   包括 slideshow risk、delivery promise、ffprobe、帧抽样、音频分析、字幕检查和渲染后 review，用来避免把“AI PPT”当成成片交付。

6. Reference video entry point  
   用户提供参考视频后，系统先分析 transcript、节奏、镜头、结构和风格，再给出差异化改编方案。

7. 真实视频路径  
   OpenMontage 明确区分真实 footage 视频和几张图做 Ken Burns 的伪视频，这对短视频平台内容质量判断很重要。

## 为什么不直接照搬 OpenMontage

OpenMontage 的定位是 AI coding assistant 作为 orchestrator：Agent 读 YAML、读 Markdown skill、调用 Python tool 并推进 pipeline。

MuseDock 的定位应该是 GUI-first：普通用户在 Web 界面里输入主题或链接，一键生成、查看进度、失败恢复和二次编辑。

不建议直接照搬的原因：

- 用户体验不同：OpenMontage 面向 coding assistant 用户，MuseDock 应面向普通创作者。
- 技术栈不同：OpenMontage 是 Python tools + Remotion/HyperFrames；MuseDock 当前是 Node/Express + React/Vite + HTML/CSS/GSAP + Playwright + ffmpeg。
- 许可证风险：OpenMontage 是 AGPLv3，MuseDock 是 Apache-2.0。可以学习架构思想，不应直接复制代码、schema、skill 文案或工具实现。
- MuseDock 已经有一半基础：创作任务、SSE、`generation_checkpoint`、HTML 视频工程、layout QA、视觉巡检、失败恢复和编辑器都已存在。

## MuseDock 当前已有基础

当前 MuseDock 已有：

- `/creative` 一键创作入口
- `/creative/:workflowId` 任务详情、SSE 进度和失败恢复
- `/editor/:workflowId` html-video 工程编辑器
- `sourceFetch` 读取文章和 GitHub 仓库信息
- `sourceAssets` 从 Markdown 提取图片并下载为本地素材
- `asset_context` 写入 `analysis_input` 和 `creative_context`
- `scene_spec -> content graph -> raw HTML frames -> frame render -> compose -> inspect`
- TTS、ASR、抖音素材准备、抽音频、抽帧、转写接口骨架
- Playwright 渲染 HTML 动画和 ffmpeg 合成
- `generation_checkpoint` 子阶段状态与恢复

## 关于 Markdown 图片提取能力的确认

用户指出“从 md 中提取图片”之前已经做过。核查代码后确认：这个能力确实已实现，而且已经接入主创作链路。

已存在链路：

```text
sourceFetch 读取网页/文章/GitHub
-> htmlToMarkdown 把 <img> 转成 ![alt](src)
-> sourceAssets.extractMarkdownImages 提取 Markdown 图片
-> sourceAssets.prepareSourceAssets 下载图片到 workflow assets
-> creativeSourcePrep.prepareSourceAssetContext 写入 asset_context
-> htmlVideoWorkflow.materializeCreativeContextAssets 复制到 html-video 工程 assets
-> contentGraphAgent / frameHtmlAgent 在 prompt 中提示可使用这些图片
```

所以准确说法不是“下一步要做图片提取”，而是：

```text
复用现有正文与图片资产管线，补齐 asset_manifest、使用可见性和质量门禁。
```

当前缺口：

- 没有稳定的 `asset_manifest` 产品化 artifact。
- 用户不容易看到系统提取了哪些图片、哪些下载失败、哪些被用于成片。
- 最终视频是否使用图片主要靠 AI 自觉，没有强约束和使用统计。
- 仍有旧文案提示“图片素材将在下一阶段开放”，这主要指手动传入 `assetIds` 的入口未开放，不代表自动文章图片管线没做。
- 普通文章/GitHub source_url 当前主要提取正文和图片，不是网页视频素材；抖音来源的视频下载、抽音频、抽帧是另一条已有链路。

## OpenMontage 的数字人实现

OpenMontage 的“数字人”不是完整商用数字人 SaaS，而是分成两层：

```text
1. 先生成或准备一段会说话的人物视频
2. 再用 Remotion 把人物视频、字幕、信息卡、CTA、图表等叠加成最终口播片
```

它的 `avatar-spokesperson` pipeline 会先明确 avatar path：

| 路径 | 输入 | 做法 | 工具 |
| --- | --- | --- | --- |
| `photo_talking_head` | 人物照片 + 口播音频 | 用 SadTalker 把照片驱动成说话视频 | `talking_head` |
| `presenter_plate_lip_sync` | 已有人脸视频 + 新音频 | 用 Wav2Lip 重新对口型 | `lip_sync` |
| `platform_avatar` | 外部平台生成好的 avatar 视频 | 作为素材进入后续合成 | 外部生成或 video provider |

### 本地照片驱动：SadTalker

`tools/avatar/talking_head.py` 的输入是：

```text
image_path
audio_path
output_path
model = sadtalker / musetalk
```

实际主要跑 SadTalker：

```text
SADTALKER_PATH
-> python inference.py
   --driven_audio <audio>
   --source_image <image>
   --result_dir <dir>
   --expression_scale <value>
   --preprocess crop/resize/full
-> 输出 mp4
```

注意：`musetalk` 在当前代码里只是占位，未真正实现。

### 已有视频换口型：Wav2Lip

`tools/avatar/lip_sync.py` 的输入是：

```text
video_path
audio_path
output_path
model = wav2lip / wav2lip_gan
```

实际跑：

```text
WAV2LIP_PATH
-> checkpoints/wav2lip.pth
-> python inference.py
   --checkpoint_path <checkpoint>
   --face <video>
   --audio <audio>
   --outfile <output>
```

适合已有真人或数字人底片，重新配音并对口型。

### 云端数字人

OpenMontage 有 `heygen_video` 工具，但它更像云视频生成网关，能力是 `text_to_video`、`image_to_video` 和 provider selection。它不是一个完整的 HeyGen avatar API 封装，没有看到成熟的 `avatar_id + script -> talking avatar video` 业务流程。

判断：OpenMontage 预留了 HeyGen/云视频入口，但实际 avatar-spokesperson 主路径仍是本地 SadTalker/Wav2Lip 或外部已生成 avatar 视频导入。

### 最终合成：Remotion TalkingHead

OpenMontage 的 `remotion-composer/src/TalkingHead.tsx` 结构是：

```text
Layer 1: OffthreadVideo 全屏播放 presenter video
Layer 2: overlays 信息卡 / 图表 / callout / 对比卡 / 大标题等
Layer 3: CaptionOverlay 字幕，永远在最上层
```

它支持：

```text
text_card
stat_card
callout
comparison
bar_chart
line_chart
pie_chart
kpi_grid
hero_title
section_title
stat_reveal
```

位置包括：

```text
lower_third
upper_third
left_panel
right_panel
full_overlay
```

`avatar-spokesperson` pipeline 明确锁定 `render_runtime = remotion`，因为它依赖 Remotion `TalkingHead` composition 和 caption burn，HyperFrames 暂时没有同等能力。

## 用户期望的 MuseDock 产品形态

用户明确希望：

```text
用户输入一段提示词，或粘贴文章/GitHub 链接
-> 选择数字人模式/口播模式
-> 一键成片
```

这个方向成立，并且应该成为 MuseDock 的核心一键产品形态之一。

更推荐的模式命名：

```text
口播模式
```

副标题可以是：

```text
AI 主播 + 大字字幕 + 来源图片，一键生成短视频
```

不建议主入口直接叫“数字人模式”，因为“数字人”容易绑定某个 avatar provider。未来如果支持用户上传真人口播、录屏讲解或纯配音图文，口播模式这个名字更稳。

## 口播模式目标链路

产品上对用户应保持简单：

```text
输入主题 / 文章链接 / GitHub 链接
-> 选择口播模式
-> 选择默认主播或上传人物素材
-> 点击生成口播视频
```

内部流程：

```text
input
-> sourceFetch / source prep
-> sourceAssets 图片资产
-> source understanding / research 可选
-> talking script
-> scene_spec + overlay_plan
-> TTS
-> presenter video
-> html-video project
-> render
-> inspect
-> editor
```

画面结构：

```text
底层：全屏 presenter / AI 主播视频
中层：巨大关键词、列表、来源图片、GitHub 信息卡
上层：字幕、强调词、标签
音频：口播音频 + 背景音乐
```

口播模式和快速模式的区别：

| 模式 | 主体 | 画面重点 |
| --- | --- | --- |
| 快速模式 | 图文动效 | 知识卡、信息流、图文讲解 |
| 口播模式 | 人物/主播 | 人物主体、大字关键词、字幕、来源图片浮层 |

## 关键产品边界

口播模式可以一键，但不能假装没有数字人能力也能生成数字人口播。

如果用户选择口播模式，而数字人能力未配置，应明确提示：

```text
当前未配置 AI 主播服务，无法生成数字人口播视频。
你可以：
1. 配置 AI 主播服务
2. 上传一段人物口播底片
3. 改用纯配音图文视频
```

不要静默降级成普通图文视频。否则用户点的是口播/数字人模式，成片却像 PPT，会损伤信任。

## 建议的最小实现

第一版只做：

```text
口播模式 v1：
用户输入提示词 / 文章 / GitHub
-> 系统生成口播稿
-> TTS 生成音频
-> 调一个数字人 provider 生成 presenter.mp4
-> 用现有 html-video 工程叠加大字、字幕、来源图片
-> 渲染导出
```

第一版限制：

```text
一个默认主播
一个默认竖屏比例 9:16
一个默认 TTS voice
一个数字人 provider
最多 60-90 秒
```

暂时跳过：

```text
多主播市场
声音克隆
多语言
换装
复杂动作
透明背景
多机位
批量生成
```

## 推荐工程设计

新增一个薄的 presenter provider adapter，不要一开始做复杂 selector：

```text
server/services/presenter/presenterProvider.js
```

接口可以是：

```js
generatePresenterVideo({
  scriptText,
  audioPath,
  avatarId,
  voiceId,
  outputPath,
  aspectRatio,
})
```

返回：

```js
{
  success: true,
  video_path: ".../presenter.mp4",
  provider: "...",
  avatar_id: "...",
  duration_sec: 58.2
}
```

第一版只接一个 provider。等默认 provider 跑通，再考虑第二个 provider 和 selector。

html-video 工程里可以增加一个底层 presenter asset：

```json
{
  "assets": [
    {
      "id": "presenter_video",
      "type": "video",
      "path": "assets/presenter.mp4",
      "role": "presenter_base"
    }
  ]
}
```

每帧 HTML 或项目层统一引用：

```html
<video class="presenter-base" src="../assets/presenter.mp4"></video>
<div class="keyword-layer">自动采集</div>
<div class="caption-layer">...</div>
```

## 质量门禁

口播模式的质量门禁应不同于普通图文视频：

```text
必须有 presenter video
字幕不能遮挡嘴部
大字不能长期遮挡脸
来源图片不能全屏轮播
来源图片应与讲解节点、关键词或信息卡混排
每 5-8 秒有视觉变化
结尾有明确收束
音频不静音、不爆音
渲染后视频可播放
```

如果缺少 `presenter.mp4`，不能把任务标记为口播模式成功。

## 建议落地顺序

1. 新增 `talking_presenter` / `口播模式` mode。
2. 在创作页增加“口播模式”选项。
3. 增加 presenter provider adapter，只接一个默认 provider。
4. 生成 `presenter.mp4` 后放进现有 html-video project assets。
5. 写口播专用 HTML 生成提示：全屏人物 + 大字 + 字幕 + 来源图片浮层。
6. 加最小质量检查：没有 `presenter.mp4` 就不允许标记口播模式成功。
7. 在任务详情页展示口播模式的关键产物：口播稿、音频、主播视频、来源图片、导出视频。
8. 稳定后再补 provider selector、主播管理、多语言和声音克隆。

## 最终方向

MuseDock 下一步最适合走：

```text
GUI-first 的 OpenMontage 式短视频生产台
```

具体落点是：

```text
公共素材资产管线
+ 口播模式
+ 参考视频拆解
+ 质量门禁
+ 可编辑 html-video 工程
```

最重要的是把“数字人生成”和“口播视频包装”分离：

```text
avatar generation / presenter video
和
final composition / overlay / subtitles
```

这样即使某个数字人 provider 不可用，MuseDock 仍然可以支持：

```text
真人口播视频包装
数字人视频包装
录屏讲解包装
文章/GitHub 口播包装
```

第一阶段不要重构成完整 OpenMontage，也不要裸接一堆数字人 API。先把一个默认口播模式跑通，并让成片质量稳定、失败可恢复、结果可编辑。
