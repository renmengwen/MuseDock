# html-video Frame Project Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 html-video 生成、编辑、预览、重新生成和导出统一收敛到结构化 `project.frames[]` 数据契约，确保 raw_html/template_inputs 两种帧都可二次编辑、可稳定补字幕、可导出一致结果。

**Architecture:** `project.frames[]` 是可编辑源数据，`frame.html_path` 指向当前可渲染 HTML 产物。所有入口先 normalize/validate，所有预览和导出先通过 materializer 确认 HTML 与结构化数据同步，再交给渲染 adapter。

**Tech Stack:** Node.js CommonJS services, React editor components, Playwright/ffmpeg html-video renderer, plain Node test scripts.

---

## 背景

当前项目还未上线，历史兼容成本低，适合一次性收紧 html-video 的数据契约。参考 `D:\code3\html-video` 后，本项目不需要同步完整 monorepo/studio/CLI 架构，但需要同步其核心模式：

- `Project` 管视频工程状态。
- `FrameRecord` 管每帧结构化源数据。
- HTML 文件是可渲染产物，不是唯一真相。
- Renderer/adapter 只消费已解析好的帧渲染源。
- 字幕应该是结构化字段，再由 materializer 渲染为画面层。

本计划覆盖两层改造：

- 第一层：稳定性地基，必须做。
- 第二层：长期可维护性，建议现在同步核心边界。

## 非目标

本计划不做以下事情：

- 不迁移为 `D:\code3\html-video` 的 pnpm monorepo。
- 不引入其完整 CLI/studio/agent runtime 选择。
- 不实现 Remotion native enhancement 全套能力。
- 不做 forced alignment 或逐字字幕对齐。
- 不改变现有 MediaCrawler-GUI 的一键创作主流程入口。

## Review 修订决策

已根据外部 review 调整本计划，结论如下：

- 接受 B1：现有 `tests/test-html-video-project-schema.js` 断言缺失 `graph_node_id` 时输出 `null`。本计划的新契约要求 `graph_node_id` 兜底为稳定 frame id，因此实现前必须同步更新旧测试断言。
- 接受 B2：captions 规范化不能并存三套实现。后续以 `captionLayer.js` 为唯一 captions 规范化来源，`rawHtmlFrameBuilder.normalizeCaptions` 删除或仅作为兼容 re-export，不再保留独立逻辑。
- 接受 B3：`materializeProject()` 不应在 raw_html-only 工程中强制要求 `templateRegistry`。改造后只有遇到 `template_inputs` 帧时才要求 registry；raw_html 帧可在无 registry 时只做路径规范和字幕层修补。
- 接受 I1：`frame_patch` 同时包含 `duration_sec`、`captions`、`metadata_patch` 时不能因 duration early return 丢失后续字段，测试必须覆盖组合 patch。
- 接受 I2：`ensureCaptionLayer()` 不能只检测到已有字幕层就直接跳过，否则字幕编辑后 HTML 会保留旧字幕。新的设计是替换受管 caption layer，第三方/模板自带字幕层仅在明确非受管时保留并记录诊断。
- 部分接受 I3：`template.id`、`template.engine` 对当前 `hyperframesPlaywrightAdapter` 是额外元数据，不影响其读取 `sourcePath`；文档补充说明 adapter 输入仍以 `sourcePath` 为必要字段。
- 接受 I4：raw_html `data-text-key` 校验需要读磁盘文件。该校验只在 `projectDir + html_path` 可解析且文件存在时执行，文件缺失只产生已有 missing file 诊断，不因锚点校验抛错。
- 接受 I5：前端 `CaptionsPanel` 当前保存 project 顶层 `captions`，改造时必须传入 selected frame，并保存为 `frame_patch`。

## 目标数据契约

所有 html-video project 进入编辑、预览、重新生成、导出前都必须满足：

```js
{
  project_id: 'string',
  workflow_id: 'string|null',
  run_id: 'string|null',
  template_id: 'string|null',
  template_inputs: {},
  output: {
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    duration: 0
  },
  frames: [
    {
      id: 'scene_01',
      scene_id: 'scene_01',
      graph_node_id: 'scene_01',
      order: 1,
      engine: 'hyperframes-playwright',
      source_mode: 'raw_html',
      html_path: 'frames/01-scene_01.html',
      preview_mp4_path: null,
      template_id: null,
      duration_sec: 6,
      inputs: {},
      narration_text: '这一帧的旁白。',
      captions: [
        {
          id: 'scene_01_caption_01',
          start: 0,
          end: 6,
          duration: 6,
          text: '这一帧的旁白。'
        }
      ],
      metadata: {
        frame_intent: 'text',
        visual_text: {
          headline: '主标题',
          subtitle: '副标题',
          body: '正文'
        },
        graph_node: {}
      },
      transition_in: { type: 'cut', duration_sec: 0, params: {} },
      transition_out: { type: 'cut', duration_sec: 0, params: {} },
      trim: { in_sec: 0, out_sec: null },
      speed: 1,
      loop: false,
      enhancement: {
        enabled: false,
        engine: null,
        template_id: null,
        data: null,
        preview_mp4_path: null
      }
    }
  ],
  timeline: {
    tracks: [
      { id: 'main', type: 'video', items: [] },
      { id: 'voice', type: 'audio', items: [] },
      { id: 'music', type: 'audio', items: [] }
    ]
  }
}
```

规则：

