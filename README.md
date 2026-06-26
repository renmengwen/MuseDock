# MuseDock

MuseDock 是一个本地优先的 AI 短视频创作与编辑工作台。项目当前方向不是“采集器外壳”，而是把选题输入、公开来源整理、联网研究、脚本与分镜生成、TTS 配音、HTML 视频工程、可视化二次编辑、渲染导出和失败恢复放在同一个 Web GUI 里。

![MuseDock 一键创作首页](docs/assets/musedock-creative-home.png)

![MuseDock 一键创作任务详情](docs/assets/musedock-creative-detail.png)

## 当前方向

- **从输入到成片**：用创作方向、抖音链接、微信公众号文章链接、GitHub 仓库链接或文本素材创建本地短视频任务。
- **HTML 视频工程优先**：把视频拆成可检查、可重试、可编辑的 `scene_spec`、内容图、HTML 帧、音频、时间轴和导出版本。
- **可编辑成片**：编辑器支持画布、源码、草稿、布局检查、AI 修改、字段和导出，不再只生成一次性 MP4。
- **失败可恢复**：工程阶段写入 `generation_checkpoint`，失败后可生成恢复建议，复用已完成产物并从失败子阶段继续。
- **本地数据沉淀**：任务、素材、配置、HTML 工程、TTS、渲染产物和导出视频默认保存在本地目录。

## 主要入口

```text
/creative              # 一键创作首页
/creative/:workflowId  # 创作任务详情、进度、恢复建议和结果预览
/editor/:workflowId    # html-video 工程编辑器
/settings              # 模型、创作默认值、系统检查和数据清理
```

根路径会跳转到 `/creative`。

## 一键创作流程

1. 在 `/creative` 输入主题、文本或公开来源链接。
2. 按需开启“联网获取最新资料”。
3. 提交后进入任务详情页并通过 SSE 跟踪进度。
4. 后台依次准备来源、研究资料、素材上下文、脚本分镜、TTS、HTML 视频工程、渲染、合成和巡检。
5. 完成后可预览视频，也可以进入 `/editor/:workflowId` 做二次编辑和重新导出。
6. 如果工程阶段失败，详情页会展示“恢复建议”，可点击“修复并重试”从失败点继续。

专家模式入口已在界面中预留，但当前仍处于开发中，日常使用请先走快速模式。

## 编辑器能力

`/editor/:workflowId` 面向 html-video 工程，当前重点是让 AI 生成结果可检查、可修复、可重新导出。

- **画布**：播放当前 HTML 帧到结束后冻结画面，选择文本或标签元素，拖拽位置并保存为草稿。
- **源码**：查看和编辑单帧 HTML，保存为草稿后可渲染预览。
- **草稿**：接受或丢弃帧草稿，避免直接覆盖当前工程。
- **布局检查**：运行单帧或工程布局 QA，定位溢出、画幅和渲染问题。
- **AI 修改**：用自然语言生成帧级或工程级修改草稿。
- **字段**：编辑模板字段、画面帧、字幕和旁白相关结构化数据。
- **导出**：重新渲染、导出并下载版本化 MP4。

## HTML 视频工程

当前生产链路围绕 html-video 工程展开：

```text
输入/来源
-> scene_spec
-> content graph
-> raw HTML frames
-> frame canvas contract
-> Playwright frame render
-> ffmpeg compose
-> duration / visual QA
-> exports
```

关键约束：

- `project.output.resolution` 是输出画幅的权威来源。
- 生成 HTML 必须包含 `data-hv-canvas`、`data-width` 和 `data-height` 画布契约。
- 普通装饰元素的 CSS 尺寸不参与画幅判断。
- `project.json.generation_checkpoint` 记录 content graph、frame HTML、render、compose、duration verify 和 visual inspect 子阶段状态。
- 重试恢复会优先复用 source、research、brief、audio、content graph 等已完成高成本产物。

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

启动 Express 并托管已构建前端：

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
data/media/                          # 媒体素材、分析输入、TTS、工程和导出产物
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
|   +-- src/components/  # 通用组件、创作页和 html-video 编辑器组件
|   +-- src/api/         # 前端请求封装
+-- frontend-dist/       # 前端构建产物
+-- server/              # Express 服务和业务逻辑
|   +-- routes/          # 后端路由入口
|   +-- services/        # 创作任务、AI、媒体、视频工程、恢复重试和系统维护服务
|   +-- templates/       # html-video 模板
|   +-- resources/       # 视频工程技能和提示资源
|   +-- scraper/         # 抖音、小红书抓取逻辑
+-- data/                # 本地数据库、配置、任务和素材
+-- docs/                # 设计文档、截图和交接记录
+-- tests/               # Node assert 测试脚本
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
node tests/test-html-video-canvas-editor-components.mjs
node tests/test-creative-workflow-retry-e2e.js
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
- 新增接口调用要防止重复点击，并尽量区分未登录、未配置、权限不足、限流、网络失败和未知错误。
- 不要把本地数据、Cookie、浏览器缓存、媒体产物和构建临时文件提交到仓库。

## License

MuseDock 基于 [Apache License 2.0](./LICENSE) 开源。
