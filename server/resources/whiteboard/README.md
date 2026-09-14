# 线稿白板完整制作

白板模式保留 `musedock-whiteboard-phase0-v1` 的内容合同，并在用户确认后进入独立版本化的 `musedock-whiteboard-media-v1` 媒体合同。已有阶段 0 任务可以直接开始制作；旧方案的身份和文件不因升级而改写。

## 使用步骤

1. 首次在项目根目录执行 `npm run setup:whiteboard`。它使用 Python 3.10+，在应用数据目录的 `data/runtime/whiteboard/` 安装独立环境，依赖版本固定在本目录 `requirements.txt`。
2. 确认 ffmpeg、ffprobe 和中文字体可用。Windows 默认使用微软雅黑；可通过 `FFMPEG_PATH`、`FFPROBE_PATH`、`MUSEDOCK_WHITEBOARD_FONT` 指定本机资源。可用 `MUSEDOCK_WHITEBOARD_PYTHON` 指向已有、具备相同依赖的解释器。
3. 在设置中选择图片生成模型、支持多模态输入的分析模型；使用旁白时再配置豆包或 MiniMax TTS。
4. 首页选择“线稿白板动画”，输入主题、正文或 SRT，选择视频画幅，再设置具体视觉模板、背景音乐、画笔、字幕及后续确认方式。
5. 在对话卡片中修改或确认当前方案，点击“开始制作视频”。顺序为完整旁白与字幕（无旁白时只准备字幕与时间轴）→ 线稿 → 落墨编排 → 单幕动画 → 最终成片。
6. 在产物区试听、查看图像、播放单幕和最终视频，下载 MP4、WAV、SRT 或标注 JSON。

设置改变后重新确认方案。只改字幕、画笔等设置时，服务端按输入身份重验并复用仍有效的上游产物，避免重复生成语音、图片或编排。修改指定幕时，仅使该幕的相关下游失效。

## 背景音乐

“制作设置 → 背景音乐”支持“不使用 BGM”和“使用 BGM”，默认关闭。开启后，最终成片混入内置轻钢琴曲 **First Light Particles**（Yoiyami，CC0），旁白试听和下载的完整 WAV 仍保留纯旁白。豆包与 MiniMax 共用本地混音流程，不向供应商额外请求音乐；主题、正文和 SRT 都可以只配背景音乐、不生成旁白。

音乐以 -18 dB 混入，旁白在混音时预留 -1.5 dB 峰值余量；首尾分别淡入 1.2 秒、淡出 1.8 秒，短视频自动缩短淡化区间，长视频循环音乐并按真实时长结束。素材、许可与来源记录一起放在 `assets/bgm/`，运行时不依赖外部技能目录或在线下载。

BGM 选择随内容与制作方案一起确认；修改后需重新确认，仍有效的旁白、字幕时间线、线稿、落墨标注和单幕动画可复用，最终成片重新合成。音乐素材 SHA 与混音参数绑定本次制作及成片验证记录；恢复期间若发生变化，会要求重新确认。旧任务仍默认关闭 BGM，原有渲染配方与上游产物身份不变。

## 横屏与竖屏

- 横屏 `16:9`：1920×1080，默认选项；旧任务缺少画幅字段时也按横屏读取。
- 竖屏 `9:16`：1080×1920，从分镜构图、生图、标注坐标到渲染与预览均采用纵向画布。
- 画幅通过 `input.aspectRatio` 在创建任务时确定，随方案及媒体身份保存；需要其他画幅时开启新创作，不在原任务中途切换。
- 竖屏字幕按较窄画布分段，仍保留同次语音的原生字级时间；字幕最多两行，底部预留约十分之一画面。图片规范化保留原始比例，合成拒绝混用横竖单幕。

## 豆包语音设置

在“模型配置 → 供应商配置”中填写：

- 模型 ID：`seed-audio-1.0`。
- Base URL：`https://openspeech.bytedance.com`。
- API Key：新版语音控制台的 API Key，保存后仅回传脱敏状态。
- 音色与整体表演描述：用自然语言描述声音和讲述方式；不使用 speaker ID 或参考音频。
- 语速、音量：`-50..100`；音高：`-12..12`。

