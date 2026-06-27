# Light Agent Video Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把一键创作到 html-video 成片链路升级为可审计、可复用、prompt 更利于缓存的轻量 Agent 分阶段流水线。

**Architecture:** 保留现有服务端工作流编排，不引入独立 Agent runtime。第一版只审计真实一键链路会触发的 `research`、html-video template、`content_graph`、`frame_html` 模型调用，补齐 Agent 命名、content graph 复用入口和 `FrameHtmlAgent` prompt 前缀重排。

**Tech Stack:** Node.js CommonJS、内置 `assert` 测试、现有 `aiTextModel`、`creativeWorkflows`、`workflowFacade`、`htmlVideoWorkflow`、`projectSchema`、`projectStore`。

---

## Hard Scope

本计划只做 4 件事：

1. 文字模型调用审计：能在工作流 JSON 或 html-video `project.json` 中看到每次文字模型调用的 `agent`、`stage`、`frame_id`、`model`、`usage.cached_tokens`、耗时和成功失败。
2. `FrameHtmlAgent` prompt 重排：固定规则和模板约束前置，当前帧动态信息后置，不删除原有关键输入。
3. `content_graph` 复用：已有有效 graph 时支持跳过重新规划，允许直接重渲染帧；已有代码能复用的地方必须复用。
4. 轻量 Agent 边界：把现有阶段明确命名为小 Agent，但仍由服务端工作流决定下一步，不让模型自己调度全流程。

本计划明确不做：

- 不做独立 Agent runtime。
- 不做多 Agent 自动协商。
- 不做长上下文会话记忆。
- 不做前端统计面板。
- 不做全站 LLM observability。
- 不改变当前生成策略，不把 8 帧合并成一次模型调用。
- 不减少当前帧、node、素材、前后帧摘要等动态输入。

入口约束：

- 当前唯一产品入口是“一键创作到成片”。
- 所有实现、测试和验收都只围绕一键创作链路：`creativeWorkflows.js` → `agentRuns` / `workflowFacade` → `htmlVideoWorkflow` → render。
- 不为历史入口、备用入口、手工调试入口或已经没有 UI/API 调用的旧路径新增兼容层。
- 如果实现过程中碰到无入口旧代码、无测试覆盖的历史 fallback、或只为旧入口存在的分支，并且它阻碍当前改造，可以删除。删除前必须用 `rg` 查调用方；确认只剩无关入口或没有调用后再删。
- 删除优先于适配。不要为了无入口代码额外增加参数、抽象、桥接函数或双写逻辑。

## Existing Code Map

- Modify: `server/services/aiTextModel.js`
  - 负责真实文字模型 HTTP 调用。
  - 当前返回 `raw_response`，但没有标准化 `usage`。

- Modify: `server/services/creative-video/html-video/projectSchema.js`
  - 负责 html-video `project.json` normalize 和 checkpoint。
  - 增加 `generation_checkpoint.model_calls` 和 `appendCheckpointModelCall()`。

- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
  - 负责 html-video project 生成。
  - 现有 `resolveResumeContentGraph()`、`shouldReuseFrameHtml()`、`markCheckpointStage()` 可以复用。
  - 增加审计记录、content graph 复用模式标记、Agent 名称传递。

- Modify: `server/services/creative-video/html-video/frameHtmlAgent.js`
  - 负责单帧 HTML prompt、校验、重试。
  - 只重排 `buildFrameHtmlPrompt()`；不要删原有约束。

- Modify: `server/services/creative-video/workflowFacade.js`
  - 负责一键创作进入 html-video 之前的 scene_spec fallback 和 legacy/rich fallback。
  - 默认一键成功路径会在 html-video 成功后直接 return；不要把默认不可达的 rich/legacy 函数当成 Phase 2 审计主线。
  - 如果某些 legacy fallback 只服务非一键创作旧入口，先用 `rg` 确认调用方；无当前入口依赖时可以删，不必为它补审计。

- Modify: `server/services/creativeWorkflows.js`
  - 负责一键创作主工作流。
  - 增加 workflow record 级别的 `model_calls` 审计，覆盖 research/brief/project 这些不在 html-video project 内的调用。
  - 这是验收入口；不要把实现重心转移到其他独立入口。

- Test: `tests/test-ai-text-model.js`
  - 验证 `usage` 和 `cached_tokens` 标准化。

- Test: `tests/test-html-video-project-schema.js`
  - 验证 `generation_checkpoint.model_calls` normalize 和 append。

- Test: `tests/test-html-video-frame-html-agent.js`
  - 验证 prompt 固定前缀在动态帧信息之前。

- Test: `tests/test-html-video-workflow.js`
  - 验证 html-video project 内模型调用审计、content graph 复用。

- Test: `tests/test-creative-video-workflow-facade.js`
  - 验证默认一键 html-video 成功路径不会落入 legacy/rich fallback 审计范围。

- Test: `tests/test-creative-workflows.js`
  - 验证 workflow record 级别模型调用审计被保存。

---

## Phase 1: Text Model Usage And Audit Primitives

### Task 1.1: Standardize `usage` on `aiTextModel.callTextModel()`

**Files:**
- Modify: `server/services/aiTextModel.js`
- Test: `tests/test-ai-text-model.js`

- [ ] **Step 1: Write the failing usage extraction test**

Add this block in `tests/test-ai-text-model.js` after the first successful non-stream call assertion:

```js
  const usageResult = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'usage test' }],
    configPath,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'usage ok' } }],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 88,
          total_tokens: 1288,
          prompt_tokens_details: {
            cached_tokens: 1024,
          },
        },
      }),
    }),
  });
  assert.strictEqual(usageResult.success, true);
  assert.deepStrictEqual(usageResult.usage, {
    prompt_tokens: 1200,
    completion_tokens: 88,
    total_tokens: 1288,
    cached_tokens: 1024,
  });
```

Add a stream compatibility assertion in the existing stream test block, or add this small block near the usage test:

```js
  const streamUsageResult = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'stream usage test' }],
    configPath,
    stream: true,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      body: makeStreamResponse([
        'data: {"choices":[{"delta":{"content":"stream ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    }),
  });
  assert.strictEqual(streamUsageResult.success, true);
  assert.strictEqual(streamUsageResult.text, 'stream ok');
  assert.strictEqual(streamUsageResult.usage, null);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node tests/test-ai-text-model.js
```

