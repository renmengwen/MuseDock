# One-Click Video Editable Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stable one-click video pipeline that stores editable `scene_spec`, generates HyperFrames projects deterministically, and lets users edit captions, narration, visual text, scene duration/order, single-scene rewrites, and local TTS after the first black-box generation succeeds.

**Architecture:** AI produces structured `scene_spec` instead of full project files. Backend code is split into pure domain logic, deterministic project composition, render adapters, workflow persistence, and HTTP routes. Frontend editing is componentized behind a dedicated hook; `OneClickCreativePage.jsx` only opens the editor and passes `workflowId`.

**Tech Stack:** Node.js CommonJS services, Express routes, React 19 components/hooks, HyperFrames CLI, ffmpeg, existing `node tests/*.js` and `node tests/*.mjs` test style.

---

## Boundary Rules For Junior Implementers

These rules are part of the implementation contract. Do not merge layers to reduce file count.

### Backend Layer Boundaries

- `server/services/sceneSpec.js`
  - Pure data logic only.
  - Allowed: normalize, validate, patch, reorder, retime, diff edit impact.
  - Forbidden: file system, Express `req/res`, AI calls, TTS calls, HyperFrames CLI calls, workflow JSON persistence.

- `server/services/hyperframesSceneSpecComposer.js`
  - Pure deterministic composer.
  - Input: normalized `scene_spec`.
  - Output: `{ success, scene_spec, files, diagnostics }`.
  - Forbidden: reading workflow files, calling AI, calling render, mutating workflow records.

- `server/services/renderAdapters.js`
  - Render boundary only.
  - Exports `createRenderAdapter()` and `HyperFramesCliAdapter`.
  - Forbidden: editing scene specs, composing HTML, updating workflow status.

- `server/services/creativeVideoEditor.js`
  - Edit-domain orchestration only.
  - Allowed: apply edit commands, call `sceneSpec.js`, mark `requires_tts` and `requires_render`.
  - Forbidden: Express `req/res`, direct HyperFrames CLI, direct AI full-project generation.

- `server/services/creativeVideoRerender.js`
  - The only service that chains composer -> project writer -> quality checker -> render adapter.
  - Allowed: dependency injection for tests.
  - Forbidden: route parsing and React-facing formatting.

- `server/services/creativeWorkflows.js`
  - Workflow facade and persistence only.
  - Allowed: read/write workflow records, call editor/rerender services, return API-shaped objects.
  - Forbidden: raw HTML generation, render command construction, React-specific field names.

- `server/routes/creativeWorkflows.js`
  - HTTP layer only.
  - Allowed: validate params/body, call `creativeWorkflows` service, choose status code.
  - Forbidden: editing scene arrays, writing files, calling render.

### Frontend Layer Boundaries

- `frontend-react/src/pages/OneClickCreativePage.jsx`
  - Page orchestration only.
  - Allowed: show existing one-click workflow, hold `editorOpen`, pass `workflowId` into editor.
  - Forbidden: scene form state, caption mutation logic, reorder logic, API request implementation.

- `frontend-react/src/hooks/useCreativeVideoEditor.js`
  - Editor data hook.
  - Allowed: load scene spec, save edits, trigger rerender/TTS/rewrite endpoints, expose loading states.
  - Forbidden: JSX layout, CSS class decisions.

- `frontend-react/src/components/one-click-editor/CreativeVideoEditor.jsx`
  - Editor shell.
  - Allowed: compose child components and call hook callbacks.
  - Forbidden: direct `fetch`, direct `api.*` imports.

- `frontend-react/src/components/one-click-editor/*.jsx`
  - Presentational components.
  - Allowed: render fields and emit typed edit commands.
  - Forbidden: API calls and workflow polling.

### Data Naming Contract

- Persisted JSON and API payloads use snake_case: `scene_spec`, `scene_id`, `requires_tts`, `requires_render`, `output_path`.
- React state may use camelCase locally, but API payloads must be converted at the hook boundary.
- Scene identity is stable. Never regenerate IDs while reordering or editing.
- `scene_spec` is the source of truth. `index.html`, `meta.json`, `hyperframes.json`, and rendered videos are derived artifacts.
- Failed rerender or failed TTS must not overwrite the previous playable video.

---

## File Structure

