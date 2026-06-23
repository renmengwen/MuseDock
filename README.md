# MuseDock

MuseDock 是一个本地优先的 AI 短视频创作工作台。当前主线不是单纯的采集器，而是把选题输入、来源资料整理、联网研究、脚本/分镜生成、TTS 配音、HTML 视频工程生成、编辑、渲染和本地结果管理放在同一个 Web GUI 里。

![MuseDock 一键创作首页](docs/assets/musedock-creative-home.png)

![MuseDock 一键创作任务详情](docs/assets/musedock-creative-detail.png)

## 当前能做什么

- **一键创作**：输入视频方向、抖音链接、微信公众号文章链接或 GitHub 仓库链接，创建本地创作任务。
- **任务进度跟踪**：任务详情页展示生成阶段、当前状态、失败信息和最终视频。
- **视频编辑器**：进入 `/editor/:workflowId` 后编辑场景、模板字段、画面帧、字幕、配音和导出版本。
- **HTML 视频生产链路**：使用模板、HTML/CSS/GSAP、Playwright 和 ffmpeg 生成可导出的 MP4。
- **设置中心**：配置 AI 模型、一键创作默认值、系统状态检查和本地数据清理。
- **本地数据沉淀**：创作任务、媒体素材、工程文件、TTS、导出视频和配置都保存在本地目录。

## 页面入口

```text
/creative              # 一键创作首页
/creative/:workflowId  # 创作任务详情
/editor/:workflowId    # 视频编辑器
/settings              # 设置中心
```

默认访问根路径会跳转到 `/creative`。

## 一键创作流程

1. 在 `/creative` 输入创作方向、公开文章/GitHub 链接或抖音链接。
2. 按需开启“联网获取最新资料”。
3. 提交后进入任务详情页。
4. 后台依次完成来源准备、研究、素材分析、导演改写、成片策划、音频、工程、校验、渲染和巡检。
5. 任务完成后可直接预览视频，也可以进入编辑器继续调整。

当前专家模式入口已经出现在界面上，但仍处于开发中，日常使用请先走快速模式。

## 技术栈

- 前端：React 19、React Router 7、Vite 8
- UI：Tailwind CSS、shadcn/ui、lucide-react
- 后端：Node.js 22、Express
- 存储：SQLite、better-sqlite3、本地 JSON 文件
- 视频生产：HTML/CSS/GSAP、Playwright/Chromium、ffmpeg、ffprobe
- AI：OpenAI-compatible 文本模型、小米 MiMo ASR/TTS 兼容配置

## 环境要求

- Node.js `>=22 <23`
- npm
- Google Chrome 或 Playwright Chromium
- ffmpeg
- ffprobe

安装依赖：

```powershell
npm install
```

如果切换过 Node 版本，`better-sqlite3` 可能需要重新编译：

```powershell
npm rebuild better-sqlite3
```

真实视频渲染依赖 Playwright Chromium：

```powershell
npx playwright install chromium
```

`ffmpeg` 查找顺序为 `FFMPEG_PATH`、项目依赖内置路径、系统 `PATH`。`ffprobe` 建议安装到系统 `PATH`，或通过 `FFPROBE_PATH` 指定。

## 启动

开发模式同时启动后端和 Vite 前端：

```powershell
npm run dev
```

打开：

```text
http://localhost:5173
```

构建前端：

```powershell
npm run build:frontend
```

启动 Express 和已构建前端：

```powershell
npm run start
```

打开：

```text
http://localhost:3000
```

## 常用命令

```powershell
# 后端 + Vite 前端
npm run dev

# 只启动前端开发服务
npm run dev:frontend

# 构建前端产物
npm run build:frontend

# 启动后端并托管 frontend-dist
npm run start

# 跑完整测试脚本
npm test

# 按文件名过滤测试
npm run test:filter -- creative-workflows
```

## 重要环境变量

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
| `RUN_HTML_VIDEO_REAL_RENDER` | 设置为 `1` 时运行真实渲染烟测 | 空 |
| `HTML_VIDEO_PRODUCTION_ENABLED` | 启用 html-video production path | `true` |
| `HTML_VIDEO_LEGACY_FALLBACK_ENABLED` | 新链路失败时允许 legacy fallback | `true` |
| `HTML_VIDEO_REMOTION_ENHANCEMENT_ENABLED` | Remotion native enhancement 预留开关 | `false` |

AI 模型也可以在设置中心配置，配置会写入本地 `data/config/`。

## 本地数据

常见运行数据：

```text
data/mediacrawler.db                 # SQLite 数据库
data/creative-workflows/             # 一键创作任务记录
data/media/                          # 媒体素材、分析输入、转写和产物
data/config/                         # AI 模型、应用设置和模板覆盖配置
chrome-user-data/                    # Chrome CDP 用户数据
douyin-cookies.json                  # 抖音 Cookie 持久化文件
frontend-dist/                       # 前端构建产物
```

这些通常不适合提交到公开仓库。协作前请确认本地数据库、浏览器缓存、Cookie、媒体产物和任务记录没有被误提交。

## 目录结构

```text
.
+-- frontend-react/      # React + Vite 前端源码
|   +-- src/pages/       # 页面入口
|   +-- src/components/  # 通用组件、创作页和视频编辑器组件
|   +-- src/api/         # 前端请求封装
+-- frontend-dist/       # 前端构建产物
+-- server/              # Express 服务和业务逻辑
|   +-- routes/          # 当前后端路由入口
|   +-- services/        # 创作任务、AI、媒体、视频工程和系统维护服务
|   +-- templates/       # html-video 模板
|   +-- resources/       # 视频工程技能和提示资源
|   +-- scraper/         # 抖音、小红书抓取逻辑
+-- data/                # 本地数据库、配置、任务和素材
+-- docs/                # 设计文档、截图和交接记录
+-- tests/               # Node 测试脚本
+-- scripts/             # 调试和辅助脚本
```

## 测试

完整测试：

```powershell
npm test
```

常用专项测试：

```powershell
node tests/test-one-click-creative-page.mjs
node tests/test-creative-editor-page.mjs
node tests/test-creative-workflows.js
node tests/test-creative-workflow-routes.js
node tests/test-html-video-project-schema.js
node tests/test-html-video-workflow.js
```

真实渲染烟测默认会跳过。需要本机已安装 Playwright Chromium、ffmpeg 和 ffprobe，然后显式开启：

```powershell
$env:RUN_HTML_VIDEO_REAL_RENDER='1'
node tests/test-html-video-vertical-mvp-smoke.js
node tests/test-html-video-real-render-smoke.js
```

## 开发注意

- 日常开发在 `dev` 分支进行。
- 面向用户的文案默认使用中文。
- 新增前端通用控件优先使用 Tailwind CSS 和官方 `shadcn/ui` 组件。
- 会触发请求的用户操作需要明确 loading、完成、失败或未配置状态。
- 不要把本地数据、Cookie、浏览器缓存、媒体产物和构建临时文件提交到仓库。

## License

MuseDock 基于 [Apache License 2.0](./LICENSE) 开源。
