# html-video production review 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 修复 `0821a6fbe4f6d230258ebf9ed5185b08f5c1985c..HEAD` 实施后的 html-video production 断链问题，让一键工作流、可编辑工程 API、前端编辑器和测试覆盖形成可运行闭环。

**Architecture:** 先把 html-video lite 从旧 HyperFrames 自由工程 check/render 中解耦，确保 workflow 最终结果保留 `html_video_project_path`。再补齐 `scene_spec -> content_graph -> frames`、`output` schema、render API mode 分支和前端响应解析。后端继续按 `htmlVideoWorkflow` 负责业务适配、`projectOrchestrator` 负责工程生命周期、`frameRenderer/hyperframesPlaywrightAdapter/ffmpegComposer` 负责渲染和合成的边界拆分，不把逻辑塞回大文件。

**Tech Stack:** Node.js 22、CommonJS、Express、React 19、Vite、Playwright Chromium、ffmpeg、现有 `tests/run-all.js` 自动测试发现机制。

---

## 0. 实施前约束

- 修改任何文件前运行 `git branch --show-current`，必须在 `dev` 分支；如果在 `main` 且不是发布、同步或合并 `dev` 到 `main`，立即停止。
- PowerShell 读取中文文件必须使用 `Get-Content -Encoding UTF8`。
- 用户可见文案、错误、loading、成功和失败状态使用中文。
- 这份计划修的是 review 中确认成立的问题，不扩大到 Premiere 式复杂编辑器。
- AI 仍然默认只输出 `template_id`、`template_inputs`、`edit_patch` 等 JSON，不改成 AI 直接写完整 HTML。
- 所有触发接口请求的前端操作必须保留 loading 文案、按钮禁用态、重复点击保护和明确完成状态。
- 后端新增或修改逻辑必须保持职责拆分：workflow stage 适配、project store/schema、materializer、render adapter、ffmpeg composer、validation gate、edit patch 不混到同一个文件。

## 1. Review 问题到任务映射

| Review 问题 | 修复任务 | 首版必须完成 |
| --- | --- | --- |
| html-video 已渲染后仍进入旧 HyperFrames CLI check/render | Task 1 | 是 |
| workflow 完成态丢失 `html_video_project_path` | Task 1 | 是 |
| 前端 hook 不识别 `html_video_project` | Task 5 | 是 |
| `scene_spec -> contentGraph -> frames` 未接入 | Task 2 | 是 |
| `output` 被 `normalizeProject()` 丢弃 | Task 3 | 是 |
| `/render` 忽略 `mode/frame_id`，单帧预览和 materialize 变全量导出 | Task 4 | 是 |
| 模板 schema 未返回，字段面板显示“暂无模板字段” | Task 5 | 是 |
| 缺少覆盖真实断点的测试 | Task 1-6 | 是 |

---

## 2. 文件结构与职责边界

### 后端修改

- Modify: `server/services/creativeWorkflows.js`
  - 只负责一键 workflow stage 编排、workflow record 持久化、html-video project API service 分发。
  - 新增或调整的逻辑只能决定“调用哪个 html-video/legacy 服务”和“如何保存 result”，不能在这里实现 project 物化、Playwright、ffmpeg 或 schema 校验细节。

- Modify: `server/services/agentRuns.js`
  - 保持 agent run 状态写入职责。
  - html-video lite 成功后写入 `hyperframes_freeform.project.project_dir`、`hyperframes_freeform.project.html_video_project_path`、`hyperframes_freeform.project.frame_specs`、`hyperframes_freeform.render.output_path`。
  - 不调用 Playwright/ffmpeg 细节，仍通过 `creativeVideoWorkflowFacade.generateCreativeVideoProject()` 获得结果。

- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
  - 负责 workflowId/runId/creativeContext/AI/fallback 业务适配。
  - 接入 `sceneSpecMapper`，构建 `content_graph`、`frames`、`timeline`。
  - 不直接操作 Playwright、ffmpeg 命令。

- Modify: `server/services/creative-video/html-video/projectSchema.js`
  - 保留和规范化 `output`、`template_schema`。
  - 校验 output 基本字段，不承载 registry 扫描逻辑。

- Modify: `server/services/creative-video/html-video/projectOrchestrator.js`
  - 保持工程生命周期语义。
  - 新增 materialize-only、single-frame-preview、full-export 三个可调用分支。
  - 不直接解析 AI、workflow record 或前端 payload。

- Modify: `server/services/creative-video/html-video/frameRenderer.js`
  - 只做 project frame 到 adapter 入参的调度和状态记录。
  - 不直接操作 Playwright，不拼 ffmpeg 命令，不处理字体/动画/lead-in；Playwright 细节全部在 `hyperframesPlaywrightAdapter.js`。

### 前端修改

- Modify: `frontend-react/src/hooks/useHtmlVideoProject.js`
  - 负责 API 响应解析、loading/status、重复点击保护。
  - 增加 `html_video_project` 响应解析。

- Modify: `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx`
  - 只做组件组合和事件分发。
  - 不把模板字段、帧字段、导出、旁白 UI 合并回大组件。

- Modify: `frontend-react/src/components/creative-video-editor/TemplateInputsPanel.jsx`
  - 继续只负责 schema 表单渲染和保存。
  - schema 缺失时显示中文空状态；schema 存在时按字段渲染。

### 测试修改

- Modify: `tests/test-creative-workflows.js`
- Modify: `tests/test-agent-runs.js`
- Modify: `tests/test-html-video-workflow.js`
- Modify: `tests/test-html-video-project-schema.js`
- Modify: `tests/test-html-video-routes.js`
- Modify: `tests/test-html-video-api-client.mjs`
- Modify: `tests/test-html-video-editor-components.mjs`
- Create: `tests/test-html-video-project-orchestrator-modes.js`

