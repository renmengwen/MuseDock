# MuseDock

MuseDock 是一个本地优先的内容采集、素材整理和 AI 创作工作台。它把抖音内容采集、评论缓存、素材准备、音频转写、AI 拆解改写、TTS 口播、AI 分镜、人工校正和 HyperFrames MP4 渲染串在同一个 Web GUI 里，适合把短视频素材沉淀为可复用的本地创作资产。

当前主链路以抖音为主；小红书保留搜索、详情和历史入口，后续再补齐评论、素材与成片链路。

## 当前能力

- **内容采集**：支持抖音扫码登录、关键词搜索、视频 ID/链接抓取、作者主页视频抓取；支持小红书关键词搜索和笔记详情读取。
- **评论缓存**：支持抖音一级评论和二级评论抓取，结果写入本地 SQLite，并在抓取记录里展示缓存状态和数量。
- **素材工作台**：支持抖音视频下载、音频抽取、关键帧抽取、素材状态查看，可从记录页跳转并自动准备 AI 所需素材。
- **音频转写**：接入小米 MiMo ASR，支持大音频压缩；压缩后仍超限时会自动切片、逐段转写并合并结果。
- **AI 工作台**：基于本地素材、转写文本和评论缓存执行 Agent，目前内置“爆款拆解 + 改写脚本”和“评论洞察”两类任务。
- **可编辑 Agent 模板**：支持编辑任务 Agent 与分镜 Agent 的 `system prompt`、`user prompt` 模板和模型参数，支持预览 messages、保存本地覆盖配置、恢复默认配置。
- **运行记录与调试信息**：Agent 运行会保存模板快照、最终 messages、原始模型输出、解析状态和校验结果，便于复盘和排错。
- **TTS 口播与短语字幕时间轴**：基于 MiMo TTS 按句合成口播音频，使用 `ffprobe` 读取真实分段时长，并保存 `tts.captions` 与 `tts.phrase_captions`，用于“读到哪一块就显示哪一块”的短语级动效。
- **AI 分镜与人工校正**：文字模型生成原创视觉分镜、`caption_indexes`、`visual_scene` DSL 和 `caption_block_id` 绑定，后端根据 TTS 时间轴计算最终分镜时间；页面支持编辑分镜标题、字幕索引、视觉类型、布局、背景提示和强调词。
- **HyperFrames 三层成片链路**：任务 Agent 生成 `video_brief`，分镜 Agent 作为 HyperFrames 视觉导演自动选择 `visual_type` 并输出 `visual_scene` DSL，渲染层消费 DSL 生成 HTML/CSS/GSAP 视频工程和 MP4，并写入 `video_quality_report` 作为渲染前质量门禁。
- **模型配置**：设置页支持 ASR、文字模型、TTS、图片生成、视频生成和多模态模型配置。
- **持久化页面状态**：主要页面在路由切换时保留工作区状态，减少来回查看素材、AI 运行和设置时的重复加载。

## 产品工作流

1. 打开 MuseDock，完成抖音扫码登录。
2. 在“采集”页通过关键词、视频链接或作者主页抓取内容。
3. 在“记录”页查看抓取结果、缓存评论，并跳转到素材工作台。
4. 在“素材”页准备本地视频、音频、关键帧和分析输入。
5. 执行音频转写，生成 `transcript.json`。
6. 在“AI 工作台”加载 `aweme_id`，选择任务 Agent。
7. 按需编辑 Agent 模板，或直接运行“爆款拆解 + 改写脚本”“评论洞察”。
8. 在“配音”页选择音色和语气，执行 TTS 合成并生成句级字幕与短语级字幕时间轴。
9. 在“成片”页生成 AI 分镜，必要时展开分镜列表进行人工校正。
10. 选择渲染参数，生成 HyperFrames 视频工程；质量报告通过后再渲染 MP4。

最终视频通常生成在：

```text
data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes/output.mp4
```

## HyperFrames 成片设计

MuseDock 的成片链路不是简单字幕卡片拼接，而是分为三层：