应用到列表后点击“保存模型配置”，再在全局 TTS 选择中选择豆包。豆包整轨方案最多 120 秒，完整 `text_prompt` 最多 3000 字符；超限在请求前拒绝，不截断正文、不拆成逐句合成。中文、美国英语、英国英语都明确写入提示合同。

请求固定使用 `X-Api-Key`、`/api/v3/tts/create`、`audio_config.enable_subtitle=true`，只接收同次响应的 Base64 WAV 与 `subtitle.sentences[].words[]`。正式音频规范化为 24 kHz 单声道 WAV；字幕文字始终取自已确认正文，时间由原生词级证据对齐。

MiniMax 使用整轨 T2A、`subtitle_enable=true` 和 `subtitle_type=word`；不使用第二次 ASR。MiMo 现有调用继续兼容，但白板完整旁白需要原生时间证据，因此白板使用豆包或 MiniMax。

## 无旁白制作

主题、正文和 SRT 都可在“制作设置 → 旁白方式”选择“不使用旁白”，无需配置 TTS。主题与正文复用已确认方案按目标总时长和文本长度分配的字幕、分镜时间，正式产物标记为 `planned`；SRT 继续保留 `source_srt` 时间轴。无旁白流程不生成音频、不请求 ASR，仍生成可下载的 SRT，供字幕显示、落墨编排与单幕渲染共用。

开始制作前校验时间的顺序、边界和完整覆盖，每幕至少 0.8 秒，以留出绘制与片尾停留。新计划开启字幕时，每段至少显示 0.5 秒，阅读预算上限为中文每秒 10 个文字字符、英文每秒 20 个字母或数字；时间不足时提示增加时长、合并短句或减少正文，不自动改写已确认时间。输入 SRT 保留原有阅读节奏。无旁白的第一阶段显示“准备字幕与时间轴”，人工模式检查字幕与分镜时长后继续。

BGM 与旁白独立：可只使用 BGM，也可同时关闭两者输出无音轨 MP4。修改旁白选项仍须重新确认方案，后续复用或重新制作按内容和时间轴身份判断；有旁白时仍使用同次语音响应的原生时间戳。

## 完整吸收的绘制核心

`python/stream_primitives.py` 吸收上游 `stream_render.py` 的全部 53 个函数与类，包括连续路径、墨迹聚类、骨架追踪、插值、上色、笔尖叠加和单图绘制。`python/region_renderer.py` 保留完整 `RegionStreamRenderer`：

- 共享持久画布，已完成区域持续保留；
- 当前矩形减去后续区域与保护区，后续内容不提前露线；
- 骨架级连续落墨，网格路径兜底，笔尖跟随实际轨迹；
- 每幕使用局部毫秒时钟，按累计全局帧边界计算帧数；
- 首帧为暖米黄干净纸底，末尾至少停留 0.5 秒。

上游文件、来源 SHA 和本地文件 SHA 记录在 `sources.json`。画笔素材原样保留 `@moveR` 标识。运行时只使用本仓库代码和应用数据目录，不读取 Codex Skill 配置或依赖其环境。

## 状态、审阅与恢复

媒体阶段拥有冻结的阶段 schema、独立 attempt、文件 SHA、产物身份和批准。初始草案、模型候选、技术通过与批准分别保存。文件发布与任务修改共用队列，旧请求不能重建已删除任务。媒体文件接口只接受已登记的 artifact ID，重新检查路径、大小与 SHA 后提供播放或下载。

逐阶段模式在每个产物处等待确认；自动推进模式重验音频和最终媒体技术证据，视觉步骤实际调用具备图像能力的分析模型。单幕自动审阅使用有序的真实早、中、晚渲染帧与完整解码证据，记录为抽帧视觉审阅，不声称模型完整观看视频或听过旁白。人工确认绑定用户当时检查的当前产物。

构图规划先区分完整连续构图与可独立揭示的视觉簇，主体及背景墨迹都要有区域归属。落墨候选会实际计算有效墨迹覆盖率；不足 97% 时，将原始线稿、标红遗漏的预览、当前候选和像素统计用于一次定向修正。格式补正与覆盖率修正共用一次预算，每幕每轮最多两次模型请求；每次请求及其产物独立保存。修正后仍不足时等待人工选择接受或重新编排，遗漏部分不在片尾补显。修正明确失败且未产生新预览时保留原预览供审阅；结果不明仍需先核实和明确授权。新请求使用 v3 编排提示词，旧 v2 候选继续按原输入身份恢复，已完成且有效的产物与批准保持原有绑定。