---

## Task 1: 修复一键 workflow 的 html-video stage 闭环

**目标:** html-video lite 成功后，一键 workflow 不再把 html-video 工程当旧 HyperFrames 自由工程跑 CLI check/render；workflow 完成态必须保留可编辑工程路径。

**Files:**
- Modify: `server/services/creativeWorkflows.js:840-903`
- Modify: `server/services/agentRuns.js:1532-1613`
- Modify: `tests/test-creative-workflows.js`
- Modify: `tests/test-agent-runs.js`

- [x] **Step 1: 给 creative workflow 写失败复现测试**

在 `tests/test-creative-workflows.js` 新增测试：当 project stage 返回 html-video lite 完整结果时，不再调用旧 `check/render/inspect`，最终 `record.result.hyperframes_freeform.project.html_video_project_path` 可读取。

测试要使用以下断言结构：

```js
async function testHtmlVideoLiteSkipsLegacyHyperframesStages() {
  const { rootDir, mediaRoot } = createTempDirs();
  const projectDir = path.join(mediaRoot, '12345', 'agent_runs', 'run-1-html-video');
  const { services, calls } = createFakeServices({
    agentRuns: {
      generateDouyinRunHyperframesFreeformProject: async (awemeId, runId, options) => {
        calls.push({ name: 'project', awemeId, runId, options });
        return {
          success: true,
          status: 'done',
          message: 'html-video lite 成片完成。',
          hyperframes_freeform: {
            status: 'ready',
            project_dir: projectDir,
            project: {
              status: 'ready',
              project_dir: projectDir,
              html_video_project_path: projectDir,
              scene_spec: { title: '测试', scenes: [] },
              frame_specs: { frames: [{ id: 'frame_01', scene_id: 'scene_01' }] },
            },
            render: {
              status: 'rendered',
              output_path: path.join(projectDir, 'exports', 'output.mp4'),
              render_versions: [{ id: 'run-1-html-video-lite', status: 'rendered' }],
            },
            visual_inspect: { status: 'passed', issues: [] },
          },
        };
      },
      checkDouyinRunHyperframesFreeformProject: async () => {
        throw new Error('不应调用旧 HyperFrames 工程校验');
      },
      renderDouyinRunHyperframesFreeformVideo: async () => {
        throw new Error('不应调用旧 HyperFrames 渲染');
      },
      inspectDouyinRunHyperframesFreeformVideo: async () => {
        throw new Error('不应调用旧 HyperFrames 巡检');
      },
    },
  });

  await createCreativeWorkflow({ input: '做一个 html-video 测试', useResearch: false, assetIds: [] }, { rootDir, mediaRoot, services });
  const run = await runCreativeWorkflow(WORKFLOW_ID, { rootDir, mediaRoot, services });

  assert.equal(run.success, true);
  assert.deepEqual(calls.map(call => call.name), ['createRun', 'brief', 'audio', 'project']);
  const persisted = readJson(getWorkflowPath(WORKFLOW_ID, rootDir));
  assert.equal(persisted.result.hyperframes_freeform.project.html_video_project_path, projectDir);
  assert.equal(persisted.result.hyperframes_freeform.render.status, 'rendered');
}
```

在测试入口调用该函数。

- [x] **Step 2: 运行测试确认失败**

Run: `node tests/test-creative-workflows.js`

Expected: FAIL，错误来自“不应调用旧 HyperFrames 工程校验”或最终 result path 为空。

- [x] **Step 3: 修改 `agentRuns.js` 写入 html-video path**

在 `generateDouyinRunHyperframesFreeformProject()` 的 html-video lite 成功分支中，确保 `project.html_video_project_path` 写入状态：

```js
const htmlVideoProjectPath = result.html_video_project_path || result.project_dir || '';

// updateRunHyperframesFreeformIfOperationCurrent(...) 内：
project_dir: htmlVideoProjectPath,
project: {
  ...current.project,
  status: 'ready',
  operation_id: operationId,
  message: result.message || 'html-video lite 工程已生成。',
  project_dir: htmlVideoProjectPath,
  html_video_project_path: htmlVideoProjectPath,
  files: mapFreeformProjectFilesToDir((result.files || []).map(name => ({ name })), htmlVideoProjectPath),
  scene_spec: result.scene_spec,
  frame_specs: result.frame_specs,
},
```

保留 `render.output_path` 和 `visual_inspect` 的现有写入，不把旧 HyperFrames 字段名删掉。

- [x] **Step 4: 修改 `creativeWorkflows.js` 在 html-video lite 成功后结束 stage 链**

在 project stage 之后读取 project stage 返回结果。若返回体包含 `hyperframes_freeform.project.html_video_project_path` 或 `hyperframes_freeform.project.project_dir`，则认为 html-video lite 已完成 render/visual 状态，不再调用旧 `check/render/inspect`。

实现建议：

```js
function isHtmlVideoLiteProjectResult(result) {
  const hyperframes = result?.hyperframes_freeform || {};
  const project = hyperframes.project || {};
  return Boolean(project.html_video_project_path || project.project_dir)
    && hyperframes.render?.status === 'rendered';
}
```

在 `runCreativeWorkflow()` 中保留 project stage 的返回值：

