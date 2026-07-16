# 统一视觉素材 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不创建第二套 registry 的前提下，把上传、来源提取、页面截图、AI 生图、Pexels/search 和衍生图片统一到 `asset_context.assets`，并建立用户 requirement、证据边界和 required 可见性门禁。

**Architecture:** 新增一个无状态的视觉素材契约模块，集中处理旧素材兼容归一化和按 ID 幂等合并；所有 producer 继续使用现有文件与工作流存储，只在写入 `asset_context.assets` 前经过该模块。上传使用浏览器原生 `File` 直传和 Node 请求流，不增加 multipart 依赖；任务创建时一次性认领暂存文件。

**Tech Stack:** Node.js 22、Express 4、React 19、现有 Tailwind/shadcn/ui、`node:fs`/`node:path`、项目现有 assert 测试脚本。

---

## 文件结构

- Create `server/services/creative/visualAssetContract.js`：统一枚举、旧字段兼容、单资产归一化、资产上下文合并。
- Create `server/services/creative/visualAssetUploads.js`：上传暂存、大小/MIME 校验、任务认领和过期清理。
- Modify `server/services/creative/creativeContext.js`：接受暂存资产 ID，创建已认领的初始素材上下文。
- Modify `server/services/creative/creativeSourcePrep.js`：来源素材与已认领素材合并，不覆盖。
- Modify `server/services/source/sourceAssets.js`：来源提取和 Pexels 输出正式元数据。
- Modify `server/services/creative-video/html-video/generatedImagePhase.js`：AI 生图输出正式元数据并幂等合并。
- Modify `server/services/creative-video/html-video/assetUsagePhase.js`：工程序列化保留契约字段，required 只读取 `requirement`。
- Modify `server/routes/creativeWorkflows.js`：原始图片上传暂存接口。
- Modify `server/services/creative/creativeWorkflows.js`：任务创建时认领暂存素材。
- Modify `frontend-react/src/api/client.js`：原始文件上传客户端。
- Modify `frontend-react/src/components/creative/CreativeComposer.jsx`：上传缩略图和“必须使用”控件。
- Modify `frontend-react/src/pages/OneClickCreativePage.jsx`：上传状态、重复点击保护、创建任务时传入资产 ID。
- Modify `frontend-react/src/components/creative/SourceImageAssetsPanel.jsx`：展示正式来源、证据、requirement 和 usage 信息。
- Create/extend focused tests listed per task.

### Task 1: 统一视觉素材契约与幂等合并

**Files:**
- Create: `server/services/creative/visualAssetContract.js`
- Create: `tests/test-visual-asset-contract.js`

- [x] **Step 1: 写失败测试**

测试必须覆盖：六种 `origin`、三种 `requirement`、五种 `evidence_class`；旧 `source` 推导；用户上传默认 preferred；系统素材默认 optional；重复 ID 后者更新但保留旧文件字段；非法枚举拒绝；derived 必须有父 ID。

```js
const assert = require('assert');
const {
  normalizeVisualAsset,
  mergeVisualAssetContexts,
} = require('../server/services/creative/visualAssetContract');

const upload = normalizeVisualAsset({ id: 'upload_01', source: 'upload', path: 'assets/a.png' });
assert.equal(upload.origin, 'user_upload');
assert.equal(upload.requirement, 'preferred');
assert.equal(upload.evidence_class, 'user_supplied');

const generated = normalizeVisualAsset({ id: 'gen_scene_01', source: 'generated', path: 'assets/g.png' });
assert.equal(generated.requirement, 'optional');
assert.equal(generated.evidence_class, 'synthetic');

const merged = mergeVisualAssetContexts(
  { status: 'ready', assets: [{ id: 'upload_01', path: 'assets/a.png', title: '旧标题' }] },
  { status: 'ready', assets: [{ id: 'upload_01', title: '新标题' }, generated] },
);
assert.equal(merged.assets.length, 2);
assert.equal(merged.assets[0].path, 'assets/a.png');
assert.equal(merged.assets[0].title, '新标题');
assert.throws(() => normalizeVisualAsset({ id: 'bad', origin: 'unknown' }), /素材来源/);
assert.throws(() => normalizeVisualAsset({ id: 'crop', origin: 'derived' }), /父素材/);
```

