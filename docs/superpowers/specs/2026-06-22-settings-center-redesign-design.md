# 设置中心重构设计

## 背景

当前设置页主要承担模型供应商、模型类型、API Key 和 Base URL 配置。项目已经有一键创作、html-video 模板、质检、渲染环境和本地数据维护等配置需求，继续把项目默认值塞进模型配置会让职责混乱。

本次重构目标是把设置页升级为“设置中心 v1”，覆盖一键创作默认值和全局运行能力配置，并让默认画面比例、默认视频模板等配置在一键创作中自动生效。

## 范围

设置中心 v1 包含：

- 左侧分组导航：总览、创作默认值、模型配置、系统。
- 独立应用配置文件 `data/config/app-settings.json`。
- 一键创作默认值自动生效。
- 按比例默认模板和锁定模板策略。
- 系统运行能力状态和数据维护入口。
- 按类型清理本地数据，带确认、loading 和路径保护。

本次不做：

- Agent 模板编辑迁移。
- 完整模板管理后台。
- 通用 settings schema 平台化迁移。
- 任务级数据删除入口迁移到设置中心。任务级删除仍保留在一键创作任务列表。

## 页面结构

`SettingsPage.jsx` 改为设置中心壳层，采用左侧导航和右侧内容区。

左侧固定 4 个分组：

1. **总览**
   展示关键状态和快捷入口：文字模型、TTS、默认画面比例、默认模板策略、质检状态、渲染环境状态、数据占用概览。总览只展示状态，不承载复杂编辑。

2. **创作默认值**
   承载一键创作自动生效的默认项：默认画面比例、默认目标时长、按比例默认模板、是否锁定模板、渲染质量、字幕显示偏好、联网研究默认开关。

3. **模型配置**
   迁移现有模型配置 UI，保留供应商、模型类型、API Key、Base URL、启用模型等业务逻辑。数据仍来自现有 `data/config/ai-models.json`。

4. **系统**
   包含运行能力和数据维护：质检开关、html-video 环境检测、Playwright/ffmpeg/ffprobe 状态或路径提示、数据目录占用概览、按类型清理入口。

## 前端组件

建议组件拆分：

- `SettingsPage`：设置中心壳层、左侧导航、当前分组、统一状态提示。
- `SettingsOverview`：总览状态和快捷入口。
- `CreativeDefaultsSettings`：画面比例、时长、按比例模板、锁定模板、渲染和字幕默认值。
- `ModelSettings`：承接现有 `GlobalModelSelector`、`ProviderList` 等模型配置组件。
- `SystemSettings`：质检、环境状态、数据维护。
- `CleanupConfirmDialog`：危险清理确认弹窗。

通用控件优先使用官方 `shadcn/ui` 组件，例如 `Button`、`Select`、`Switch`、`Dialog`、`Tooltip`。设置中心专属布局可用 Tailwind utility class 和少量局部 CSS；避免继续向 `frontend-react/src/styles.css` 追加大段跨页面全局样式。

所有用户可见文案使用中文。所有接口操作必须有明确 loading 文案和按钮禁用态。

## 应用配置模型

新增 `data/config/app-settings.json`，专门保存应用级配置和创作默认值，不再继续向 `ai-models.json` 增加项目默认项。

建议结构：

```json
{
  "version": 1,
  "creativeDefaults": {
    "aspectRatio": "9:16",
    "targetDurationSec": 60,
    "templateByAspectRatio": {
      "9:16": "news_signal_vertical",
      "16:9": "bold_signal",
      "1:1": "",
      "4:5": ""
    },
    "lockTemplate": false,
    "renderQuality": "standard",
    "captionMode": "phrase_kinetic",
    "showCaptionBar": true,
    "useResearch": true
  },
  "system": {
    "skipValidation": false
  }
}
```

后端新增 `server/services/appSettings.js`：