```js
const projectStageResult = await runStage(record, 'project', rootDir, async () => ensureSuccess(
  await services.agentRuns.generateDouyinRunHyperframesFreeformProject(record.aweme_id, record.run_id, {
    rootDir: mediaRoot,
    useHtmlVideoLiteWorkflow: true,
    skipValidation,
    projectOptions: {
      creative_context: record.creative_context,
    },
  }),
  '工程生成失败。',
), services);
stoppedOrFailed = failIfStoppedOrNull(projectStageResult);
if (stoppedOrFailed) return stoppedOrFailed;
```

如果 `isHtmlVideoLiteProjectResult(projectStageResult)` 为 true：

```js
record.success = true;
record.status = 'done';
record.message = '创作任务已完成。';
record.result = { hyperframes_freeform: projectStageResult.hyperframes_freeform };
record.error = null;
record.updated_at = getNow(services);
const persisted = await persistWorkflow(record, rootDir);
return createWorkflowSummary(persisted);
```

只有非 html-video lite 结果才继续旧 `check/render/inspect`。

- [x] **Step 5: 保护非 html-video legacy 路径**

新增或保留现有测试，断言 legacy project stage 仍调用 `check/render/inspect`：

```js
assert.deepEqual(calls.map(call => call.name), ['createRun', 'brief', 'audio', 'project', 'check', 'render', 'inspect']);
```

如果测试服务默认 project 返回体没有 `hyperframes_freeform.project.project_dir`，它应继续走旧链路。

- [x] **Step 6: 运行相关测试**

Run: `node tests/test-creative-workflows.js`

Expected: PASS。

Run: `node tests/test-agent-runs.js`

Expected: PASS。

- [x] **Step 7: 提交**

```bash
git add server/services/creativeWorkflows.js server/services/agentRuns.js tests/test-creative-workflows.js tests/test-agent-runs.js
git commit -m "修复 html-video 一键工作流完成态"
```

**完成标准:**
- html-video lite 一键 workflow 不调用旧 HyperFrames CLI check/render。
- workflow `result.hyperframes_freeform.project.html_video_project_path` 持久化存在。
- legacy 非 html-video 路径仍保留旧 stage 链。

---

## Task 2: 接入 scene_spec 到 contentGraph 和 frames

**目标:** `generateHtmlVideo()` 用真实 `scene_spec.scenes[]` 构建 `content_graph`、`frames[]`、`timeline`，多场景不再被压成单帧。