- **任务 Agent 层**：把素材、评论和转写结果整理成脚本，同时生成 `video_brief`，约束目标时长、目标字数、叙事节奏、hook 和段落 beats。
- **分镜 Agent 层**：以“HyperFrames 视觉导演 / DOM/CSS/GSAP 专家”为角色，依据脚本、字幕索引、短语字幕和 `video_brief` 自动选择 `visual_type`，并输出结构化 `visual_scene` DSL。涉及代码、报错、运行结果或修复过程时，会优先生成 `code_panel` / `code_walkthrough` 这类代码与终端画面。
- **渲染层**：后端规范化分镜，生成 HyperFrames HTML/CSS/GSAP 工程，支持 workflow、code_panel、ui_mockup、split_compare、concept_map、timeline、quote_burst 以及旧版卡片类型的兼容渲染。`phrase_kinetic` 模式会用 `caption_block_id` 把视觉 beat 对齐到短语字幕起点，而不是把列表和枚举内容一次性铺满。
- **质量门禁层**：生成工程后会分析 `project.json`、`storyboard.json`、`captions.json` 和最终 HTML，检查时长、视觉类型丰富度、短语字幕同步、无效 `caption_block_id`、未绑定视觉对象、卡片化布局过度等问题；报告未通过时渲染 MP4 会被阻断。

`visual_type` 默认由 AI 自动抉择，用户不需要手动指定。后端会对白名单、字幕索引、短语字幕引用、场景结构和 DSL 做校验与 fallback，尽量保证最终画面可渲染、字幕完整覆盖，并减少“PPT 卡片轮播”的成片感。

## 关键约束

- 最终成片默认生成原创图文 + 动效画面，不直接复用原视频、原视频帧、关键帧截图或原视频背景。
- Agent 输出必须经过后端解析、规范化和校验；前端可编辑配置，但运行记录会保存实际使用的配置快照。
- AI 分镜只负责视觉结构和字幕引用，不直接决定最终时间轴。
- 最终时间轴以 `tts.captions` 和 `tts.phrase_captions` 为准，由后端统一计算 `start`、`end` 和 `duration`。
- `渲染 MP4` 不重新请求大模型，只使用已保存的分镜、字幕、音频和 `video.render_options`。
- 如果 AI 分镜输出无效、遗漏字幕或引用不存在的字幕索引，后端会 normalize/fallback，尽量保证字幕完整覆盖。
- 如果 `video_quality_report.pass` 为 `false`，后端会拒绝进入 MP4 渲染，要求先重新生成分镜或调整视频工程。

## 技术栈

- 前端：React、React Router、Vite
- UI：Tailwind CSS、本地 shadcn 风格组件、lucide-react
- 后端：Node.js 22、Express
- 数据库：SQLite、better-sqlite3
- 浏览器自动化：Playwright、Chrome CDP
- 媒体处理：ffmpeg、ffprobe、`@ffmpeg-installer/ffmpeg`
- AI 能力：OpenAI-compatible 文字模型、小米 MiMo ASR/TTS
- 视频渲染：HyperFrames CLI、GSAP、HTML/CSS

## 环境要求

- Node.js 22
- npm
- Google Chrome
- ffmpeg
- ffprobe

项目在 `package.json#engines` 中约束 Node.js 22。切换 Node 版本后建议重新安装依赖：

```powershell
npm install
```

如果 `better-sqlite3` 出现 ABI 不匹配，可执行：

```powershell
npm rebuild better-sqlite3
```

`ffmpeg` 会优先读取 `FFMPEG_PATH`，其次使用项目依赖内置路径，最后尝试系统 `PATH`。`ffprobe` 用于读取 TTS 分段音频时长，建议安装到系统 `PATH`，或通过 `FFPROBE_PATH` 指定。

## 安装与启动

```powershell
npm install
npm run build:frontend
npm run start
```

启动后打开：

```text
http://localhost:3000
```

开发前端时可单独启动 Vite：

```powershell
npm run dev:frontend
```

## 常用命令