- [x] **Step 2: 验证 RED**

Run: `node tests/test-visual-asset-contract.js`

Expected: FAIL，模块不存在。

- [x] **Step 3: 最小实现**

实现并导出：

```js
const ORIGINS = new Set(['user_upload', 'source_extract', 'page_capture', 'ai_generated', 'stock_search', 'derived']);
const REQUIREMENTS = new Set(['required', 'preferred', 'optional']);
const EVIDENCE_CLASSES = new Set(['direct_source', 'user_supplied', 'synthetic', 'contextual', 'derived_source']);
const LEGACY = {
  upload: { origin: 'user_upload', origin_detail: 'creative_input', evidence_class: 'user_supplied', requirement: 'preferred' },
  article: { origin: 'source_extract', origin_detail: 'article_embedded', evidence_class: 'direct_source', requirement: 'optional' },
  github_readme: { origin: 'source_extract', origin_detail: 'github_readme', evidence_class: 'direct_source', requirement: 'optional' },
  generated: { origin: 'ai_generated', origin_detail: 'scene_main_visual', evidence_class: 'synthetic', requirement: 'optional' },
  search: { origin: 'stock_search', origin_detail: 'pexels', evidence_class: 'contextual', requirement: 'optional' },
};

function normalizeVisualAsset(input = {}) {
  const id = String(input.id || input.asset_id || '').trim();
  if (!id) throw new Error('视觉素材缺少 id。');
  const legacy = LEGACY[String(input.source || '').trim()] || {};
  const origin = String(input.origin || legacy.origin || '').trim();
  const requirement = String(input.requirement || legacy.requirement || 'optional').trim();
  const evidenceClass = String(input.evidence_class || legacy.evidence_class || '').trim();
  if (!ORIGINS.has(origin)) throw new Error(`视觉素材 ${id} 的素材来源无效。`);
  if (!REQUIREMENTS.has(requirement)) throw new Error(`视觉素材 ${id} 的使用约束无效。`);
  if (!EVIDENCE_CLASSES.has(evidenceClass)) throw new Error(`视觉素材 ${id} 的证据类型无效。`);
  if (origin === 'derived' && !String(input.parent_asset_id || '').trim()) throw new Error(`衍生素材 ${id} 缺少父素材。`);
  return {
    ...input,
    id,
    media_type: String(input.media_type || input.type || 'image').trim(),
    origin,
    origin_detail: String(input.origin_detail || legacy.origin_detail || '').trim(),
    provider: String(input.provider || '').trim(),
    requirement,
    evidence_class: evidenceClass,
    status: String(input.status || 'ready').trim(),
  };
}

function mergeVisualAssets(...lists) {
  const order = [];
  const byId = new Map();
  for (const item of lists.flat()) {
    const normalized = normalizeVisualAsset(item);
    if (!byId.has(normalized.id)) order.push(normalized.id);
    const defined = Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined && value !== ''));
    byId.set(normalized.id, { ...(byId.get(normalized.id) || {}), ...defined });
  }
  return order.map(id => byId.get(id));
}

function mergeVisualAssetContexts(base = {}, incoming = {}) {
  return {
    ...base,
    ...incoming,
    status: incoming.status || base.status || 'empty',
    assets: mergeVisualAssets(base.assets || [], incoming.assets || []),
    diagnostics: [...(base.diagnostics || []), ...(incoming.diagnostics || [])],
  };
}
```

保留旧 `source` 字段供旧消费方兼容，但所有新逻辑读取正式字段。

- [x] **Step 4: 验证 GREEN**

Run: `node tests/test-visual-asset-contract.js`

Expected: PASS。

- [x] **Step 5: 规格 Review、质量 Review、修复和提交**

Run: `node tests/test-visual-asset-contract.js && node tests/test-creative-context.js`

Commit: `功能：建立统一视觉素材契约`

### Task 2: 现有来源与 AI 生图统一写入且不覆盖

**Files:**
- Modify: `server/services/creative/creativeSourcePrep.js`
- Modify: `server/services/source/sourceAssets.js`
- Modify: `server/services/creative-video/html-video/generatedImagePhase.js`
- Modify: `server/services/creative-video/html-video/assetUsagePhase.js`
- Modify: `tests/test-source-assets.js`
- Modify: `tests/test-creative-workflows.js`
- Modify: `tests/test-generated-image-phase.js`
- Modify: `tests/test-html-video-project-store.js`