- `frames[].id`、`scene_id`、`graph_node_id` 至少有一个输入来源，normalize 后三者都稳定存在。
- 旧测试里“缺失 `graph_node_id` 输出 `null`”的行为不再保留；新契约要求缺失时输出稳定 frame id，相关测试需要同步改断言。
- `order` 使用 1-based 顺序，前端展示和 timeline 写入保持一致。
- `duration_sec` 必须大于 0。
- `narration_text` 必须是字符串，可以为空。
- `captions` 必须是数组；为空且 `narration_text` 非空时，从旁白生成整帧字幕。
- `source_mode` 只能是 `raw_html` 或 `template_inputs`。
- `raw_html` 帧必须有 `html_path`，且路径不能逃逸 project 目录。
- `template_inputs` 帧可以没有 `html_path`，materializer 负责生成。
- `metadata.visual_text` 是标题、副标题、正文等可编辑视觉文案的结构化来源。

## raw_html HTML 契约

AI 生成的 raw HTML 必须提供可编辑文本锚点。最小要求：

```html
<h1 data-text-key="headline">主标题</h1>
<p data-text-key="subtitle">副标题</p>
<p data-text-key="body">正文内容</p>
```

字幕层由 materializer 统一保证，raw HTML 可以自带，但不得缺失最终字幕出口：

```html
<div data-hv-layer="captions" data-role="subtitle-caption">
  <div data-caption-id="scene_01_caption_01" data-start="0" data-end="6">字幕文本</div>
</div>
```

如果 AI 输出没有字幕层，materializer 注入固定 caption layer。如果 AI 输出没有 `data-text-key`，validation 记录诊断；能从 `metadata.visual_text` 找到文本时，repair 阶段补齐最小锚点，否则返回可见警告并允许导出。

## 文件结构

### 后端核心

- Modify: `server/services/creative-video/html-video/projectSchema.js`
  - 强化 `normalizeFrame()`、`normalizeProject()`。
  - 增加 captions 兜底、稳定 id/order/source_mode/html_path。

- Modify: `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`
  - 使用 `captionLayer.js` 的统一 captions 规范。
  - 删除本文件内独立 `normalizeCaptions()` 逻辑，或改为兼容 re-export 到 `captionLayer.normalizeCaptionsForFrame()`。
  - raw_html 写盘前注入固定 caption layer。
  - 输出 frame 时保证目标契约完整。

- Modify: `server/services/creative-video/html-video/materializer.js`
  - raw_html/template_inputs 都从结构化 frame 生成或修补 HTML。
  - 导出前可重复执行，保证幂等。
  - `templateRegistry` 只对 `template_inputs` 帧必需；raw_html-only 工程不能因为缺少 registry 失败。

- Create: `server/services/creative-video/html-video/frameRenderSource.js`
  - 提供 `resolveFrameRenderSource()`。
  - 统一 preview/export/render 的 frame 解析逻辑。

- Create: `server/services/creative-video/html-video/captionLayer.js`
  - 提供 `normalizeCaptionsForFrame()`、`renderCaptionLayer()`、`ensureCaptionLayer()`。
  - 固定字幕层结构，不再散落字符串注入。

- Modify: `server/services/creative-video/html-video/editPatchService.js`
  - `frame_patch` 支持 `captions`。
  - 将标题、旁白、字幕、时长、inputs 合并到 frame 维度。

- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
  - 生成 prompt 强制 `data-text-key` 和 captions。
  - 自然语言编辑 prompt 收敛到 `frame_patch`。

- Modify: `server/services/creativeWorkflows.js`
  - 导出前强制 materialize。
  - project patch 后触发 raw_html 文本同步。

- Modify: `server/services/creative-video/html-video/projectOrchestrator.js`
  - 导出和单帧渲染改用 `resolveFrameRenderSource()`。

- Modify: `server/services/creative-video/html-video/frameRenderer.js`
  - 不再自己猜 `html_path/htmlPath/sourcePath`，消费 frame render source。

### 前端编辑

- Modify: `frontend-react/src/components/creative-video-editor/FrameInputsPanel.jsx`
  - 保存统一提交 `frame_patch`。
  - 包含 `duration_sec`、`narration_text`、`metadata_patch.visual_text`、`inputs`。

- Modify: `frontend-react/src/components/creative-video-editor/CaptionsPanel.jsx`
  - 明确保存到当前 frame 的 `captions`，而不是只保存 project 顶层字幕。
  - 增加 `selectedFrameId` 入参；无选中帧时禁用保存并展示中文状态。

- Modify: `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx`
  - 传递 selected frame captions。
  - 不再传 `editor.project?.captions || []` 给 `CaptionsPanel`；改为传当前 `selectedFrame.captions || []` 和 `selectedFrame.id`。
  - 重新生成 HTML 和导出按钮期间展示明确 loading 状态。

- Modify: `frontend-react/src/components/creative-video-editor/ProjectFramesList.jsx`
  - 展示 `metadata.visual_text.headline`、`duration_sec`、字幕状态。

### 测试

- Modify: `tests/test-html-video-project-schema.js`
- Modify: `tests/test-html-video-raw-html-frame-builder.js`
- Modify: `tests/test-html-video-materializer.js`
- Modify: `tests/test-html-video-edit-patch-service.js`
- Modify: `tests/test-html-video-frame-renderer.js`
- Modify: `tests/test-html-video-project-orchestrator-modes.js`
- Modify: `tests/test-html-video-workflow.js`
- Create: `tests/test-html-video-frame-render-source.js`
- Create: `tests/test-html-video-caption-layer.js`
- Optional Modify: `tests/test-html-video-real-render-smoke.js`

