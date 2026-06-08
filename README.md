# MuseDock

MuseDock 是一个本地优先的内容采集、素材整理和 AI 创作工作台。当前主流程面向抖音内容：从抓取视频、缓存评论、准备本地素材、音频转写，到 AI 爆款拆解、改写脚本、TTS 口播、AI 分镜、HyperFrames 渲染 MP4，都可以在同一个 Web GUI 中完成。

> 小红书能力目前保留搜索和详情入口；完整素材和成片工作流仍以抖音为主。

## 主要能力

- **内容抓取**：支持抖音关键词搜索、视频 ID/链接抓取、作者主页视频抓取；支持小红书关键词搜索和笔记详情读取。
- **评论采集与缓存**：支持抖音一级评论和二级评论抓取，并写入本地 SQLite，抓取记录页会展示评论缓存状态和数量。
- **素材工作台**：支持抖音视频下载、音频抽取、关键帧抽取、本地素材状态查看，并可从抓取记录跳转自动准备 AI 素材。
- **音频转写**：接入小米 MiMo ASR，支持大音频自动压缩；压缩后仍超限时会自动切片并合并转写结果。
- **AI 工作台**：读取本地素材、转写文本和评论缓存，执行可控 Agent，当前支持爆款拆解 + 改写脚本、评论洞察等模板。
- **受控创作 brief**：脚本生成、评论洞察和 AI 分镜支持固定输入框补充目标、受众、风格、禁用方向等参数；后端会清洗并注入固定 prompt，不提供完整 prompt 编辑器。
- **TTS 口播与字幕时间轴**：基于 MiMo TTS，把改写脚本按句切分、逐句合成、用 `ffprobe` 读取每段真实时长，并保存可复用的 `tts.captions`。
- **AI 分镜**：文字大模型只生成原创视觉分镜结构和 `caption_indexes`，不决定最终时间轴；后端根据 `tts.captions` 计算每个 scene 的 `start/end/duration`。
- **HyperFrames 成片**：根据规范化分镜、TTS 音频和固定渲染参数生成原创 HTML/CSS/GSAP 视频工程，并调用 `npx hyperframes render` 输出 `output.mp4`。
- **模型配置**：设置页支持 ASR、文字模型、TTS、图片生成、视频生成和多模态模型配置。
- **本地 Web GUI**：React + Vite 前端，Express 后端，默认运行在 `http://localhost:3000`。

## 工作流示例

1. 打开 MuseDock，抓取或载入一个抖音视频。
2. 在抓取记录或素材工作台中点击“准备素材”，生成本地视频、音频、关键帧和分析输入。
3. 在素材工作台执行音频转写，得到 `transcript.json`。
4. 进入 AI 工作台，执行“爆款拆解 + 改写脚本”。
5. 按需填写“创作 brief”，通过固定字段控制创作目标、受众、风格和禁用内容。
6. 在“配音”页签点击 `TTS 合成`，生成口播音频和 `tts.captions`。
7. 在“成片”页签填写“AI 分镜视觉 brief”，点击 `生成 AI 分镜`。
8. 选择“视频渲染参数”，点击 `生成视频工程`，生成 HyperFrames 工程目录。
9. 点击 `渲染 MP4`，得到最终 `output.mp4` 并在页面预览。

最终视频路径类似：

```text
data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes/output.mp4
```

## 关键原则

- 最终视频不使用原视频、原视频帧、关键帧截图或原视频背景。
- 用户只能通过固定 brief 和固定渲染参数影响生成结果，不能编辑 system prompt、JSON schema 或渲染流程。
- AI 只负责原创视觉分镜，不负责最终时间轴。
- 最终时间轴只由 `tts.captions` 计算。
- `渲染 MP4` 不走 AI prompt，只使用已保存的 `video.render_options` 控制渲染流程。
- 如果 AI 分镜输出无效、漏字幕或引用不存在的 caption index，后端会 normalize/fallback，保证所有字幕都被覆盖。

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

项目包含 `package.json#engines`，建议使用 Node.js 22。切换 Node 版本后请重新执行：

```powershell
npm install
```

如果 `better-sqlite3` 出现 ABI 不匹配，可执行：

```powershell
npm rebuild better-sqlite3
```

`ffmpeg` 会优先使用 `FFMPEG_PATH`，其次使用项目依赖内置路径，最后尝试系统 `PATH`。`ffprobe` 用于读取 TTS 分段音频时长，建议安装到系统 `PATH`，或通过 `FFPROBE_PATH` 指定。

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
# 启动后端和静态前端
npm run start

# 开发前端
npm run dev:frontend

# 构建前端
npm run build:frontend

# 运行完整测试
npm test

