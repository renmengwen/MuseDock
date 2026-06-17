# html-video Production Quality Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 html-video 生产链路中“多场景重复同一张卡片、9:16 目标生成 16:9 横屏、视觉质检误判通过”的问题。

**Architecture:** 生成前先把 `target` 与 `sceneSpec` 合并成可靠渲染目标，并把画幅作为硬约束传给模板索引。生成工程时把每个 scene 的 `visual_text` 映射为 frame-level `inputs`，避免所有帧复制同一份全局模板输入。生成后在视觉 QA 中增加画幅一致性与跨帧重复检测，防止重复卡片再次被标记为通过。

**Tech Stack:** Node.js CommonJS、html-video template manifest、Playwright/Chromium renderer、ffmpeg/ffprobe、现有 `node tests/*.js` 测试。

---

## File Structure

- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
  - 新增 `resolveRenderTarget()` 和 `buildTemplateIndexOptions()`，从 `target`、`sceneSpec.aspect_ratio`、`sceneSpec.target_duration_sec` 兜底推导目标。
  - 模板索引只把 `aspectRatio` 作为硬过滤；多场景总时长不再用于过滤单帧模板的 manifest `output.duration`。

- Modify: `server/services/creative-video/html-video/sceneSpecMapper.js`
  - 新增帧级输入映射函数，把 `scene.visual_text.headline/cards/keywords` 转成模板 schema 字段。
  - `buildFramesFromGraph()` 改为接收 `templateSchema`，每个 frame 生成不同 `inputs`。

- Modify: `server/services/creative-video/html-video/materializer.js`
  - 注入 `window.__HV_SCENE__`，保留场景元信息给未来模板读取。
  - 保持 `window.__HV_VARS__` 向后兼容。

- Create: `server/templates/news_signal_vertical/template.html-video.yaml`
  - 新增 9:16 竖屏科技财经新闻模板，作为当前 `9:16` 链路可选模板。

- Create: `server/templates/news_signal_vertical/source/index.html`
  - 竖屏模板实现，读取 `headline`、`eyebrow`、`metric`、`bullets`、`section_no`、`footer_text`、`duration_sec`。

- Modify: `server/services/creative-video/visualQaService.js`
  - 增加 `expectedAspectRatio` 或从 `scene_spec/project.output.resolution` 推导的画幅校验。
  - 增加跨采样帧相似度/哈希重复率检测。

- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
  - 调用视觉 QA 时传入 `expectedAspectRatio`。

- Modify: tests:
  - `tests/test-html-video-scene-spec-mapper.js`
  - `tests/test-html-video-workflow.js`
  - `tests/test-html-video-template-registry.js`
  - `tests/test-visual-qa-service.js`
  - Optional real smoke: `tests/test-html-video-vertical-mvp-smoke.js`

---

### Task 1: Add Target Normalization and Hard Aspect Filtering

**Files:**
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Test: `tests/test-html-video-workflow.js`

- [ ] **Step 1: Write the failing workflow test**

Add a second template in `tests/test-html-video-workflow.js` fixture setup so the workflow can choose a vertical template when `target` is empty but `sceneSpec.aspect_ratio` is `9:16`.

Add this helper below `createTemplate()`:

```js
async function createVerticalTemplate(rootDir) {
  const dir = path.join(rootDir, 'vertical');
  await writeFile(path.join(dir, 'template.html-video.yaml'), [
    'id: vertical',
    'name: 竖屏模板',
    'engine: hyperframes',
    'source_entry: index.html',
    'output:',
    '  resolution:',
    '    width: 1080',
    '    height: 1920',
    '  fps: 24',
    '  duration: 4',
    'inputs:',
    '  schema:',
    '    type: object',
    '    required: [headline]',
    '    properties:',
    '      headline:',
    '        type: string',
    '      section_no:',
    '        type: string',
    '      bullets:',
    '        type: array',
    'license:',
    '  commercial_use: true',
    '',
  ].join('\n'));
  await writeFile(path.join(dir, 'index.html'), '<html><body>{{section_no}} {{headline}}</body></html>');
}
```

Call it after `await createTemplate(templateRoot);`:

```js
await createVerticalTemplate(templateRoot);
```

Change the main test `sceneSpec.aspect_ratio` to `9:16` and leave `target` without aspect:

```js
target: {},
```

Change the stub selector assertion so it proves only vertical templates are available:

```js
if (calls.length === 1) {
  assert.match(prompt, /"aspect_ratio": "9:16"/);
  assert.match(prompt, /"id": "vertical"/);
  assert.doesNotMatch(prompt, /"id": "simple"/);
  return { success: true, text: JSON.stringify({ template_id: 'vertical', reason: '匹配竖屏', confidence: 0.9 }) };
}
```