- [x] **Step 1: 写失败测试**

断言：

```js
assert.equal(article.origin, 'source_extract');
assert.equal(article.evidence_class, 'direct_source');
assert.equal(search.origin, 'stock_search');
assert.equal(search.requirement, 'optional');
assert.equal(generated.origin, 'ai_generated');
assert.equal(generated.evidence_class, 'synthetic');
assert.deepEqual(result.asset_context.assets.map(item => item.id), ['upload_01', 'article_01']);
assert.equal(roundTrippedProject.assets[0].origin, 'user_upload');
```

- [x] **Step 2: 验证 RED**

Run: `node tests/test-source-assets.js && node tests/test-creative-workflows.js && node tests/test-generated-image-phase.js && node tests/test-html-video-project-store.js`

Expected: 新正式字段或上传素材保留断言失败。

- [x] **Step 3: 最小实现**

- `prepareSourceAssetContext()` 使用 `mergeVisualAssetContexts(record.asset_context, prepared)`；无来源内容时只更新 summary/status，不清空既有资产。
- `sourceAssets` 为文章/GitHub README/Pexels 填充正式字段。
- `buildGeneratedAsset()` 填充 `origin:'ai_generated'`、`origin_detail:'scene_main_visual'`、`requirement:'optional'`、`evidence_class:'synthetic'`。
- `runGeneratedImagePhase()` 和 hydrate 使用统一 merge。
- `projectAssetsFromCreativeContext()` 保留 `media_type/origin/origin_detail/provider/requirement/evidence_class/status/parent_asset_id/mime/bytes/width/height/created_at`。

- [x] **Step 4: 验证 GREEN**

运行 Step 2 四条测试，Expected: PASS。

- [x] **Step 5: 双 Review、修复和提交**

Commit: `功能：统一现有视觉素材写入协议`

### Task 3: 上传暂存和任务创建时认领

**Files:**
- Create: `server/services/creative/visualAssetUploads.js`
- Modify: `server/routes/creativeWorkflows.js`
- Modify: `server/services/creative/creativeContext.js`
- Modify: `server/services/creative/creativeWorkflows.js`
- Create: `tests/test-creative-workflow-upload-assets.js`
- Modify: `tests/test-creative-workflow-routes.js`

- [ ] **Step 1: 写失败测试**

覆盖：PNG/JPEG/WebP；非图片拒绝；超过 8MB 在读取时拒绝；文件名净化；默认 preferred；required 保留；同一暂存 ID 只能认领一次；任务创建响应立即含上传图；来源阶段不覆盖。

```js
const staged = await uploads.stageVisualAsset({
  stream: Readable.from(Buffer.from('fake-png')),
  fileName: '../主页.png',
  mime: 'image/png',
  requirement: 'required',
  rootDir: uploadRoot,
});
assert.equal(staged.asset.requirement, 'required');

const claimed = await uploads.claimVisualAssets({
  uploadIds: [staged.upload_id],
  targetDir,
  rootDir: uploadRoot,
});
assert.equal(claimed.assets[0].origin, 'user_upload');
await assert.rejects(() => uploads.claimVisualAssets({ uploadIds: [staged.upload_id], targetDir, rootDir: uploadRoot }), /已认领/);
```

- [ ] **Step 2: 验证 RED**

Run: `node tests/test-creative-workflow-upload-assets.js`

Expected: FAIL，上传服务不存在。

- [ ] **Step 3: 最小实现上传服务**

只使用 Node 标准库：

```js
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const UPLOAD_ID_PATTERN = /^upload_[a-z0-9_-]{8,80}$/;
```

`stageVisualAsset()` 必须逐 chunk 统计字节并写入 `<root>/<upload_id>/source.<ext>`；超过限制立即销毁写流、删除目录并抛出中文错误。随后原子写入 `upload.json`，内容固定为 `upload_id/file_name/mime/bytes/requirement/status:'staged'/created_at`。

