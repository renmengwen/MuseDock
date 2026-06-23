# html-video 完整二次编辑体系 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete html-video secondary editing workflow: frame source drafts, accept/discard, draft preview, DOM layout QA, AI frame iterate, project edit plans, and UI surfaces.

**Architecture:** Keep structured edits in `editPatchService`; add separate bounded services for frame HTML, drafts, layout QA, AI iterate, and edit planning. Persist drafts and edit plans in `project.json`, render drafts through temporary frame objects, and keep accepted frames as the only default export source.

**Tech Stack:** Node.js 22, Express, Playwright, existing html-video project schema/store/orchestrator, React 19, existing assert-based test runner.

---

## Scope And Execution Rules

- Work only on `dev`.
- Preserve unrelated local changes. Before each task, run `git status --short`; only stage files listed in that task.
- Follow TDD for every production change: write failing test, run it, implement minimal code, rerun.
- Keep each task independently reviewable.
- Do not implement visual drag/drop element editing.
- Do not add CodeMirror in this plan; Source editing uses textarea.
- Do not expose direct `mode=replace`; it must return `FRAME_REPLACE_FORBIDDEN`.
- Do not store edit plans in memory; persist them in `project.edit_sessions`.
- Do not use only `frame.id` to find frames; support `id`, `scene_id`, `graph_node_id`, and `graphNodeId`.
- Phase 6 export quality gate is not in this implementation plan; add it in a later PR after draft/edit-plan execution is stable.

## Files To Create Or Modify

### Backend Services

- Create: `server/services/creative-video/html-video/frameIdentity.js`
  Shared frame lookup helpers: `findFrameByAnyId`, `canonicalFrameId`, `sanitizePathSegment`.

- Create: `server/services/creative-video/html-video/htmlVideoDraftService.js`
  Draft metadata/path lifecycle: create, find, mark accepted/discarded, active draft.

- Create: `server/services/creative-video/html-video/frameHtmlEditService.js`
  Frame HTML read/write/draft/accept/discard with project path safety and HTML validation.

- Create: `server/services/creative-video/html-video/layoutQaService.js`
  Playwright DOM layout checks for overlap and out-of-container text.

- Create: `server/services/creative-video/html-video/htmlVideoIterateService.js`
  AI single-frame iterate, parse generated HTML, save draft, optional QA/preview orchestration hook.

- Create: `server/services/creative-video/html-video/htmlVideoEditModeService.js`
  Internal edit-plan classifier and persisted plan runner.

### Backend Existing Files

- Modify: `server/services/creative-video/html-video/projectSchema.js`
  Normalize `frame.drafts`, `frame.active_draft_id`, `project.edit_sessions`, `project.layout_qa_reports`.

- Modify: `server/services/creative-video/html-video/projectOrchestrator.js`
  Support `draftId` and `runLayoutQa` in `renderHtmlVideoFramePreview`; render draft through a temporary frame.

- Modify: `server/services/creativeWorkflows.js`
  Add service functions for frame HTML, drafts, layout QA, frame iterate, edit plan, and edit-plan run.

- Modify: `server/routes/creativeWorkflows.js`
  Replace reserved routes with real frame HTML/draft routes; add iterate, layout QA, edit-plan routes.

### Frontend API/Hook

- Modify: `frontend-react/src/api/client.js`
  Add methods for frame HTML, drafts, layout QA, frame iterate, edit plan, and edit plan run.

- Modify: `frontend-react/src/hooks/useHtmlVideoProject.js`
  Add state/actions for source loading/saving, draft rendering, accept/discard, layout QA, frame iterate, edit plan.

### Frontend Components

- Modify: `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx`
  Add tabbed editor layout and wire panels.

- Create: `frontend-react/src/components/creative-video-editor/HtmlVideoSourcePanel.jsx`

- Create: `frontend-react/src/components/creative-video-editor/HtmlVideoDraftPanel.jsx`

- Create: `frontend-react/src/components/creative-video-editor/HtmlVideoAiEditPanel.jsx`

- Create: `frontend-react/src/components/creative-video-editor/HtmlVideoQualityPanel.jsx`

- Modify: `frontend-react/src/components/creative-video-editor/ProjectFramesList.jsx`
  Show draft and QA statuses.

### Tests And Fixtures

- Create: `tests/test-html-video-project-schema-secondary-editing.js`

- Create: `tests/test-html-video-draft-service.js`

- Create: `tests/test-html-video-frame-html-edit-service.js`

- Create: `tests/test-html-video-frame-preview-draft.js`

- Create: `tests/test-html-video-layout-qa-service.js`

- Create: `tests/test-html-video-frame-iterate-service.js`

- Create: `tests/test-html-video-edit-plan-service.js`

- Modify: `tests/test-html-video-routes.js`

- Modify: `tests/test-html-video-api-client.mjs`

- Modify: `tests/test-html-video-editor-components.mjs`

- Create fixtures:
  - `tests/fixtures/html-video-layout-qa/overflow-card-title.html`
  - `tests/fixtures/html-video-layout-qa/overflow-card-title-fixed.html`
  - `tests/fixtures/html-video-layout-qa/overlay-valuation.html`
  - `tests/fixtures/html-video-layout-qa/overlay-valuation-fixed.html`

---

## Task 1: Schema And Frame Identity Foundation

**Files:**
- Create: `server/services/creative-video/html-video/frameIdentity.js`
- Modify: `server/services/creative-video/html-video/projectSchema.js`
- Test: `tests/test-html-video-project-schema-secondary-editing.js`

- [ ] **Step 1: Write failing schema and identity tests**

Create `tests/test-html-video-project-schema-secondary-editing.js`:

```js
const assert = require('assert/strict');

const { normalizeProject } = require('../server/services/creative-video/html-video/projectSchema');
const {
  findFrameByAnyId,
  canonicalFrameId,
  sanitizePathSegment,
} = require('../server/services/creative-video/html-video/frameIdentity');

{
  const project = normalizeProject({
    frames: [{
      id: 'frame_primary',
      scene_id: 'scene_legacy',
      graph_node_id: 'graph_node',
      source_mode: 'raw_html',
      html_path: 'frames/frame.html',
      drafts: [{ id: 'draft_0001', html_path: 'frames/.drafts/frame_primary/draft_0001.html' }],
      active_draft_id: 'draft_0001',
    }],
    edit_sessions: [{ id: 'edit_plan_0001', kind: 'edit_plan', status: 'planned' }],
    layout_qa_reports: [{ id: 'layout_qa_0001', success: true, issues: [] }],
  });

  assert.deepEqual(project.frames[0].drafts, [{ id: 'draft_0001', html_path: 'frames/.drafts/frame_primary/draft_0001.html' }]);
  assert.equal(project.frames[0].active_draft_id, 'draft_0001');
  assert.deepEqual(project.edit_sessions, [{ id: 'edit_plan_0001', kind: 'edit_plan', status: 'planned' }]);
  assert.deepEqual(project.layout_qa_reports, [{ id: 'layout_qa_0001', success: true, issues: [] }]);
}

{
  const project = normalizeProject({
    frames: [{
      id: 'frame_primary',
      scene_id: 'scene_legacy',
      graph_node_id: 'graph_node',
      source_mode: 'raw_html',
      html_path: 'frames/frame.html',
    }],
  });

  assert.equal(findFrameByAnyId(project, 'frame_primary').id, 'frame_primary');
  assert.equal(findFrameByAnyId(project, 'scene_legacy').id, 'frame_primary');
  assert.equal(findFrameByAnyId(project, 'graph_node').id, 'frame_primary');
  assert.equal(findFrameByAnyId(project, 'missing'), null);
  assert.equal(canonicalFrameId(project.frames[0]), 'frame_primary');
  assert.equal(sanitizePathSegment('scene/06:报价'), 'scene_06___');
}

console.log('html-video secondary editing schema tests passed');
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node tests/test-html-video-project-schema-secondary-editing.js
```

Expected: fails with `Cannot find module '../server/services/creative-video/html-video/frameIdentity'`.

- [ ] **Step 3: Implement `frameIdentity.js`**

Create `server/services/creative-video/html-video/frameIdentity.js`:

```js
function normalizeId(value) {
  return String(value || '').trim();
}

function frameIds(frame = {}) {
  return [
    frame.id,
    frame.scene_id,
    frame.sceneId,
    frame.graph_node_id,
    frame.graphNodeId,
  ].map(normalizeId).filter(Boolean);
}

function findFrameByAnyId(project = {}, frameId) {
  const id = normalizeId(frameId);
  if (!id) return null;
  const frames = Array.isArray(project.frames) ? project.frames : [];
  return frames.find(frame => frameIds(frame).includes(id)) || null;
}

function canonicalFrameId(frame = {}) {
  return frameIds(frame)[0] || '';
}

function sanitizePathSegment(value) {
  const text = normalizeId(value);
  return text ? text.replace(/[^A-Za-z0-9_.-]/g, '_') : 'frame';
}

module.exports = {
  findFrameByAnyId,
  canonicalFrameId,
  sanitizePathSegment,
};
```

- [ ] **Step 4: Extend `projectSchema.js` normalization**

Modify `normalizeFrame()` return object to include:

```js
    drafts: arrayOrEmpty(input.drafts),
    active_draft_id: firstNonEmptyString(input.active_draft_id, input.activeDraftId),
```

Modify `normalizeProject()` return object to include:

```js
    edit_sessions: arrayOrEmpty(input.edit_sessions || input.editSessions),
    layout_qa_reports: arrayOrEmpty(input.layout_qa_reports || input.layoutQaReports),
```

Place these near existing `revisions` / `exports` fields. Do not remove unknown fields already preserved by object spreads.

- [ ] **Step 5: Run test and verify GREEN**

Run:

```powershell
node tests/test-html-video-project-schema-secondary-editing.js
```

Expected: `html-video secondary editing schema tests passed`.

- [ ] **Step 6: Run nearby schema tests**

Run:

```powershell
node tests/test-html-video-project-schema.js
```

Expected: existing project schema tests pass.

- [ ] **Step 7: Commit**

```powershell
git add server/services/creative-video/html-video/frameIdentity.js server/services/creative-video/html-video/projectSchema.js tests/test-html-video-project-schema-secondary-editing.js
git commit -m "feat: 增加 html-video 二次编辑基础 schema"
```

---

## Task 2: Draft Service

**Files:**
- Create: `server/services/creative-video/html-video/htmlVideoDraftService.js`
- Test: `tests/test-html-video-draft-service.js`

- [ ] **Step 1: Write failing draft service tests**

Create `tests/test-html-video-draft-service.js`:

```js
const assert = require('assert/strict');

const {
  createDraftEntry,
  findDraft,
  markDraftAccepted,
  markDraftDiscarded,
} = require('../server/services/creative-video/html-video/htmlVideoDraftService');

const project = {
  frames: [{
    id: 'scene_06',
    source_mode: 'raw_html',
    html_path: 'frames/06-scene_06.html',
    drafts: [],
  }],
};

const draft = createDraftEntry({
  project,
  frameId: 'scene_06',
  kind: 'manual_source',
  summary: '修复遮挡',
});

assert.match(draft.id, /^draft_\d{8}_\d{6}_\d{3}_\d{4}$/);
assert.equal(draft.kind, 'manual_source');
assert.equal(draft.status, 'ready');
assert.equal(draft.summary, '修复遮挡');
assert.equal(draft.html_path, `frames/.drafts/scene_06/${draft.id}.html`);
assert.equal(project.frames[0].active_draft_id, draft.id);
assert.equal(project.frames[0].drafts.length, 1);
assert.equal(findDraft(project, 'scene_06', draft.id), draft);

markDraftAccepted(project, 'scene_06', draft.id);
assert.equal(draft.status, 'accepted');
assert.equal(project.frames[0].active_draft_id, '');

const second = createDraftEntry({ project, frameId: 'scene_06', kind: 'ai_iterate' });
markDraftDiscarded(project, 'scene_06', second.id);
assert.equal(second.status, 'discarded');
assert.equal(project.frames[0].active_draft_id, '');

assert.equal(findDraft(project, 'missing', second.id), null);
assert.throws(() => createDraftEntry({ project, frameId: 'missing' }), /未找到帧/);

console.log('html-video draft service tests passed');
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node tests/test-html-video-draft-service.js
```

Expected: fails with missing module.

- [ ] **Step 3: Implement `htmlVideoDraftService.js`**

Create `server/services/creative-video/html-video/htmlVideoDraftService.js`:

```js
const { findFrameByAnyId, canonicalFrameId, sanitizePathSegment } = require('./frameIdentity');

function pad(value, size) {
  return String(value).padStart(size, '0');
}

function makeDraftId(now = new Date(), sequence = 1) {
  return [
    'draft',
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}`,
    `${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}`,
    pad(now.getUTCMilliseconds(), 3),
    pad(sequence, 4),
  ].join('_');
}

function timestamp(now = new Date()) {
  return now.toISOString();
}

function ensureDrafts(frame) {
  if (!Array.isArray(frame.drafts)) frame.drafts = [];
  return frame.drafts;
}

function createDraftEntry({ project, frameId, kind = 'manual_source', summary = '', instruction = '', now = new Date() } = {}) {
  const frame = findFrameByAnyId(project, frameId);
  if (!frame) throw new Error(`未找到帧 ${frameId || ''}。`);
  const safeFrameId = sanitizePathSegment(canonicalFrameId(frame) || frameId);
  const drafts = ensureDrafts(frame);
  let sequence = drafts.length + 1;
  let id = makeDraftId(now, sequence);
  while (drafts.some(draft => draft.id === id)) {
    sequence += 1;
    id = makeDraftId(now, sequence);
  }
  const entry = {
    id,
    kind,
    status: 'ready',
    html_path: `frames/.drafts/${safeFrameId}/${id}.html`,
    created_at: timestamp(now),
    updated_at: timestamp(now),
    summary,
    instruction,
  };
  drafts.push(entry);
  frame.active_draft_id = id;
  return entry;
}

function findDraft(project, frameId, draftId) {
  const frame = findFrameByAnyId(project, frameId);
  if (!frame) return null;
  const id = String(draftId || '').trim();
  return ensureDrafts(frame).find(draft => draft.id === id) || null;
}

function markDraftAccepted(project, frameId, draftId, now = new Date()) {
  const draft = findDraft(project, frameId, draftId);
  if (!draft) throw new Error(`未找到草稿 ${draftId || ''}。`);
  const frame = findFrameByAnyId(project, frameId);
  draft.status = 'accepted';
  draft.updated_at = timestamp(now);
  if (frame.active_draft_id === draft.id) frame.active_draft_id = '';
  return draft;
}

function markDraftDiscarded(project, frameId, draftId, now = new Date()) {
  const draft = findDraft(project, frameId, draftId);
  if (!draft) throw new Error(`未找到草稿 ${draftId || ''}。`);
  const frame = findFrameByAnyId(project, frameId);
  draft.status = 'discarded';
  draft.updated_at = timestamp(now);
  if (frame.active_draft_id === draft.id) frame.active_draft_id = '';
  return draft;
}