Expected: FAIL because `usageResult.usage` is `undefined`.
The stream assertion may also fail because successful stream responses currently omit `usage`.

- [ ] **Step 3: Add minimal usage normalization**

In `server/services/aiTextModel.js`, add this helper near `toModelInfo()`:

```js
function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractUsage(rawResponse = {}) {
  const usage = rawResponse && typeof rawResponse === 'object' ? rawResponse.usage : null;
  if (!usage || typeof usage !== 'object') return null;
  const promptTokens = numberOrNull(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = numberOrNull(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = numberOrNull(usage.total_tokens);
  const cachedTokens = numberOrNull(
    usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens
      ?? usage.input_token_details?.cached_tokens,
  );
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    cached_tokens: cachedTokens,
  };
}
```

In every successful return that includes `raw_response: rawResponse`, add:

```js
          usage: extractUsage(rawResponse),
```

For stream responses, `raw_response` is currently `{ stream: true, chunks: events }`; if no final usage exists, `usage` must be `null`. Missing stream usage is not an error and must not change `success`. In the stream success branch, add this exact field because the variable is named `streamResult.raw_response`, not `rawResponse`:

```js
      usage: extractUsage(streamResult.raw_response),
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
node tests/test-ai-text-model.js
```

Expected: PASS and prints `ai text model tests passed`.

- [ ] **Step 5: Commit**

```powershell
git add server/services/aiTextModel.js tests/test-ai-text-model.js
git commit -m "记录文字模型 usage"
```

### Task 1.2: Add html-video project model call checkpoint storage

**Files:**
- Modify: `server/services/creative-video/html-video/projectSchema.js`
- Test: `tests/test-html-video-project-schema.js`

- [ ] **Step 1: Write the failing checkpoint normalize test**

Add this test block in `tests/test-html-video-project-schema.js` after existing checkpoint normalize assertions:

```js
{
  const project = schema.createEmptyProject({
    projectId: 'wf_run',
    workflowId: 'wf',
    runId: 'run',
  });
  schema.appendCheckpointModelCall(project, {
    agent: 'FrameHtmlAgent',
    stage: 'frame_html',
    frame_id: 'scene_01',
    model: { provider: 'OpenAI', model_id: 'gpt-test' },
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 80,
      total_tokens: 1280,
      cached_tokens: 1024,
    },
    duration_ms: 3456,
    success: true,
  });
  const normalized = schema.normalizeProject(project);
  assert.equal(normalized.generation_checkpoint.model_calls.length, 1);
  assert.deepEqual(normalized.generation_checkpoint.model_calls[0].usage, {
    prompt_tokens: 1200,
    completion_tokens: 80,
    total_tokens: 1280,
    cached_tokens: 1024,
  });
  assert.equal(normalized.generation_checkpoint.model_calls[0].agent, 'FrameHtmlAgent');
  assert.equal(normalized.generation_checkpoint.model_calls[0].frame_id, 'scene_01');
  assert.equal(typeof normalized.generation_checkpoint.model_calls[0].created_at, 'string');
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node tests/test-html-video-project-schema.js
```

Expected: FAIL because `appendCheckpointModelCall` is not exported or `model_calls` is missing.

- [ ] **Step 3: Implement the smallest schema change**

In `server/services/creative-video/html-video/projectSchema.js`:

1. Add `model_calls: []` to `defaultGenerationCheckpoint()`.
2. Add these helpers near checkpoint helpers:

```js
function normalizeModelCall(input = {}) {
  const source = objectOrEmpty(input);
  const usage = objectOrEmpty(source.usage);
  const model = objectOrEmpty(source.model);
  return {
    id: stringField(source.id),
    agent: stringField(source.agent),
    stage: stringField(source.stage),
    sub_stage: stringField(source.sub_stage),
    frame_id: stringField(source.frame_id),
    node_id: stringField(source.node_id),
    attempt: nullableNumberField(source.attempt),
    model: {
      provider: stringField(model.provider),
      model_id: stringField(model.model_id),
    },
    usage: {
      prompt_tokens: nullableNumberField(usage.prompt_tokens),
      completion_tokens: nullableNumberField(usage.completion_tokens),
      total_tokens: nullableNumberField(usage.total_tokens),
      cached_tokens: nullableNumberField(usage.cached_tokens),
    },
    duration_ms: nullableNumberField(source.duration_ms),
    success: source.success !== false,
    error: stringField(source.error),
    created_at: stringField(source.created_at),
  };
}

function appendCheckpointModelCall(project, call = {}) {
  const checkpoint = ensureGenerationCheckpoint(project);
  const calls = Array.isArray(checkpoint.model_calls) ? checkpoint.model_calls : [];
  const createdAt = new Date().toISOString();
  const id = call.id || `model_call_${String(calls.length + 1).padStart(4, '0')}`;
  checkpoint.model_calls = [
    ...calls,
    normalizeModelCall({
      ...call,
      id,
      created_at: call.created_at || createdAt,
    }),
  ].slice(-500);
  checkpoint.updated_at = createdAt;
  return project;
}
```

3. In `normalizeGenerationCheckpoint()`, preserve `model_calls`:

```js
    model_calls: arrayOrEmpty(source.model_calls).map(normalizeModelCall),
```

