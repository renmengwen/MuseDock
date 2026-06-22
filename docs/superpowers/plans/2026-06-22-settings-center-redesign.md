# Settings Center Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将设置页重构为设置中心 v1，支持一键创作默认值自动生效、模型配置迁移展示、系统健康概览和安全的数据维护。

**Architecture:** 新增独立 `appSettings` 配置服务和 `systemMaintenance` 服务，前端设置中心通过 `/api/config/*` 统一读取应用配置、模板、系统健康和维护操作。workflow 创建时在 `createCreativeWorkflow()` 内合并默认值并持久化 snapshot，运行阶段只读取 workflow 记录，不再读取最新设置。

**Tech Stack:** Node.js 22、Express、React 19、Vite、shadcn/ui、Tailwind CSS、内置 Node 测试脚本。

---

## Scope Notes

本计划覆盖 `docs/superpowers/specs/2026-06-22-settings-center-redesign-design.md` 的 v1 范围。`captionMode`、`showCaptionBar`、`renderQuality` 不作为 v1 自动生效项，只在后续扩展中接入。

本计划包含 review 备注：

- N1：`creativeWorkflows.runCreativeWorkflow()` 合并 `record.target` 到 `projectOptions` 时，以 `record.target` 为基础；如果调用方已传 `projectOptions`，`record.target.preferredTemplateId` 和 `record.target.lockTemplate` 必须覆盖调用方同名字段，保证 workflow snapshot 稳定。
- N2：`system-health.environment.diagnostics[]` 使用统一对象格式 `{ code, ok, message, detail, path }`，前端折叠展示读取 `detail`。
- N3：一键创作 `useResearch` 请求体测试使用前端集成式静态测试或 mock API，不做脆弱的纯单元测试。

## File Map

- Create `server/services/appSettings.js`：读写 `data/config/app-settings.json`，规范化创作默认值和系统设置，处理旧 `ai-models.json` 的 `skipValidation` 降级。
- Create `server/services/systemMaintenance.js`：系统健康缓存、存储占用统计、render outputs 识别、白名单清理和运行中任务阻止。
- Modify `server/routes/config.js`：新增 app settings、templates、system health、maintenance cleanup 路由。
- Modify `server/services/creativeWorkflows.js`：在创建 workflow 时合并默认值，写入 `creative_defaults_snapshot` 和 `target`；运行时把 `record.target` 合并到 `projectOptions`。
- Modify `server/services/creative-video/html-video/htmlVideoWorkflow.js`：支持 `preferredTemplateId` 和 `lockTemplate`。
- Modify `server/services/creative-video/workflowFacade.js`：透传 `target.preferredTemplateId` 和 `target.lockTemplate` 到 html-video workflow。
- Modify `frontend-react/src/api/client.js`：新增设置中心 API client 方法。
- Modify `frontend-react/src/hooks/useSettings.js`：保留模型配置 hook，避免把应用默认值塞回模型配置状态。
- Modify `frontend-react/src/pages/SettingsPage.jsx`：改为设置中心壳层。
- Create `frontend-react/src/components/settings/SettingsOverview.jsx`。
- Create `frontend-react/src/components/settings/CreativeDefaultsSettings.jsx`。
- Create `frontend-react/src/components/settings/ModelSettings.jsx`。
- Create `frontend-react/src/components/settings/SystemSettings.jsx`。
- Create `frontend-react/src/components/settings/CleanupConfirmDialog.jsx`。
- Modify `frontend-react/src/pages/OneClickCreativePage.jsx`：加载默认联网研究值，跟踪 `useResearchTouched`，未触碰时不发送覆盖字段。
- Modify `README.md`：补充 `app-settings.json`、新增 API 和维护行为。
- Create `tests/test-app-settings.js`。
- Create `tests/test-creative-workflow-defaults.js`。
- Create `tests/test-html-video-template-preference.js`。
- Create `tests/test-system-maintenance.js`。
- Create or modify frontend static tests under `tests/*.mjs` for settings center and one-click request body behavior.

---

### Task 1: App Settings Service

**Files:**
- Create: `server/services/appSettings.js`
- Test: `tests/test-app-settings.js`
- Modify: `package.json` only if the project test runner requires adding the new test to `tests/run-all.js` instead of discovering it automatically.

- [ ] **Step 1: Write failing app settings tests**

Create `tests/test-app-settings.js`:

```js
const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const appSettings = require('../server/services/appSettings');

async function makeRoot() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'app-settings-test-'));
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
}

async function runDefaultConfigTest() {
  const root = await makeRoot();
  const configPath = path.join(root, 'app-settings.json');
  const publicConfig = await appSettings.getPublicConfig({ configPath });
  assert.equal(publicConfig.version, 1);
  assert.equal(publicConfig.creativeDefaults.aspectRatio, '9:16');
  assert.equal(publicConfig.creativeDefaults.targetDurationSec, 60);
  assert.equal(publicConfig.creativeDefaults.templateByAspectRatio['9:16'], 'news_signal_vertical');
  assert.equal(publicConfig.creativeDefaults.lockTemplate, false);
  assert.equal(publicConfig.creativeDefaults.useResearch, true);
  assert.equal(publicConfig.system.skipValidation, false);
}

async function runSaveNormalizationTest() {
  const root = await makeRoot();
  const configPath = path.join(root, 'app-settings.json');
  const saved = await appSettings.saveConfig({
    creativeDefaults: {
      aspectRatio: 'bad',
      targetDurationSec: 9999,
      templateByAspectRatio: {
        '9:16': '  news_signal_vertical  ',
        '16:9': 123,
      },
      lockTemplate: true,
      useResearch: false,
    },
    system: { skipValidation: true },
  }, { configPath });
  assert.equal(saved.creativeDefaults.aspectRatio, '9:16');
  assert.equal(saved.creativeDefaults.targetDurationSec, 180);
  assert.equal(saved.creativeDefaults.templateByAspectRatio['9:16'], 'news_signal_vertical');
  assert.equal(saved.creativeDefaults.templateByAspectRatio['16:9'], '');
  assert.equal(saved.creativeDefaults.lockTemplate, true);
  assert.equal(saved.creativeDefaults.useResearch, false);
  assert.equal(saved.system.skipValidation, true);
  const disk = await readJson(configPath);
  assert.equal(disk.version, 1);
}

async function runLegacySkipValidationFallbackTest() {
  const root = await makeRoot();
  const configPath = path.join(root, 'app-settings.json');
  const aiConfigPath = path.join(root, 'ai-models.json');
  await fsp.writeFile(aiConfigPath, JSON.stringify({ providers: {}, active: {}, skipValidation: true }), 'utf-8');
  const effectiveBeforeSave = await appSettings.getEffectiveSystemSettings({ configPath, aiConfigPath });
  assert.equal(effectiveBeforeSave.skipValidation, true);
  assert.equal(effectiveBeforeSave.source, 'legacy-ai-models');
  await appSettings.saveConfig({ creativeDefaults: {}, system: { skipValidation: false } }, { configPath, aiConfigPath });
  const effectiveAfterSave = await appSettings.getEffectiveSystemSettings({ configPath, aiConfigPath });
  assert.equal(effectiveAfterSave.skipValidation, false);
  assert.equal(effectiveAfterSave.source, 'app-settings');
}

async function runHasConfigTest() {
  const root = await makeRoot();
  const configPath = path.join(root, 'app-settings.json');
  assert.equal(await appSettings.hasConfig({ configPath }), false);
  await appSettings.saveConfig({}, { configPath });
  assert.equal(fs.existsSync(configPath), true);
  assert.equal(await appSettings.hasConfig({ configPath }), true);
}

(async () => {
  await runDefaultConfigTest();
  await runSaveNormalizationTest();
  await runLegacySkipValidationFallbackTest();
  await runHasConfigTest();
  console.log('app settings tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-app-settings.js
```

Expected: FAIL with `Cannot find module '../server/services/appSettings'`.

- [ ] **Step 3: Implement `server/services/appSettings.js`**

Create `server/services/appSettings.js`:

```js
const fsp = require('fs/promises');
const path = require('path');
const aiModelConfig = require('./aiModelConfig');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../data/config/app-settings.json');
const DEFAULT_AI_CONFIG_PATH = aiModelConfig.DEFAULT_CONFIG_PATH;
const ALLOWED_ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5'];
const DEFAULT_TEMPLATE_BY_ASPECT_RATIO = {
  '9:16': 'news_signal_vertical',
  '16:9': 'bold_signal',
  '1:1': '',
  '4:5': '',
};

const DEFAULT_CONFIG = {
  version: 1,
  creativeDefaults: {
    aspectRatio: '9:16',
    targetDurationSec: 60,
    templateByAspectRatio: DEFAULT_TEMPLATE_BY_ASPECT_RATIO,
    lockTemplate: false,
    useResearch: true,
  },
  system: {
    skipValidation: false,
  },
};

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeAspectRatio(value) {
  const text = normalizeString(value);
  return ALLOWED_ASPECT_RATIOS.includes(text) ? text : DEFAULT_CONFIG.creativeDefaults.aspectRatio;
}

function normalizeTemplateByAspectRatio(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const result = {};
  for (const aspect of ALLOWED_ASPECT_RATIOS) {
    const rawValue = Object.prototype.hasOwnProperty.call(source, aspect)
      ? source[aspect]
      : DEFAULT_TEMPLATE_BY_ASPECT_RATIO[aspect];
    result[aspect] = normalizeString(rawValue);
  }
  return result;
}

function normalizeCreativeDefaults(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    aspectRatio: normalizeAspectRatio(source.aspectRatio),
    targetDurationSec: normalizeInteger(source.targetDurationSec, DEFAULT_CONFIG.creativeDefaults.targetDurationSec, 15, 180),
    templateByAspectRatio: normalizeTemplateByAspectRatio(source.templateByAspectRatio),
    lockTemplate: normalizeBoolean(source.lockTemplate, DEFAULT_CONFIG.creativeDefaults.lockTemplate),
    useResearch: normalizeBoolean(source.useResearch, DEFAULT_CONFIG.creativeDefaults.useResearch),
  };
}

function normalizeSystemSettings(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    skipValidation: normalizeBoolean(source.skipValidation, DEFAULT_CONFIG.system.skipValidation),
  };
}

function normalizeConfig(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    version: 1,
    creativeDefaults: normalizeCreativeDefaults(source.creativeDefaults),
    system: normalizeSystemSettings(source.system),
  };
}

async function hasConfig(options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  try {
    await fsp.access(configPath);
    return true;
  } catch {
    return false;
  }
}

async function readStoredConfig(options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  try {
    const raw = JSON.parse(await fsp.readFile(configPath, 'utf-8'));
    return normalizeConfig(raw);
  } catch {
    return normalizeConfig(DEFAULT_CONFIG);
  }
}

async function writeStoredConfig(config, options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, JSON.stringify(normalizeConfig(config), null, 2), 'utf-8');
}

async function getPublicConfig(options = {}) {
  return readStoredConfig(options);
}

async function saveConfig(input = {}, options = {}) {
  const existed = await hasConfig(options);
  let baseSystem = {};
  if (!existed) {
    baseSystem = await getEffectiveSystemSettings(options);
  }
  const normalized = normalizeConfig({
    creativeDefaults: input.creativeDefaults || {},
    system: {
      ...baseSystem,
      ...(input.system || {}),
    },
  });
  await writeStoredConfig(normalized, options);
  return normalized;
}

async function getCreativeDefaults(options = {}) {
  const config = await readStoredConfig(options);
  return config.creativeDefaults;
}

async function getSystemSettings(options = {}) {
  const config = await readStoredConfig(options);
  return config.system;
}

async function getEffectiveSystemSettings(options = {}) {
  if (await hasConfig(options)) {
    return {
      ...await getSystemSettings(options),
      source: 'app-settings',
    };
  }
  const aiConfigPath = options.aiConfigPath || DEFAULT_AI_CONFIG_PATH;
  let skipValidation = false;
  try {
    skipValidation = await aiModelConfig.getSkipValidation({ configPath: aiConfigPath });
  } catch {
    skipValidation = false;
  }
  return {
    skipValidation,
    source: 'legacy-ai-models',
  };
}

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

- [ ] **Step 4: Run app settings test**

Run:

```powershell
node tests/test-app-settings.js
```

Expected: `app settings tests passed`.

- [ ] **Step 5: Commit**

Run:

```powershell
git add server/services/appSettings.js tests/test-app-settings.js
git commit -m "添加应用设置配置服务"
```

Expected: commit succeeds.

---

### Task 2: Config Routes, Templates API, and System Health Skeleton

**Files:**
- Create: `server/services/systemMaintenance.js`
- Modify: `server/routes/config.js`
- Test: `tests/test-system-maintenance.js`

- [ ] **Step 1: Write failing system maintenance tests**

Create `tests/test-system-maintenance.js`:

```js
const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const maintenance = require('../server/services/systemMaintenance');

async function makeRoot() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'system-maintenance-test-'));
}

async function runHealthCacheTest() {
  const root = await makeRoot();
  let doctorCalls = 0;
  const services = {
    environmentDoctor: async () => {
      doctorCalls += 1;
      return {
        ok: true,
        diagnostics: [{ ok: true, code: 'ffmpeg_available', message: 'ffmpeg 可用。', path: 'ffmpeg' }],
      };
    },
    modelConfig: {
      getPublicConfig: async () => ({
        providers: {
          p1: {
            name: '测试供应商',
            models: {
              text: { enabled: true, modelId: 'gpt-test' },
              tts: { enabled: false, modelId: '' },
              multimodal: { enabled: false, modelId: '' },
            },
          },
        },
        active: { text: 'p1/text' },
      }),
    },
  };
  const first = await maintenance.getSystemHealth({ rootDir: root, services, now: () => '2026-06-22T00:00:00.000Z' });
  const second = await maintenance.getSystemHealth({ rootDir: root, services, now: () => '2026-06-22T00:00:10.000Z' });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(doctorCalls, 1);
  assert.deepEqual(first.environment.diagnostics[0], {
    ok: true,
    code: 'ffmpeg_available',
    message: 'ffmpeg 可用。',
    detail: '',
    path: 'ffmpeg',
  });
}

async function runRenderOutputDetectionTest() {
  const root = await makeRoot();
  const mediaRoot = path.join(root, 'data', 'media', 'douyin');
  const projectDir = path.join(mediaRoot, '12345', 'agent_runs', 'run-1-project');
  await fsp.mkdir(path.join(projectDir, 'exports'), { recursive: true });
  await fsp.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  await fsp.mkdir(path.join(projectDir, 'inspect', 'previews'), { recursive: true });
  await fsp.writeFile(path.join(projectDir, 'exports', 'output.mp4'), 'mp4');
  await fsp.writeFile(path.join(projectDir, 'frames', 'frame_01.mp4'), 'mp4');
  await fsp.writeFile(path.join(projectDir, 'inspect', 'previews', 'frame_01.mp4'), 'mp4');
  await fsp.writeFile(path.join(projectDir, 'metadata.json'), '{}');
  const outputs = await maintenance.findRenderOutputs({ mediaRoot });
  const normalized = outputs.map(item => path.basename(item.path)).sort();
  assert.deepEqual(normalized, ['frame_01.mp4', 'frame_01.mp4', 'output.mp4'].sort());
  assert.equal(outputs.some(item => item.path.endsWith('metadata.json')), false);
}

async function runCleanupGuardTest() {
  const root = await makeRoot();
  const mediaRoot = path.join(root, 'data', 'media', 'douyin');
  await fsp.mkdir(mediaRoot, { recursive: true });
  const blocked = await maintenance.cleanupTargets({
    targets: ['media-cache'],
    mediaRoot,
    hasRunningCreativeTasks: async () => true,
  });
  assert.equal(blocked.success, false);
  assert.match(blocked.message, /当前有创作任务正在运行/);
}

