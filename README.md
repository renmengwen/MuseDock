# MuseDock

MuseDock 是一个本地优先的 AI 短视频创作与编辑工作台：把选题输入、公开来源整理、联网研究、来源图片素材、脚本与分镜、TTS 配音、HTML 帧工程、布局质检和导出放在同一个 Web GUI 里。成片不是一次性黑盒 MP4，而是可检查、可重试、可二次编辑的 HTML 视频工程。

![MuseDock 一键创作首页](.github/assets/musedock-creative-home.png)

<table>
  <tr>
    <td width="50%" align="center"><img src=".github/assets/musedock-creative-detail.png" width="100%" alt="任务详情：进度、来源追踪与成片预览"><br>任务详情 · 来源追踪与成片预览</td>
    <td width="50%" align="center"><img src=".github/assets/musedock-editor.png" width="100%" alt="html-video 工程编辑器"><br>html-video 工程编辑器</td>
  </tr>
</table>

## 快速开始

需要 Node.js `>=22 <23`、Google Chrome（采集与渲染都复用系统 Chrome，无需下载 Playwright 浏览器）、`ffmpeg`、`ffprobe`。

```powershell
npm install
npm run dev                        # 打开 http://localhost:5173
```

切换过 Node 版本时 `better-sqlite3` 可能需要 `npm rebuild better-sqlite3`。`ffmpeg` 查找顺序为 `FFMPEG_PATH` → 项目内置 → 系统 `PATH`；`ffprobe` 建议装进 `PATH` 或用 `FFPROBE_PATH` 指定。

## 桌面版（Electron）

```powershell
npm run dist   # 产物：dist-electron/MuseDock Setup <version>.exe
```

- 桌面版和浏览器模式共用同一个 Express server：Electron 内部默认跑在 `http://127.0.0.1:38017`（端口被占用时自动换空闲端口），只监听本机回环地址，不对局域网开放；`npm start` 的浏览器模式不受影响，仍默认 `0.0.0.0:3000`。
- 桌面版数据（数据库、Cookie、素材、配置、日志）写入 `%APPDATA%/musedock`，与开发模式的仓库目录互相独立。
- 依赖系统安装的 Google Chrome；ffmpeg 已内置在安装包里。
- 打包时 electron-builder 会把 `node_modules` 里的 `better-sqlite3` 原地换成 Electron ABI，`postdist` 钩子会自动 `npm rebuild better-sqlite3` 恢复；打包前先停掉本地 server，否则文件占用会导致 EPERM 失败。
- `npm run electron`（开发壳）直接用本地 node_modules（node ABI），触发抖音数据存储时会报 ABI 错误；需要时先 `npx electron-rebuild -w better-sqlite3`，用完 `npm rebuild better-sqlite3` 恢复。

## 主要入口

```text
/creative              # 一键创作首页（根路径跳转到这里）
/creative/:workflowId  # 任务详情、进度、恢复建议和结果预览
/editor/:workflowId    # html-video 工程编辑器
/settings              # 模型、创作默认值、系统检查和数据清理
```

## 核心能力

- **一键创作闭环**：用创作方向、文本、抖音/文章/公众号/GitHub 链接创建本地任务，后台依次准备来源、研究、素材、脚本分镜、TTS、HTML 工程、渲染和巡检，全程 SSE 跟踪进度。
- **来源可追踪**：链接来源整理成 `source_context`，文章/GitHub 图片下载成 `asset_context` 并追踪是否被镜头引用；抖音来源复用本地视频、音频和关键帧。Pexels 只作视觉补充，不当来源证据。
- **HTML 视频工程优先**：成片由 `scene_spec`、内容图、HTML 帧、音频、时间轴、质检和导出版本组成，可在 `/editor` 改文案、拖位置、跑布局质检、AI 改帧并重新导出。
- **失败可恢复**：工程阶段写入 `generation_checkpoint`，失败后复用已完成的来源/研究/素材/音频产物，从失败子阶段继续。
- **本地优先**：任务、配置、素材、TTS、工程和导出默认存本地目录。

## HTML 视频工程

```text
输入/来源 -> scene_spec -> content graph -> raw HTML frames
-> frame canvas contract -> Playwright render -> ffmpeg compose
-> duration / visual QA -> exports
```

`project.output.resolution` 是输出画幅的权威来源，生成 HTML 必须带 `data-hv-canvas`、`data-width`、`data-height` 画布契约。

## 当前边界