## Implementation Tasks

### Task 1: 固化 frame/project schema

**Files:**
- Modify: `server/services/creative-video/html-video/projectSchema.js`
- Modify: `tests/test-html-video-project-schema.js`

- [ ] **Step 1: 写 schema 失败测试**

先更新 `tests/test-html-video-project-schema.js` 中旧断言：当输入 frame 没有 `graph_node_id` 时，不再断言输出为 `null`，改为断言输出兜底为 `id`。然后增加用例：

```js
{
  const project = normalizeProject({
    project_id: 'wf_run',
    frames: [
      {
        id: 'scene_01',
        source_mode: 'raw_html',
        html_path: 'frames/01-scene_01.html',
        duration_sec: 4,
        narration_text: '第一帧旁白。',
        metadata: {
          visual_text: { headline: '标题一' },
        },
      },
    ],
  });

  assert.equal(project.frames[0].id, 'scene_01');
  assert.equal(project.frames[0].scene_id, 'scene_01');
  assert.equal(project.frames[0].graph_node_id, 'scene_01');
  assert.equal(project.frames[0].order, 1);
  assert.equal(project.frames[0].source_mode, 'raw_html');
  assert.equal(project.frames[0].duration_sec, 4);
  assert.equal(project.frames[0].captions.length, 1);
  assert.equal(project.frames[0].captions[0].text, '第一帧旁白。');
  assert.equal(project.frames[0].captions[0].start, 0);
  assert.equal(project.frames[0].captions[0].end, 4);
  assert.equal(project.frames[0].metadata.visual_text.headline, '标题一');
}
```

旧用例中的断言应从：

```js
assert.equal(normalized.frames[0].graph_node_id, null);
```

改为：

```js
assert.equal(normalized.frames[0].graph_node_id, normalized.frames[0].id);
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node tests\test-html-video-project-schema.js
```

Expected: FAIL，缺失 `scene_id`、`graph_node_id`、captions 兜底或 order 默认行为。

- [ ] **Step 3: 实现 normalize 规则**

在 `projectSchema.js` 中实现或调整。注意：captions 规范化来自 `captionLayer.js`，不要在 `projectSchema.js` 再写一套独立实现。如果按顺序执行时 `captionLayer.js` 尚不存在，先完成 Task 2 Step 3 的 `normalizeCaptionsForFrame()`。

```js
const { normalizeCaptionsForFrame } = require('./captionLayer');

function normalizeFrame(input = {}, index = 0) {
  const id = String(input.id || input.scene_id || input.graph_node_id || `frame_${index + 1}`).trim();
  const duration = Number(input.duration_sec ?? input.durationSec ?? input.duration);
  const durationSec = Number.isFinite(duration) && duration > 0 ? duration : 3;
  const narrationText = String(input.narration_text || input.narrationText || '');
  const captions = normalizeCaptionsForFrame({
    id,
    duration_sec: durationSec,
    narration_text: narrationText,
    captions: input.captions,
  });

  return {
    id,
    scene_id: String(input.scene_id || id),
    graph_node_id: String(input.graph_node_id || input.graphNodeId || input.scene_id || id),
    order: Number.isFinite(Number(input.order)) && Number(input.order) > 0 ? Number(input.order) : index + 1,
    template_id: input.template_id || input.templateId || null,
    engine: input.engine || 'hyperframes-playwright',
    source_mode: input.source_mode === 'raw_html' ? 'raw_html' : 'template_inputs',
    html_path: input.html_path || input.htmlPath || null,
    preview_mp4_path: input.preview_mp4_path || input.previewMp4Path || null,
    duration_sec: durationSec,
    inputs: objectOrEmpty(input.inputs),
    narration_text: narrationText,
    captions,
    metadata: {
      ...objectOrEmpty(input.metadata),
      visual_text: objectOrEmpty(objectOrEmpty(input.metadata).visual_text),
    },
    transition_in: input.transition_in || { type: 'cut', duration_sec: 0, params: {} },
    transition_out: input.transition_out || { type: 'cut', duration_sec: 0, params: {} },
    trim: input.trim || { in_sec: 0, out_sec: null },
    speed: Number.isFinite(Number(input.speed)) && Number(input.speed) > 0 ? Number(input.speed) : 1,
    loop: input.loop === true,
    enhancement: {
      enabled: input.enhancement?.enabled === true,
      engine: input.enhancement?.engine || null,
      template_id: input.enhancement?.template_id || null,
      data: input.enhancement?.data ?? null,
      preview_mp4_path: input.enhancement?.preview_mp4_path || null,
    },
  };
}
```

- [ ] **Step 4: 运行 schema 测试确认通过**

Run:

```powershell
node tests\test-html-video-project-schema.js
```

Expected: PASS。

### Task 2: 新增固定 caption layer

**Files:**
- Create: `server/services/creative-video/html-video/captionLayer.js`
- Create: `tests/test-html-video-caption-layer.js`
- Modify: `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`
- Modify: `server/services/creative-video/html-video/materializer.js`

- [ ] **Step 0: 移除 captions 规范化重复实现**

`captionLayer.js` 是唯一 captions 规范化来源。处理方式二选一：

- 删除 `rawHtmlFrameBuilder.js` 中独立 `normalizeCaptions(scene, durationSec)`，改为从 `captionLayer.js` import。
- 如果旧测试仍引用 `rawHtmlFrameBuilder.normalizeCaptions`，则保留同名导出，但实现必须转调 `normalizeCaptionsForFrame()`，不能保留第二套逻辑。

兼容导出示例：