4. Export `appendCheckpointModelCall`.

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
node tests/test-html-video-project-schema.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/projectSchema.js tests/test-html-video-project-schema.js
git commit -m "保存 html-video 模型调用审计"
```

### Task 1.3: Add workflow record model call storage

**Files:**
- Modify: `server/services/creativeWorkflows.js`
- Test: `tests/test-creative-workflows.js`

- [ ] **Step 1: Write the failing workflow model call test**

Add a focused assertion in `tests/test-creative-workflows.js` near other record normalization or persistence tests:

```js
{
  const record = {
    workflow_id: 'wf-model-calls',
    aweme_id: '12345',
    model_calls: [],
  };
  creativeWorkflows.appendWorkflowModelCall(record, {
    agent: 'ResearchAgent',
    stage: 'research',
    model: { provider: 'OpenAI', model_id: 'gpt-test' },
    usage: {
      prompt_tokens: 900,
      completion_tokens: 120,
      total_tokens: 1020,
      cached_tokens: 0,
    },
    duration_ms: 2000,
    success: true,
  });
  assert.equal(record.model_calls.length, 1);
  assert.equal(record.model_calls[0].agent, 'ResearchAgent');
  assert.equal(record.model_calls[0].stage, 'research');
  assert.equal(record.model_calls[0].usage.prompt_tokens, 900);
  assert.equal(typeof record.model_calls[0].created_at, 'string');
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node tests/test-creative-workflows.js
```

Expected: FAIL because `appendWorkflowModelCall` is not exported.

- [ ] **Step 3: Implement minimal workflow record helper**

In `server/services/creativeWorkflows.js`, add:

```js
function normalizeModelUsage(usage = {}) {
  const source = usage && typeof usage === 'object' ? usage : {};
  const numberOrNull = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  return {
    prompt_tokens: numberOrNull(source.prompt_tokens),
    completion_tokens: numberOrNull(source.completion_tokens),
    total_tokens: numberOrNull(source.total_tokens),
    cached_tokens: numberOrNull(source.cached_tokens),
  };
}

function appendWorkflowModelCall(record, call = {}, options = {}) {
  if (!record || typeof record !== 'object') return record;
  const calls = Array.isArray(record.model_calls) ? record.model_calls : [];
  const createdAt = safeString(call.created_at) || getNow(options.services || {}) || new Date().toISOString();
  record.model_calls = [
    ...calls,
    {
      id: call.id || `model_call_${String(calls.length + 1).padStart(4, '0')}`,
      agent: safeString(call.agent),
      stage: safeString(call.stage),
      sub_stage: safeString(call.sub_stage),
      frame_id: safeString(call.frame_id),
      node_id: safeString(call.node_id),
      attempt: Number.isFinite(Number(call.attempt)) ? Number(call.attempt) : null,
      model: {
        provider: safeString(call.model?.provider),
        model_id: safeString(call.model?.model_id),
      },
      usage: normalizeModelUsage(call.usage),
      duration_ms: Number.isFinite(Number(call.duration_ms)) ? Number(call.duration_ms) : null,
      success: call.success !== false,
      error: safeString(call.error),
      created_at: createdAt,
    },
  ].slice(-500);
  return record;
}
```

Export `appendWorkflowModelCall`.

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
node tests/test-creative-workflows.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creativeWorkflows.js tests/test-creative-workflows.js
git commit -m "保存创作工作流模型调用审计"
```

---

## Phase 2: Audit Actual Pipeline Calls

### Task 2.1: Audit html-video model calls into `project.json`

**Files:**
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Modify: `server/services/creative-video/html-video/projectSchema.js`
- Test: `tests/test-html-video-workflow.js`

- [ ] **Step 1: Write the failing html-video audit test**

Add a test in `tests/test-html-video-workflow.js` that runs a tiny raw HTML workflow with a fake model returning `usage`.

Use the existing test helper templates in `tests/test-html-video-workflow.js`. Pass a locked template so this specific ordered fake test is not consumed by template selection first:

```js
preferredTemplateId: 'vertical',
lockTemplate: true,
target: { html_video_generation_mode: 'raw_html' },
```

Before relying on `preferredTemplateId: 'vertical'`, confirm the test registry really registers a template with id `vertical` after `createVerticalTemplate(templateRoot)` and `templateRegistry.scanTemplates()`. The lock shortcut only works when `compactIndex.find(item => item.id === preferredId)` finds that template. If the helper template id changes, use the actual id from the test registry.

The fake `sceneSpec` for this test must include a non-empty `scenes` array. `raw_html` mode fails before content graph generation when `hasSceneSpecScenes(sceneSpec)` is false.

The test should assert the saved `project.json` contains at least:

```js
const savedProject = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8'));
const calls = savedProject.generation_checkpoint.model_calls;
assert.ok(calls.length >= 2);
assert.ok(calls.some(call => call.agent === 'ContentGraphAgent' && call.stage === 'content_graph'));
assert.ok(calls.some(call => call.agent === 'FrameHtmlAgent' && call.stage === 'frame_html' && call.frame_id === 'scene_01'));
assert.ok(calls.every(call => call.model.model_id === 'gpt-test'));
assert.ok(calls.some(call => call.usage.cached_tokens === 1024));
```

Use fake model responses in this order:

1. content graph JSON response.
2. frame HTML response for `scene_01`.

Return this shape from fake model:

```js
return {
  success: true,
  text,
  model: { provider: 'OpenAI', model_id: 'gpt-test' },
  usage: {
    prompt_tokens: 1200,
    completion_tokens: 80,
    total_tokens: 1280,
    cached_tokens: 1024,
  },
};
```

Add a second small test for the real html-video template calls. Do not use ordered fake responses for this one; branch by `request.audit.stage`:
This test must keep `lockTemplate` false or omitted, and must use `target: { html_video_generation_mode: 'template_inputs' }`. A locked template short-circuits template selection before the model call, and `raw_html` mode skips template input filling.

```js
const templateAuditRequests = [];
const templateAuditResult = await workflow.generateHtmlVideo({
  workflowId: 'wf-template-audit',
  runId: 'run-template-audit',
  rootDir,
  sceneSpec: {
    title: '模板审计',
    aspect_ratio: '16:9',
    scenes: [{ id: 'scene_01', duration: 4, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: [] } }],
  },
  creativeContext: { input: { raw_text: '模板审计' } },
  target: { html_video_generation_mode: 'template_inputs' },
  lockTemplate: false,
  templateRegistry,
  skipValidation: true,
  services: {
    aiTextModel: {
      callTextModel: async request => {
        templateAuditRequests.push(request);
        if (request.audit?.stage === 'template_selection') {
          return { success: true, text: JSON.stringify({ template_id: 'simple', reason: '测试', confidence: 1 }), model: { provider: 'OpenAI', model_id: 'gpt-test' }, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cached_tokens: 0 } };
        }
        if (request.audit?.stage === 'template_inputs') {
          return { success: true, text: JSON.stringify({ headline: '标题' }), model: { provider: 'OpenAI', model_id: 'gpt-test' }, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cached_tokens: 0 } };
        }
        throw new Error(`unexpected audit stage: ${request.audit?.stage || 'missing'}`);
      },
    },
    environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
    frameRenderer: { renderFrame: async () => ({ success: true, output_path: path.join(rootDir, 'frame.mp4'), diagnostics: [] }) },
    ffmpegComposer: {
      concatFramesWithFfmpeg: async (frames, outputPath) => { await writeFile(outputPath, 'mp4'); return { success: true, output_path: outputPath }; },
      concatAudioWithFfmpeg: async () => ({ success: true, skipped: true }),
      muxAudioWithFfmpeg: async ({ videoPath }) => ({ success: true, skipped: true, output_path: videoPath }),
    },
    visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
  },
});
assert.equal(templateAuditResult.success, true);
const templateAuditProject = await readProjectJson(templateAuditResult.html_video_project_path);
assert.ok(templateAuditProject.generation_checkpoint.model_calls.some(call => call.agent === 'TemplateSelectorAgent' && call.stage === 'template_selection'));
assert.ok(templateAuditProject.generation_checkpoint.model_calls.some(call => call.agent === 'TemplateInputAgent' && call.stage === 'template_inputs'));
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected: FAIL because `generation_checkpoint.model_calls` is empty.

- [ ] **Step 3: Implement audited model wrapper in `htmlVideoWorkflow.js`**

In `server/services/creative-video/html-video/htmlVideoWorkflow.js`:

1. Import `appendCheckpointModelCall`:

```js
const { normalizeProject, markCheckpointStage, markCheckpointFrame, appendCheckpointModelCall } = require('./projectSchema');
```

2. Add helper functions near `getModel()`:

```js
function auditMetaFromOptions(options = {}) {
  const source = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const meta = source.audit && typeof source.audit === 'object' && !Array.isArray(source.audit) ? source.audit : {};
  const rest = { ...source };
  delete rest.audit;
  return { meta, rest };
}

async function appendProjectModelCall(projectDir, call = {}) {
  if (!projectDir) return;
  try {
    await projectStore.writeProjectJson(projectDir, current => {
      appendCheckpointModelCall(current, call);
      return current;
    });
  } catch (_) {
    // 模型调用审计不能影响成片生成。
  }
}

function createAuditedTextModel(model, defaults = {}) {
  if (!model || typeof model.callTextModel !== 'function') return model;
  return {
    ...model,
    callTextModel: async request => {
      const { meta, rest } = auditMetaFromOptions(request);
      const startedAt = Date.now();
      const response = await model.callTextModel(rest);
      if (!meta.agent && !meta.stage) return response;
      await appendProjectModelCall(defaults.projectDir, {
        agent: meta.agent || defaults.agent || '',
        stage: meta.stage || defaults.stage || '',
        sub_stage: meta.sub_stage || defaults.sub_stage || '',
        frame_id: meta.frame_id || '',
        node_id: meta.node_id || '',
        attempt: meta.attempt,
        model: response?.model || {},
        usage: response?.usage || {},
        duration_ms: Date.now() - startedAt,
        success: response?.success !== false,
        error: response?.success === false ? response?.message || 'AI 调用失败。' : '',
      });
      return response;
    },
  };
}
```

3. When the project directory is known, wrap the model once:

```js
const model = createAuditedTextModel(getModel(services), { projectDir });
```

Use the wrapped model for `generateContentGraphWithRetry()`, `requestTemplateSelection()`, `requestTemplateInputs()` and `frameHtmlAgent.generateFrameHtml()`.

Every html-video text model call that should appear in `model_calls` must pass `audit`. Calls without `audit.agent` and `audit.stage` are intentionally not recorded, so missing audit metadata does not create blank rows.

4. When calling local `callTextModel()` for content graph, pass audit metadata:

```js
await callTextModel(model, originalPrompt, {
  audit: {
    agent: 'ContentGraphAgent',
    stage: 'content_graph',
    sub_stage: 'content_graph',
    attempt: 1,
  },
});
```

For retries, increment `attempt` and keep the same `agent`/`stage`.

Preserve existing retry options when adding audit metadata. For example, keep `stream: false` on content graph retry calls:

```js
graphAi = ensureGraphAiHasText(await callTextModel(model, retryPrompt, {
  stream: false,
  audit: {
    agent: 'ContentGraphAgent',
    stage: 'content_graph',
    sub_stage: 'content_graph',
    attempt: 2,
  },
}));
```

The local `callTextModel(model, prompt, options = {})` signature in `htmlVideoWorkflow.js` already accepts `options`; keep that signature and pass `audit` inside `options`. The audited wrapper must remove `audit` before forwarding to the real provider so the HTTP request body does not receive unknown metadata.

5. Add audit metadata to html-video template calls in `htmlVideoWorkflow.js`:

```js
const ai = await callTextModel(model, prompt, {
  audit: {
    agent: 'TemplateSelectorAgent',
    stage: 'template_selection',
    sub_stage: 'template_select',
    attempt: 1,
  },
});
```

```js
const ai = await callTextModel(model, prompt, {
  audit: {
    agent: 'TemplateInputAgent',
    stage: 'template_inputs',
    sub_stage: 'template_inputs',
    attempt: 1,
  },
});
```

These are the template calls on the real one-click html-video path. Do not rely on `workflowFacade.js` rich/legacy template functions for one-click template audit.

6. For frame HTML generation, pass audit metadata inside `modelOptions`:

```js
modelOptions: {
  ...FRAME_HTML_MODEL_OPTIONS,
  audit: {
    agent: 'FrameHtmlAgent',
    stage: 'frame_html',
    sub_stage: 'frame_html',
    frame_id: node.id || sceneId,
    node_id: node.id || '',
    attempt: 1,
  },
},
```

For short prompt retry, set `attempt: 2`.

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/htmlVideoWorkflow.js server/services/creative-video/html-video/projectSchema.js tests/test-html-video-workflow.js
git commit -m "审计 html-video 文字模型调用"
```

### Task 2.2: Keep `workflowFacade` legacy/spec paths out of one-click audit

**Files:**
- Modify: `server/services/creative-video/workflowFacade.js`
- Test: `tests/test-creative-video-workflow-facade.js`

- [ ] **Step 1: Write the characterization test for the real default path**

Add or update a test in `tests/test-creative-video-workflow-facade.js` proving that default one-click project generation returns after successful html-video and does not enter `workflowFacade.js` rich/legacy template paths.

Use an injected `htmlVideoWorkflow.generateHtmlVideo()` that succeeds, and an `aiTextModel.callTextModel()` that throws if called:

```js
let modelCalls = 0;
const result = await workflowFacade.generateCreativeVideoProject({
  workflowId: 'wf-html-video-short-circuit',
  runId: 'run-html-video-short-circuit',
  rootDir,
  creativeContext: {
    brief: {
      title: '已有分镜',
      storyboard: [{
        id: 'scene_01',
        order: 1,
        duration: 4,
        narration_text: '旁白',
        visual_text: { headline: '标题', keywords: [], cards: [] },
      }],
    },
    audio: {
      status: 'ready',
      path: 'tts.wav',
      scenes: [{ id: 'scene_01', duration: 4, narration_text: '旁白', captions: [] }],
    },
  },
  target: {},
  services: {
    aiTextModel: {
      callTextModel: async () => {
        modelCalls += 1;
        throw new Error('workflowFacade legacy/spec model calls should not run on default html-video success path');
      },
    },
    htmlVideoWorkflow: {
      generateHtmlVideo: async () => ({
      success: true,
        render_mode: 'html-video',
        html_video_project_path: path.join(rootDir, 'project'),
        diagnostics: [],
        project: { frames: [] },
      }),
    },
  },
});
assert.equal(result.success, true);
assert.equal(result.render_mode, 'html-video');
assert.equal(modelCalls, 0);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node tests/test-creative-video-workflow-facade.js
```

Expected before any cleanup: PASS if the current short-circuit behavior is already protected. If it fails, fix the default path before touching audit.

- [ ] **Step 3: Run the mandatory reachability check before editing legacy functions**

Before editing `workflowFacade.js`, run the legacy reachability check below. This check is mandatory for Task 2.2; do not decide whether to keep or delete these functions from memory:

- `requestSceneSpec`
- `requestFrameSpecs`
- `tryRichTemplate`
- `requestTemplateSelection`
- `requestTemplateInputs`
- `requestHtmlFill`

```powershell
rg -n "requestSceneSpec|requestFrameSpecs|tryRichTemplate|requestTemplateSelection|requestTemplateInputs|requestHtmlFill|legacyFallbackEnabled|HTML_VIDEO_LEGACY_FALLBACK_ENABLED" server/services tests
```

If `rg` is unavailable in that shell, use PowerShell fallback:

```powershell
Get-ChildItem -Path server/services,tests -Recurse -Filter *.js | Select-String -Pattern "requestSceneSpec|requestFrameSpecs|tryRichTemplate|requestTemplateSelection|requestTemplateInputs|requestHtmlFill|legacyFallbackEnabled|HTML_VIDEO_LEGACY_FALLBACK_ENABLED"
```

- [ ] **Step 4: Do not add audit to default-unreachable legacy paths**

Do not add `BriefAgent`, `TemplateSelectorAgent`, `TemplateInputAgent`, or `LegacyHtmlFillAgent` audit metadata to `workflowFacade.js` rich/legacy functions unless the reachability check proves they are still part of the current one-click entry.

If the check confirms those functions are only legacy fallback/debug paths:

- Leave them un-audited if deleting them would expand this task.
- Delete them only if they are already being touched and no one-click test depends on them.
- Do not add constants for them in `agentStages.js`.
- Do not include them in Phase 6 manual model-call expectations.

If the check proves `requestSceneSpec()` is reachable from current one-click flows without voiced storyboard/audio, treat it as a fallback SceneSpec call, not as the primary `BriefAgent` path. Add audit only to that reachable fallback and add a test that exercises the no-storyboard branch.

- [ ] **Step 5: Run the characterization test**

Run:

```powershell
node tests/test-creative-video-workflow-facade.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add server/services/creative-video/workflowFacade.js tests/test-creative-video-workflow-facade.js
git commit -m "限定一键创作审计入口"
```

### Task 2.3: Audit top-level one-click workflow research calls

**Files:**
- Modify: `server/services/creativeWorkflows.js`
- Test: `tests/test-creative-workflows.js`

- [ ] **Step 1: Write the failing top-level audit test**

Add a unit test around `runResearchProvider()` or an existing workflow test with injected `aiTextModel`.

Use a fake model that records `audit`:

```js
const requests = [];
const result = await creativeWorkflows.runResearchProvider({
  query: '测试主题',
  aiModelConfig: {
    getRuntimeConfig: async () => ({ modelId: 'gpt-test' }),
  },
  aiTextModel: {
    callTextModel: async request => {
      requests.push(request);
      return {
        success: true,
        text: '研究摘要',
        raw_response: {},
        model: { provider: 'OpenAI', model_id: 'gpt-test' },
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cached_tokens: 0 },
      };
    },
  },
});
assert.equal(result.summary, '研究摘要');
assert.equal(requests[0].audit.agent, 'ResearchAgent');
assert.equal(requests[0].audit.stage, 'research');
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node tests/test-creative-workflows.js
```

Expected: FAIL because research requests do not include `audit`.

- [ ] **Step 3: Add audit metadata to research provider calls**

In `runResearchProvider()` in `server/services/creativeWorkflows.js`, add to the first `textModelService.callTextModel()`:

```js
      audit: {
        agent: 'ResearchAgent',
        stage: 'research',
        sub_stage: 'web_search_request',
        attempt: 1,
      },
```

Add to `finalResult` call:

```js
        audit: {
          agent: 'ResearchAgent',
          stage: 'research',
          sub_stage: 'web_search_summary',
          attempt: 1,
        },
```

Both research calls must be annotated when they run:

- first provider call: `sub_stage: 'web_search_request'`
- final summary call after tool results: `sub_stage: 'web_search_summary'`

Do not stop after only tagging the first call; otherwise Phase 6 may undercount research model calls.

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
node tests/test-creative-workflows.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creativeWorkflows.js tests/test-creative-workflows.js
git commit -m "标记联网研究 Agent 调用"
```

---

## Phase 3: FrameHtmlAgent Prompt Cache Prefix

### Task 3.1: Lock prompt section order with a failing test

**Files:**
- Modify: `tests/test-html-video-frame-html-agent.js`
- Modify: `server/services/creative-video/html-video/frameHtmlAgent.js`

- [ ] **Step 1: Write the failing order test**

Add this assertion after the existing `prompt` construction in `tests/test-html-video-frame-html-agent.js`:

```js
const fixedRuleIndex = prompt.indexOf('硬性要求：');
const templateIndex = prompt.indexOf('Selected template metadata');
const dynamicInputIndex = prompt.indexOf('---- 本次动态输入 ----');
const currentFrameIndex = prompt.indexOf('当前帧：');
assert.ok(fixedRuleIndex > 0, 'prompt should include fixed rules');
assert.ok(templateIndex > fixedRuleIndex, 'template metadata should stay in the stable prefix');
assert.ok(dynamicInputIndex > templateIndex, 'dynamic input delimiter should come after fixed/template sections');
assert.ok(currentFrameIndex > dynamicInputIndex, 'current frame details should be after dynamic input delimiter');
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node tests/test-html-video-frame-html-agent.js
```

Expected: FAIL because `---- 本次动态输入 ----` does not exist and `当前帧：` appears before fixed/template sections.

- [ ] **Step 3: Reorder `buildFrameHtmlPrompt()` only**

In `server/services/creative-video/html-video/frameHtmlAgent.js`, change only the array order returned by `buildFrameHtmlPrompt()`.

Keep the existing local variables at the top of the function. Do not replace `resolution` with direct `target.width`/`target.height`; `resolveResolution(target)` is required because callers may pass `{ resolution: { width, height } }`.
`adjacentSummary()` and `nodeSummary()` already exist in `frameHtmlAgent.js`; do not add duplicate helpers and do not import them from `htmlVideoWorkflow.js`.

```js
  const resolution = resolveResolution(target);
  const adjacent = adjacentSummary(graph, index);
  const templateSource = readTemplateSourceSnippet(template);
  const continuitySection = buildVisualContinuitySection({
    visualStyleReferenceHtml,
    previousFrameHtml,
  });
```

The new order must be:

```js
  return [
    '你是 html-video 单帧完整 HTML 生成器。',
    '请输出 exactly one fenced ```html code block 或一个完整 HTML document；不要输出解释、Markdown 说明或 HTML 之外的 prose。',
    '',
    '固定系统规则：',
    `Target resolution：${resolution.width}x${resolution.height}，画面必须 full-bleed ${resolution.width}x${resolution.height}，不要留白边或浏览器默认 margin。`,
    `必须按目标尺寸生成 root canvas：meta viewport、html/body 或主舞台容器都必须是 ${resolution.width}x${resolution.height}；不能交换宽高。`,
    `必须包含明确根画布 contract：body 或 #root 带 data-hv-canvas、data-width="${resolution.width}"、data-height="${resolution.height}"；普通装饰元素可有自己的 width/height，但不能替代根画布。`,
    '',
    '硬性要求：',
    // keep every existing hard requirement line here, unchanged
    '',
    'Selected template metadata（用于理解模板身份、输入语义和适配边界）：',
    templateStyleReference(template),
    // keep existing template source section here
    ...continuitySection,
    '',
    '---- 本次动态输入 ----',
    `当前帧：${node.id || `frame_${index + 1}`}（${index + 1}/${total}）`,
    '当前 frame content graph node：',
    nodeSummary(node),
    '',
    `Whole video synopsis：${compactText(graph.synopsis || sceneSpec.title || '', 500)}`,
    `上一帧：${adjacent.previous || '无'}`,
    `下一帧：${adjacent.next || '无'}`,
    '',
    'Source context summary：',
    summarizeCreativeContextForPrompt(creativeContext) || '（无）',
    '',
    'scene_spec 摘要：',
    JSON.stringify({
      title: sceneSpec.title || '',
      scenes: Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [],
    }, null, 2),
    '',
    '请返回：',
    '```html',
    '<!doctype html>',
    '<html>...</html>',
    '```',
  ].join('\n');
```

Do not remove any existing hard requirement line. Move them as a block.
Implementation order inside this step is mandatory:

1. Copy the entire current `硬性要求：` block into the new stable-prefix location.
2. Move template metadata/source and continuity sections before `---- 本次动态输入 ----`.
3. Move frame-specific details after `---- 本次动态输入 ----`.
4. Only then delete the old duplicated order.

This is required for prompt-cache behavior: fixed rules, output format, HTML/CSS constraints, template metadata/source, and visual continuity must appear before `---- 本次动态输入 ----`; frame id, node JSON, scene spec, source context, assets, and user-specific content must appear after it.
`compactText()` is local to `frameHtmlAgent.js`; `summarizeCreativeContextForPrompt()` is imported from `./contentGraphAgent` at the top of the file. Keep both usages.

- [ ] **Step 4: Run the frame prompt test**

Run:

```powershell
node tests/test-html-video-frame-html-agent.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/frameHtmlAgent.js tests/test-html-video-frame-html-agent.js
git commit -m "优化单帧 HTML prompt 缓存前缀"
```

### Task 3.2: Keep continuity context but avoid expanding this task

**Files:**
- Modify: none unless Task 3.1 breaks existing tests.

- [ ] **Step 1: Verify existing continuity expectations still pass**

Run:

```powershell
node tests/test-html-video-frame-html-agent.js
```

Expected: PASS for assertions containing:

- `全片视觉锚点`
- `相邻上一帧`
- `orange-signal`
- `orange-flow`

- [ ] **Step 2: Do not replace previous HTML with summaries in this phase**

No code change. The current task is prompt order only. Summarizing previous HTML can be a later optimization after audit data confirms prompt size is still a problem.

---

## Phase 4: Content Graph Reuse

### Task 4.1: Make graph reuse explicit in project checkpoint

**Files:**
- Modify: `server/services/creative-video/html-video/projectSchema.js`
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Test: `tests/test-html-video-workflow.js`

- [ ] **Step 1: Write the failing graph reuse checkpoint test**

Add a test that runs html-video workflow twice with the same `workflowId`, `runId`, `sceneSpec`, and template.

The second run fake model should throw if content graph is requested:

```js
const fakeModel = {
  callTextModel: async request => {
    if (request.audit?.stage === 'content_graph') {
      throw new Error('content graph should be reused');
    }
    return {
      success: true,
      text: '<!doctype html><html><body data-hv-canvas data-width="1920" data-height="1080"><main data-frame-id="scene_01"><h1 data-text-key="headline">标题</h1><p data-text-key="subtitle">副标题</p><section data-text-key="body">正文</section></main><style>@keyframes a{from{opacity:0}to{opacity:1}}main{animation:a 1s}</style></body></html>',
      model: { provider: 'OpenAI', model_id: 'gpt-test' },
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cached_tokens: 0 },
    };
  },
};
```

Assert after the second run:

```js
const savedProject = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8'));
assert.equal(savedProject.generation_checkpoint.stages.content_graph.status, 'done');
assert.equal(savedProject.generation_checkpoint.stages.content_graph.reused, true);
assert.ok(savedProject.generation_checkpoint.model_calls.every(call => call.stage !== 'content_graph' || call.created_at < secondRunStartedAt));
```

If comparing timestamps is awkward in the existing test style, assert the model did not receive a `content_graph` request by counting fake model calls.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected: FAIL because `content_graph.reused` is not normalized or not set.

- [ ] **Step 3: Preserve `reused` on content graph checkpoint stage**

In `projectSchema.normalizeGenerationCheckpoint()`, in `content_graph`, add:

```js
        reused: objectOrEmpty(stages.content_graph).reused === true,
