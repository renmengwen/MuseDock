# Settings Center Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将设置页重构为设置中心 v1，支持一键创作默认值自动生效、模型配置保留、系统健康概览和安全的数据维护。

**Architecture:** 应用级设置独立存入 `data/config/app-settings.json`，模型配置继续使用 `data/config/ai-models.json`。一键创作在 `createCreativeWorkflow()` 创建 workflow 时合并默认值并写入 snapshot，后续运行只读 workflow 记录，不再读取最新 settings，避免已创建任务漂移。

**Tech Stack:** Node.js 22、Express、React 19、Vite、现有 CSS/Tailwind 约束、内置 `node tests/run-all.js` 测试发现器。

---

## 子代理执行护栏

- [ ] 每个任务开始前运行 `git branch --show-current`，确认输出为 `dev`；如果不是 `dev`，立即停止并汇报。
- [ ] 每个任务开始前运行 `git status --short`，记录已有未提交文件。不要改动与当前任务无关的脏文件，尤其是已存在的 `server/services/creative-video/workflowFacade.js`、`tests/test-creative-video-workflow-facade.js`、`.workbuddy/memory/2026-06-22.md`。
- [ ] 每个任务只提交该任务列出的文件。提交前运行 `git diff --name-only --cached`，确认没有混入其他任务或用户文件。
- [ ] 用户可见文案全部使用中文，包括按钮、状态、错误、loading、确认弹窗和后端返回消息。
- [ ] 不改变 `data/config/ai-models.json` 的模型配置结构；只保留旧 `skipValidation` 的兼容读取和过渡期写入。
- [ ] 不把 `captionMode`、`showCaptionBar`、`renderQuality` 接入 html-video production 自动生效路径；它们不属于 v1 验收。
- [ ] 新增接口操作必须有 loading、成功、失败状态，并在 loading 期间禁用重复点击。
- [ ] 前端新增通用控件优先复用项目已有控件或官方 `shadcn/ui` 可用组件；若本仓库尚未接入对应组件，不在本计划中引入大规模组件体系迁移。
- [ ] 不向 `frontend-react/src/styles.css` 追加大段跨页面样式；只允许追加以 `.settingsCenter`、`.settingsPanel`、`.settingsCleanup`、`.modal` 等设置中心前缀限定的小块样式。
- [ ] `tests/run-all.js` 当前自动发现 `tests/test-*.js` 和 `tests/test-*.mjs`。新增测试文件不需要手动注册，除非实现过程中主动改变 runner 行为。
- [ ] 每个任务按“失败测试 -> 最小实现 -> 针对测试 -> 提交”的顺序执行。无法稳定写自动测试时，必须写静态断言测试或明确的手工验收步骤。

## 已确认范围

设置中心 v1 包含：

- 左侧分组导航：`总览`、`创作默认值`、`模型配置`、`系统`。
- 新增 `data/config/app-settings.json` 保存应用级设置。
- 默认画面比例、默认目标时长、按比例默认模板、锁定模板、联网研究默认值自动影响新的一键创作任务。
- 模型配置继续读取和保存 `ai-models.json`，现有模型配置能力不回退。
- 系统页展示质检状态、html-video 环境诊断、模板状态、模型能力摘要、数据占用和清理入口。
- 数据维护只做全局按类型清理，不在设置中心实现任务级删除。

设置中心 v1 不包含：

- Agent 模板编辑后台。
- 完整模板管理后台。
- settings schema 平台化框架。
- 把任务级删除入口迁移到设置中心。
- `captionMode`、`showCaptionBar`、`renderQuality` 对 html-video production 的自动生效。

## 关键代码锚点

- `server/routes/config.js`：当前只有 `/cookies`、`/ai-models`，新增 app settings、templates、system health、cleanup 路由都从这里挂载。
- `server/services/aiModelConfig.js`：模型配置服务；旧 `skipValidation` 兼容读取来源。
- `server/services/creativeWorkflows.js:createCreativeWorkflow(payload = {}, options = {})`：创建 workflow 的唯一 snapshot 写入点。
- `server/services/creativeWorkflows.js:runCreativeWorkflow(workflowId, options = {})`：运行时读取 record，不能读取最新 app settings。
- `server/services/creative-video/html-video/htmlVideoWorkflow.js:generateHtmlVideo()`：新增 `preferredTemplateId`、`lockTemplate` 入参。
- `server/services/creative-video/html-video/htmlVideoWorkflow.js:requestTemplateSelection()`：首选模板 prompt 和锁定模板策略入口。
- `server/services/creative-video/html-video/templateRegistry.js`：已有 `scanTemplateManifests()`、`buildCompactIndex()`、`validateTemplateCompatibility()`、`createTemplateRegistry()`。
- `server/services/creative-video/workflowFacade.js:generateCreativeVideoProject()`：从 `target` 透传模板偏好到 html-video workflow。
- `frontend-react/src/pages/SettingsPage.jsx`：设置中心壳层重做入口。
- `frontend-react/src/hooks/useSettings.js`：现有模型配置 hook，保留模型职责，不塞入应用默认值状态。
- `frontend-react/src/pages/OneClickCreativePage.jsx`：联网研究默认值初始化和请求体覆盖语义。
- `frontend-react/src/api/client.js`：新增设置中心 API client 方法。
- `tests/run-all.js`：自动发现新增测试，无需手动维护测试列表。

## 数据契约

