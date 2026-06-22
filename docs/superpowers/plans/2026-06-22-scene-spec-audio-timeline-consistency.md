# Scene Spec Audio Timeline Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scene_spec.scenes[]` the only authoritative final-video timeline so narration audio, bottom captions, frames, and render-time validation always use the same scene count, order, ids, narration text, and captions.

**Architecture:** Add a small `sceneSpecHash` service for stable speech/caption signatures, bind all reused/generated TTS audio to that hash, and validate `content_graph` against `scene_spec` before frame construction. Frame builders must fail or fall back before producing empty extra frames, and html-video validation must block mismatched audio/frame/script combinations before render.

**Tech Stack:** Node.js CommonJS services, built-in `crypto`, existing html-video workflow/services, existing custom test runner `node tests/run-all.js`.

---

## Reference Documents

- Design: `docs/superpowers/specs/2026-06-22-scene-spec-audio-timeline-consistency-design.md`
- Reference project inspected earlier: `D:\code3\html-video`

## File Structure

- Create `server/services/creative-video/sceneSpecHash.js`
  - Owns stable speech/caption signature generation, SHA-256 hash, and audio reuse matching rules.
- Modify `server/services/creative-video/ttsService.js`
  - Adds `source`, `scene_spec_hash`, `scene_count`, and `scene_ids` to every scene-spec TTS manifest.
- Create `server/services/creative-video/html-video/sceneGraphBinding.js`
  - Owns graph-to-scene binding checks and fallback diagnostics.
- Modify `server/services/creative-video/html-video/sceneSpecMapper.js`
  - Uses explicit `node.scene_id || node.id` binding and never creates frames without matching scenes.
- Modify `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`
  - Uses the same explicit binding for raw HTML frames and writes scene-sourced captions/narration only.
- Create `server/services/creative-video/html-video/timelineConsistency.js`
  - Owns render-time frame/audio/script consistency diagnostics.
- Modify `server/services/creative-video/html-video/validationGate.js`
  - Calls timeline consistency validation when `sceneSpec` is passed.
- Modify `server/services/creative-video/html-video/projectSchema.js`
  - Preserves audio hash metadata during normalization.
- Modify `server/services/creative-video/html-video/htmlVideoWorkflow.js`
  - Validates AI content graph, falls back to scene-derived graph on mismatch, enforces hash-based audio reuse, and passes `sceneSpec` into validation.
- Create `tests/test-scene-spec-hash.js`
- Create `tests/test-html-video-scene-graph-binding.js`
- Create `tests/test-html-video-timeline-consistency.js`
- Modify existing focused tests:
  - `tests/test-creative-video-tts-service.js`
  - `tests/test-html-video-scene-spec-mapper.js`
  - `tests/test-html-video-raw-html-frame-builder.js`
  - `tests/test-html-video-validation-gate.js`
  - `tests/test-html-video-workflow.js`

## Required Git Guard

- [ ] Before editing any source or test file, run:

```powershell
git branch --show-current
git status --short
```

Expected:

```text
dev
```

If the branch is `main`, stop immediately and ask the user to switch to `dev`.

## Implementation Tasks

### Task 1: Add Scene Spec Speech Hash Service

**Files:**
- Create: `server/services/creative-video/sceneSpecHash.js`
- Create: `tests/test-scene-spec-hash.js`

- [ ] **Step 1: Write the failing hash tests**

Create `tests/test-scene-spec-hash.js` with these tests:

```js
const assert = require('assert');

const {
  getSceneSpecSpeechSignature,
  computeSceneSpecSpeechHash,
  audioMatchesSceneSpec,
} = require('../server/services/creative-video/sceneSpecHash');

function sceneSpec(overrides = {}) {
  return {
    title: '测试视频',
    scenes: [
      {
        id: 'scene_01',
        order: 1,
        narration_text: '第一段旁白',
        captions: [{ start: 0, end: 1.2, text: '第一段字幕' }],
        visual_text: { headline: '视觉标题 A' },
        template_id: 'visual-template-a',
      },
      {
        id: 'scene_02',
        order: 2,
        narration_text: '第二段旁白',
        captions: [{ start: 0, end: 1.4, text: '第二段字幕' }],
        visual_text: { headline: '视觉标题 B' },
        template_id: 'visual-template-b',
      },
    ],
    ...overrides,
  };
}

function matchingAudio(spec) {
  const hash = computeSceneSpecSpeechHash(spec);
  return {
    source: 'scene_spec',
    scene_spec_hash: hash,
    scene_count: spec.scenes.length,
    scene_ids: spec.scenes.map(scene => scene.id),
    path: 'D:/tmp/current.wav',
    status: 'ready',
  };
}

{
  const spec = sceneSpec();
  assert.deepEqual(getSceneSpecSpeechSignature(spec), {
    version: 1,
    scenes: [
      {
        id: 'scene_01',
        order: 1,
        narration_text: '第一段旁白',
        captions: [{ start: 0, end: 1.2, text: '第一段字幕' }],
      },
      {
        id: 'scene_02',
        order: 2,
        narration_text: '第二段旁白',
        captions: [{ start: 0, end: 1.4, text: '第二段字幕' }],
      },
    ],
  });
}

{
  const spec = sceneSpec();
  assert.equal(computeSceneSpecSpeechHash(spec), computeSceneSpecSpeechHash(sceneSpec()));
}

{
  const base = sceneSpec();
  const changed = sceneSpec({
    scenes: base.scenes.map(scene => (
      scene.id === 'scene_02'
        ? { ...scene, narration_text: '第二段旁白已修改' }
        : scene
    )),
  });
  assert.notEqual(computeSceneSpecSpeechHash(base), computeSceneSpecSpeechHash(changed));
}

{
  const base = sceneSpec();
  const changed = sceneSpec({
    scenes: base.scenes.map(scene => (
      scene.id === 'scene_01'
        ? { ...scene, captions: [{ start: 0, end: 1.2, text: '字幕已修改' }] }
        : scene
    )),
  });
  assert.notEqual(computeSceneSpecSpeechHash(base), computeSceneSpecSpeechHash(changed));
}

{
  const base = sceneSpec();
  const changed = sceneSpec({ scenes: [...base.scenes].reverse() });
  assert.notEqual(computeSceneSpecSpeechHash(base), computeSceneSpecSpeechHash(changed));
}

{
  const base = sceneSpec();
  const changed = sceneSpec({
    scenes: base.scenes.map(scene => ({
      ...scene,
      visual_text: { headline: `${scene.id} 新视觉标题`, cards: ['只改画面'] },
      template_id: 'another-visual-template',
      inputs: { accent: 'red' },
    })),
  });
  assert.equal(computeSceneSpecSpeechHash(base), computeSceneSpecSpeechHash(changed));
}

{
  const spec = sceneSpec();
  assert.equal(audioMatchesSceneSpec(matchingAudio(spec), spec), true);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), source: 'brief_storyboard' }, spec), false);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), scene_spec_hash: 'old-hash' }, spec), false);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), scene_count: 1 }, spec), false);
  assert.equal(audioMatchesSceneSpec({ ...matchingAudio(spec), scene_ids: ['scene_02', 'scene_01'] }, spec), false);
  assert.equal(audioMatchesSceneSpec({ path: 'D:/tmp/legacy.wav', status: 'ready' }, spec), false);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/run-all.js scene-spec-hash
```