module.exports = {
  createDraftEntry,
  findDraft,
  markDraftAccepted,
  markDraftDiscarded,
};
```

- [ ] **Step 4: Run draft tests**

Run:

```powershell
node tests/test-html-video-draft-service.js
```

Expected: `html-video draft service tests passed`.

- [ ] **Step 5: Commit**

```powershell
git add server/services/creative-video/html-video/htmlVideoDraftService.js tests/test-html-video-draft-service.js
git commit -m "feat: 增加 html-video 草稿服务"
```

---

## Task 3: Frame HTML Edit Service

**Files:**
- Create: `server/services/creative-video/html-video/frameHtmlEditService.js`
- Test: `tests/test-html-video-frame-html-edit-service.js`

- [ ] **Step 1: Write failing frame HTML edit service tests**

Create `tests/test-html-video-frame-html-edit-service.js`:

```js
const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  readFrameHtml,
  saveFrameHtmlDraft,
  acceptFrameDraft,
  discardFrameDraft,
} = require('../server/services/creative-video/html-video/frameHtmlEditService');

(async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-frame-edit-'));
  await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  const frameHtmlPath = path.join(projectDir, 'frames', '06-scene_06.html');
  await fs.writeFile(frameHtmlPath, '<!doctype html><html><body><h1 data-text-key="headline">旧版</h1></body></html>', 'utf8');
  const project = {
    frames: [{
      id: 'frame_internal',
      scene_id: 'scene_06',
      graph_node_id: 'graph_scene_06',
      source_mode: 'raw_html',
      html_path: 'frames/06-scene_06.html',
      drafts: [],
    }],
    revisions: [],
  };

  const read = await readFrameHtml({ projectDir, project, frameId: 'graph_scene_06' });
  assert.equal(read.success, true);
  assert.equal(read.resolved_frame_id, 'frame_internal');
  assert.match(read.html, /旧版/);

  const draftResult = await saveFrameHtmlDraft({
    projectDir,
    project,
    frameId: 'scene_06',
    html: '<!doctype html><html><body><h1 data-text-key="headline">草稿</h1></body></html>',
    summary: '保存草稿',
  });
  assert.equal(draftResult.success, true);
  assert.equal(project.frames[0].drafts.length, 1);
  assert.equal(project.frames[0].active_draft_id, draftResult.draft.id);
  assert.match(await fs.readFile(path.join(projectDir, draftResult.draft.html_path), 'utf8'), /草稿/);
  assert.match(await fs.readFile(frameHtmlPath, 'utf8'), /旧版/);

  const forbidden = await saveFrameHtmlDraft({
    projectDir,
    project,
    frameId: 'scene_06',
    html: '<!doctype html><html><body>覆盖</body></html>',
    mode: 'replace',
  });
  assert.equal(forbidden.success, false);
  assert.equal(forbidden.code, 'FRAME_REPLACE_FORBIDDEN');

  const invalid = await saveFrameHtmlDraft({ projectDir, project, frameId: 'scene_06', html: '<div>bad</div>' });
  assert.equal(invalid.success, false);
  assert.equal(invalid.code, 'FRAME_HTML_INVALID');

  const externalScript = await saveFrameHtmlDraft({
    projectDir,
    project,
    frameId: 'scene_06',
    html: '<!doctype html><html><head><script src="https://example.com/a.js"></script></head><body></body></html>',
  });
  assert.equal(externalScript.success, false);
  assert.equal(externalScript.code, 'FRAME_HTML_EXTERNAL_SCRIPT_BLOCKED');

  const accepted = await acceptFrameDraft({ projectDir, project, frameId: 'scene_06', draftId: draftResult.draft.id });
  assert.equal(accepted.success, true);
  assert.match(await fs.readFile(frameHtmlPath, 'utf8'), /草稿/);
  assert.equal(project.frames[0].active_draft_id, '');
  assert.equal(project.frames[0].drafts[0].status, 'accepted');

  const second = await saveFrameHtmlDraft({
    projectDir,
    project,
    frameId: 'scene_06',
    html: '<!doctype html><html><body>第二版</body></html>',
  });
  const discarded = await discardFrameDraft({ projectDir, project, frameId: 'scene_06', draftId: second.draft.id });
  assert.equal(discarded.success, true);
  assert.equal(project.frames[0].active_draft_id, '');
  assert.equal(project.frames[0].drafts[1].status, 'discarded');

  const templateProject = { frames: [{ id: 'template_frame', source_mode: 'template_inputs', html_path: 'frames/generated.html' }] };
  const notAvailable = await readFrameHtml({ projectDir, project: templateProject, frameId: 'template_frame' });
  assert.equal(notAvailable.success, false);
  assert.equal(notAvailable.code, 'FRAME_HTML_NOT_AVAILABLE');

  const missingProject = { frames: [{ id: 'missing_html', source_mode: 'raw_html', html_path: 'frames/missing.html' }] };
  const missing = await readFrameHtml({ projectDir, project: missingProject, frameId: 'missing_html' });
  assert.equal(missing.success, false);
  assert.equal(missing.code, 'FRAME_HTML_NOT_AVAILABLE');

  await fs.rm(projectDir, { recursive: true, force: true });
  console.log('html-video frame html edit service tests passed');
})();
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node tests/test-html-video-frame-html-edit-service.js
```

Expected: fails with missing module.

- [ ] **Step 3: Implement `frameHtmlEditService.js`**

Create `server/services/creative-video/html-video/frameHtmlEditService.js` with these exported functions:

```js
const fs = require('fs/promises');
const path = require('path');

const { addRevision } = require('./projectStore');
const { findFrameByAnyId, canonicalFrameId } = require('./frameIdentity');
const {
  createDraftEntry,
  findDraft,
  markDraftAccepted,
  markDraftDiscarded,
} = require('./htmlVideoDraftService');

function fail(code, message, extra = {}) {
  return { success: false, code, message, user_message: message, ...extra };
}

function assertInside(projectDir, targetPath) {
  const root = path.resolve(projectDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('路径不能逃逸工程目录。');
  }
  return target;
}

function resolveProjectPath(projectDir, relativePath) {
  const text = String(relativePath || '').trim();
  if (!text || path.isAbsolute(text)) throw new Error('路径不能逃逸工程目录。');
  return assertInside(projectDir, path.resolve(projectDir, text));
}

function validateCompleteHtml(html) {
  const text = String(html || '');
  if (!text.trim()) return fail('FRAME_HTML_INVALID', '源码为空，无法保存。');
  if (!/(<!doctype\s+html|<html[\s>])/i.test(text) || !/<\/html>/i.test(text)) {
    return fail('FRAME_HTML_INVALID', '源码不是完整 HTML 文档。');
  }
  if (/<script\b[^>]*\bsrc=["']https?:\/\//i.test(text)) {
    return fail('FRAME_HTML_EXTERNAL_SCRIPT_BLOCKED', '源码包含外部脚本，已拒绝保存。');
  }
  if (/<\s*(iframe|object|embed)\b/i.test(text)) {
    return fail('FRAME_HTML_UNSAFE_EMBED_BLOCKED', '源码包含暂不允许的嵌入内容。');
  }
  return null;
}

async function frameHtmlPath(projectDir, project, frameId) {
  const frame = findFrameByAnyId(project, frameId);
  if (!frame) return { error: fail('FRAME_NOT_FOUND', `未找到帧 ${frameId || ''}。`) };
  if (frame.source_mode !== 'raw_html' || !frame.html_path) {
    return { frame, error: fail('FRAME_HTML_NOT_AVAILABLE', '当前帧不是 raw_html 或没有可编辑源码。') };
  }
  let absolutePath;
  try {
    absolutePath = resolveProjectPath(projectDir, frame.html_path);
  } catch {
    return { frame, error: fail('FRAME_HTML_PATH_INVALID', '帧源码路径不合法。') };
  }
  try {
    await fs.access(absolutePath);
  } catch {
    return { frame, error: fail('FRAME_HTML_NOT_AVAILABLE', '当前帧源码文件不存在。') };
  }
  return { frame, absolutePath };
}

async function readFrameHtml({ projectDir, project, frameId } = {}) {
  const resolved = await frameHtmlPath(projectDir, project, frameId);
  if (resolved.error) return resolved.error;
  const html = await fs.readFile(resolved.absolutePath, 'utf8');
  return {
    success: true,
    frame_id: String(frameId || ''),
    resolved_frame_id: canonicalFrameId(resolved.frame),
    source_mode: resolved.frame.source_mode,
    html_path: resolved.frame.html_path,
    html,
  };
}

async function saveFrameHtmlDraft({ projectDir, project, frameId, html, mode = 'draft', summary = '', instruction = '', kind = 'manual_source' } = {}) {
  if (mode === 'replace') return fail('FRAME_REPLACE_FORBIDDEN', '首版不允许直接覆盖正式帧，请先保存为草稿。');
  const validation = validateCompleteHtml(html);
  if (validation) return validation;
  const resolved = await frameHtmlPath(projectDir, project, frameId);
  if (resolved.error) return resolved.error;
  const draft = createDraftEntry({ project, frameId, kind, summary, instruction });
  const absoluteDraftPath = resolveProjectPath(projectDir, draft.html_path);
  await fs.mkdir(path.dirname(absoluteDraftPath), { recursive: true });
  await fs.writeFile(absoluteDraftPath, html, 'utf8');
  addRevision(project, {
    summary: summary || '帧源码草稿已保存。',
    change: { type: 'frame_html_draft', frame_id: canonicalFrameId(resolved.frame), draft_id: draft.id },
  });
  return {
    success: true,
    frame_id: String(frameId || ''),
    resolved_frame_id: canonicalFrameId(resolved.frame),
    draft,
    requires_render: true,
    message: '帧源码草稿已保存，可渲染单帧预览。',
  };
}

async function acceptFrameDraft({ projectDir, project, frameId, draftId } = {}) {
  const resolved = await frameHtmlPath(projectDir, project, frameId);
  if (resolved.error) return resolved.error;
  const draft = findDraft(project, frameId, draftId);
  if (!draft) return fail('DRAFT_NOT_FOUND', '未找到草稿。');
  const draftPath = resolveProjectPath(projectDir, draft.html_path);
  const officialPath = resolveProjectPath(projectDir, resolved.frame.html_path);
  const html = await fs.readFile(draftPath, 'utf8');
  const validation = validateCompleteHtml(html);
  if (validation) return validation;
  await fs.writeFile(officialPath, html, 'utf8');
  markDraftAccepted(project, frameId, draftId);
  addRevision(project, {
    summary: '帧源码草稿已接受。',
    change: { type: 'frame_html_draft_accept', frame_id: canonicalFrameId(resolved.frame), draft_id: draftId },
  });
  return { success: true, frame_id: String(frameId || ''), accepted_draft_id: draftId, requires_render: true, message: '草稿已接受，需要重新导出成片。' };
}

async function discardFrameDraft({ project, frameId, draftId } = {}) {
  const frame = findFrameByAnyId(project, frameId);
  if (!frame) return fail('FRAME_NOT_FOUND', `未找到帧 ${frameId || ''}。`);
  const draft = findDraft(project, frameId, draftId);
  if (!draft) return fail('DRAFT_NOT_FOUND', '未找到草稿。');
  markDraftDiscarded(project, frameId, draftId);
  addRevision(project, {
    summary: '帧源码草稿已放弃。',
    change: { type: 'frame_html_draft_discard', frame_id: canonicalFrameId(frame), draft_id: draftId },
  });
  return { success: true, frame_id: String(frameId || ''), discarded_draft_id: draftId, message: '草稿已放弃。' };
}

module.exports = {
  readFrameHtml,
  saveFrameHtmlDraft,
  acceptFrameDraft,
  discardFrameDraft,
  validateCompleteHtml,
  resolveProjectPath,
};
```

- [ ] **Step 4: Run frame HTML edit tests**

Run:

```powershell
node tests/test-html-video-frame-html-edit-service.js
```

Expected: `html-video frame html edit service tests passed`.

- [ ] **Step 5: Run existing raw HTML text patch tests**

Run:

```powershell
node tests/test-html-video-raw-html-text-patch.js
```

Expected: existing raw HTML text patch tests pass.

- [ ] **Step 6: Commit**

```powershell
git add server/services/creative-video/html-video/frameHtmlEditService.js tests/test-html-video-frame-html-edit-service.js
git commit -m "feat: 增加 html-video 帧源码草稿编辑"
```

---

## Task 4: Frame HTML Routes And Workflow Service Methods

**Files:**
- Modify: `server/services/creativeWorkflows.js`
- Modify: `server/routes/creativeWorkflows.js`
- Modify: `tests/test-html-video-routes.js`

- [ ] **Step 1: Extend route tests first**

Modify fake service in `tests/test-html-video-routes.js` to add:

```js
    getHtmlVideoProjectFrameHtml: async (id, frameId, payload) => {
      calls.push(['get-frame-html', id, frameId, payload?.format || 'json']);
      return { success: true, workflow_id: id, frame_id: frameId, resolved_frame_id: 'frame_01', html: '<!doctype html><html></html>', html_path: 'frames/frame_01.html' };
    },
    saveHtmlVideoProjectFrameHtml: async (id, frameId, payload) => {
      calls.push(['put-frame-html', id, frameId, payload.mode || 'draft']);
      return { success: true, workflow_id: id, frame_id: frameId, draft: { id: 'draft_0001', html_path: 'frames/.drafts/frame_01/draft_0001.html' }, requires_render: true, message: '帧源码草稿已保存，可渲染单帧预览。' };
    },
    acceptHtmlVideoProjectFrameDraft: async (id, frameId, draftId) => {
      calls.push(['accept-draft', id, frameId, draftId]);
      return { success: true, workflow_id: id, frame_id: frameId, accepted_draft_id: draftId, message: '草稿已接受，需要重新导出成片。' };
    },
    discardHtmlVideoProjectFrameDraft: async (id, frameId, draftId) => {
      calls.push(['discard-draft', id, frameId, draftId]);
      return { success: true, workflow_id: id, frame_id: frameId, discarded_draft_id: draftId, message: '草稿已放弃。' };
    },
```

Add assertions before reserved route assertions:

```js
    const frameHtmlJson = await requestJson(server, 'GET', `/api/creative-workflows/${workflowId}/html-video-project/frames/frame_01/html`);
    assert.equal(frameHtmlJson.statusCode, 200);
    assert.equal(frameHtmlJson.body.html, '<!doctype html><html></html>');

    const frameHtmlText = await requestText(server, 'GET', `/api/creative-workflows/${workflowId}/html-video-project/frames/frame_01/html`);
    assert.equal(frameHtmlText.statusCode, 200);
    assert.match(frameHtmlText.contentType, /text\/plain|application\/json/);

    const savedDraft = await requestJson(server, 'PUT', `/api/creative-workflows/${workflowId}/html-video-project/frames/frame_01/html`, {
      html: '<!doctype html><html></html>',
      mode: 'draft',
    });
    assert.equal(savedDraft.statusCode, 200);
    assert.equal(savedDraft.body.draft.id, 'draft_0001');

    const acceptedDraft = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/frames/frame_01/drafts/draft_0001/accept`, {});
    assert.equal(acceptedDraft.statusCode, 200);
    assert.equal(acceptedDraft.body.accepted_draft_id, 'draft_0001');

    const discardedDraft = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/frames/frame_01/drafts/draft_0002/discard`, {});
    assert.equal(discardedDraft.statusCode, 200);
    assert.equal(discardedDraft.body.discarded_draft_id, 'draft_0002');