- Create `server/services/sceneSpec.js`: pure schema/edit primitives.
- Create `server/services/hyperframesSceneSpecComposer.js`: deterministic HyperFrames file composer.
- Create `server/services/renderAdapters.js`: `HyperFramesCliAdapter` wrapper around current renderer.
- Create `server/services/creativeVideoEditor.js`: edit command handling and edit impact decisions.
- Create `server/services/creativeVideoRerender.js`: compose, write, check, render, and local TTS orchestration.
- Modify `server/services/hyperframesFreeformAgent.js`: request `scene_spec` instead of full `files` JSON for the stable path.
- Modify `server/services/agentRuns.js`: persist `scene_spec`, compose project files, keep existing workflow stages.
- Modify `server/services/hyperframesFreeformProject.js`: persist `scene_spec.json` and keep allowed text-file behavior.
- Modify `server/services/creativeWorkflows.js`: add workflow facade methods for scene spec, edit, rewrite, local TTS, rerender.
- Modify `server/routes/creativeWorkflows.js`: add edit endpoints only as HTTP wrappers.
- Modify `frontend-react/src/api/client.js`: add editor endpoint methods.
- Create `frontend-react/src/hooks/useCreativeVideoEditor.js`: editor API/data state hook.
- Create `frontend-react/src/components/one-click-editor/CreativeVideoEditor.jsx`: editor shell.
- Create `frontend-react/src/components/one-click-editor/SceneList.jsx`: scene selection and up/down ordering.
- Create `frontend-react/src/components/one-click-editor/SceneEditPanel.jsx`: current scene form.
- Create `frontend-react/src/components/one-click-editor/CaptionEditor.jsx`: caption rows.
- Create `frontend-react/src/components/one-click-editor/VisualTextEditor.jsx`: headline, keywords, cards.
- Create `frontend-react/src/components/one-click-editor/EditorStatusBar.jsx`: loading/success/error feedback.
- Modify `frontend-react/src/pages/OneClickCreativePage.jsx`: open editor entry only.
- Modify `frontend-react/src/styles.css`: component styles under `.one-click-editor`.
- Create tests:
  - `tests/test-scene-spec.js`
  - `tests/test-hyperframes-scene-spec-composer.js`
  - `tests/test-render-adapters.js`
  - `tests/test-creative-video-editor.js`
  - `tests/test-creative-video-rerender.js`
  - `tests/test-one-click-editor-components.mjs`
  - Update `tests/test-hyperframes-freeform-agent.js`
  - Update `tests/test-agent-runs.js`
  - Update `tests/test-creative-workflows.js`
  - Update `tests/test-creative-workflow-routes.js`
  - Update `tests/test-creative-api-client.mjs`
  - Update `tests/test-one-click-creative-page.mjs`

---

### Task 1: Scene Spec Domain Service

**Files:**
- Create: `server/services/sceneSpec.js`
- Create: `tests/test-scene-spec.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Create `tests/test-scene-spec.js`:

```js
const assert = require('assert');
const sceneSpec = require('../server/services/sceneSpec');

const base = {
  title: '测试视频',
  aspect_ratio: '9:16',
  target_duration_sec: 60,
  scenes: [
    {
      id: 'intro',
      duration: 4.234,
      narration_text: '第一段旁白',
      captions: [{ id: 'c1', start: 0.1, end: 1.8, text: '第一句字幕' }],
      visual_text: { headline: '开场', keywords: ['稳定'], cards: ['卡片'] },
    },
    {
      id: 'body',
      duration: 6,
      narration_text: '第二段旁白',
      captions: [{ id: 'c2', start: 4.3, end: 7, text: '第二句字幕' }],
      visual_text: { headline: '主体', keywords: [], cards: [] },
    },
  ],
};

const normalized = sceneSpec.normalizeSceneSpec(base);
assert.equal(normalized.version, 1);
assert.equal(normalized.scenes[0].order, 1);
assert.equal(normalized.scenes[0].start, 0);
assert.equal(normalized.scenes[0].duration, 4.23);
assert.equal(normalized.scenes[1].order, 2);
assert.equal(normalized.scenes[1].start, 4.23);
assert.equal(normalized.scenes[0].editable.local_tts, true);
assert.equal(sceneSpec.validateSceneSpec(normalized).success, true);

const captionEdit = sceneSpec.applySceneSpecEdit(normalized, {
  type: 'caption_text',
  scene_id: 'intro',
  caption_id: 'c1',
  text: '新字幕',
});
assert.equal(captionEdit.scene_spec.scenes[0].captions[0].text, '新字幕');
assert.equal(captionEdit.requires_tts, false);
assert.equal(captionEdit.requires_render, true);

const narrationEdit = sceneSpec.applySceneSpecEdit(normalized, {
  type: 'narration_text',
  scene_id: 'intro',
  text: '新旁白',
});
assert.equal(narrationEdit.requires_tts, true);

const reordered = sceneSpec.applySceneSpecEdit(normalized, {
  type: 'reorder_scenes',
  scene_ids: ['body', 'intro'],
});
assert.equal(reordered.scene_spec.scenes[0].id, 'body');
assert.equal(reordered.scene_spec.scenes[0].start, 0);
assert.equal(reordered.scene_spec.scenes[1].start, 6);

const invalid = sceneSpec.validateSceneSpec({ scenes: [{ id: '', duration: -1 }] });
assert.equal(invalid.success, false);
assert.ok(invalid.errors.some(error => /场景 1/.test(error)));

console.log('scene spec tests passed');
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node tests/test-scene-spec.js
```

Expected: FAIL with `Cannot find module '../server/services/sceneSpec'`.

- [ ] **Step 3: Implement pure service**

Create `server/services/sceneSpec.js` with these exported functions:

```js
module.exports = {
  normalizeSceneSpec,
  validateSceneSpec,
  applySceneSpecEdit,
  retimeScenes,
};
```

Implementation requirements:

- Do not import `fs`, `path`, Express, AI clients, TTS services, render services, or workflow services.
- `normalizeSceneSpec(input)` returns `{ version, title, aspect_ratio, target_duration_sec, style, scenes }`.
- `retimeScenes(scenes)` recalculates `order` and `start` from scene durations.
- `validateSceneSpec(spec)` returns `{ success, errors }` with Chinese error messages.
- `applySceneSpecEdit(spec, edit)` supports:
  - `caption_text`: update one caption text, `requires_tts: false`, `requires_render: true`.
  - `narration_text`: update one scene narration, `requires_tts: true`, `requires_render: true`.
  - `visual_text`: replace one scene `visual_text`, `requires_tts: false`, `requires_render: true`.
  - `duration`: update one scene duration and retime all scenes, `requires_tts: false`, `requires_render: true`.
  - `reorder_scenes`: reorder all scenes by stable IDs and retime all scenes, `requires_tts: false`, `requires_render: true`.
- Throw Chinese `Error` messages for unknown scene IDs, unknown caption IDs, duplicate scene IDs, missing scene IDs, invalid duration, and unknown edit type.

- [ ] **Step 4: Run passing tests**

Run:

```bash
node tests/test-scene-spec.js
```

Expected: PASS with `scene spec tests passed`.

- [ ] **Step 5: Register test and commit**

Modify `package.json` so `node tests/test-scene-spec.js` runs in the existing `test` script after nearby schema/service tests.

Run:

```bash
npm test -- --help
```

Expected: command may print npm help or existing script behavior, but `package.json` must stay valid JSON.

Commit:

```bash
git add server/services/sceneSpec.js tests/test-scene-spec.js package.json
git commit -m "新增场景规格领域服务"
```

---

### Task 2: Deterministic HyperFrames Composer

**Files:**
- Create: `server/services/hyperframesSceneSpecComposer.js`
- Create: `tests/test-hyperframes-scene-spec-composer.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing composer tests**