```js
const { ensureCaptionLayer, normalizeCaptionsForFrame } = require('./captionLayer');

function normalizeCaptions(scene = {}, durationSec) {
  return normalizeCaptionsForFrame({
    id: scene.id,
    duration_sec: durationSec,
    narration_text: scene.narration_text,
    captions: scene.captions,
  });
}
```

- [ ] **Step 1: 写 caption layer 测试**

新增 `tests/test-html-video-caption-layer.js`：

```js
const assert = require('assert');
const { ensureCaptionLayer, renderCaptionLayer } = require('../server/services/creative-video/html-video/captionLayer');

const captions = [{ id: 'c1', start: 0, end: 3, text: '字幕文本' }];

{
  const layer = renderCaptionLayer(captions);
  assert.match(layer, /data-hv-layer="captions"/);
  assert.match(layer, /data-role="subtitle-caption"/);
  assert.match(layer, /data-caption-id="c1"/);
  assert.match(layer, /字幕文本/);
}

{
  const html = '<html><body><main>画面</main></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.match(next, /data-hv-layer="captions"/);
  assert.match(next, /字幕文本/);
  assert.match(next, /<\/body>/);
}

{
  const html = '<html><body><div data-hv-layer="captions">已有字幕</div></body></html>';
  const next = ensureCaptionLayer(html, captions);
  assert.equal((next.match(/data-hv-layer="captions"/g) || []).length, 1);
  assert.match(next, /字幕文本/);
  assert.doesNotMatch(next, /已有字幕/);
}

console.log('html-video caption layer tests passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node tests\test-html-video-caption-layer.js
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 captionLayer.js**

新增 `server/services/creative-video/html-video/captionLayer.js`：

```js
function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeCaptionsForFrame(frame = {}) {
  const durationSec = Number(frame.duration_sec || frame.durationSec || 3);
  const safeDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 3;
  const existing = Array.isArray(frame.captions) ? frame.captions : [];
  const captions = existing
    .filter(caption => caption && String(caption.text || '').trim())
    .map((caption, index) => {
      const start = Number(caption.start ?? caption.start_sec ?? 0);
      const end = Number(caption.end ?? caption.end_sec ?? safeDuration);
      const safeStart = Number.isFinite(start) && start >= 0 ? start : 0;
      const safeEnd = Number.isFinite(end) && end > safeStart ? end : safeDuration;
      return {
        id: String(caption.id || `${frame.id || frame.scene_id || 'frame'}_caption_${String(index + 1).padStart(2, '0')}`),
        start: safeStart,
        end: safeEnd,
        duration: safeEnd - safeStart,
        text: String(caption.text || '').trim(),
      };
    });

  if (captions.length) return captions;
  const text = String(frame.narration_text || '').trim();
  if (!text) return [];
  return [{
    id: `${frame.id || frame.scene_id || 'frame'}_caption_01`,
    start: 0,
    end: safeDuration,
    duration: safeDuration,
    text,
  }];
}

function renderCaptionLayer(captions = [], options = {}) {
  const clean = captions.filter(caption => caption && String(caption.text || '').trim());
  if (!clean.length) return '';
  const fontSize = Number(options.fontSizePx || 34);
  const safeFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 34;
  const data = htmlEscape(JSON.stringify(clean));
  const items = clean.map(caption => (
    `<div class="hv-caption-item" data-caption-id="${htmlEscape(caption.id)}" data-start="${htmlEscape(caption.start)}" data-end="${htmlEscape(caption.end)}">${htmlEscape(caption.text)}</div>`
  )).join('');
  return [
    '<style data-hv-layer-style="captions">',
    '.hv-caption-layer{position:absolute;left:0;right:0;bottom:42px;display:flex;justify-content:center;pointer-events:none;z-index:9999;letter-spacing:0;}',
    `.hv-caption-box{max-width:84%;padding:14px 22px;border-radius:8px;background:rgba(0,0,0,.68);color:#fff;font:600 ${safeFontSize}px/1.28 "Noto Sans SC","Microsoft YaHei",Arial,sans-serif;text-align:center;text-shadow:0 2px 8px rgba(0,0,0,.55);}`,
    '.hv-caption-item{display:none;}',
    '.hv-caption-item:first-child{display:block;}',
    '</style>',
    `<div class="hv-caption-layer" data-hv-layer="captions" data-hv-managed="true" data-role="subtitle-caption" data-captions-json="${data}">`,
    `<div class="hv-caption-box" data-text-key="subtitle">${items}</div>`,
    '</div>',
  ].join('');
}