Expected: FAIL with a module-not-found error for `sceneSpecHash`.

- [ ] **Step 3: Implement the service**

Create `server/services/creative-video/sceneSpecHash.js`:

```js
const crypto = require('crypto');

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = stableValue(value[key]);
    return acc;
  }, {});
}

function getSceneSpecSpeechSignature(sceneSpec = {}) {
  const scenes = arrayOrEmpty(sceneSpec.scenes);
  return {
    version: 1,
    scenes: scenes.map((scene, index) => {
      const input = objectOrEmpty(scene);
      return {
        id: String(input.id || `scene_${String(index + 1).padStart(2, '0')}`),
        order: Number.isFinite(Number(input.order)) ? Number(input.order) : index + 1,
        narration_text: String(input.narration_text ?? input.narrationText ?? ''),
        captions: stableValue(arrayOrEmpty(input.captions)),
      };
    }),
  };
}

function computeSceneSpecSpeechHash(sceneSpec = {}) {
  const signature = stableValue(getSceneSpecSpeechSignature(sceneSpec));
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(signature))
    .digest('hex');
}

function getSceneIds(sceneSpec = {}) {
  return arrayOrEmpty(sceneSpec.scenes).map((scene, index) => (
    String(objectOrEmpty(scene).id || `scene_${String(index + 1).padStart(2, '0')}`)
  ));
}

function audioPath(audio = {}) {
  const input = objectOrEmpty(audio);
  return String(input.path || input.narration_path || input.narrationPath || input.combined_path || '').trim();
}

function audioStatusAllowed(audio = {}) {
  const status = String(objectOrEmpty(audio).status || '').trim().toLowerCase();
  return !status || ['ready', 'done', 'rendered'].includes(status);
}

function audioMatchesSceneSpec(audio = {}, sceneSpec = {}) {
  const input = objectOrEmpty(audio);
  const expectedSceneIds = getSceneIds(sceneSpec);
  const sceneIds = arrayOrEmpty(input.scene_ids || input.sceneIds).map(item => String(item));
  if (!audioPath(input)) return false;
  if (!audioStatusAllowed(input)) return false;
  if (input.source !== 'scene_spec') return false;
  if (input.scene_spec_hash !== computeSceneSpecSpeechHash(sceneSpec)) return false;
  if (Number(input.scene_count ?? input.sceneCount) !== expectedSceneIds.length) return false;
  if (sceneIds.length !== expectedSceneIds.length) return false;
  return sceneIds.every((id, index) => id === expectedSceneIds[index]);
}

module.exports = {
  getSceneSpecSpeechSignature,
  computeSceneSpecSpeechHash,
  audioMatchesSceneSpec,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node tests/run-all.js scene-spec-hash
```