Create `tests/test-hyperframes-scene-spec-composer.js`:

```js
const assert = require('assert');
const composer = require('../server/services/hyperframesSceneSpecComposer');

const result = composer.composeHyperframesProjectFiles({
  title: '可编辑视频',
  aspect_ratio: '9:16',
  scenes: [
    {
      id: 'intro',
      start: 0,
      duration: 5,
      narration_text: '开场旁白',
      captions: [{ id: 'cap1', start: 0, end: 2, text: '开场字幕' }],
      visual_text: { headline: '开场标题', keywords: ['稳定', '可编辑'], cards: ['第一张卡片'] },
    },
  ],
});

assert.equal(result.success, true);
assert.ok(result.files['index.html'].includes('data-composition-id="main"'));
assert.ok(result.files['index.html'].includes('data-width="1080"'));
assert.ok(result.files['index.html'].includes('data-height="1920"'));
assert.ok(result.files['index.html'].includes('window.__timelines["main"]'));
assert.ok(result.files['index.html'].includes('开场标题'));
assert.ok(result.files['index.html'].includes('开场字幕'));
assert.ok(result.files['scene_spec.json'].includes('"id": "intro"'));
assert.ok(result.files['meta.json'].includes('"scene_count": 1'));
assert.ok(result.files['hyperframes.json'].includes('"composition": "main"'));
assert.doesNotMatch(result.files['index.html'], /performance\.now|requestAnimationFrame|setInterval/);

console.log('hyperframes scene spec composer tests passed');
```

- [ ] **Step 2: Run failing composer tests**

Run:

```bash
node tests/test-hyperframes-scene-spec-composer.js
```

Expected: FAIL with `Cannot find module '../server/services/hyperframesSceneSpecComposer'`.

- [ ] **Step 3: Implement composer**

Create `server/services/hyperframesSceneSpecComposer.js` with these exports:

```js
module.exports = {
  composeHyperframesProjectFiles,
  buildIndexHtml,
};
```

Implementation requirements:

- Import only `./sceneSpec`.
- `composeHyperframesProjectFiles(sceneSpec)` normalizes and validates input.
- On validation failure return `{ success: false, message, files: {}, diagnostics }`.
- On success return files:
  - `index.html`
  - `meta.json`
  - `hyperframes.json`
  - `design.md`
  - `scene_spec.json`
- Generated HTML must include:
  - root `data-composition-id="main"`.
  - `data-duration`, `data-width`, `data-height`.
  - scene elements with `data-start` and `data-duration`.
  - caption elements with `data-caption-id`, `data-start`, `data-end`.
  - `window.__timelines = window.__timelines || {};`.
  - `window.__timelines["main"] = tl;`.
- Generated HTML must not include `performance.now`, `requestAnimationFrame`, `setInterval`, `Date.now`, random values, or runtime network fetches.
- Escape HTML text before embedding user content.

- [ ] **Step 4: Run composer tests and commit**

Run:

```bash
node tests/test-hyperframes-scene-spec-composer.js
```

Expected: PASS with `hyperframes scene spec composer tests passed`.

Modify `package.json` to include the composer test in `npm test`.

Commit:

```bash
git add server/services/hyperframesSceneSpecComposer.js tests/test-hyperframes-scene-spec-composer.js package.json
git commit -m "新增场景规格工程生成器"
```

---

### Task 3: Render Adapter Boundary

**Files:**
- Create: `server/services/renderAdapters.js`
- Create: `tests/test-render-adapters.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing adapter tests**

Create `tests/test-render-adapters.js`:

```js
const assert = require('assert');
const { HyperFramesCliAdapter, createRenderAdapter } = require('../server/services/renderAdapters');

const calls = [];
const adapter = new HyperFramesCliAdapter({
  renderer: async (projectDir, options) => {
    calls.push({ projectDir, options });
    return { success: true, outputPath: 'D:/tmp/out.mp4', stdout: 'ok', stderr: '' };
  },
});