- 读取配置，缺失时返回默认值。
- 保存配置前规范化字段。
- 限制画面比例为 `9:16`、`16:9`、`1:1`、`4:5`。
- 限制目标时长在合理范围内，例如 15 到 180 秒。
- 保留模板 ID 为字符串，实际兼容性在保存或系统健康检查中验证。
- 暴露 `getPublicConfig()`、`saveConfig()`、`getCreativeDefaults()`、`getSystemSettings()`。

兼容策略：

- 现有 `ai-models.json` 里的 `skipValidation` 继续兼容读取。
- 第一次保存 `app-settings.json` 后，以 `app-settings.system.skipValidation` 为准。
- 如果新配置不存在但旧 `skipValidation` 存在，总览和系统页展示当前实际值，避免升级后状态跳变。

## API 设计

在现有 `/api/config` 下新增：

- `GET /api/config/app-settings`：读取设置中心配置。
- `POST /api/config/app-settings`：保存设置中心配置。
- `GET /api/config/templates`：返回 html-video 可用模板简表，用于模板下拉和兼容性提示。
- `GET /api/config/system-health`：返回环境检测、模板状态和数据占用概览。
- `POST /api/config/maintenance/cleanup`：按类型清理数据，body 指定 `targets`。

保留现有接口：

- `/api/config/ai-models` 继续处理模型配置。
- `/api/config/cookies` 继续处理 Cookie 配置；系统页可以复用它展示或清理 Cookie。

## 一键创作自动生效

默认值在后端创建 workflow 时合并，而不是只在前端提交时拼参数。这样未来从其他入口创建任务，默认值也一致生效。

合并顺序：

1. 系统默认值。
2. `app-settings.json`。
3. 请求显式覆盖项。

创建 workflow 时写入 snapshot，例如：

```json
{
  "creative_defaults_snapshot": {
    "aspectRatio": "9:16",
    "targetDurationSec": 60,
    "templateId": "news_signal_vertical",
    "lockTemplate": false,
    "renderQuality": "standard",
    "captionMode": "phrase_kinetic",
    "showCaptionBar": true,
    "useResearch": true
  }
}
```

后续 `runCreativeWorkflow()` 使用 snapshot，不再读取最新设置，避免已创建任务因为用户后来修改设置而漂移。

字段落点：

- `aspectRatio` 写入 `target.aspect_ratio`，影响 scene spec、模板筛选和视觉质检期望比例。
- `targetDurationSec` 写入 `target.duration_sec`，影响策划、模板筛选、内容图和渲染时长。
- `useResearch` 作为一键创作联网研究默认值。前端初始值读取配置；用户临时切换后，该次请求覆盖默认值。

## 模板策略

`templateByAspectRatio` 按画面比例配置默认模板。创建任务时先取 `aspectRatio`，再取对应模板 ID。

当 `lockTemplate = false`：

- 默认模板作为首选模板。
- html-video 选择逻辑优先尝试该模板。
- 如果默认模板缺失、不兼容或 AI 判断失败，允许回退到现有 AI 自动选择。
- 任务记录需要写清楚最终使用模板，以及默认模板是否被回退。

当 `lockTemplate = true`：

- 默认模板变成强制模板。
- 如果模板不存在、画面比例不兼容或引擎不支持，任务直接失败。
- 错误信息必须是中文，例如：`默认模板 news_signal_vertical 不支持当前画面比例 16:9，请在设置中心修改模板或关闭锁定模板。`
- 不允许 AI 改选其他模板。

建议默认值：

- `aspectRatio`: `9:16`
- `targetDurationSec`: `60`
- `templateByAspectRatio["9:16"]`: `news_signal_vertical`
- `templateByAspectRatio["16:9"]`: `bold_signal`
- `lockTemplate`: `false`

## 系统页

系统页分为运行能力和数据维护。

运行能力展示：

- 质检状态：`已启用` 或 `已跳过`，对应 `app-settings.system.skipValidation`。
- html-video 环境：Playwright Chromium、ffmpeg、ffprobe 是否可用。
- 模板状态：可用 html-video 模板数量，以及当前默认比例对应模板是否存在、是否兼容。
- 模型能力摘要：文字模型、TTS、多模态是否已启用，详情跳转到“模型配置”。

