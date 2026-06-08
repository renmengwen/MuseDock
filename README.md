# MuseDock

MuseDock 是一个本地优先的内容采集、素材整理和 AI 创作工作台。项目当前以抖音链路为主，把内容抓取、评论缓存、本地素材准备、音频转写、AI Agent 创作、TTS 口播音频和字幕时间轴串在同一个 Web GUI 里，适合创作者、运营和研究者把分散的平台内容整理成可复用的分析、脚本和选题素材。

> 小红书能力目前保留搜索和详情入口，完整素材工作流仍以抖音为主。

## 主要能力

- **内容抓取**：支持抖音关键词搜索、视频 ID/链接抓取、作者主页视频抓取；支持小红书关键词搜索和笔记详情读取。
- **评论采集与缓存**：支持抖音一级评论和二级评论抓取，并写入本地 SQLite，抓取记录页会展示评论缓存状态和数量。
- **素材工作台**：支持抖音视频下载、音频抽取、关键帧抽取、本地素材状态查看；可从抓取记录跳转并自动准备 AI 素材。
- **音频转写**：接入小米 MiMo ASR，支持大音频自动压缩；压缩后仍超限时会自动切片并合并转写结果。
- **AI 工作台**：读取本地素材、转写文本和评论缓存，执行可控 Agent，当前支持爆款拆解、改写脚本和评论洞察等模板。
- **TTS 口播与字幕时间轴**：基于 MiMo TTS，把改写脚本按句切分、逐句合成、用 `ffprobe` 读取每段时长，并保存可复用的 `captions` 字幕时间轴。
- **AI 模型配置**：设置页支持 ASR、文字模型、TTS、图片生成、视频生成和多模态模型配置。
- **本地 Web GUI**：React + Vite 前端，Express 后端，默认运行在 `http://localhost:3000`。

## 技术栈

- 前端：React、React Router、Vite
- UI：Tailwind CSS、本地 shadcn 风格组件、lucide-react
- 后端：Node.js 22、Express
- 数据库：SQLite、better-sqlite3
- 浏览器自动化：Playwright、Chrome CDP
- 媒体处理：ffmpeg、ffprobe、`@ffmpeg-installer/ffmpeg`
- AI 能力：OpenAI-compatible 文字模型、小米 MiMo ASR/TTS

## 快速开始

### 环境要求

- Node.js 22
- npm
- Google Chrome
- ffmpeg
- ffprobe

项目包含 `.nvmrc` 和 `package.json#engines`，建议使用 Node.js 22。切换 Node 版本后请重新执行 `npm install`；如果 `better-sqlite3` 出现 ABI 不匹配，可执行：

```powershell
npm rebuild better-sqlite3
```

`ffmpeg` 会优先使用 `FFMPEG_PATH`，其次使用项目依赖内置路径，最后尝试系统 `PATH`。`ffprobe` 用于读取 TTS 分段音频时长，建议安装到系统 `PATH`，或通过 `FFPROBE_PATH` 指定。

### 安装依赖

```powershell
npm install
```

### 构建前端

```powershell
npm run build:frontend
```

### 启动服务