(async () => {
  const result = await adapter.render({
    projectDir: 'D:/tmp/project',
    outputPath: 'D:/tmp/out.mp4',
    fps: 30,
    duration: 12,
  });

  assert.equal(result.success, true);
  assert.equal(result.outputPath, 'D:/tmp/out.mp4');
  assert.equal(result.stdout, 'ok');
  assert.deepEqual(result.diagnostics, []);
  assert.equal(calls[0].projectDir, 'D:/tmp/project');
  assert.equal(calls[0].options.outputPath, 'D:/tmp/out.mp4');
  assert.ok(createRenderAdapter({ type: 'hyperframes-cli', renderer: async () => ({ success: true }) }));

  console.log('render adapter tests passed');
})();
```

- [ ] **Step 2: Run failing adapter tests**

Run:

```bash
node tests/test-render-adapters.js
```

Expected: FAIL with `Cannot find module '../server/services/renderAdapters'`.

- [ ] **Step 3: Implement adapter**

Create `server/services/renderAdapters.js`.

Implementation requirements:

- `HyperFramesCliAdapter` accepts `{ renderer }`.
- Default `renderer` delegates to the existing render service in `server/services/hyperframesRenderer.js`.
- `render(input)` accepts `{ projectDir, outputPath, fps, duration, audio, onProgress }`.
- `render(input)` returns `{ success, outputPath, stdout, stderr, diagnostics, meta }`.
- Convert thrown errors into `{ success: false, message, outputPath, stdout: '', stderr, diagnostics }`.
- Do not import editor services, workflow services, routes, React, or composer.

- [ ] **Step 4: Run adapter tests and commit**

Run:

```bash
node tests/test-render-adapters.js
```

Expected: PASS with `render adapter tests passed`.

Modify `package.json` to include the adapter test.

Commit:

```bash
git add server/services/renderAdapters.js tests/test-render-adapters.js package.json
git commit -m "新增渲染适配器边界"
```

---

### Task 4: Scene Spec Agent And Project Integration

**Files:**
- Modify: `server/services/hyperframesFreeformAgent.js`
- Modify: `server/services/agentRuns.js`
- Modify: `server/services/hyperframesFreeformProject.js`
- Modify: `tests/test-hyperframes-freeform-agent.js`
- Modify: `tests/test-agent-runs.js`
- Modify: `tests/test-hyperframes-freeform-project.js`

- [ ] **Step 1: Add failing tests for scene spec output**

Update `tests/test-hyperframes-freeform-agent.js` so it asserts the project prompt asks for `scene_spec`, does not ask for complete `index.html` in the stable path, and rejects responses without `scenes`.

Required assertions:

```js
assert.ok(prompt.includes('scene_spec'));
assert.ok(prompt.includes('不要输出 HTML'));
assert.doesNotMatch(prompt, /完整 index\.html/);
assert.equal(parsed.scene_spec.scenes[0].id, 'scene_01');
```

Update `tests/test-agent-runs.js` with a fake AI response containing:

```js
{
  "scene_spec": {
    "version": 1,
    "title": "测试",
    "aspect_ratio": "9:16",
    "scenes": [
      {
        "id": "scene_01",
        "duration": 5,
        "narration_text": "测试旁白",
        "captions": [{ "id": "cap_01_01", "start": 0, "end": 2, "text": "测试字幕" }],
        "visual_text": { "headline": "测试标题", "keywords": [], "cards": [] }
      }
    ]
  }
}
```

Assert generated project state contains:

```js
assert.ok(result.hyperframes_freeform.project.scene_spec);
assert.ok(result.hyperframes_freeform.project.files['index.html']);
assert.ok(result.hyperframes_freeform.project.files['scene_spec.json']);
```

- [ ] **Step 2: Run failing integration tests**

Run:

```bash
node tests/test-hyperframes-freeform-agent.js
node tests/test-agent-runs.js
node tests/test-hyperframes-freeform-project.js
```

Expected: at least one test fails because the stable path still expects full `files`.

- [ ] **Step 3: Modify agent prompt and parser**

In `server/services/hyperframesFreeformAgent.js`:

- Add `buildSceneSpecPrompt(input)` or extend the existing prompt builder with a stable mode.
- Prompt must say in Chinese:
  - 只输出 JSON。
  - 根字段是 `scene_spec`。
  - 不要输出 HTML、CSS、JS、package.json 或完整工程 files。
  - 每个场景必须有 stable `id`、`duration`、`narration_text`、`captions`、`visual_text`。
- Parser must accept `{ scene_spec }`, normalize it through `sceneSpec.normalizeSceneSpec`, and reject missing or empty `scenes`.
- Keep existing freeform full-files path only if current callers still need it; name the stable path explicitly so future edits do not mix them.

- [ ] **Step 4: Modify project writing**

In `server/services/hyperframesFreeformProject.js`:

- Allow writing `scene_spec.json`.
- Keep existing text-file protections.
- Do not compose HTML in this file.

In `server/services/agentRuns.js`:

- After AI returns `scene_spec`, call `hyperframesSceneSpecComposer.composeHyperframesProjectFiles(sceneSpec)`.
- Persist both `project.scene_spec` and composed `project.files`.
- Keep workflow phase names unchanged: `project`, `check`, `render`, `inspect`.
- Do not call render adapter from `hyperframesFreeformAgent.js`.

- [ ] **Step 5: Run integration tests and commit**

Run:

```bash
node tests/test-hyperframes-freeform-agent.js
node tests/test-agent-runs.js
node tests/test-hyperframes-freeform-project.js
```

Expected: all PASS.

Commit:

```bash
git add server/services/hyperframesFreeformAgent.js server/services/agentRuns.js server/services/hyperframesFreeformProject.js tests/test-hyperframes-freeform-agent.js tests/test-agent-runs.js tests/test-hyperframes-freeform-project.js
git commit -m "改为场景规格生成工程"
```

---

### Task 5: Edit Domain Service

**Files:**
- Create: `server/services/creativeVideoEditor.js`
- Create: `tests/test-creative-video-editor.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing edit service tests**