(async () => {
  await runHealthCacheTest();
  await runRenderOutputDetectionTest();
  await runCleanupGuardTest();
  console.log('system maintenance tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-system-maintenance.js
```

Expected: FAIL with `Cannot find module '../server/services/systemMaintenance'`.

- [ ] **Step 3: Implement `server/services/systemMaintenance.js`**

Create `server/services/systemMaintenance.js`:

```js
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DEFAULT_ROOT = path.join(__dirname, '../../data/creative-workflows');
const DEFAULT_MEDIA_ROOT = path.join(__dirname, '../../data/media/douyin');
const DEFAULT_BROWSER_DATA_ROOT = path.join(__dirname, '../../chrome-user-data');
const DEFAULT_COOKIE_FILE = path.join(__dirname, '../../douyin-cookies.json');
const HEALTH_CACHE_TTL_MS = 60 * 1000;
const STORAGE_CACHE_TTL_MS = 15 * 1000;

const cache = {
  health: null,
  healthAt: 0,
  storage: null,
  storageAt: 0,
};

function nowMs() {
  return Date.now();
}

function normalizeDiagnostic(item = {}) {
  return {
    ok: item.ok === true,
    code: String(item.code || (item.ok ? 'ok' : 'diagnostic')).trim(),
    message: String(item.message || '').trim(),
    detail: String(item.detail || item.error || item.stderr || '').trim(),
    path: String(item.path || '').trim(),
  };
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

async function pathSize(targetPath) {
  try {
    const stat = await fsp.stat(targetPath);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    const entries = await fsp.readdir(targetPath, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      total += await pathSize(path.join(targetPath, entry.name));
    }
    return total;
  } catch {
    return 0;
  }
}

function statEntry(bytes) {
  return { bytes, display: formatBytes(bytes) };
}

function assertInside(rootDir, targetPath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return target;
}

async function walkFiles(rootDir, visitor) {
  let entries;
  try {
    entries = await fsp.readdir(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(fullPath, visitor);
    } else if (entry.isFile()) {
      await visitor(fullPath);
    }
  }
}

function isAllowedRenderOutput(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return /\/exports\/[^/]+\.(mp4|webm|mov)$/i.test(normalized)
    || /\/frames\/[^/]+\.mp4$/i.test(normalized)
    || /\/inspect\/previews\/[^/]+\.mp4$/i.test(normalized)
    || /\/output\.mp4$/i.test(normalized);
}

async function findRenderOutputs({ mediaRoot = DEFAULT_MEDIA_ROOT } = {}) {
  const root = path.resolve(mediaRoot);
  const outputs = [];
  await walkFiles(root, async filePath => {
    const safePath = assertInside(root, filePath);
    if (!safePath || !isAllowedRenderOutput(safePath)) return;
    const stat = await fsp.stat(safePath);
    outputs.push({ path: safePath, bytes: stat.size });
  });
  return outputs;
}

async function getStorageOverview(options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const mediaRoot = options.mediaRoot || DEFAULT_MEDIA_ROOT;
  const browserDataRoot = options.browserDataRoot || DEFAULT_BROWSER_DATA_ROOT;
  const cookieFile = options.cookieFile || DEFAULT_COOKIE_FILE;
  const renderOutputs = await findRenderOutputs({ mediaRoot });
  const renderBytes = renderOutputs.reduce((sum, item) => sum + item.bytes, 0);
  return {
    creativeWorkflows: statEntry(await pathSize(rootDir)),
    mediaCache: statEntry(await pathSize(mediaRoot)),
    renderOutputs: statEntry(renderBytes),
    browserData: statEntry(await pathSize(browserDataRoot)),
    cookies: statEntry(await pathSize(cookieFile)),
  };
}

function resolveModelSummary(publicConfig = {}) {
  const result = {};
  const providers = publicConfig.providers || {};
  const active = publicConfig.active || {};
  for (const type of ['text', 'tts', 'multimodal']) {
    const ref = String(active[type] || '');
    const [providerId, modelType] = ref.split('/');
    const provider = providers[providerId] || {};
    const model = provider.models?.[modelType || type] || {};
    result[type] = {
      enabled: model.enabled === true,
      providerName: provider.name || '',
      modelId: model.modelId || '',
    };
  }
  return result;
}

async function getSystemHealth(options = {}) {
  const refresh = options.refresh === true;
  const currentMs = nowMs();
  const currentIso = options.now ? options.now() : new Date().toISOString();
  const healthFresh = cache.health && currentMs - cache.healthAt < HEALTH_CACHE_TTL_MS;
  const storageFresh = cache.storage && currentMs - cache.storageAt < STORAGE_CACHE_TTL_MS;
  let environment;
  let storage;
  let cached = false;

  if (!refresh && healthFresh) {
    environment = cache.health;
    cached = true;
  } else {
    const doctor = options.services?.environmentDoctor || (async () => ({ ok: true, diagnostics: [] }));
    const rawEnvironment = await doctor();
    environment = {
      ok: rawEnvironment.ok === true,
      diagnostics: (rawEnvironment.diagnostics || []).map(normalizeDiagnostic),
    };
    cache.health = environment;
    cache.healthAt = currentMs;
  }

  if (!refresh && storageFresh) {
    storage = cache.storage;
  } else {
    storage = await getStorageOverview(options);
    cache.storage = storage;
    cache.storageAt = currentMs;
  }

  const modelConfig = options.services?.modelConfig;
  const modelPublicConfig = modelConfig?.getPublicConfig ? await modelConfig.getPublicConfig() : {};

  return {
    success: true,
    cached,
    checked_at: currentIso,
    cache_ttl_sec: HEALTH_CACHE_TTL_MS / 1000,
    environment,
    templates: options.templates || {
      count: 0,
      default_template_id: '',
      default_template_compatible: false,
      default_template_reasons: [],
    },
    models: resolveModelSummary(modelPublicConfig),
    storage,
  };
}

async function cleanupTargets(options = {}) {
  const targets = Array.isArray(options.targets) ? options.targets : [];
  const hasRunningCreativeTasks = options.hasRunningCreativeTasks || (async () => false);
  if (await hasRunningCreativeTasks()) {
    return { success: false, message: '当前有创作任务正在运行，请停止或等待完成后再清理媒体缓存。' };
  }
  return {
    success: true,
    cleaned: [],
    released_bytes: 0,
    message: targets.length ? '清理完成。' : '未选择清理类型。',
  };
}

module.exports = {
  normalizeDiagnostic,
  formatBytes,
  assertInside,
  findRenderOutputs,
  getStorageOverview,
  getSystemHealth,
  cleanupTargets,
};
```

- [ ] **Step 4: Run system maintenance test**

Run:

```powershell
node tests/test-system-maintenance.js
```

Expected: `system maintenance tests passed`.

- [ ] **Step 5: Add config routes**

Modify `server/routes/config.js` to import services:

```js
const appSettings = require('../services/appSettings');
const systemMaintenance = require('../services/systemMaintenance');
const { buildCompactIndex, validateTemplateCompatibility } = require('../services/creative-video/html-video/templateRegistry');
const environmentDoctor = require('../services/creative-video/html-video/environmentDoctor');
```

Add routes after `/ai-models` routes:

```js
router.get('/app-settings', async (req, res) => {
  try {
    const config = await appSettings.getPublicConfig();
    res.json({ success: true, ...config });
  } catch (error) {
    res.status(500).json({ success: false, message: `读取应用设置失败：${error.message}` });
  }
});

router.post('/app-settings', async (req, res) => {
  try {
    const config = await appSettings.saveConfig(req.body || {});
    res.json({ success: true, ...config });
  } catch (error) {
    res.status(500).json({ success: false, message: `保存应用设置失败：${error.message}` });
  }
});

router.get('/templates', async (req, res) => {
  try {
    const settings = await appSettings.getPublicConfig();
    const aspectRatio = settings.creativeDefaults.aspectRatio;
    const templates = buildCompactIndex({ aspectRatio }).map(template => ({
      ...template,
      compatible: true,
      compatibility_reasons: [],
    }));
    res.json({ success: true, data: templates });
  } catch (error) {
    res.status(500).json({ success: false, message: `读取模板列表失败：${error.message}` });
  }
});

router.get('/system-health', async (req, res) => {
  try {
    const health = await systemMaintenance.getSystemHealth({
      refresh: req.query.refresh === '1',
      services: {
        environmentDoctor: environmentDoctor.diagnoseEnvironment,
        modelConfig: aiModelConfig,
      },
    });
    res.json(health);
  } catch (error) {
    res.status(500).json({ success: false, message: `读取系统状态失败：${error.message}` });
  }
});

router.post('/maintenance/cleanup', async (req, res) => {
  try {
    const result = await systemMaintenance.cleanupTargets({ targets: req.body?.targets || [] });
    res.status(result.success === false ? 400 : 200).json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: `清理数据失败：${error.message}` });
  }
});
```

If `validateTemplateCompatibility` is not exported from the registry used by the route, do not use it in this route step; compatibility is already represented by filtering `buildCompactIndex({ aspectRatio })`.

- [ ] **Step 6: Run route smoke tests**

Run:

```powershell
node tests/test-system-maintenance.js
npm test -- --filter test-ai-model-config
```

Expected: system maintenance passes; existing config tests still pass. If `npm test -- --filter` is unsupported, run `node tests/run-all.js` after Task 8.

- [ ] **Step 7: Commit**

Run:

```powershell
git add server/services/systemMaintenance.js server/routes/config.js tests/test-system-maintenance.js
git commit -m "添加设置中心系统状态接口"
```

Expected: commit succeeds.

---

### Task 3: Workflow Defaults Snapshot

**Files:**
- Modify: `server/services/creativeWorkflows.js`
- Test: `tests/test-creative-workflow-defaults.js`

- [ ] **Step 1: Write failing workflow defaults tests**

Create `tests/test-creative-workflow-defaults.js`:

```js
const assert = require('assert');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const workflows = require('../server/services/creativeWorkflows');

async function makeRoot() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'creative-workflow-defaults-test-'));
}

async function readWorkflow(rootDir, workflowId) {
  return JSON.parse(await fsp.readFile(path.join(rootDir, `${workflowId}.json`), 'utf-8'));
}

function servicesWithDefaults(defaults) {
  return {
    idFactory: () => '20260622000000123456',
    appSettings: {
      getCreativeDefaults: async () => defaults,
      getEffectiveSystemSettings: async () => ({ skipValidation: false, source: 'app-settings' }),
    },
  };
}