```

Remove `['PATCH', 'frames/frame_01/html']` from `reservedRequests`, because it is now implemented as `GET/PUT` route. Keep element/transition/enhance/unenhance reserved.

- [ ] **Step 2: Run routes test and verify RED**

Run:

```powershell
node tests/test-html-video-routes.js
```

Expected: fails because route does not exist or returns 501 for frame html.

- [ ] **Step 3: Add workflow service methods**

In `server/services/creativeWorkflows.js`, require:

```js
const frameHtmlEditService = require('./creative-video/html-video/frameHtmlEditService');
```

Add functions after `patchHtmlVideoProjectFrame`:

```js
async function getHtmlVideoProjectFrameHtml(workflowId, frameId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  return frameHtmlEditService.readFrameHtml({ projectDir, project, frameId, format: payload.format });
}

async function saveHtmlVideoProjectFrameHtml(workflowId, frameId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const result = await frameHtmlEditService.saveFrameHtmlDraft({
    projectDir,
    project,
    frameId,
    html: payload.html,
    mode: payload.mode,
    summary: payload.summary,
    instruction: payload.instruction,
    kind: payload.kind || 'manual_source',
  });
  if (!result.success) return { ...result, workflow_id: workflowId, frame_id: frameId };
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return { ...result, workflow_id: workflowId, frame_id: frameId, html_video_project: saved, html_video_project_path: projectDir };
}

async function acceptHtmlVideoProjectFrameDraft(workflowId, frameId, draftId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const result = await frameHtmlEditService.acceptFrameDraft({ projectDir, project, frameId, draftId });
  if (!result.success) return { ...result, workflow_id: workflowId, frame_id: frameId };
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return { ...result, workflow_id: workflowId, frame_id: frameId, html_video_project: saved, html_video_project_path: projectDir };
}

async function discardHtmlVideoProjectFrameDraft(workflowId, frameId, draftId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const result = await frameHtmlEditService.discardFrameDraft({ project, frameId, draftId });
  if (!result.success) return { ...result, workflow_id: workflowId, frame_id: frameId };
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return { ...result, workflow_id: workflowId, frame_id: frameId, html_video_project: saved, html_video_project_path: projectDir };
}
```

Export these functions in `module.exports`.

- [ ] **Step 4: Add routes**

In `server/routes/creativeWorkflows.js`, before the existing reserved catch-all route such as `router.all('/:workflow_id/html-video-project/:feature(...)', sendReserved)`:

```js
router.get('/:workflow_id/html-video-project/frames/:frame_id/html', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const workflowId = validation.workflow_id;
  const frameId = String(req.params.frame_id || '').trim();
  if (!frameId) return res.status(400).json({ success: false, workflow_id: workflowId, message: '帧 ID 无效。' });
  try {
    const service = getService(req);
    const wantsText = /\btext\/html\b|\btext\/plain\b/.test(String(req.headers.accept || ''));
    const result = await service.getHtmlVideoProjectFrameHtml(workflowId, frameId, { format: wantsText ? 'text' : 'json' });
    if (!result || result.success === false) {
      const message = getMessage(result, '读取帧源码失败。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, frame_id: frameId, message, code: result?.code });
    }
    if (wantsText) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(result.html || '');
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, workflow_id: workflowId, frame_id: frameId, message: `读取帧源码失败：${error.message}` });
  }
});

router.put('/:workflow_id/html-video-project/frames/:frame_id/html', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const workflowId = validation.workflow_id;
  const frameId = String(req.params.frame_id || '').trim();
  if (!frameId) return res.status(400).json({ success: false, workflow_id: workflowId, message: '帧 ID 无效。' });
  try {
    const service = getService(req);
    const result = await service.saveHtmlVideoProjectFrameHtml(workflowId, frameId, req.body || {});
    if (!result || result.success === false) {
      const message = getMessage(result, '保存帧源码草稿失败。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, frame_id: frameId, message, code: result?.code });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, workflow_id: workflowId, frame_id: frameId, message: `保存帧源码草稿失败：${error.message}` });
  }
});
```

Add accept/discard routes:

```js
router.post('/:workflow_id/html-video-project/frames/:frame_id/drafts/:draft_id/accept', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const workflowId = validation.workflow_id;
  const frameId = String(req.params.frame_id || '').trim();
  const draftId = String(req.params.draft_id || '').trim();
  try {
    const result = await getService(req).acceptHtmlVideoProjectFrameDraft(workflowId, frameId, draftId);
    if (!result || result.success === false) {
      const message = getMessage(result, '接受草稿失败。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, frame_id: frameId, draft_id: draftId, message, code: result?.code });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, workflow_id: workflowId, frame_id: frameId, draft_id: draftId, message: `接受草稿失败：${error.message}` });
  }
});

router.post('/:workflow_id/html-video-project/frames/:frame_id/drafts/:draft_id/discard', async (req, res) => {
  const validation = validateWorkflowId(req.params.workflow_id);
  if (!validation.success) return res.status(400).json(validation);
  const workflowId = validation.workflow_id;
  const frameId = String(req.params.frame_id || '').trim();
  const draftId = String(req.params.draft_id || '').trim();
  try {
    const result = await getService(req).discardHtmlVideoProjectFrameDraft(workflowId, frameId, draftId);
    if (!result || result.success === false) {
      const message = getMessage(result, '放弃草稿失败。');
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, frame_id: frameId, draft_id: draftId, message, code: result?.code });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, workflow_id: workflowId, frame_id: frameId, draft_id: draftId, message: `放弃草稿失败：${error.message}` });
  }
});
```

- [ ] **Step 5: Run routes test**

Run:

```powershell
node tests/test-html-video-routes.js
```

Expected: route tests pass.

- [ ] **Step 6: Run frame edit service test**

Run:

```powershell
node tests/test-html-video-frame-html-edit-service.js
```

Expected: service tests still pass.

- [ ] **Step 7: Commit**

```powershell
git add server/services/creativeWorkflows.js server/routes/creativeWorkflows.js tests/test-html-video-routes.js
git commit -m "feat: 接入 html-video 帧源码草稿接口"
```

---

## Task 5: Draft Frame Preview

**Files:**
- Modify: `server/services/creative-video/html-video/projectOrchestrator.js`
- Modify: `server/services/creativeWorkflows.js`
- Test: `tests/test-html-video-frame-preview-draft.js`
- Test: extend `tests/test-html-video-routes.js`

- [ ] **Step 1: Write failing draft preview test**

Create `tests/test-html-video-frame-preview-draft.js`:

```js
const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { renderHtmlVideoFramePreview } = require('../server/services/creative-video/html-video/projectOrchestrator');