明确的 400/401/403/404/422/429 返回作为可操作失败；超时、连接中断、无法绑定的响应或缺少同请求证据停为 `unknown_external_outcome`。普通重试不会重发结果不明的请求，用户需要明确同意可能的重复费用。已取得的原始音频、原生字幕和图片会保留，后处理失败优先本地恢复。若生成音频与正文不匹配，可明确选择重新生成整轨，旧版本仍保留。

落墨分镜即使没有生成预览，也可打开详情，查看本幕历次请求的状态、起止时间、耗时、候选保存情况与处理建议。新视觉请求仅记录固定类别、HTTP 状态和是否收到响应等脱敏诊断，不保存供应商原文、标识或地址；旧记录缺失的原因明确显示为未记录。达到输出上限或带有未完成标记的响应即使包含可解析 JSON，也保持结果待核实，不发布为完整候选。查看详情不触发恢复、授权或新的模型请求。

单幕执行通过 `render_worker.py` 沿用原绘制时钟、骨架顺序与保护区，仅将逐笔段的全画布扫描收窄为包含完整抗锯齿笔触的局部矩形，并通过像素对照检查等价性。约每秒上报实际写入帧数，区分准备、绘制、编码、校验与预览阶段；已完成单幕可立即查看。Windows 的旧版 FFmpeg（libavcodec 58 及更早版本，包括内置 2018 构建）使用单编码线程，避开已复现的多线程长时间等待；现代编码器保持两线程，单幕与字幕编码使用同一兼容设置。上述执行策略保留画幅、帧率、CRF、原绘制语义及产物身份，仍复用已完成且有效的单幕。达到单次处理时限时记录 `MEDIA_TIMEOUT`，取消则记录 `MEDIA_CANCELLED`。

合并时使用每幕帧数派生精确 concat 时长，避免 MP4 容器毫秒取整累积误差。最终产物检查 H.264、所选画幅（1920×1080 或 1080×1920）、60 fps、yuv420p、累计帧数、音画时长、AAC/24 kHz/单声道以及完整解码，不用补帧或 `-shortest` 掩盖时钟错误。

## 本地验证

```powershell
node tests/test-whiteboard-phase0.js
node tests/test-whiteboard-silent-timing.js
node tests/test-whiteboard-bgm.js
node tests/test-doubao-tts.js
node tests/test-whiteboard-model-contracts.js
node tests/test-whiteboard-vision-diagnostics.js
node tests/test-whiteboard-render-progress.js
data/runtime/whiteboard/Scripts/python.exe -X utf8 tests/test-whiteboard-render-worker.py
node tests/test-whiteboard-canvas.js
node tests/test-whiteboard-annotation-planning.js
data/runtime/whiteboard/Scripts/python.exe -X utf8 tests/test-whiteboard-render-core.py
node tests/test-whiteboard-media.js
node tests/test-whiteboard-media.js --silent
node tests/test-whiteboard-media.js --portrait
npm run build:frontend
node scripts/debug/whiteboard-ui-smoke.cjs
node scripts/debug/whiteboard-ui-smoke.cjs --bgm
node scripts/debug/whiteboard-ui-smoke.cjs --silent
node scripts/debug/whiteboard-media-ui-smoke.cjs
node scripts/debug/whiteboard-media-ui-smoke.cjs --portrait
```

这些自动验证使用隔离存储与模型替身，真实执行绘制、ffmpeg、播放器和下载。`scripts/debug/whiteboard-live-verify.cjs --live` 是独立的真实调用验收入口，可能计费，不属于 `npm test`；结果和去敏请求记录保存在 `.codex-runtime/whiteboard-live-verification/`，真实 provider 证据与本地 fixture 分开报告。

对话卡片适配自 `nexu-io/html-video` 的选项、表单与确认交互（提交 `c414ecc07f795add03807d5d9ce4baefd807cea2`）；React/shadcn 组件使用服务端持久化的交互 ID、版本身份和回答状态，不从聊天文字猜测批准。
