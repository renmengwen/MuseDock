# 来源图片多模态分析完整闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为文章/GitHub 链接来源图片增加可选多模态分析，并形成从设置开关、任务校验、图片理解、帧级推荐、HTML 引用追踪到 UI 展示的完整闭环。

**Architecture:** 复用现有 `asset_context` 和 `text.supportsMultimodal` 能力字段，不新增 `multimodal` 模型类型，不重写 Markdown 图片提取。图片分析作为 `assets` 阶段的增强能力：关闭时走现有轻量匹配，开启且模型可用时写入 `image_analysis`，随后 `contentGraphAgent` 生成 `asset_refs`，`frameHtmlAgent` 按帧引用推荐图，渲染后扫描 HTML 生成 `asset_usage_report`。

**Tech Stack:** Node.js/Express 服务层、React/Vite 设置与任务详情页、现有 OpenAI-compatible Chat Completions 消息结构、assert-based Node 测试。

---

## 子代理执行注意事项

如果使用子代理模式，按任务分派，不要让一个子代理横跨整条链路。每个子代理必须先读本计划中对应任务的 **Files** 和 **Acceptance**，再编辑代码。每个子代理完成后主代理要 review diff 和运行该任务指定测试，再派下一个子代理。

推荐分派：

1. 子代理 A：Task 1-2，设置与模型校验。
2. 子代理 B：Task 3，图片分析服务。
3. 子代理 C：Task 4-5，assets 阶段与 prompt/`asset_refs`。
4. 子代理 D：Task 6，使用追踪。
5. 子代理 E：Task 8，OpenDesign UI 设计。
6. 子代理 F：Task 9，前端 UI 实现。
7. 主代理：Task 10，总测试、文案审查、最终回归。

不要并行修改同一文件。`creativeWorkflows.js`、`creativeSourcePrep.js`、`contentGraphAgent.js` 必须串行处理。

## OpenDesign UI 要求

本功能涉及设置中心和任务详情页 UI，必须使用 `$opendesign`。已检测到项目存在设计系统：

```text
opendesign/design-systems/tech-minimal-product
```

且 `opendesign/index.html` 已存在。后续实现 UI 前必须先执行 Task 8，基于该设计系统产出 mockup，更新 `opendesign/manifest.json`，并通过 OpenDesign 预览/验证。React 实现只能在 Task 8 设计确认后进行，不允许直接裸改 `CreativeDefaultsSettings.jsx` 或 `CreativeTaskDetail.jsx`。

## 当前基础

已确认现有能力：

- `server/services/source/sourceFetch.js` 已将文章 `<img>` 转成 Markdown 图片。
- `server/services/source/sourceAssets.js` 已提取 Markdown 图片、下载到本地、Pexels 补图。
- `server/services/creative/creativeSourcePrep.js` 已在 `assets` 阶段写入 `asset_context` 和 `analysis_input.creative_context.asset_context`。
- `server/services/creative-video/html-video/htmlVideoWorkflow.js` 已复制图片到 html-video 工程并生成 `frame_src`。
- `contentGraphAgent` 和 `frameHtmlAgent` 已把“可用图片素材”暴露给模型。
- `server/services/ai/aiModelConfig.js` 已有 `text.supportsMultimodal` 字段。

## 文件结构

### 后端设置与模型校验

- Modify: `server/services/appSettings.js`  
  增加 `creativeDefaults.sourceImageAnalysisEnabled`，默认 `false`，保存/读取时规范化。

- Modify: `server/services/creative/creativeWorkflows.js`  
  把 `sourceImageAnalysisEnabled` 写入 `creative_defaults_snapshot`；创建 `source_url` 任务时校验当前分析模型支持多模态；运行项目阶段把快照传入 `projectOptions.creative_context` 的现有路径。

- Modify: `server/services/ai/aiModelConfig.js`  
  不新增模型类型，只复用 `getRuntimeConfig('text')` 返回的 `supportsMultimodal`。

### 图片分析服务

- Create: `server/services/source/sourceImageAnalysis.js`  
  负责读取本地图片、构造多模态消息、调用文本模型、解析严格 JSON、返回每张图的 `image_analysis`。失败返回结构化状态，不抛出阻断主任务的错误。

- Modify: `server/services/source/sourceAssets.js`  
  最少改动：保留提取下载逻辑，不把多模态调用塞进这里。可只导出辅助 `safeString` 不建议；新增服务自己实现局部 helper。

- Modify: `server/services/creative/creativeSourcePrep.js`  
  `prepareSourceAssetContext` 下载图片后根据设置决定是否调用 `sourceImageAnalysis.analyzeSourceImageAssets`，并把结果写入 `asset_context.image_analysis` 和 `asset.image_analysis`。

### html-video 规划、生成与追踪

- Modify: `server/services/creative-video/html-video/contentGraphAgent.js`  
  prompt 增加图片分析摘要；schema/normalize 支持 `nodes[].asset_refs`。

- Modify: `server/services/creative-video/html-video/frameHtmlAgent.js`  
  prompt 增加“本帧推荐来源图片”，优先使用当前 node 的 `asset_refs`，不要把所有素材作为同等候选。

- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`  
  渲染/校验前后扫描帧 HTML 中的资产引用，生成 `asset_usage_report`，写入 project 和返回结果。

### OpenDesign 与前端

- Create: `opendesign/mockups/source-image-analysis-settings/index.html`  
  基于 `tech-minimal-product` 设计系统做设置中心开关和任务详情素材面板 mockup。

- Modify: `opendesign/manifest.json`  
  按 `$opendesign` 要求全量扫描后重写 manifest。

- Modify: `frontend-react/src/components/settings/CreativeDefaultsSettings.jsx`  
  按 OpenDesign mockup 增加“来源图片多模态分析”开关和关闭说明。

- Modify: `frontend-react/src/pages/SettingsPage.jsx`  
  将模型配置状态传给 `CreativeDefaultsSettings`，用于前端即时校验。

- Modify: `frontend-react/src/components/creative/CreativeTaskDetail.jsx`  
  按 OpenDesign mockup 展示来源图片素材、`image_analysis` 状态、建议帧、最终使用/未使用状态、失败原因。

### 测试

- Modify: `tests/test-app-settings.js`
- Modify: `tests/test-creative-workflow-defaults.js`
- Modify: `tests/test-creative-workflows.js`
- Modify: `tests/test-source-grounding-prompts.js`
- Modify: `tests/test-html-video-frame-html-agent.js`
- Modify or create: `tests/test-source-image-analysis.js`
- Modify or create: `tests/test-html-video-asset-usage.js`
- Modify: `tests/test-system-settings-ui.mjs`

---

## Task 1: 设置项与默认值

**Files:**

- Modify: `server/services/appSettings.js`
- Modify: `tests/test-app-settings.js`
- Modify: `frontend-react/src/components/settings/CreativeDefaultsSettings.jsx`
- Modify: `tests/test-system-settings-ui.mjs`

- [ ] **Step 1: 写 app settings 失败测试**

在 `tests/test-app-settings.js` 增加断言：

```js
assert.equal(appSettings.normalizeCreativeDefaults({}).sourceImageAnalysisEnabled, false);
assert.equal(appSettings.normalizeCreativeDefaults({ sourceImageAnalysisEnabled: true }).sourceImageAnalysisEnabled, true);
assert.equal(appSettings.normalizeCreativeDefaults({ sourceImageAnalysisEnabled: 'true' }).sourceImageAnalysisEnabled, false);
```

运行：

```powershell
node tests/test-app-settings.js
```

预期：失败，提示 `sourceImageAnalysisEnabled` 字段不存在或值不匹配。

- [ ] **Step 2: 实现默认值规范化**

在 `server/services/appSettings.js` 的 `DEFAULT_CONFIG.creativeDefaults` 增加：

```js
sourceImageAnalysisEnabled: false,
```

在 `normalizeCreativeDefaults` 返回对象中增加：

```js
sourceImageAnalysisEnabled: source.sourceImageAnalysisEnabled === true,
```

运行：

```powershell
node tests/test-app-settings.js
```

预期：通过。

- [ ] **Step 3: 前端默认值补齐**

在 `frontend-react/src/components/settings/CreativeDefaultsSettings.jsx` 的 `DEFAULT_CREATIVE_DEFAULTS` 增加：

```js
sourceImageAnalysisEnabled: false,
```

在开关区域新增一个 `label`，放在“联网研究默认开启”之后：

```jsx
<label className="switchControl rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3">
  <input
    type="checkbox"
    checked={creativeDefaults.sourceImageAnalysisEnabled === true}
    disabled={disabled}
    onChange={event => updateCreativeDefaults({ sourceImageAnalysisEnabled: event.target.checked })}
  />
  <span className="switchTrack" aria-hidden="true">
    <span className="switchThumb" />
  </span>
  <span className="switchText">{creativeDefaults.sourceImageAnalysisEnabled ? '已开启' : '已关闭'}</span>
  <span>来源图片多模态分析</span>
  <span className="col-span-full text-xs leading-relaxed text-[#69717e]">
    关闭后仍会提取文章/GitHub 图片，但只基于图片说明、URL 和上下文进行轻量匹配。
  </span>
</label>
```

- [ ] **Step 4: UI 静态测试补断言**

在 `tests/test-system-settings-ui.mjs` 增加：

```js
assert.match(creativeDefaultsSource, /sourceImageAnalysisEnabled/);
assert.match(creativeDefaultsSource, /来源图片多模态分析/);
```

运行：

```powershell
node tests/test-system-settings-ui.mjs
```

预期：通过。

---

## Task 2: 开启与创建任务校验

**Files:**

- Modify: `server/services/creative/creativeWorkflows.js`
- Modify: `tests/test-creative-workflow-defaults.js`
- Modify: `tests/test-creative-workflows.js`
- Modify: `frontend-react/src/components/settings/CreativeDefaultsSettings.jsx`
- Modify: `frontend-react/src/pages/SettingsPage.jsx`

- [ ] **Step 1: 快照测试**

在 `tests/test-creative-workflow-defaults.js` 的快照断言中加入：

```js
sourceImageAnalysisEnabled = false,
```

并断言：

```js
assert.equal(record.creative_defaults_snapshot.sourceImageAnalysisEnabled, sourceImageAnalysisEnabled);
```

新增覆盖：

```js
const { record } = await createAndRead({
  creativeDefaultsOverride: { sourceImageAnalysisEnabled: true },
  input: '做一期项目解读 https://github.com/owner/repo',
  services: {
    aiModelConfig: {
      getRuntimeConfig: async type => type === 'text'
        ? { enabled: true, provider: 'openai', modelId: 'gpt-4o', supportsMultimodal: true }
        : null,
    },
  },
});
assert.equal(record.creative_defaults_snapshot.sourceImageAnalysisEnabled, true);
```

运行：

```powershell
node tests/test-creative-workflow-defaults.js
```

预期：先失败。

- [ ] **Step 2: 写入快照**

在 `buildCreativeDefaultsSnapshot` 返回对象增加：

```js
sourceImageAnalysisEnabled: typeof overrideSource.sourceImageAnalysisEnabled === 'boolean'
  ? overrideSource.sourceImageAnalysisEnabled
  : defaultsSource.sourceImageAnalysisEnabled === true,
```

- [ ] **Step 3: 创建任务模型校验测试**

在 `tests/test-creative-workflows.js` 增加两个测试：

```js
async function testSourceImageAnalysisRequiresMultimodalTextModel() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices({
    services: {
      appSettings: {
        getCreativeDefaults: async () => ({
          aspectRatio: '9:16',
          targetDurationSec: 60,
          templateByAspectRatio: { '9:16': 'news_signal_vertical', '16:9': '', '1:1': '', '4:5': '' },
          lockTemplate: false,
          useResearch: false,
          generateAudio: true,
          generateCaptions: true,
          emotionalVoice: false,
          sourceImageAnalysisEnabled: true,
        }),
        getEffectiveSystemSettings: async () => ({ skipValidation: false }),
      },
      aiModelConfig: {
        getRuntimeConfig: async type => type === 'text'
          ? { enabled: true, provider: 'openai', modelId: 'gpt-4o-mini', supportsMultimodal: false }
          : null,
      },
    },
  });

  const created = await createCreativeWorkflow({
    input: '做成项目解读 https://github.com/owner/repo',
    useResearch: false,
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, false);
  assert.match(created.message, /多模态|来源图片/);
}