```

In `htmlVideoWorkflow.js`, when `contentGraph` is reused:

```js
markCheckpointStage(current, 'content_graph', {
  status: 'done',
  reused: true,
  diagnostic_code: '',
});
```

When new graph is generated, set:

```js
reused: false,
```

inside the existing `markCheckpointStage(current, 'content_graph', { status: 'done', ... })`.

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/projectSchema.js server/services/creative-video/html-video/htmlVideoWorkflow.js tests/test-html-video-workflow.js
git commit -m "标记 content graph 复用状态"
```

### Task 4.2: Add a backend-only restyle/re-render entry flag

**Files:**
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Test: `tests/test-html-video-workflow.js`

- [ ] **Step 1: Write the failing restyle-only test**

Add a test that prepares an existing project with valid `content-graph.json`, then runs workflow with:

```js
projectOptions: {
  reuseContentGraph: true,
  regenerateFrameHtml: true,
}
```

Expected behavior:

- Content graph model call is skipped.
- Frame HTML model call is made.
- Existing graph remains.
- Existing frame HTML checkpoint is invalidated so frames are regenerated.

Assert:

```js
assert.equal(contentGraphCalls, 0);
assert.equal(frameHtmlCalls, 1);
assert.equal(savedProject.generation_checkpoint.stages.content_graph.reused, true);
assert.equal(savedProject.generation_checkpoint.stages.frame_html.frames.scene_01.status, 'done');
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected: FAIL because `reuseContentGraph` / `regenerateFrameHtml` are not implemented.

- [ ] **Step 3: Implement the smallest backend flags**

In `htmlVideoWorkflow.js`, read options near generation mode setup:

```js
const reuseContentGraphRequested = options.reuseContentGraph === true || options.projectOptions?.reuseContentGraph === true;
const regenerateFrameHtmlRequested = options.regenerateFrameHtml === true || options.projectOptions?.regenerateFrameHtml === true;
```

Use existing `resolveResumeContentGraph()` first. If `reuseContentGraphRequested` is true and no reusable graph exists, fail with a clear diagnostic:

```js
return failure('未找到可复用的 content graph，无法只换风格重渲染。', [
  createDiagnostic({
    code: 'content_graph_reuse_missing',
    stage: 'project',
    sub_stage: 'content_graph',
    user_message: '未找到可复用的内容图，请先完整生成一次视频。',
    retryable: false,
  }),
], {
  html_video_project_path: projectDir,
  project_dir: projectDir,
});
```

When `regenerateFrameHtmlRequested` is true, make `shouldReuseFrameHtml()` return false by passing:

```js
resumeAllowed: resumeAllowed && !regenerateFrameHtmlRequested,
```

Do not add frontend controls in this task.
`reuseContentGraph` and `regenerateFrameHtml` are backend-only options passed through `options` / `projectOptions`. Do not add buttons, toggles, route UI, API client fields, or settings UI for them in this task.

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/htmlVideoWorkflow.js tests/test-html-video-workflow.js
git commit -m "支持复用内容图重渲染帧"
```