```powershell
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

## 使用流程

1. 打开 MuseDock Web GUI。
2. 在“内容抓取”页选择平台并抓取内容。
3. 抖音链路建议先完成扫码登录，MuseDock 会通过 Chrome CDP 复用本地浏览器登录态。
4. 在“抓取记录”页查看本地保存的数据、素材状态、转写状态和评论缓存状态。
5. 点击“准备 AI 素材”，进入素材工作台并自动准备视频、音频和关键帧。
6. 在素材工作台中查看视频、音频、关键帧和转写状态，点击转写可调用 MiMo ASR。
7. 在“设置”页配置 ASR、文字模型和 TTS 模型。AI 工作台需要启用文字模型；TTS 需要配置 MiMo TTS。
8. 在“AI 工作台”输入已准备素材的抖音视频 ID，加载素材状态和历史运行记录。
9. 选择 Agent 模板并执行，结果会保存到本地 `agent_runs` 目录。
10. 对包含改写脚本的运行记录点击 TTS 合成，系统会生成最终口播音频、分段音频和字幕时间轴。

## AI 与 TTS 数据结构

AI 运行结果保存在：

```text
data/media/douyin/<aweme_id>/agent_runs/<run_id>.json
```

TTS 成功后会在同一份运行记录里写入 `tts` 字段：

```json
{
  "tts": {
    "status": "done",
    "voice": "Mia",
    "style_prompt": "请使用自然、清晰、适合短视频口播的语气。",
    "format": "wav",
    "path": "data/media/douyin/<aweme_id>/agent_runs/<run_id>-tts.wav",
    "url": "/api/agents/douyin/<aweme_id>/runs/<run_id>/tts/<run_id>-tts.wav",
    "duration": 3.75,
    "segments": [
      {
        "index": 1,
        "text": "第一句。",
        "duration": 1.25,
        "path": "data/media/douyin/<aweme_id>/agent_runs/<run_id>-tts-segments/segment-001.wav"
      }
    ],
    "captions": [
      {
        "index": 1,
        "start": 0,
        "end": 1.25,
        "duration": 1.25,
        "text": "第一句。"
      }
    ],
    "model": {
      "provider": "mimo",
      "model_id": "mimo-v2.5-tts"
    }
  }
}
```

字幕时间轴由真实分段音频时长累计生成，不按字数估算，后续可供 HyperFrames 或其他视频渲染流程复用。

## 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `MEDIACRAWLER_DB_PATH` | SQLite 数据库路径 | `data/mediacrawler.db` |
| `OPENAI_API_KEY` | OpenAI-compatible 服务 API Key | 空 |
| `ASR_API_KEY` | ASR 服务 API Key | 空 |
| `ASR_PROVIDER` | ASR 服务提供商，MiMo 填 `mimo` | 空 |
| `MIMO_API_KEY` | 小米 MiMo API Key；未配置时可回退读取 `ASR_API_KEY` | 空 |
| `MIMO_BASE_URL` | 小米 MiMo API Base URL | `https://api.xiaomimimo.com/v1` |
| `MIMO_ASR_MODEL` | 小米 MiMo ASR 模型 ID | `mimo-v2.5-asr` |
| `MIMO_TTS_MODEL` | 小米 MiMo TTS 模型 ID | `mimo-v2.5-tts` |
| `ASR_LANGUAGE` | MiMo ASR 识别语言，支持 `auto`、`zh`、`en` | `auto` |
| `FFMPEG_PATH` | 手动指定 ffmpeg 可执行文件路径 | 空 |
| `FFPROBE_PATH` | 手动指定 ffprobe 可执行文件路径 | 空 |

也可以在设置页配置 AI 模型。文字模型按 OpenAI-compatible `POST /chat/completions` 调用，DeepSeek、OpenAI 或自定义兼容服务都可通过供应商、Base URL、模型 ID 和 API Key 接入。

## 目录结构

```text
.
+-- frontend-react/      # React + Vite 前端源码
+-- frontend-dist/       # 前端构建产物
+-- server/              # Express 服务、路由、抓取器和业务服务
|   +-- routes/          # API 路由
|   +-- scraper/         # 抖音、小红书抓取逻辑
|   +-- services/        # 数据存储、媒体处理、AI 配置和 Agent 服务
|   +-- state/           # 运行时 Cookie 状态
+-- data/                # SQLite 数据库和本地媒体素材
+-- docs/                # 项目文档、计划和交接记录
+-- test-*.js            # 回归测试脚本
```

## 常用命令