- 不是通用爬虫控制台，采集只服务本地短视频创作；专家模式仍在建设，稳定入口是 `/creative`。
- 文章/GitHub 来源只处理正文和图片，不做任意网页截图，也不提取网页里的视频。
- 真实渲染依赖本机 Chrome、`ffmpeg`、`ffprobe`，缺失时相关烟测或导出会跳过或失败。

## 技术栈

React 19 + React Router 7 + Vite 8、Tailwind CSS + shadcn/ui；Node.js 22 + Express；SQLite/better-sqlite3 + 本地 JSON；HTML/CSS/GSAP + playwright-core（驱动系统 Chrome）+ ffmpeg/ffprobe；Electron 桌面壳；OpenAI-compatible 文本模型 + 小米 MiMo ASR/TTS。

## 常用命令

```powershell
npm run dev            # 后端 + Vite 前端
npm run dev:frontend   # 只启动前端开发服务
npm run build:frontend # 构建前端产物到 frontend-dist
npm run start          # 启动后端并托管 frontend-dist（http://localhost:3000）
npm run electron       # 用 Electron 壳跑本地代码（需先 build:frontend）
npm run dist           # 打包 Windows 安装包到 dist-electron/
npm test               # 完整测试
npm run test:filter -- creative-workflows  # 按文件名过滤测试
```

真实渲染烟测默认跳过，需本机装好 Chromium/ffmpeg/ffprobe 后显式开启：

```powershell
$env:RUN_HTML_VIDEO_REAL_RENDER='1'
node tests/test-html-video-vertical-mvp-smoke.js
node tests/test-html-video-real-render-smoke.js
```

## 重要环境变量

模型、ASR/TTS、Pexels 补图这些**优先在设置中心（`/settings`）配置**，会写入本地 `data/config/`。下面这些没有界面入口，只能用环境变量控制：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `MEDIACRAWLER_DB_PATH` | SQLite 数据库路径 | `data/mediacrawler.db` |
| `MUSEDOCK_DATA_DIR` | 所有可写数据（DB/Cookie/素材/配置）的根目录，Electron 打包后指向 `%APPDATA%/musedock` | 仓库根目录 |
| `MUSEDOCK_PORT` | 后端监听端口 | `3000`（Electron 内默认 `38017`，被占用自动换） |
| `MUSEDOCK_HOST` | 后端监听地址 | `0.0.0.0`（Electron 内为 `127.0.0.1`） |
| `ASR_LANGUAGE` | MiMo ASR 识别语言，支持 `auto`、`zh`、`en` | `auto` |
| `FFMPEG_PATH` | 手动指定 ffmpeg 可执行文件路径 | 空 |
| `FFPROBE_PATH` | 手动指定 ffprobe 可执行文件路径 | 空 |
| `RUN_HTML_VIDEO_REAL_RENDER` | 设置为 `1` 时运行真实渲染烟测 | 空 |

> headless / CI 等无界面场景，也可以用环境变量直接提供凭据：`OPENAI_API_KEY`、`ASR_API_KEY`、`ASR_PROVIDER`、`MIMO_API_KEY`、`MIMO_BASE_URL`、`MIMO_ASR_MODEL`、`MIMO_TTS_MODEL`、`PEXELS_API_KEY`（或 `PEXELS_API_KEYS`）。它们仅在设置中心对应项为空时作为回退生效。

## 目录结构

```text
frontend-react/   # React + Vite 前端（pages / components / api）
server/           # Express 服务：routes / services / templates / resources / scraper
electron/         # Electron 主进程（桌面壳，复用 server）
data/             # 本地数据库、配置（config/）、任务和素材（media/）
tests/            # Node assert 测试脚本
```

运行时会生成 `data/mediacrawler.db`、`chrome-user-data/`、`douyin-cookies.json`、`frontend-dist/` 等本地数据，注意别提交到公开仓库。

## 开发与协作

日常开发在 `dev` 分支进行，面向用户文案用中文，通用控件优先 shadcn/ui。完整规则见 [AGENTS.md](./AGENTS.md)。

## 使用须知

本项目仅供个人学习、研究和已获授权范围内的内容创作。使用采集能力时请遵守目标平台服务条款和当地法律法规，只采集你有权访问的内容，不要用于大规模抓取或商业化倒卖；因使用本项目产生的后果由使用者自行承担。

## License

MuseDock 基于 [Apache License 2.0](./LICENSE) 开源。