Create `tests/test-creative-video-editor.js`:

```js
const assert = require('assert');
const editor = require('../server/services/creativeVideoEditor');

const spec = {
  title: '测试',
  scenes: [
    {
      id: 'scene_01',
      duration: 5,
      narration_text: '旧旁白',
      captions: [{ id: 'cap_01_01', start: 0, end: 2, text: '旧字幕' }],
      visual_text: { headline: '旧标题', keywords: ['旧'], cards: [] },
    },
  ],
};

const caption = editor.applyEditCommand(spec, {
  type: 'caption_text',
  scene_id: 'scene_01',
  caption_id: 'cap_01_01',
  text: '新字幕',
});
assert.equal(caption.scene_spec.scenes[0].captions[0].text, '新字幕');
assert.equal(caption.requires_tts, false);
assert.equal(caption.requires_render, true);
assert.equal(caption.edit_type, 'caption_text');

const rewrite = editor.applyRewriteResult(spec, 'scene_01', {
  narration_text: '重写旁白',
  captions: [{ id: 'cap_new', start: 0, end: 3, text: '重写字幕' }],
  visual_text: { headline: '重写标题', keywords: ['新'], cards: ['新卡片'] },
  layout: 'headline_keywords',
  motion: 'staggered_reveal',
});
assert.equal(rewrite.scene_spec.scenes[0].narration_text, '重写旁白');
assert.equal(rewrite.requires_tts, true);
assert.equal(rewrite.requires_render, true);

console.log('creative video editor tests passed');
```

- [ ] **Step 2: Run failing edit tests**

Run:

```bash
node tests/test-creative-video-editor.js
```

Expected: FAIL with `Cannot find module '../server/services/creativeVideoEditor'`.

- [ ] **Step 3: Implement edit domain service**

Create `server/services/creativeVideoEditor.js`.

Exports:

```js
module.exports = {
  applyEditCommand,
  applyRewriteResult,
};
```

Implementation requirements:

- Import only `./sceneSpec`.
- `applyEditCommand(spec, command)` delegates to `sceneSpec.applySceneSpecEdit`.
- Return shape:
  - `success: true`
  - `scene_spec`
  - `edit_type`
  - `requires_tts`
  - `requires_render`
  - `changed_scene_ids`
  - `message`
- `applyRewriteResult(spec, sceneId, rewriteResult)` updates one scene only.
- Rewritten scene keeps the original `id`, `order`, `start`, and `duration` unless `rewriteResult.duration` is a positive number.
- No file writes, no render, no route response handling.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
node tests/test-creative-video-editor.js
```

Expected: PASS with `creative video editor tests passed`.

Modify `package.json` to include the edit service test.

Commit:

```bash
git add server/services/creativeVideoEditor.js tests/test-creative-video-editor.js package.json
git commit -m "新增成片编辑领域服务"
```

---

### Task 6: Rerender And Local TTS Orchestration Service

**Files:**
- Create: `server/services/creativeVideoRerender.js`
- Create: `tests/test-creative-video-rerender.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing orchestration tests**

Create `tests/test-creative-video-rerender.js`:

```js
const assert = require('assert');
const rerender = require('../server/services/creativeVideoRerender');

const spec = {
  title: '测试',
  scenes: [
    {
      id: 'scene_01',
      duration: 5,
      narration_text: '旁白',
      captions: [{ id: 'cap_01_01', start: 0, end: 2, text: '字幕' }],
      visual_text: { headline: '标题', keywords: [], cards: [] },
    },
  ],
};

(async () => {
  const calls = [];
  const result = await rerender.rerenderSceneSpecProject({
    workflowId: '202606131200000004',
    sceneSpec: spec,
    outputPath: 'D:/tmp/output.mp4',
    services: {
      composer: {
        composeHyperframesProjectFiles: value => ({
          success: true,
          scene_spec: value,
          files: {
            'index.html': '<html></html>',
            'meta.json': '{}',
            'hyperframes.json': '{}',
            'design.md': '# Design',
            'scene_spec.json': JSON.stringify(value),
          },
        }),
      },
      projectWriter: async files => {
        calls.push(['write', Object.keys(files).sort()]);
        return { success: true, projectDir: 'D:/tmp/project' };
      },
      checker: async projectDir => {
        calls.push(['check', projectDir]);
        return { success: true, diagnostics: [] };
      },
      renderAdapter: {
        render: async input => {
          calls.push(['render', input.projectDir, input.outputPath]);
          return { success: true, outputPath: input.outputPath, diagnostics: [] };
        },
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.output_path, 'D:/tmp/output.mp4');
  assert.deepEqual(calls.map(call => call[0]), ['write', 'check', 'render']);

  const failed = await rerender.rerenderSceneSpecProject({
    workflowId: '202606131200000005',
    sceneSpec: spec,
    previousOutputPath: 'D:/tmp/old.mp4',
    services: {
      composer: { composeHyperframesProjectFiles: () => ({ success: false, message: '规格错误' }) },
      projectWriter: async () => { throw new Error('不应写入'); },
    },
  });
  assert.equal(failed.success, false);
  assert.equal(failed.previous_output_path, 'D:/tmp/old.mp4');

  console.log('creative video rerender tests passed');
})();
```

- [ ] **Step 2: Run failing orchestration tests**

Run:

```bash
node tests/test-creative-video-rerender.js
```

Expected: FAIL with `Cannot find module '../server/services/creativeVideoRerender'`.