`claimVisualAssets()` 必须先验证全部 ID 和全部 manifest 均为 staged，再逐个复制到任务 `assets/`，成功后把 manifest 原子更新为 `status:'claimed'` 和 `workflow_id`；任一预检失败不得移动任何文件。返回资产使用正式 `user_upload/creative_input/local/user_supplied` 字段。

`removeStagedVisualAsset()` 只允许删除 `status:'staged'` 的目录，claimed 返回中文冲突错误。

暂存目录位于数据根下的 `creative-asset-uploads`，不写进仓库。

- [ ] **Step 4: 接入路由和工作流**

- `POST /api/creative-workflows/assets/uploads`：请求体为原始 File，读取 `Content-Type`、`X-File-Name`、`X-Asset-Requirement`；返回中文状态和 `upload_id`。
- `DELETE /api/creative-workflows/assets/uploads/:uploadId`：删除未认领暂存。
- `normalizeCreativeInput()` 接受去重后的 `assetIds`，拒绝非法 ID，不再返回“暂不支持”。
- `createCreativeWorkflow()` 在生成 `workflowId/awemeId` 后认领文件并用其构造初始 `asset_context`；认领失败不启动后台任务。

- [ ] **Step 5: 验证路由和工作流**

Run: `node tests/test-creative-workflow-upload-assets.js && node tests/test-creative-workflow-routes.js && node tests/test-creative-context.js && node tests/test-creative-workflows.js`

Expected: PASS。

- [ ] **Step 6: 双 Review、修复和提交**

Commit: `功能：支持创作图片暂存与任务认领`

### Task 4: 创作输入区上传 UI 与 loading

**Files:**
- Modify: `frontend-react/src/api/client.js`
- Modify: `frontend-react/src/components/creative/CreativeComposer.jsx`
- Modify: `frontend-react/src/pages/OneClickCreativePage.jsx`
- Create: `tests/test-creative-upload-ui.mjs`

- [ ] **Step 1: 写失败静态与状态测试**

断言存在：`accept="image/png,image/jpeg,image/webp"`、缩略图、“必须使用”文字控件、删除按钮、上传期间中文 loading、上传/创建期间禁用和 `assetIds` 真实传入。

- [ ] **Step 2: 验证 RED**

Run: `node tests/test-creative-upload-ui.mjs`

Expected: FAIL，上传 UI 不存在。

- [ ] **Step 3: 最小实现 API**

```js
async uploadCreativeVisualAsset(file, requirement = 'preferred') {
  return requestRaw('/api/creative-workflows/assets/uploads', {
    method: 'POST',
    headers: { 'Content-Type': file.type, 'X-File-Name': file.name, 'X-Asset-Requirement': requirement },
    body: file,
  });
}
```

- [ ] **Step 4: 最小实现 UI**

- 使用隐藏 `<input type="file" multiple>` 和现有 `Button/Checkbox`；不新增依赖。
- 单图上传状态：`uploading/ready/failed`；loading 文案“正在上传图片…”；失败保留中文可操作提示。
- required 切换在上传前后均更新；删除已暂存图片调用 DELETE。
- `submitDisabled` 在任一上传中为 true；创建请求传 `assetIds: uploadedAssets.map(item => item.upload_id)`。

- [ ] **Step 5: 验证**

Run: `node tests/test-creative-upload-ui.mjs && npm run build:frontend`

Expected: PASS / build success。

- [ ] **Step 6: 双 Review、修复和提交**

Commit: `界面：增加创作图片上传与必须使用控件`

### Task 5: 素材面板展示正式协议

**Files:**
- Modify: `frontend-react/src/components/creative/SourceImageAssetsPanel.jsx`
- Modify: `tests/test-creative-task-detail-assets.mjs`

- [ ] **Step 1: 写失败测试**

断言按 `origin` 分组并展示“用户上传/来源提取/页面截图/AI 生图/图库补图/衍生素材”、“必须使用/优先使用/可选”、“来源证据/用户提供/AI 合成/情境素材/来源派生”。旧 `source` 仍可回退。

- [ ] **Step 2: 验证 RED**

Run: `node tests/test-creative-task-detail-assets.mjs`

Expected: 新文案和正式字段断言失败。

- [ ] **Step 3: 最小实现与 GREEN**