(async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-draft-preview-'));
  await fs.mkdir(path.join(projectDir, 'frames/.drafts/scene_01'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'frames/scene_01.html'), '<!doctype html><html><body>正式</body></html>', 'utf8');
  await fs.writeFile(path.join(projectDir, 'frames/.drafts/scene_01/draft_0001.html'), '<!doctype html><html><body>草稿</body></html>', 'utf8');

  const renderedFrames = [];
  const result = await renderHtmlVideoFramePreview({
    projectDir,
    project: {
      project_id: 'p1',
      output: { resolution: { width: 1920, height: 1080 }, fps: 30 },
      frames: [{
        id: 'scene_01',
        source_mode: 'raw_html',
        html_path: 'frames/scene_01.html',
        duration_sec: 3,
        drafts: [{ id: 'draft_0001', status: 'ready', html_path: 'frames/.drafts/scene_01/draft_0001.html' }],
      }],
      timeline: { tracks: [] },
    },
    frameId: 'scene_01',
    draftId: 'draft_0001',
    services: {
      materializer: {
        materializeProject: async ({ project }) => ({ project, diagnostics: [] }),
      },
      frameRenderer: {
        renderFrame: async (frame, options) => {
          renderedFrames.push({ frame, options });
          await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
          await fs.writeFile(options.outputPath, 'preview');
          return { success: true, output_path: options.outputPath, diagnostics: [] };
        },
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(renderedFrames.length, 1);
  assert.equal(renderedFrames[0].frame.html_path, 'frames/.drafts/scene_01/draft_0001.html');
  assert.equal(result.project.frames[0].html_path, 'frames/scene_01.html');
  assert.match(result.preview_path, /draft_0001/);

  const missing = await renderHtmlVideoFramePreview({
    projectDir,
    project: result.project,
    frameId: 'scene_01',
    draftId: 'missing',
    services: {
      materializer: { materializeProject: async ({ project }) => ({ project, diagnostics: [] }) },
      frameRenderer: { renderFrame: async () => ({ success: true, output_path: 'unused', diagnostics: [] }) },
    },
  });
  assert.equal(missing.success, false);
  assert.equal(missing.code, 'DRAFT_NOT_FOUND');

  await fs.rm(projectDir, { recursive: true, force: true });
  console.log('html-video draft frame preview tests passed');
})();
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node tests/test-html-video-frame-preview-draft.js
```

Expected: fails because `draftId` is ignored and official `html_path` is rendered.

- [ ] **Step 3: Implement draft preview support**

In `projectOrchestrator.js` require:

```js
const { findFrameByAnyId, canonicalFrameId, sanitizePathSegment } = require('./frameIdentity');
const { findDraft } = require('./htmlVideoDraftService');
```

Modify `renderHtmlVideoFramePreview()`:

- Read `draftId`:

```js
  const draftId = String(options.draftId || options.draft_id || '').trim();
```

- Find frame using shared helper:

```js
  const targetFrame = findFrameByAnyId(nextProject, frameId);
```

- If `draftId` is provided:

```js
  let frameToRender = targetFrame;
  let previewName = sanitizePathSegment(canonicalFrameId(targetFrame) || frameId);
  if (draftId) {
    const draft = findDraft(nextProject, frameId, draftId);
    if (!draft || draft.status === 'discarded') {
      return {
        success: false,
        code: 'DRAFT_NOT_FOUND',
        message: '未找到要预览的草稿。',
        project: nextProject,
        project_dir: materialized.project_dir,
        html_video_project_path: materialized.html_video_project_path,
        diagnostics,
      };
    }
    frameToRender = { ...targetFrame, html_path: draft.html_path };
    previewName = `${previewName}-${sanitizePathSegment(draft.id)}`;
  }
```

- Use `frameToRender` in `frameRenderer.renderFrame()`.

- Use preview path:

```js
  const previewPath = path.join(materialized.project_dir, 'inspect', 'previews', `${previewName}.mp4`);
```

- Return `preview_draft_id: draftId || null`.

- Do not mutate `targetFrame.html_path`.

- [ ] **Step 4: Pass `draft_id` through the existing render service**

In `server/services/creativeWorkflows.js`, update the `mode === 'frame'` branch inside `renderCreativeWorkflowHtmlVideoProject()`:

```js
  } else if (mode === 'frame') {
    result = await orchestrator.renderHtmlVideoFramePreview({
      ...baseOptions,
      frameId: safeString(payload.frame_id || payload.frameId),
      draftId: safeString(payload.draft_id || payload.draftId),
      runLayoutQa: payload.run_layout_qa === true || payload.runLayoutQa === true,
    });
  } else {
```

Also add these fields to the normalized return object:

```js
    preview_draft_id: result.preview_draft_id || null,
    layout_qa: result.layout_qa || null,
```

In `tests/test-html-video-routes.js`, update the fake `renderHtmlVideoProject` call recording:

```js
    renderHtmlVideoProject: async (id, payload) => {
      calls.push(['render', id, payload?.mode, payload?.frame_id || payload?.frameId || '', payload?.draft_id || '', payload?.run_layout_qa === true]);
      return {
        success: true,
        workflow_id: id,
        html_video_project: { project_id: 'p1', template_id: 'simple' },
        html_video_project_path: '/tmp/project',
        output_path: payload?.mode === 'materialize' ? undefined : '/tmp/project/frames/frame_01.mp4',
        preview_draft_id: payload?.draft_id || null,
        layout_qa: payload?.run_layout_qa ? { success: true, issues: [] } : null,
        message: payload?.mode === 'materialize' ? 'HTML 已重新生成。' : '单帧预览已更新。',
      };
    },
```

Add a route assertion:

```js
    const draftPreview = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/render`, {
      mode: 'frame',
      frame_id: 'frame_01',
      draft_id: 'draft_0001',
      run_layout_qa: true,
    });
    assert.equal(draftPreview.statusCode, 200);
    assert.equal(draftPreview.body.preview_draft_id, 'draft_0001');
    assert.equal(draftPreview.body.layout_qa.success, true);
    assert.deepEqual(calls.find(call => call[0] === 'render' && call[4] === 'draft_0001'), ['render', workflowId, 'frame', 'frame_01', 'draft_0001', true]);
```

- [ ] **Step 5: Run draft preview and route tests**

Run:

```powershell
node tests/test-html-video-frame-preview-draft.js
node tests/test-html-video-routes.js
```

Expected: draft preview test prints `html-video draft frame preview tests passed`; route tests pass and confirm `draft_id` / `run_layout_qa` payload reaches the render API.

- [ ] **Step 6: Run orchestrator-adjacent tests**

Run:

```powershell
node tests/test-html-video-real-render-smoke.js
node tests/test-html-video-project-orchestrator-modes.js
```

Expected: both pass or skip external-render portions according to existing behavior. If an existing smoke test requires Playwright and fails due local environment, record exact failure in final handoff and run the narrower unit tests.

- [ ] **Step 7: Commit**

```powershell
git add server/services/creative-video/html-video/projectOrchestrator.js server/services/creativeWorkflows.js tests/test-html-video-frame-preview-draft.js tests/test-html-video-routes.js
git commit -m "feat: 支持 html-video 草稿单帧预览"
```

---

## Task 6: Layout QA Fixtures And Service

**Files:**
- Create fixtures under `tests/fixtures/html-video-layout-qa/`
- Create: `server/services/creative-video/html-video/layoutQaService.js`
- Test: `tests/test-html-video-layout-qa-service.js`

- [ ] **Step 1: Create failing and fixed fixtures by hand**

Create `tests/fixtures/html-video-layout-qa/overlay-valuation.html`:

```html
<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:Arial,"Microsoft YaHei",sans-serif}
.card{position:absolute;left:720px;top:220px;width:1120px;height:620px;background:#ff5722}
.headline{position:absolute;left:100px;top:110px;width:900px;font-size:110px;font-weight:900;line-height:1}
.body-copy{position:absolute;left:100px;top:370px;width:760px;font-size:34px;font-weight:800;line-height:1.25}
.launch-zone{position:absolute;z-index:3;right:90px;bottom:80px;width:540px;height:300px}
.valuation{position:absolute;right:180px;top:10px;width:230px;height:150px;background:#111;color:#fff;font-size:58px}
</style></head><body><main>
<section class="card">
<h1 class="headline" data-text-key="headline">两三年财务自由，<br>创业估值爆发</h1>
<p class="body-copy" data-text-key="body">干上两三年，再出来创业，估值分分钟进入几十亿、上百亿的想象空间。</p>
<div class="launch-zone" aria-hidden="true"><div class="valuation">几十亿</div></div>
</section>
</main></body></html>
```

Create `overlay-valuation-fixed.html` with `.launch-zone{right:70px;bottom:40px;width:360px;height:150px}` and `.body-copy{width:640px}` so there is no overlap with `.body-copy`.

Create `overflow-card-title.html`:

```html
<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;font-family:Arial,"Microsoft YaHei",sans-serif}
.card{position:absolute;left:700px;top:220px;width:1220px;height:610px;background:#ff5722}
.big-number{position:absolute;left:100px;top:110px;font-size:300px;font-weight:900;line-height:.82}
.card-title{position:absolute;left:100px;top:590px;width:620px;font-size:72px;font-weight:900;line-height:1.05}
</style></head><body><article class="card">
<div class="big-number" data-text-key="amount">600<span>万</span></div>
<div class="card-title" data-text-key="card_title">年薪报价<br>冲到新高位</div>
</article></body></html>
```

Create `overflow-card-title-fixed.html` with `.big-number{font-size:230px}` and `.card-title{top:455px;font-size:58px}`.

- [ ] **Step 2: Write failing layout QA tests**

Create `tests/test-html-video-layout-qa-service.js`:

```js
const assert = require('assert/strict');
const path = require('path');

const { inspectFrameHtmlLayout } = require('../server/services/creative-video/html-video/layoutQaService');

(async () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures', 'html-video-layout-qa');

  const overlay = await inspectFrameHtmlLayout({
    htmlPath: path.join(fixturesDir, 'overlay-valuation.html'),
    frame: { id: 'scene_06', duration_sec: 1 },
    resolution: { width: 1920, height: 1080 },
    sampleTimesSec: [0.1],
  });
  assert.equal(overlay.success, false);
  assert.ok(overlay.issues.some(issue => issue.code === 'decorative_overlay_text' || issue.code === 'text_overlap'));

  const overlayFixed = await inspectFrameHtmlLayout({
    htmlPath: path.join(fixturesDir, 'overlay-valuation-fixed.html'),
    frame: { id: 'scene_06', duration_sec: 1 },
    resolution: { width: 1920, height: 1080 },
    sampleTimesSec: [0.1],
  });
  assert.equal(overlayFixed.success, true, JSON.stringify(overlayFixed.issues, null, 2));

  const overflow = await inspectFrameHtmlLayout({
    htmlPath: path.join(fixturesDir, 'overflow-card-title.html'),
    frame: { id: 'scene_04', duration_sec: 1 },
    resolution: { width: 1920, height: 1080 },
    sampleTimesSec: [0.1],
  });
  assert.equal(overflow.success, false);
  assert.ok(overflow.issues.some(issue => issue.code === 'text_out_of_container'));

  const overflowFixed = await inspectFrameHtmlLayout({
    htmlPath: path.join(fixturesDir, 'overflow-card-title-fixed.html'),
    frame: { id: 'scene_04', duration_sec: 1 },
    resolution: { width: 1920, height: 1080 },
    sampleTimesSec: [0.1],
  });
  assert.equal(overflowFixed.success, true, JSON.stringify(overflowFixed.issues, null, 2));

  console.log('html-video layout QA service tests passed');
})();
```

- [ ] **Step 3: Run test and verify RED**

Run:

```powershell
node tests/test-html-video-layout-qa-service.js
```

Expected: fails with missing module.

- [ ] **Step 4: Implement `layoutQaService.js`**

Create `server/services/creative-video/html-video/layoutQaService.js`. Use Playwright, but return a warning instead of throwing if unavailable:

```js
const path = require('path');

function defaultSampleTimes(durationSec) {
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration <= 0) return [0.1];
  if (duration < 1.2) return [Math.max(0.1, duration * 0.5)];
  return [0.8, 1.8, duration * 0.65, Math.max(0, duration - 0.3)]
    .filter(time => time >= 0 && time <= duration)
    .filter((time, index, list) => list.findIndex(item => Math.abs(item - time) < 0.05) === index)
    .slice(0, 5);
}

function intersect(a, b) {
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return { width: x, height: y, area: x * y };
}

function issue(code, frameId, message, details = {}) {
  return { code, severity: details.severity || 'error', frame_id: frameId || '', message, ...details };
}

async function loadPlaywright(importPlaywright) {
  if (importPlaywright) return importPlaywright();
  return import('playwright');
}

async function inspectFrameHtmlLayout({
  htmlPath,
  frame = {},
  resolution = { width: 1920, height: 1080 },
  durationSec = frame.duration_sec || frame.durationSec,
  sampleTimesSec,
  importPlaywright,
} = {}) {
  const frameId = frame.id || frame.scene_id || '';
  let chromium;
  try {
    ({ chromium } = await loadPlaywright(importPlaywright));
  } catch (error) {
    return {
      success: true,
      issues: [issue('LAYOUT_QA_ENVIRONMENT_NOT_CONFIGURED', frameId, `Playwright Chromium 未配置，已跳过布局检查：${error.message}`, { severity: 'warning' })],
      metrics: { skipped: true },
    };
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: resolution.width, height: resolution.height }, deviceScaleFactor: 1 });
  const issues = [];
  try {
    await page.addInitScript(() => {
      window.__hvLayoutQaVisibilityState = document.visibilityState;
      document.addEventListener('visibilitychange', () => {
        window.__hvLayoutQaVisibilityState = document.visibilityState;
      });
    });
    await page.goto(`file:///${path.resolve(htmlPath).replace(/\\/g, '/')}`);
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const samples = sampleTimesSec || defaultSampleTimes(durationSec);
    for (const time of samples) {
      if (time > 0) await page.waitForTimeout(time * 1000);
      const result = await page.evaluate(() => {
        function visible(el) {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
          const rect = el.getBoundingClientRect();
          return rect.width >= 8 && rect.height >= 8;
        }
        function box(el) {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, area: r.width * r.height };
        }
        const candidates = Array.from(document.querySelectorAll('[data-text-key], .headline, .body-copy, .card-title, .big-number, .valuation, [data-role], h1, h2, h3, p, li, span, div'))
          .filter(el => visible(el) && (el.innerText || '').trim())
          .map(el => ({
            selector: el.className ? `.${String(el.className).trim().split(/\s+/)[0]}` : el.tagName.toLowerCase(),
            text: (el.innerText || '').trim().slice(0, 80),
            key: el.getAttribute('data-text-key') || '',
            role: el.getAttribute('data-role') || '',
            ariaHidden: el.getAttribute('aria-hidden') === 'true',
            zIndex: getComputedStyle(el).zIndex,
            box: box(el),
            container: (() => {
              const c = el.closest('.card, article, section[data-role], section');
              return c && c !== el ? box(c) : null;
            })(),
          }));
        return { candidates };
      });

      for (const item of result.candidates) {
        const b = item.box;
        if (b.left < -8 || b.top < -8 || b.right > resolution.width + 8 || b.bottom > resolution.height + 8) {
          issues.push(issue('text_out_of_viewport', frameId, '文本超出画面边界。', { time_sec: time, selector: item.selector, text: item.text }));
        }
        if (item.container) {
          const c = item.container;
          if (b.left < c.left - 12 || b.top < c.top - 12 || b.right > c.right + 12 || b.bottom > c.bottom + 12) {
            issues.push(issue('text_out_of_container', frameId, '文本超出容器边界。', { time_sec: time, selector: item.selector, text: item.text }));
          }
        }
      }

      for (let i = 0; i < result.candidates.length; i += 1) {
        for (let j = i + 1; j < result.candidates.length; j += 1) {
          const a = result.candidates[i];
          const b = result.candidates[j];
          const hit = intersect(a.box, b.box);
          const threshold = Math.min(a.box.area, b.box.area) * 0.08;
          if (hit.area > threshold && a.text !== b.text) {
            const important = /headline|body|subtitle/.test(`${a.key} ${b.key} ${a.selector} ${b.selector}`);
            issues.push(issue(important ? 'decorative_overlay_text' : 'text_overlap', frameId, important ? '装饰或其他文字遮挡正文。' : '文本元素互相重叠。', {
              time_sec: time,
              a: a.selector,
              b: b.selector,
              intersection_area: Math.round(hit.area),
              severity: important ? 'error' : 'warning',
            }));
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
  const errors = issues.filter(item => item.severity !== 'warning' && item.severity !== 'info');
  return { success: errors.length === 0, issues, metrics: { checked_issues: issues.length } };
}

module.exports = {
  inspectFrameHtmlLayout,
  defaultSampleTimes,
};
```

- [ ] **Step 5: Run layout QA test**

Run:

```powershell
node tests/test-html-video-layout-qa-service.js
```

Expected: `html-video layout QA service tests passed`. If exact overlap heuristics produce extra warnings on fixed fixtures, adjust fixture positions first; only then adjust thresholds.

- [ ] **Step 6: Commit**

```powershell
git add server/services/creative-video/html-video/layoutQaService.js tests/test-html-video-layout-qa-service.js tests/fixtures/html-video-layout-qa
git commit -m "feat: 增加 html-video DOM 布局质检"
```

---

## Task 7: Layout QA API And Preview Integration

**Files:**
- Modify: `server/services/creativeWorkflows.js`
- Modify: `server/routes/creativeWorkflows.js`
- Modify: `server/services/creative-video/html-video/projectOrchestrator.js`
- Modify: `tests/test-html-video-routes.js`
- Test: extend `tests/test-html-video-frame-preview-draft.js`

- [ ] **Step 1: Add failing tests for route and preview QA**

In `tests/test-html-video-routes.js` fake service, add:

```js
    inspectHtmlVideoProjectLayout: async (id, payload) => {
      calls.push(['layout-qa', id, payload.frame_id || payload.frameId || 'all']);
      return { success: true, workflow_id: id, layout_qa: { success: true, issues: [] }, message: '布局检查通过。' };
    },
```

Add assertions:

```js
    const frameQa = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/frames/frame_01/layout-qa`, {});
    assert.equal(frameQa.statusCode, 200);
    assert.equal(frameQa.body.layout_qa.success, true);
    const projectQa = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/layout-qa`, {});
    assert.equal(projectQa.statusCode, 200);
    assert.equal(projectQa.body.layout_qa.success, true);
```

In `tests/test-html-video-frame-preview-draft.js`, pass `runLayoutQa: true` and fake service:

```js
      layoutQaService: {
        inspectFrameHtmlLayout: async ({ frame }) => ({ success: true, issues: [], metrics: { frame_id: frame.id } }),
      },
```

Assert:

```js
  assert.equal(result.layout_qa.success, true);
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node tests/test-html-video-routes.js
node tests/test-html-video-frame-preview-draft.js
```

Expected: route test fails for missing layout routes, preview test fails for missing `layout_qa`.

- [ ] **Step 3: Integrate layout QA in `projectOrchestrator.js`**

Require:

```js
const defaultLayoutQaService = require('./layoutQaService');
```

In `renderHtmlVideoFramePreview()`, after choosing `frameToRender` and before or after render:

```js
  let layoutQa = null;
  if (options.runLayoutQa || options.run_layout_qa) {
    const layoutQaService = options.services?.layoutQaService || defaultLayoutQaService;
    const sourcePath = path.isAbsolute(frameToRender.html_path)
      ? frameToRender.html_path
      : path.join(materialized.project_dir, frameToRender.html_path);
    layoutQa = await layoutQaService.inspectFrameHtmlLayout({
      htmlPath: sourcePath,
      frame: frameToRender,
      resolution: outputConfig.resolution,
      durationSec: frameToRender.duration_sec,
    });
  }
```

Return `layout_qa: layoutQa`.

- [ ] **Step 4: Add workflow service QA methods**

In `server/services/creativeWorkflows.js`, add:

```js
const { findFrameByAnyId } = require('./creative-video/html-video/frameIdentity');

async function inspectHtmlVideoProjectLayout(workflowId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const layoutQaService = options.layoutQaService || require('./creative-video/html-video/layoutQaService');
  const frameId = safeString(payload.frame_id || payload.frameId);
  const targetFrame = frameId ? findFrameByAnyId(project, frameId) : null;
  if (frameId && !targetFrame) {
    return { success: false, code: 'FRAME_NOT_FOUND', workflow_id: workflowId, frame_id: frameId, message: '未找到要检查的帧。' };
  }
  const frames = frameId ? [targetFrame] : project.frames;
  const reports = [];
  for (const frame of frames) {
    if (frame.source_mode !== 'raw_html' || !frame.html_path) continue;
    const htmlPath = path.isAbsolute(frame.html_path) ? frame.html_path : path.join(projectDir, frame.html_path);
    reports.push(await layoutQaService.inspectFrameHtmlLayout({
      htmlPath,
      frame,
      resolution: project.output?.resolution || { width: 1920, height: 1080 },
      durationSec: frame.duration_sec,
    }));
  }
  const issues = reports.flatMap(report => report.issues || []);
  const layoutQa = { success: issues.every(issue => issue.severity === 'warning' || issue.severity === 'info'), issues, reports };
  project.layout_qa_reports = Array.isArray(project.layout_qa_reports) ? project.layout_qa_reports : [];
  project.layout_qa_reports.push({ id: `layout_qa_${String(project.layout_qa_reports.length + 1).padStart(4, '0')}`, created_at: new Date().toISOString(), frame_id: frameId || null, ...layoutQa });
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return { success: true, workflow_id: workflowId, html_video_project: saved, html_video_project_path: projectDir, layout_qa: layoutQa, message: layoutQa.success ? '布局检查通过。' : '布局检查发现问题。' };
}
```

Export it.

- [ ] **Step 5: Add layout QA routes**

Add:

```js
router.post('/:workflow_id/html-video-project/layout-qa', async (req, res) => {
  const workflowId = String(req.params.workflow_id || '').trim();
  try {
    const result = await getService(req).inspectHtmlVideoProjectLayout(workflowId, req.body || {});
    if (!result?.success) {
      const message = result?.message || '布局检查失败。';
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, message, code: result?.code });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, workflow_id: workflowId, message: `布局检查失败：${error.message}` });
  }
});

router.post('/:workflow_id/html-video-project/frames/:frame_id/layout-qa', async (req, res) => {
  const workflowId = String(req.params.workflow_id || '').trim();
  const frameId = String(req.params.frame_id || '').trim();
  try {
    const result = await getService(req).inspectHtmlVideoProjectLayout(workflowId, { ...(req.body || {}), frame_id: frameId });
    if (!result?.success) {
      const message = result?.message || '布局检查失败。';
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, frame_id: frameId, message, code: result?.code });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, workflow_id: workflowId, frame_id: frameId, message: `布局检查失败：${error.message}` });
  }
});
```

Both routes must use `getStatusCode(result)` consistently with existing workflow routes and return Chinese error messages. The frame route must inject `frame_id` from the URL even when the request body contains another value.

- [ ] **Step 6: Run tests**

Run:

```powershell
node tests/test-html-video-routes.js
node tests/test-html-video-frame-preview-draft.js
node tests/test-html-video-layout-qa-service.js
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add server/services/creativeWorkflows.js server/routes/creativeWorkflows.js server/services/creative-video/html-video/projectOrchestrator.js tests/test-html-video-routes.js tests/test-html-video-frame-preview-draft.js
git commit -m "feat: 接入 html-video 布局质检接口"
```

---

## Task 8: Frontend API And Hook Actions

**Files:**
- Modify: `frontend-react/src/api/client.js`
- Modify: `frontend-react/src/hooks/useHtmlVideoProject.js`
- Modify: `tests/test-html-video-api-client.mjs`
- Modify: `tests/test-html-video-editor-components.mjs`

- [ ] **Step 1: Write failing API/client assertions**

In `tests/test-html-video-api-client.mjs`, assert source includes:

```js
assert.ok(source.includes('getHtmlVideoProjectFrameHtml(workflowId, frameId)'), 'client should expose getHtmlVideoProjectFrameHtml');
assert.ok(source.includes('saveHtmlVideoProjectFrameHtml(workflowId, frameId, payload)'), 'client should expose saveHtmlVideoProjectFrameHtml');
assert.ok(source.includes('acceptHtmlVideoProjectFrameDraft(workflowId, frameId, draftId)'), 'client should expose acceptHtmlVideoProjectFrameDraft');
assert.ok(source.includes('discardHtmlVideoProjectFrameDraft(workflowId, frameId, draftId)'), 'client should expose discardHtmlVideoProjectFrameDraft');
assert.ok(source.includes('inspectHtmlVideoProjectLayout(workflowId, payload)'), 'client should expose inspectHtmlVideoProjectLayout');
assert.ok(source.includes('iterateHtmlVideoProjectFrame(workflowId, frameId, payload)'), 'client should expose iterateHtmlVideoProjectFrame');
assert.ok(source.includes('createHtmlVideoProjectEditPlan(workflowId, payload)'), 'client should expose createHtmlVideoProjectEditPlan');
assert.ok(source.includes('runHtmlVideoProjectEditPlan(workflowId, planId, payload)'), 'client should expose runHtmlVideoProjectEditPlan');
assert.ok(source.includes('acceptHtmlVideoProjectEditPlan(workflowId, planId)'), 'client should expose acceptHtmlVideoProjectEditPlan');
assert.ok(source.includes('discardHtmlVideoProjectEditPlan(workflowId, planId)'), 'client should expose discardHtmlVideoProjectEditPlan');
```

In `tests/test-html-video-editor-components.mjs`, add hook assertions:

```js
for (const method of [
  'getHtmlVideoProjectFrameHtml',
  'saveHtmlVideoProjectFrameHtml',
  'acceptHtmlVideoProjectFrameDraft',
  'discardHtmlVideoProjectFrameDraft',
  'inspectHtmlVideoProjectLayout',
  'iterateHtmlVideoProjectFrame',
  'createHtmlVideoProjectEditPlan',
  'runHtmlVideoProjectEditPlan',
  'acceptHtmlVideoProjectEditPlan',
  'discardHtmlVideoProjectEditPlan',
]) {
  assert.ok(hook.includes(method), `hook should call api.${method}`);
}