- [ ] **Step 3: Implement orchestration service**

Create `server/services/creativeVideoRerender.js`.

Exports:

```js
module.exports = {
  rerenderSceneSpecProject,
  rerenderSceneWithLocalTts,
};
```

Implementation requirements:

- `rerenderSceneSpecProject(input)` is the only function that chains composer, project writer, checker, and render adapter.
- Input shape:
  - `workflowId`
  - `sceneSpec`
  - `outputPath`
  - `previousOutputPath`
  - `services`
- Service dependencies:
  - `composer.composeHyperframesProjectFiles(sceneSpec)`
  - `projectWriter(files, context)`
  - `checker(projectDir, context)`
  - `renderAdapter.render({ projectDir, outputPath, duration, fps, audio })`
- On any failure return `success: false`, Chinese `message`, `previous_output_path`, and stage-specific diagnostics.
- On success return `success: true`, `output_path`, `project_dir`, `diagnostics`, and `scene_spec`.
- `rerenderSceneWithLocalTts(input)` calls injected `ttsService.synthesizeScene(scene, context)` before `rerenderSceneSpecProject`.
- Local TTS failure returns `success: false` and does not call render.
- Do not import Express routes or React code.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
node tests/test-creative-video-rerender.js
```

Expected: PASS with `creative video rerender tests passed`.

Modify `package.json` to include the rerender service test.

Commit:

```bash
git add server/services/creativeVideoRerender.js tests/test-creative-video-rerender.js package.json
git commit -m "新增编辑成片重渲染编排服务"
```

---

### Task 7: Workflow Facade, Routes, And API Client

**Files:**
- Modify: `server/services/creativeWorkflows.js`
- Modify: `server/routes/creativeWorkflows.js`
- Modify: `frontend-react/src/api/client.js`
- Modify: `tests/test-creative-workflows.js`
- Modify: `tests/test-creative-workflow-routes.js`
- Modify: `tests/test-creative-api-client.mjs`

- [ ] **Step 1: Add failing workflow and route tests**

Update backend tests to cover:

- `GET /api/creative-workflows/:workflow_id/scene-spec`
- `PATCH /api/creative-workflows/:workflow_id/scene-spec`
- `POST /api/creative-workflows/:workflow_id/scenes/:scene_id/rewrite`
- `POST /api/creative-workflows/:workflow_id/scenes/:scene_id/tts`
- `POST /api/creative-workflows/:workflow_id/rerender`

Required route assertions:

```js
assert.equal(getResponse.statusCode, 200);
assert.equal(getResponse.body.scene_spec.title, '测试');
assert.equal(patchResponse.statusCode, 200);
assert.equal(patchResponse.body.requires_render, true);
assert.equal(rewriteResponse.statusCode, 200);
assert.equal(ttsResponse.statusCode, 200);
assert.equal(rerenderResponse.statusCode, 200);
```

Update `tests/test-creative-api-client.mjs` to assert these client methods exist:

```js
assert.ok(source.includes('getCreativeWorkflowSceneSpec(workflowId)'));
assert.ok(source.includes('patchCreativeWorkflowSceneSpec(workflowId, payload)'));
assert.ok(source.includes('rewriteCreativeWorkflowScene(workflowId, sceneId, payload)'));
assert.ok(source.includes('ttsCreativeWorkflowScene(workflowId, sceneId, payload)'));
assert.ok(source.includes('rerenderCreativeWorkflow(workflowId, payload)'));
```

- [ ] **Step 2: Run failing route/client tests**

Run:

```bash
node tests/test-creative-workflows.js
node tests/test-creative-workflow-routes.js
node tests/test-creative-api-client.mjs
```

Expected: tests fail because new facade methods and routes do not exist.

- [ ] **Step 3: Implement workflow facade methods**

In `server/services/creativeWorkflows.js`, add methods:

```js
getCreativeWorkflowSceneSpec(workflowId, options)
patchCreativeWorkflowSceneSpec(workflowId, edit, options)
rewriteCreativeWorkflowScene(workflowId, sceneId, payload, options)
ttsCreativeWorkflowScene(workflowId, sceneId, payload, options)
rerenderCreativeWorkflow(workflowId, payload, options)
```

Implementation requirements:

- Read workflow record through existing workflow persistence helpers.
- Extract `record.result.hyperframes_freeform.project.scene_spec`.
- Use `creativeVideoEditor` for edit and rewrite changes.
- Use `creativeVideoRerender` for rerender and local TTS orchestration.
- Persist updated `scene_spec` after successful edit/rewrite/TTS.
- Persist new render output only when rerender succeeds.
- Return Chinese `message` values for success and failure.
- Do not generate HTML directly in `creativeWorkflows.js`.

- [ ] **Step 4: Implement routes**

In `server/routes/creativeWorkflows.js`, add routes before `router.get('/:workflow_id', ...)`.

Route rules:

- Validate `workflow_id` with existing `WORKFLOW_ID_PATTERN`.
- Validate `scene_id` as a non-empty string for scene routes.
- Return `400` for invalid params or edit body.
- Return `404` when workflow or scene spec does not exist.
- Return `200` for successful edit/rewrite/TTS/rerender.
- Route handlers must not mutate scenes directly.

- [ ] **Step 5: Implement API client methods**

In `frontend-react/src/api/client.js`, add:

```js
getCreativeWorkflowSceneSpec(workflowId) {
  return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/scene-spec`);
},
patchCreativeWorkflowSceneSpec(workflowId, payload) {
  return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/scene-spec`, {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
  });
},
rewriteCreativeWorkflowScene(workflowId, sceneId, payload) {
  return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/scenes/${encodeURIComponent(sceneId)}/rewrite`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
},
ttsCreativeWorkflowScene(workflowId, sceneId, payload) {
  return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/scenes/${encodeURIComponent(sceneId)}/tts`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
},
rerenderCreativeWorkflow(workflowId, payload) {
  return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/rerender`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
},
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
node tests/test-creative-workflows.js
node tests/test-creative-workflow-routes.js
node tests/test-creative-api-client.mjs
```

Expected: all PASS.

Commit:

```bash
git add server/services/creativeWorkflows.js server/routes/creativeWorkflows.js frontend-react/src/api/client.js tests/test-creative-workflows.js tests/test-creative-workflow-routes.js tests/test-creative-api-client.mjs
git commit -m "新增成片编辑工作流接口"
```

---

### Task 8: Componentized Frontend Editor

**Files:**
- Create: `frontend-react/src/hooks/useCreativeVideoEditor.js`
- Create: `frontend-react/src/components/one-click-editor/CreativeVideoEditor.jsx`
- Create: `frontend-react/src/components/one-click-editor/SceneList.jsx`
- Create: `frontend-react/src/components/one-click-editor/SceneEditPanel.jsx`
- Create: `frontend-react/src/components/one-click-editor/CaptionEditor.jsx`
- Create: `frontend-react/src/components/one-click-editor/VisualTextEditor.jsx`
- Create: `frontend-react/src/components/one-click-editor/EditorStatusBar.jsx`
- Modify: `frontend-react/src/pages/OneClickCreativePage.jsx`
- Modify: `frontend-react/src/styles.css`
- Create: `tests/test-one-click-editor-components.mjs`
- Modify: `tests/test-one-click-creative-page.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing component boundary test**

Create `tests/test-one-click-editor-components.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('frontend-react/src/pages/OneClickCreativePage.jsx', 'utf-8');
const hook = fs.readFileSync('frontend-react/src/hooks/useCreativeVideoEditor.js', 'utf-8');
const shell = fs.readFileSync('frontend-react/src/components/one-click-editor/CreativeVideoEditor.jsx', 'utf-8');
const sceneList = fs.readFileSync('frontend-react/src/components/one-click-editor/SceneList.jsx', 'utf-8');
const editPanel = fs.readFileSync('frontend-react/src/components/one-click-editor/SceneEditPanel.jsx', 'utf-8');
const captions = fs.readFileSync('frontend-react/src/components/one-click-editor/CaptionEditor.jsx', 'utf-8');
const visual = fs.readFileSync('frontend-react/src/components/one-click-editor/VisualTextEditor.jsx', 'utf-8');
const status = fs.readFileSync('frontend-react/src/components/one-click-editor/EditorStatusBar.jsx', 'utf-8');

assert.ok(page.includes('CreativeVideoEditor'));
assert.doesNotMatch(page, /patchCreativeWorkflowSceneSpec|caption_id|selectedEditSceneId/);
assert.ok(hook.includes('useCreativeVideoEditor'));
assert.ok(hook.includes('getCreativeWorkflowSceneSpec'));
assert.ok(hook.includes('patchCreativeWorkflowSceneSpec'));
assert.ok(hook.includes('rewriteCreativeWorkflowScene'));
assert.ok(hook.includes('ttsCreativeWorkflowScene'));
assert.ok(hook.includes('rerenderCreativeWorkflow'));
assert.ok(shell.includes('SceneList'));
assert.ok(shell.includes('SceneEditPanel'));
assert.ok(shell.includes('EditorStatusBar'));
assert.ok(sceneList.includes('上移'));
assert.ok(sceneList.includes('下移'));
assert.ok(editPanel.includes('场景时长'));
assert.ok(editPanel.includes('重写本场景'));
assert.ok(editPanel.includes('重新配音本场景'));
assert.ok(captions.includes('字幕'));
assert.ok(visual.includes('画面标题'));
assert.ok(status.includes('正在'));

console.log('one click editor component tests passed');
```

- [ ] **Step 2: Run failing component tests**

Run:

```bash
node tests/test-one-click-editor-components.mjs
```

Expected: FAIL because hook and components do not exist.

- [ ] **Step 3: Implement `useCreativeVideoEditor` hook**

Create `frontend-react/src/hooks/useCreativeVideoEditor.js`.

Hook contract:

```js
export function useCreativeVideoEditor({ workflowId, api }) {
  return {
    sceneSpec,
    selectedSceneId,
    selectedScene,
    status,
    message,
    loading,
    saving,
    load,
    selectScene,
    saveCaptionText,
    saveNarrationText,
    saveVisualText,
    saveDuration,
    moveScene,
    rewriteScene,
    ttsScene,
    rerender,
  };
}
```

Implementation requirements:

- All API calls live in this hook, not in presentational components.
- Use Chinese loading messages:
  - `正在加载可编辑场景...`
  - `正在保存编辑...`
  - `正在重写本场景...`
  - `正在重新配音本场景...`
  - `正在重新渲染成片...`
- After each successful edit, update `sceneSpec` from response.
- `moveScene(sceneId, direction)` builds a full `scene_ids` array and calls `patchCreativeWorkflowSceneSpec`.
- Expose `loading` and `saving` booleans for button disabled states.

- [ ] **Step 4: Implement presentational components**

Create the component files listed in this task.

Component contracts:

- `CreativeVideoEditor({ workflowId, api, onRendered })`
  - Calls `useCreativeVideoEditor`.
  - Renders `SceneList`, `SceneEditPanel`, and `EditorStatusBar`.
  - Does not call `api.*` directly.

- `SceneList({ scenes, selectedSceneId, onSelect, onMove, disabled })`
  - Renders scene buttons.
  - Renders `上移` and `下移` buttons per scene.
  - Uses stable `scene.id` as key.

- `SceneEditPanel({ scene, disabled, onCaptionText, onNarrationText, onVisualText, onDuration, onRewrite, onTts, onRerender })`
  - Renders duration input, narration textarea, visual text editor, caption editor, and action buttons.
  - Uses a local draft state for text fields.
  - Saves only from explicit buttons such as `保存旁白`, `保存画面文字`, `保存字幕`, `保存时长`.
  - Does not save on every keystroke.

- `CaptionEditor({ captions, disabled, onSaveCaption })`
  - Renders one row per caption.
  - Each row has a text input and `保存字幕`.

- `VisualTextEditor({ visualText, disabled, onSave })`
  - Supports headline, comma-separated keywords, and newline-separated cards.

- `EditorStatusBar({ status, message })`
  - Shows Chinese status text.
  - Returns `null` when no message exists.

- [ ] **Step 5: Wire page entry**

Modify `frontend-react/src/pages/OneClickCreativePage.jsx`:

- Import `CreativeVideoEditor`.
- Add `editorOpen` state only.
- Render `编辑成片` after workflow status is done and a `workflowId` exists.
- When open, render:

```jsx
<CreativeVideoEditor workflowId={workflowId} api={api} onRendered={refreshWorkflow} />
```

- Do not add scene field state to the page.

- [ ] **Step 6: Add styles**

Modify `frontend-react/src/styles.css`.

CSS requirements:

- All selectors start with `.one-click-editor`.
- Use compact panels with `border-radius: 8px` or less.
- Ensure action buttons have disabled styles.
- Add responsive layout: scene list stacks above edit panel on narrow screens.

- [ ] **Step 7: Run frontend tests and build**

Run:

```bash
node tests/test-one-click-editor-components.mjs
node tests/test-one-click-creative-page.mjs
npm run build:frontend
```

Expected: component source test PASS, page source test PASS, frontend build succeeds.

Modify `package.json` to include `node tests/test-one-click-editor-components.mjs` after `node tests/test-one-click-creative-page.mjs`.

Commit:

```bash
git add frontend-react/src/hooks/useCreativeVideoEditor.js frontend-react/src/components/one-click-editor frontend-react/src/pages/OneClickCreativePage.jsx frontend-react/src/styles.css tests/test-one-click-editor-components.mjs tests/test-one-click-creative-page.mjs package.json
git commit -m "新增组件化成片编辑器"
```

---

### Task 9: Final Verification

**Files:**
- Modify only files required by failing verification.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
node tests/test-scene-spec.js
node tests/test-hyperframes-scene-spec-composer.js
node tests/test-render-adapters.js
node tests/test-hyperframes-freeform-agent.js
node tests/test-hyperframes-freeform-project.js
node tests/test-agent-runs.js
node tests/test-creative-video-editor.js
node tests/test-creative-video-rerender.js
node tests/test-creative-workflows.js
node tests/test-creative-workflow-routes.js
```

Expected: all PASS.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
node tests/test-creative-api-client.mjs
node tests/test-one-click-creative-page.mjs
node tests/test-one-click-editor-components.mjs
npm run build:frontend
```

Expected: all PASS and build succeeds.

- [ ] **Step 3: Run complete suite**

Run:

```bash
npm test
```

Expected: all registered tests PASS.

- [ ] **Step 4: Inspect layer boundaries**

Run:

```bash
rg -n "require\\('fs'\\)|require\\(\"fs\"\\)|express|req\\.|res\\.|hyperframesRenderer|renderAdapter|composeHyperframesProjectFiles" server/services/sceneSpec.js server/services/hyperframesSceneSpecComposer.js server/services/creativeVideoEditor.js
rg -n "patchCreativeWorkflowSceneSpec|caption_id|selectedEditSceneId" frontend-react/src/pages/OneClickCreativePage.jsx
rg -n "api\\." frontend-react/src/components/one-click-editor
```

Expected:

- First command shows no forbidden imports/usages in pure services except `composeHyperframesProjectFiles` inside its own composer file.
- Second command has no matches.
- Third command has no matches because API calls live in the hook.

- [ ] **Step 5: Inspect git diff**

Run:

```bash
git diff --stat
```

Expected: changes are limited to scene spec, composer, render adapter, edit/rerender services, workflow facade, routes, API client, editor hook/components, styles, and tests.

- [ ] **Step 6: Commit final fixes when needed**

If verification required fixes:

```bash
git add <fixed-files>
git commit -m "修正一键成片编辑验证问题"
```

If verification needed no fixes, do not create an empty commit.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-13-one-click-video-editable-output.md`.

Preferred execution mode:

**Use Subagent-Driven when the target agent supports it.** Dispatch a fresh subagent per task, review the result after each task, then continue to the next task only after the review passes. This plan is intentionally split so each task can be implemented and verified independently.

Fallback execution mode:

**Use Inline Execution only when Subagent-Driven is unavailable.** Execute one task at a time in the current session, with a checkpoint after every task. Do not batch multiple tasks into one large change.

Required reporting language:

**All status reports, review notes, test results, risk notes, and commit summaries must be written in Chinese.**