# AI 与视频链路相关测试
node test-ai-text-model.js
node test-ai-tts-model.js
node test-tts-timeline.js
node test-storyboard-schema.js
node test-storyboard-agent.js
node test-hyperframes-project.js
node test-hyperframes-renderer.js
node test-agent-runs.js
```

## 数据结构

AI 运行结果保存在：

```text
data/media/douyin/<aweme_id>/agent_runs/<run_id>.json
```

Agent 执行时会保存受控创作 brief：

```json
{
  "prompt_options": {
    "goal": "引流到私域",
    "audience": "本地生活商家老板",
    "accountPositioning": "短视频获客顾问",
    "rewriteStyle": "专业可信，开头有冲突感",
    "focus": "突出真实案例",
    "replyTone": "真诚、克制、专业",
    "forbidden": "不要承诺收益，不要夸大效果",
    "extraRequirements": "脚本适合 60 秒口播"
  }
}
```

TTS 成功后写入：

```json
{
  "tts": {
    "status": "done",
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
    ]
  }
}
```

AI 分镜成功后写入：

```json
{
  "storyboard_options": {
    "visualStyle": "商业质感",
    "pacing": "快节奏",
    "captionStyle": "大字报",
    "backgroundDirection": "数据感抽象背景",
    "primaryColor": "#fe2c55",
    "forbidden": "不要真人，不要原视频画面",
    "extraRequirements": "每个分镜标题要短"
  },
  "storyboard_raw": {},
  "storyboard": {
    "status": "done",
    "template": "ai_storyboard_cards",
    "style": {
      "visual_tone": "清晰、原创、适合短视频口播",
      "palette": ["#101216", "#fe2c55", "#25f4ee"],
      "motion": "轻微推进、重点词弹出"
    },
    "scenes": [
      {
        "index": 1,
        "caption_indexes": [1],
        "start": 0,
        "end": 1.25,
        "duration": 1.25,
        "headline": "核心观点",
        "visual_type": "text_card",
        "layout": "center_focus",
        "background_prompt": "原创抽象动态图文背景，不包含原视频画面",
        "emphasis_words": ["观点"],
        "captions": []
      }
    ]
  },
  "storyboard_model": {},
  "storyboard_raw_parse_failed": false
}
```

HyperFrames 工程和渲染成功后写入：

```json
{
  "video": {
    "status": "rendered",
    "template": "ai_storyboard_cards",
    "project_dir": "data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes",
    "index_path": "data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes/index.html",
    "storyboard_path": "data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes/storyboard.json",
    "captions_path": "data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes/captions.json",
    "project_json_path": "data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes/project.json",
    "output_path": "data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes/output.mp4",
    "output_url": "/api/agents/douyin/<aweme_id>/runs/<run_id>/hyperframes/files/output.mp4",
    "render_options": {
      "resolution": "1080x1920",
      "fps": "30",
      "captionSize": "medium",
      "motionLevel": "medium",
      "showCaptionBar": true,
      "showSceneNumber": true,
      "quality": "standard"
    }
  }
}
```

生成目录结构：

```text
data/media/douyin/<aweme_id>/agent_runs/<run_id>-hyperframes/
  index.html
  storyboard.json
  captions.json
  project.json
  output.mp4
  assets/
    narration.wav
  renders/
    project_*.mp4
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

也可以在设置页配置 AI 模型。文字模型按 OpenAI-compatible `POST /chat/completions` 调用，DeepSeek、OpenAI 或自定义兼容服务都可通过供应商、Base URL、模型 ID 和 API Key 接入。

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

- `POST /api/agents/douyin/:aweme_id/runs`：执行抖音素材的 Agent 任务，可传 `template` 和 `promptOptions`
- `GET /api/agents/douyin/:aweme_id/runs`：读取素材的 Agent 运行记录
- `GET /api/agents/douyin/:aweme_id/runs/:run_id`：读取单次 Agent 运行详情
- `POST /api/agents/douyin/:aweme_id/runs/:run_id/tts`：为改写脚本生成 TTS 音频和字幕时间轴
- `GET /api/agents/douyin/:aweme_id/runs/:run_id/tts/:file_name`：读取生成的 TTS 音频
- `POST /api/agents/douyin/:aweme_id/runs/:run_id/storyboard`：生成 AI 分镜，可传 `storyboardOptions`
- `POST /api/agents/douyin/:aweme_id/runs/:run_id/hyperframes/project`：生成 HyperFrames 视频工程，可传 `renderOptions`
- `POST /api/agents/douyin/:aweme_id/runs/:run_id/hyperframes/render`：渲染 MP4
- `GET /api/agents/douyin/:aweme_id/runs/:run_id/hyperframes/files/:file_name`：读取生成的 MP4

`promptOptions`、`storyboardOptions` 和 `renderOptions` 都会在后端做白名单清洗。`renderOptions` 的当前字段为：

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
+-- data/                # SQLite 数据库和本地媒体素材
+-- docs/                # 项目文档、计划和交接记录
+-- test-*.js            # 回归测试脚本
```

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
node test-storyboard-schema.js
node test-storyboard-agent.js
node test-hyperframes-project.js
node test-hyperframes-renderer.js
node test-agent-runs.js
```

## 本地数据

MuseDock 会在本地生成运行数据：

- `data/mediacrawler.db`：SQLite 数据库
- `data/media/douyin/<aweme_id>/`：抖音视频素材目录
- `data/media/douyin/<aweme_id>/transcript.json`：音频转写结果
- `data/media/douyin/<aweme_id>/agent_runs/`：AI Agent 运行结果、TTS 音频、字幕时间轴、HyperFrames 工程和 MP4
- `chrome-user-data/`：Chrome CDP 使用的本地浏览器数据
- `douyin-cookies.json`：抖音 Cookie 持久化文件

这些文件通常不适合提交到公开仓库。开源或协作前请确认 `.gitignore` 已排除本地数据库、浏览器缓存、Cookie 和媒体文件。

## 路线图

- 增加真实任务队列和后端进度推送，替代前端估算进度。
- 扩展更多 Agent 模板，例如选题生成、小红书改写、分镜脚本和素材复盘。
- 补齐小红书评论、素材准备和 AI 工作流。
- 引入图片生成或原创视觉素材生成，但继续避免复用原视频画面。
- 增加端到端测试、CI 和更清晰的部署文档。

## 免责声明

MuseDock 仅用于学习、研究和本地内容工作流整理。使用者应遵守目标平台的服务条款、robots 协议、版权规则和所在地法律法规。请勿将本项目用于未授权的数据采集、隐私侵犯、批量骚扰或其他不当用途。

## License

MuseDock 基于 [Apache License 2.0](./LICENSE) 开源。