for (const message of [
  '正在加载当前帧源码',
  '正在保存帧源码草稿',
  '正在接受草稿',
  '正在放弃草稿',
  '正在运行布局检查',
  '正在接受计划草稿',
  '正在放弃计划草稿',
]) {
  assert.ok(hook.includes(message), `hook should expose Chinese secondary editing message: ${message}`);
}
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node tests/test-html-video-api-client.mjs
node tests/test-html-video-editor-components.mjs
```

Expected: fail on missing methods/messages.

- [ ] **Step 3: Add API client methods**

In `frontend-react/src/api/client.js`, add:

```js
  getHtmlVideoProjectFrameHtml(workflowId, frameId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/frames/${encodeURIComponent(frameId)}/html`);
  },
  saveHtmlVideoProjectFrameHtml(workflowId, frameId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/frames/${encodeURIComponent(frameId)}/html`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  acceptHtmlVideoProjectFrameDraft(workflowId, frameId, draftId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/frames/${encodeURIComponent(frameId)}/drafts/${encodeURIComponent(draftId)}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
  discardHtmlVideoProjectFrameDraft(workflowId, frameId, draftId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/frames/${encodeURIComponent(frameId)}/drafts/${encodeURIComponent(draftId)}/discard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
  inspectHtmlVideoProjectLayout(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/layout-qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  iterateHtmlVideoProjectFrame(workflowId, frameId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/frames/${encodeURIComponent(frameId)}/iterate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  createHtmlVideoProjectEditPlan(workflowId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/edit-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  runHtmlVideoProjectEditPlan(workflowId, planId, payload) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/edit-plan/${encodeURIComponent(planId)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  },
  acceptHtmlVideoProjectEditPlan(workflowId, planId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/edit-plan/${encodeURIComponent(planId)}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
  discardHtmlVideoProjectEditPlan(workflowId, planId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/html-video-project/edit-plan/${encodeURIComponent(planId)}/discard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  },
```

- [ ] **Step 4: Extend `useHtmlVideoProject`**

Add state:

```js
  const [frameHtml, setFrameHtml] = useState('');
  const [layoutQa, setLayoutQa] = useState(null);
  const [editPlan, setEditPlan] = useState(null);
```

Add actions using `runMutatingAction` or dedicated loading for GET:

```js
  const loadFrameHtml = useCallback((frameId) => runMutatingAction({
    nextStatus: 'loading_source',
    loadingMessage: '正在加载当前帧源码...',
    successMessage: '当前帧源码已加载。',
    fallbackMessage: '加载当前帧源码失败。',
    action: async () => {
      const result = await api.getHtmlVideoProjectFrameHtml(workflowId, frameId);
      setFrameHtml(result?.html || '');
      return result;
    },
  }), [api, workflowId, runMutatingAction]);
```

Add `saveFrameHtmlDraft`, `acceptFrameDraft`, `discardFrameDraft`, `inspectLayout`, `iterateFrame`, `createEditPlan`, `runEditPlan`, `acceptEditPlan`, and `discardEditPlan`. Each must set Chinese loading/success/failure messages.

Return new state/actions from hook.

- [ ] **Step 5: Run frontend source tests**

Run:

```powershell
node tests/test-html-video-api-client.mjs
node tests/test-html-video-editor-components.mjs
```

Expected: both pass.

- [ ] **Step 6: Commit**

```powershell
git add frontend-react/src/api/client.js frontend-react/src/hooks/useHtmlVideoProject.js tests/test-html-video-api-client.mjs tests/test-html-video-editor-components.mjs
git commit -m "feat: 增加 html-video 二次编辑前端接口"
```

---

## Task 9: Source, Draft, And Quality Panels

**Files:**
- Create: `frontend-react/src/components/creative-video-editor/HtmlVideoSourcePanel.jsx`
- Create: `frontend-react/src/components/creative-video-editor/HtmlVideoDraftPanel.jsx`
- Create: `frontend-react/src/components/creative-video-editor/HtmlVideoQualityPanel.jsx`
- Modify: `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx`
- Modify: `frontend-react/src/components/creative-video-editor/ProjectFramesList.jsx`
- Modify: `tests/test-html-video-editor-components.mjs`

- [ ] **Step 1: Write failing component source assertions**

In `tests/test-html-video-editor-components.mjs`, add new component paths:

```js
  'frontend-react/src/components/creative-video-editor/HtmlVideoSourcePanel.jsx',
  'frontend-react/src/components/creative-video-editor/HtmlVideoDraftPanel.jsx',
  'frontend-react/src/components/creative-video-editor/HtmlVideoQualityPanel.jsx',
```

Add assertions:

```js
const sourcePanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoSourcePanel.jsx', 'utf-8');
assert.ok(sourcePanel.includes('源码'), 'Source panel should show Chinese source title');
assert.ok(sourcePanel.includes('保存为草稿'), 'Source panel should save draft');
assert.ok(sourcePanel.includes('当前帧不是 raw_html'), 'Source panel should handle non raw_html frame');
assert.doesNotMatch(sourcePanel, /mode:\s*['"]replace['"]/, 'Source panel should not send replace mode');

const draftPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoDraftPanel.jsx', 'utf-8');
assert.ok(draftPanel.includes('接受草稿'), 'Draft panel should accept drafts');
assert.ok(draftPanel.includes('放弃草稿'), 'Draft panel should discard drafts');

const qualityPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoQualityPanel.jsx', 'utf-8');
assert.ok(qualityPanel.includes('布局检查'), 'Quality panel should show layout QA');
assert.ok(qualityPanel.includes('用 AI 修复当前帧'), 'Quality panel should expose frame fix action');

assert.ok(editor.includes('HtmlVideoSourcePanel'), 'HtmlVideoProjectEditor should compose source panel');
assert.ok(editor.includes('HtmlVideoDraftPanel'), 'HtmlVideoProjectEditor should compose draft panel');
assert.ok(editor.includes('HtmlVideoQualityPanel'), 'HtmlVideoProjectEditor should compose quality panel');
assert.doesNotMatch(editor, /ReservedCapabilitiesPanel/, 'reserved panel should remain hidden');
```

Remove or update the old assertion:

```js
assert.doesNotMatch(editor, /源码|sourceHtml|html_source|contentEditable/, 'editor should not expose HTML source editing');
```

Replace with:

```js
assert.ok(editor.includes('源码'), 'editor should expose a controlled Source tab');
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node tests/test-html-video-editor-components.mjs
```

Expected: fails for missing components.

- [ ] **Step 3: Create `HtmlVideoSourcePanel.jsx`**

Use a textarea and controlled draft:

```jsx
import { useEffect, useState } from 'react';

export function HtmlVideoSourcePanel({ frame, html, disabled, onLoad, onSaveDraft, onRenderDraft }) {
  const [draft, setDraft] = useState(html || '');
  useEffect(() => { setDraft(html || ''); }, [html, frame?.id, frame?.scene_id]);
  const frameId = frame?.id || frame?.scene_id || '';
  const rawHtml = frame?.source_mode === 'raw_html';
  if (!frame) return <section className="creative-video-editor-panel"><p>请选择要编辑的帧。</p></section>;
  if (!rawHtml) return <section className="creative-video-editor-panel"><p>当前帧不是 raw_html，暂不支持源码编辑。</p></section>;
  return (
    <section className="creative-video-editor-panel html-video-source-panel">
      <div className="creative-video-editor-panel-header">
        <h3>源码</h3>
        <div className="creative-video-editor-inline-actions">
          <button type="button" disabled={disabled} onClick={() => onLoad(frameId)}>加载源码</button>
          <button type="button" disabled={disabled || !draft.trim()} onClick={() => onSaveDraft(frameId, { html: draft, mode: 'draft' })}>保存为草稿</button>
          <button type="button" disabled={disabled || !frame.active_draft_id} onClick={() => onRenderDraft(frameId, frame.active_draft_id)}>渲染草稿</button>
        </div>
      </div>
      <textarea value={draft} disabled={disabled} rows={16} spellCheck={false} onChange={event => setDraft(event.target.value)} />
    </section>
  );
}
```

- [ ] **Step 4: Create `HtmlVideoDraftPanel.jsx`**

```jsx
function activeDraft(frame) {
  const drafts = Array.isArray(frame?.drafts) ? frame.drafts : [];
  return drafts.find(draft => draft.id === frame?.active_draft_id) || null;
}

export function HtmlVideoDraftPanel({ frame, disabled, onAccept, onDiscard, onRender }) {
  const draft = activeDraft(frame);
  const frameId = frame?.id || frame?.scene_id || '';
  return (
    <section className="creative-video-editor-panel html-video-draft-panel">
      <div className="creative-video-editor-panel-header">
        <h3>草稿</h3>
        {draft ? (
          <div className="creative-video-editor-inline-actions">
            <button type="button" disabled={disabled} onClick={() => onRender(frameId, draft.id)}>渲染草稿</button>
            <button type="button" disabled={disabled} onClick={() => onAccept(frameId, draft.id)}>接受草稿</button>
            <button type="button" disabled={disabled} onClick={() => onDiscard(frameId, draft.id)}>放弃草稿</button>
          </div>
        ) : null}
      </div>
      {draft ? <p>{draft.summary || draft.instruction || draft.id}</p> : <p>当前帧没有待处理草稿。</p>}
    </section>
  );
}
```

- [ ] **Step 5: Create `HtmlVideoQualityPanel.jsx`**

```jsx
export function HtmlVideoQualityPanel({ frame, layoutQa, disabled, onInspectFrame, onFixFrame }) {
  const frameId = frame?.id || frame?.scene_id || '';
  const issues = Array.isArray(layoutQa?.issues) ? layoutQa.issues : [];
  return (
    <section className="creative-video-editor-panel html-video-quality-panel">
      <div className="creative-video-editor-panel-header">
        <h3>布局检查</h3>
        <div className="creative-video-editor-inline-actions">
          <button type="button" disabled={disabled || !frameId} onClick={() => onInspectFrame({ frame_id: frameId })}>运行布局检查</button>
          <button type="button" disabled={disabled || !frameId} onClick={() => onFixFrame?.(frameId)}>用 AI 修复当前帧</button>
        </div>
      </div>
      {issues.length ? (
        <ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message || issue.code}</li>)}</ul>
      ) : <p>暂无布局检查问题。</p>}
    </section>
  );
}
```

- [ ] **Step 6: Wire panels in `HtmlVideoProjectEditor.jsx`**

Import panels and render them under current frame area. Keep simple sections; no nested cards:

```jsx
import { HtmlVideoSourcePanel } from './HtmlVideoSourcePanel.jsx';
import { HtmlVideoDraftPanel } from './HtmlVideoDraftPanel.jsx';
import { HtmlVideoQualityPanel } from './HtmlVideoQualityPanel.jsx';
```

Pass editor methods:

```jsx
<HtmlVideoSourcePanel
  frame={selectedFrame}
  html={editor.frameHtml}
  disabled={disabled}
  onLoad={editor.loadFrameHtml}
  onSaveDraft={editor.saveFrameHtmlDraft}
  onRenderDraft={(frameId, draftId) => editor.renderFramePreview(frameId, { draft_id: draftId, run_layout_qa: true })}
/>
<HtmlVideoDraftPanel
  frame={selectedFrame}
  disabled={disabled}
  onRender={(frameId, draftId) => editor.renderFramePreview(frameId, { draft_id: draftId, run_layout_qa: true })}
  onAccept={editor.acceptFrameDraft}
  onDiscard={editor.discardFrameDraft}
/>
<HtmlVideoQualityPanel
  frame={selectedFrame}
  layoutQa={editor.layoutQa}
  disabled={disabled}
  onInspectFrame={editor.inspectLayout}
  onFixFrame={(frameId) => editor.iterateFrame(frameId, { mode: 'layout_fix', preserve_text: true, run_layout_qa: true, render_preview: true, instruction: '修复当前帧文字错位、越界或遮挡问题，保留现有文案和整体风格。' })}
/>
```

If `renderFramePreview` hook currently accepts only `frameId`, update Task 8 hook to accept optional payload:

```js
const renderFramePreview = useCallback((frameId, payload = {}) => runMutatingAction({
  loadingMessage: '正在渲染单帧预览...',
  successMessage: '单帧预览已生成。',
  action: () => api.renderHtmlVideoProject(workflowId, { ...payload, mode: 'frame', frame_id: frameId }),
}), [api, runMutatingAction, workflowId]);
```

- [ ] **Step 7: Update `ProjectFramesList.jsx`**

Show active draft marker:

```jsx
{frame.active_draft_id ? <span className="creative-video-editor-frame-status">有草稿</span> : null}
```

- [ ] **Step 8: Run frontend source tests**

Run:

```powershell
node tests/test-html-video-editor-components.mjs
```

Expected: component tests pass.

- [ ] **Step 9: Commit**

```powershell
git add frontend-react/src/components/creative-video-editor/HtmlVideoSourcePanel.jsx frontend-react/src/components/creative-video-editor/HtmlVideoDraftPanel.jsx frontend-react/src/components/creative-video-editor/HtmlVideoQualityPanel.jsx frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx frontend-react/src/components/creative-video-editor/ProjectFramesList.jsx tests/test-html-video-editor-components.mjs
git commit -m "feat: 增加 html-video 源码草稿编辑面板"
```

---

## Task 10: AI Single-Frame Iterate

**Files:**
- Create: `server/services/creative-video/html-video/htmlVideoIterateService.js`
- Modify: `server/services/creativeWorkflows.js`
- Modify: `server/routes/creativeWorkflows.js`
- Create: `tests/test-html-video-frame-iterate-service.js`
- Modify: `tests/test-html-video-routes.js`

- [ ] **Step 1: Write failing iterate service tests**

Create `tests/test-html-video-frame-iterate-service.js`:

```js
const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { iterateFrameHtml } = require('../server/services/creative-video/html-video/htmlVideoIterateService');

(async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-video-iterate-'));
  await fs.mkdir(path.join(projectDir, 'frames'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'frames/scene_06.html'), '<!doctype html><html><body><h1 data-text-key="headline">标题</h1><p data-text-key="body">正文</p></body></html>', 'utf8');
  const project = {
    frames: [{
      id: 'scene_06',
      source_mode: 'raw_html',
      html_path: 'frames/scene_06.html',
      duration_sec: 3,
      metadata: { visual_text: { headline: '标题' } },
      drafts: [],
    }],
    revisions: [],
  };
  const model = {
    callTextModel: async () => ({
      success: true,
      text: '```html\n<!doctype html><html><body><h1 data-text-key="headline">标题</h1><p data-text-key="body">正文</p></body></html>\n```',
    }),
  };

  const result = await iterateFrameHtml({
    projectDir,
    project,
    frameId: 'scene_06',
    instruction: '修复遮挡',
    mode: 'layout_fix',
    preserveText: true,
    model,
  });

  assert.equal(result.success, true);
  assert.equal(result.draft.kind, 'ai_iterate');
  assert.equal(project.frames[0].drafts.length, 1);
  assert.match(await fs.readFile(path.join(projectDir, result.draft.html_path), 'utf8'), /data-text-key="headline"/);

  const bad = await iterateFrameHtml({
    projectDir,
    project,
    frameId: 'scene_06',
    instruction: '坏输出',
    model: { callTextModel: async () => ({ success: true, text: 'not html' }) },
  });
  assert.equal(bad.success, false);
  assert.equal(bad.code, 'AI_FRAME_HTML_INVALID');

  await fs.rm(projectDir, { recursive: true, force: true });
  console.log('html-video frame iterate service tests passed');
})();
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node tests/test-html-video-frame-iterate-service.js
```

Expected: missing module.

- [ ] **Step 3: Implement `htmlVideoIterateService.js`**

Create service:

```js
const fs = require('fs/promises');
const path = require('path');

const { findFrameByAnyId, canonicalFrameId } = require('./frameIdentity');
const { saveFrameHtmlDraft, validateCompleteHtml } = require('./frameHtmlEditService');

function extractHtmlDocument(text) {
  const source = String(text || '');
  const fenced = source.match(/```html\s*([\s\S]*?)```/i);
  const html = fenced ? fenced[1].trim() : source.trim();
  if (!/(<!doctype\s+html|<html[\s>])/i.test(html) || !/<\/html>/i.test(html)) return '';
  return html;
}

function summarizeHtml(html) {
  const text = String(html || '');
  const visible = text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return visible.slice(0, 1200);
}

function buildFrameIteratePrompt({ frame, currentHtml, instruction, mode, preserveText }) {
  return [
    '你是 html-video 单帧 HTML 重写器。',
    '只返回一个完整 HTML 文档，不要返回解释。',
    `当前帧：${canonicalFrameId(frame)}`,
    `编辑模式：${mode || 'layout_fix'}`,
    `用户要求：${instruction}`,
    preserveText ? '必须保留当前可见中文文案和数字含义，不得改写。' : '可以在不违背用户要求的前提下改写当前帧内容。',
    '必须保留 data-text-key="headline"、data-text-key="subtitle"、data-text-key="body" 中已有的锚点；如果原文没有 subtitle，也不要造无意义 subtitle。',
    '不得引入外网 script、iframe、object 或 embed。',
    '不得让标题、正文、关键数字、标签互相遮挡；保留底部字幕安全区。',
    `当前帧可见内容摘要：${summarizeHtml(currentHtml)}`,
    '输出以 <!doctype html> 开始，以 </html> 结束。',
  ].join('\n');
}

async function iterateFrameHtml({ projectDir, project, frameId, instruction = '', mode = 'layout_fix', preserveText = true, model } = {}) {
  const frame = findFrameByAnyId(project, frameId);
  if (!frame) return { success: false, code: 'FRAME_NOT_FOUND', message: `未找到帧 ${frameId || ''}。` };
  if (frame.source_mode !== 'raw_html' || !frame.html_path) {
    return { success: false, code: 'FRAME_HTML_NOT_AVAILABLE', message: '当前帧没有可重写的源码。' };
  }
  if (!model || typeof model.callTextModel !== 'function') {
    return { success: false, code: 'AI_MODEL_NOT_CONFIGURED', message: 'AI 模型未配置，无法重写当前帧。' };
  }
  const htmlPath = path.isAbsolute(frame.html_path) ? frame.html_path : path.join(projectDir, frame.html_path);
  const currentHtml = await fs.readFile(htmlPath, 'utf8');
  const response = await model.callTextModel({
    messages: [{ role: 'user', content: buildFrameIteratePrompt({ frame, currentHtml, instruction, mode, preserveText }) }],
  });
  if (!response || response.success === false) {
    return { success: false, code: 'AI_FRAME_ITERATE_FAILED', message: response?.message || 'AI 重写当前帧失败。' };
  }
  const html = extractHtmlDocument(response.text || response.content || '');
  if (!html) return { success: false, code: 'AI_FRAME_HTML_INVALID', message: 'AI 返回的 HTML 无效。' };
  const validation = validateCompleteHtml(html);
  if (validation) return validation;
  const draftResult = await saveFrameHtmlDraft({
    projectDir,
    project,
    frameId,
    html,
    kind: 'ai_iterate',
    instruction,
    summary: 'AI 当前帧重写草稿。',
  });
  return {
    ...draftResult,
    mode,
    message: draftResult.success ? '当前帧草稿已生成。' : draftResult.message,
  };
}

module.exports = {
  iterateFrameHtml,
  extractHtmlDocument,
  buildFrameIteratePrompt,
};
```

- [ ] **Step 4: Run iterate service tests**

Run:

```powershell
node tests/test-html-video-frame-iterate-service.js
```

Expected: iterate tests pass.

- [ ] **Step 5: Add workflow service and route**

In `creativeWorkflows.js`, add:

```js
async function iterateHtmlVideoProjectFrame(workflowId, frameId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const iterateService = options.htmlVideoIterateService || require('./creative-video/html-video/htmlVideoIterateService');
  const result = await iterateService.iterateFrameHtml({
    projectDir,
    project,
    frameId,
    instruction: payload.instruction,
    mode: payload.mode,
    preserveText: payload.preserve_text !== false,
    model: options.aiTextModel || aiTextModel,
  });
  if (!result.success) return { ...result, workflow_id: workflowId, frame_id: frameId };
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return { ...result, workflow_id: workflowId, frame_id: frameId, html_video_project: saved, html_video_project_path: projectDir };
}
```

Add route:

```js
router.post('/:workflow_id/html-video-project/frames/:frame_id/iterate', async (req, res) => {
  const workflowId = String(req.params.workflow_id || '').trim();
  const frameId = String(req.params.frame_id || '').trim();
  try {
    const result = await getService(req).iterateHtmlVideoProjectFrame(workflowId, frameId, req.body || {});
    if (!result?.success) {
      const message = result?.message || '重写当前帧失败。';
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, frame_id: frameId, message, code: result?.code });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, workflow_id: workflowId, frame_id: frameId, message: `重写当前帧失败：${error.message}` });
  }
});
```

Use the same response shape as the frame HTML routes: `success`, `workflow_id`, `frame_id`, `draft`, `html_video_project`, and `message`.

- [ ] **Step 6: Extend route tests**

In `tests/test-html-video-routes.js` fake service, add:

```js
    iterateHtmlVideoProjectFrame: async (id, frameId, payload) => {
      calls.push(['iterate-frame', id, frameId, payload.mode || 'layout_fix']);
      return {
        success: true,
        workflow_id: id,
        frame_id: frameId,
        draft: { id: 'draft_ai_0001', status: 'ready' },
        message: '当前帧草稿已生成。',
      };
    },
```

Add assertions:

```js
    const iterateFrame = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/frames/frame_01/iterate`, {
      instruction: '修复文字遮挡',
      mode: 'layout_fix',
    });
    assert.equal(iterateFrame.statusCode, 200);
    assert.equal(iterateFrame.body.draft.id, 'draft_ai_0001');
    assert.deepEqual(calls.find(call => call[0] === 'iterate-frame'), ['iterate-frame', workflowId, 'frame_01', 'layout_fix']);
```

- [ ] **Step 7: Run tests**

```powershell
node tests/test-html-video-frame-iterate-service.js
node tests/test-html-video-routes.js
```

Expected: both pass.

- [ ] **Step 8: Commit**

```powershell
git add server/services/creative-video/html-video/htmlVideoIterateService.js server/services/creativeWorkflows.js server/routes/creativeWorkflows.js tests/test-html-video-frame-iterate-service.js tests/test-html-video-routes.js
git commit -m "feat: 增加 html-video 当前帧 AI 重写"
```

---

## Task 11: Project Edit Plan Service And Routes

**Files:**
- Create: `server/services/creative-video/html-video/htmlVideoEditModeService.js`
- Modify: `server/services/creativeWorkflows.js`
- Modify: `server/routes/creativeWorkflows.js`
- Test: `tests/test-html-video-edit-plan-service.js`
- Modify: `tests/test-html-video-routes.js`

- [ ] **Step 1: Write failing edit plan tests**

Create `tests/test-html-video-edit-plan-service.js`:

```js
const assert = require('assert/strict');

const {
  createEditPlan,
  runEditPlan,
  findEditPlan,
} = require('../server/services/creative-video/html-video/htmlVideoEditModeService');

(async () => {
  const project = {
    frames: [{ id: 'scene_01' }, { id: 'scene_02' }],
    edit_sessions: [],
  };

  const restyle = await createEditPlan({ project, instruction: '整体换成更高级的财经杂志风，文案不变。' });
  assert.equal(restyle.success, true);
  assert.equal(restyle.plan.scope, 'project');
  assert.equal(restyle.plan.mode, 'project_restyle');
  assert.equal(project.edit_sessions.length, 1);
  assert.equal(findEditPlan(project, restyle.plan.id).id, restyle.plan.id);

  const frameFix = await createEditPlan({ project, instruction: '这一帧标签遮挡了，修一下。', selectedFrameId: 'scene_02' });
  assert.equal(frameFix.plan.scope, 'frame');
  assert.equal(frameFix.plan.mode, 'frame_layout_fix');
  assert.deepEqual(frameFix.plan.affected_frames, ['scene_02']);

  const projectLayoutSweep = await createEditPlan({ project, instruction: '整体每一帧都检查遮挡和标签错位。', selectedFrameId: 'scene_02' });
  assert.equal(projectLayoutSweep.plan.scope, 'project');
  assert.equal(projectLayoutSweep.plan.mode, 'project_restyle');
  assert.deepEqual(projectLayoutSweep.plan.affected_frames, ['scene_01', 'scene_02']);

  const format = await createEditPlan({ project, instruction: '每帧短一点，节奏快一点。' });
  assert.equal(format.plan.mode, 'project_iterate_format');

  const content = await createEditPlan({ project, instruction: '把内容改成讲融资。' });
  assert.equal(content.plan.mode, 'project_iterate_content');

  const run = await runEditPlan({ project, planId: restyle.plan.id });
  assert.equal(run.success, true);
  assert.equal(findEditPlan(project, restyle.plan.id).status, 'running');

  const missing = await runEditPlan({ project, planId: 'missing' });
  assert.equal(missing.success, false);
  assert.equal(missing.code, 'EDIT_PLAN_NOT_FOUND');

  console.log('html-video edit plan service tests passed');
})();
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
node tests/test-html-video-edit-plan-service.js
```

Expected: missing module.

- [ ] **Step 3: Implement `htmlVideoEditModeService.js`**

Create:

```js
function timestamp() {
  return new Date().toISOString();
}

function nextPlanId(project) {
  const sessions = Array.isArray(project.edit_sessions) ? project.edit_sessions : [];
  return `edit_plan_${String(sessions.length + 1).padStart(4, '0')}`;
}

function ensureSessions(project) {
  if (!Array.isArray(project.edit_sessions)) project.edit_sessions = [];
  return project.edit_sessions;
}

function frameIds(project) {
  return (Array.isArray(project.frames) ? project.frames : []).map(frame => frame.id || frame.scene_id || frame.sceneId || frame.graph_node_id || frame.graphNodeId).filter(Boolean);
}

function classifyInstruction(instruction, selectedFrameId) {
  const text = String(instruction || '');
  const isProject = /整体|全片|每一帧|全局|全部/.test(text);
  if (/短一点|快一点|慢一点|节奏|时长|每帧/.test(text)) return { scope: 'project', mode: 'project_iterate_format' };
  if (/内容|主题|改成|换成讲|融资|重写文案/.test(text)) return { scope: 'project', mode: 'project_iterate_content' };
  if (/风格|视觉|高级|杂志/.test(text) || isProject) return { scope: 'project', mode: 'project_restyle' };
  if (selectedFrameId && /(这|当前|本).{0,4}帧/.test(text)) return { scope: 'frame', mode: 'frame_layout_fix' };
  if (selectedFrameId && /遮挡|错位|越界|标签|文字/.test(text)) return { scope: 'frame', mode: 'frame_layout_fix' };
  return { scope: selectedFrameId ? 'frame' : 'project', mode: selectedFrameId ? 'frame_layout_fix' : 'project_restyle', ambiguous: true };
}

async function createEditPlan({ project, instruction = '', selectedFrameId = '' } = {}) {
  const sessions = ensureSessions(project);
  const classification = classifyInstruction(instruction, selectedFrameId);
  const affectedFrames = classification.scope === 'frame' && selectedFrameId ? [selectedFrameId] : frameIds(project);
  const now = timestamp();
  const plan = {
    id: nextPlanId(project),
    kind: 'edit_plan',
    scope: classification.scope,
    mode: classification.mode,
    instruction,
    status: 'planned',
    requires_confirmation: true,
    affected_frames: affectedFrames,
    ambiguous: classification.ambiguous === true,
    created_at: now,
    updated_at: now,
  };
  sessions.push(plan);
  return {
    success: true,
    plan,
    choices: classification.ambiguous ? [
      { mode: 'project_restyle', label: '只改风格', description: '保留文字和结构，重写视觉。' },
      { mode: 'project_iterate_content', label: '改内容', description: '重新规划每帧内容和文案。' },
      { mode: 'project_iterate_format', label: '调节奏', description: '调整帧数、时长和节奏。' },
    ] : [],
  };
}

function findEditPlan(project, planId) {
  const id = String(planId || '').trim();
  return ensureSessions(project).find(session => session.kind === 'edit_plan' && session.id === id) || null;
}

async function runEditPlan({ project, planId } = {}) {
  const plan = findEditPlan(project, planId);
  if (!plan) return { success: false, code: 'EDIT_PLAN_NOT_FOUND', message: '未找到编辑计划。' };
  plan.status = 'running';
  plan.updated_at = timestamp();
  return { success: true, plan, message: '编辑计划已开始执行。' };
}

module.exports = {
  createEditPlan,
  runEditPlan,
  findEditPlan,
  classifyInstruction,
};
```

- [ ] **Step 4: Run edit plan service tests**

```powershell
node tests/test-html-video-edit-plan-service.js
```

Expected: service tests pass.

- [ ] **Step 5: Add workflow and routes**

In `creativeWorkflows.js`, add functions:

```js
async function createHtmlVideoProjectEditPlan(workflowId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const editModeService = options.htmlVideoEditModeService || require('./creative-video/html-video/htmlVideoEditModeService');
  const result = await editModeService.createEditPlan({
    project,
    instruction: payload.instruction,
    selectedFrameId: payload.selected_frame_id || payload.selectedFrameId,
  });
  if (!result.success) return { ...result, workflow_id: workflowId };
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return { ...result, workflow_id: workflowId, html_video_project: saved, html_video_project_path: projectDir };
}

async function runHtmlVideoProjectEditPlan(workflowId, planId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const editModeService = options.htmlVideoEditModeService || require('./creative-video/html-video/htmlVideoEditModeService');
  const result = await editModeService.runEditPlan({
    project,
    planId,
    confirm: payload.confirm === true,
  });
  if (!result.success) return { ...result, workflow_id: workflowId, plan_id: planId };
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return { ...result, workflow_id: workflowId, plan_id: planId, html_video_project: saved, html_video_project_path: projectDir };
}
```

Export both methods from the service module.

In routes add:

```js
router.post('/:workflow_id/html-video-project/edit-plan', async (req, res) => {
  const workflowId = String(req.params.workflow_id || '').trim();
  try {
    const result = await getService(req).createHtmlVideoProjectEditPlan(workflowId, req.body || {});
    if (!result?.success) {
      const message = result?.message || '生成编辑计划失败。';
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, message, code: result?.code });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, workflow_id: workflowId, message: `生成编辑计划失败：${error.message}` });
  }
});

router.post('/:workflow_id/html-video-project/edit-plan/:plan_id/run', async (req, res) => {
  const workflowId = String(req.params.workflow_id || '').trim();
  const planId = String(req.params.plan_id || '').trim();
  try {
    const result = await getService(req).runHtmlVideoProjectEditPlan(workflowId, planId, req.body || {});
    if (!result?.success) {
      const message = result?.message || '执行编辑计划失败。';
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, plan_id: planId, message, code: result?.code });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, workflow_id: workflowId, plan_id: planId, message: `执行编辑计划失败：${error.message}` });
  }
});
```

- [ ] **Step 6: Extend route tests**

In `tests/test-html-video-routes.js` fake service, add:

```js
    createHtmlVideoProjectEditPlan: async (id, payload) => {
      calls.push(['create-edit-plan', id, payload.instruction || '']);
      return {
        success: true,
        workflow_id: id,
        plan: { id: 'edit_plan_0001', status: 'planned', affected_frames: ['frame_01'] },
        message: '编辑计划已生成。',
      };
    },
    runHtmlVideoProjectEditPlan: async (id, planId, payload) => {
      calls.push(['run-edit-plan', id, planId, payload.confirm === true]);
      return {
        success: true,
        workflow_id: id,
        plan_id: planId,
        plan: { id: planId, status: 'running' },
        message: '编辑计划已开始执行。',
      };
    },
```

Add assertions:

```js
    const editPlan = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/edit-plan`, {
      instruction: '全片改成财经杂志风',
    });
    assert.equal(editPlan.statusCode, 200);
    assert.equal(editPlan.body.plan.id, 'edit_plan_0001');

    const runPlan = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/edit-plan/edit_plan_0001/run`, {
      confirm: true,
    });
    assert.equal(runPlan.statusCode, 200);
    assert.equal(runPlan.body.plan.status, 'running');
    assert.deepEqual(calls.find(call => call[0] === 'run-edit-plan'), ['run-edit-plan', workflowId, 'edit_plan_0001', true]);
```

- [ ] **Step 7: Run tests**

```powershell
node tests/test-html-video-edit-plan-service.js
node tests/test-html-video-routes.js
```

Expected: both pass.

- [ ] **Step 8: Commit**

```powershell
git add server/services/creative-video/html-video/htmlVideoEditModeService.js server/services/creativeWorkflows.js server/routes/creativeWorkflows.js tests/test-html-video-edit-plan-service.js tests/test-html-video-routes.js
git commit -m "feat: 增加 html-video 全片编辑计划"
```

---

## Task 12: Execute Project Edit Plans

**Files:**
- Modify: `server/services/creative-video/html-video/htmlVideoEditModeService.js`
- Modify: `server/services/creativeWorkflows.js`
- Modify: `server/routes/creativeWorkflows.js`
- Modify: `tests/test-html-video-edit-plan-service.js`
- Modify: `tests/test-html-video-routes.js`

- [ ] **Step 1: Write failing execution tests**

In `tests/test-html-video-edit-plan-service.js`, replace the old Task 11 assertion that expected `runEditPlan()` to only set `status = 'running'`:

```js
  const run = await runEditPlan({ project, planId: restyle.plan.id });
  assert.equal(run.success, true);
  assert.equal(findEditPlan(project, restyle.plan.id).status, 'running');
```

with this missing-service guard:

```js
  const missingRunner = await runEditPlan({ project, planId: restyle.plan.id });
  assert.equal(missingRunner.success, false);
  assert.equal(missingRunner.code, 'EDIT_PLAN_ITERATE_SERVICE_MISSING');
```

Then add the real execution assertions:

```js
  const executedProject = {
    frames: [
      { id: 'scene_01', source_mode: 'raw_html', html_path: 'frames/scene_01.html' },
      { id: 'scene_02', source_mode: 'raw_html', html_path: 'frames/scene_02.html' },
    ],
    edit_sessions: [],
  };
  const planResult = await createEditPlan({ project: executedProject, instruction: '全片修复文字遮挡。' });
  const iterateCalls = [];
  const qaCalls = [];
  const execution = await runEditPlan({
    projectDir: '/tmp/html-video-project',
    project: executedProject,
    planId: planResult.plan.id,
    iterateService: {
      iterateFrameHtml: async ({ frameId, instruction, mode }) => {
        iterateCalls.push([frameId, instruction, mode]);
        return {
          success: true,
          draft: { id: `draft_${frameId}`, html_path: `frames/.drafts/${frameId}/draft_${frameId}.html` },
        };
      },
    },
    layoutQaService: {
      inspectFrameHtmlLayout: async ({ frame }) => {
        qaCalls.push(frame.id);
        return { success: true, issues: [], metrics: { frame_id: frame.id } };
      },
    },
  });
  assert.equal(execution.success, true);
  assert.equal(execution.plan.status, 'drafts_ready');
  assert.deepEqual(iterateCalls.map(call => call[0]), ['scene_01', 'scene_02']);
  assert.deepEqual(qaCalls, ['scene_01', 'scene_02']);
  assert.deepEqual(execution.plan.generated_drafts.map(item => item.draft_id), ['draft_scene_01', 'draft_scene_02']);

  const acceptCalls = [];
  const accepted = await acceptEditPlanDrafts({
    projectDir: '/tmp/html-video-project',
    project: executedProject,
    planId: planResult.plan.id,
    frameHtmlEditService: {
      acceptFrameDraft: async ({ frameId, draftId }) => {
        acceptCalls.push([frameId, draftId]);
        return { success: true };
      },
    },
  });
  assert.equal(accepted.success, true);
  assert.equal(accepted.plan.status, 'accepted');
  assert.deepEqual(acceptCalls, [['scene_01', 'draft_scene_01'], ['scene_02', 'draft_scene_02']]);

  const discardPlan = await createEditPlan({ project: executedProject, instruction: '全片修复标签遮挡。' });
  discardPlan.plan.generated_drafts = [{ frame_id: 'scene_01', draft_id: 'draft_discard_01' }];
  const discardCalls = [];
  const discarded = await discardEditPlanDrafts({
    project: executedProject,
    planId: discardPlan.plan.id,
    frameHtmlEditService: {
      discardFrameDraft: async ({ frameId, draftId }) => {
        discardCalls.push([frameId, draftId]);
        return { success: true };
      },
    },
  });
  assert.equal(discarded.success, true);
  assert.equal(discarded.plan.status, 'discarded');
  assert.deepEqual(discardCalls, [['scene_01', 'draft_discard_01']]);
```

Update the import at the top:

```js
const {
  createEditPlan,
  runEditPlan,
  findEditPlan,
  acceptEditPlanDrafts,
  discardEditPlanDrafts,
} = require('../server/services/creative-video/html-video/htmlVideoEditModeService');
```

- [ ] **Step 2: Run test and verify RED**

```powershell
node tests/test-html-video-edit-plan-service.js
```

Expected: fails because `acceptEditPlanDrafts` and `discardEditPlanDrafts` are not exported, and `runEditPlan` does not generate drafts.

- [ ] **Step 3: Implement real plan execution**

In `htmlVideoEditModeService.js`, require the shared frame lookup helper, then replace `runEditPlan` and add helpers:

```js
const { findFrameByAnyId } = require('./frameIdentity');

function normalizeGeneratedDraft(result, frameId) {
  const draft = result && result.draft;
  if (!draft || !draft.id) return null;
  return {
    frame_id: frameId,
    draft_id: draft.id,
    html_path: draft.html_path || '',
    status: 'ready',
  };
}

async function runEditPlan({ projectDir, project, planId, iterateService, layoutQaService } = {}) {
  const plan = findEditPlan(project, planId);
  if (!plan) return { success: false, code: 'EDIT_PLAN_NOT_FOUND', message: '未找到编辑计划。' };
  if (!iterateService || typeof iterateService.iterateFrameHtml !== 'function') {
    return { success: false, code: 'EDIT_PLAN_ITERATE_SERVICE_MISSING', message: '缺少执行编辑计划所需的帧重写服务。' };
  }
  plan.status = 'running';
  plan.updated_at = timestamp();
  plan.generated_drafts = [];
  plan.execution_errors = [];
  plan.layout_qa_reports = [];

  for (const frameId of plan.affected_frames || []) {
    const result = await iterateService.iterateFrameHtml({
      projectDir,
      project,
      frameId,
      instruction: plan.instruction,
      mode: plan.mode,
      preserveText: true,
    });
    if (!result.success) {
      plan.execution_errors.push({ frame_id: frameId, code: result.code || 'FRAME_ITERATE_FAILED', message: result.message || '当前帧重写失败。' });
      continue;
    }
    const generated = normalizeGeneratedDraft(result, frameId);
    if (generated) plan.generated_drafts.push(generated);

    if (layoutQaService && typeof layoutQaService.inspectFrameHtmlLayout === 'function' && generated?.html_path) {
      const frame = findFrameByAnyId(project, frameId);
      if (frame) {
        const qa = await layoutQaService.inspectFrameHtmlLayout({
          htmlPath: require('path').join(projectDir, generated.html_path),
          frame: { ...frame, html_path: generated.html_path },
          resolution: project.output?.resolution || { width: 1920, height: 1080 },
          durationSec: frame.duration_sec,
        });
        plan.layout_qa_reports.push({ frame_id: frameId, ...qa });
      }
    }
  }

  plan.status = plan.execution_errors.length ? 'failed' : 'drafts_ready';
  plan.updated_at = timestamp();
  return {
    success: plan.status === 'drafts_ready',
    plan,
    generated_drafts: plan.generated_drafts,
    layout_qa_reports: plan.layout_qa_reports,
    message: plan.status === 'drafts_ready' ? '编辑计划已生成批量草稿。' : '编辑计划执行失败，请查看失败帧。',
  };
}

async function acceptEditPlanDrafts({ projectDir, project, planId, frameHtmlEditService } = {}) {
  const plan = findEditPlan(project, planId);
  if (!plan) return { success: false, code: 'EDIT_PLAN_NOT_FOUND', message: '未找到编辑计划。' };
  for (const item of plan.generated_drafts || []) {
    const result = await frameHtmlEditService.acceptFrameDraft({ projectDir, project, frameId: item.frame_id, draftId: item.draft_id });
    if (!result.success) return { ...result, plan };
  }
  plan.status = 'accepted';
  plan.updated_at = timestamp();
  return { success: true, plan, message: '编辑计划草稿已批量接受。' };
}

async function discardEditPlanDrafts({ project, planId, frameHtmlEditService } = {}) {
  const plan = findEditPlan(project, planId);
  if (!plan) return { success: false, code: 'EDIT_PLAN_NOT_FOUND', message: '未找到编辑计划。' };
  for (const item of plan.generated_drafts || []) {
    const result = await frameHtmlEditService.discardFrameDraft({ project, frameId: item.frame_id, draftId: item.draft_id });
    if (!result.success) return { ...result, plan };
  }
  plan.status = 'discarded';
  plan.updated_at = timestamp();
  return { success: true, plan, message: '编辑计划草稿已批量放弃。' };
}
```

Export `acceptEditPlanDrafts` and `discardEditPlanDrafts`.

- [ ] **Step 4: Wire workflow service execution**

In `creativeWorkflows.js`, update `runHtmlVideoProjectEditPlan()` so it passes real services:

```js
  const result = await editModeService.runEditPlan({
    projectDir,
    project,
    planId,
    confirm: payload.confirm === true,
    iterateService: options.htmlVideoIterateService || require('./creative-video/html-video/htmlVideoIterateService'),
    layoutQaService: options.layoutQaService || require('./creative-video/html-video/layoutQaService'),
  });
```

Add workflow methods:

```js
async function acceptHtmlVideoProjectEditPlan(workflowId, planId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const editModeService = options.htmlVideoEditModeService || require('./creative-video/html-video/htmlVideoEditModeService');
  const result = await editModeService.acceptEditPlanDrafts({
    projectDir,
    project,
    planId,
    frameHtmlEditService: options.frameHtmlEditService || frameHtmlEditService,
  });
  if (!result.success) return { ...result, workflow_id: workflowId, plan_id: planId };
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return { ...result, workflow_id: workflowId, plan_id: planId, html_video_project: saved, html_video_project_path: projectDir };
}

async function discardHtmlVideoProjectEditPlan(workflowId, planId, payload = {}, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const { project, projectDir, error } = await loadWorkflowWithHtmlVideoProject(workflowId, rootDir);
  if (error) return error;
  const editModeService = options.htmlVideoEditModeService || require('./creative-video/html-video/htmlVideoEditModeService');
  const result = await editModeService.discardEditPlanDrafts({
    project,
    planId,
    frameHtmlEditService: options.frameHtmlEditService || frameHtmlEditService,
  });
  if (!result.success) return { ...result, workflow_id: workflowId, plan_id: planId };
  const saved = await htmlVideoProjectStore.saveProject(projectDir, project);
  return { ...result, workflow_id: workflowId, plan_id: planId, html_video_project: saved, html_video_project_path: projectDir };
}
```

Export both methods.

- [ ] **Step 5: Add accept/discard plan routes and route tests**

In `tests/test-html-video-routes.js`, replace the Task 11 fake `runHtmlVideoProjectEditPlan` return value with a draft-producing result:

```js
    runHtmlVideoProjectEditPlan: async (id, planId, payload) => {
      calls.push(['run-edit-plan', id, planId, payload.confirm === true]);
      return {
        success: true,
        workflow_id: id,
        plan_id: planId,
        plan: {
          id: planId,
          status: 'drafts_ready',
          generated_drafts: [{ frame_id: 'frame_01', draft_id: 'draft_frame_01' }],
        },
        message: '编辑计划已生成批量草稿。',
      };
    },
```

Update the run assertion:

```js
    assert.equal(runPlan.body.plan.status, 'drafts_ready');
    assert.equal(runPlan.body.plan.generated_drafts[0].draft_id, 'draft_frame_01');
```

Then add fake accept/discard service methods:

```js
    acceptHtmlVideoProjectEditPlan: async (id, planId) => {
      calls.push(['accept-edit-plan', id, planId]);
      return { success: true, workflow_id: id, plan_id: planId, plan: { id: planId, status: 'accepted' }, message: '编辑计划草稿已批量接受。' };
    },
    discardHtmlVideoProjectEditPlan: async (id, planId) => {
      calls.push(['discard-edit-plan', id, planId]);
      return { success: true, workflow_id: id, plan_id: planId, plan: { id: planId, status: 'discarded' }, message: '编辑计划草稿已批量放弃。' };
    },
```

Add assertions:

```js
    const acceptPlan = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/edit-plan/edit_plan_0001/accept`, {});
    assert.equal(acceptPlan.statusCode, 200);
    assert.equal(acceptPlan.body.plan.status, 'accepted');

    const discardPlan = await requestJson(server, 'POST', `/api/creative-workflows/${workflowId}/html-video-project/edit-plan/edit_plan_0001/discard`, {});
    assert.equal(discardPlan.statusCode, 200);
    assert.equal(discardPlan.body.plan.status, 'discarded');