运行状态必须中文化。ffmpeg 缺失时显示类似 `未检测到 ffmpeg，无法合成视频`，原始错误可折叠展示。

## 数据维护

系统页显示全局占用概览：

- 创作任务记录：`data/creative-workflows`
- 媒体素材缓存：`data/media/douyin`
- 渲染产物：识别 `output.mp4`、导出目录、html-video project render outputs。
- 浏览器数据：`chrome-user-data`
- Cookie：`douyin-cookies.json` 和后端 Cookie 状态。

清理类型：

- `creative-workflows`：清理创作任务记录。
- `media-cache`：清理媒体素材缓存。
- `render-outputs`：清理渲染产物。
- `browser-data`：清理本地浏览器数据。
- `cookies`：清理 Cookie 配置。

交互规则：

- 每个清理项有独立按钮，不提供“清理全部”。
- 点击后打开确认弹窗，展示删除目录或文件、预计释放空间、影响说明。
- 确认按钮必须是明确文案，例如 `确认清理媒体素材缓存`。
- 请求期间显示 loading，例如 `正在清理媒体素材缓存...`。
- 请求期间按钮禁用，避免重复点击。
- 成功后刷新占用概览，并展示释放空间。
- 失败时显示中文错误和未删除项说明。

后端保护：

- 清理服务只允许删除白名单路径。
- 删除前解析绝对路径，并确认路径仍在允许目录内。
- `browser-data` 和 `cookies` 分开清理。
- `render-outputs` 只删除识别出的产物，不递归删除整个媒体目录。
- 如果有正在运行的一键创作任务，清理相关类型时返回中文阻止提示，例如 `当前有创作任务正在运行，请停止或等待完成后再清理媒体缓存。`

## 后端结构

新增或调整：

- `server/services/appSettings.js`：读写和规范化 `app-settings.json`。
- `server/services/systemMaintenance.js`：环境概览、数据占用统计、白名单清理。
- `server/routes/config.js`：新增 app settings、templates、system health、cleanup routes。
- `server/services/creativeWorkflows.js`：创建 workflow 时合并默认值并持久化 snapshot。
- `server/services/creative-video/html-video/htmlVideoWorkflow.js`：支持 preferred/locked template 输入。

## 测试

新增测试：

- `tests/test-app-settings.js`
  验证默认配置、保存规范化、非法值回退、旧 `skipValidation` 兼容。

- `tests/test-creative-workflow-defaults.js`
  验证一键创作创建时合并默认画面比例、时长、模板策略，并写入 snapshot。

- `tests/test-html-video-template-preference.js`
  验证首选模板、锁定模板、模板不存在和不兼容时的行为。

- `tests/test-system-maintenance.js`
  验证占用统计、白名单路径保护、按类型清理、运行中任务阻止。

前端测试建议：

- 设置中心左侧分组存在。
- 创作默认值控件文案为中文。
- 清理按钮有 loading 和确认文案。
- 模型配置仍能加载、保存、重新加载。

## 分阶段落地

1. **配置底座**
   新增 `app-settings` service/API，设置中心能读写创作默认值和系统开关。

2. **设置中心 UI**
   重做设置页为左侧导航，迁移模型配置，新增创作默认值和系统页。

3. **一键创作自动生效**
   后端合并默认值并写入 workflow snapshot，html-video 支持模板首选和锁定。

4. **系统维护**
   增加环境和占用概览、按类型清理，带确认、loading 和运行中任务阻止。

5. **测试与文档**
   跑新增测试和相关回归，更新 README 的配置文件和 API 概览。

## 成功标准

- 设置页以设置中心形态呈现，不再像单一模型配置页。
- 用户保存默认画面比例和默认模板后，新的一键创作任务自动使用这些默认值。
- 锁定模板时，模板不兼容会给出明确中文失败原因。
- 模型配置原有能力不回退。
- 系统页能展示运行能力和数据占用，并能安全地按类型清理。
- 所有新增接口请求都有 loading、成功和失败状态。