---

## Phase 5: Lightweight Agent Boundaries

### Task 5.1: Centralize Agent names as constants

**Files:**
- Create: `server/services/creative-video/agentStages.js`
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Modify: `server/services/creativeWorkflows.js`
- Test: existing tests from Phase 2.

- [ ] **Step 1: Create constants after Phase 2 tests are green**

Create `server/services/creative-video/agentStages.js`:

```js
const AGENTS = {
  research: 'ResearchAgent',
  templateSelector: 'TemplateSelectorAgent',
  templateInput: 'TemplateInputAgent',
  contentGraph: 'ContentGraphAgent',
  frameHtml: 'FrameHtmlAgent',
};

const STAGES = {
  research: 'research',
  templateSelection: 'template_selection',
  templateInputs: 'template_inputs',
  contentGraph: 'content_graph',
  frameHtml: 'frame_html',
};

module.exports = {
  AGENTS,
  STAGES,
};
```

- [ ] **Step 2: Replace string literals only where audit metadata is set**

In files modified by Phase 2, replace only audit metadata values:

For `server/services/creative-video/workflowFacade.js` only if Task 2.2 proves a reachable fallback audit is needed:

```js
const { AGENTS, STAGES } = require('./agentStages');
```

For `htmlVideoWorkflow.js`, path is:

```js
const { AGENTS, STAGES } = require('../agentStages');
```

For `creativeWorkflows.js`, path is:

```js
const { AGENTS, STAGES } = require('./creative-video/agentStages');
```

Examples:

```js
agent: AGENTS.contentGraph,
stage: STAGES.contentGraph,
```

Do not rename existing workflow stage IDs like `brief`, `project`, `render`.
Do not add constants for code paths that are not used by one-click creation. If Task 2.2 proves `requestHtmlFill()` is still reachable from one-click creation, add this one extra constant at that time:

```js
legacyHtmlFill: 'LegacyHtmlFillAgent',
```

If Task 2.2 deletes `requestHtmlFill()`, do not keep `legacyHtmlFill` in `AGENTS`.

- [ ] **Step 3: Run all affected tests**

Run:

```powershell
node tests/test-creative-workflows.js
node tests/test-creative-video-workflow-facade.js
node tests/test-html-video-workflow.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add server/services/creative-video/agentStages.js server/services/creative-video/html-video/htmlVideoWorkflow.js server/services/creativeWorkflows.js
git commit -m "统一轻量 Agent 阶段命名"
```

### Task 5.2: Add generated artifact summary for handoff

**Files:**
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Test: `tests/test-html-video-workflow.js`

- [ ] **Step 1: Write the failing artifact summary test**