Update expected output:

```js
assert.equal(result.template_id, 'vertical');
assert.deepEqual(result.project.output.resolution, { width: 1080, height: 1920 });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected: FAIL because the prompt still includes the `simple` 16:9 template or because no aspect fallback from `sceneSpec` is used.

- [ ] **Step 3: Implement target normalization**

In `server/services/creative-video/html-video/htmlVideoWorkflow.js`, add after `durationFromTarget()`:

```js
function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function resolveRenderTarget(target = {}, sceneSpec = {}) {
  const aspectRatio = target.aspect_ratio
    || target.aspectRatio
    || sceneSpec.aspect_ratio
    || sceneSpec.aspectRatio
    || '';
  const durationSec = firstPositiveNumber(
    target.duration_sec,
    target.durationSec,
    target.duration,
    target.target_duration_sec,
    target.targetDurationSec,
    sceneSpec.target_duration_sec,
    sceneSpec.targetDurationSec,
  );
  return {
    ...target,
    aspect_ratio: aspectRatio,
    aspectRatio,
    duration_sec: durationSec || target.duration_sec || target.durationSec || target.duration,
  };
}

function buildTemplateIndexOptions(renderTarget = {}, sceneSpec = {}) {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const isMultiScene = scenes.length > 1;
  return {
    aspectRatio: renderTarget.aspect_ratio || renderTarget.aspectRatio,
    durationSec: isMultiScene
      ? undefined
      : (renderTarget.duration_sec || renderTarget.durationSec || renderTarget.duration),
  };
}
```

Then in `generateHtmlVideo()` replace the compact index construction:

```js
const renderTarget = resolveRenderTarget(target, sceneSpec || {});
const compactIndex = registry.buildCompactIndex(buildTemplateIndexOptions(renderTarget, sceneSpec || {}));
```

Replace downstream uses of `target` in template selection and `buildInitialProject()` with `renderTarget`:

```js
const selection = await requestTemplateSelection({ model, compactIndex, creativeContext, target: renderTarget, sceneSpec });
```

```js
target: renderTarget,
```

Export helpers for testing at the bottom:

```js
  resolveRenderTarget,
  buildTemplateIndexOptions,
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/htmlVideoWorkflow.js tests/test-html-video-workflow.js
git commit -m "修复 html-video 模板选择目标约束"
```

---

### Task 2: Map Scene Visual Text into Per-Frame Template Inputs

**Files:**
- Modify: `server/services/creative-video/html-video/sceneSpecMapper.js`
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Test: `tests/test-html-video-scene-spec-mapper.js`
- Test: `tests/test-html-video-workflow.js`

- [ ] **Step 1: Write the failing mapper test**

In `tests/test-html-video-scene-spec-mapper.js`, replace the existing frame input assertions:

```js
assert.deepEqual(frames[0].inputs, { title: '信号失控', subtitle: '评论区正在改写品牌传播' });
```

with:

```js
assert.equal(frames[0].inputs.title, '信号失控');
assert.equal(frames[0].inputs.subtitle, '评论区正在改写品牌传播');
assert.equal(frames[0].inputs.section_no, '01/02');
assert.deepEqual(frames[0].inputs.bullets, ['卡片一']);
assert.equal(frames[1].inputs.title, '数据正在变化');
assert.equal(frames[1].inputs.section_no, '02/02');
assert.deepEqual(frames[1].inputs.bullets, ['卡片二']);
```

Change the `buildFramesFromGraph()` call:

```js
const frames = mapper.buildFramesFromGraph({
  sceneSpec,
  contentGraph,
  templateId: 'glitch_title',
  templateInputs: { title: '信号失控', subtitle: '评论区正在改写品牌传播' },
  templateSchema: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    section_no: { type: 'string' },
    bullets: { type: 'array' },
  },
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-html-video-scene-spec-mapper.js
```

Expected: FAIL because every frame still receives the same global `templateInputs`.

- [ ] **Step 3: Implement schema-aware frame input mapping**

In `server/services/creative-video/html-video/sceneSpecMapper.js`, add:

```js
function compactText(value, maxLength = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength - 1).trimEnd() : text;
}

function schemaHas(schema, key) {
  return Object.prototype.hasOwnProperty.call(schema || {}, key);
}