```

Add routes before reserved routes:

```js
router.post('/:workflow_id/html-video-project/edit-plan/:plan_id/accept', async (req, res) => {
  const workflowId = String(req.params.workflow_id || '').trim();
  const planId = String(req.params.plan_id || '').trim();
  try {
    const result = await getService(req).acceptHtmlVideoProjectEditPlan(workflowId, planId, req.body || {});
    if (!result?.success) {
      const message = result?.message || '接受编辑计划草稿失败。';
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, plan_id: planId, message, code: result?.code });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, workflow_id: workflowId, plan_id: planId, message: `接受编辑计划草稿失败：${error.message}` });
  }
});

router.post('/:workflow_id/html-video-project/edit-plan/:plan_id/discard', async (req, res) => {
  const workflowId = String(req.params.workflow_id || '').trim();
  const planId = String(req.params.plan_id || '').trim();
  try {
    const result = await getService(req).discardHtmlVideoProjectEditPlan(workflowId, planId, req.body || {});
    if (!result?.success) {
      const message = result?.message || '放弃编辑计划草稿失败。';
      return res.status(getStatusCode(result)).json({ success: false, workflow_id: workflowId, plan_id: planId, message, code: result?.code });
    }
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, workflow_id: workflowId, plan_id: planId, message: `放弃编辑计划草稿失败：${error.message}` });
  }
});
```

- [ ] **Step 6: Run tests**

```powershell
node tests/test-html-video-edit-plan-service.js
node tests/test-html-video-routes.js
```

Expected: edit-plan execution generates drafts, layout QA reports are recorded on the plan, and bulk accept/discard routes pass.

- [ ] **Step 7: Commit**

```powershell
git add server/services/creative-video/html-video/htmlVideoEditModeService.js server/services/creativeWorkflows.js server/routes/creativeWorkflows.js tests/test-html-video-edit-plan-service.js tests/test-html-video-routes.js
git commit -m "feat: 执行 html-video 全片编辑计划"
```

---

## Task 13: AI Edit UI And Plan UI

**Files:**
- Create: `frontend-react/src/components/creative-video-editor/HtmlVideoAiEditPanel.jsx`
- Modify: `frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx`
- Modify: `tests/test-html-video-editor-components.mjs`

- [ ] **Step 1: Write failing component assertions**

In `tests/test-html-video-editor-components.mjs`, add:

```js
const aiPanel = fs.readFileSync('frontend-react/src/components/creative-video-editor/HtmlVideoAiEditPanel.jsx', 'utf-8');
assert.ok(aiPanel.includes('AI 修改'), 'AI panel should show Chinese title');
assert.ok(aiPanel.includes('修复布局'), 'AI panel should support layout fix mode');
assert.ok(aiPanel.includes('生成当前帧草稿'), 'AI panel should generate frame drafts');
assert.ok(aiPanel.includes('生成全片编辑计划'), 'AI panel should create project edit plans');
assert.ok(aiPanel.includes('执行全片编辑计划'), 'AI panel should run project edit plans');
assert.ok(aiPanel.includes('接受计划草稿'), 'AI panel should accept generated plan drafts');
assert.ok(aiPanel.includes('放弃计划草稿'), 'AI panel should discard generated plan drafts');
assert.ok(editor.includes('HtmlVideoAiEditPanel'), 'HtmlVideoProjectEditor should compose AI edit panel');
```

- [ ] **Step 2: Run test and verify RED**

```powershell
node tests/test-html-video-editor-components.mjs
```

Expected: missing component.

- [ ] **Step 3: Implement `HtmlVideoAiEditPanel.jsx`**

Create:

```jsx
import { useState } from 'react';