### `data/config/app-settings.json`

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
    "useResearch": true
  },
  "system": {
    "skipValidation": false
  }
}
```

规范化规则：

- `aspectRatio` 只允许 `9:16`、`16:9`、`1:1`、`4:5`，非法值回退 `9:16`。
- `targetDurationSec` 限制在 `15` 到 `180` 秒，非法值回退 `60`。
- `templateByAspectRatio` 只保存上述比例键，值必须是 trim 后字符串，非字符串保存为空字符串。
- `lockTemplate`、`useResearch`、`system.skipValidation` 只接受 boolean，否则使用默认值。

### Workflow Snapshot

创建 workflow 时写入：

```json
{
  "creative_defaults_snapshot": {
    "aspectRatio": "9:16",
    "targetDurationSec": 60,
    "templateId": "news_signal_vertical",
    "lockTemplate": false,
    "useResearch": true
  },
  "target": {
    "aspect_ratio": "9:16",
    "duration_sec": 60,
    "preferredTemplateId": "news_signal_vertical",
    "lockTemplate": false
  }
}
```

合并顺序：

1. 系统默认值。
2. `app-settings.json`。
3. 请求显式覆盖，包括兼容字段 `payload.useResearch` 和新字段 `payload.creativeDefaultsOverride`。

`creativeDefaultsOverride` 允许字段：`aspectRatio`、`targetDurationSec`、`templateId`、`lockTemplate`、`useResearch`。

### `projectOptions` 合并规则

在 `creativeWorkflows.runCreativeWorkflow()` 调用 agentRuns 时：

```js
function mergeProjectOptions(recordTarget = {}, incoming = {}) {
  return {
    ...(recordTarget || {}),
    ...(incoming || {}),
    preferredTemplateId: recordTarget?.preferredTemplateId || incoming?.preferredTemplateId || '',
    lockTemplate: recordTarget?.lockTemplate === true,
  };
}
```

含义：

- `record.target` 是稳定 snapshot 基础。
- 调用方传入的 `projectOptions` 可以补充其他运行参数。
- `record.target.preferredTemplateId` 和 `record.target.lockTemplate` 必须覆盖调用方同名字段，防止已创建任务因运行期参数漂移。
- 如果 `record.target.preferredTemplateId` 为空，才允许使用 incoming 的 `preferredTemplateId`。

### `system-health.environment.diagnostics[]`

统一诊断对象格式：

```json
{
  "ok": true,
  "code": "ffmpeg_available",
  "message": "ffmpeg 可用。",
  "detail": "",
  "path": "ffmpeg"
}
```

前端规则：

- 列表主行显示 `message`。
- 折叠详情显示 `detail`，为空时显示 `path`，仍为空时显示 `无更多诊断信息。`。
- 所有缺失、异常、第三方英文错误都要包装中文 `message`。

### `/api/config/templates`

返回：

```json
{
  "success": true,
  "data": [
    {
      "id": "news_signal_vertical",
      "name": "竖屏财经信号",
      "description": "9:16 竖屏科技财经新闻模板",
      "category": "news",
      "tags": ["竖屏", "财经"],
      "engine": "hyperframes",
      "mapped_engine": "hyperframes-playwright",
      "aspect_ratio": "9:16",
      "duration_sec": 6,
      "source_entry": "source/index.html",
      "license": { "name": "Apache-2.0", "commercial_use": true },
      "compatible": true,
      "compatibility_reasons": []
    }
  ]
}
```

实现注意：

- `buildCompactIndex({ aspectRatio })` 只返回兼容模板。
- 如果下拉要显示所有模板并标记兼容性，必须使用 `scanTemplateManifests()` 加 `validateTemplateCompatibility()`，不要用 `buildCompactIndex()` 伪造“全部模板”。

### `render-outputs` 识别规则

只删除白名单内已知渲染产物：

- 从 workflow/run JSON 收集输出字段：
  - `result.hyperframes_freeform.render.output_path`
  - `result.hyperframes_freeform.render.render_versions[].output_path`
  - `video.output_path`
  - `video.render_versions[].output_path`
  - `visual_inspect.output_path`
- 对 html-video project 目录，仅允许：
  - `exports/*.mp4`
  - `exports/*.webm`
  - `exports/*.mov`
  - `frames/*.mp4`
  - `inspect/previews/*.mp4`
  - project 根目录 `output.mp4`
- 删除前对候选路径执行 `path.resolve()`，确认仍位于允许根目录内。
- 不递归删除整个媒体目录，不删除原始素材、JSON、转写、评论、配置。

---

### Task 1: App Settings Service

**Files:**
- Create: `server/services/appSettings.js`
- Create: `tests/test-app-settings.js`

**Acceptance:**
- 缺失 `app-settings.json` 时返回默认配置。
- 保存时按数据契约规范化非法值。
- `app-settings.json` 存在时 `system.skipValidation` 以新文件为准。
- `app-settings.json` 不存在时 `getEffectiveSystemSettings()` 回退旧 `ai-models.json.skipValidation`。
- 第一次保存 app settings 时保留当前有效 `skipValidation`，避免升级后状态跳变。

- [ ] **Step 1: 写失败测试**

创建 `tests/test-app-settings.js`，覆盖 4 个场景：

```js
const assert = require('assert');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const appSettings = require('../server/services/appSettings');

async function makeRoot() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'app-settings-'));
}

async function run() {
  const root = await makeRoot();
  const configPath = path.join(root, 'app-settings.json');
  const aiConfigPath = path.join(root, 'ai-models.json');

  const defaults = await appSettings.getPublicConfig({ configPath, aiConfigPath });
  assert.equal(defaults.version, 1);
  assert.equal(defaults.creativeDefaults.aspectRatio, '9:16');
  assert.equal(defaults.creativeDefaults.targetDurationSec, 60);
  assert.equal(defaults.creativeDefaults.templateByAspectRatio['9:16'], 'news_signal_vertical');
  assert.equal(defaults.creativeDefaults.lockTemplate, false);
  assert.equal(defaults.creativeDefaults.useResearch, true);
  assert.equal(defaults.system.skipValidation, false);

  const saved = await appSettings.saveConfig({
    creativeDefaults: {
      aspectRatio: 'bad',
      targetDurationSec: 999,
      templateByAspectRatio: { '9:16': '  news_signal_vertical  ', '16:9': 123 },
      lockTemplate: true,
      useResearch: false,
    },
    system: { skipValidation: true },
  }, { configPath, aiConfigPath });
  assert.equal(saved.creativeDefaults.aspectRatio, '9:16');
  assert.equal(saved.creativeDefaults.targetDurationSec, 180);
  assert.equal(saved.creativeDefaults.templateByAspectRatio['9:16'], 'news_signal_vertical');
  assert.equal(saved.creativeDefaults.templateByAspectRatio['16:9'], '');
  assert.equal(saved.system.skipValidation, true);

  await fsp.unlink(configPath);
  await fsp.writeFile(aiConfigPath, JSON.stringify({ skipValidation: true, providers: {}, active: {} }), 'utf-8');
  const fallback = await appSettings.getEffectiveSystemSettings({ configPath, aiConfigPath });
  assert.equal(fallback.skipValidation, true);
  assert.equal(fallback.source, 'legacy-ai-models');

  const firstSave = await appSettings.saveConfig({ creativeDefaults: {} }, { configPath, aiConfigPath });
  assert.equal(firstSave.system.skipValidation, true);
  const effective = await appSettings.getEffectiveSystemSettings({ configPath, aiConfigPath });
  assert.equal(effective.source, 'app-settings');
  assert.equal(effective.skipValidation, true);
}

run().then(() => {
  console.log('app settings tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: 确认测试失败**

Run: `node tests/test-app-settings.js`

Expected: fails with `Cannot find module '../server/services/appSettings'`.

- [ ] **Step 3: 实现服务**

实现 `server/services/appSettings.js`，导出：

```js
module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_CONFIG,
  ALLOWED_ASPECT_RATIOS,
  normalizeConfig,
  normalizeCreativeDefaults,
  normalizeSystemSettings,
  hasConfig,
  getPublicConfig,
  saveConfig,
  getCreativeDefaults,
  getSystemSettings,
  getEffectiveSystemSettings,
};
```

Implementation requirements:

- 使用 `fs/promises` 读写 JSON，保存前 `mkdir(path.dirname(configPath), { recursive: true })`。
- `DEFAULT_CONFIG_PATH` 指向 `data/config/app-settings.json`。
- `DEFAULT_AI_CONFIG_PATH` 使用 `aiModelConfig.DEFAULT_CONFIG_PATH`，如果该常量不存在，退回 `data/config/ai-models.json`。
- `saveConfig(input, options)` 在新文件不存在时先调用 `getEffectiveSystemSettings(options)`，把当前有效 `skipValidation` 合并进保存结果。
- 读取损坏 JSON 时返回默认配置，但不要覆盖磁盘文件；只有保存时才写盘。
- 错误消息只在路由层展示给用户，服务层可以抛原始异常。

- [ ] **Step 4: 跑测试**

Run: `node tests/test-app-settings.js`

Expected: prints `app settings tests passed`.

- [ ] **Step 5: 提交**

Run:

```powershell
git add server/services/appSettings.js tests/test-app-settings.js
git commit -m "添加应用设置配置服务"
```

---

### Task 2: Config Routes and Templates API

**Files:**
- Modify: `server/routes/config.js`
- Create: `tests/test-config-settings-routes.js`

**Acceptance:**
- `GET /api/config/app-settings` 返回 `{ success: true, data: config }`。
- `POST /api/config/app-settings` 保存配置并返回 `{ success: true, data: config }`。
- `GET /api/config/templates` 返回上方契约字段。
- templates API 能按当前默认比例计算兼容性，但仍可返回全部模板。
- `/api/config/ai-models`、`/api/config/cookies` 原行为保留。

- [ ] **Step 1: 写失败路由测试**

创建 `tests/test-config-settings-routes.js`。测试用 Express app 挂载 `server/routes/config.js`，用注入或临时 config path 避免写真实 `data/config`。如果现有 route 不支持注入，先测试公开路由 shape，再在 Step 3 添加轻量注入点。

Core assertions:

```js
assert.equal(appSettingsResponse.success, true);
assert.equal(appSettingsResponse.data.creativeDefaults.aspectRatio, '9:16');
assert.equal(saveResponse.data.creativeDefaults.lockTemplate, true);
assert.equal(Array.isArray(templatesResponse.data), true);
assert.ok(templatesResponse.data.every(item => Object.prototype.hasOwnProperty.call(item, 'compatible')));
```

- [ ] **Step 2: 确认测试失败**

Run: `node tests/test-config-settings-routes.js`

Expected: fails because routes do not exist.

- [ ] **Step 3: 实现 routes**

In `server/routes/config.js`:

- Require `appSettings`.
- Require html-video template registry from `server/services/creative-video/html-video/templateRegistry.js`.
- Add named handler `getAppSettingsRoute(req, res)` and mount it with `router.get('/app-settings', getAppSettingsRoute)`；handler 读取 `appSettings.getPublicConfig()`。
- Add named handler `saveAppSettingsRoute(req, res)` and mount it with `router.post('/app-settings', saveAppSettingsRoute)`；handler 调用 `appSettings.saveConfig(req.body || {})`。
- Add named handler `getConfigTemplatesRoute(req, res)` and mount it with `router.get('/templates', getConfigTemplatesRoute)`；handler 扫描模板并映射返回字段。

Templates implementation rules:

- Use `scanTemplateManifests(rootDir)` to list all manifests.
- Compute current aspect ratio from `await appSettings.getCreativeDefaults()`.
- For each manifest, call `validateTemplateCompatibility(manifest, { aspectRatio })`.
- Map fields exactly to the `/api/config/templates` contract.
- If template scan fails, return `500` with `{ success: false, message: '读取视频模板失败。', error: error.message }`.

- [ ] **Step 4: 跑路由测试和旧配置 smoke**

Run:

```powershell
node tests/test-config-settings-routes.js
node tests/test-creative-api-client.mjs
```

Expected: both pass.

- [ ] **Step 5: 提交**

Run:

```powershell
git add server/routes/config.js tests/test-config-settings-routes.js
git commit -m "添加设置中心配置接口"
```

---

### Task 3: System Health Service

**Files:**
- Create: `server/services/systemMaintenance.js`
- Create: `tests/test-system-health.js`

**Acceptance:**
- `getSystemHealth({ refresh: false })` 返回 environment、templates、models、storage。
- 环境检测缓存 60 秒；存储统计缓存 15 秒。
- `refresh: true` 强制刷新两个缓存。
- `environment.diagnostics[]` 统一为 `{ ok, code, message, detail, path }`。
- ffmpeg、ffprobe、Playwright 错误对用户返回中文 `message`，原始错误放 `detail`。

- [ ] **Step 1: 写失败测试**

创建 `tests/test-system-health.js`，覆盖：

- 两次 10 秒内调用只执行一次 `environmentDoctor`。
- 70 秒后再次调用会重新执行环境检测。
- diagnostics 缺字段时仍被 `normalizeDiagnostic()` 补齐。
- models 摘要从 `aiModelConfig.getPublicConfig()` 映射 `text`、`tts`、`multimodal`。
- storage 每项都包含 `{ bytes, display }`。

Key assertion:

```js
assert.deepEqual(health.environment.diagnostics[0], {
  ok: true,
  code: 'ffmpeg_available',
  message: 'ffmpeg 可用。',
  detail: '',
  path: 'ffmpeg'
});
```

- [ ] **Step 2: 确认测试失败**

Run: `node tests/test-system-health.js`

Expected: fails because `systemMaintenance` does not exist.

- [ ] **Step 3: 实现 health service**

In `server/services/systemMaintenance.js`, export:

```js
module.exports = {
  HEALTH_CACHE_TTL_MS,
  STORAGE_CACHE_TTL_MS,
  normalizeDiagnostic,
  formatBytes,
  getDirectorySize,
  getStorageOverview,
  getSystemHealth,
};
```

Implementation requirements:

- Cache key can be module-level because this is local desktop app. Tests must be able to pass `cacheKey` or call `clearCaches()` if cache state leaks; choose one explicit mechanism and test it.
- `getSystemHealth({ rootDir, mediaRoot, browserDataRoot, cookieFile, services, refresh, nowMs })` supports dependency injection.
- `services.environmentDoctor` returns raw diagnostics or throws.
- On thrown environment error, return `environment.ok = false` and one diagnostic `{ ok: false, code: 'environment_check_failed', message: '运行环境检测失败。', detail: error.message, path: '' }`.
- `templates` uses current app settings default template and `validateTemplateCompatibility()`.
- `storage` keys use camelCase: `creativeWorkflows`、`mediaCache`、`renderOutputs`、`browserData`、`cookies`。

- [ ] **Step 4: 跑测试**

Run: `node tests/test-system-health.js`

Expected: prints `system health tests passed`.

- [ ] **Step 5: 提交**

Run:

```powershell
git add server/services/systemMaintenance.js tests/test-system-health.js
git commit -m "添加系统健康检测服务"
```

---

### Task 4: Maintenance Cleanup Service and Route

**Files:**
- Modify: `server/services/systemMaintenance.js`
- Modify: `server/routes/config.js`
- Create: `tests/test-system-maintenance-cleanup.js`

**Acceptance:**
- `POST /api/config/maintenance/cleanup` accepts `{ targets: ['cookies'] }` and returns Chinese success/failure message.
- 支持 targets：`creative-workflows`、`media-cache`、`render-outputs`、`browser-data`、`cookies`。
- 没有“清理全部”语义；空数组或未知 target 返回 400。
- 有运行中一键创作任务时，阻止 `creative-workflows`、`media-cache`、`render-outputs` 清理。
- 所有删除候选都经过白名单路径校验。
- `cookies` 清理会清空 `storedCookies.douyin`、`storedCookies.xhs`，并删除或清空本地 cookie 文件。

- [ ] **Step 1: 写失败测试**

创建 `tests/test-system-maintenance-cleanup.js`，覆盖：

- `findRenderOutputs()` 只识别白名单产物，不包含 `metadata.json`、`transcript.json`。
- 候选路径逃逸白名单时不会删除，返回 `skipped`。
- 运行中任务时返回 `success: false`，message 包含 `当前有创作任务正在运行`。
- cookies 清理后内存值为空。
- route unknown target 返回 400 中文错误。

- [ ] **Step 2: 确认测试失败**

Run: `node tests/test-system-maintenance-cleanup.js`

Expected: fails because cleanup functions and route do not exist.

- [ ] **Step 3: 实现 cleanup helpers**

Add exports in `systemMaintenance.js`:

```js
module.exports = {
  HEALTH_CACHE_TTL_MS,
  STORAGE_CACHE_TTL_MS,
  normalizeDiagnostic,
  formatBytes,
  getDirectorySize,
  getStorageOverview,
  getSystemHealth,
  isPathInside,
  collectJsonOutputPaths,
  findRenderOutputs,
  cleanupTargets,
};
```

Implementation requirements:

- `isPathInside(child, parent)` uses `path.resolve()` and `path.relative()`; equal path is allowed only when target type explicitly deletes that root, not for render output file deletion.
- `cleanupTargets({ targets, rootDir, mediaRoot, browserDataRoot, cookieFile, storedCookies, hasRunningCreativeTasks })` returns:

```json
{
  "success": true,
  "message": "清理完成。",
  "deleted": [{ "path": "D:/code3/MediaCrawler-GUI/data/media/douyin/123/exports/output.mp4", "bytes": 123 }],
  "skipped": [{ "path": "D:/code3/MediaCrawler-GUI/data/media/douyin/123/metadata.json", "reason": "路径不在允许范围内。" }],
  "freedBytes": 123,
  "freedDisplay": "123 B"
}
```

- `hasRunningCreativeTasks` default reads workflow records and treats `queued`、`running`、`processing` as running.
- 清理失败不要中断全部 targets；记录 skipped，最终 message 用中文说明部分失败。

- [ ] **Step 4: 实现 cleanup route**

In `server/routes/config.js`:

- Add named handler `cleanupConfigDataRoute(req, res)` and mount it with `router.post('/maintenance/cleanup', cleanupConfigDataRoute)`；handler 校验 targets 并调用 `systemMaintenance.cleanupTargets()`。
- Validate `targets` is a non-empty array.
- Return `400` for unknown target with `message: '不支持的清理类型。'`。
- Pass `storedCookies` to cleanup service for cookies cleanup.
- On service `success: false`, use HTTP 409 for running-task guard.

- [ ] **Step 5: 跑测试**

Run:

```powershell
node tests/test-system-maintenance-cleanup.js
node tests/test-system-health.js
```

Expected: both pass.

- [ ] **Step 6: 提交**

Run:

```powershell
git add server/services/systemMaintenance.js server/routes/config.js tests/test-system-maintenance-cleanup.js
git commit -m "添加系统数据清理能力"
```

---

### Task 5: Workflow Defaults Snapshot

**Files:**
- Modify: `server/services/creativeWorkflows.js`
- Create: `tests/test-creative-workflow-defaults.js`

**Acceptance:**
- `createCreativeWorkflow()` 在调用 `creativeContext.normalizeCreativeInput()` 前读取创作默认值并生成 `effectivePayload`。
- snapshot 和 target 与 workflow record 同一次 `persistWorkflow(record, rootDir)` 写盘。
- 旧 `payload.useResearch` boolean 仍视为显式覆盖。
- 新 `payload.creativeDefaultsOverride.useResearch` 覆盖默认值。
- 未传覆盖时使用 app settings 默认值。
- `runCreativeWorkflow()` 不读取最新 app settings，只使用 record 内 `target` 和 snapshot。
- `runCreativeWorkflow()` 合并 `projectOptions` 时遵守 N1 规则。
- `skipValidation` 有效值来自 `appSettings.getEffectiveSystemSettings()`，旧 ai-models 仅作降级。

- [ ] **Step 1: 写失败测试**

创建 `tests/test-creative-workflow-defaults.js`，使用临时 `rootDir` 和注入 services：

- `services.appSettings.getCreativeDefaults()` 返回 `aspectRatio: '16:9'`、`targetDurationSec: 90`、`templateByAspectRatio['16:9']: 'bold_signal'`、`lockTemplate: true`、`useResearch: false`。
- 创建 workflow 不传 `useResearch`，断言磁盘 record：
  - `creative_defaults_snapshot.useResearch === false`
  - `creative_defaults_snapshot.templateId === 'bold_signal'`
  - `target.aspect_ratio === '16:9'`
  - `target.duration_sec === 90`
  - `target.preferredTemplateId === 'bold_signal'`
  - `target.lockTemplate === true`
  - `input.use_research === false`
- 创建 workflow 传 `useResearch: true`，断言兼容旧字段覆盖默认。
- 创建 workflow 传 `creativeDefaultsOverride: { useResearch: true, aspectRatio: '9:16' }`，断言新字段覆盖默认。
- 运行 workflow 时修改 mock appSettings 返回值，断言 agentRuns 收到的 `projectOptions` 仍来自 record.target。
- 运行 workflow 传 incoming `projectOptions.preferredTemplateId = 'runtime_override'`，断言最终仍是 record.target 的模板。

- [ ] **Step 2: 确认测试失败**

Run: `node tests/test-creative-workflow-defaults.js`

Expected: fails because snapshot fields are missing.

- [ ] **Step 3: 实现 defaults merge**

In `server/services/creativeWorkflows.js`:

- Import `appSettings`.
- Extend `resolveServices(options)` to expose `appSettings: options.services?.appSettings || appSettings` without breaking existing service injection.
- Add pure helpers near create workflow code:

```js
function buildCreativeDefaultsSnapshot(defaults = {}, override = {}, payload = {}) {
  // Return { aspectRatio, targetDurationSec, templateId, lockTemplate, useResearch }.
}

function buildWorkflowTarget(snapshot) {
  // Return { aspect_ratio, duration_sec, preferredTemplateId, lockTemplate }.
}

function mergeProjectOptions(recordTarget = {}, incoming = {}) {
  // Implement the exact N1 precedence from the data contract section.
}
```

Helper behavior:

- `templateId` resolves from `override.templateId` first, then `defaults.templateByAspectRatio[aspectRatio]`。
- If `payload.useResearch` is boolean, treat it as override after app settings.
- If `payload.creativeDefaultsOverride.useResearch` is boolean, it overrides default. If both old and new fields exist, new `creativeDefaultsOverride` wins.
- Do not mutate original `payload`.
- Pass `effectivePayload` to `creativeContext.normalizeCreativeInput(effectivePayload)`。

- [ ] **Step 4: 写入 record**

In `createCreativeWorkflow()` record:

- Add `creative_defaults_snapshot: snapshot`。
- Add `target: buildWorkflowTarget(snapshot)`。
- Set `skipValidation` from effective system settings, while preserving `normalized.data.skip_validation === true` as explicit request override if currently supported.

- [ ] **Step 5: 更新 run 合并**

In `runCreativeWorkflow()` where `generateDouyinRunHyperframesFreeformProject()` is called:

- Build `projectOptions` with `mergeProjectOptions(record.target, existingProjectOptions)`。
- Do not call `appSettings.getCreativeDefaults()` inside `runCreativeWorkflow()`。

- [ ] **Step 6: 跑测试**

Run:

```powershell
node tests/test-creative-workflow-defaults.js
node tests/test-creative-workflows.js
node tests/test-creative-workflow-tasks.js
```

Expected: all pass.

- [ ] **Step 7: 提交**

Run:

```powershell
git add server/services/creativeWorkflows.js tests/test-creative-workflow-defaults.js
git commit -m "添加一键创作默认值快照"
```

---

### Task 6: Html-Video Preferred and Locked Template

**Files:**
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Modify: `server/services/creative-video/workflowFacade.js`
- Create: `tests/test-html-video-template-preference.js`
- Modify: `tests/test-creative-video-workflow-facade.js` only if no existing test can cover pass-through; preserve unrelated dirty changes.

**Acceptance:**
- `generateHtmlVideo({ preferredTemplateId = '', lockTemplate = false })` supports preferred and locked template.
- `requestTemplateSelection({ preferredTemplateId = '', lockTemplate = false })` supports prompt preference.
- `lockTemplate=false` 且模板有效时，首选模板排在 compact index 第一位，AI 仍可选择其他模板。
- `lockTemplate=false` 且模板无效时，记录诊断并回退普通选择。
- `lockTemplate=true` 且模板不存在或不兼容时，直接返回失败，中文 message 包含模板 ID 和画面比例。
- `lockTemplate=true` 且模板有效时，不允许 AI 改选其他模板。
- `workflowFacade.generateCreativeVideoProject()` 从 `target.preferredTemplateId` 和 `target.lockTemplate` 透传。

- [ ] **Step 1: 写失败测试**

创建 `tests/test-html-video-template-preference.js`，使用临时模板目录和 `createTemplateRegistry({ rootDir })`：

- 竖屏模板 `vertical_template`，aspect `9:16`。
- 横屏模板 `wide_template`，aspect `16:9`。
- Mock model returns selected template id.

Test cases:

- preferred valid + unlocked: `compactIndex[0].id === 'vertical_template'` can be asserted by wrapping `requestTemplateSelection()` model prompt or direct helper export.
- preferred missing + unlocked: result still succeeds with fallback, diagnostics includes `preferred_template_unavailable`。
- preferred incompatible + locked: result fails, message matches `默认模板 vertical_template 不支持当前画面比例 16:9`。
- preferred valid + locked: result uses preferred id even if model mock would choose another id.
- facade pass-through: mock `htmlVideoWorkflow.generateHtmlVideo` receives `preferredTemplateId` and `lockTemplate` from `target`。

- [ ] **Step 2: 确认测试失败**

Run: `node tests/test-html-video-template-preference.js`

Expected: fails because parameters are ignored.

- [ ] **Step 3: 实现 html-video 参数**

In `htmlVideoWorkflow.js`:

- Extend `generateHtmlVideo()` signature:

```js
async function generateHtmlVideo({
  workflowId,
  runId,
  rootDir,
  sceneSpec = null,
  creativeContext = {},
  target = {},
  preferredTemplateId = '',
  lockTemplate = false,
  templateRegistry,
  services = {},
  skipValidation = false,
  onProgress = null,
} = {}) {
  // Keep existing body shape and add preferred-template handling before AI template selection.
}
```

- Resolve effective preferred values from explicit args first, then `target.preferredTemplateId` and `target.lockTemplate`。
- Validate preferred template with `registry.getTemplate(id)` and `validateTemplateCompatibility(template, buildTemplateIndexOptions(renderTarget, sceneSpec))`。
- For locked invalid template, return failure with Chinese message and diagnostic code `locked_template_invalid`。
- For unlocked invalid template, push diagnostic code `preferred_template_unavailable` and continue with existing compact index。
- For unlocked valid template, reorder compact index by moving preferred template to index 0 without duplicating it。

- [ ] **Step 4: 实现 requestTemplateSelection 参数**

In `requestTemplateSelection()`:

- Add `preferredTemplateId = ''` and `lockTemplate = false` params。
- If locked and valid selection is already known, bypass AI selection or constrain compact index to only preferred template。
- If unlocked, include preferred template note in target passed to prompt:

```js
target: {
  ...target,
  preferredTemplateId,
  templateSelectionPolicy: '优先选择该模板，除非内容明显不适合。'
}
```

- [ ] **Step 5: 透传 facade**

In `workflowFacade.generateCreativeVideoProject()` call to `generateHtmlVideo()`:

```js
preferredTemplateId: target.preferredTemplateId || '',
lockTemplate: target.lockTemplate === true,
```

Do not refactor unrelated facade code. This file may already be dirty; inspect `git diff -- server/services/creative-video/workflowFacade.js` before editing and preserve existing changes.

- [ ] **Step 6: 跑测试**

Run:

```powershell
node tests/test-html-video-template-preference.js
node tests/test-html-video-production-regression.js
node tests/test-creative-video-workflow-facade.js
```

Expected: all pass.

- [ ] **Step 7: 提交**

Run:

```powershell
git add server/services/creative-video/html-video/htmlVideoWorkflow.js server/services/creative-video/workflowFacade.js tests/test-html-video-template-preference.js tests/test-creative-video-workflow-facade.js
git commit -m "支持默认视频模板策略"
```

Before commit, ensure `git diff --cached` does not include unrelated pre-existing edits.

---

### Task 7: Settings API Client and Page Shell

**Files:**
- Modify: `frontend-react/src/api/client.js`
- Modify: `frontend-react/src/pages/SettingsPage.jsx`
- Create: `frontend-react/src/components/settings/SettingsOverview.jsx`
- Create: `frontend-react/src/components/settings/ModelSettings.jsx`
- Create: `tests/test-settings-center-shell.mjs`

**Acceptance:**
- `api` exposes `getAppSettings()`、`saveAppSettings(payload)`、`getConfigTemplates()`、`getSystemHealth(refresh)`、`cleanupSystemData(targets)`。
- Settings page first viewport is actual settings center, not marketing content。
- 左侧导航固定 4 项：`总览`、`创作默认值`、`模型配置`、`系统`。
- 模型配置迁移进 `ModelSettings` 后仍使用 `useSettings()` 的现有模型状态和保存逻辑。
- 页面加载 app settings、templates、system health 时有中文 loading 和失败状态。
- 保存模型配置和保存应用配置是两个独立按钮或动作，不混写。

- [ ] **Step 1: 写失败静态测试**

创建 `tests/test-settings-center-shell.mjs`：

```js
import assert from 'assert';
import fs from 'fs';

const page = fs.readFileSync('frontend-react/src/pages/SettingsPage.jsx', 'utf-8');
const client = fs.readFileSync('frontend-react/src/api/client.js', 'utf-8');

assert.match(client, /getAppSettings\(\)/);
assert.match(client, /saveAppSettings\(payload\)/);
assert.match(client, /getConfigTemplates\(\)/);
assert.match(client, /getSystemHealth\(refresh/);
assert.match(client, /cleanupSystemData\(targets\)/);

assert.match(page, /总览/);
assert.match(page, /创作默认值/);
assert.match(page, /模型配置/);
assert.match(page, /系统/);
assert.match(page, /正在加载设置中心/);
assert.match(page, /SettingsOverview/);
assert.match(page, /ModelSettings/);

console.log('settings center shell tests passed');
```

- [ ] **Step 2: 确认测试失败**

Run: `node tests/test-settings-center-shell.mjs`

Expected: fails because API methods and shell are missing.

- [ ] **Step 3: 新增 API client 方法**

In `frontend-react/src/api/client.js`:

```js
getAppSettings() {
  return requestJson('/api/config/app-settings');
},
saveAppSettings(payload) {
  return requestJson('/api/config/app-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
},
getConfigTemplates() {
  return requestJson('/api/config/templates');
},
getSystemHealth(refresh = false) {
  return requestJson(`/api/config/system-health${refresh ? '?refresh=1' : ''}`);
},
cleanupSystemData(targets) {
  return requestJson('/api/config/maintenance/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targets }),
  });
},
```

- [ ] **Step 4: 创建 `ModelSettings`**

Move existing SettingsPage model controls into `frontend-react/src/components/settings/ModelSettings.jsx`:

- `GlobalModelSelector`
- `ProviderList`
- existing model save/reload action bar
- `Status` for model config status

Do not include `ProjectSettings` in model section; `skipValidation` belongs to System section in v1.

- [ ] **Step 5: 创建 `SettingsOverview`**

`SettingsOverview` props:

```js
{
  appSettings,
  modelSettings,
  systemHealth,
  onNavigate
}
```

Display Chinese status cards:

- 文字模型
- TTS
- 默认画面比例
- 默认模板策略
- 质检状态
- 渲染环境
- 数据占用

Cards can be buttons that call `onNavigate('models')`、`onNavigate('creative')`、`onNavigate('system')`。

- [ ] **Step 6: 重做 SettingsPage shell**

In `SettingsPage.jsx`:

- Use `useState('overview')` for active section.
- Use existing `useSettings()` as `modelSettings`。
- Add app state: `appSettings`、`templates`、`systemHealth`、`loadingApp`、`savingApp`、`status`。
- Load app settings, templates, system health on mount with `Promise.allSettled` so one failed request does not blank whole page。
- Provide `saveAppSettings(nextSettings)` that calls `api.saveAppSettings()` and updates Chinese status。
- Render left nav with exact labels。
- Render right content by section。

- [ ] **Step 7: 跑测试**

Run:

```powershell
node tests/test-settings-center-shell.mjs
npm run build:frontend
```

Expected: both pass.

- [ ] **Step 8: 提交**

Run:

```powershell
git add frontend-react/src/api/client.js frontend-react/src/pages/SettingsPage.jsx frontend-react/src/components/settings/SettingsOverview.jsx frontend-react/src/components/settings/ModelSettings.jsx tests/test-settings-center-shell.mjs
git commit -m "重做设置中心页面壳层"
```

---

### Task 8: Creative Defaults UI

**Files:**
- Create: `frontend-react/src/components/settings/CreativeDefaultsSettings.jsx`
- Modify: `frontend-react/src/pages/SettingsPage.jsx`
- Create: `tests/test-creative-defaults-ui.mjs`

**Acceptance:**
- 创作默认值 section 包含默认画面比例、默认目标时长、按比例默认模板、锁定模板、联网研究默认开关。
- 模板下拉按比例展示兼容模板；不兼容模板可以隐藏或禁用，但不得保存非字符串。
- 保存按钮 loading 文案为 `正在保存创作默认值...`，loading 期间禁用。
- 保存成功显示 `创作默认值已保存`。
- 失败显示中文错误。
- 不展示或暗示 `captionMode`、`showCaptionBar`、`renderQuality` 已自动生效。

- [ ] **Step 1: 写失败静态测试**

创建 `tests/test-creative-defaults-ui.mjs`：

```js
import assert from 'assert';
import fs from 'fs';

const source = fs.readFileSync('frontend-react/src/components/settings/CreativeDefaultsSettings.jsx', 'utf-8');
const page = fs.readFileSync('frontend-react/src/pages/SettingsPage.jsx', 'utf-8');

assert.match(source, /默认画面比例/);
assert.match(source, /默认目标时长/);
assert.match(source, /按比例默认模板/);
assert.match(source, /锁定模板/);
assert.match(source, /联网研究默认开启/);
assert.match(source, /正在保存创作默认值/);
assert.match(source, /保存创作默认值/);
assert.doesNotMatch(source, /captionMode|showCaptionBar|renderQuality/);
assert.match(page, /CreativeDefaultsSettings/);

console.log('creative defaults ui tests passed');
```

- [ ] **Step 2: 确认测试失败**

Run: `node tests/test-creative-defaults-ui.mjs`

Expected: fails because component does not exist.

- [ ] **Step 3: 创建组件**

Implement `CreativeDefaultsSettings` with props:

```js
{
  appSettings,
  templates,
  disabled,
  saving,
  onChange,
  onSave
}
```

Implementation requirements:

- `ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5']`。
- Use controlled inputs. `onChange(nextAppSettings)` updates parent draft immediately。
- `templateByAspectRatio[aspect]` updates only that aspect key。
- Save button calls `onSave(nextAppSettings)`。
- Template option label uses `template.name || template.id`。
- If `template.compatible === false`, mark option disabled and append `（不兼容）`。

- [ ] **Step 4: 接入 SettingsPage**

In creative section render:

```jsx
<CreativeDefaultsSettings
  appSettings={appSettings}
  templates={templates}
  disabled={loadingApp || savingApp}
  saving={savingApp}
  onChange={setAppSettings}
  onSave={saveAppSettings}
/>
```

- [ ] **Step 5: 跑测试**

Run:

```powershell
node tests/test-creative-defaults-ui.mjs
npm run build:frontend
```

Expected: both pass.

- [ ] **Step 6: 提交**

Run:

```powershell
git add frontend-react/src/components/settings/CreativeDefaultsSettings.jsx frontend-react/src/pages/SettingsPage.jsx tests/test-creative-defaults-ui.mjs
git commit -m "添加创作默认值设置界面"
```

---

### Task 9: System UI and Cleanup Dialog

**Files:**
- Create: `frontend-react/src/components/settings/SystemSettings.jsx`
- Create: `frontend-react/src/components/settings/CleanupConfirmDialog.jsx`
- Modify: `frontend-react/src/pages/SettingsPage.jsx`
- Create: `tests/test-system-settings-ui.mjs`

**Acceptance:**
- 系统 section 包含质检状态、重新检测、html-video 环境、模板状态、数据维护。
- 清理项固定为创作任务记录、媒体素材缓存、渲染产物、浏览器数据、Cookie。
- 每个清理项单独按钮，不提供“清理全部”。
- 点击清理先打开确认弹窗。
- 确认按钮文案形如 `确认清理媒体素材缓存`。
- loading 文案形如 `正在清理媒体素材缓存...`。
- 成功后刷新 system health。
- 失败显示中文错误。

- [ ] **Step 1: 写失败静态测试**

创建 `tests/test-system-settings-ui.mjs`：

```js
import assert from 'assert';
import fs from 'fs';

const system = fs.readFileSync('frontend-react/src/components/settings/SystemSettings.jsx', 'utf-8');
const dialog = fs.readFileSync('frontend-react/src/components/settings/CleanupConfirmDialog.jsx', 'utf-8');
const page = fs.readFileSync('frontend-react/src/pages/SettingsPage.jsx', 'utf-8');

assert.match(system, /质检状态/);
assert.match(system, /重新检测/);
assert.match(system, /html-video 环境/);
assert.match(system, /创作任务记录/);
assert.match(system, /媒体素材缓存/);
assert.match(system, /渲染产物/);
assert.match(system, /浏览器数据/);
assert.match(system, /Cookie/);
assert.doesNotMatch(system, /清理全部/);
assert.match(dialog, /确认清理/);
assert.match(dialog, /正在清理/);
assert.match(dialog, /此操作不可恢复/);
assert.match(page, /SystemSettings/);

console.log('system settings ui tests passed');
```

- [ ] **Step 2: 确认测试失败**

Run: `node tests/test-system-settings-ui.mjs`

Expected: fails because components do not exist.

- [ ] **Step 3: 创建 `CleanupConfirmDialog`**

Props:

```js
{
  target,
  open,
  loading,
  estimate,
  onCancel,
  onConfirm
}
```

Dialog content:

- Title: `确认清理${label}`
- Body includes `此操作不可恢复。`
- Body includes expected affected path or storage display if passed.
- Cancel button: `取消`
- Confirm button: loading ? `正在清理${label}...` : `确认清理${label}`

- [ ] **Step 4: 创建 `SystemSettings`**

Props:

```js
{
  appSettings,
  systemHealth,
  disabled,
  saving,
  onChange,
  onSave,
  onRefresh
}
```

Implementation requirements:

- `skipValidation` switch updates `appSettings.system.skipValidation`。
- Save system settings uses same `onSave(appSettings)` but button text `保存系统设置`。
- Diagnostics render via `<details>` and read `item.detail`。
- Cleanup calls `api.cleanupSystemData([target])`。
- On cleanup success call `await onRefresh(true)`。
- Disable cleanup buttons while `disabled || cleanupLoading`。

- [ ] **Step 5: 接入 SettingsPage**

Render system section with:

```jsx
<SystemSettings
  appSettings={appSettings}
  systemHealth={systemHealth}
  disabled={loadingApp || savingApp}
  saving={savingApp}
  onChange={setAppSettings}
  onSave={saveAppSettings}
  onRefresh={loadSystemHealth}
/>
```

- [ ] **Step 6: 跑测试**

Run:

```powershell
node tests/test-system-settings-ui.mjs
npm run build:frontend
```

Expected: both pass.

- [ ] **Step 7: 提交**

Run:

```powershell
git add frontend-react/src/components/settings/SystemSettings.jsx frontend-react/src/components/settings/CleanupConfirmDialog.jsx frontend-react/src/pages/SettingsPage.jsx tests/test-system-settings-ui.mjs
git commit -m "添加系统状态和数据维护界面"
```

---

### Task 10: One-Click Research Override

**Files:**
- Modify: `frontend-react/src/pages/OneClickCreativePage.jsx`
- Create: `tests/test-one-click-research-defaults.mjs`

**Acceptance:**
- 页面加载时读取 `api.getAppSettings()`，用 `creativeDefaults.useResearch` 初始化联网研究开关。
- 用户未手动切换时，创建请求不发送 `useResearch`，也不发送 `creativeDefaultsOverride.useResearch`。
- 用户手动切换后，创建请求发送 `creativeDefaultsOverride: { useResearch }`。
- 保留旧后端兼容，但新前端不再无条件发送 `useResearch: useResearch`。
- 加载默认值失败时使用 `true` 作为前端兜底，不阻止用户创建任务。

- [ ] **Step 1: 写失败静态测试**

创建 `tests/test-one-click-research-defaults.mjs`：

```js
import assert from 'assert';
import fs from 'fs';

const source = fs.readFileSync('frontend-react/src/pages/OneClickCreativePage.jsx', 'utf-8');

assert.match(source, /useResearchTouched/);
assert.match(source, /api\.getAppSettings\(\)/);
assert.match(source, /creativeDefaultsOverride/);
assert.match(source, /setUseResearchTouched\(true\)/);
assert.doesNotMatch(source, /useResearch:\s*useResearch,\s*assetIds/s);

console.log('one click research defaults tests passed');
```

N3 rationale: `OneClickCreativePage.jsx` 当前直接构造 API 请求，优先用集成式静态测试或 mock API 测试请求体，不写脆弱的纯 React state 单元测试。

- [ ] **Step 2: 确认测试失败**

Run: `node tests/test-one-click-research-defaults.mjs`

Expected: fails because touched state does not exist.

- [ ] **Step 3: 实现 touched state**

In `OneClickCreativePage.jsx`:

- Add `const [useResearchTouched, setUseResearchTouched] = useState(false);`
- Add effect to load app settings:

```jsx
useEffect(() => {
  let cancelled = false;
  async function loadCreativeDefaults() {
    try {
      const json = await api.getAppSettings();
      const config = json?.data || json;
      if (!cancelled && !useResearchTouched) {
        setUseResearch(config?.creativeDefaults?.useResearch !== false);
      }
    } catch {
      if (!cancelled && !useResearchTouched) {
        setUseResearch(true);
      }
    }
  }
  loadCreativeDefaults();
  return () => { cancelled = true; };
}, [useResearchTouched]);
```

- Update `CreativeComposer` setter:

```jsx
setUseResearch={(value) => {
  setUseResearchTouched(true);
  setUseResearch(value);
}}
```

- Build submit payload:

```js
const requestPayload = {
  input: trimmed,
  assetIds: [],
  renderOptions: {},
  workflowOptions: {},
  ...(useResearchTouched ? { creativeDefaultsOverride: { useResearch } } : {}),
};
```

- Remove unconditional `useResearch: useResearch` from request payload.

- [ ] **Step 4: 跑测试**

Run:

```powershell
node tests/test-one-click-research-defaults.mjs
node tests/test-one-click-creative-page.mjs
npm run build:frontend
```

Expected: all pass.

- [ ] **Step 5: 提交**

Run:

```powershell
git add frontend-react/src/pages/OneClickCreativePage.jsx tests/test-one-click-research-defaults.mjs
git commit -m "接入一键创作联网研究默认值"
```

---

### Task 11: Settings Center Styles

**Files:**
- Modify: `frontend-react/src/styles.css`
- Create: `tests/test-settings-center-styles.mjs`

**Acceptance:**
- 样式只新增设置中心命名前缀 block。
- 左侧导航桌面为固定窄栏，移动端变为两列或单列按钮。
- 不出现 UI 元素重叠；按钮文字在移动端可换行。
- 没有新增大面积单色调装饰背景、渐变球、营销 hero。
- 设置内容保持工具型界面密度。

- [ ] **Step 1: 写失败静态测试**

创建 `tests/test-settings-center-styles.mjs`：

```js
import assert from 'assert';
import fs from 'fs';

const css = fs.readFileSync('frontend-react/src/styles.css', 'utf-8');

assert.match(css, /\.settingsCenterLayout/);
assert.match(css, /\.settingsCenterNav/);
assert.match(css, /\.settingsPanel/);
assert.match(css, /\.settingsCleanupGrid/);
assert.match(css, /@media \(max-width: 900px\)/);
assert.doesNotMatch(css, /gradient-orb|bokeh|heroGradient/);

console.log('settings center styles tests passed');
```

- [ ] **Step 2: 确认测试失败**

Run: `node tests/test-settings-center-styles.mjs`

Expected: fails because styles are missing.

- [ ] **Step 3: 添加小范围样式**

Append one bounded block marked:

```css
/* Settings center */
```

Required selectors:

- `.settingsCenterLayout`
- `.settingsCenterNav`
- `.settingsCenterNav button`
- `.settingsCenterNav button.active`
- `.settingsCenterContent`
- `.settingsPanel`
- `.settingsPanelHeader`
- `.settingsOverviewGrid`
- `.settingsCleanupGrid`
- `.settingsCleanupItem`
- `.modalBackdrop`
- `.modalPanel`

Style constraints:

- Cards radius max `8px`。
- Avoid nested card styling。
- Keep colors neutral with clear accents; do not create one-note purple/blue/slate theme。
- Mobile media query at `max-width: 900px`。

- [ ] **Step 4: 跑测试和构建**

Run:

```powershell
node tests/test-settings-center-styles.mjs
npm run build:frontend
```

Expected: both pass.

- [ ] **Step 5: 提交**

Run:

```powershell
git add frontend-react/src/styles.css tests/test-settings-center-styles.mjs
git commit -m "完善设置中心样式"
```

---

### Task 12: Documentation and Final Verification

**Files:**
- Modify: `README.md`

**Acceptance:**
- README 记录 `data/config/app-settings.json`。
- README 记录新增 API。
- README 记录默认值 snapshot 行为。
- 全量测试和前端构建通过，或明确列出与本次无关的失败。

- [ ] **Step 1: 更新 README**

Add local config note:

```markdown
- `data/config/app-settings.json`：设置中心保存的一键创作默认值和系统设置。
```

Add API notes:

```markdown
- `GET /api/config/app-settings`：读取设置中心应用配置。
- `POST /api/config/app-settings`：保存设置中心应用配置。
- `GET /api/config/templates`：读取 html-video 可用模板简表。
- `GET /api/config/system-health`：读取系统环境和数据占用概览。
- `POST /api/config/maintenance/cleanup`：按类型清理本地数据。
```

Add behavior note:

```markdown
一键创作在创建 workflow 时会把当前创作默认值写入 `creative_defaults_snapshot`，后续运行只读取该快照，不会因用户之后修改设置而改变已创建任务。
```

- [ ] **Step 2: 跑定向测试**

Run:

```powershell
node tests/test-app-settings.js
node tests/test-config-settings-routes.js
node tests/test-system-health.js
node tests/test-system-maintenance-cleanup.js
node tests/test-creative-workflow-defaults.js
node tests/test-html-video-template-preference.js
node tests/test-settings-center-shell.mjs
node tests/test-creative-defaults-ui.mjs
node tests/test-system-settings-ui.mjs
node tests/test-one-click-research-defaults.mjs
node tests/test-settings-center-styles.mjs
```

Expected: all print their passed line.

- [ ] **Step 3: 跑回归**

Run:

```powershell
npm test
npm run build:frontend
```

Expected: both pass. If either fails, record exact failing file, command, and first actionable error line.

- [ ] **Step 4: 手工检查本地页面**

Start dev server if not running:

```powershell
npm run dev
```

Open current app URL and verify:

- Settings page opens.
- 左侧 4 个分组可切换。
- 保存创作默认值显示 loading 并成功。
- 系统页重新检测显示 loading 并刷新时间。
- 清理按钮弹确认框，取消不会删除。
- 模型配置仍能加载。

- [ ] **Step 5: 提交**

Run:

```powershell
git add README.md
git commit -m "补充设置中心文档"
```

If README already contains all required content and no diff remains, skip this commit and report `README 无需修改`。

---

## 自检清单

- [ ] B1 snapshot 写入时机明确：Task 5 在 `createCreativeWorkflow()`、`normalizeCreativeInput()` 前合并默认值，并与 record 同次 `persistWorkflow()`。
- [ ] I1 `skipValidation` 双写窗口明确：Task 1 和 Task 5 使用 `appSettings.getEffectiveSystemSettings()`，旧 ai-models 只作 fallback。
- [ ] I2 `useResearch` 临时切换明确：Task 10 使用 `useResearchTouched`，未触碰不发送覆盖字段。
- [ ] I3 `system-health` 延迟明确：Task 3 缓存环境 60 秒、存储 15 秒，支持 refresh。
- [ ] I4 `render-outputs` 规则明确：Task 4 只删白名单已知产物。
- [ ] I5 `htmlVideoWorkflow` 签名明确：Task 6 定义 `preferredTemplateId`、`lockTemplate`。
- [ ] I6 `/api/config/templates` 字段明确：数据契约和 Task 2 已列字段。
- [ ] L1-L3 范围明确：护栏排除 `captionMode`、`showCaptionBar`、`renderQuality` 自动生效。
- [ ] N1 `projectOptions` 合并优先级明确：数据契约给出 `mergeProjectOptions()`。
- [ ] N2 diagnostics 结构明确：数据契约给出 `{ ok, code, message, detail, path }`。
- [ ] N3 前端测试策略明确：Task 10 使用静态或 mock API 集成式测试。
- [ ] `tests/run-all.js` 自动发现已说明，不要求手动注册测试。
- [ ] 每个任务都有文件列表、验收标准、失败测试、实现要点、测试命令和提交命令。
- [ ] 计划没有要求改动无关脏文件。

## 执行选项

Plan complete and saved to `docs/superpowers/plans/2026-06-22-settings-center-redesign.md`. Two execution options:

1. **Subagent-Driven (recommended)** - 每个任务派一个新子代理执行，任务间做 review 和验收。
2. **Inline Execution** - 在当前会话按任务顺序执行，阶段性检查。

Which approach?