async function testTextWorkflowDoesNotRequireSourceImageAnalysisModel() {
  const { rootDir, mediaRoot } = createTempDirs();
  const { services } = createFakeServices({
    services: {
      appSettings: {
        getCreativeDefaults: async () => ({
          aspectRatio: '9:16',
          targetDurationSec: 60,
          templateByAspectRatio: { '9:16': 'news_signal_vertical', '16:9': '', '1:1': '', '4:5': '' },
          lockTemplate: false,
          useResearch: false,
          generateAudio: true,
          generateCaptions: true,
          emotionalVoice: false,
          sourceImageAnalysisEnabled: true,
        }),
        getEffectiveSystemSettings: async () => ({ skipValidation: false }),
      },
      aiModelConfig: {
        getRuntimeConfig: async () => null,
      },
    },
  });

  const created = await createCreativeWorkflow({
    input: '纯文本选题，不包含链接',
    useResearch: false,
  }, { rootDir, mediaRoot, services });

  assert.equal(created.success, true);
}
```

把两个测试加入 `run()`。

- [ ] **Step 4: 实现后端校验**

在 `creativeWorkflows.js` 增加 helper：

```js
async function validateSourceImageAnalysisConfigIfNeeded(normalizedInput, snapshot, services) {
  if (normalizedInput?.mode !== 'source_url') return null;
  if (snapshot?.sourceImageAnalysisEnabled !== true) return null;
  const runtime = await services.aiModelConfig?.getRuntimeConfig?.('text');
  if (!runtime || runtime.enabled !== true || !runtime.modelId) {
    return '已开启来源图片多模态分析，但当前未配置可用的分析模型。请到设置页配置支持图片输入的分析模型，或关闭该功能后重试。';
  }
  if (runtime.supportsMultimodal !== true) {
    return '已开启来源图片多模态分析，但当前分析模型未标记为支持多模态输入。请到设置页勾选“支持多模态输入”，或关闭该功能后重试。';
  }
  return null;
}
```

在 `createCreativeWorkflow` 中 `normalized` 成功、`snapshot` 创建后、写文件前调用：

```js
const sourceImageAnalysisConfigError = await validateSourceImageAnalysisConfigIfNeeded(normalized.data, snapshot, services);
if (sourceImageAnalysisConfigError) {
  return {
    success: false,
    message: sourceImageAnalysisConfigError,
  };
}
```

运行：

```powershell
node tests/test-creative-workflows.js
node tests/test-creative-workflow-defaults.js
```

预期：通过。

- [ ] **Step 5: 前端开启提示**

修改 `SettingsPage.jsx`，把 `modelSettings.activeModels` 或等价对象传给 `CreativeDefaultsSettings`：

```jsx
<CreativeDefaultsSettings
  ...
  activeModels={modelSettings.activeModels}