```powershell
# 启动后端和静态前端
npm run start

# 开发前端
npm run dev:frontend

# 构建前端
npm run build:frontend

# 运行完整测试
npm test

# AI Agent 相关测试
node test-ai-text-model.js
node test-ai-tts-model.js
node test-tts-timeline.js
node test-agent-templates.js
node test-agent-runs.js
node test-agent-run-utils.mjs
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

### 小红书

- `GET /api/xhs/search?keyword=...&max=20`：关键词搜索
- `GET /api/xhs/detail?note_id=...`：读取笔记详情

### 素材

- `POST /api/media/douyin/:aweme_id/prepare`：准备视频、音频和关键帧
- `GET /api/media/douyin/:aweme_id/status`：查看素材状态
- `POST /api/media/douyin/:aweme_id/transcribe`：触发音频转写

### AI Agent

- `GET /api/agents/templates`：读取可用 Agent 模板
- `POST /api/agents/douyin/:aweme_id/runs`：执行抖音素材的 Agent 任务
- `GET /api/agents/douyin/:aweme_id/runs`：读取素材的 Agent 运行记录
- `GET /api/agents/douyin/:aweme_id/runs/:run_id`：读取单次 Agent 运行详情
- `POST /api/agents/douyin/:aweme_id/runs/:run_id/tts`：为改写脚本生成 TTS 音频和字幕时间轴
- `GET /api/agents/douyin/:aweme_id/runs/:run_id/tts/:file_name`：读取生成的 TTS 音频

### 配置与历史

- `GET /api/history/douyin`：读取抖音抓取记录，并附带素材、转写和评论缓存状态
- `GET /api/history/xhs`：读取小红书抓取记录
- `GET /api/config/ai-models`：读取 AI 模型配置
- `POST /api/config/ai-models`：保存 AI 模型配置

## 本地数据

MuseDock 会在本地生成运行数据：

- `data/mediacrawler.db`：SQLite 数据库
- `data/media/douyin/<aweme_id>/`：抖音视频素材目录
- `data/media/douyin/<aweme_id>/audio.asr.mp3`：大音频转写时生成的低码率音频
- `data/media/douyin/<aweme_id>/asr_segments/`：ASR 自动切片目录
- `data/media/douyin/<aweme_id>/transcript.json`：音频转写结果
- `data/media/douyin/<aweme_id>/agent_runs/`：AI Agent 运行结果、TTS 音频、TTS 分段音频和字幕时间轴
- `chrome-user-data/`：Chrome CDP 使用的本地浏览器数据
- `douyin-cookies.json`：抖音 Cookie 持久化文件

这些文件通常不适合提交到公开仓库。开源或协作前请确认 `.gitignore` 已排除本地数据库、浏览器缓存、Cookie 和媒体文件。

## 测试与验证

本项目使用脚本化回归测试覆盖核心服务：

```powershell
npm test
```

常见专项验证：

```powershell
node test-media-pipeline.js
node test-media-pipeline-cache.js
node test-ai-tts-model.js
node test-tts-timeline.js
node test-agent-runs.js
```

前端发布前请运行：

```powershell
npm run build:frontend
```

## 路线图

- 增加真实任务队列和后端进度推送，替代前端估算进度。
- 扩展更多 Agent 模板，例如选题生成、小红书改写、分镜脚本和素材复盘。
- 补齐小红书评论、素材准备和 AI 工作流。
- 将 TTS 字幕时间轴接入 HyperFrames 或其他视频渲染流程。
- 增加端到端测试、CI 和更清晰的部署文档。

## 贡献

欢迎提交 Issue 和 Pull Request。建议贡献前先说明想解决的问题、复现方式或功能目标，并尽量附上验证命令或截图。

提交代码时请尽量包含：

- 清晰的问题描述或功能说明
- 必要的验证命令
- 对数据结构、接口或配置变更的说明

## 免责声明

MuseDock 仅用于学习、研究和本地内容工作流整理。使用者应遵守目标平台的服务条款、robots 协议、版权规则和所在地法律法规。请勿将本项目用于未授权的数据采集、隐私侵犯、批量骚扰或其他不当用途。

## License

MuseDock 基于 [Apache License 2.0](./LICENSE) 开源。