async function runSnapshotCreationTest() {
  const rootDir = await makeRoot();
  const result = await workflows.createCreativeWorkflow({
    input: '做一期 AI 视频生产科普',
  }, {
    rootDir,
    services: servicesWithDefaults({
      aspectRatio: '16:9',
      targetDurationSec: 45,
      templateByAspectRatio: { '16:9': 'bold_signal' },
      lockTemplate: true,
      useResearch: false,
    }),
  });
  assert.equal(result.success, true);
  const record = await readWorkflow(rootDir, result.workflow_id);
  assert.deepEqual(record.creative_defaults_snapshot, {
    aspectRatio: '16:9',
    targetDurationSec: 45,
    templateId: 'bold_signal',
    lockTemplate: true,
    useResearch: false,
  });
  assert.deepEqual(record.target, {
    aspect_ratio: '16:9',
    duration_sec: 45,
    preferredTemplateId: 'bold_signal',
    lockTemplate: true,
  });
  assert.equal(record.input.use_research, false);
}

async function runExplicitUseResearchOverrideTest() {
  const rootDir = await makeRoot();
  const result = await workflows.createCreativeWorkflow({
    input: '做一期 AI 视频生产科普',
    creativeDefaultsOverride: { useResearch: true },
  }, {
    rootDir,
    services: servicesWithDefaults({
      aspectRatio: '9:16',
      targetDurationSec: 60,
      templateByAspectRatio: { '9:16': 'news_signal_vertical' },
      lockTemplate: false,
      useResearch: false,
    }),
  });
  const record = await readWorkflow(rootDir, result.workflow_id);
  assert.equal(record.creative_defaults_snapshot.useResearch, true);
  assert.equal(record.input.use_research, true);
}

async function runProjectOptionsMergeTest() {
  const rootDir = await makeRoot();
  const mediaRoot = await makeRoot();
  const calls = [];
  const createResult = await workflows.createCreativeWorkflow({
    input: '做一期 AI 视频生产科普',
  }, {
    rootDir,
    services: servicesWithDefaults({
      aspectRatio: '9:16',
      targetDurationSec: 60,
      templateByAspectRatio: { '9:16': 'news_signal_vertical' },
      lockTemplate: true,
      useResearch: false,
    }),
  });
  const services = {
    ...servicesWithDefaults({
      aspectRatio: '9:16',
      targetDurationSec: 60,
      templateByAspectRatio: { '9:16': 'ignored' },
      lockTemplate: false,
      useResearch: true,
    }),
    researchService: { createResearchContext: async () => ({ status: 'disabled', summary: 'disabled' }) },
    mediaPipeline: {
      getMediaPaths: () => ({ dir: mediaRoot, framesDir: mediaRoot, metadata: path.join(mediaRoot, 'metadata.json'), transcript: path.join(mediaRoot, 'transcript.json'), analysisInput: path.join(mediaRoot, 'analysis.json') }),
      prepareDouyinMedia: async () => ({ success: true }),
    },
    agentRuns: {
      createDouyinHyperframesFreeformRun: async () => ({ success: true, run_id: 'run-1' }),
      generateDouyinRunHyperframesFreeformBrief: async () => ({ success: true }),
      synthesizeDouyinRunHyperframesFreeformAudio: async () => ({ success: true }),
      generateDouyinRunHyperframesFreeformProject: async (awemeId, runId, options) => {
        calls.push(options.projectOptions);
        return {
          success: true,
          hyperframes_freeform: {
            project: { status: 'ready' },
            render: { status: 'rendered' },
          },
          render_mode: 'html-video',
        };
      },
    },
  };
  const runResult = await workflows.runCreativeWorkflow(createResult.workflow_id, { rootDir, mediaRoot, services });
  assert.equal(runResult.success, true);
  assert.equal(calls[0].aspect_ratio, '9:16');
  assert.equal(calls[0].duration_sec, 60);
  assert.equal(calls[0].preferredTemplateId, 'news_signal_vertical');
  assert.equal(calls[0].lockTemplate, true);
}