```powershell
# 启动 Express 服务和已构建前端
npm run start

# 启动 Vite 前端开发服务
npm run dev:frontend

# 构建前端
npm run build:frontend

# 运行完整回归测试
npm test

# Agent 与成片链路常用专项测试
node tests/test-agent-template-overrides.js
node tests/test-agent-runs.js
node tests/test-ai-tts-model.js
node tests/test-phrase-timeline.js
node tests/test-video-quality-report.js
node tests/test-storyboard-schema.js
node tests/test-storyboard-agent.js
node tests/test-hyperframes-visual-dsl.js
node tests/test-hyperframes-scene-renderers.js
node tests/test-hyperframes-project.js
node tests/test-hyperframes-renderer.js

# 分析已生成的 HyperFrames 工程质量报告
node scripts/analyze-video-quality.js data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes
```

## 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `MEDIACRAWLER_DB_PATH` | SQLite 数据库路径 | `data/mediacrawler.db` |
| `OPENAI_API_KEY` | OpenAI-compatible 服务 API Key | 空 |
| `ASR_API_KEY` | ASR 服务 API Key | 空 |
| `ASR_PROVIDER` | ASR 服务提供商，MiMo 填 `mimo` | 空 |
| `MIMO_API_KEY` | 小米 MiMo API Key，未配置时可回退读取 `ASR_API_KEY` | 空 |
| `MIMO_BASE_URL` | 小米 MiMo API Base URL | `https://api.xiaomimimo.com/v1` |
| `MIMO_ASR_MODEL` | 小米 MiMo ASR 模型 ID | `mimo-v2.5-asr` |
| `MIMO_TTS_MODEL` | 小米 MiMo TTS 模型 ID | `mimo-v2.5-tts` |
| `ASR_LANGUAGE` | MiMo ASR 识别语言，支持 `auto`、`zh`、`en` | `auto` |
| `FFMPEG_PATH` | 手动指定 ffmpeg 可执行文件路径 | 空 |
| `FFPROBE_PATH` | 手动指定 ffprobe 可执行文件路径 | 空 |

文字模型按 OpenAI-compatible `POST /chat/completions` 调用。DeepSeek、OpenAI 或自定义兼容服务都可以通过设置页配置供应商、Base URL、模型 ID 和 API Key。

## 本地数据

MuseDock 会在本地生成运行数据：

- `data/mediacrawler.db`：SQLite 数据库
- `data/media/douyin/<aweme_id>/`：抖音视频素材目录
- `data/media/douyin/<aweme_id>/transcript.json`：音频转写结果
- `data/media/douyin/<aweme_id>/agent_runs/`：Agent 运行结果、TTS 音频、字幕时间轴、HyperFrames 工程、`project.json` 质量报告和 MP4
- `data/config/agent_templates.json`：本地保存的 Agent 模板覆盖配置
- `chrome-user-data/`：Chrome CDP 使用的本地浏览器数据
- `douyin-cookies.json`：抖音 Cookie 持久化文件

这些文件通常不适合提交到公开仓库。协作或开源前请确认 `.gitignore` 已排除本地数据库、浏览器缓存、Cookie 和媒体产物。

## 目录结构

```text
.
+-- frontend-react/      # React + Vite 前端源码
+-- frontend-dist/       # 前端构建产物
+-- server/              # Express 服务、路由、抓取器和业务服务
|   +-- routes/          # API 路由
|   +-- scraper/         # 抖音、小红书抓取逻辑
|   +-- services/        # 数据存储、媒体处理、AI 配置、Agent、分镜和视频工程服务
|   +-- state/           # 运行时 Cookie 状态
+-- data/                # SQLite 数据库、本地媒体素材和本地配置
+-- docs/                # 项目文档、计划和交接记录
+-- test-*.js            # 回归测试脚本
```

## API 概览

### 抖音

- `POST /api/douyin/qrcode-login`：启动扫码登录
- `GET /api/douyin/login-status`：检查扫码登录结果
- `GET /api/douyin/check-login`：检查当前登录态
- `GET /api/douyin/search?keyword=...&max=20`：关键词搜索
- `GET /api/douyin/aweme?ids=...`：按视频 ID 或链接抓取详情
- `GET /api/douyin/creator?sec_uid=...&max=20`：抓取作者主页视频
- `GET /api/douyin/comments?aweme_id=...`：抓取评论和二级评论
- `GET /api/douyin/comments/local?aweme_id=...`：读取本地评论缓存

### 素材

- `POST /api/media/douyin/:aweme_id/prepare`：准备视频、音频和关键帧
- `GET /api/media/douyin/:aweme_id/status`：查看素材状态
- `POST /api/media/douyin/:aweme_id/transcribe`：触发音频转写