**Files:**
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js:1-15`
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js:81-108`
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js:192-198`
- Modify: `tests/test-html-video-workflow.js`

- [x] **Step 1: 写多场景失败测试**

在 `tests/test-html-video-workflow.js` 中把 happy path 的 `sceneSpec.scenes` 扩展成两个 scene：

```js
scenes: [
  { id: 'scene_01', duration: 4, kind: 'text', narration_text: '旁白一', captions: [], visual_text: { headline: '首版标题', keywords: [], cards: [] } },
  { id: 'scene_02', duration: 3, kind: 'text', narration_text: '旁白二', captions: [], visual_text: { headline: '第二幕', keywords: [], cards: [] } },
],
```

把断言改成：

```js
assert.equal(result.project.frames.length, 2);
assert.equal(result.project.frames[0].scene_id, 'scene_01');
assert.equal(result.project.frames[1].scene_id, 'scene_02');
assert.equal(result.project.content_graph.nodes.length, 2);
assert.equal(result.project.timeline.tracks.find(track => track.id === 'main').items.length, 2);
assert.deepEqual(calls.slice(-6), [
  `tts:${path.basename(result.html_video_project_path)}`,
  'render:frame_01',
  'render:frame_02',
  'concat:2',
  'audio:scene_01.mp3',
  'mux:narration-track.mp3',
]);
```

如果 `sceneSpecMapper.buildFramesFromGraph()` 生成的 id 是 `frame_01_01` 这类格式，断言应使用 mapper 的实际稳定 id，但必须覆盖两个不同 scene。

- [x] **Step 2: 运行测试确认失败**

Run: `node tests/test-html-video-workflow.js`

Expected: FAIL，当前 `result.project.frames.length` 为 1。

- [x] **Step 3: 修改 `htmlVideoWorkflow.js` 引入 mapper**

在文件顶部加入：

```js
const { mapSceneSpecToContentGraph, buildFramesFromGraph } = require('./sceneSpecMapper');
```

调整 `buildInitialProject()` 签名：

```js
function buildInitialProject({ workflowId, runId, sceneSpec, template, templateInputs, target }) {
```

构建 contentGraph 和 frames：

```js
const contentGraph = mapSceneSpecToContentGraph(sceneSpec || {});
const mappedFrames = buildFramesFromGraph({
  sceneSpec: sceneSpec || {},
  contentGraph,
  templateId: template.id,
  templateInputs,
});
const frames = mappedFrames.length ? mappedFrames : [{
  id: 'frame_01',
  scene_id: 'scene_01',
  order: 1,
  template_id: template.id,
  inputs: templateInputs,
  duration_sec: duration,
}];
```

构建 timeline：

```js
let cursor = 0;
const items = frames.map(frame => {
  const durationSec = Number(frame.duration_sec || duration);
  const item = {
    id: `item_${frame.id}`,
    kind: 'frame',
    frame_id: frame.id,
    start_sec: cursor,
    duration_sec: durationSec,
  };
  cursor += durationSec;
  return item;
});
```

返回 project 时设置：

```js
content_graph: contentGraph,
frames,
timeline: {
  tracks: [
    { id: 'main', type: 'video', items },
    { id: 'voice', type: 'audio', items: [] },
    { id: 'music', type: 'audio', items: [] },
  ],
},
```

调用处传入 `sceneSpec`：

```js
const project = buildInitialProject({
  workflowId,
  runId,
  sceneSpec,
  template,
  templateInputs: inputResult.inputs,
  target,
});
```

- [x] **Step 4: 保证 TTS mock 支持多 scene**

在 `tests/test-html-video-workflow.js` 的 TTS mock 中写入两个音频文件或让 manifest 至少包含两个 scene：

```js
await writeFile(path.join(projectDir, 'tts', 'scene_01.mp3'), 'audio');
await writeFile(path.join(projectDir, 'tts', 'scene_02.mp3'), 'audio');
await writeFile(path.join(projectDir, 'tts', 'audio_manifest.json'), JSON.stringify({
  version: 1,
  project_dir: projectDir,
  scenes: [
    { scene_id: 'scene_01', relative_path: 'tts/scene_01.mp3', duration: 4, format: 'mp3' },
    { scene_id: 'scene_02', relative_path: 'tts/scene_02.mp3', duration: 3, format: 'mp3' },
  ],
}));
```

- [x] **Step 5: 运行相关测试**

Run: `node tests/test-html-video-scene-spec-mapper.js`

Expected: PASS。

Run: `node tests/test-html-video-workflow.js`

Expected: PASS。

- [x] **Step 6: 提交**

```bash
git add server/services/creative-video/html-video/htmlVideoWorkflow.js tests/test-html-video-workflow.js
git commit -m "接入 html-video 场景图谱映射"
```

**完成标准:**
- 两个 scene 输入生成两个 frame。
- project 保存 `content_graph.nodes[]` 和主 timeline items。
- 渲染调用按 frame 数执行，concat 输入数量等于 frame 数。

---

## Task 3: 保留 output 和 template_schema 到 HtmlVideoProject schema

**目标:** 模板的 `output.resolution/fps/duration` 能进入 render config；模板 schema 能随 project 返回给前端表单。

**Files:**
- Modify: `server/services/creative-video/html-video/projectSchema.js:205-223`
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js:81-108`
- Modify: `server/services/creative-video/html-video/projectOrchestrator.js:16-18`
- Modify: `tests/test-html-video-project-schema.js`
- Modify: `tests/test-html-video-workflow.js`

- [x] **Step 1: 写 output normalize 测试**

在 `tests/test-html-video-project-schema.js` 添加：

```js
const outputProject = schema.normalizeProject({
  project_id: 'p1',
  output: {
    resolution: { width: 1080, height: 1920 },
    fps: 24,
    duration: 7,
  },
  template_schema: {
    type: 'object',
    properties: { headline: { type: 'string', label: '标题' } },
  },
});

assert.deepEqual(outputProject.output.resolution, { width: 1080, height: 1920 });
assert.equal(outputProject.output.fps, 24);
assert.equal(outputProject.output.duration, 7);
assert.equal(outputProject.template_schema.properties.headline.label, '标题');
```

- [x] **Step 2: 写渲染配置传递测试**

在 `tests/test-html-video-workflow.js` 的 fixture 模板 output 改为非默认值：

```yaml
output:
  resolution:
    width: 1080
    height: 1920
  fps: 24
  duration: 4
```

在 `frameRenderer.renderFrame` mock 中断言：

```js
assert.deepEqual(options.resolution, { width: 1080, height: 1920 });
assert.equal(options.fps, 24);
```

并断言：

```js
assert.deepEqual(result.project.output.resolution, { width: 1080, height: 1920 });
assert.equal(result.project.output.fps, 24);
assert.equal(result.project.template_schema.properties.headline.type, 'string');
```

- [x] **Step 3: 运行测试确认失败**

Run: `node tests/test-html-video-project-schema.js`

Expected: FAIL，`output` 或 `template_schema` 为空。

Run: `node tests/test-html-video-workflow.js`

Expected: FAIL，渲染 options resolution/fps 是默认值或 undefined。

- [x] **Step 4: 修改 project schema**

在 `projectSchema.js` 新增 normalize helper：

```js
function normalizeOutput(value) {
  const input = objectOrEmpty(value);
  const resolution = objectOrEmpty(input.resolution);
  const width = Number(resolution.width);
  const height = Number(resolution.height);
  const fps = Number(input.fps);
  const duration = Number(input.duration ?? input.duration_sec);
  const output = {
    resolution: {
      width: Number.isFinite(width) && width > 0 ? width : 1280,
      height: Number.isFinite(height) && height > 0 ? height : 720,
    },
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
  };
  if (Number.isFinite(duration) && duration > 0) {
    output.duration = duration;
  }
  return output;
}
```

在 `normalizeProject()` 返回对象中加入：

```js
output: normalizeOutput(input.output),
template_schema: objectOrEmpty(input.template_schema),
```

- [x] **Step 5: 修改 workflow 写入 template_schema**

在 `buildInitialProject()` 中取模板 schema：

```js
const templateSchema = objectOrEmpty(objectOrEmpty(template.inputs).schema);
```

传给 `normalizeProject()`：

```js
output,
template_schema: templateSchema,
```

- [x] **Step 6: 运行相关测试**

Run: `node tests/test-html-video-project-schema.js`

Expected: PASS。

Run: `node tests/test-html-video-workflow.js`

Expected: PASS。

- [x] **Step 7: 提交**

```bash
git add server/services/creative-video/html-video/projectSchema.js server/services/creative-video/html-video/htmlVideoWorkflow.js tests/test-html-video-project-schema.js tests/test-html-video-workflow.js
git commit -m "保留 html-video 输出配置和模板表单 schema"
```

**完成标准:**
- `project.output` 不再被 normalize 丢弃。
- frame render 收到模板指定的 resolution/fps。
- `project.template_schema` 可供前端字段面板使用。

---

## Task 4: 拆分 materialize、single-frame preview、export 三种 render API mode

**目标:** `/html-video-project/render` 支持 `mode: materialize` 和 `mode: frame`，不再误执行全量导出；`/export` 才执行全量 concat/mux 并新增 export。

**Files:**
- Modify: `server/services/creative-video/html-video/projectOrchestrator.js`
- Modify: `server/services/creativeWorkflows.js:1251-1286`
- Modify: `server/routes/creativeWorkflows.js:241-287`
- Create: `tests/test-html-video-project-orchestrator-modes.js`
- Modify: `tests/test-html-video-routes.js`

- [x] **Step 1: 写 orchestrator mode 测试**

创建 `tests/test-html-video-project-orchestrator-modes.js`，覆盖三个场景：

```js
const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const orchestrator = require('../server/services/creative-video/html-video/projectOrchestrator');
const { createTemplateRegistry } = require('../server/services/creative-video/html-video/templateRegistry');

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-orchestrator-modes-'));
  const templateRoot = path.join(rootDir, 'templates');
  await writeFile(path.join(templateRoot, 'simple', 'template.html-video.yaml'), [
    'id: simple',
    'name: 简单模板',
    'engine: hyperframes',
    'source_entry: index.html',
    'license:',
    '  commercial_use: true',
    '',
  ].join('\n'));
  await writeFile(path.join(templateRoot, 'simple', 'index.html'), '<html><body>{{headline}}</body></html>');
  const templateRegistry = createTemplateRegistry({ rootDir: templateRoot });
  templateRegistry.scanTemplates();

  const project = {
    project_id: 'wf_run',
    workflow_id: 'wf',
    run_id: 'run',
    template_id: 'simple',
    template_inputs: { headline: '标题' },
    output: { resolution: { width: 1080, height: 1920 }, fps: 24 },
    frames: [
      { id: 'frame_01', scene_id: 'scene_01', template_id: 'simple', inputs: { headline: '一' }, duration_sec: 2 },
      { id: 'frame_02', scene_id: 'scene_02', template_id: 'simple', inputs: { headline: '二' }, duration_sec: 2 },
    ],
    timeline: { tracks: [{ id: 'main', type: 'video', items: [] }] },
  };

  const calls = [];
  const services = {
    frameRenderer: {
      renderFrame: async (frame, options) => {
        calls.push(`render:${frame.id}`);
        await writeFile(options.outputPath, 'mp4');
        return { success: true, output_path: options.outputPath, diagnostics: [] };
      },
    },
    ffmpegComposer: {
      concatFramesWithFfmpeg: async (frames, outputPath) => {
        calls.push(`concat:${frames.length}`);
        await writeFile(outputPath, 'mp4');
        return { success: true, output_path: outputPath };
      },
      muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, output_path: videoPath, skipped: true }),
    },
  };

  const materialized = await orchestrator.materializeHtmlVideoProject({
    rootDir,
    workflowId: 'wf',
    runId: 'run',
    project,
    templateRegistry,
    services,
  });
  assert.equal(materialized.success, true);
  assert.deepEqual(calls, []);
  assert.ok(materialized.project.frames[0].html_path);

  const preview = await orchestrator.renderHtmlVideoFramePreview({
    rootDir,
    workflowId: 'wf',
    runId: 'run',
    project: materialized.project,
    templateRegistry,
    frameId: 'frame_02',
    services,
  });
  assert.equal(preview.success, true);
  assert.deepEqual(calls, ['render:frame_02']);
  assert.equal(preview.preview_frame_id, 'frame_02');

  const exported = await orchestrator.exportHtmlVideoProject({
    rootDir,
    workflowId: 'wf',
    runId: 'run',
    project: preview.project,
    templateRegistry,
    services,
  });
  assert.equal(exported.success, true);
  assert.deepEqual(calls.slice(-3), ['render:frame_01', 'render:frame_02', 'concat:2']);
  assert.equal(exported.project.exports.length, 1);

  console.log('html-video project orchestrator mode tests passed');
})();
```

- [x] **Step 2: 运行测试确认失败**

Run: `node tests/test-html-video-project-orchestrator-modes.js`

Expected: FAIL，`materializeHtmlVideoProject` 或 `renderHtmlVideoFramePreview` 未定义。

- [x] **Step 3: 拆分 orchestrator 方法**

在 `projectOrchestrator.js` 中保留现有 `renderHtmlVideoProject()` 作为兼容包装，但新增三个明确方法：

```js
async function materializeHtmlVideoProject(options = {}) {
  return renderHtmlVideoProject({ ...options, skipRender: true, mode: 'materialize' });
}

async function renderHtmlVideoFramePreview(options = {}) {
  const frameId = String(options.frameId || options.frame_id || '');
  if (!frameId) {
    return { success: false, message: '缺少要渲染的帧 ID。', diagnostics: [] };
  }
  // 先 materialize，再只渲染目标 frame，输出到 inspect/previews/{frameId}.mp4。
}

async function exportHtmlVideoProject(options = {}) {
  return renderHtmlVideoProject({ ...options, skipRender: false, mode: 'export' });
}
```

`renderHtmlVideoFramePreview()` 的实现要求：

- 调用 materializer 生成最新 HTML。
- 只找 `nextProject.frames` 中 id 等于 `frameId` 的 frame。
- 输出路径为 `inspect/previews/{frameId}.mp4`。
- 不调用 `concatFramesWithFfmpeg()`。
- 不调用 `addExport()`。
- 成功返回：

```js
{
  success: true,
  message: '单帧预览已更新。',
  project: nextProject,
  project_dir: resolvedProjectDir,
  html_video_project_path: resolvedProjectDir,
  preview_frame_id: frameId,
  preview_path: rendered.output_path,
  diagnostics,
}
```

导出方法才允许执行 concat/mux、`addExport()` 和 `addRevision()`。

- [x] **Step 4: 修改 service 分发 mode**

在 `server/services/creativeWorkflows.js` 中：

```js
async function renderCreativeWorkflowHtmlVideoProject(workflowId, payload = {}, options = {}) {
  // ...
  const mode = safeString(payload.mode || payload.action || '');
  let result;
  if (mode === 'materialize') {
    result = await orchestrator.materializeHtmlVideoProject({ ...baseOptions });
  } else if (mode === 'frame') {
    result = await orchestrator.renderHtmlVideoFramePreview({
      ...baseOptions,
      frameId: safeString(payload.frame_id || payload.frameId),
    });
  } else {
    result = await orchestrator.exportHtmlVideoProject({ ...baseOptions, skipRender: payload.skip_render === true });
  }
  // 返回结构保持 html_video_project 字段。
}

async function exportHtmlVideoProject(workflowId, payload = {}, options = {}) {
  return renderCreativeWorkflowHtmlVideoProject(workflowId, { ...payload, mode: 'export' }, options);
}
```

- [x] **Step 5: 修改路由默认文案**

`POST /render` 失败默认文案保留“渲染单帧预览失败。”，但 service 返回 materialize 成功时 message 应是“HTML 已重新生成。”；单帧成功时 message 是“单帧预览已更新。”。

`POST /export` 只调用 `exportHtmlVideoProject()`，成功 message 是“成片已导出。”或 orchestrator 返回的中文导出消息。

- [x] **Step 6: 运行测试**

Run: `node tests/test-html-video-project-orchestrator-modes.js`

Expected: PASS。

Run: `node tests/test-html-video-routes.js`

Expected: PASS。

- [x] **Step 7: 提交**

```bash
git add server/services/creative-video/html-video/projectOrchestrator.js server/services/creativeWorkflows.js server/routes/creativeWorkflows.js tests/test-html-video-project-orchestrator-modes.js tests/test-html-video-routes.js
git commit -m "拆分 html-video 渲染模式"
```

**完成标准:**
- materialize 不调用 frameRenderer 和 ffmpeg。
- single-frame preview 只渲染目标帧，不新增 exports。
- export 才执行全量 render/concat/mux 并新增 exports。

---

## Task 5: 修复前端 project 响应解析和模板字段 schema

**目标:** 前端能正确读取 `html_video_project`，模板字段面板按 `template_schema` 渲染；所有请求状态继续有中文 loading/禁用/成功/失败。

**Files:**
- Modify: `frontend-react/src/hooks/useHtmlVideoProject.js`
- Modify: `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx`
- Modify: `frontend-react/src/components/creative-video-editor/TemplateInputsPanel.jsx`
- Modify: `tests/test-html-video-api-client.mjs`
- Modify: `tests/test-html-video-editor-components.mjs`

- [x] **Step 1: 写 hook payload 解析测试**

在 `tests/test-html-video-editor-components.mjs` 或现有前端组件测试中新增断言，确保 API 返回：

```js
{
  success: true,
  html_video_project: {
    project_id: 'p1',
    template_inputs: { headline: '标题' },
    template_schema: {
      type: 'object',
      properties: { headline: { type: 'string', label: '标题' } },
    },
    frames: [{ id: 'frame_01', scene_id: 'scene_01', inputs: { headline: '标题' } }],
    exports: [],
  },
}
```

渲染后页面应包含“标题”字段输入，而不是只显示“暂无模板字段”。

如果当前测试工具不方便挂 hook，至少导出测试用 helper 或用组件测试模拟 editor props：

```js
assert.match(markup, /模板字段/);
assert.match(markup, /标题/);
assert.doesNotMatch(markup, /暂无模板字段/);
```

- [x] **Step 2: 运行测试确认失败**

Run: `node tests/test-html-video-editor-components.mjs`

Expected: FAIL，项目被解析成 wrapper 或模板 schema 为空。

- [x] **Step 3: 修改 hook payload 解析**

在 `useHtmlVideoProject.js` 修改：

```js
function getPayload(result) {
  return result?.html_video_project
    || result?.project
    || result?.data?.html_video_project
    || result?.data?.project
    || result?.data
    || result
    || null;
}
```

修改 `getExports()`：

```js
function getExports(result) {
  const payload = getPayload(result);
  if (Array.isArray(result?.exports)) return result.exports;
  if (Array.isArray(result?.html_video_project?.exports)) return result.html_video_project.exports;
  if (Array.isArray(payload?.exports)) return payload.exports;
  return [];
}
```

- [x] **Step 4: 保证 status/loading 不回退**

检查并保留：

- `load()` 设置 `status='loading'`，message 为“正在加载可编辑成片工程...”，finally 清理 loading。
- `runMutatingAction()` 使用 `mutatingRef` 防重复点击。
- `materializeProject()` loading 文案为“正在重新生成 HTML...”。
- `renderFramePreview()` loading 文案为“正在渲染单帧预览...”。
- `exportProject()` loading 文案为“正在导出成片...”。

如果按钮文案只在导出时显示 loading，给“重新生成 HTML”按钮增加状态文案：

```jsx
<button type="button" disabled={disabled} onClick={() => editor.materializeProject({})}>
  {editor.status === 'materializing' ? '正在重新生成 HTML...' : '重新生成 HTML'}
</button>
```

- [x] **Step 5: 确认 TemplateInputsPanel schema 行为**

`TemplateInputsPanel` 保持按 `schema.properties` 渲染。若 schema 为空，显示中文空状态：

```jsx
{fields.length ? fields.map(...) : <p>当前模板未声明可编辑字段。</p>}
```

不要把字段渲染逻辑塞进 `HtmlVideoProjectEditor.jsx`。

- [x] **Step 6: 运行测试和前端构建**

Run: `node tests/test-html-video-editor-components.mjs`

Expected: PASS。

Run: `node tests/test-html-video-api-client.mjs`

Expected: PASS。

Run: `npm run build:frontend`

Expected: PASS。

- [x] **Step 7: 提交**

```bash
git add frontend-react/src/hooks/useHtmlVideoProject.js frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx frontend-react/src/components/creative-video-editor/TemplateInputsPanel.jsx tests/test-html-video-api-client.mjs tests/test-html-video-editor-components.mjs
git commit -m "修复 html-video 编辑器工程响应解析"
```

**完成标准:**
- 前端 project state 是实际 HtmlVideoProject，不是 API wrapper。
- 模板字段面板能显示 `template_schema.properties`。
- 触发接口的按钮仍有中文 loading、禁用态和完成状态。

---

## Task 6: 补齐 API 返回结构和可编辑工程读取测试

**目标:** GET/render/export API 始终返回 `html_video_project`，前端和后端契约一致；workflow 完成态能读取可编辑工程。

**Files:**
- Modify: `server/services/creativeWorkflows.js:1150-1286`
- Modify: `tests/test-html-video-routes.js`
- Modify: `tests/test-creative-workflows.js`

- [x] **Step 1: 添加 GET 可编辑工程契约测试**

在 `tests/test-html-video-routes.js` 中断言 GET 响应包含：

```js
assert.equal(got.body.success, true);
assert.ok(got.body.html_video_project);
assert.equal(got.body.html_video_project_path, '/tmp/project');
assert.equal(got.body.html_video_project.template_inputs.headline, '标题');
```

render materialize 响应包含：

```js
assert.ok(rendered.body.html_video_project);
assert.equal(rendered.body.message, 'HTML 已重新生成。');
```

export 响应包含：

```js
assert.ok(exported.body.html_video_project);
assert.match(exported.body.message, /导出|渲染/);
```

- [x] **Step 2: 添加 workflow 完成态读取测试**

在 `tests/test-creative-workflows.js` 中复用 Task 1 的 html-video lite 完成态 record，调用：

```js
const htmlVideoProject = await getCreativeWorkflowHtmlVideoProject(WORKFLOW_ID, { rootDir });
assert.equal(htmlVideoProject.success, true);
assert.equal(htmlVideoProject.html_video_project_path, projectDir);
```

如果测试没有真实 `project.json`，在 projectDir 写入最小 project：

```js
fs.mkdirSync(projectDir, { recursive: true });
fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
  project_id: 'p1',
  workflow_id: WORKFLOW_ID,
  run_id: 'run-1',
  template_id: 'simple',
  template_inputs: {},
  frames: [],
  timeline: { tracks: [] },
}, null, 2));
```

- [x] **Step 3: 运行测试确认失败或确认当前契约缺口**

Run: `node tests/test-html-video-routes.js`

Expected: 如果返回结构缺字段则 FAIL。

Run: `node tests/test-creative-workflows.js`

Expected: 如果 workflow result path 仍不可读取则 FAIL。

- [x] **Step 4: 统一 service 返回结构**

确保这些 service 返回结构都包含实际 project：

```js
{
  success: true,
  workflow_id: workflowId,
  html_video_project: result.project || project,
  html_video_project_path: result.html_video_project_path || projectDir,
  output_path: result.output_path,
  preview_path: result.preview_path,
  preview_frame_id: result.preview_frame_id,
  diagnostics: result.diagnostics || [],
  message: result.message || '操作已完成。',
}
```

适用函数：

- `getCreativeWorkflowHtmlVideoProject()`
- `renderCreativeWorkflowHtmlVideoProject()`
- `renderHtmlVideoProject()`
- `exportHtmlVideoProject()`

- [x] **Step 5: 运行测试**

Run: `node tests/test-html-video-routes.js`

Expected: PASS。

Run: `node tests/test-creative-workflows.js`

Expected: PASS。

- [x] **Step 6: 提交**

```bash
git add server/services/creativeWorkflows.js tests/test-html-video-routes.js tests/test-creative-workflows.js
git commit -m "统一 html-video 工程 API 返回结构"
```

**完成标准:**
- API 统一返回 `html_video_project`。
- workflow 完成态可通过 `/html-video-project` 读取工程。
- 前端不需要猜测多种互相矛盾的 payload shape。

---

## Task 7: 全量回归、真实烟测开关和验收

**目标:** 普通测试默认稳定通过；真实 Playwright/ffmpeg smoke 仍由 `RUN_HTML_VIDEO_REAL_RENDER=1` 显式开启；修复项全部有验收证据。

**Files:**
- Modify: `tests/test-html-video-real-render-smoke.js`
- Modify: `tests/test-html-video-vertical-mvp-smoke.js`
- Modify: `docs/superpowers/plans/2026-06-17-html-video-production-review-fix-plan.md`

- [x] **Step 1: 确认真实烟测默认自跳过**

检查两个真实烟测文件开头都包含：

```js
if (process.env.RUN_HTML_VIDEO_REAL_RENDER !== '1') {
  console.log('跳过 html-video 真实渲染烟测：未设置 RUN_HTML_VIDEO_REAL_RENDER=1。');
  process.exit(0);
}
```

纵向 MVP 文件可以使用更具体中文：

```js
if (process.env.RUN_HTML_VIDEO_REAL_RENDER !== '1') {
  console.log('跳过 html-video 纵向 MVP 真实渲染烟测：未设置 RUN_HTML_VIDEO_REAL_RENDER=1。');
  process.exit(0);
}
```

- [x] **Step 2: 运行普通全量测试**

Run: `npm test`

Expected:

- 所有普通测试 PASS。
- `test-html-video-real-render-smoke.js` 输出中文跳过信息。
- `test-html-video-vertical-mvp-smoke.js` 输出中文跳过信息。
- 不启动真实 Playwright/ffmpeg。

- [x] **Step 3: 运行前端构建**

Run: `npm run build:frontend`

Expected: PASS。

- [ ] **Step 4: 可选运行真实纵向烟测**

仅在本机已安装 Playwright Chromium 和 ffmpeg 时运行：

PowerShell:

```powershell
$env:RUN_HTML_VIDEO_REAL_RENDER='1'
node tests/test-html-video-vertical-mvp-smoke.js
Remove-Item Env:\RUN_HTML_VIDEO_REAL_RENDER
```

Expected:

- 使用 `glitch_title` production-ready 模板。
- 跑通 mock scene_spec -> template_inputs -> project -> materialize -> 单帧 render -> mp4。
- 生成 mp4 非空。

如果环境未配置，记录“未运行真实烟测：本机缺少 Playwright Chromium 或 ffmpeg”，不能声称真实渲染通过。

- [x] **Step 5: 更新本计划勾选状态**

实施完成后仅把已经完成并验证的步骤从 `- [ ]` 改为 `- [x]`。不要把未执行的真实烟测勾选为完成。

- [x] **Step 6: 最终提交**

```bash
git add tests/test-html-video-real-render-smoke.js tests/test-html-video-vertical-mvp-smoke.js docs/superpowers/plans/2026-06-17-html-video-production-review-fix-plan.md
git commit -m "补齐 html-video 修复验收计划"
```

**完成标准:**
- `npm test` PASS。
- `npm run build:frontend` PASS。
- 真实烟测默认自跳过且不会污染普通测试。
- 可选真实烟测结果被如实记录。

---

## 风险与回滚策略

- **风险：html-video lite 结束旧 stage 后，旧版 HyperFrames 自由工程流程被误跳过。**  
  回滚策略：`isHtmlVideoLiteProjectResult()` 必须同时检查 project path 和 `render.status === 'rendered'`；没有这些字段的 legacy result 继续旧 check/render/inspect。

- **风险：新增 `output` 默认值改变旧 project 行为。**  
  回滚策略：`normalizeOutput()` 只在缺字段时给 1280x720/30 默认值；已有 frame-level `resolution/fps` 仍可覆盖。

- **风险：render mode 拆分后旧兼容 `POST /html-video-project` 调用行为变化。**  
  回滚策略：保留 `renderHtmlVideoProject()` 兼容包装，默认无 mode 时走 full export；显式 `mode=materialize/frame` 才走新分支。

- **风险：前端 schema 表单字段不足以表达复杂 JSON Schema。**  
  首版只支持现有 `properties`、`enum`、`boolean`、`number`、`array`、`string`；复杂 nested object 暂不做 UI 展开，但 project/API 保留 JSON 数据，不丢字段。

- **风险：真实 Playwright/ffmpeg 环境不稳定。**  
  普通测试保持 mock 和默认自跳过；真实 smoke 只在 `RUN_HTML_VIDEO_REAL_RENDER=1` 时运行。

---

## 旧模块处理

- `server/services/hyperframesRenderer.js`：保留给 legacy HyperFrames 自由工程，不用于 html-video project。
- `server/services/hyperframesFreeformQuality.js`：保留给 legacy HyperFrames 自由工程，不用于 html-video project。
- `server/services/creative-video/html-video/hyperframesPlaywrightAdapter.js`：html-video 首版真实渲染入口。
- `server/services/creative-video/html-video/frameRenderer.js`：只做 frame 到 adapter 的调度，不扩张为大渲染文件。
- `server/templates/*/manifest.yaml + source.html`：legacy 保留和迁移参考，不进入 production registry。
- `server/templates/*/template.html-video.yaml + source/index.html`：production registry 的首版模板来源。

---

## 最终验收清单

- [x] 一键 creative workflow 使用 html-video lite 成功时，不调用旧 `npx hyperframes lint/validate/inspect/render`。
- [x] workflow 完成态持久化 `result.hyperframes_freeform.project.html_video_project_path`。
- [x] `GET /api/creative-workflows/:workflowId/html-video-project` 返回实际 `html_video_project`。
- [x] 前端编辑器能读取 `html_video_project.frames` 和 `html_video_project.template_schema`。
- [x] 两个 scene 的 `scene_spec` 生成两个 frame 和两个 timeline item。
- [x] 模板 `output.resolution/fps` 传到 frame render options。
- [x] “重新生成 HTML”只 materialize，不导出 mp4，不新增 export。
- [x] “渲染单帧预览”只渲染目标 frame，不 concat/mux，不新增 export。
- [x] “导出成片”执行全量 render/concat/mux，并新增 export。
- [x] 普通 `npm test` PASS，真实 smoke 默认中文跳过。
- [x] `npm run build:frontend` PASS。

---

## 自检结果

- 已覆盖 review 中 7 个确认成立的问题。
- 已扫描并确认没有未落地标记、未细化事项或临时填充内容。
- 未要求把前端 UI 合并成大组件。
- 未要求把后端 registry、agent、store、materializer、adapter、ffmpeg、validation、edit patch 合并成大文件。
- 未把 AI 直接写完整 HTML 作为默认生产路径。
- 保留 legacy fallback，但 html-video project 不再走旧 HyperFrames CLI。