Expected: PASS for `test-scene-spec-hash.js`.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/sceneSpecHash.js tests/test-scene-spec-hash.js
git commit -m "新增场景脚本音频哈希服务"
```

### Task 2: Add Scene Spec Metadata To TTS Manifest

**Files:**
- Modify: `server/services/creative-video/ttsService.js`
- Modify: `tests/test-creative-video-tts-service.js`

- [ ] **Step 1: Add failing manifest metadata assertions**

In `tests/test-creative-video-tts-service.js`, add `computeSceneSpecSpeechHash` at the top:

```js
const { computeSceneSpecSpeechHash } = require('../server/services/creative-video/sceneSpecHash');
```

In the successful multi-scene synthesis test, after the manifest is returned, assert:

```js
assert.equal(result.audio_manifest.source, 'scene_spec');
assert.equal(result.audio_manifest.scene_spec_hash, computeSceneSpecSpeechHash(sceneSpec));
assert.equal(result.audio_manifest.scene_count, sceneSpec.scenes.length);
assert.deepEqual(result.audio_manifest.scene_ids, sceneSpec.scenes.map(scene => scene.id));
```

Add a no-narration test if the file does not already cover it:

```js
{
  const projectDir = await mkdtemp(path.join(tmpRoot, 'tts-empty-'));
  const emptySpec = {
    scenes: [
      { id: 'scene_01', order: 1, narration_text: '', captions: [{ text: '只显示字幕' }] },
      { id: 'scene_02', order: 2, narration_text: '   ', captions: [] },
    ],
  };
  const result = await ttsService.synthesizeSceneNarration({
    projectDir,
    sceneSpec: emptySpec,
    services: {
      ttsModel: {
        callTtsModel: async () => {
          throw new Error('空旁白不应调用 TTS');
        },
      },
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.audio_manifest.source, 'scene_spec');
  assert.equal(result.audio_manifest.scene_spec_hash, computeSceneSpecSpeechHash(emptySpec));
  assert.equal(result.audio_manifest.scene_count, 2);
  assert.deepEqual(result.audio_manifest.scene_ids, ['scene_01', 'scene_02']);
  assert.deepEqual(result.audio_manifest.scenes, []);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/run-all.js creative-video-tts-service
```

Expected: FAIL because `audio_manifest.source` and hash metadata are missing.

- [ ] **Step 3: Implement manifest metadata**

Modify `server/services/creative-video/ttsService.js`:

```js
const { computeSceneSpecSpeechHash } = require('./sceneSpecHash');
```

Add helper functions near `getScenes`:

```js
function sceneIds(sceneSpec = {}) {
  const scenes = Array.isArray(sceneSpec && sceneSpec.scenes) ? sceneSpec.scenes : [];
  return scenes.map(scene => String(scene.id || ''));
}

function createSceneSpecManifestBase(projectDir, sceneSpec) {
  const ids = sceneIds(sceneSpec);
  return {
    version: 1,
    source: 'scene_spec',
    scene_spec_hash: computeSceneSpecSpeechHash(sceneSpec || {}),
    scene_count: ids.length,
    scene_ids: ids,
    project_dir: projectDir,
    scenes: [],
  };
}
```

Replace every returned empty manifest in `synthesizeSceneNarration` that has access to `sceneSpec` with `createSceneSpecManifestBase(projectDir, sceneSpec)`. The missing `projectDir` branch can keep `{ scenes: [] }` because no project can be written.

Replace the current manifest initialization:

```js
const manifest = createSceneSpecManifestBase(projectDir, sceneSpec);
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node tests/run-all.js creative-video-tts-service
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/ttsService.js tests/test-creative-video-tts-service.js
git commit -m "为TTS产物写入场景脚本哈希"
```

### Task 3: Add Content Graph To Scene Spec Binding Service

**Files:**
- Create: `server/services/creative-video/html-video/sceneGraphBinding.js`
- Create: `tests/test-html-video-scene-graph-binding.js`

- [ ] **Step 1: Write failing graph binding tests**

Create `tests/test-html-video-scene-graph-binding.js`:

```js
const assert = require('assert');

const {
  resolveNodeSceneId,
  validateGraphMatchesSceneSpec,
} = require('../server/services/creative-video/html-video/sceneGraphBinding');

function spec() {
  return {
    scenes: [
      { id: 'scene_01', order: 1 },
      { id: 'scene_02', order: 2 },
      { id: 'scene_03', order: 3 },
    ],
  };
}

function graph(ids) {
  return {
    nodes: ids.map(id => ({ id })),
    edges: ids.slice(0, -1).map((id, index) => ({ from: id, to: ids[index + 1], kind: 'sequence' })),
  };
}

{
  assert.equal(resolveNodeSceneId({ id: 'node_a', scene_id: 'scene_01' }), 'scene_01');
  assert.equal(resolveNodeSceneId({ id: 'scene_02' }), 'scene_02');
}

{
  const result = validateGraphMatchesSceneSpec(graph(['scene_01', 'scene_02', 'scene_03']), spec());
  assert.equal(result.ok, true);
  assert.deepEqual(result.scene_ids, ['scene_01', 'scene_02', 'scene_03']);
}

{
  const result = validateGraphMatchesSceneSpec({
    nodes: [
      { id: 'node_a', scene_id: 'scene_01' },
      { id: 'node_b', scene_id: 'scene_02' },
      { id: 'node_c', scene_id: 'scene_03' },
    ],
    edges: [],
  }, spec());
  assert.equal(result.ok, true);
  assert.deepEqual(result.scene_ids, ['scene_01', 'scene_02', 'scene_03']);
}

{
  const result = validateGraphMatchesSceneSpec(graph(['scene_01', 'scene_02', 'scene_03', 'scene_04']), spec());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'node_count_mismatch');
}

{
  const result = validateGraphMatchesSceneSpec(graph(['scene_01', 'scene_03']), spec());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'node_count_mismatch');
}

{
  const result = validateGraphMatchesSceneSpec(graph(['scene_02', 'scene_01', 'scene_03']), spec());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'scene_order_mismatch');
  assert.equal(result.index, 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/run-all.js html-video-scene-graph-binding
```

Expected: FAIL with a module-not-found error for `sceneGraphBinding`.

- [ ] **Step 3: Implement binding service**

Create `server/services/creative-video/html-video/sceneGraphBinding.js`:

```js
const { normalizeSceneSpec } = require('../sceneSpecService');
const { topoSort, getNode } = require('./contentGraph');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resolveNodeSceneId(node = {}) {
  const input = objectOrEmpty(node);
  return String(input.scene_id || input.sceneId || input.metadata?.scene_id || input.id || '').trim();
}

function sceneIdsFromSpec(sceneSpec = {}) {
  const normalized = normalizeSceneSpec(sceneSpec || {});
  return (normalized.scenes || []).map(scene => String(scene.id || '').trim());
}

function orderedNodes(graph = {}) {
  return topoSort(graph).map(nodeId => getNode(graph, nodeId) || { id: nodeId });
}

function validateGraphMatchesSceneSpec(graph = {}, sceneSpec = {}) {
  const expected = sceneIdsFromSpec(sceneSpec);
  const nodes = orderedNodes(graph);
  const actual = nodes.map(resolveNodeSceneId);

  if (actual.length !== expected.length) {
    return {
      ok: false,
      reason: 'node_count_mismatch',
      expected_count: expected.length,
      actual_count: actual.length,
      expected_scene_ids: expected,
      actual_scene_ids: actual,
    };
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      return {
        ok: false,
        reason: 'scene_order_mismatch',
        index,
        expected_scene_id: expected[index],
        actual_scene_id: actual[index],
        expected_scene_ids: expected,
        actual_scene_ids: actual,
      };
    }
  }

  return {
    ok: true,
    scene_ids: actual,
  };
}

module.exports = {
  resolveNodeSceneId,
  validateGraphMatchesSceneSpec,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node tests/run-all.js html-video-scene-graph-binding
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/sceneGraphBinding.js tests/test-html-video-scene-graph-binding.js
git commit -m "新增内容图与场景脚本绑定校验"
```

### Task 4: Make Template-Input Frame Mapping Scene-Bound

**Files:**
- Modify: `server/services/creative-video/html-video/sceneSpecMapper.js`
- Modify: `tests/test-html-video-scene-spec-mapper.js`

- [ ] **Step 1: Add failing mapper tests**

In `tests/test-html-video-scene-spec-mapper.js`, add or extend tests with:

```js
assert.throws(() => {
  buildFramesFromGraph({
    sceneSpec: {
      scenes: [
        { id: 'scene_01', order: 1, narration_text: '第一段', captions: [{ text: '字幕一' }] },
      ],
    },
    contentGraph: {
      nodes: [
        { id: 'scene_01', durationSec: 3 },
        { id: 'scene_02', durationSec: 3 },
      ],
      edges: [{ from: 'scene_01', to: 'scene_02', kind: 'sequence' }],
    },
    templateId: 'template-a',
    templateInputs: {},
    templateSchema: {},
  });
}, /内容图节点 scene_02 未匹配到 scene_spec 场景/);

{
  const frames = buildFramesFromGraph({
    sceneSpec: {
      scenes: [
        { id: 'scene_01', order: 1, narration_text: '第一段', captions: [{ text: '字幕一' }], visual_text: { headline: '标题一' } },
        { id: 'scene_02', order: 2, narration_text: '第二段', captions: [{ text: '字幕二' }], visual_text: { headline: '标题二' } },
      ],
    },
    contentGraph: {
      nodes: [
        { id: 'node_a', scene_id: 'scene_01', durationSec: 4, frameIntent: 'data' },
        { id: 'node_b', scene_id: 'scene_02', durationSec: 5, frameIntent: 'text' },
      ],
      edges: [{ from: 'node_a', to: 'node_b', kind: 'sequence' }],
    },
    templateId: 'template-a',
    templateInputs: {},
    templateSchema: {},
  });
  assert.equal(frames.length, 2);
  assert.equal(frames[0].id, 'scene_01');
  assert.equal(frames[0].scene_id, 'scene_01');
  assert.equal(frames[0].graph_node_id, 'node_a');
  assert.equal(frames[0].narration_text, '第一段');
  assert.deepEqual(frames[0].captions, [{ text: '字幕一' }]);
  assert.equal(frames[0].metadata.graph_node.id, 'node_a');
  assert.equal(frames[0].metadata.scene_snapshot.id, 'scene_01');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/run-all.js html-video-scene-spec-mapper
```

Expected: FAIL because missing scenes are silently converted to empty frame fields and `graph_node_id` / `scene_snapshot` are missing.

- [ ] **Step 3: Update mapper implementation**

Modify `server/services/creative-video/html-video/sceneSpecMapper.js`:

```js
const { resolveNodeSceneId } = require('./sceneGraphBinding');
```

Inside `buildFramesFromGraph`, replace scene lookup and frame identity with:

```js
const sceneId = resolveNodeSceneId(node);
const scene = scenesById.get(sceneId);
if (!scene) {
  throw new Error(`内容图节点 ${nodeId} 未匹配到 scene_spec 场景 ${sceneId || '未指定'}。`);
}
return {
  id: scene.id,
  scene_id: scene.id,
  graph_node_id: nodeId,
  order: index + 1,
  template_id: templateId,
  engine: 'hyperframes-playwright',
  source_mode: 'template_inputs',
  html_path: null,
  preview_mp4_path: null,
  duration_sec: Number.isFinite(node.durationSec) ? node.durationSec : (scene.duration || DEFAULT_FRAME_DURATION_SEC),
  inputs: buildFrameInputs({
    templateInputs,
    templateSchema,
    scene,
    index,
    total,
  }),
  narration_text: scene.narration_text || '',
  captions: clone(scene.captions),
  metadata: {
    frame_intent: node.frameIntent || scene.kind || 'text',
    visual_text: clone(scene.visual_text),
    graph_node: clone(node),
    scene_snapshot: {
      id: scene.id,
      order: scene.order,
      narration_text: scene.narration_text || '',
      captions: clone(scene.captions),
    },
  },
  ...defaultFrameFields(),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node tests/run-all.js html-video-scene-spec-mapper
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/sceneSpecMapper.js tests/test-html-video-scene-spec-mapper.js
git commit -m "绑定模板帧到场景脚本"
```

### Task 5: Make Raw HTML Frame Builder Scene-Bound

**Files:**
- Modify: `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`
- Modify: `tests/test-html-video-raw-html-frame-builder.js`

- [ ] **Step 1: Add failing raw frame builder tests**

In `tests/test-html-video-raw-html-frame-builder.js`, add:

```js
await assert.rejects(async () => {
  await buildRawHtmlFrameProject({
    projectDir,
    workflowId: 'wf',
    runId: 'run',
    graph: {
      nodes: [
        { id: 'scene_01' },
        { id: 'scene_02' },
      ],
      edges: [{ from: 'scene_01', to: 'scene_02', kind: 'sequence' }],
    },
    frameHtmlByNodeId: {
      scene_01: '<html><body><main data-text-key="headline">A</main></body></html>',
      scene_02: '<html><body><main data-text-key="headline">B</main></body></html>',
    },
    sceneSpec: {
      scenes: [
        { id: 'scene_01', order: 1, narration_text: '第一段', captions: [{ text: '字幕一' }] },
      ],
    },
    target: {},
    template: { id: 'template-a' },
  });
}, /内容图节点 scene_02 未匹配到 scene_spec 场景/);

{
  const project = await buildRawHtmlFrameProject({
    projectDir,
    workflowId: 'wf',
    runId: 'run-bound',
    graph: {
      nodes: [
        { id: 'node_a', scene_id: 'scene_01', durationSec: 4 },
      ],
      edges: [],
    },
    frameHtmlByNodeId: {
      node_a: '<html><body><main data-text-key="headline">A</main></body></html>',
    },
    sceneSpec: {
      scenes: [
        { id: 'scene_01', order: 1, narration_text: '第一段', captions: [{ text: '字幕一' }], visual_text: { headline: '标题一' } },
      ],
    },
    target: {},
    template: { id: 'template-a' },
  });
  assert.equal(project.frames.length, 1);
  assert.equal(project.frames[0].id, 'scene_01');
  assert.equal(project.frames[0].scene_id, 'scene_01');
  assert.equal(project.frames[0].graph_node_id, 'node_a');
  assert.equal(project.frames[0].narration_text, '第一段');
  assert.equal(project.frames[0].metadata.graph_node.id, 'node_a');
  assert.equal(project.frames[0].metadata.scene_snapshot.id, 'scene_01');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node tests/run-all.js html-video-raw-html-frame-builder
```

Expected: FAIL because raw frames use `nodeId` as `scene_id` and missing scenes become empty frame data.

- [ ] **Step 3: Update raw builder implementation**

Modify `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`:

```js
const { resolveNodeSceneId } = require('./sceneGraphBinding');
```

Inside the frame loop, replace scene lookup and frame identity with:

```js
const sceneId = resolveNodeSceneId(node);
const scene = scenes.get(sceneId);
if (!scene) {
  throw new Error(`内容图节点 ${nodeId} 未匹配到 scene_spec 场景 ${sceneId || '未指定'}。`);
}
const durationSec = Number(node.durationSec || scene.duration || scene.target_duration_sec || DEFAULT_FRAME_DURATION_SEC);
const normalizedDurationSec = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : DEFAULT_FRAME_DURATION_SEC;
const captions = normalizeCaptions(scene, normalizedDurationSec);
const frame = {
  id: scene.id,
  scene_id: scene.id,
  graph_node_id: nodeId,
  order: index + 1,
  template_id: template.id || null,
  engine: 'hyperframes-playwright',
  source_mode: 'raw_html',
  html_path: htmlPath,
  preview_mp4_path: null,
  duration_sec: normalizedDurationSec,
  inputs: {},
  narration_text: scene.narration_text || '',
  captions,
  metadata: {
    frame_intent: node.kind || scene.kind || 'text',
    visual_text: clone(scene.visual_text),
    graph_node: clone(node),
    scene_snapshot: {
      id: scene.id,
      order: scene.order,
      narration_text: scene.narration_text || '',
      captions: clone(scene.captions),
    },
  },
  ...defaultFrameFields(),
};
```

Keep `htmlMap.get(nodeId)` and `safeFilePart(nodeId, ...)` unchanged so generated HTML remains keyed by graph node id.

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
node tests/run-all.js html-video-raw-html-frame-builder
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/rawHtmlFrameBuilder.js tests/test-html-video-raw-html-frame-builder.js
git commit -m "绑定raw HTML帧到场景脚本"
```

### Task 6: Add Timeline Consistency Validation

**Files:**
- Create: `server/services/creative-video/html-video/timelineConsistency.js`
- Create: `tests/test-html-video-timeline-consistency.js`
- Modify: `server/services/creative-video/html-video/validationGate.js`
- Modify: `tests/test-html-video-validation-gate.js`

- [ ] **Step 1: Write failing direct validation tests**

Create `tests/test-html-video-timeline-consistency.js`:

```js
const assert = require('assert');

const { computeSceneSpecSpeechHash } = require('../server/services/creative-video/sceneSpecHash');
const { validateSceneSpecTimelineConsistency } = require('../server/services/creative-video/html-video/timelineConsistency');

function spec() {
  return {
    scenes: [
      { id: 'scene_01', order: 1, narration_text: '第一段', captions: [{ text: '字幕一' }] },
      { id: 'scene_02', order: 2, narration_text: '第二段', captions: [{ text: '字幕二' }] },
    ],
  };
}

function project() {
  return {
    frames: [
      { id: 'scene_01', scene_id: 'scene_01', narration_text: '第一段', captions: [{ text: '字幕一' }] },
      { id: 'scene_02', scene_id: 'scene_02', narration_text: '第二段', captions: [{ text: '字幕二' }] },
    ],
    audio: {
      source: 'scene_spec',
      scene_spec_hash: computeSceneSpecSpeechHash(spec()),
      scene_count: 2,
      scene_ids: ['scene_01', 'scene_02'],
      narration_path: 'tts/combined.wav',
      status: 'ready',
    },
  };
}

{
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: project(), audio: project().audio });
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
}

{
  const badProject = project();
  badProject.frames = badProject.frames.slice(0, 1);
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'frame_scene_count_mismatch');
}

{
  const badProject = project();
  badProject.frames[1].scene_id = 'scene_03';
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'frame_scene_missing');
}

{
  const badProject = project();
  badProject.frames[1].scene_id = 'scene_01';
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some(item => item.code === 'frame_scene_duplicate'), true);
}

{
  const badProject = project();
  badProject.frames[0].narration_text = '错误旁白';
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'frame_narration_mismatch');
}

{
  const badProject = project();
  badProject.frames[0].captions = [{ text: '错误字幕' }];
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'frame_captions_mismatch');
}

{
  const badProject = project();
  badProject.audio.scene_spec_hash = 'legacy-hash';
  const result = validateSceneSpecTimelineConsistency({ sceneSpec: spec(), project: badProject, audio: badProject.audio });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'audio_scene_spec_hash_mismatch');
}
```

- [ ] **Step 2: Run direct test to verify it fails**

Run:

```powershell
node tests/run-all.js html-video-timeline-consistency
```

Expected: FAIL with a module-not-found error for `timelineConsistency`.

- [ ] **Step 3: Implement timeline consistency module**

Create `server/services/creative-video/html-video/timelineConsistency.js`:

```js
const { createDiagnostic } = require('./diagnostics');
const { audioMatchesSceneSpec } = require('../sceneSpecHash');

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCaptions(value) {
  return JSON.stringify(arrayOrEmpty(value));
}

function add(diagnostics, code, userMessage, details = {}) {
  diagnostics.push(createDiagnostic({
    code,
    stage: 'timeline-consistency',
    user_message: userMessage,
    details,
    fallback_allowed: false,
  }));
}

function validateSceneSpecTimelineConsistency({ sceneSpec, project, audio } = {}) {
  const diagnostics = [];
  const scenes = arrayOrEmpty(objectOrEmpty(sceneSpec).scenes);
  const frames = arrayOrEmpty(objectOrEmpty(project).frames);
  const scenesById = new Map(scenes.map(scene => [String(scene.id || ''), scene]));
  const seen = new Set();

  if (scenes.length === 0) {
    add(diagnostics, 'scene_spec_empty', '字幕脚本为空，无法校验旁白和画面时间轴。');
    return { ok: false, diagnostics };
  }

  if (frames.length !== scenes.length) {
    add(diagnostics, 'frame_scene_count_mismatch', '画面帧与字幕脚本数量不一致，无法继续渲染。', {
      expected_count: scenes.length,
      actual_count: frames.length,
    });
  }

  frames.forEach((frame, index) => {
    const sceneId = String(frame.scene_id || frame.sceneId || frame.id || '');
    const scene = scenesById.get(sceneId);
    if (!scene) {
      add(diagnostics, 'frame_scene_missing', '画面帧与字幕脚本不一致，无法继续渲染。', {
        frame_id: frame.id,
        scene_id: sceneId,
        index,
      });
      return;
    }
    if (seen.has(sceneId)) {
      add(diagnostics, 'frame_scene_duplicate', '画面帧重复绑定同一个字幕场景，无法继续渲染。', {
        frame_id: frame.id,
        scene_id: sceneId,
        index,
      });
    }
    seen.add(sceneId);

    if (String(frame.narration_text || '') !== String(scene.narration_text || '')) {
      add(diagnostics, 'frame_narration_mismatch', '画面帧旁白与字幕脚本不一致，无法继续渲染。', {
        frame_id: frame.id,
        scene_id: sceneId,
      });
    }

    if (normalizeCaptions(frame.captions) !== normalizeCaptions(scene.captions)) {
      add(diagnostics, 'frame_captions_mismatch', '画面帧字幕与字幕脚本不一致，无法继续渲染。', {
        frame_id: frame.id,
        scene_id: sceneId,
      });
    }
  });

  const audioInput = audio || objectOrEmpty(project).audio;
  if (audioInput && (audioInput.path || audioInput.narration_path || audioInput.narrationPath)) {
    if (!audioMatchesSceneSpec(audioInput, sceneSpec)) {
      add(diagnostics, 'audio_scene_spec_hash_mismatch', '当前音频与字幕脚本不一致，请重新生成旁白后再渲染。');
    }
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

module.exports = {
  validateSceneSpecTimelineConsistency,
};
```

- [ ] **Step 4: Run direct test to verify it passes**

Run:

```powershell
node tests/run-all.js html-video-timeline-consistency
```

Expected: PASS.

- [ ] **Step 5: Integrate into validation gate**

Modify `server/services/creative-video/html-video/validationGate.js`:

```js
const { validateSceneSpecTimelineConsistency } = require('./timelineConsistency');
```

Change function signature:

```js
async function validateHtmlVideoProject({
  project,
  projectDir,
  templateRegistry,
  environment,
  sceneSpec,
  options = {},
} = {}) {
```

After `const frames = arrayOrEmpty(input.frames);`, add:

```js
if (sceneSpec) {
  const timelineConsistency = validateSceneSpecTimelineConsistency({
    sceneSpec,
    project: input,
    audio: input.audio,
  });
  diagnostics.push(...timelineConsistency.diagnostics);
}
```

- [ ] **Step 6: Add validation gate regression assertion**

In `tests/test-html-video-validation-gate.js`, add a test that passes `sceneSpec` and a project with mismatched audio:

```js
const validation = await validateHtmlVideoProject({
  project: {
    template_id: 'template-a',
    template_inputs: {},
    output: { resolution: { width: 1920, height: 1080 }, fps: 30 },
    frames: [
      { id: 'scene_01', scene_id: 'scene_01', template_id: 'template-a', narration_text: '第一段', captions: [{ text: '字幕一' }] },
    ],
    audio: {
      source: 'scene_spec',
      scene_spec_hash: 'legacy-hash',
      scene_count: 1,
      scene_ids: ['scene_01'],
      narration_path: 'tts/legacy.wav',
      status: 'ready',
    },
  },
  projectDir,
  templateRegistry,
  environment: { ok: true, diagnostics: [] },
  sceneSpec: {
    scenes: [
      { id: 'scene_01', order: 1, narration_text: '第一段', captions: [{ text: '字幕一' }] },
    ],
  },
});
assert.equal(validation.ok, false);
assert.equal(validation.diagnostics.some(item => item.code === 'audio_scene_spec_hash_mismatch'), true);
```

- [ ] **Step 7: Run validation tests**

Run:

```powershell
node tests/run-all.js html-video-validation-gate
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add server/services/creative-video/html-video/timelineConsistency.js server/services/creative-video/html-video/validationGate.js tests/test-html-video-timeline-consistency.js tests/test-html-video-validation-gate.js
git commit -m "新增渲染前时间轴一致性校验"
```

### Task 7: Preserve Audio Hash Metadata In Project Schema

**Files:**
- Modify: `server/services/creative-video/html-video/projectSchema.js`
- Modify: existing schema tests if present, or add assertions to `tests/test-html-video-validation-gate.js`

- [ ] **Step 1: Add failing normalization assertion**

Find the test file that already imports `normalizeProject`:

```powershell
rg -n "normalizeProject|projectSchema" tests
```

Add this assertion to the most focused existing project schema test file. If none exists, add it to `tests/test-html-video-validation-gate.js` before validation-gate specific assertions:

```js
const { normalizeProject } = require('../server/services/creative-video/html-video/projectSchema');

{
  const normalized = normalizeProject({
    audio: {
      source: 'scene_spec',
      scene_spec_hash: 'hash-a',
      scene_count: 2,
      scene_ids: ['scene_01', 'scene_02'],
      narration_path: 'tts/current.wav',
    },
  });
  assert.equal(normalized.audio.source, 'scene_spec');
  assert.equal(normalized.audio.scene_spec_hash, 'hash-a');
  assert.equal(normalized.audio.scene_count, 2);
  assert.deepEqual(normalized.audio.scene_ids, ['scene_01', 'scene_02']);
}
```

- [ ] **Step 2: Run focused test**

Run the test file that received the assertion. If the assertion was added to validation gate, run:

```powershell
node tests/run-all.js html-video-validation-gate
```

Expected: PASS if `normalizeAudio` already preserves unknown fields through spreading. If it fails, continue to the implementation step.

- [ ] **Step 3: Make audio metadata explicit if needed**

If Step 2 fails, modify `defaultAudio()` in `server/services/creative-video/html-video/projectSchema.js`:

```js
function defaultAudio() {
  return {
    source: null,
    scene_spec_hash: null,
    scene_count: null,
    scene_ids: [],
    tts_manifest_path: null,
    narration_path: null,
    music_path: null,
    mix: {
      music_volume_db: -18,
      narration_volume_db: 0,
      fade_in_sec: 0,
      fade_out_sec: 1.5,
    },
  };
}
```

And normalize `scene_ids` in `normalizeAudio`:

```js
return {
  ...defaults,
  ...input,
  scene_ids: arrayOrEmpty(input.scene_ids || input.sceneIds),
  mix: {
    ...defaults.mix,
    ...mix,
  },
};
```

- [ ] **Step 4: Run focused test again**

Run:

```powershell
node tests/run-all.js html-video-validation-gate
```

Expected: PASS.

- [ ] **Step 5: Commit**

If only tests changed:

```powershell
git add tests/test-html-video-validation-gate.js
git commit -m "覆盖音频哈希元数据归一化"
```

If schema changed too:

```powershell
git add server/services/creative-video/html-video/projectSchema.js tests/test-html-video-validation-gate.js
git commit -m "显式保留音频哈希元数据"
```

### Task 8: Enforce Graph Fallback In Html Video Workflow

**Files:**
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Modify: `tests/test-html-video-workflow.js`

- [ ] **Step 1: Add failing workflow graph mismatch test**

In `tests/test-html-video-workflow.js`, add a raw-html workflow test where the AI content graph returns one extra node:

```js
const sceneSpec = {
  title: '图文一致性测试',
  scenes: [
    { id: 'scene_01', order: 1, narration_text: '第一段', captions: [{ text: '字幕一' }], visual_text: { headline: '标题一' } },
    { id: 'scene_02', order: 2, narration_text: '第二段', captions: [{ text: '字幕二' }], visual_text: { headline: '标题二' } },
  ],
};
const progressMessages = [];
const result = await generateHtmlVideo({
  workflowId: 'wf_graph_mismatch',
  runId: 'run_graph_mismatch',
  rootDir,
  sceneSpec,
  target: { html_video_generation_mode: 'raw_html' },
  skipValidation: true,
  templateRegistry,
  services: {
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        const prompt = messages[0].content;
        if (prompt.includes('选择')) {
          return { success: true, text: JSON.stringify({ template_id: 'template-a', reason: 'test' }) };
        }
        if (prompt.startsWith('你是 html-video 的 content graph')) {
          return {
            success: true,
            text: JSON.stringify({
              nodes: [
                { id: 'scene_01', durationSec: 3 },
                { id: 'scene_02', durationSec: 3 },
                { id: 'scene_03', durationSec: 3 },
              ],
              edges: [
                { from: 'scene_01', to: 'scene_02', kind: 'sequence' },
                { from: 'scene_02', to: 'scene_03', kind: 'sequence' },
              ],
            }),
          };
        }
        return { success: true, text: '{}' };
      },
    },
    environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
    projectOrchestrator: {
      renderHtmlVideoProject: async ({ project }) => ({
        success: true,
        output_path: path.join(rootDir, 'out.mp4'),
        project,
        diagnostics: [],
      }),
    },
    visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
  },
  onProgress: event => progressMessages.push(event.message),
});
assert.equal(result.success, true);
assert.equal(result.project.frames.length, 2);
assert.deepEqual(result.project.frames.map(frame => frame.scene_id), ['scene_01', 'scene_02']);
assert.equal(result.project.frames.some(frame => frame.scene_id === 'scene_03'), false);
assert.equal(result.html_video_diagnostics.some(item => item.code === 'content_graph_scene_spec_mismatch'), true);
assert.equal(progressMessages.some(message => String(message).includes('画面帧与字幕脚本不一致，已回退为字幕脚本生成画面结构。')), true);
```

Adjust the template-selection prompt branch to match the patterns already used in this file.

- [ ] **Step 2: Run workflow test to verify it fails**

Run:

```powershell
node tests/run-all.js html-video-workflow
```

Expected: FAIL because the workflow currently loops over the 3 AI graph nodes and the raw frame builder can produce or attempt an extra frame.

- [ ] **Step 3: Add graph validation and fallback**

Modify `server/services/creative-video/html-video/htmlVideoWorkflow.js` imports:

```js
const { validateGraphMatchesSceneSpec } = require('./sceneGraphBinding');
```

After `const graphParsed = contentGraphAgent.parseContentGraphResponse(graphAi.text, sceneSpec);` succeeds and before `html_video_graph_done`, add:

```js
let contentGraph = graphParsed.graph;
if (sceneSpec) {
  const graphBinding = validateGraphMatchesSceneSpec(contentGraph, sceneSpec);
  if (!graphBinding.ok) {
    diagnostics.push(createDiagnostic({
      code: 'content_graph_scene_spec_mismatch',
      stage: 'ai-content-graph',
      user_message: '画面帧与字幕脚本不一致，已回退为字幕脚本生成画面结构。',
      details: graphBinding,
      severity: 'warning',
      fallback_allowed: true,
    }));
    await report(onProgress, {
      type: 'html_video_graph_scene_spec_mismatch',
      stage: 'project',
      message: '画面帧与字幕脚本不一致，已回退为字幕脚本生成画面结构。',
      data: graphBinding,
    });
    contentGraph = mapSceneSpecToContentGraph(sceneSpec);
  }
}
```

Then replace later uses of `graphParsed.graph` in the raw-html branch with `contentGraph`:

```js
node_count: contentGraph.nodes?.length || 0,
edge_count: contentGraph.edges?.length || 0,
const nodes = contentGraph.nodes || [];
graph: contentGraph,
```

In `frameHtmlAgent.generateFrameHtml`, pass `graph: contentGraph`.

In `buildRawHtmlFrameProject`, pass `graph: contentGraph`.

- [ ] **Step 4: Run workflow test to verify it passes**

Run:

```powershell
node tests/run-all.js html-video-workflow
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/htmlVideoWorkflow.js tests/test-html-video-workflow.js
git commit -m "内容图不匹配场景脚本时自动回退"
```

### Task 9: Enforce Hash-Based Audio Reuse In Workflow

**Files:**
- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Modify: `tests/test-html-video-workflow.js`

- [ ] **Step 1: Replace legacy audio reuse test with failing hash tests**

In `tests/test-html-video-workflow.js`, find the existing `existingAudioPath` test that currently asserts:

```js
assert.equal(existingAudioResult.project.audio.narration_path, existingAudioPath);
assert.equal(existingAudioMuxPath, existingAudioPath);
```

Replace it with two cases:

```js
const { computeSceneSpecSpeechHash } = require('../server/services/creative-video/sceneSpecHash');
```

Legacy audio without hash must not be reused:

```js
let ttsCalls = 0;
let muxedNarrationPath = null;
const result = await generateHtmlVideo({
  workflowId: 'wf_audio_legacy',
  runId: 'run_audio_legacy',
  rootDir,
  sceneSpec,
  creativeContext: {
    audio: {
      path: existingAudioPath,
      status: 'ready',
    },
  },
  target: { html_video_generation_mode: 'template_inputs' },
  skipValidation: true,
  templateRegistry,
  services: {
    aiTextModel,
    environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
    ttsService: {
      synthesizeSceneNarration: async ({ sceneSpec: ttsSceneSpec }) => {
        ttsCalls += 1;
        return {
          success: true,
          audio_manifest: {
            source: 'scene_spec',
            scene_spec_hash: computeSceneSpecSpeechHash(ttsSceneSpec),
            scene_count: ttsSceneSpec.scenes.length,
            scene_ids: ttsSceneSpec.scenes.map(scene => scene.id),
            combined_path: generatedAudioPath,
            scenes: [],
          },
        };
      },
    },
    projectOrchestrator: {
      renderHtmlVideoProject: async ({ project }) => {
        muxedNarrationPath = project.audio.narration_path;
        return { success: true, output_path: path.join(rootDir, 'legacy-output.mp4'), project, diagnostics: [] };
      },
    },
    visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
  },
});
assert.equal(result.success, true);
assert.equal(ttsCalls, 1);
assert.equal(result.project.audio.narration_path, generatedAudioPath);
assert.equal(muxedNarrationPath, generatedAudioPath);
assert.notEqual(muxedNarrationPath, existingAudioPath);
```

Valid scene-spec audio with matching hash may be reused:

```js
let reuseTtsCalls = 0;
let reusedMuxedNarrationPath = null;
const reuseResult = await generateHtmlVideo({
  workflowId: 'wf_audio_reuse',
  runId: 'run_audio_reuse',
  rootDir,
  sceneSpec,
  creativeContext: {
    audio: {
      source: 'scene_spec',
      scene_spec_hash: computeSceneSpecSpeechHash(sceneSpec),
      scene_count: sceneSpec.scenes.length,
      scene_ids: sceneSpec.scenes.map(scene => scene.id),
      path: existingAudioPath,
      status: 'ready',
    },
  },
  target: { html_video_generation_mode: 'template_inputs' },
  skipValidation: true,
  templateRegistry,
  services: {
    aiTextModel,
    environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
    ttsService: {
      synthesizeSceneNarration: async () => {
        reuseTtsCalls += 1;
        return { success: false, message: '匹配 hash 时不应重新生成。' };
      },
    },
    projectOrchestrator: {
      renderHtmlVideoProject: async ({ project }) => {
        reusedMuxedNarrationPath = project.audio.narration_path;
        return { success: true, output_path: path.join(rootDir, 'reuse-output.mp4'), project, diagnostics: [] };
      },
    },
    visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
  },
});
assert.equal(reuseResult.success, true);
assert.equal(reuseTtsCalls, 0);
assert.equal(reuseResult.project.audio.narration_path, existingAudioPath);
assert.equal(reusedMuxedNarrationPath, existingAudioPath);
```

- [ ] **Step 2: Run workflow test to verify it fails**

Run:

```powershell
node tests/run-all.js html-video-workflow
```

Expected: FAIL because legacy audio is still reused by path.

- [ ] **Step 3: Implement hash-based audio resolution**

Modify `server/services/creative-video/html-video/htmlVideoWorkflow.js` imports:

```js
const { computeSceneSpecSpeechHash, audioMatchesSceneSpec } = require('../sceneSpecHash');
```

Replace `resolveExistingNarrationPath` with:

```js
function resolveExistingNarrationAudio(creativeContext = {}, sceneSpec = null) {
  const audio = objectOrEmpty(creativeContext.audio);
  const audioPath = String(audio.path || audio.narration_path || audio.narrationPath || '').trim();
  if (!audioPath || !sceneSpec) return { reusable: false, audio, path: null, reason: 'missing_path_or_scene_spec' };
  if (!audioMatchesSceneSpec({ ...audio, path: audioPath }, sceneSpec)) {
    return { reusable: false, audio, path: audioPath, reason: 'scene_spec_mismatch' };
  }
  return { reusable: true, audio, path: audioPath, reason: 'matched' };
}
```

Replace the audio block near the end of `generateHtmlVideo` with:

```js
const existingNarration = resolveExistingNarrationAudio(creativeContext, sceneSpec);
if (existingNarration.reusable) {
  project.audio = objectOrEmpty(project.audio);
  project.audio.source = 'scene_spec';
  project.audio.scene_spec_hash = existingNarration.audio.scene_spec_hash;
  project.audio.scene_count = existingNarration.audio.scene_count;
  project.audio.scene_ids = existingNarration.audio.scene_ids;
  project.audio.narration_path = existingNarration.path;
  project.audio.tts_manifest_path = project.audio.tts_manifest_path || null;
} else if (services.ttsService && sceneSpec) {
  if (existingNarration.path) {
    await report(onProgress, {
      type: 'html_video_tts_regenerate_started',
      stage: 'audio',
      message: '检测到脚本已变化，正在按当前字幕重新生成旁白...',
      data: { reason: existingNarration.reason },
    });
  }
  const tts = await services.ttsService.synthesizeSceneNarration({
    projectDir,
    sceneSpec,
  });
  if (!tts.success) {
    return failure(tts.message || '旁白音频生成失败。', diagnostics, {
      html_video_project_path: projectDir,
      project_dir: projectDir,
      project,
    });
  }
  project.audio = objectOrEmpty(project.audio);
  project.audio.source = 'scene_spec';
  project.audio.scene_spec_hash = tts.audio_manifest?.scene_spec_hash || computeSceneSpecSpeechHash(sceneSpec);
  project.audio.scene_count = tts.audio_manifest?.scene_count || sceneSpec.scenes.length;
  project.audio.scene_ids = tts.audio_manifest?.scene_ids || sceneSpec.scenes.map(scene => scene.id);
  project.audio.tts_manifest_path = 'tts/audio_manifest.json';
  project.audio.narration_path = tts.audio_manifest?.combined_path || project.audio.narration_path || null;
} else if (existingNarration.path && sceneSpec) {
  return failure('当前音频与字幕脚本不一致，请重新生成旁白后再渲染。', diagnostics, {
    html_video_project_path: projectDir,
    project_dir: projectDir,
    project,
  });
}
```

- [ ] **Step 4: Pass sceneSpec into validation**

In the earlier `validateHtmlVideoProject` call in `generateHtmlVideo`, add:

```js
sceneSpec,
```

If timeline validation now blocks before TTS because `project.audio` is still empty, keep the validation call before audio generation but rely on `timelineConsistency` to skip empty audio; do not move render validation after TTS unless tests prove it is necessary.

- [ ] **Step 5: Run workflow test to verify it passes**

Run:

```powershell
node tests/run-all.js html-video-workflow
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add server/services/creative-video/html-video/htmlVideoWorkflow.js tests/test-html-video-workflow.js
git commit -m "按场景脚本哈希复用旁白音频"
```

### Task 10: Add Exact Regression For Latest Root Bug

**Files:**
- Modify: `tests/test-html-video-workflow.js`

- [ ] **Step 1: Add failing end-to-end regression**

Add one workflow test named in comments or assertion text as "旧7段音频 + 新10段字幕 + 11节点内容图":

```js
const tenSceneSpec = {
  title: '最新错位回归',
  scenes: Array.from({ length: 10 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return {
      id: `scene_${number}`,
      order: index + 1,
      narration_text: `第 ${index + 1} 段新旁白`,
      captions: [{ start: 0, end: 1, text: `第 ${index + 1} 段新字幕` }],
      visual_text: { headline: `第 ${index + 1} 帧画面` },
    };
  }),
};
let ttsCalls = 0;
let muxedAudio = null;
const result = await generateHtmlVideo({
  workflowId: '20260621170402265124_regression',
  runId: '20260621-170546-204Z-074ea9-hyperframes_freeform_regression',
  rootDir,
  sceneSpec: tenSceneSpec,
  creativeContext: {
    audio: {
      path: path.join(rootDir, 'legacy-seven-segment.wav'),
      status: 'ready',
      segment_count: 7,
    },
  },
  target: { html_video_generation_mode: 'raw_html' },
  skipValidation: true,
  templateRegistry,
  services: {
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        const prompt = messages[0].content;
        if (prompt.includes('选择')) {
          return { success: true, text: JSON.stringify({ template_id: 'template-a', reason: 'test' }) };
        }
        if (prompt.startsWith('你是 html-video 的 content graph')) {
          const ids = Array.from({ length: 11 }, (_, index) => `scene_${String(index + 1).padStart(2, '0')}`);
          return {
            success: true,
            text: JSON.stringify({
              nodes: ids.map(id => ({ id, durationSec: 3 })),
              edges: ids.slice(0, -1).map((id, index) => ({ from: id, to: ids[index + 1], kind: 'sequence' })),
            }),
          };
        }
        return { success: true, text: '{}' };
      },
    },
    environmentDoctor: async () => ({ ok: true, diagnostics: [] }),
    ttsService: {
      synthesizeSceneNarration: async ({ sceneSpec }) => {
        ttsCalls += 1;
        return {
          success: true,
          audio_manifest: {
            source: 'scene_spec',
            scene_spec_hash: computeSceneSpecSpeechHash(sceneSpec),
            scene_count: sceneSpec.scenes.length,
            scene_ids: sceneSpec.scenes.map(scene => scene.id),
            combined_path: path.join(rootDir, 'tts-current-ten-scenes.wav'),
            scenes: sceneSpec.scenes.map(scene => ({ scene_id: scene.id })),
          },
        };
      },
    },
    projectOrchestrator: {
      renderHtmlVideoProject: async ({ project }) => {
        muxedAudio = project.audio.narration_path;
        return { success: true, output_path: path.join(rootDir, 'regression-output.mp4'), project, diagnostics: [] };
      },
    },
    visualQaService: { inspectRenderedVideo: async () => ({ success: true, issues: [], metrics: {} }) },
  },
});
assert.equal(result.success, true);
assert.equal(result.project.frames.length, 10);
assert.deepEqual(result.project.frames.map(frame => frame.scene_id), tenSceneSpec.scenes.map(scene => scene.id));
assert.equal(ttsCalls, 1);
assert.equal(muxedAudio, path.join(rootDir, 'tts-current-ten-scenes.wav'));
assert.equal(result.project.audio.scene_count, 10);
assert.equal(result.html_video_diagnostics.some(item => item.code === 'content_graph_scene_spec_mismatch'), true);
assert.equal(result.html_video_diagnostics.some(item => item.code === 'audio_scene_spec_hash_mismatch'), false);
```

- [ ] **Step 2: Run workflow test**

Run:

```powershell
node tests/run-all.js html-video-workflow
```

Expected: PASS after Tasks 8 and 9. If it fails, fix only the specific regression exposed by this test.

- [ ] **Step 3: Commit**

```powershell
git add tests/test-html-video-workflow.js
git commit -m "覆盖音频字幕错位回归场景"
```

### Task 11: Full Focused Verification

**Files:**
- No new source files.

- [ ] **Step 1: Run all focused tests**

Run:

```powershell
node tests/run-all.js scene-spec-hash
node tests/run-all.js creative-video-tts-service
node tests/run-all.js html-video-scene-graph-binding
node tests/run-all.js html-video-scene-spec-mapper
node tests/run-all.js html-video-raw-html-frame-builder
node tests/run-all.js html-video-timeline-consistency
node tests/run-all.js html-video-validation-gate
node tests/run-all.js html-video-workflow
```

Expected: every command exits with code `0`.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm test
```

Expected: full suite exits with code `0`.

- [ ] **Step 3: Inspect git status**

Run:

```powershell
git status --short
```

Expected: empty output after all task commits.

## Review Checklist

- [ ] Legacy audio without `scene_spec_hash` is never automatically muxed into final html-video output.
- [ ] Matching scene-spec audio can still be reused when only visual fields changed.
- [ ] AI `content_graph` cannot create extra final frames.
- [ ] Raw HTML frame generation never creates empty narration/caption frames for graph-only nodes.
- [ ] Template-input frame generation follows the same scene binding rule as raw HTML mode.
- [ ] Validation fails with Chinese diagnostics if frames/audio/script disagree.
- [ ] The exact 7-audio / 10-caption / 11-frame mismatch is covered by a regression test.
- [ ] All new user-visible messages are Chinese.