只更新现有映射与 Card 元数据，不新增面板体系；运行 Step 2 和 `npm run build:frontend`。

- [ ] **Step 4: 双 Review、修复和提交**

Commit: `界面：展示统一视觉素材来源与约束`

### Task 6: 页面截图和衍生素材 producer

**Files:**
- Create: `server/services/creative/pageCaptureAssets.js`
- Create: `server/services/creative/derivedVisualAssets.js`
- Modify: `server/services/creative/creativeSourcePrep.js`
- Create: `tests/test-page-capture-assets.js`
- Create: `tests/test-derived-visual-assets.js`

- [ ] **Step 1: 写失败测试**

- GitHub 仓库来源允许登记 `page_capture/github_repository_page/chromium/direct_source/optional`。
- 非允许页面不自动截图。
- 截图失败只产生 diagnostic，不伪造素材。
- derived 必须引用存在父素材并继承证据来源，输出 `derived/derived_source/optional`。

- [ ] **Step 2: 验证 RED**

Run: `node tests/test-page-capture-assets.js && node tests/test-derived-visual-assets.js`

Expected: FAIL，producer 不存在。

- [ ] **Step 3: 最小实现**

复用项目已有 Playwright/Chromium 可执行文件发现与页面加载安全边界；第一版仅支持 GitHub 仓库页面截图，不硬编码目标区域选择器。衍生模块只提供受控文件登记，不实现编辑器裁剪 UI。

- [ ] **Step 4: 接入来源阶段并验证**

成功结果通过 `mergeVisualAssetContexts()` 追加；失败 diagnostic 与现有素材并存。

Run: `node tests/test-page-capture-assets.js && node tests/test-derived-visual-assets.js && node tests/test-creative-workflows.js`

- [ ] **Step 5: 双 Review、修复和提交**

Commit: `功能：统一登记页面截图与衍生素材`

### Task 7: requirement 语义与 Phase B 门禁

**Files:**
- Modify: `server/services/creative-video/html-video/assetUsagePhase.js`
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Modify: `tests/test-html-video-asset-usage.js`
- Modify: `tests/test-html-video-workflow.js`
- Modify: `docs/superpowers/plans/2026-07-16-asset-first-delivery-ledger.md`

- [ ] **Step 1: 写失败测试**

```js
assert.deepEqual(report.required_asset_ids, ['upload_required']);
assert.ok(!report.required_asset_ids.includes('gen_scene_01'));
assert.ok(!report.required_asset_ids.includes('search_01'));
assert.deepEqual(report.missing_required_asset_ids, ['upload_required']);
```

同时断言 preferred/optional 未使用不阻断、正式字段写入 usage report、旧任务缺少 `requirement` 时保持兼容但不把全部自动素材升级为 required。

- [ ] **Step 2: 验证 RED**

Run: `node tests/test-html-video-asset-usage.js && node tests/test-html-video-workflow.js`

Expected: 当前 generated/content graph 被错误标为 required，测试失败。

- [ ] **Step 3: 最小实现**

`requiredAssetRefsById()` 只把 `asset.requirement==='required'` 的资产加入 required map；content graph 仅提供 expected scene/usage，不改变 requirement。Shot/Caption/正数可见时长门在 Phase C 有稳定 Image Sequence Plan 后补齐，本任务不伪造 HTML 可见性。

- [ ] **Step 4: 验证 Phase B**

Run:

```text
node tests/test-visual-asset-contract.js
node tests/test-source-assets.js
node tests/test-generated-image-phase.js
node tests/test-creative-workflow-upload-assets.js
node tests/test-creative-workflow-routes.js
node tests/test-creative-workflows.js
node tests/test-creative-upload-ui.mjs
node tests/test-creative-task-detail-assets.mjs
node tests/test-page-capture-assets.js
node tests/test-derived-visual-assets.js
node tests/test-html-video-asset-usage.js
node tests/test-html-video-workflow.js
npm run build:frontend
```

Expected: 全部 PASS。

- [ ] **Step 5: 双 Review、更新 Ledger、修复和提交**

Commit: `功能：按用户约束执行视觉素材门禁`

Phase B 完成后，Coordinator 立即生成并执行 Phase C 多图编排计划，不返回用户确认。