function fieldMaxLength(schema, key, fallback) {
  const raw = schema && schema[key];
  const value = raw && (raw.max_length ?? raw.maxLength);
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sectionNo(index, total) {
  const width = Math.max(2, String(total).length);
  return `${String(index + 1).padStart(width, '0')}/${String(total).padStart(width, '0')}`;
}

function firstMetric(visualText = {}) {
  const candidates = [
    ...(Array.isArray(visualText.keywords) ? visualText.keywords : []),
    ...(Array.isArray(visualText.cards) ? visualText.cards : []),
    visualText.headline,
  ];
  return compactText(candidates.find(item => /[$￥¥]?\d|%/.test(String(item || ''))) || visualText.headline || '', 24);
}

function buildFrameInputs({ templateInputs, templateSchema, scene, index, total }) {
  const schema = templateSchema || {};
  const visualText = scene.visual_text || {};
  const headline = compactText(visualText.headline || scene.title || scene.id, fieldMaxLength(schema, 'headline', 48));
  const cards = Array.isArray(visualText.cards) ? visualText.cards.map(item => compactText(item, 48)).filter(Boolean) : [];
  const keywords = Array.isArray(visualText.keywords) ? visualText.keywords.map(item => compactText(item, 24)).filter(Boolean) : [];
  const inputs = clone(templateInputs);

  if (schemaHas(schema, 'headline')) inputs.headline = headline;
  if (schemaHas(schema, 'title')) inputs.title = headline;
  if (schemaHas(schema, 'card_title')) inputs.card_title = headline;
  if (schemaHas(schema, 'section_no')) inputs.section_no = sectionNo(index, total);
  if (schemaHas(schema, 'eyebrow')) inputs.eyebrow = compactText(keywords.slice(0, 2).join(' / '), fieldMaxLength(schema, 'eyebrow', 28));
  if (schemaHas(schema, 'card_label')) inputs.card_label = compactText(keywords.slice(0, 2).join('｜') || inputs.card_label, fieldMaxLength(schema, 'card_label', 24));
  if (schemaHas(schema, 'bullets')) inputs.bullets = cards.slice(0, 4);
  if (schemaHas(schema, 'cards')) inputs.cards = cards.slice(0, 4);
  if (schemaHas(schema, 'metric')) inputs.metric = firstMetric(visualText);
  if (schemaHas(schema, 'footer_text')) inputs.footer_text = compactText(cards[0] || inputs.footer_text || '', fieldMaxLength(schema, 'footer_text', 36));
  if (schemaHas(schema, 'duration_sec')) inputs.duration_sec = Number(scene.duration || scene.target_duration_sec || inputs.duration_sec || DEFAULT_FRAME_DURATION_SEC);

  return inputs;
}
```

Change signature:

```js
function buildFramesFromGraph({ sceneSpec: rawSceneSpec, contentGraph, templateId, templateInputs, templateSchema }) {
```

Inside the `map()` callback, compute total:

```js
  const orderedNodeIds = topoSort(contentGraph);
  const total = orderedNodeIds.length;
  return orderedNodeIds.map((nodeId, index) => {
```

Replace:

```js
      inputs: clone(templateInputs),
```

with:

```js
      inputs: buildFrameInputs({
        templateInputs,
        templateSchema,
        scene,
        index,
        total,
      }),
```

Export helper:

```js
  buildFrameInputs,
```

- [ ] **Step 4: Pass template schema from workflow**

In `server/services/creative-video/html-video/htmlVideoWorkflow.js`, update `buildFramesFromGraph()` call:

```js
  const mappedFrames = buildFramesFromGraph({
    sceneSpec: sceneSpec || {},
    contentGraph,
    templateId: template.id,
    templateInputs,
    templateSchema,
  });
```

- [ ] **Step 5: Run mapper and workflow tests**

Run:

```powershell
node tests/test-html-video-scene-spec-mapper.js
node tests/test-html-video-workflow.js
```

Expected: both PASS. In workflow test, `result.project.frames[0].inputs.headline` and `result.project.frames[1].inputs.headline` must differ.

- [ ] **Step 6: Commit**

```powershell
git add server/services/creative-video/html-video/sceneSpecMapper.js server/services/creative-video/html-video/htmlVideoWorkflow.js tests/test-html-video-scene-spec-mapper.js tests/test-html-video-workflow.js
git commit -m "修复 html-video 帧级内容映射"
```

---

### Task 3: Add a Real 9:16 html-video Template

**Files:**
- Create: `server/templates/news_signal_vertical/template.html-video.yaml`
- Create: `server/templates/news_signal_vertical/source/index.html`
- Test: `tests/test-html-video-template-registry.js`

- [ ] **Step 1: Write the failing registry assertion**

In `tests/test-html-video-template-registry.js`, add an assertion against the default registry:

```js
const defaultRegistry = registry.createTemplateRegistry();
const verticalTemplates = defaultRegistry.buildCompactIndex({ aspect_ratio: '9:16' }).map(item => item.id);
assert.ok(verticalTemplates.includes('news_signal_vertical'));
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-html-video-template-registry.js
```

Expected: FAIL because no production `9:16` template exists yet.

- [ ] **Step 3: Create vertical manifest**

Create `server/templates/news_signal_vertical/template.html-video.yaml`:

```yaml
id: news_signal_vertical
name: 竖屏财经信号
description: 9:16 竖屏科技财经新闻模板，适合数字冲击、时间线、估值、风险条款和战略解释。
category: news
tags:
  - 竖屏
  - 财经
  - 科技
  - 数据
  - 新闻
engine: hyperframes
engine_version: "1.0.0"
source_entry: source/index.html
output:
  resolution:
    width: 1080
    height: 1920
  fps: 30
  duration: 6
inputs:
  schema:
    headline:
      type: string
      required: true
      max_length: 32
      description: 当前场景主标题。
    eyebrow:
      type: string
      required: false
      max_length: 28
      description: 顶部分类或关键词。
    metric:
      type: string
      required: false
      max_length: 24
      description: 当前场景最重要的数字或短语。
    bullets:
      type: array
      required: false
      max_items: 4
      description: 场景要点列表。
    section_no:
      type: string
      required: false
      max_length: 8
      description: 章节编号，例如 01/08。
    footer_text:
      type: string
      required: false
      max_length: 36
      description: 底部说明。
    duration_sec:
      type: number
      required: false
      description: 当前场景时长，单位秒。
  examples:
    - headline: 600 亿美元全股票收购
      eyebrow: 科技财经 / 并购
      metric: $60B
      bullets:
        - SpaceX 收购 Cursor 母公司
        - 全股票交易
        - Anysphere 估值翻倍
      section_no: 01/08
      footer_text: Anysphere 并购要点速览
      duration_sec: 6
preview:
  title: 竖屏财经信号预览
license:
  name: Apache-2.0
  commercial_use: true
  attribution_required: false
assets_attribution: []
```

- [ ] **Step 4: Create vertical HTML source**

Create `server/templates/news_signal_vertical/source/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>竖屏财经信号</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#06080d;color:#f7f8fb;font-family:Arial,"Noto Sans SC","Microsoft YaHei",sans-serif}
  body{position:relative;background:
    radial-gradient(circle at 80% 12%,rgba(48,255,142,.18),transparent 26%),
    radial-gradient(circle at 15% 86%,rgba(69,214,255,.16),transparent 28%),
    linear-gradient(180deg,#05070b 0%,#101722 54%,#06080d 100%)}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:72px 72px;opacity:.28}
  .wrap{position:absolute;inset:96px 72px 104px;display:flex;flex-direction:column}
  .top{display:flex;justify-content:space-between;align-items:center;font-size:34px;font-weight:900;letter-spacing:0;color:#fff}
  .eyebrow{max-width:690px;color:#39ff88;font-size:30px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .panel{margin-top:170px;border:2px solid rgba(255,255,255,.14);background:rgba(10,16,25,.72);box-shadow:0 28px 90px rgba(0,0,0,.42);padding:56px 52px}
  .metric{font-size:120px;line-height:.95;font-weight:900;color:#39ff88;letter-spacing:0;margin-bottom:34px;white-space:pre-wrap;word-break:break-word}
  .headline{font-size:82px;line-height:1.05;font-weight:900;letter-spacing:0;word-break:break-word}
  .bullets{margin-top:76px;display:grid;gap:24px}
  .bullet{font-size:38px;line-height:1.25;font-weight:800;color:#e9eef7;padding:24px 28px;border-left:8px solid #45d6ff;background:rgba(255,255,255,.07)}
  .footer{margin-top:auto;display:flex;align-items:center;gap:18px;color:#aab5c4;font-size:28px;font-weight:700}
  .tick{width:72px;height:5px;background:#ffb84d}
</style>
</head>
<body>
  <div class="grid"></div>
  <main class="wrap">
    <header class="top">
      <div class="eyebrow" data-hv-bind="eyebrow">科技财经 / 并购</div>
      <div data-hv-bind="section_no">01/08</div>
    </header>
    <section class="panel">
      <div class="metric" data-hv-bind="metric">$60B</div>
      <div class="headline" data-hv-bind="headline">600 亿美元全股票收购</div>
      <div class="bullets" data-hv-bind="bullets"></div>
    </section>
    <footer class="footer"><span class="tick"></span><span data-hv-bind="footer_text">Anysphere 并购要点速览</span></footer>
  </main>
  <script>
    const vars = window.__HV_VARS__ || {};
    const defaults = {
      headline: '600 亿美元全股票收购',
      eyebrow: '科技财经 / 并购',
      metric: '$60B',
      bullets: ['SpaceX 收购 Cursor 母公司', '全股票交易', 'Anysphere 估值翻倍'],
      section_no: '01/08',
      footer_text: 'Anysphere 并购要点速览'
    };
    function text(key) {
      const node = document.querySelector(`[data-hv-bind="${key}"]`);
      if (node) node.textContent = vars[key] || defaults[key] || '';
    }
    text('headline');
    text('eyebrow');
    text('metric');
    text('section_no');
    text('footer_text');
    const bullets = Array.isArray(vars.bullets) && vars.bullets.length ? vars.bullets : defaults.bullets;
    const bulletRoot = document.querySelector('[data-hv-bind="bullets"]');
    bullets.slice(0, 4).forEach(item => {
      const div = document.createElement('div');
      div.className = 'bullet';
      div.textContent = String(item || '').trim();
      bulletRoot.appendChild(div);
    });
    window.__timelines = window.__timelines || {};
    window.__timelines.main = { duration: Number(window.__HV_DURATION__ || vars.duration_sec || 6) };
  </script>
</body>
</html>
```

- [ ] **Step 5: Run registry test**

Run:

```powershell
node tests/test-html-video-template-registry.js
```

Expected: PASS and `news_signal_vertical` appears for `aspect_ratio: '9:16'`.

- [ ] **Step 6: Commit**

```powershell
git add server/templates/news_signal_vertical tests/test-html-video-template-registry.js
git commit -m "新增 html-video 竖屏财经模板"
```

---

### Task 4: Preserve Scene Metadata in Materialized HTML

**Files:**
- Modify: `server/services/creative-video/html-video/materializer.js`
- Test: `tests/test-html-video-materializer.js`

- [ ] **Step 1: Write failing materializer assertion**

In `tests/test-html-video-materializer.js`, after materialization reads the generated HTML, add:

```js
assert.match(html, /window\.__HV_SCENE__/);
assert.match(html, /"headline":"第一幕"/);
```

Use a frame fixture with:

```js
metadata: {
  visual_text: {
    headline: '第一幕',
    cards: ['卡片一'],
    keywords: ['关键词一'],
  },
},
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-html-video-materializer.js
```

Expected: FAIL because only `window.__HV_VARS__` and `window.__HV_DURATION__` are injected.

- [ ] **Step 3: Inject scene metadata**

In `materializer.js`, change `materializeTemplate()` signature:

```js
function materializeTemplate(sourceHtml, vars, durationSec, sceneData = {}) {
```

Change injection:

```js
const injection = `<script>window.__HV_VARS__ = ${safeJson(vars)}; window.__HV_DURATION__ = ${safeJson(durationSec)}; window.__HV_SCENE__ = ${safeJson(sceneData)};</script>`;
```

In `materializeFrame()`, before calling `materializeTemplate()`:

```js
const sceneData = {
  id: frame.scene_id || frame.id,
  narration_text: frame.narration_text || '',
  captions: Array.isArray(frame.captions) ? frame.captions : [],
  metadata: objectOrEmpty(frame.metadata),
};
```

Then call:

```js
const html = materializeTemplate(sourceHtml, vars, durationSec, sceneData);
```

- [ ] **Step 4: Run materializer test**

Run:

```powershell
node tests/test-html-video-materializer.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/materializer.js tests/test-html-video-materializer.js
git commit -m "为 html-video 注入场景元数据"
```

---

### Task 5: Add QA Gates for Aspect Mismatch and Repeated Frames

**Files:**
- Modify: `server/services/creative-video/visualQaService.js`
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Test: `tests/test-visual-qa-service.js`

- [ ] **Step 1: Write failing QA tests**

In `tests/test-visual-qa-service.js`, add two tests using stubbed probe/frame metrics:

```js
{
  const report = await visualQaService.inspectRenderedVideo({
    projectDir: tempDir,
    outputPath: fakeVideo,
    expectedAspectRatio: '9:16',
    services: {
      probeVideo: async () => ({ width: 1920, height: 1080, duration: 83.6 }),
      sampleFrames: async () => [
        { id: 'frame_0', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'a' },
        { id: 'frame_1', average_luma: 61, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'a' },
        { id: 'frame_2', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'a' },
      ],
    },
  });
  assert.equal(report.success, false);
  assert.ok(report.issues.some(issue => issue.code === 'aspect_ratio_mismatch'));
}

{
  const report = await visualQaService.inspectRenderedVideo({
    projectDir: tempDir,
    outputPath: fakeVideo,
    expectedAspectRatio: '16:9',
    services: {
      probeVideo: async () => ({ width: 1920, height: 1080, duration: 83.6 }),
      sampleFrames: async () => [
        { id: 'frame_0', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'same' },
        { id: 'frame_1', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'same' },
        { id: 'frame_2', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'same' },
        { id: 'frame_3', average_luma: 60, luma_stddev: 30, edge_score: 4, color_variance: 60, fingerprint: 'same' },
      ],
    },
  });
  assert.equal(report.success, false);
  assert.ok(report.issues.some(issue => issue.code === 'repeated_frames'));
}
```

If `visualQaService` currently does not accept injected `services`, add the test with the repo’s existing injection pattern in that file. Keep the assertion names `aspect_ratio_mismatch` and `repeated_frames`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-visual-qa-service.js
```

Expected: FAIL because repeated nonblank frames still pass and aspect mismatch is not checked.

- [ ] **Step 3: Implement aspect helper**

In `visualQaService.js`, add:

```js
function aspectFromDimensions(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '';
  const ratio = w / h;
  if (Math.abs(ratio - 16 / 9) < 0.02) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.02) return '9:16';
  if (Math.abs(ratio - 1) < 0.02) return '1:1';
  return `${w}:${h}`;
}

function addAspectIssue(issues, videoInfo, expectedAspectRatio) {
  const expected = String(expectedAspectRatio || '').trim();
  if (!expected) return;
  const actual = aspectFromDimensions(videoInfo.width, videoInfo.height);
  if (actual && actual !== expected) {
    issues.push({
      code: 'aspect_ratio_mismatch',
      message: `输出画幅为 ${actual}，但目标画幅为 ${expected}。`,
      expected,
      actual,
      width: videoInfo.width,
      height: videoInfo.height,
    });
  }
}
```

- [ ] **Step 4: Implement repeated frame detection**

Add:

```js
function frameFingerprint(frame) {
  if (frame.fingerprint) return String(frame.fingerprint);
  return [
    Math.round(Number(frame.average_luma || 0)),
    Math.round(Number(frame.luma_stddev || 0)),
    Math.round(Number(frame.edge_score || 0) * 10),
    Math.round(Number(frame.color_variance || 0)),
  ].join(':');
}

function addRepeatedFrameIssue(issues, frames, threshold = 0.75) {
  if (!Array.isArray(frames) || frames.length < 4) return;
  const counts = new Map();
  for (const frame of frames) {
    const key = frameFingerprint(frame);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  const repeatedRatio = maxCount / frames.length;
  if (repeatedRatio >= threshold) {
    issues.push({
      code: 'repeated_frames',
      message: `采样帧重复率 ${(repeatedRatio * 100).toFixed(0)}%，疑似多场景重复同一画面。`,
      repeated_ratio: repeatedRatio,
      frame_count: frames.length,
    });
  }
}
```

In `inspectRenderedVideo()`, after collecting `videoInfo` and `frames`, call:

```js
addAspectIssue(issues, videoInfo, options.expectedAspectRatio || options.expected_aspect_ratio);
addRepeatedFrameIssue(issues, frames);
```

Make `success` false when `issues.length > 0`, preserving existing blank/low-information failures.

- [ ] **Step 5: Pass expected aspect from workflow**

In `htmlVideoWorkflow.js`, when calling visual QA:

```js
visualReport = await visualQaService.inspectRenderedVideo({
  projectDir,
  outputPath: rendered.output_path,
  expectedAspectRatio: renderTarget.aspect_ratio || sceneSpec?.aspect_ratio,
});
```

- [ ] **Step 6: Run QA test**

Run:

```powershell
node tests/test-visual-qa-service.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add server/services/creative-video/visualQaService.js server/services/creative-video/html-video/htmlVideoWorkflow.js tests/test-visual-qa-service.js
git commit -m "增强 html-video 视觉质检"
```

---

### Task 6: Fix Misleading html-video Diagnostics

**Files:**
- Modify: `server/services/creative-video/html-video/diagnostics.js`
- Modify: `server/services/creative-video/html-video/projectOrchestrator.js`
- Test: `tests/test-html-video-validation-gate.js` or closest existing diagnostics test

- [ ] **Step 1: Write failing diagnostics assertion**

Add a test that normalizing a success diagnostic does not produce `html_video_error`:

```js
const { normalizeDiagnostics } = require('../server/services/creative-video/html-video/diagnostics');

const normalized = normalizeDiagnostics([{
  code: 'frame_rendered',
  stage: 'render',
  message: '已通过 Playwright/Chromium 录制并使用 ffmpeg libx264 编码。',
}]);

assert.equal(normalized[0].code, 'frame_rendered');
assert.doesNotMatch(normalized[0].user_message, /处理失败/);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/test-html-video-validation-gate.js
```

Expected: FAIL if current normalization wraps informational render messages as `html_video_error` / `html-video 处理失败`。

- [ ] **Step 3: Implement informational diagnostic handling**

In `diagnostics.js`, update `normalizeDiagnostics()` so objects with a `code` keep their code:

```js
function normalizeDiagnostic(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return createDiagnostic({
      code: input.code || 'html_video_info',
      stage: input.stage || 'unknown',
      user_message: input.user_message || input.message || 'html-video 处理信息。',
      details: input.details || input,
      fallback_allowed: input.fallback_allowed !== false,
    });
  }
  return createDiagnostic({
    code: 'html_video_error',
    stage: 'unknown',
    user_message: `html-video 处理失败：${String(input || '未知错误')}`,
    details: { message: String(input || '') },
  });
}
```

Keep current exported API names unchanged.

- [ ] **Step 4: Run diagnostics test**

Run:

```powershell
node tests/test-html-video-validation-gate.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/diagnostics.js tests/test-html-video-validation-gate.js
git commit -m "修正 html-video 诊断信息分类"
```

---

### Task 7: End-to-End Regression Test for the Latest Failure Shape

**Files:**
- Create: `tests/test-html-video-production-regression.js`

- [ ] **Step 1: Add regression test**

Create `tests/test-html-video-production-regression.js`:

```js
const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const workflow = require('../server/services/creative-video/html-video/htmlVideoWorkflow');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function createVerticalTemplate(rootDir) {
  const dir = path.join(rootDir, 'news_signal_vertical');
  await writeFile(path.join(dir, 'template.html-video.yaml'), [
    'id: news_signal_vertical',
    'name: 竖屏财经信号',
    'engine: hyperframes',
    'source_entry: index.html',
    'output:',
    '  resolution:',
    '    width: 1080',
    '    height: 1920',
    '  fps: 24',
    '  duration: 6',
    'inputs:',
    '  schema:',
    '    type: object',
    '    required: [headline]',
    '    properties:',
    '      headline: { type: string }',
    '      section_no: { type: string }',
    '      bullets: { type: array }',
    '      metric: { type: string }',
    'license:',
    '  commercial_use: true',
    '',
  ].join('\n'));
  await writeFile(path.join(dir, 'index.html'), '<html><body>{{section_no}} {{headline}}</body></html>');
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-regression-'));
  const templateRoot = path.join(rootDir, 'templates');
  await createVerticalTemplate(templateRoot);
  const templateRegistry = createTemplateRegistry({ rootDir: templateRoot });
  templateRegistry.scanTemplates();

  const sceneSpec = {
    title: 'SpaceX 600 亿美元收购 Cursor 母公司',
    aspect_ratio: '9:16',
    target_duration_sec: 20,
    scenes: [
      {
        id: 'scene_01',
        order: 1,
        duration: 8,
        kind: 'data',
        narration_text: '第一段',
        captions: [],
        visual_text: {
          headline: '600 亿美元全股票收购',
          keywords: ['$60B', 'SpaceX'],
          cards: ['SpaceX 收购 Cursor 母公司', '全股票交易'],
        },
      },
      {
        id: 'scene_02',
        order: 2,
        duration: 12,
        kind: 'data',
        narration_text: '第二段',
        captions: [],
        visual_text: {
          headline: '第三季度完成，分手费高昂',
          keywords: ['$1.5B', '$8.5B'],
          cards: ['15 亿美元现金', '85 亿美元算力资源'],
        },
      },
    ],
  };

  const result = await workflow.generateHtmlVideo({
    workflowId: '20260617045930646240',
    runId: 'regression',
    rootDir,
    sceneSpec,
    creativeContext: { input: { raw_text: 'SpaceX 收购 Cursor' } },
    target: {},
    templateRegistry,
    skipValidation: false,
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          const prompt = messages.map(item => item.content).join('\n');
          if (prompt.includes('模板选择助手')) {
            assert.match(prompt, /"aspect_ratio": "9:16"/);
            return { success: true, text: JSON.stringify({ template_id: 'news_signal_vertical', reason: '竖屏财经', confidence: 0.95 }) };
          }
          return { success: true, text: JSON.stringify({ headline: '全局标题' }) };
        },
      },
      environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
      frameRenderer: {
        renderFrame: async (frame, options) => ({
          success: true,
          frame_id: frame.id,
          output_path: path.join(options.projectDir, 'frames', `${frame.id}.mp4`),
          diagnostics: [],
        }),
      },
      ffmpegComposer: {
        concatFramesWithFfmpeg: async (frames, outputPath) => {
          await writeFile(outputPath, 'mp4');
          return { success: true, output_path: outputPath };
        },
      },
      visualQaService: {
        inspectRenderedVideo: async ({ expectedAspectRatio }) => {
          assert.equal(expectedAspectRatio, '9:16');
          return { success: true, issues: [], metrics: {} };
        },
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.template_id, 'news_signal_vertical');
  assert.deepEqual(result.project.output.resolution, { width: 1080, height: 1920 });
  assert.equal(result.project.frames[0].inputs.headline, '600 亿美元全股票收购');
  assert.equal(result.project.frames[1].inputs.headline, '第三季度完成，分手费高昂');
  assert.notDeepEqual(result.project.frames[0].inputs, result.project.frames[1].inputs);
  assert.equal(result.project.frames[0].inputs.section_no, '01/02');
  assert.equal(result.project.frames[1].inputs.section_no, '02/02');

  console.log('html-video production regression tests passed');
})();
```

- [ ] **Step 2: Run regression test**

Run:

```powershell
node tests/test-html-video-production-regression.js
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add tests/test-html-video-production-regression.js
git commit -m "补充 html-video 生产链路回归测试"
```

---

### Task 8: Final Verification

**Files:**
- No direct edits.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
node tests/test-html-video-template-registry.js
node tests/test-html-video-scene-spec-mapper.js
node tests/test-html-video-materializer.js
node tests/test-html-video-workflow.js
node tests/test-visual-qa-service.js
node tests/test-html-video-production-regression.js
```

Expected: all PASS.

- [ ] **Step 2: Run html-video suite**

Run:

```powershell
node tests/run-all.js html-video
```

If `tests/run-all.js` does not support filtering, run:

```powershell
Get-ChildItem tests -Filter 'test-html-video-*.js' | ForEach-Object { node $_.FullName }
```

Expected: all html-video tests PASS.

- [ ] **Step 3: Optional real render smoke**

Run only if Playwright/Chromium and ffmpeg are configured:

```powershell
$env:RUN_HTML_VIDEO_REAL_RENDER='1'; node tests/test-html-video-vertical-mvp-smoke.js
```

Expected:
- Output is `1080x1920`.
- Contact sheet shows different scene texts.
- QA does not report `aspect_ratio_mismatch` or `repeated_frames`.

- [ ] **Step 4: Inspect a newly generated sample**

Create a small local workflow with 2 to 3 scenes, then inspect `project.json`:

```powershell
node -e "const fs=require('fs'); const p=process.argv[1]; const j=JSON.parse(fs.readFileSync(p,'utf8')); console.log(j.output); console.log(j.frames.map(f=>f.inputs));" "PATH_TO_PROJECT_JSON"
```

Expected:
- `output.resolution` is `{ width: 1080, height: 1920 }` for `9:16` scene spec.
- Each frame has distinct `headline` / `section_no` / `bullets`.

- [ ] **Step 5: Final commit if verification required extra fixes**

```powershell
git status --short
git add server/services/creative-video/html-video server/services/creative-video/visualQaService.js server/templates/news_signal_vertical tests
git commit -m "完善 html-video 生产链路质量门禁"
```

---

## Self-Review

**Spec coverage:**  
已覆盖最新失败链路的三个直接问题：帧内容重复、画幅错误、QA 误判。也覆盖一个辅助问题：成功诊断被包装成错误信息。

**Placeholder scan:**  
计划中没有 `TBD`、`TODO`、`implement later`。所有任务都有文件、测试、代码片段、运行命令和期望结果。

**Type consistency:**  
统一使用 `aspect_ratio/aspectRatio`、`duration_sec/durationSec`、`templateSchema`、`frame.inputs`、`metadata.visual_text`。新增 QA issue code 固定为 `aspect_ratio_mismatch` 和 `repeated_frames`。

**Risk notes:**  
当前生产模板只有 16:9，因此新增 9:16 模板是必要修复，不只是增强。多场景视频的总时长不能继续用来硬过滤单帧模板 `output.duration`，否则 60 秒/83 秒视频会把所有 5 秒/6 秒模板过滤掉。