After a successful html-video workflow run, assert:

```js
const savedProject = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8'));
assert.deepEqual(savedProject.generation_checkpoint.agent_pipeline, [
  { agent: 'ContentGraphAgent', stage: 'content_graph', artifact: 'content-graph.json' },
  { agent: 'FrameHtmlAgent', stage: 'frame_html', artifact: 'frames' },
]);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected: FAIL because `agent_pipeline` is missing.

- [ ] **Step 3: Add normalized pipeline summary**

In `projectSchema.defaultGenerationCheckpoint()` add:

```js
    agent_pipeline: [],
```

In `normalizeGenerationCheckpoint()` add:

```js
    agent_pipeline: arrayOrEmpty(source.agent_pipeline).map(item => ({
      agent: stringField(objectOrEmpty(item).agent),
      stage: stringField(objectOrEmpty(item).stage),
      artifact: stringField(objectOrEmpty(item).artifact),
    })),
```

In `htmlVideoWorkflow.js`, near successful completion after frames are generated, write:

```js
current.generation_checkpoint.agent_pipeline = [
  { agent: AGENTS.contentGraph, stage: STAGES.contentGraph, artifact: 'content-graph.json' },
  { agent: AGENTS.frameHtml, stage: STAGES.frameHtml, artifact: 'frames' },
];
```

Do not use this field for control flow. It is documentation inside the artifact.

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/projectSchema.js server/services/creative-video/html-video/htmlVideoWorkflow.js tests/test-html-video-workflow.js
git commit -m "记录 html-video Agent 产物链路"
```

