# MuseDock

MuseDock 是一个本地优先的内容采集与创作素材工作台。它把抖音、小红书等平台的内容抓取、评论采集、素材落盘、音视频处理和 AI 工作流放在同一个 Web GUI 里，帮助创作者、运营和研究者更快地整理可复用的内容素材。

> 当前项目处于早期开发阶段，功能以抖音链路为主，小红书能力仍在补齐中。

## 功能特性

- **内容采集**：支持抖音关键词搜索、指定视频 ID/链接抓取、作者主页视频抓取。
- **评论采集**：支持抖音一级评论和二级评论抓取，并保存到本地数据库。
- **小红书入口**：支持小红书关键词搜索与笔记详情接口。
- **本地记录**：使用 SQLite 保存抓取过的视频、笔记和评论，便于回看。
- **素材工作台**：支持为抖音视频准备本地素材，包括视频下载、音频抽取、关键帧抽取和素材状态查看。
- **AI 配置骨架**：提供 ASR、文字模型、图片生成、视频生成和多模态模型配置入口。
- **本地 Web GUI**：React + Vite 前端，Express 后端，默认运行在 `http://localhost:3000`。

## 技术栈

- 前端：React、React Router、Vite
- 后端：Node.js、Express
- 浏览器自动化：Playwright、Chrome CDP
- 数据库：SQLite、better-sqlite3
- 媒体处理：ffmpeg

## 快速开始

### 环境要求

- Node.js 22
- npm
- Google Chrome
- ffmpeg，素材准备功能需要

> 如果使用其他 Node.js 大版本，`better-sqlite3` 可能出现 ABI 不匹配。建议优先使用 Node.js 22。

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

开发前端时可以单独启动 Vite：

```powershell
npm run dev:frontend
```

## 使用说明

1. 打开 MuseDock Web GUI。
2. 在“内容抓取”页选择平台。
3. 抖音链路建议先完成扫码登录，MuseDock 会通过 Chrome CDP 复用本地浏览器登录态。
4. 输入关键词、视频 ID、视频链接或作者主页信息并开始抓取。
5. 在“抓取记录”页查看本地保存的数据。
6. 在“素材工作台”中选择抖音视频，准备视频、音频、关键帧等本地素材。
7. 在“设置”页配置后续 AI 工作流所需的模型信息。

## 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `MEDIACRAWLER_DB_PATH` | SQLite 数据库路径 | `data/mediacrawler.db` |
| `OPENAI_API_KEY` | ASR 或后续 AI 能力可用的 API Key | 空 |
| `ASR_API_KEY` | ASR 服务 API Key | 空 |
| `ASR_PROVIDER` | ASR 服务提供商；接入小米 MiMo 时填写 `mimo` | 空 |
| `MIMO_API_KEY` | 小米 MiMo API Key；未设置时会回退读取 `ASR_API_KEY` | 空 |
| `MIMO_BASE_URL` | 小米 MiMo API Base URL | `https://api.xiaomimimo.com/v1` |
| `MIMO_ASR_MODEL` | 小米 MiMo ASR 模型 ID | `mimo-v2.5-asr` |
| `ASR_LANGUAGE` | MiMo ASR 识别语言，支持 `auto`、`zh`、`en` | `auto` |

当前 ASR 已接入小米 MiMo。也可以在“设置”页的 ASR 转写模型中配置：供应商填写 `mimo`，Base URL 填写 `https://api.xiaomimimo.com/v1`，模型 ID 填写 `mimo-v2.5-asr`，API Key 填写 MiMo 控制台密钥。MiMo 要求 base64 编码后的音频不超过 10MB，较长视频请先压缩或切片。

## 目录结构

```text
.
+-- frontend-react/      # React + Vite 前端源码
+-- frontend-dist/       # 前端构建产物
+-- frontend/            # 旧版静态页面
+-- server/              # Express 服务、路由、抓取器和业务服务
|   +-- routes/          # API 路由
|   +-- scraper/         # 抖音、小红书抓取逻辑
|   +-- services/        # 数据存储、媒体处理、AI 配置服务
|   +-- state/           # 运行时 Cookie 状态
+-- data/                # SQLite 数据库和本地媒体素材
+-- docs/                # 项目文档和交接记录
+-- test-*.js            # 调试和验证脚本
```

## 常用命令

```powershell
# 启动后端和静态前端
npm run start

# 开发前端
npm run dev:frontend

# 构建前端
npm run build:frontend

# 检查后端文件语法
node --check server/app.js
node --check server/index.js
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

### 配置与历史

- `GET /api/history/douyin`：读取抖音抓取记录
- `GET /api/history/xhs`：读取小红书抓取记录
- `GET /api/config/ai-models`：读取 AI 模型配置
- `POST /api/config/ai-models`：保存 AI 模型配置

## 数据与缓存

MuseDock 会在本地生成运行数据：

- `data/mediacrawler.db`：SQLite 数据库
- `data/media/douyin/<aweme_id>/`：抖音视频素材目录
- `chrome-user-data/`：Chrome CDP 使用的本地浏览器数据
- `douyin-cookies.json`：抖音 Cookie 持久化文件

这些文件通常不适合提交到公开仓库。开源前建议通过 `.gitignore` 排除本地数据库、浏览器缓存、Cookie 和媒体文件。

## 开源路线图

- 完善 ASR 转写的真实服务调用。
- 增强 AI 分析、改编、脚本和分镜生成链路。
- 补齐小红书抓取、评论和素材准备能力。
- 增加任务队列，避免长时间媒体处理阻塞请求。
- 增加系统化测试、端到端测试和 CI。
- 提供更清晰的配置文件与部署文档。

## 贡献

欢迎提交 Issue 和 Pull Request。建议贡献前先说明你想解决的问题、复现方式或功能目标，这样更容易保持功能边界清晰。

提交代码时请尽量包含：

- 清晰的问题描述或功能说明
- 必要的验证命令或截图
- 对数据结构、接口或配置变更的说明

## 免责声明

MuseDock 仅用于学习、研究和本地内容工作流整理。使用者应遵守目标平台的服务条款、robots 协议、版权规则和所在地法律法规。请勿将本项目用于未授权的数据采集、隐私侵犯、批量骚扰或其他不当用途。

## License

MuseDock 基于 [Apache License 2.0](./LICENSE) 开源。