export function HtmlVideoAiEditPanel({ frame, editPlan, disabled, onIterateFrame, onCreatePlan, onRunPlan, onAcceptPlan, onDiscardPlan }) {
  const [frameInstruction, setFrameInstruction] = useState('');
  const [projectInstruction, setProjectInstruction] = useState('');
  const [mode, setMode] = useState('layout_fix');
  const [preserveText, setPreserveText] = useState(true);
  const frameId = frame?.id || frame?.scene_id || '';

  return (
    <section className="creative-video-editor-panel html-video-ai-edit-panel">
      <div className="creative-video-editor-panel-header">
        <h3>AI 修改</h3>
      </div>
      <div className="html-video-ai-edit-section">
        <h4>当前帧</h4>
        <select value={mode} disabled={disabled} onChange={event => setMode(event.target.value)}>
          <option value="layout_fix">修复布局</option>
          <option value="visual_rewrite">重写视觉</option>
          <option value="content_rewrite">改写内容</option>
          <option value="style_match">匹配风格</option>
        </select>
        <label>
          <input type="checkbox" checked={preserveText} disabled={disabled} onChange={event => setPreserveText(event.target.checked)} />
          保留当前文案
        </label>
        <textarea rows={3} value={frameInstruction} disabled={disabled} placeholder="例如：修复右侧标签遮挡正文的问题，保留现有文案。" onChange={event => setFrameInstruction(event.target.value)} />
        <button type="button" disabled={disabled || !frameId || !frameInstruction.trim()} onClick={() => onIterateFrame(frameId, {
          instruction: frameInstruction,
          mode,
          preserve_text: preserveText,
          run_layout_qa: true,
          render_preview: true,
        })}>生成当前帧草稿</button>
      </div>
      <div className="html-video-ai-edit-section">
        <h4>全片</h4>
        <textarea rows={3} value={projectInstruction} disabled={disabled} placeholder="例如：整体换成更高级的财经杂志风，文案不变。" onChange={event => setProjectInstruction(event.target.value)} />
        <button type="button" disabled={disabled || !projectInstruction.trim()} onClick={() => onCreatePlan({ instruction: projectInstruction, selected_frame_id: frameId })}>生成全片编辑计划</button>
        {editPlan ? (
          <div className="html-video-edit-plan">
            <p>{editPlan.summary || editPlan.mode || editPlan.id}</p>
            <button type="button" disabled={disabled} onClick={() => onRunPlan(editPlan.id, { confirm: true })}>执行全片编辑计划</button>
            <button type="button" disabled={disabled || editPlan.status !== 'drafts_ready'} onClick={() => onAcceptPlan(editPlan.id)}>接受计划草稿</button>
            <button type="button" disabled={disabled || !editPlan.generated_drafts?.length} onClick={() => onDiscardPlan(editPlan.id)}>放弃计划草稿</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire AI panel in editor**

Import and render:

```jsx
import { HtmlVideoAiEditPanel } from './HtmlVideoAiEditPanel.jsx';
```

```jsx
<HtmlVideoAiEditPanel
  frame={selectedFrame}
  editPlan={editor.editPlan}
  disabled={disabled}
  onIterateFrame={editor.iterateFrame}
  onCreatePlan={editor.createEditPlan}
  onRunPlan={editor.runEditPlan}
  onAcceptPlan={editor.acceptEditPlan}
  onDiscardPlan={editor.discardEditPlan}
/>
```

- [ ] **Step 5: Run component tests**

```powershell
node tests/test-html-video-editor-components.mjs
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add frontend-react/src/components/creative-video-editor/HtmlVideoAiEditPanel.jsx frontend-react/src/components/creative-video-editor/HtmlVideoProjectEditor.jsx tests/test-html-video-editor-components.mjs
git commit -m "feat: 增加 html-video AI 二次编辑面板"
```

---

## Task 14: Final Integration Verification

**Files:**
- Modify only if tests reveal small contract mismatches.

- [ ] **Step 1: Run focused html-video test set**

Run:

```powershell
node tests/test-html-video-project-schema-secondary-editing.js
node tests/test-html-video-draft-service.js
node tests/test-html-video-frame-html-edit-service.js
node tests/test-html-video-frame-preview-draft.js
node tests/test-html-video-layout-qa-service.js
node tests/test-html-video-frame-iterate-service.js
node tests/test-html-video-edit-plan-service.js
node tests/test-html-video-routes.js
node tests/test-html-video-api-client.mjs
node tests/test-html-video-editor-components.mjs
```

Expected: all pass.

- [ ] **Step 2: Run broader html-video regression tests**

Run:

```powershell
npm run test:filter -- html-video
```

If `tests/run-all.js` does not support filtering by argument, run:

```powershell
npm test
```

Expected: no new failures. If unrelated pre-existing failures occur, capture the exact failing test names and stderr.

- [ ] **Step 3: Manual workflow smoke test with latest raw HTML project**

Find the latest generated html-video project that contains at least one `raw_html` frame:

```powershell
$latestProject = Get-ChildItem -Path data -Recurse -Filter project.json |
  Sort-Object LastWriteTime -Descending |
  Where-Object {
    try {
      $project = Get-Content -Encoding UTF8 $_.FullName | ConvertFrom-Json
      @($project.frames | Where-Object { $_.source_mode -eq 'raw_html' }).Count -gt 0
    } catch {
      $false
    }
  } |
  Select-Object -First 1

$latestProject.DirectoryName
```

If this command prints no path, generate one html-video project first, then rerun the command.

Manual API smoke sequence:

1. Load project in UI.
2. Select `scene_06`.
3. Load Source Tab.
4. Save source as draft without accepting.
5. Render draft preview.
6. Run layout QA.
7. Discard draft.
8. Confirm formal frame HTML is unchanged.

Do not manually edit production data during automated test work unless the user explicitly asks to repair that video.

- [ ] **Step 4: Final commit if integration fixes were needed**

If Step 1/2 required small fixes:

```powershell
git add <changed-files>
git commit -m "test: 验证 html-video 二次编辑流程"
```

If no fixes were needed, do not create an empty commit.

---

## Review Checklist For Subagents

Before handing a task back:

- [ ] Branch is `dev`.
- [ ] No unrelated files changed.
- [ ] New user-visible strings are Chinese.
- [ ] PowerShell file reads used `-Encoding UTF8`.
- [ ] New production code has failing test first.
- [ ] `mode=replace` is not exposed.
- [ ] Draft preview does not mutate formal frame `html_path`.
- [ ] `findFrameByAnyId` is used in new frame-facing services.
- [ ] Edit plan is persisted in `project.edit_sessions`.
- [ ] Layout QA tests use hand-written fixtures.
- [ ] Commands run and results recorded in handoff.

## Expected Final User-Visible Capabilities

After all tasks:

- Users can read current raw HTML frame source.
- Users can save current frame source as draft.
- Users can render draft preview.
- Users can accept or discard a draft.
- Users can run DOM layout QA and see issues.
- Users can ask AI to rewrite only the current frame.
- Users can create and run full-project edit plans.
- Users can review, bulk accept, or bulk discard drafts generated by a full-project edit plan.
- Official export uses only accepted frame HTML by default.
- Export-time QA gate remains out of scope for this plan.