---

## Phase 6: End-To-End Verification

### Task 6.1: Run focused regression tests

**Files:**
- No code changes.

- [ ] **Step 1: Run text model tests**

```powershell
node tests/test-ai-text-model.js
```

Expected: PASS.

- [ ] **Step 2: Run html-video schema and prompt tests**

```powershell
node tests/test-html-video-project-schema.js
node tests/test-html-video-frame-html-agent.js
node tests/test-html-video-workflow.js
```

Expected: PASS.

- [ ] **Step 3: Run workflow facade and one-click workflow tests**

```powershell
node tests/test-creative-video-workflow-facade.js
node tests/test-creative-workflows.js
```

Expected: PASS.

- [ ] **Step 4: Run retry/resume tests because content graph reuse changed**

```powershell
node tests/test-creative-workflow-retry-e2e.js
node tests/test-creative-workflow-retry-task.js
node tests/test-html-video-frame-html-resume.js
```

Expected: PASS.
These files exist in the current repository. If a future branch removes or renames one, replace this step with the closest retry/resume test that still covers content graph and frame HTML reuse.

### Task 6.2: Manual 8-frame validation checklist

**Files:**
- No code changes unless a real failure is found.

- [ ] **Step 1: Run one real 8-frame generation**

Use the existing UI or existing task runner. Keep the same text model token configured for this project.

- [ ] **Step 2: Inspect workflow JSON**

Open latest file under:

```text
data/creative-workflows/
```

Expected:

- `model_calls` exists or linked project contains `generation_checkpoint.model_calls`.
- Research calls show `agent: "ResearchAgent"` when research is enabled.
- Project generation calls show html-video agents: `TemplateSelectorAgent` / `TemplateInputAgent` when those template model calls actually run, plus `ContentGraphAgent` and `FrameHtmlAgent` for raw HTML generation.
- Do not expect `workflowFacade.js` `scene_spec` / `frame_specs` audit rows on the normal voiced-storyboard html-video success path; that path usually maps `scene_spec` locally before entering html-video.

- [ ] **Step 3: Inspect html-video project**

Open:

```text
data/media/<workflow_id>/agent_runs/<run_id>-html-video/project.json
```

Expected:

- `generation_checkpoint.model_calls` contains one `content_graph` call for a normal run.
- `generation_checkpoint.model_calls` contains one `frame_html` call per generated frame, plus retry calls if retries happened.
- `generation_checkpoint.model_calls` does not contain blank `agent` / blank `stage` rows from unannotated template calls.
- `usage.cached_tokens` is present as a number or `null`.
- `generation_checkpoint.agent_pipeline` lists content graph and frame HTML.

- [ ] **Step 4: Compare prompt cache**

Check provider usage records for the project token.

Expected:

- Cache percentage should be higher than the previous 1% when the provider reports prompt cache.
- If it is still low, do not add caching code immediately. First inspect `model_calls[].usage.cached_tokens` by stage to see whether cache misses are concentrated in `frame_html`, `content_graph`, or research.

- [ ] **Step 5: Compare output quality**

Check the generated MP4.

Expected:

- No missing frames.
- No layout regression.
- Frame styles are at least as consistent as before.
- Visible text still reflects the current frame content.
- Template default text does not leak.

---

## Self-Review Checklist For The Implementing Agent

- [ ] Every production behavior change has a failing test first.
- [ ] The implementation serves only the one-click creation entry.
- [ ] Phase 2 audit points were verified against the actual one-click call path, not only direct unit calls to helper functions.
- [ ] `workflowFacade.js` rich/legacy functions were not given audit metadata unless reachability checks proved they still run in the current one-click entry.
- [ ] Before preserving any legacy/fallback path, `rg` confirmed it is still reachable from one-click creation.
- [ ] Unreachable old paths touched by this work were deleted instead of adapted.
- [ ] No frontend panel was added.
- [ ] No independent Agent runtime was added.
- [ ] No new dependency was added.
- [ ] Existing `resolveResumeContentGraph()` and `shouldReuseFrameHtml()` were reused instead of duplicating graph/frame reuse logic.
- [ ] `FrameHtmlAgent` prompt still contains all previous hard requirements.
- [ ] Dynamic frame details appear after `---- 本次动态输入 ----`.
- [ ] `usage.cached_tokens` is stored without reading secrets or storing API keys.
- [ ] Audit write failures do not break video generation.
- [ ] All focused tests in Phase 6 pass.