### AI Agent

- `GET /api/agents/templates`：读取可编辑任务 Agent 模板列表
- `GET /api/agents/templates/:id`：读取单个任务 Agent 模板
- `PUT /api/agents/templates/:id`：保存任务 Agent 模板覆盖配置
- `DELETE /api/agents/templates/:id/override`：恢复任务 Agent 默认配置
- `GET /api/agents/storyboard-template`：读取分镜 Agent 配置
- `PUT /api/agents/storyboard-template`：保存分镜 Agent 覆盖配置
- `DELETE /api/agents/storyboard-template/override`：恢复分镜 Agent 默认配置
- `POST /api/agents/messages/preview`：预览任务 Agent messages
- `POST /api/agents/storyboard-messages/preview`：预览分镜 Agent messages
- `POST /api/agents/douyin/:aweme_id/runs`：执行抖音素材的 Agent 任务
- `GET /api/agents/douyin/:aweme_id/runs`：读取素材的 Agent 运行记录
- `GET /api/agents/douyin/:aweme_id/runs/:run_id`：读取单次 Agent 运行详情
- `POST /api/agents/douyin/:aweme_id/runs/:run_id/tts`：生成 TTS 音频和字幕时间轴
- `GET /api/agents/douyin/:aweme_id/runs/:run_id/tts/:file_name`：读取生成的 TTS 音频
- `POST /api/agents/douyin/:aweme_id/runs/:run_id/storyboard`：生成 AI 分镜
- `PUT /api/agents/douyin/:aweme_id/runs/:run_id/storyboard`：保存人工编辑后的分镜
- `POST /api/agents/douyin/:aweme_id/runs/:run_id/hyperframes/project`：生成 HyperFrames 视频工程
- `POST /api/agents/douyin/:aweme_id/runs/:run_id/hyperframes/render`：渲染 MP4
- `GET /api/agents/douyin/:aweme_id/runs/:run_id/hyperframes/files/:file_name`：读取生成的 MP4

`promptOptions`、`storyboardOptions`、`agentConfigOverride`、`storyboardConfigOverride` 和 `renderOptions` 都会在后端做校验、清洗或合并。当前 `renderOptions` 字段示例：

```json
{
  "resolution": "1080x1920",
  "fps": "30",
  "captionSize": "medium",
  "motionLevel": "medium",
  "showCaptionBar": true,
  "showSceneNumber": true,
  "quality": "standard"
}
```

### 配置与历史

- `GET /api/history/douyin`：读取抖音抓取记录，并附带素材、转写和评论缓存状态
- `GET /api/history/xhs`：读取小红书抓取记录
- `GET /api/config/ai-models`：读取 AI 模型配置
- `POST /api/config/ai-models`：保存 AI 模型配置

## 测试与验证

完整回归测试：

```powershell
npm test
```

前端发布前请运行：

```powershell
npm run build:frontend
```

关键链路专项测试：

```powershell
node tests/test-agent-template-overrides.js
node tests/test-agent-runs.js
node tests/test-phrase-timeline.js
node tests/test-video-quality-report.js
node tests/test-storyboard-schema.js
node tests/test-storyboard-agent.js
node tests/test-hyperframes-visual-dsl.js
node tests/test-hyperframes-scene-renderers.js
node tests/test-hyperframes-project.js
node tests/test-hyperframes-renderer.js
```

## 路线图

- 增加真实任务队列和后端进度推送，替代前端估算进度。
- 扩展更多 Agent 模板，例如选题生成、小红书改写、分镜脚本和素材复盘。
- 补齐小红书评论、素材准备和 AI 工作流。
- 引入图片生成或原创视觉素材生成，同时继续避免复用原视频画面。
- 增加端到端测试、CI 和更清晰的部署文档。

## 免责声明

MuseDock 仅用于学习、研究和本地内容工作流整理。使用者应遵守目标平台的服务条款、robots 协议、版权规则和所在地法律法规。请勿将本项目用于未授权的数据采集、隐私侵犯、批量骚扰或其他不当用途。

## License

MuseDock 基于 [Apache License 2.0](./LICENSE) 开源。