/>
```

修改 `CreativeDefaultsSettings` 函数签名：

```js
export function CreativeDefaultsSettings({ appSettings, templates, disabled, saving, onChange, onSave, activeModels }) {
```

在开关 `onChange` 中，如果开启且 `activeModels?.text?.supportsMultimodal !== true`，不要切换，调用一个本地状态展示中文提示。最小实现可在组件内加：

```js
const canUseSourceImageAnalysis = activeModels?.text?.enabled === true
  && activeModels?.text?.modelId
  && activeModels?.text?.supportsMultimodal === true;
```

文案：

```text
当前分析模型未标记为支持多模态输入，无法开启来源图片多模态分析。
```

---

## Task 3: 图片多模态分析服务

**Files:**

- Create: `server/services/source/sourceImageAnalysis.js`
- Create: `tests/test-source-image-analysis.js`

- [ ] **Step 1: 写服务测试**

创建 `tests/test-source-image-analysis.js`：

```js
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const imageAnalysis = require('../server/services/source/sourceImageAnalysis');

async function testDisabledWritesDisabledStatus() {
  const assets = [{ id: 'article_01', source: 'article', local_path: 'x.png', path: 'assets/x.png' }];
  const result = await imageAnalysis.analyzeSourceImageAssets({ assets, enabled: false });
  assert.equal(result.status, 'disabled');
  assert.equal(result.assets[0].image_analysis.status, 'disabled');
}

async function testAnalyzesArticleImageWithMultimodalModel() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-image-analysis-test-'));
  const imagePath = path.join(dir, 'a.png');
  fs.writeFileSync(imagePath, Buffer.from('fake-image'));
  const calls = [];
  const model = {
    callTextModel: async request => {
      calls.push(request);
      assert.equal(Array.isArray(request.messages[0].content), true);
      return {
        success: true,
        text: JSON.stringify({
          visual_type: 'architecture_diagram',
          summary: '展示系统模块关系的架构图',
          contains_text: true,
          text_readability: 'high',
          best_usage: 'showcase_with_callouts',
          fit: 'contain',
          should_use: true,
          relevance_keywords: ['架构', '模块', '数据流'],
          avoid_reason: '',
        }),
      };
    },
  };
  const result = await imageAnalysis.analyzeSourceImageAssets({
    enabled: true,
    assets: [{ id: 'article_01', source: 'article', local_path: imagePath, path: 'assets/a.png', mime: 'image/png', alt: '架构图' }],
    model,
    runtime: { provider: 'openai', modelId: 'gpt-4o' },
    now: '2026-07-02T00:00:00.000Z',
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.assets[0].image_analysis.visual_type, 'architecture_diagram');
  assert.equal(result.assets[0].image_analysis.fit, 'contain');
  assert.equal(calls.length, 1);
}

async function testFailureDegradesPerAsset() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-image-analysis-fail-test-'));
  const imagePath = path.join(dir, 'a.png');
  fs.writeFileSync(imagePath, Buffer.from('fake-image'));
  const result = await imageAnalysis.analyzeSourceImageAssets({
    enabled: true,
    assets: [{ id: 'article_01', source: 'article', local_path: imagePath, path: 'assets/a.png', mime: 'image/png' }],
    model: { callTextModel: async () => ({ success: false, message: '模型失败' }) },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.assets[0].image_analysis.status, 'failed');
  assert.match(result.assets[0].image_analysis.message, /模型失败/);
}

(async () => {
  await testDisabledWritesDisabledStatus();
  await testAnalyzesArticleImageWithMultimodalModel();
  await testFailureDegradesPerAsset();
  console.log('source image analysis tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
```

运行：

```powershell
node tests/test-source-image-analysis.js
```

预期：失败，模块不存在。

- [ ] **Step 2: 实现 `sourceImageAnalysis.js`**

创建 `server/services/source/sourceImageAnalysis.js`，核心结构：

```js
const fs = require('fs');
const fsp = require('fs/promises');

const MAX_ANALYZED_IMAGES = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function safeString(value) {
  return String(value || '').trim();
}

function createDisabledImageAnalysis(reason = 'settings_disabled') {
  return {
    status: 'disabled',
    reason,
    summary: '来源图片多模态分析已关闭，系统将使用图片说明、URL 和上下文进行轻量匹配。',
  };
}

function normalizeImageAnalysis(raw = {}) {
  return {
    status: 'ready',
    visual_type: safeEnum(raw.visual_type, ['screenshot', 'architecture_diagram', 'chart', 'code', 'logo', 'badge', 'portrait', 'decorative', 'unknown'], 'unknown'),
    summary: safeString(raw.summary).slice(0, 80),
    contains_text: raw.contains_text === true,
    text_readability: safeEnum(raw.text_readability, ['high', 'medium', 'low', 'none'], 'none'),
    best_usage: safeEnum(raw.best_usage, ['showcase', 'showcase_with_callouts', 'evidence_card', 'background', 'small_logo', 'skip'], 'showcase'),
    fit: safeEnum(raw.fit, ['contain', 'cover', 'icon'], 'contain'),
    should_use: raw.should_use !== false,
    relevance_keywords: Array.isArray(raw.relevance_keywords)
      ? raw.relevance_keywords.map(safeString).filter(Boolean).slice(0, 8)
      : [],
    avoid_reason: safeString(raw.avoid_reason).slice(0, 120),
  };
}

function safeEnum(value, allowed, fallback) {
  const text = safeString(value);
  return allowed.includes(text) ? text : fallback;
}

function extractJsonObject(text) {
  const raw = safeString(text);
  if (!raw) throw new Error('模型返回空内容。');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型未返回 JSON 对象。');
  return JSON.parse(body.slice(start, end + 1));
}

async function imageToDataUrl(asset) {
  const localPath = safeString(asset.local_path);
  if (!localPath || !fs.existsSync(localPath)) throw new Error('图片文件不存在。');
  const stat = await fsp.stat(localPath);
  if (stat.size > MAX_IMAGE_BYTES) throw new Error('图片超过大小限制。');
  const buffer = await fsp.readFile(localPath);
  const mime = safeString(asset.mime) || 'image/jpeg';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function buildImageAnalysisMessages(asset, dataUrl) {
  const prompt = [
    '你是短视频来源图片分析器。请分析这张文章/GitHub 来源图片，输出严格 JSON。',
    '目标是判断它适不适合放进视频镜头，适合怎样展示。',
    '',
    `图片 ID：${safeString(asset.id)}`,
    `图片说明：${safeString(asset.alt || asset.title) || '无'}`,
    `来源 URL：${safeString(asset.url) || '无'}`,
    '',
    '只输出 JSON，字段为 visual_type, summary, contains_text, text_readability, best_usage, fit, should_use, relevance_keywords, avoid_reason。',
  ].join('\n');
  return [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
  }];
}

function shouldAnalyzeAsset(asset) {
  if (safeString(asset.source) !== 'article') return false;
  if (safeString(asset.type) && safeString(asset.type) !== 'image') return false;
  return !!safeString(asset.local_path);
}

async function analyzeOne(asset, model) {
  const dataUrl = await imageToDataUrl(asset);
  const response = await model.callTextModel({
    messages: buildImageAnalysisMessages(asset, dataUrl),
    stream: false,
    temperature: 0,
  });
  if (!response || response.success === false) {
    throw new Error(safeString(response?.message) || '图片分析模型调用失败。');
  }
  return normalizeImageAnalysis(extractJsonObject(response.text));
}

async function analyzeSourceImageAssets({ assets = [], enabled = false, model = null, runtime = null, now = '' } = {}) {
  const list = Array.isArray(assets) ? assets : [];
  if (!enabled) {
    const disabled = createDisabledImageAnalysis();
    return {
      ...disabled,
      enabled: false,
      updated_at: now || new Date().toISOString(),
      assets: list.map(asset => ({ ...asset, image_analysis: disabled })),
    };
  }
  if (!model || typeof model.callTextModel !== 'function') {
    const failed = { status: 'failed', enabled: true, message: '未配置可用的多模态分析模型。' };
    return { ...failed, updated_at: now || new Date().toISOString(), assets: list };
  }

  let analyzed = 0;
  let failed = 0;
  let skipped = 0;
  const nextAssets = [];
  for (const asset of list) {
    if (!shouldAnalyzeAsset(asset) || analyzed >= MAX_ANALYZED_IMAGES) {
      skipped += 1;
      nextAssets.push({ ...asset, image_analysis: { status: 'skipped', reason: 'not_article_image' } });
      continue;
    }
    try {
      const analysis = await analyzeOne(asset, model);
      analyzed += 1;
      nextAssets.push({ ...asset, image_analysis: analysis });
    } catch (error) {
      failed += 1;
      nextAssets.push({
        ...asset,
        image_analysis: {
          status: 'failed',
          message: safeString(error.message) || '图片分析失败。',
        },
      });
    }
  }
  return {
    status: analyzed > 0 && failed > 0 ? 'partial' : analyzed > 0 ? 'ready' : failed > 0 ? 'failed' : 'skipped',
    enabled: true,
    updated_at: now || new Date().toISOString(),
    model: runtime ? { provider: runtime.provider || '', model_id: runtime.modelId || '' } : null,
    analyzed_count: analyzed,
    skipped_count: skipped,
    failed_count: failed,
    summary: analyzed > 0 ? `已分析 ${analyzed} 张来源图片。` : '未完成来源图片多模态分析。',
    assets: nextAssets,
  };
}

module.exports = {
  analyzeSourceImageAssets,
  buildImageAnalysisMessages,
  normalizeImageAnalysis,
  createDisabledImageAnalysis,
};
```

运行：

```powershell
node tests/test-source-image-analysis.js
```

预期：通过。

---

## Task 4: 接入 `assets` 阶段并写入 `asset_context`

**Files:**

- Modify: `server/services/creative/creativeSourcePrep.js`
- Modify: `server/services/creative/creativeWorkflows.js`
- Modify: `tests/test-creative-workflows.js`

- [ ] **Step 1: 扩展 source_url workflow 测试**

在 `testCreatesAndRunsSourceUrlWorkflow` 的 fake services 中增加：

```js
aiModelConfig: {
  getRuntimeConfig: async type => type === 'text'
    ? { enabled: true, provider: 'openai', modelId: 'gpt-4o', supportsMultimodal: true }
    : null,
},
sourceImageAnalysis: {
  analyzeSourceImageAssets: async ({ assets, enabled, runtime }) => ({
    status: enabled ? 'ready' : 'disabled',
    enabled,
    model: runtime ? { provider: runtime.provider, model_id: runtime.modelId } : null,
    analyzed_count: enabled ? 1 : 0,
    skipped_count: 0,
    failed_count: 0,
    summary: enabled ? '已分析 1 张来源图片。' : '来源图片多模态分析已关闭。',
    assets: assets.map(asset => ({
      ...asset,
      image_analysis: enabled ? {
        status: 'ready',
        visual_type: 'architecture_diagram',
        summary: '架构图',
        contains_text: true,
        text_readability: 'high',
        best_usage: 'showcase_with_callouts',
        fit: 'contain',
        should_use: true,
        relevance_keywords: ['架构'],
        avoid_reason: '',
      } : { status: 'disabled', reason: 'settings_disabled' },
    })),
  }),
},
```

把 creative defaults 加上：

```js
sourceImageAnalysisEnabled: true,
```

新增断言：

```js
assert.equal(analysisInput.creative_context.asset_context.image_analysis.status, 'ready');
assert.equal(analysisInput.creative_context.asset_context.assets[0].image_analysis.visual_type, 'architecture_diagram');
```

- [ ] **Step 2: resolveServices 增加服务注入**

在 `creativeWorkflows.js` 的 `resolveServices` 返回对象中加入：

```js
sourceImageAnalysis: services.sourceImageAnalysis || require('../source/sourceImageAnalysis'),
```

- [ ] **Step 3: prepareSourceAssetContext 调用分析**

在 `creativeSourcePrep.js` 顶部引入默认服务：

```js
const defaultSourceImageAnalysis = require('../source/sourceImageAnalysis');
```

在 `prepareSourceAssetContext` 下载完成后、写入 record 前增加：

```js
const sourceImageAnalysisEnabled = record.creative_defaults_snapshot?.sourceImageAnalysisEnabled === true
  || record.creative_context?.creative_defaults_snapshot?.sourceImageAnalysisEnabled === true;
const analyzer = services.sourceImageAnalysis || defaultSourceImageAnalysis;
let nextAssetContext = assetContext;
if (analyzer && typeof analyzer.analyzeSourceImageAssets === 'function') {
  const runtime = sourceImageAnalysisEnabled
    ? await services.aiModelConfig?.getRuntimeConfig?.('text')
    : null;
  const analysisResult = await analyzer.analyzeSourceImageAssets({
    enabled: sourceImageAnalysisEnabled,
    assets: assetContext.assets,
    model: sourceImageAnalysisEnabled ? services.aiTextModel : null,
    runtime,
    now,
  }).catch(error => ({
    status: 'failed',
    enabled: sourceImageAnalysisEnabled,
    message: safeString(error.message) || '来源图片分析失败，已降级为轻量匹配。',
    assets: assetContext.assets,
  }));
  nextAssetContext = {
    ...assetContext,
    assets: Array.isArray(analysisResult.assets) ? analysisResult.assets : assetContext.assets,
    image_analysis: {
      status: analysisResult.status || 'failed',
      enabled: analysisResult.enabled === true,
      model: analysisResult.model || null,
      analyzed_count: analysisResult.analyzed_count || 0,
      skipped_count: analysisResult.skipped_count || 0,
      failed_count: analysisResult.failed_count || 0,
      summary: analysisResult.summary || analysisResult.message || '',
      updated_at: now,
    },
  };
}
```

然后后续统一使用 `nextAssetContext` 赋值和写入。

运行：

```powershell
node tests/test-creative-workflows.js
```

预期：通过。

---

## Task 5: `contentGraphAgent` 输出 `asset_refs`

**Files:**

- Modify: `server/services/creative-video/html-video/contentGraphAgent.js`
- Modify: `tests/test-source-grounding-prompts.js`

- [ ] **Step 1: prompt 测试补充 image_analysis**

在 `tests/test-source-grounding-prompts.js` 的 `assetCreativeContext.asset_context.assets[0]` 增加：

```js
image_analysis: {
  status: 'ready',
  visual_type: 'architecture_diagram',
  summary: '展示系统模块关系的架构图',
  best_usage: 'showcase_with_callouts',
  fit: 'contain',
  should_use: true,
  relevance_keywords: ['架构', '模块'],
}
```

新增断言：

```js
assert.match(assetGraphPrompt, /图片分析=architecture_diagram/);
assert.match(assetGraphPrompt, /showcase_with_callouts/);
assert.match(assetGraphPrompt, /asset_refs/);
```

- [ ] **Step 2: prompt 增强**

在 `summarizeCreativeContextForPrompt` 输出每张图时追加：

```js
const analysis = objectOrEmpty(asset.image_analysis);
const analysisSummary = analysis.status === 'ready'
  ? `；图片分析=${compactText(analysis.visual_type, 40)}；建议=${compactText(analysis.best_usage, 60)}；展示=${compactText(analysis.fit, 20)}；说明=${compactText(analysis.summary, 120)}`
  : '';
if (src) lines.push(`- ${index + 1}. id=${asset.id || `asset_${index + 1}`}；${label}；来源=${source}；HTML引用=${src}${analysisSummary}`);
```

在输出要求中新增：

```js
'- 如果某个 node 适合使用来源图片，请在该 node 上输出 asset_refs 数组，元素包含 asset_id、usage、reason；asset_id 必须来自 SOURCE MATERIAL 的可用图片素材 id。',
'- asset_refs 只推荐与当前节点强相关的图片；每个 node 最多推荐 1 张主图。'
```

在 JSON schema 草案 node 中加：

```js
asset_refs: [{ asset_id: 'article_01', usage: 'showcase_with_callouts', reason: '匹配本帧架构讲解' }],
```

- [ ] **Step 3: normalize graph 保留 asset_refs**

在 normalize node 的位置加入：

```js
asset_refs: normalizeAssetRefs(node.asset_refs),
```

新增 helper：

```js
function normalizeAssetRefs(value) {
  const refs = Array.isArray(value) ? value : [];
  return refs.map(ref => {
    const source = objectOrEmpty(ref);
    return {
      asset_id: compactText(source.asset_id || source.id, 80),
      usage: compactText(source.usage || source.best_usage, 80),
      reason: compactText(source.reason, 180),
    };
  }).filter(ref => ref.asset_id).slice(0, 1);
}
```

运行：

```powershell
node tests/test-source-grounding-prompts.js
```

预期：通过。

---

## Task 6: `frameHtmlAgent` 使用本帧推荐图

**Files:**

- Modify: `server/services/creative-video/html-video/frameHtmlAgent.js`
- Modify: `tests/test-html-video-frame-html-agent.js`

- [ ] **Step 1: 测试本帧推荐图 prompt**

在 `assetPrompt` 测试中的 `node` 增加：

```js
asset_refs: [{
  asset_id: 'article_01',
  usage: 'showcase_with_callouts',
  reason: '匹配价格表截图说明',
}],
```

新增断言：

```js
assert.match(assetPrompt, /本帧推荐来源图片/);
assert.match(assetPrompt, /article_01/);
assert.match(assetPrompt, /匹配价格表截图说明/);
```

- [ ] **Step 2: 实现推荐图摘要**

在 `frameHtmlAgent.js` 新增 helper：

```js
function frameAssetReferenceSummary(node = {}, creativeContext = {}) {
  const refs = Array.isArray(node.asset_refs) ? node.asset_refs : [];
  if (!refs.length) return '';
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
  const byId = new Map(assets.map(asset => [String(asset.id || '').trim(), asset]));
  const lines = ['本帧推荐来源图片：'];
  refs.slice(0, 1).forEach(ref => {
    const assetId = String(ref.asset_id || ref.id || '').trim();
    const asset = byId.get(assetId);
    if (!asset) return;
    const analysis = asset.image_analysis || {};
    const src = asset.frame_src || asset.path;
    lines.push(`- ${assetId}: ${src}`);
    if (analysis.visual_type) lines.push(`  类型：${analysis.visual_type}`);
    if (analysis.summary) lines.push(`  图片说明：${analysis.summary}`);
    if (ref.usage || analysis.best_usage) lines.push(`  建议用法：${ref.usage || analysis.best_usage}`);
    if (ref.reason) lines.push(`  推荐原因：${ref.reason}`);
  });
  return lines.length > 1 ? lines.join('\n') : '';
}
```

在 prompt 动态输入中 `Source context summary` 后加入：

```js
frameAssetReferenceSummary(node, creativeContext) || '本帧没有专门推荐的来源图片。',
```

在硬性要求里把原图片规则改为：

```text
- 如果本帧提供“本帧推荐来源图片”，优先使用推荐图片；没有推荐图片时，才从 Source context summary 的可用图片素材中选择。
```

运行：

```powershell
node tests/test-html-video-frame-html-agent.js
```

预期：通过。

---

## Task 7: 渲染后 HTML 使用追踪

**Files:**

- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Create: `tests/test-html-video-asset-usage.js`

- [ ] **Step 1: 写使用追踪测试**

创建 `tests/test-html-video-asset-usage.js`：

```js
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-usage-test-'));
write(path.join(dir, 'frames/01.html'), '<img src="../assets/a.png">');
write(path.join(dir, 'frames/02.html'), '<main>no image</main>');

const project = {
  frames: [
    { id: 'scene_01', html_path: 'frames/01.html' },
    { id: 'scene_02', html_path: 'frames/02.html' },
  ],
};
const creativeContext = {
  asset_context: {
    assets: [
      { id: 'article_01', path: 'assets/a.png', frame_src: '../assets/a.png' },
      { id: 'article_02', path: 'assets/b.png', frame_src: '../assets/b.png' },
    ],
  },
};

const report = workflow.buildAssetUsageReport({ project, projectDir: dir, creativeContext });
assert.equal(report.status, 'ready');
assert.equal(report.assets[0].used, true);
assert.deepEqual(report.assets[0].used_in_frames, ['scene_01']);
assert.equal(report.assets[1].used, false);
assert.deepEqual(report.unused_asset_ids, ['article_02']);
console.log('html-video asset usage tests passed');
```

运行：

```powershell
node tests/test-html-video-asset-usage.js
```

预期：失败，函数未导出。

- [ ] **Step 2: 实现扫描函数**

在 `htmlVideoWorkflow.js` 新增：

```js
function normalizeAssetRefForMatch(value) {
  return String(value || '').replace(/\\/g, '/').trim();
}

function assetMatchTokens(asset = {}) {
  return Array.from(new Set([
    normalizeAssetRefForMatch(asset.frame_src),
    normalizeAssetRefForMatch(asset.path),
    normalizeAssetRefForMatch(asset.path ? `../${asset.path}` : ''),
  ].filter(Boolean)));
}

function buildAssetUsageReport({ project = {}, projectDir = '', creativeContext = {} } = {}) {
  const assets = Array.isArray(creativeContext?.asset_context?.assets) ? creativeContext.asset_context.assets : [];
  if (!assets.length) {
    return { status: 'empty', assets: [], used_asset_ids: [], unused_asset_ids: [] };
  }
  const frames = Array.isArray(project.frames) ? project.frames : [];
  const results = assets.map(asset => ({
    asset_id: asset.id || '',
    path: asset.path || '',
    frame_src: asset.frame_src || '',
    used: false,
    used_in_frames: [],
    usage_count: 0,
  }));
  frames.forEach(frame => {
    const htmlPath = frame.html_path || frame.htmlPath || '';
    if (!htmlPath || !projectDir) return;
    const abs = projectStore.resolveProjectPath(projectDir, htmlPath);
    if (!fs.existsSync(abs)) return;
    const html = fs.readFileSync(abs, 'utf8').replace(/\\/g, '/');
    results.forEach((item, index) => {
      const tokens = assetMatchTokens(assets[index]);
      if (tokens.some(token => html.includes(token))) {
        item.used = true;
        item.usage_count += 1;
        item.used_in_frames.push(frame.id || frame.frame_id || htmlPath);
      }
    });
  });
  const used = results.filter(item => item.used).map(item => item.asset_id).filter(Boolean);
  const unused = results.filter(item => !item.used).map(item => item.asset_id).filter(Boolean);
  return {
    status: 'ready',
    assets: results,
    used_asset_ids: used,
    unused_asset_ids: unused,
    summary: used.length
      ? `最终 HTML 使用了 ${used.length} 张来源图片。`
      : '最终 HTML 未引用已准备的来源图片。',
  };
}
```

导出：

```js
buildAssetUsageReport,
```

- [ ] **Step 3: 接入 workflow 结果**

在项目保存/校验后、返回结果前调用：

```js
const assetUsageReport = buildAssetUsageReport({ project, projectDir, creativeContext });
project.asset_usage_report = assetUsageReport;
if (creativeContext.asset_context) {
  creativeContext.asset_context.asset_usage_report = assetUsageReport;
}
```

确保 `project` 保存前已带上 `asset_usage_report`。

运行：

```powershell
node tests/test-html-video-asset-usage.js
node tests/test-html-video-workflow.js
```

预期：通过。

---

## Task 8: OpenDesign UI 设计

**Files:**

- Create: `opendesign/mockups/source-image-analysis-settings/index.html`
- Modify: `opendesign/manifest.json`
- Read: `opendesign/design-systems/tech-minimal-product/SKILL.md`
- Read: `opendesign/design-systems/tech-minimal-product/tokens/colors_and_type.css`
- Read: `frontend-react/src/components/settings/CreativeDefaultsSettings.jsx`
- Read: `frontend-react/src/components/creative/CreativeTaskDetail.jsx`

- [ ] **Step 1: 读取设计系统和现有 UI**

运行：

```powershell
Get-Content -Encoding UTF8 opendesign\design-systems\tech-minimal-product\SKILL.md
Get-Content -Encoding UTF8 opendesign\design-systems\tech-minimal-product\tokens\colors_and_type.css
Get-Content -Encoding UTF8 frontend-react\src\components\settings\CreativeDefaultsSettings.jsx
Get-Content -Encoding UTF8 frontend-react\src\components\creative\CreativeTaskDetail.jsx
```

观察并记录到实现笔记中：当前界面是安静、工作台式、低饱和、细边框、紧凑信息密度；按钮和状态标签已有 shadcn/lucide 风格；不要做营销 hero、不要做大面积装饰卡片。

- [ ] **Step 2: 创建 OpenDesign mockup**

创建目录：

```powershell
New-Item -ItemType Directory -Force opendesign\mockups\source-image-analysis-settings
```

创建 `opendesign/mockups/source-image-analysis-settings/index.html`，必须包含两个区域：

1. 设置中心“来源图片多模态分析”开关：
   - 默认关闭态。
   - 可开启态。
   - 模型不支持多模态时的禁用/警告态。
   - 关闭说明：“关闭后仍会提取文章/GitHub 图片，但只基于图片说明、URL 和上下文进行轻量匹配。”

2. 任务详情“来源图片素材”面板：
   - `ready` 图片分析完成。
   - `disabled` 图片分析关闭但图片仍可用。
   - `failed` 分析失败后降级。
   - 已用于镜头 / 最终未引用。
   - diagnostics 下载失败行。

mockup 不需要真实图片资源，使用带标签的占位缩略图。不要使用 emoji 图标；需要图标时使用简单文本标签或 lucide 对应语义在 React 实现中再接入。

- [ ] **Step 3: 重写 OpenDesign manifest**

按 `$opendesign` 要求全量扫描 `opendesign/mockups/**/*.html` 和 `opendesign/design-systems/**`，重写 `opendesign/manifest.json`。manifest 至少包含：

```json
{
  "sections": [
    {
      "id": "mockups",
      "groups": [
        {
          "slug": "source-image-analysis-settings",
          "files": [
            { "label": "index.html", "path": "mockups/source-image-analysis-settings/index.html" }
          ]
        }
      ]
    }
  ]
}
```

`generated` 使用当前 ISO 时间；保留其它已有 mockup 和 design-system 条目，不要只写新条目。

- [ ] **Step 4: 运行 OpenDesign 预览与验证**

使用 `run-opendesign` skill 启动预览。确认 mockup 可以从 OpenDesign 入口打开，布局不溢出，设置开关和素材面板在桌面宽度下可读。若后续需要移动端实现，mockup 也要包含窄屏堆叠布局。

Acceptance：

- OpenDesign mockup 已存在。
- manifest 已更新。
- UI 视觉和 `tech-minimal-product` 保持一致。
- React 实现任务不得偏离 mockup 的信息层级和文案。

---

## Task 9: 任务详情页素材展示与设置 UI 实现

**Files:**

- Modify: `frontend-react/src/components/creative/CreativeTaskDetail.jsx`
- Modify: `frontend-react/src/components/settings/CreativeDefaultsSettings.jsx`
- Modify: `frontend-react/src/pages/SettingsPage.jsx`
- Create or modify: `tests/test-one-click-creative-page.mjs` 或新增静态测试 `tests/test-creative-task-detail-assets.mjs`

- [ ] **Step 1: 增加静态测试**

新增 `tests/test-creative-task-detail-assets.mjs`：

```js
import assert from 'assert/strict';
import fs from 'fs';

const source = fs.readFileSync('frontend-react/src/components/creative/CreativeTaskDetail.jsx', 'utf8');

assert.match(source, /SourceImageAssetsPanel/);
assert.match(source, /来源图片素材/);
assert.match(source, /image_analysis/);
assert.match(source, /asset_usage_report/);
assert.match(source, /最终未引用/);

console.log('creative task detail assets ui tests passed');
```

运行：

```powershell
node tests/test-creative-task-detail-assets.mjs
```

预期：失败。

- [ ] **Step 2: 实现展示组件**

在 `CreativeTaskDetail.jsx` 内 `CreativeRetryPlan` 后新增：

```jsx
function SourceImageAssetsPanel({ workflow }) {
  const assetContext = workflow?.asset_context || workflow?.creative_context?.asset_context || null;
  const assets = Array.isArray(assetContext?.assets) ? assetContext.assets : [];
  const diagnostics = Array.isArray(assetContext?.diagnostics) ? assetContext.diagnostics : [];
  const usageReport = assetContext?.asset_usage_report
    || workflow?.result?.hyperframes_freeform?.project?.asset_usage_report
    || workflow?.html_video_project?.asset_usage_report
    || null;
  const usageById = new Map((Array.isArray(usageReport?.assets) ? usageReport.assets : []).map(item => [item.asset_id, item]));
  if (!assetContext || (!assets.length && !diagnostics.length)) return null;

  return (
    <section className="grid gap-3 rounded-lg border border-[#e7e9ee] bg-white p-4" aria-label="来源图片素材">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-[15px] font-bold leading-snug text-[#111827]">来源图片素材</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6b7280]">
            {assetContext.summary || assetContext.image_analysis?.summary || '系统会优先使用文章/GitHub 来源图片增强镜头证据。'}
          </p>
        </div>
        {assetContext.image_analysis?.status ? (
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
            图片分析：{formatImageAnalysisStatus(assetContext.image_analysis.status)}
          </span>
        ) : null}
      </div>
      {assets.length ? (
        <div className="grid gap-2">
          {assets.map(asset => {
            const usage = usageById.get(asset.id) || null;
            const analysis = asset.image_analysis || {};
            return (
              <div key={asset.id || asset.path} className="grid gap-1 rounded-lg border border-[#edf0f4] bg-[#fafbfc] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-[13px] text-[#111827]">{asset.alt || asset.title || asset.id || '来源图片'}</strong>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[#69717e] ring-1 ring-[#e5e7eb]">{asset.source === 'search' ? '补充图片' : '来源图片'}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[#69717e] ring-1 ring-[#e5e7eb]">{formatImageAnalysisStatus(analysis.status)}</span>
                  {usage ? (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${usage.used ? 'bg-green-50 text-green-700 ring-green-200' : 'bg-amber-50 text-amber-700 ring-amber-200'}`}>
                      {usage.used ? `已用于 ${usage.used_in_frames?.length || usage.usage_count || 1} 个镜头` : '最终未引用'}
                    </span>
                  ) : null}
                </div>
                {analysis.summary ? <p className="m-0 text-[12px] leading-relaxed text-[#4b5563]">{analysis.summary}</p> : null}
                {analysis.visual_type ? <p className="m-0 text-[12px] text-[#69717e]">类型：{analysis.visual_type}；建议：{analysis.best_usage || '轻量匹配'}；展示：{analysis.fit || 'contain'}</p> : null}
                {usage?.used_in_frames?.length ? <p className="m-0 text-[12px] text-[#69717e]">引用镜头：{usage.used_in_frames.join('、')}</p> : null}
                {analysis.message ? <p className="m-0 text-[12px] text-red-700">{analysis.message}</p> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {diagnostics.length ? (
        <div className="grid gap-1 text-[12px] leading-relaxed text-amber-800">
          {diagnostics.slice(0, 4).map((item, index) => (
            <p key={`${item.code || 'diag'}-${index}`} className="m-0">{item.message || item.code}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatImageAnalysisStatus(status) {
  const value = String(status || '').trim();
  if (value === 'ready') return '已完成';
  if (value === 'partial') return '部分完成';
  if (value === 'failed') return '失败后降级';
  if (value === 'disabled') return '已关闭';
  if (value === 'skipped') return '已跳过';
  return '未分析';
}
```

在主 render 中 `CreativeProgressPanel` 后加入：

```jsx
<SourceImageAssetsPanel workflow={workflow} />
```

运行：

```powershell
node tests/test-creative-task-detail-assets.mjs
```

预期：通过。

---

## Task 10: 总回归与文案修正

**Files:**

- Modify as needed: `server/services/creative/creativeContext.js`
- Modify as needed: `server/services/creative/creativeWorkflows.js`
- Modify as needed: tests containing old manual asset text

- [ ] **Step 1: 修正旧文案**

把用户可见的：

```text
图片素材将在下一阶段开放。
```

改为：

```text
暂不支持手动传入 assetIds，请先移除手动素材后重试。文章/GitHub 链接图片会自动尝试提取。
```

涉及：

- `server/services/creative/creativeContext.js`
- `server/services/creative/creativeWorkflows.js`
- `tests/test-creative-context.js`

运行：

```powershell
node tests/test-creative-context.js
```

预期：通过。

- [ ] **Step 2: 运行最小回归**

运行：

```powershell
node tests/test-app-settings.js
node tests/test-ai-model-config.js
node tests/test-source-assets.js
node tests/test-source-image-analysis.js
node tests/test-creative-context.js
node tests/test-creative-workflow-defaults.js
node tests/test-creative-workflows.js
node tests/test-source-grounding-prompts.js
node tests/test-html-video-frame-html-agent.js
node tests/test-html-video-asset-usage.js
node tests/test-system-settings-ui.mjs
node tests/test-creative-task-detail-assets.mjs
```

预期：全部通过。

- [ ] **Step 3: 手工检查 diff 范围**

运行：

```powershell
git diff --stat
git diff -- docs\\2026-07-02-source-image-analysis-implementation-plan.md
```

确认没有修改与本功能无关的文件。若工作区存在用户其它改动，不回滚、不格式化、不整理。

---

## Acceptance

完成后必须满足：

- 设置中心有“来源图片多模态分析”开关，默认关闭。
- 开关开启时依赖当前 active 分析模型的 `supportsMultimodal=true`。
- 创建 `source_url` 任务时，如果开关开启但模型不支持多模态，直接中文失败。
- 关闭开关时仍提取、下载、传递、复制来源图片，只跳过多模态分析。
- `asset_context.image_analysis` 和 `asset.image_analysis` 有稳定状态。
- `contentGraphAgent` 能看到图片分析结果，并可输出 `nodes[].asset_refs`。
- `frameHtmlAgent` 优先使用当前帧推荐图片。
- html-video 工程生成 `asset_usage_report`，能区分已使用/未使用图片。
- 任务详情页展示来源图片素材、分析状态、最终引用状态、失败原因。
- 不新增依赖。
- 不新增 `multimodal` 模型类型。
- 不重写 `extractMarkdownImages`。
- 不做网页截图。
- 不把 Pexels/search 补图当来源证据。

## Self-Review

Spec coverage:

- 设置开关：Task 1-2。
- 创建任务校验：Task 2。
- 图片多模态分析：Task 3-4。
- `image_analysis` 写入 `asset_context`：Task 4。
- content graph 使用 `image_analysis`：Task 5。
- `node.asset_refs`：Task 5。
- frame HTML 每帧推荐图：Task 6。
- 渲染后 `usage_report`：Task 7。
- OpenDesign UI 设计：Task 8。
- UI 展示：Task 9。
- 旧文案修正：Task 10。

Placeholder scan:

- 本文不使用 `TBD`、`TODO`、`implement later`。
- 每个任务列出具体文件、代码片段、命令和预期结果。

Type consistency:

- 设置字段统一为 `sourceImageAnalysisEnabled`。
- 图片分析字段统一为 `image_analysis`。
- 帧级推荐字段统一为 `asset_refs`。
- 使用追踪字段统一为 `asset_usage_report`。