function ensureCaptionLayer(html, captions = []) {
  if (!captions.length) {
    return html;
  }
  const layer = renderCaptionLayer(captions);
  if (!layer) return html;
  const managedLayerPattern = /<style\b[^>]*data-hv-layer-style=["']captions["'][\s\S]*?<\/style>\s*<div\b[^>]*data-hv-layer=["']captions["'][\s\S]*?<\/div>\s*<\/div>/i;
  if (managedLayerPattern.test(html)) {
    return html.replace(managedLayerPattern, layer);
  }
  if (/data-hv-layer=["']captions["']|data-role=["']subtitle-caption["']/i.test(html)) {
    return html;
  }
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${layer}</body>`);
  return `${html}${layer}`;
}

module.exports = {
  ensureCaptionLayer,
  normalizeCaptionsForFrame,
  renderCaptionLayer,
};
```

- [ ] **Step 4: 接入 rawHtmlFrameBuilder/materializer**

将 `rawHtmlFrameBuilder.js` 和 `materializer.js` 中直接注入字幕字符串的逻辑替换为：

```js
const { ensureCaptionLayer, normalizeCaptionsForFrame } = require('./captionLayer');
```

写 HTML 前使用：

```js
const captions = normalizeCaptionsForFrame(frame);
frame.captions = captions;
const nextHtml = ensureCaptionLayer(html, captions);
```

- [ ] **Step 5: 运行相关测试**

Run:

```powershell
node tests\test-html-video-caption-layer.js
node tests\test-html-video-raw-html-frame-builder.js
node tests\test-html-video-materializer.js
```

Expected: PASS。

### Task 3: 统一 frame render source 解析

**Files:**
- Create: `server/services/creative-video/html-video/frameRenderSource.js`
- Create: `tests/test-html-video-frame-render-source.js`
- Modify: `server/services/creative-video/html-video/frameRenderer.js`
- Modify: `server/services/creative-video/html-video/projectOrchestrator.js`

- [ ] **Step 1: 写 render source 测试**

新增 `tests/test-html-video-frame-render-source.js`：

```js
const assert = require('assert');
const path = require('path');
const { resolveFrameRenderSource } = require('../server/services/creative-video/html-video/frameRenderSource');

const projectDir = path.resolve(__dirname, '..', 'tmp-html-video-render-source');

{
  const source = resolveFrameRenderSource({
    projectDir,
    project: { template_id: 'tpl', template_inputs: { brand: 'A' } },
    frame: {
      id: 'scene_01',
      source_mode: 'raw_html',
      html_path: 'frames/01-scene_01.html',
      duration_sec: 5,
      inputs: { tone: 'bold' },
    },
  });
  assert.equal(source.source_mode, 'raw_html');
  assert.equal(source.engine, 'hyperframes-playwright');
  assert.equal(source.duration_sec, 5);
  assert.equal(source.html_path, 'frames/01-scene_01.html');
  assert.equal(source.absolute_html_path, path.join(projectDir, 'frames', '01-scene_01.html'));
  assert.equal(source.needs_materialize, false);
}

{
  const source = resolveFrameRenderSource({
    projectDir,
    project: { template_id: 'tpl', template_inputs: { brand: 'A' } },
    frame: {
      id: 'scene_02',
      source_mode: 'template_inputs',
      duration_sec: 4,
      inputs: { headline: '标题' },
    },
  });
  assert.equal(source.source_mode, 'template_inputs');
  assert.equal(source.template_id, 'tpl');
  assert.equal(source.variables.brand, 'A');
  assert.equal(source.variables.headline, '标题');
  assert.equal(source.needs_materialize, true);
}

assert.throws(() => resolveFrameRenderSource({
  projectDir,
  project: {},
  frame: { id: 'bad', source_mode: 'raw_html', html_path: '../bad.html' },
}), /不能逃逸工程目录/);

console.log('html-video frame render source tests passed');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node tests\test-html-video-frame-render-source.js
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 frameRenderSource.js**

新增 `server/services/creative-video/html-video/frameRenderSource.js`：

```js
const path = require('path');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function resolveProjectPath(projectDir, relativePath) {
  const normalized = toPosixPath(relativePath);
  const target = path.resolve(projectDir, normalized);
  const relative = path.relative(projectDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('frame 渲染路径不能逃逸工程目录。');
  }
  return target;
}

function resolveFrameRenderSource({ projectDir, project = {}, frame = {} } = {}) {
  if (!projectDir) throw new Error('缺少 projectDir。');
  if (!frame || typeof frame !== 'object') throw new Error('缺少 frame。');

  const sourceMode = frame.source_mode === 'raw_html' ? 'raw_html' : 'template_inputs';
  const duration = Number(frame.duration_sec || frame.durationSec || 3);
  const durationSec = Number.isFinite(duration) && duration > 0 ? duration : 3;
  const templateId = frame.template_id || project.template_id || null;
  const engine = frame.engine || 'hyperframes-playwright';
  const variables = {
    ...objectOrEmpty(project.template_inputs),
    ...objectOrEmpty(frame.inputs),
  };

  if (sourceMode === 'raw_html') {
    if (!frame.html_path) throw new Error(`raw_html 帧 ${frame.id || ''} 缺少 html_path。`);
    const htmlPath = toPosixPath(frame.html_path);
    return {
      frame_id: frame.id || frame.scene_id || null,
      source_mode: sourceMode,
      engine,
      template_id: templateId,
      html_path: htmlPath,
      absolute_html_path: resolveProjectPath(projectDir, htmlPath),
      duration_sec: durationSec,
      variables,
      needs_materialize: false,
    };
  }

  return {
    frame_id: frame.id || frame.scene_id || null,
    source_mode: sourceMode,
    engine,
    template_id: templateId,
    html_path: frame.html_path ? toPosixPath(frame.html_path) : null,
    absolute_html_path: frame.html_path ? resolveProjectPath(projectDir, frame.html_path) : null,
    duration_sec: durationSec,
    variables,
    needs_materialize: true,
  };
}

module.exports = {
  resolveFrameRenderSource,
};
```

- [ ] **Step 4: 接入 frameRenderer**

在 `frameRenderer.js` 中将 source path 解析替换为：

```js
const { resolveFrameRenderSource } = require('./frameRenderSource');
```

渲染前构造：

```js
const source = resolveFrameRenderSource({ projectDir: options.projectDir || options.workDir, project: options.project || {}, frame });
```

adapter input 使用：

```js
template: {
  id: source.template_id || source.frame_id || 'frame',
  engine: source.engine,
  sourcePath: source.absolute_html_path,
},
config: {
  ...,
  duration: source.duration_sec,
}
```

说明：当前 `hyperframesPlaywrightAdapter` 的必要字段仍然是 `template.sourcePath` 和 `config.duration` 等渲染配置。`template.id`、`template.engine` 只是与 render source 对齐的元数据；如果某个 adapter 不消费它们，必须保持忽略兼容，不能让额外字段改变渲染行为。

- [ ] **Step 5: 运行测试**

Run:

```powershell
node tests\test-html-video-frame-render-source.js
node tests\test-html-video-frame-renderer.js
node tests\test-html-video-project-orchestrator-modes.js
```

Expected: PASS。

### Task 4: 导出前强制 materialize

**Files:**
- Modify: `server/services/creative-video/html-video/projectOrchestrator.js`
- Modify: `server/services/creativeWorkflows.js`
- Modify: `tests/test-html-video-project-orchestrator-modes.js`
- Modify: `tests/test-creative-workflows.js`

- [ ] **Step 1: 写导出前 materialize 测试**

在 `tests/test-html-video-project-orchestrator-modes.js` 增加用例，构造一个 raw_html project，删除 HTML 中字幕层，调用 export 前路径，断言 materializer 重新补齐：

```js
assert.ok(project.frames[0].captions.length > 0);
const html = await fs.readFile(path.join(projectDir, project.frames[0].html_path), 'utf8');
assert.match(html, /data-hv-layer="captions"|data-role="subtitle-caption"/);
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node tests\test-html-video-project-orchestrator-modes.js
```

Expected: FAIL，导出路径未统一强制 materialize。

- [ ] **Step 3: projectOrchestrator 导出前 materialize**

在 export/render project 的入口加入：

```js
const materialized = await materializeProject({
  projectDir: resolvedProjectDir,
  project: nextProject,
  templateRegistry,
});
nextProject = materialized.project;
diagnostics.push(...materialized.diagnostics);
```

注意：

- raw_html 只修补字幕层和路径规范，不覆盖原 HTML 主体。
- template_inputs 重新生成 HTML。
- `templateRegistry` 必须从现有 orchestrator 参数或 workflow 已创建的 registry 传入；如果没有 registry，raw_html-only project 仍可 materialize，只有遇到 `template_inputs` 帧才返回 `template_not_found` 或抛出明确错误。
- materialize 结果保存回 project store。

同时修改 `materializer.js` 当前入口校验：

```js
async function materializeProject({ projectDir, project, templateRegistry }) {
  if (!projectDir) {
    throw new Error('缺少 projectDir。');
  }

  const normalized = normalizeProject(project);
  const hasTemplateInputFrame = normalized.frames.some(frame => frame.source_mode !== 'raw_html');
  if (hasTemplateInputFrame && !templateRegistry) {
    throw new Error('template_inputs 帧 materialize 缺少 templateRegistry。');
  }

  // raw_html-only project 可以继续执行字幕层修补。
}
```

- [ ] **Step 4: creativeWorkflows 导出 API 前 materialize**

在 `creativeWorkflows.js` 的 html-video export/render 入口确保调用 orchestrator 的 materialize/export 统一路径，不直接拿旧 `project.frames[].html_path` 导出。`templateRegistry` 来源应使用当前 html-video workflow 已有的 registry 创建方式，例如 `createTemplateRegistry()` 或 orchestrator 初始化参数，不能在导出路径传 `undefined` 给 template_inputs 工程。

- [ ] **Step 5: 运行测试**

Run:

```powershell
node tests\test-html-video-project-orchestrator-modes.js
node tests\test-creative-workflows.js
node tests\test-html-video-routes.js
```

Expected: PASS。

### Task 5: 收敛编辑 patch 到 frame_patch

**Files:**
- Modify: `server/services/creative-video/html-video/editPatchService.js`
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Modify: `frontend-react/src/components/creative-video-editor/FrameInputsPanel.jsx`
- Modify: `frontend-react/src/components/creative-video-editor/CaptionsPanel.jsx`
- Modify: `tests/test-html-video-edit-patch-service.js`
- Modify: `tests/test-html-video-editor-components.mjs`

- [ ] **Step 1: 写 frame_patch captions 测试**

在 `tests/test-html-video-edit-patch-service.js` 增加：

```js
{
  const result = applyEditPatch(project, {
    type: 'frame_patch',
    frame_id: 'scene_01',
    narration_text: '新的旁白',
    captions: [{ id: 'c1', start: 0, end: 2, text: '新的字幕' }],
    metadata_patch: {
      visual_text: { headline: '新标题' },
    },
    duration_sec: 2,
  });

  assert.equal(result.success, true);
  const frame = result.project.frames.find(item => item.id === 'scene_01');
  assert.equal(frame.narration_text, '新的旁白');
  assert.equal(frame.captions[0].text, '新的字幕');
  assert.equal(frame.metadata.visual_text.headline, '新标题');
  assert.equal(frame.duration_sec, 2);
  assert.equal(result.requires_tts, true);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node tests\test-html-video-edit-patch-service.js
```

Expected: FAIL，`frame_patch` 未处理 captions 或 duration 合并后提前返回。

- [ ] **Step 3: 扩展 applyFramePatch**

在 `editPatchService.js` 中，`applyFramePatch()` 必须先合并所有字段，再处理时长对应的 timeline 更新，不能在 duration 分支提前 `return`。实现形态：

```js
function applyFramePatch(project, patch, flags) {
  const frame = findFrame(project, patch.frame_id);
  if (!frame) return fail(`未找到帧 ${patch.frame_id || ''}。`, 'FRAME_NOT_FOUND');

  if (Object.prototype.hasOwnProperty.call(patch, 'template_id')) {
    const templateId = String(patch.template_id || '').trim();
    if (!templateId) return fail('缺少新模板 ID。', 'TEMPLATE_ID_REQUIRED');
    frame.template_id = templateId;
  }

  if (patch.patch || patch.inputs) {
    frame.inputs = mergePatch(frame.inputs, patch.patch || patch.inputs);
  }

  if (patch.metadata_patch) {
    frame.metadata = mergeDeepPatch(frame.metadata, patch.metadata_patch);
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, 'narration_text')
    || Object.prototype.hasOwnProperty.call(patch, 'text')
  ) {
    frame.narration_text = String(patch.narration_text ?? patch.text ?? '');
    flags.requires_tts = true;
  }

  if (Array.isArray(patch.captions)) {
    frame.captions = patch.captions
      .filter(caption => caption && String(caption.text || '').trim())
      .map((caption, index) => ({
        id: String(caption.id || `${frame.id}_caption_${String(index + 1).padStart(2, '0')}`),
        start: Number(caption.start ?? caption.start_sec ?? 0),
        end: Number(caption.end ?? caption.end_sec ?? frame.duration_sec),
        duration: Number(caption.duration ?? ((caption.end ?? frame.duration_sec) - (caption.start ?? 0))),
        text: String(caption.text || '').trim(),
      }));
  }

  if (patch.duration_sec != null || patch.duration != null) {
    const error = applyDuration(project, patch);
    if (error) return error;
  }

  return null;
}
```

对应测试必须同时传入 `duration_sec`、`captions`、`metadata_patch`、`narration_text` 并断言全部保存，避免只验证 narration/duration 的旧组合测试漏掉 captions。

- [ ] **Step 4: 前端统一提交 frame_patch**

`FrameInputsPanel.jsx` 保存 payload：

```js
onSave({
  type: 'frame_patch',
  frame_id: draft.id || draft.scene_id,
  duration_sec: Number(draft.duration_sec),
  narration_text: draft.narration_text || '',
  inputs: draft.inputs || {},
  metadata_patch: {
    visual_text: {
      headline: draft.headline || '',
    },
  },
});
```

`CaptionsPanel.jsx` 保存当前帧字幕：

```js
onSave({
  type: 'frame_patch',
  frame_id: selectedFrameId,
  captions: drafts,
});
```

`CaptionsPanel.jsx` 组件签名需要调整为：

```js
export function CaptionsPanel({ captions = [], selectedFrameId, disabled, onSave }) {
  const canSave = Boolean(selectedFrameId) && !disabled;
  // ...
  return (
    <section className="creative-video-editor-panel html-video-captions">
      <h3>字幕</h3>
      {!selectedFrameId ? <p className="muted">请选择一帧后编辑字幕。</p> : null}
      <button type="button" disabled={!canSave} onClick={() => onSave({
        type: 'frame_patch',
        frame_id: selectedFrameId,
        captions: drafts,
      })}>保存字幕</button>
    </section>
  );
}
```

`HtmlVideoProjectEditor.jsx` 需要从当前选中帧取字幕：

```js
const selectedFrame = editor.frames.find(frame => (
  frame.id === editor.selectedFrameId || frame.scene_id === editor.selectedFrameId
));

<CaptionsPanel
  captions={selectedFrame?.captions || []}
  selectedFrameId={selectedFrame?.id || selectedFrame?.scene_id || ''}
  disabled={editor.busy}
  onSave={editor.patchProject}
/>
```

- [ ] **Step 5: 运行测试**

Run:

```powershell
node tests\test-html-video-edit-patch-service.js
node tests\test-html-video-editor-components.mjs
```

Expected: PASS。

### Task 6: 强化生成 prompt 和生成后 validation

**Files:**
- Modify: `server/services/creative-video/html-video/frameHtmlAgent.js`
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Modify: `server/services/creative-video/html-video/validationGate.js`
- Modify: `tests/test-html-video-frame-html-agent.js`
- Modify: `tests/test-html-video-validation-gate.js`
- Modify: `tests/test-html-video-workflow.js`

- [ ] **Step 1: prompt 测试加入 data-text-key 要求**

在 `tests/test-html-video-frame-html-agent.js` 断言 prompt 包含：

```js
assert.match(prompt, /data-text-key="headline"/);
assert.match(prompt, /data-text-key="subtitle"/);
assert.match(prompt, /data-text-key="body"/);
assert.match(prompt, /captions|字幕/);
```

- [ ] **Step 2: validation 测试加入 raw_html 锚点诊断**

在 `tests/test-html-video-validation-gate.js` 增加缺少 `data-text-key` 的 raw_html project，断言 diagnostics 包含：

```js
assert.ok(result.diagnostics.some(item => item.code === 'raw_html_text_keys_missing'));
```

- [ ] **Step 3: 更新 frameHtmlAgent prompt**

加入硬性要求：

```text
raw_html 每帧必须包含稳定可编辑文本锚点：
- 主标题元素必须带 data-text-key="headline"
- 副标题或短字幕元素必须带 data-text-key="subtitle"
- 正文/要点元素必须带 data-text-key="body"
- 不允许只把可见文案写进 canvas 或伪元素
- 字幕可由系统注入，但 HTML 不得阻挡底部字幕层
```

- [ ] **Step 4: 更新 validationGate**

对 raw_html 帧对应 HTML 做轻量检查。`validateHtmlVideoProject()` 已是 async，允许增加文件读取，但必须是 best-effort：

- 只有传入 `projectDir` 且 frame 有 `html_path` 时才尝试读取。
- 路径不能逃逸 project 目录。
- 文件不存在时沿用现有 missing file 诊断，不额外抛错。
- 读取失败不阻断 template/schema 校验，只追加诊断。
- template_inputs 帧不做磁盘 HTML 锚点校验。

```js
function collectMissingTextKeys(html) {
  const missing = [];
  for (const key of ['headline', 'subtitle', 'body']) {
    if (!new RegExp(`data-text-key=["']${key}["']`, 'i').test(html)) missing.push(key);
  }
  return missing;
}
```

缺失时添加诊断：

```js
add(diagnostics, 'raw_html_text_keys_missing', stage, 'raw_html 帧缺少可编辑文本锚点。', {
  frame_id: frame.id,
  missing_keys: missing,
});
```

读取逻辑示例：

```js
async function readFrameHtmlForValidation(projectDir, frame) {
  if (!projectDir || frame.source_mode !== 'raw_html' || !frame.html_path) return null;
  const htmlPath = resolveProjectPath(projectDir, frame.html_path);
  try {
    return await fs.readFile(htmlPath, 'utf8');
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: 运行测试**

Run:

```powershell
node tests\test-html-video-frame-html-agent.js
node tests\test-html-video-validation-gate.js
node tests\test-html-video-workflow.js
```

Expected: PASS。

### Task 7: 真实渲染 smoke test 可选增强

**Files:**
- Modify: `tests/test-html-video-real-render-smoke.js`

- [ ] **Step 1: 增加字幕层真实渲染断言**

在已有 `RUN_HTML_VIDEO_REAL_RENDER=1` 分支中，构造包含 `narration_text` 但无 captions 的 raw_html 帧，导出前 materialize，然后断言 HTML 文件包含字幕层：

```js
const html = await fs.readFile(path.join(projectDir, frame.html_path), 'utf8');
assert.match(html, /data-hv-layer="captions"|data-role="subtitle-caption"/);
```

- [ ] **Step 2: 可选抽帧像素检查**

如果测试环境有 ffmpeg，导出 MP4 后抽取一帧：

```powershell
ffmpeg -y -ss 1 -i output.mp4 -frames:v 1 frame.png
```

用现有图片工具或 Node PNG 库检查底部字幕区域非纯背景。没有稳定图片库时，只保留 HTML 层断言和导出成功断言。

在测试文件顶部显式声明像素检查为可选：

```js
const SKIP_PIXEL = !process.env.PIXEL_CHECK;
```

默认 `RUN_HTML_VIDEO_REAL_RENDER=1` 只要求真实导出和 HTML 字幕层断言；设置 `PIXEL_CHECK=1` 时再做抽帧像素检查。

- [ ] **Step 3: 运行默认测试**

Run:

```powershell
node tests\test-html-video-real-render-smoke.js
```

Expected: 默认跳过真实渲染。

- [ ] **Step 4: 运行真实渲染测试**

Run:

```powershell
$env:RUN_HTML_VIDEO_REAL_RENDER='1'; node tests\test-html-video-real-render-smoke.js
```

Expected: PASS，生成 MP4，HTML 中有字幕层。

## Verification

每个任务完成后运行对应局部测试。全部完成后运行：

```powershell
node tests\run-all.js html-video
node tests\test-creative-workflows.js
node tests\test-one-click-creative-page.mjs
git diff --check -- server/services/creative-video/html-video server/services/creativeWorkflows.js frontend-react/src/components/creative-video-editor tests
```

真实渲染验收在本地环境具备 ffmpeg 和 Playwright Chromium 时执行：

```powershell
$env:RUN_HTML_VIDEO_REAL_RENDER='1'; node tests\test-html-video-real-render-smoke.js
```

## Rollout Notes

项目未上线，不需要做复杂历史迁移。仍建议保留 normalize 的宽容输入能力：

- 接收旧字段 `htmlPath`，输出 `html_path`。
- 接收旧字段 `duration`/`durationSec`，输出 `duration_sec`。
- 接收缺失 captions 的旧工程，按旁白兜底。
- 接收缺失 `metadata.visual_text` 的旧工程，输出空对象。

后续如果要增加 HTML iframe 预览，不要复用 `preview_mp4_path`。应新增 `preview_html_url` 或等价字段，避免把 MP4 预览和 HTML 预览混在同一个字段里。

这样可以兼容本地已有测试数据和用户已生成的临时工程。

## Acceptance Criteria

- raw_html 和 template_inputs 生成结果都能 normalize 成统一 project schema。
- 每帧都有稳定 `id / scene_id / graph_node_id / order / source_mode / duration_sec`。
- 每帧都有 `captions` 数组；旁白非空时 captions 不为空。
- raw_html 帧导出前一定有字幕层。
- 预览、编辑、重新生成、导出都通过 project/frame 数据，而不是各自猜 HTML。
- 标题、旁白、字幕、时长、inputs 保存统一走 `frame_patch`。
- `node tests\run-all.js html-video` 通过。
- 真实渲染开关打开时，raw_html 字幕 smoke test 能导出 MP4。

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-06-19-html-video-frame-project-contract.md`. Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks, fast iteration.

2. Inline Execution - execute tasks in this session using executing-plans, batch execution with checkpoints.