(async () => {
  await runSnapshotCreationTest();
  await runExplicitUseResearchOverrideTest();
  await runProjectOptionsMergeTest();
  console.log('creative workflow defaults tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-creative-workflow-defaults.js
```

Expected: FAIL because `creative_defaults_snapshot` and `target` are missing.

- [ ] **Step 3: Implement workflow defaults helpers**

Modify `server/services/creativeWorkflows.js`:

```js
const appSettings = require('./appSettings');
```

Update `resolveServices(options = {})` to include app settings:

```js
appSettings: services.appSettings || appSettings,
```

Add helpers near `normalizeFailureResult`:

```js
function normalizeCreativeDefaultsOverride(payload = {}) {
  const override = payload.creativeDefaultsOverride && typeof payload.creativeDefaultsOverride === 'object' && !Array.isArray(payload.creativeDefaultsOverride)
    ? payload.creativeDefaultsOverride
    : {};
  const result = { ...override };
  if (typeof payload.useResearch === 'boolean' && result.useResearch === undefined) {
    result.useResearch = payload.useResearch;
  }
  return result;
}

function resolveCreativeDefaultsSnapshot(defaults = {}, payload = {}) {
  const override = normalizeCreativeDefaultsOverride(payload);
  const aspectRatio = safeString(override.aspectRatio) || safeString(defaults.aspectRatio) || '9:16';
  const targetDurationSec = Number(override.targetDurationSec || defaults.targetDurationSec || 60);
  const templateByAspectRatio = defaults.templateByAspectRatio || {};
  const templateId = safeString(override.templateId) || safeString(templateByAspectRatio[aspectRatio]);
  const lockTemplate = typeof override.lockTemplate === 'boolean' ? override.lockTemplate : defaults.lockTemplate === true;
  const useResearch = typeof override.useResearch === 'boolean' ? override.useResearch : defaults.useResearch === true;
  return {
    aspectRatio,
    targetDurationSec: Number.isFinite(targetDurationSec) && targetDurationSec > 0 ? targetDurationSec : 60,
    templateId,
    lockTemplate,
    useResearch,
  };
}

function buildWorkflowTarget(snapshot = {}) {
  return {
    aspect_ratio: snapshot.aspectRatio || '9:16',
    duration_sec: snapshot.targetDurationSec || 60,
    preferredTemplateId: snapshot.templateId || '',
    lockTemplate: snapshot.lockTemplate === true,
  };
}

function buildEffectiveCreativePayload(payload = {}, snapshot = {}) {
  return {
    ...payload,
    useResearch: snapshot.useResearch === true,
  };
}

function mergeProjectOptions(recordTarget = {}, incoming = {}) {
  return {
    ...(recordTarget || {}),
    ...(incoming || {}),
    preferredTemplateId: recordTarget.preferredTemplateId || incoming.preferredTemplateId || '',
    lockTemplate: recordTarget.lockTemplate === true ? true : incoming.lockTemplate === true,
  };
}
```

N1 requirement: `record.target` is the base; if `projectOptions` already has values, `record.target.preferredTemplateId` and `record.target.lockTemplate` override same-name fields so the snapshot cannot drift.

- [ ] **Step 4: Wire snapshot into `createCreativeWorkflow()` and run stage**

In `createCreativeWorkflow(payload = {}, options = {})`, before normalization:

```js
const defaults = services.appSettings?.getCreativeDefaults
  ? await services.appSettings.getCreativeDefaults()
  : {
    aspectRatio: '9:16',
    targetDurationSec: 60,
    templateByAspectRatio: { '9:16': 'news_signal_vertical', '16:9': 'bold_signal' },
    lockTemplate: false,
    useResearch: payload.useResearch === true,
  };
const creativeDefaultsSnapshot = resolveCreativeDefaultsSnapshot(defaults, payload);
const effectivePayload = buildEffectiveCreativePayload(payload, creativeDefaultsSnapshot);
const normalized = creativeContext.normalizeCreativeInput(effectivePayload);
```

Replace the existing `const normalized = creativeContext.normalizeCreativeInput(payload);`.

Add to `record`:

```js
creative_defaults_snapshot: creativeDefaultsSnapshot,
target: buildWorkflowTarget(creativeDefaultsSnapshot),
```

In `runCreativeWorkflow()` project stage, replace `projectOptions`:

```js
projectOptions: mergeProjectOptions(record.target, {
  creative_context: record.creative_context,
}),
```

Update skip validation lookup:

```js
if (!skipValidation && services.appSettings?.getEffectiveSystemSettings) {
  try {
    const systemSettings = await services.appSettings.getEffectiveSystemSettings({ rootDir });
    skipValidation = systemSettings.skipValidation === true;
  } catch {}
} else if (!skipValidation && services.aiModelConfig) {
  try { skipValidation = await services.aiModelConfig.getSkipValidation({ rootDir }); } catch {}
}
```

- [ ] **Step 5: Run workflow defaults test**

Run:

```powershell
node tests/test-creative-workflow-defaults.js
```

Expected: `creative workflow defaults tests passed`.

- [ ] **Step 6: Run related existing workflow tests**

Run:

```powershell
node tests/test-creative-workflows.js
node tests/test-creative-context.js
```

Expected: both pass.

- [ ] **Step 7: Commit**

Run:

```powershell
git add server/services/creativeWorkflows.js tests/test-creative-workflow-defaults.js
git commit -m "接入一键创作默认值快照"
```

Expected: commit succeeds.

---

### Task 4: Html-Video Preferred and Locked Template

**Files:**
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Modify: `server/services/creative-video/workflowFacade.js`
- Test: `tests/test-html-video-template-preference.js`

- [ ] **Step 1: Write failing template preference tests**

Create `tests/test-html-video-template-preference.js`:

```js
const assert = require('assert');
const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');

function makeRegistry() {
  const templates = [
    { id: 'news_signal_vertical', name: '竖屏财经信号', output: { resolution: { width: 1080, height: 1920 } }, engine: 'hyperframes', source_entry: 'source/index.html', inputs: { schema: {} }, license: { commercial_use: true } },
    { id: 'bold_signal', name: '信号卡片', output: { resolution: { width: 1920, height: 1080 } }, engine: 'hyperframes', source_entry: 'source/index.html', inputs: { schema: {} }, license: { commercial_use: true } },
  ];
  return {
    buildCompactIndex: () => templates.map(item => ({ id: item.id, name: item.name, aspect_ratio: item.id === 'news_signal_vertical' ? '9:16' : '16:9' })),
    getTemplate: id => templates.find(item => item.id === id) || null,
  };
}

async function runLockedMissingTemplateTest() {
  const result = await workflow.generateHtmlVideo({
    workflowId: 'wf1',
    runId: 'run1',
    sceneSpec: { title: '测试', aspect_ratio: '9:16', scenes: [{ id: 'scene_01', duration: 3, narration_text: '测试' }] },
    target: { aspect_ratio: '9:16' },
    preferredTemplateId: 'missing_template',
    lockTemplate: true,
    templateRegistry: makeRegistry(),
    services: { model: { callTextModel: async () => ({ success: true, text: '{}' }) } },
    skipValidation: true,
  });
  assert.equal(result.success, false);
  assert.match(result.message, /默认模板 missing_template/);
}

async function runPreferredTemplateFirstTest() {
  let promptText = '';
  const result = await workflow.generateHtmlVideo({
    workflowId: 'wf2',
    runId: 'run2',
    sceneSpec: { title: '测试', aspect_ratio: '9:16', scenes: [{ id: 'scene_01', duration: 3, narration_text: '测试', visual_text: { headline: '标题' } }] },
    target: { aspect_ratio: '9:16', duration_sec: 3 },
    preferredTemplateId: 'news_signal_vertical',
    lockTemplate: false,
    templateRegistry: makeRegistry(),
    services: {
      model: {
        callTextModel: async ({ messages }) => {
          promptText += JSON.stringify(messages);
          if (promptText.includes('template_id')) {
            return { success: true, text: JSON.stringify({ template_id: 'news_signal_vertical', reason: '首选模板匹配', confidence: 0.9 }) };
          }
          return { success: false, message: 'stop after selection' };
        },
      },
    },
    skipValidation: true,
  });
  assert.equal(result.success, false);
  assert.match(promptText, /news_signal_vertical/);
  assert.match(promptText, /优先选择/);
}

(async () => {
  await runLockedMissingTemplateTest();
  await runPreferredTemplateFirstTest();
  console.log('html-video template preference tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-html-video-template-preference.js
```

Expected: FAIL because `preferredTemplateId` and `lockTemplate` are ignored.

- [ ] **Step 3: Update html-video workflow signatures**

Modify `generateHtmlVideo()` signature:

```js
preferredTemplateId = '',
lockTemplate = false,
```

Modify `requestTemplateSelection()` signature:

```js
async function requestTemplateSelection({ model, compactIndex, creativeContext, target, sceneSpec, preferredTemplateId = '', lockTemplate = false }) {
```

Add helper functions near `buildTemplateIndexOptions()`:

```js
function normalizeTemplateId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function findCompactTemplate(compactIndex = [], templateId = '') {
  return compactIndex.find(item => item.id === templateId) || null;
}

function movePreferredTemplateFirst(compactIndex = [], preferredTemplateId = '') {
  const id = normalizeTemplateId(preferredTemplateId);
  if (!id) return compactIndex;
  const preferred = findCompactTemplate(compactIndex, id);
  if (!preferred) return compactIndex;
  return [preferred, ...compactIndex.filter(item => item.id !== id)];
}
```

- [ ] **Step 4: Enforce locked template and prefer unlocked template**

Inside `generateHtmlVideo()` after `compactIndex` is built:

```js
const preferredId = normalizeTemplateId(preferredTemplateId || target.preferredTemplateId || target.template_id);
let templateIndex = compactIndex;
if (preferredId) {
  const preferredInIndex = findCompactTemplate(compactIndex, preferredId);
  if (!preferredInIndex && lockTemplate === true) {
    return failure(`默认模板 ${preferredId} 不支持当前画面比例 ${renderTarget.aspect_ratio || '未指定'}，请在设置中心修改模板或关闭锁定模板。`, [
      createDiagnostic({
        code: 'template_missing',
        stage: 'template',
        user_message: `默认模板 ${preferredId} 不支持当前画面比例 ${renderTarget.aspect_ratio || '未指定'}，请在设置中心修改模板或关闭锁定模板。`,
        details: { template_id: preferredId, aspect_ratio: renderTarget.aspect_ratio || '' },
      }),
    ]);
  }
  templateIndex = movePreferredTemplateFirst(compactIndex, preferredId);
}
```

Use `templateIndex` instead of `compactIndex` when calling `requestTemplateSelection()`:

```js
const selection = await requestTemplateSelection({
  model,
  compactIndex: templateIndex,
  creativeContext,
  target: renderTarget,
  sceneSpec,
  preferredTemplateId: preferredId,
  lockTemplate,
});
```

Inside `requestTemplateSelection()`, pass a target object that includes the preference:

```js
target: {
  ...target,
  preferred_template_id: preferredTemplateId,
  lock_template: lockTemplate === true,
  template_instruction: preferredTemplateId
    ? (lockTemplate ? `必须使用模板 ${preferredTemplateId}` : `优先选择模板 ${preferredTemplateId}，除非内容明显不适合`)
    : '',
},
```

- [ ] **Step 5: Update workflow facade passthrough**

In `server/services/creative-video/workflowFacade.js`, when calling `htmlVideoWorkflow.generateHtmlVideo()`, add:

```js
preferredTemplateId: target.preferredTemplateId || target.preferred_template_id || target.template_id || '',
lockTemplate: target.lockTemplate === true || target.lock_template === true,
```

- [ ] **Step 6: Run template tests**

Run:

```powershell
node tests/test-html-video-template-preference.js
node tests/test-html-video-workflow.js
node tests/test-creative-video-workflow-facade.js
```

Expected: all pass.

- [ ] **Step 7: Commit**

Run:

```powershell
git add server/services/creative-video/html-video/htmlVideoWorkflow.js server/services/creative-video/workflowFacade.js tests/test-html-video-template-preference.js
git commit -m "支持默认模板首选和锁定"
```

Expected: commit succeeds.

---

### Task 5: Settings Center API Client and UI Shell

**Files:**
- Modify: `frontend-react/src/api/client.js`
- Modify: `frontend-react/src/pages/SettingsPage.jsx`
- Create: `frontend-react/src/components/settings/ModelSettings.jsx`
- Create: `frontend-react/src/components/settings/SettingsOverview.jsx`
- Test: `tests/test-settings-center-ui.mjs`

- [ ] **Step 1: Write failing static UI test**

Create `tests/test-settings-center-ui.mjs`:

```js
import assert from 'assert';
import fs from 'fs';

const settingsPage = fs.readFileSync('frontend-react/src/pages/SettingsPage.jsx', 'utf-8');
const apiClient = fs.readFileSync('frontend-react/src/api/client.js', 'utf-8');

assert.match(settingsPage, /总览/);
assert.match(settingsPage, /创作默认值/);
assert.match(settingsPage, /模型配置/);
assert.match(settingsPage, /系统/);
assert.match(settingsPage, /SettingsOverview/);
assert.match(settingsPage, /ModelSettings/);
assert.match(apiClient, /getAppSettings/);
assert.match(apiClient, /saveAppSettings/);
assert.match(apiClient, /getConfigTemplates/);
assert.match(apiClient, /getSystemHealth/);
assert.match(apiClient, /cleanupSystemData/);

console.log('settings center ui tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-settings-center-ui.mjs
```

Expected: FAIL because settings center components and API methods do not exist.

- [ ] **Step 3: Add API client methods**

Modify `frontend-react/src/api/client.js`:

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
cleanupSystemData(targets = []) {
  return requestJson('/api/config/maintenance/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targets }),
  });
},
```

- [ ] **Step 4: Create `ModelSettings` wrapper**

Create `frontend-react/src/components/settings/ModelSettings.jsx`:

```jsx
import { GlobalModelSelector } from './GlobalModelSelector.jsx';
import { ProviderList } from './ProviderList.jsx';

export function ModelSettings({ settings }) {
  return (
    <div className="settingsSection">
      <GlobalModelSelector
        modelTypes={settings.MODEL_TYPES}
        modelTypeInfo={settings.MODEL_TYPE_INFO}
        providerList={settings.providerList}
        activeModels={settings.activeModels}
        onChange={settings.setActive}
      />
      <ProviderList
        providerList={settings.providerList}
        modelTypes={settings.MODEL_TYPES}
        modelTypeInfo={settings.MODEL_TYPE_INFO}
        onUpdate={settings.updateProvider}
        onUpdateModel={settings.updateProviderModel}
        onAdd={settings.addProvider}
        onRemove={settings.removeProvider}
      />
    </div>
  );
}
```

- [ ] **Step 5: Create `SettingsOverview`**

Create `frontend-react/src/components/settings/SettingsOverview.jsx`:

```jsx
export function SettingsOverview({ appSettings, activeModels, systemHealth, onNavigate }) {
  const defaults = appSettings?.creativeDefaults || {};
  const textModelReady = activeModels?.text?.enabled === true;
  const ttsReady = activeModels?.tts?.enabled === true;
  const environmentReady = systemHealth?.environment?.ok === true;

  return (
    <section className="settingsPanel">
      <div className="settingsPanelHeader">
        <div>
          <h3>总览</h3>
          <p>查看模型、创作默认值、系统环境和本地数据状态。</p>
        </div>
      </div>
      <div className="settingsOverviewGrid">
        <button type="button" className="settingsOverviewItem" onClick={() => onNavigate('models')}>
          <span>文字模型</span>
          <strong>{textModelReady ? '已启用' : '未配置'}</strong>
        </button>
        <button type="button" className="settingsOverviewItem" onClick={() => onNavigate('models')}>
          <span>TTS</span>
          <strong>{ttsReady ? '已启用' : '未配置'}</strong>
        </button>
        <button type="button" className="settingsOverviewItem" onClick={() => onNavigate('creative')}>
          <span>默认画面比例</span>
          <strong>{defaults.aspectRatio || '9:16'}</strong>
        </button>
        <button type="button" className="settingsOverviewItem" onClick={() => onNavigate('system')}>
          <span>渲染环境</span>
          <strong>{environmentReady ? '已就绪' : '需检查'}</strong>
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Replace `SettingsPage` with settings center shell**

Modify `frontend-react/src/pages/SettingsPage.jsx` to use:

```jsx
import { useEffect, useMemo, useState } from 'react';
import { Status } from '../components/Status.jsx';
import { CreativeDefaultsSettings } from '../components/settings/CreativeDefaultsSettings.jsx';
import { ModelSettings } from '../components/settings/ModelSettings.jsx';
import { SettingsOverview } from '../components/settings/SettingsOverview.jsx';
import { SystemSettings } from '../components/settings/SystemSettings.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { api } from '../api/client.js';

const SECTIONS = [
  { id: 'overview', label: '总览' },
  { id: 'creative', label: '创作默认值' },
  { id: 'models', label: '模型配置' },
  { id: 'system', label: '系统' },
];

export function SettingsPage() {
  const modelSettings = useSettings();
  const [activeSection, setActiveSection] = useState('overview');
  const [appSettings, setAppSettings] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [systemHealth, setSystemHealth] = useState(null);
  const [status, setStatus] = useState(null);
  const [loadingAppSettings, setLoadingAppSettings] = useState(true);
  const [savingAppSettings, setSavingAppSettings] = useState(false);

  async function loadAppSettings(refreshHealth = false) {
    setLoadingAppSettings(true);
    setStatus({ type: 'loading', message: '正在加载设置中心配置...' });
    try {
      const [settingsJson, templatesJson, healthJson] = await Promise.all([
        api.getAppSettings(),
        api.getConfigTemplates(),
        api.getSystemHealth(refreshHealth),
      ]);
      setAppSettings(settingsJson);
      setTemplates(templatesJson.data || []);
      setSystemHealth(healthJson);
      setStatus({ type: 'success', message: '设置中心配置已加载。' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message || '加载设置中心配置失败。' });
    } finally {
      setLoadingAppSettings(false);
    }
  }

  async function saveAppSettings(nextSettings = appSettings) {
    setSavingAppSettings(true);
    setStatus({ type: 'loading', message: '正在保存设置中心配置...' });
    try {
      const saved = await api.saveAppSettings(nextSettings);
      setAppSettings(saved);
      setStatus({ type: 'success', message: '设置中心配置已保存。' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message || '保存设置中心配置失败。' });
    } finally {
      setSavingAppSettings(false);
    }
  }

  useEffect(() => { loadAppSettings(false); }, []);

  const combinedStatus = status || modelSettings.status;
  const busy = loadingAppSettings || savingAppSettings || modelSettings.loading || modelSettings.saving;

  return (
    <main className="container settingsCenter">
      <div className="workspaceIntro">
        <div>
          <h2>设置中心</h2>
          <p>管理创作默认值、模型配置、系统环境和本地数据。</p>
        </div>
      </div>
      <Status status={combinedStatus} />
      {busy ? <div className="pageLoading">{savingAppSettings || modelSettings.saving ? '正在保存配置...' : '正在加载配置...'}</div> : null}
      <div className="settingsCenterLayout">
        <aside className="settingsCenterNav">
          {SECTIONS.map(section => (
            <button
              key={section.id}
              type="button"
              className={activeSection === section.id ? 'active' : ''}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </aside>
        <section className="settingsCenterContent">
          {activeSection === 'overview' ? (
            <SettingsOverview
              appSettings={appSettings}
              activeModels={modelSettings.activeModels}
              systemHealth={systemHealth}
              onNavigate={setActiveSection}
            />
          ) : null}
          {activeSection === 'creative' ? (
            <CreativeDefaultsSettings
              appSettings={appSettings}
              templates={templates}
              disabled={busy}
              onChange={setAppSettings}
              onSave={saveAppSettings}
            />
          ) : null}
          {activeSection === 'models' ? (
            <ModelSettings settings={modelSettings} />
          ) : null}
          {activeSection === 'system' ? (
            <SystemSettings
              appSettings={appSettings}
              systemHealth={systemHealth}
              disabled={busy}
              onChange={setAppSettings}
              onSave={saveAppSettings}
              onRefresh={() => loadAppSettings(true)}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Run static UI test**

Run:

```powershell
node tests/test-settings-center-ui.mjs
```

Expected: `settings center ui tests passed`.

- [ ] **Step 8: Commit**

Run:

```powershell
git add frontend-react/src/api/client.js frontend-react/src/pages/SettingsPage.jsx frontend-react/src/components/settings/ModelSettings.jsx frontend-react/src/components/settings/SettingsOverview.jsx tests/test-settings-center-ui.mjs
git commit -m "重构设置页为设置中心壳层"
```

Expected: commit succeeds.

---

### Task 6: Creative Defaults UI and One-Click Research Override

**Files:**
- Create: `frontend-react/src/components/settings/CreativeDefaultsSettings.jsx`
- Modify: `frontend-react/src/pages/OneClickCreativePage.jsx`
- Test: `tests/test-creative-defaults-ui.mjs`
- Test: `tests/test-one-click-research-defaults.mjs`

- [ ] **Step 1: Write failing frontend tests**

Create `tests/test-creative-defaults-ui.mjs`:

```js
import assert from 'assert';
import fs from 'fs';

const source = fs.readFileSync('frontend-react/src/components/settings/CreativeDefaultsSettings.jsx', 'utf-8');

assert.match(source, /默认画面比例/);
assert.match(source, /默认目标时长/);
assert.match(source, /按比例默认模板/);
assert.match(source, /锁定模板/);
assert.match(source, /联网研究默认开启/);
assert.match(source, /正在保存/);

console.log('creative defaults ui tests passed');
```

Create `tests/test-one-click-research-defaults.mjs`:

```js
import assert from 'assert';
import fs from 'fs';

const source = fs.readFileSync('frontend-react/src/pages/OneClickCreativePage.jsx', 'utf-8');

assert.match(source, /useResearchTouched/);
assert.match(source, /api\.getAppSettings/);
assert.match(source, /creativeDefaultsOverride/);
assert.doesNotMatch(source, /useResearch: useResearch,\s*assetIds/s);

console.log('one click research defaults tests passed');
```

N3 requirement: this is an integration-style static test over request body construction. Do not write a narrow unit test around internal React state because the page currently owns fetch behavior through `api`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
node tests/test-creative-defaults-ui.mjs
node tests/test-one-click-research-defaults.mjs
```

Expected: both fail because the component and touched-state request behavior do not exist.

- [ ] **Step 3: Create `CreativeDefaultsSettings`**

Create `frontend-react/src/components/settings/CreativeDefaultsSettings.jsx`:

```jsx
const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5'];

function updateCreativeDefaults(appSettings, patch) {
  return {
    ...(appSettings || {}),
    creativeDefaults: {
      ...(appSettings?.creativeDefaults || {}),
      ...patch,
    },
  };
}

function updateTemplateForAspect(appSettings, aspect, templateId) {
  const current = appSettings?.creativeDefaults || {};
  return updateCreativeDefaults(appSettings, {
    templateByAspectRatio: {
      ...(current.templateByAspectRatio || {}),
      [aspect]: templateId,
    },
  });
}

export function CreativeDefaultsSettings({ appSettings, templates = [], disabled, onChange, onSave }) {
  const defaults = appSettings?.creativeDefaults || {};
  const templateByAspectRatio = defaults.templateByAspectRatio || {};
  const savingText = disabled ? '正在保存或加载配置...' : '';

  return (
    <section className="settingsPanel">
      <div className="settingsPanelHeader">
        <div>
          <h3>创作默认值</h3>
          <p>这些配置会自动应用到新建的一键创作任务。</p>
        </div>
        <button className="btn primary" type="button" disabled={disabled} onClick={() => onSave(appSettings)}>
          {disabled ? '正在保存...' : '保存创作默认值'}
        </button>
      </div>
      {savingText ? <p className="muted">{savingText}</p> : null}
      <div className="settingsFormGrid">
        <label>
          <span>默认画面比例</span>
          <select
            value={defaults.aspectRatio || '9:16'}
            disabled={disabled}
            onChange={event => onChange(updateCreativeDefaults(appSettings, { aspectRatio: event.target.value }))}
          >
            {ASPECT_RATIOS.map(aspect => <option key={aspect} value={aspect}>{aspect}</option>)}
          </select>
        </label>
        <label>
          <span>默认目标时长</span>
          <input
            type="number"
            min="15"
            max="180"
            value={defaults.targetDurationSec || 60}
            disabled={disabled}
            onChange={event => onChange(updateCreativeDefaults(appSettings, { targetDurationSec: Number(event.target.value) }))}
          />
        </label>
      </div>
      <div className="settingsPanelSubsection">
        <h4>按比例默认模板</h4>
        <div className="settingsFormGrid">
          {ASPECT_RATIOS.map(aspect => (
            <label key={aspect}>
              <span>{aspect}</span>
              <select
                value={templateByAspectRatio[aspect] || ''}
                disabled={disabled}
                onChange={event => onChange(updateTemplateForAspect(appSettings, aspect, event.target.value))}
              >
                <option value="">自动选择模板</option>
                {templates
                  .filter(template => !template.aspect_ratio || template.aspect_ratio === aspect)
                  .map(template => <option key={template.id} value={template.id}>{template.name || template.id}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>
      <label className="switchControl">
        <input
          type="checkbox"
          checked={defaults.lockTemplate === true}
          disabled={disabled}
          onChange={event => onChange(updateCreativeDefaults(appSettings, { lockTemplate: event.target.checked }))}
        />
        <span className="switchTrack" aria-hidden="true"><span className="switchThumb" /></span>
        <div className="switchLabel">
          <span className="switchText">锁定模板</span>
          <span className="switchDesc">开启后，新任务必须使用默认模板；模板不兼容时任务会停止并提示原因。</span>
        </div>
      </label>
      <label className="switchControl">
        <input
          type="checkbox"
          checked={defaults.useResearch !== false}
          disabled={disabled}
          onChange={event => onChange(updateCreativeDefaults(appSettings, { useResearch: event.target.checked }))}
        />
        <span className="switchTrack" aria-hidden="true"><span className="switchThumb" /></span>
        <div className="switchLabel">
          <span className="switchText">联网研究默认开启</span>
          <span className="switchDesc">新建一键创作任务时默认联网获取资料，任务页可临时切换。</span>
        </div>
      </label>
    </section>
  );
}
```

- [ ] **Step 4: Update one-click page research default behavior**

In `frontend-react/src/pages/OneClickCreativePage.jsx`:

Add state:

```jsx
const [useResearch, setUseResearch] = useState(true);
const [useResearchTouched, setUseResearchTouched] = useState(false);
```

Replace the existing `useResearch` state declaration.

Add effect:

```jsx
useEffect(() => {
  let cancelled = false;
  async function loadCreativeDefaults() {
    try {
      const json = await api.getAppSettings();
      if (cancelled || useResearchTouched) return;
      setUseResearch(json?.creativeDefaults?.useResearch !== false);
    } catch {
      if (!cancelled || !useResearchTouched) {
        setUseResearch(true);
      }
    }
  }
  loadCreativeDefaults();
  return () => { cancelled = true; };
}, [useResearchTouched]);
```

Update the `CreativeComposer` prop:

```jsx
setUseResearch={(value) => {
  setUseResearchTouched(true);
  setUseResearch(value);
}}
```

Update submit payload:

```js
const creativeDefaultsOverride = useResearchTouched ? { useResearch } : {};
const json = await api.createCreativeWorkflow({
  input: trimmed,
  ...(useResearchTouched ? { creativeDefaultsOverride } : {}),
  assetIds: [],
  renderOptions: {},
  workflowOptions: {},
});
```

Remove the old unconditional `useResearch: useResearch` field from the request body.

- [ ] **Step 5: Run frontend static tests**

Run:

```powershell
node tests/test-creative-defaults-ui.mjs
node tests/test-one-click-research-defaults.mjs
```

Expected: both pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add frontend-react/src/components/settings/CreativeDefaultsSettings.jsx frontend-react/src/pages/OneClickCreativePage.jsx tests/test-creative-defaults-ui.mjs tests/test-one-click-research-defaults.mjs
git commit -m "添加创作默认值设置界面"
```

Expected: commit succeeds.

---

### Task 7: System Settings UI and Cleanup Dialog

**Files:**
- Create: `frontend-react/src/components/settings/SystemSettings.jsx`
- Create: `frontend-react/src/components/settings/CleanupConfirmDialog.jsx`
- Test: `tests/test-system-settings-ui.mjs`

- [ ] **Step 1: Write failing static UI test**

Create `tests/test-system-settings-ui.mjs`:

```js
import assert from 'assert';
import fs from 'fs';

const systemSettings = fs.readFileSync('frontend-react/src/components/settings/SystemSettings.jsx', 'utf-8');
const dialog = fs.readFileSync('frontend-react/src/components/settings/CleanupConfirmDialog.jsx', 'utf-8');

assert.match(systemSettings, /质检状态/);
assert.match(systemSettings, /重新检测/);
assert.match(systemSettings, /创作任务记录/);
assert.match(systemSettings, /媒体素材缓存/);
assert.match(systemSettings, /渲染产物/);
assert.match(systemSettings, /浏览器数据/);
assert.match(systemSettings, /Cookie/);
assert.match(dialog, /确认清理/);
assert.match(dialog, /正在清理/);
assert.match(dialog, /此操作不可恢复/);

console.log('system settings ui tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-system-settings-ui.mjs
```

Expected: FAIL because components do not exist.

- [ ] **Step 3: Create cleanup dialog**

Create `frontend-react/src/components/settings/CleanupConfirmDialog.jsx`:

```jsx
const TARGET_LABELS = {
  'creative-workflows': '创作任务记录',
  'media-cache': '媒体素材缓存',
  'render-outputs': '渲染产物',
  'browser-data': '浏览器数据',
  cookies: 'Cookie',
};

export function CleanupConfirmDialog({ target, open, loading, onCancel, onConfirm }) {
  if (!open || !target) return null;
  const label = TARGET_LABELS[target] || target;
  return (
    <div className="modalBackdrop" role="presentation">
      <div className="modalPanel" role="dialog" aria-modal="true" aria-label={`确认清理${label}`}>
        <h3>确认清理{label}</h3>
        <p>此操作不可恢复。清理前请确认没有正在运行的一键创作任务。</p>
        <p>系统只会删除白名单内与「{label}」对应的数据。</p>
        <div className="settingsActionBar">
          <button type="button" className="btn secondary" disabled={loading} onClick={onCancel}>取消</button>
          <button type="button" className="btn danger" disabled={loading} onClick={() => onConfirm(target)}>
            {loading ? `正在清理${label}...` : `确认清理${label}`}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `SystemSettings`**

Create `frontend-react/src/components/settings/SystemSettings.jsx`:

```jsx
import { useState } from 'react';
import { api } from '../../api/client.js';
import { CleanupConfirmDialog } from './CleanupConfirmDialog.jsx';

const CLEANUP_TARGETS = [
  ['creative-workflows', '创作任务记录', '删除本地一键创作 workflow 记录。'],
  ['media-cache', '媒体素材缓存', '删除本地媒体素材缓存。'],
  ['render-outputs', '渲染产物', '仅删除识别出的渲染视频和预览产物。'],
  ['browser-data', '浏览器数据', '删除本地浏览器数据目录。'],
  ['cookies', 'Cookie', '清空内存 Cookie 并清理本地 Cookie 文件。'],
];

function updateSystem(appSettings, patch) {
  return {
    ...(appSettings || {}),
    system: {
      ...(appSettings?.system || {}),
      ...patch,
    },
  };
}

export function SystemSettings({ appSettings, systemHealth, disabled, onChange, onSave, onRefresh }) {
  const [cleanupTarget, setCleanupTarget] = useState('');
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState('');
  const system = appSettings?.system || {};
  const storage = systemHealth?.storage || {};
  const diagnostics = systemHealth?.environment?.diagnostics || [];

  async function confirmCleanup(target) {
    setCleanupLoading(true);
    setCleanupMessage(`正在清理${target}...`);
    try {
      const result = await api.cleanupSystemData([target]);
      setCleanupMessage(result.message || '清理完成。');
      setCleanupTarget('');
      await onRefresh();
    } catch (error) {
      setCleanupMessage(error.message || '清理失败。');
    } finally {
      setCleanupLoading(false);
    }
  }

  return (
    <section className="settingsPanel">
      <div className="settingsPanelHeader">
        <div>
          <h3>系统</h3>
          <p>检查运行环境，维护本地数据。</p>
        </div>
        <button type="button" className="btn secondary" disabled={disabled} onClick={onRefresh}>重新检测</button>
      </div>
      <label className="switchControl">
        <input
          type="checkbox"
          checked={system.skipValidation === true}
          disabled={disabled}
          onChange={event => onChange(updateSystem(appSettings, { skipValidation: event.target.checked }))}
        />
        <span className="switchTrack" aria-hidden="true"><span className="switchThumb" /></span>
        <div className="switchLabel">
          <span className="switchText">质检状态：{system.skipValidation ? '已跳过' : '已启用'}</span>
          <span className="switchDesc">跳过质检会减少阻塞，但可能保留渲染或视觉问题。</span>
        </div>
      </label>
      <button type="button" className="btn primary" disabled={disabled} onClick={() => onSave(appSettings)}>保存系统设置</button>
      <div className="settingsPanelSubsection">
        <h4>html-video 环境</h4>
        {diagnostics.length ? diagnostics.map(item => (
          <details key={item.code}>
            <summary>{item.message || item.code}</summary>
            <p>{item.detail || item.path || '无更多诊断信息。'}</p>
          </details>
        )) : <p>尚未检测环境。</p>}
      </div>
      <div className="settingsPanelSubsection">
        <h4>数据维护</h4>
        {cleanupMessage ? <p>{cleanupMessage}</p> : null}
        <div className="settingsCleanupGrid">
          {CLEANUP_TARGETS.map(([target, label, description]) => (
            <div className="settingsCleanupItem" key={target}>
              <strong>{label}</strong>
              <span>{description}</span>
              <small>{storage[target] || storage[target.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]?.display || '未统计'}</small>
              <button type="button" className="btn secondary" disabled={disabled || cleanupLoading} onClick={() => setCleanupTarget(target)}>
                清理{label}
              </button>
            </div>
          ))}
        </div>
      </div>
      <CleanupConfirmDialog
        target={cleanupTarget}
        open={!!cleanupTarget}
        loading={cleanupLoading}
        onCancel={() => setCleanupTarget('')}
        onConfirm={confirmCleanup}
      />
    </section>
  );
}
```

- [ ] **Step 5: Run system UI test**

Run:

```powershell
node tests/test-system-settings-ui.mjs
```

Expected: `system settings ui tests passed`.

- [ ] **Step 6: Commit**

Run:

```powershell
git add frontend-react/src/components/settings/SystemSettings.jsx frontend-react/src/components/settings/CleanupConfirmDialog.jsx tests/test-system-settings-ui.mjs
git commit -m "添加系统状态和数据维护界面"
```

Expected: commit succeeds.

---

### Task 8: Styles, Test Runner, Docs, and Verification

**Files:**
- Modify: `frontend-react/src/styles.css`
- Modify: `tests/run-all.js`
- Modify: `README.md`

- [ ] **Step 1: Add focused settings center styles**

Append a small bounded block to `frontend-react/src/styles.css`:

```css
.settingsCenterLayout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 18px; align-items: start; }
.settingsCenterNav { position: sticky; top: 16px; display: grid; gap: 8px; padding: 10px; border: 1px solid #edf0f4; border-radius: 8px; background: #fff; }
.settingsCenterNav button { width: 100%; text-align: left; border: 0; border-radius: 8px; padding: 10px 12px; background: transparent; color: #3b4351; cursor: pointer; }
.settingsCenterNav button.active { background: #111827; color: #fff; }
.settingsCenterContent { display: grid; gap: 16px; min-width: 0; }
.settingsOverviewGrid, .settingsCleanupGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.settingsOverviewItem, .settingsCleanupItem { display: grid; gap: 6px; padding: 14px; border: 1px solid #edf0f4; border-radius: 8px; background: #fafbfc; text-align: left; }
.settingsOverviewItem strong, .settingsCleanupItem strong { color: #111827; }
.settingsPanelSubsection { display: grid; gap: 10px; margin-top: 16px; }
.modalBackdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 20px; background: rgba(17, 24, 39, .45); }
.modalPanel { width: min(480px, 100%); display: grid; gap: 12px; padding: 18px; border-radius: 8px; background: #fff; box-shadow: 0 18px 60px rgba(15, 23, 42, .28); }
.btn.danger { background: #b91c1c; color: #fff; }
@media (max-width: 900px) {
  .settingsCenterLayout { grid-template-columns: 1fr; }
  .settingsCenterNav { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .settingsOverviewGrid, .settingsCleanupGrid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 2: Register tests if needed**

Open `tests/run-all.js`. If it uses an explicit file list, add:

```js
'tests/test-app-settings.js',
'tests/test-creative-workflow-defaults.js',
'tests/test-html-video-template-preference.js',
'tests/test-system-maintenance.js',
'tests/test-settings-center-ui.mjs',
'tests/test-creative-defaults-ui.mjs',
'tests/test-one-click-research-defaults.mjs',
'tests/test-system-settings-ui.mjs',
```

If `tests/run-all.js` auto-discovers tests, do not edit it.

- [ ] **Step 3: Update README**

In `README.md` 本地数据列表 add:

```markdown
- `data/config/app-settings.json`：设置中心保存的一键创作默认值和系统设置
```

In API overview under 配置与历史 add:

```markdown
- `GET /api/config/app-settings`：读取设置中心应用配置
- `POST /api/config/app-settings`：保存设置中心应用配置
- `GET /api/config/templates`：读取 html-video 可用模板简表
- `GET /api/config/system-health`：读取系统环境和数据占用概览
- `POST /api/config/maintenance/cleanup`：按类型清理本地数据
```

- [ ] **Step 4: Run targeted tests**

Run:

```powershell
node tests/test-app-settings.js
node tests/test-system-maintenance.js
node tests/test-creative-workflow-defaults.js
node tests/test-html-video-template-preference.js
node tests/test-settings-center-ui.mjs
node tests/test-creative-defaults-ui.mjs
node tests/test-one-click-research-defaults.mjs
node tests/test-system-settings-ui.mjs
```

Expected: all print their `... tests passed` line.

- [ ] **Step 5: Run broader regression**

Run:

```powershell
npm test
npm run build:frontend
```

Expected: both pass. If either fails because of unrelated pre-existing worktree changes, capture the exact failing test or build error before changing code.

- [ ] **Step 6: Final commit**

Run:

```powershell
git add frontend-react/src/styles.css tests/run-all.js README.md
git commit -m "完善设置中心样式和文档"
```

Expected: commit succeeds if files changed. If `tests/run-all.js` did not need edits, omit it from `git add`.

---

## Self-Review Checklist

- Spec coverage: app settings, settings center UI, workflow defaults snapshot, template preference/locking, system health cache, render output cleanup rules, Cookie cleanup route, and documentation are mapped to tasks.
- N1 coverage: Task 3 defines `mergeProjectOptions(record.target, incoming)` and requires `preferredTemplateId`/`lockTemplate` from `record.target` to override incoming values.
- N2 coverage: Task 2 defines `normalizeDiagnostic()` returning `{ ok, code, message, detail, path }`.
- N3 coverage: Task 6 uses integration-style static request-body checks rather than brittle isolated React state unit tests.
- Verification: targeted tests run before broad `npm test` and `npm run build:frontend`.
