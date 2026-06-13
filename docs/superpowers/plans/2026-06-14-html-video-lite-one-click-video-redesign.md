# HTML-Video Lite One-Click Video Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deprecated bare HTML composer path with an html-video lite pipeline that generates `scene_spec` and `frame_specs`, renders them through registered HyperFrames templates, performs visual QA, and exposes a componentized post-generation editor.

**Architecture:** AI generation is split into two JSON-only calls: `scene_spec` first, then `frame_specs`. Backend services are separated into schema/domain logic, prompt/parse logic, template registry, HyperFrames renderer, render adapter, visual QA, workflow facade, and routes. Frontend editing is isolated behind a hook and small components; `OneClickCreativePage.jsx` remains a workflow shell.

**Tech Stack:** Node.js CommonJS services, Express routes, React 19 hooks/components, HyperFrames CLI, ffmpeg, existing `node tests/*.js` and `node tests/*.mjs` style.

---

## Execution Rules

- Execute on `dev` only.
- Use Subagent-Driven execution when available.
- Complete one task, run its tests, commit, then stop for review.
- Do not continue from `docs/superpowers/plans/2026-06-13-one-click-video-editable-output.md`; it is deprecated.
- Do not repair the old bare HTML composer as a production path.
- Do not add large logic blocks to `agentRuns.js`, `creativeWorkflows.js`, or `OneClickCreativePage.jsx`.
- User-facing messages must be Chinese.
- Every API-triggering UI action must expose loading, disabled state, success feedback, and failure feedback.

---

## File Structure

Backend create:

- `server/services/creative-video/specEnums.js`: shared enum constants for kind/template/layout/background/motion/visual layer types.
- `server/services/creative-video/sceneSpecService.js`: pure `scene_spec` normalize/validate/edit logic.
- `server/services/creative-video/frameSpecService.js`: pure `frame_specs` normalize/validate/retime logic.
- `server/services/creative-video/creativeSpecAgent.js`: two-call prompt builders and parsers.
- `server/services/creative-video/templateRegistry.js`: registered template metadata and CSS/GSAP token maps.
- `server/services/creative-video/hyperframesTemplateRenderer.js`: `scene_spec + frame_specs -> HyperFrames files`.
- `server/services/creative-video/renderAdapter.js`: default adapter around existing HyperFrames renderer.
- `server/services/creative-video/visualQaService.js`: frame extraction result analysis and visual failure thresholds.
- `server/services/creative-video/projectWriter.js`: safe project directory writing.
- `server/services/creative-video/workflowFacade.js`: orchestration boundary for one-click creative video.

Backend modify:

- `server/services/agentRuns.js`: delegate project generation to `workflowFacade`, keep legacy exports stable.
- `server/services/creativeWorkflows.js`: call the facade instead of embedding scene/frame/render logic.
- `server/routes/creativeWorkflows.js`: add thin HTTP wrappers for specs, edits, rerender, remix.
- `package.json`: register new tests.

Frontend create:

- `frontend-react/src/hooks/useCreativeVideoEditor.js`
- `frontend-react/src/components/creative-video-editor/CreativeVideoEditor.jsx`
- `frontend-react/src/components/creative-video-editor/SceneList.jsx`
- `frontend-react/src/components/creative-video-editor/SceneEditPanel.jsx`
- `frontend-react/src/components/creative-video-editor/FrameList.jsx`
- `frontend-react/src/components/creative-video-editor/FrameEditPanel.jsx`
- `frontend-react/src/components/creative-video-editor/CaptionEditor.jsx`
- `frontend-react/src/components/creative-video-editor/VisualTextEditor.jsx`
- `frontend-react/src/components/creative-video-editor/RenderVersionPanel.jsx`
- `frontend-react/src/components/creative-video-editor/EditorStatusBar.jsx`

Frontend modify:

- `frontend-react/src/api/client.js`
- `frontend-react/src/pages/OneClickCreativePage.jsx`
- `frontend-react/src/styles.css`

Tests create:

- `tests/test-creative-video-spec-enums.js`
- `tests/test-creative-video-scene-spec.js`
- `tests/test-creative-video-frame-spec.js`
- `tests/test-creative-spec-agent.js`
- `tests/test-creative-template-registry.js`
- `tests/test-hyperframes-template-renderer.js`
- `tests/test-creative-render-adapter.js`
- `tests/test-visual-qa-service.js`
- `tests/test-creative-video-project-writer.js`
- `tests/test-creative-video-workflow-facade.js`
- `tests/test-creative-video-editor-components.mjs`

Tests modify:

- `tests/test-agent-runs.js`
- `tests/test-creative-workflows.js`
- `tests/test-creative-workflow-routes.js`
- `tests/test-creative-api-client.mjs`
- `tests/test-one-click-creative-page.mjs`

---

### Task 1: Shared Enums And Scene Spec Service

**Files:**
- Create: `server/services/creative-video/specEnums.js`
- Create: `server/services/creative-video/sceneSpecService.js`
- Create: `tests/test-creative-video-spec-enums.js`
- Create: `tests/test-creative-video-scene-spec.js`
- Modify: `package.json`

- [ ] **Step 1: Write enum tests**

Create `tests/test-creative-video-spec-enums.js`:

```js
const assert = require('assert');
const enums = require('../server/services/creative-video/specEnums');

assert.deepEqual(enums.KINDS, ['text', 'data', 'quote', 'steps', 'comparison', 'cta']);
assert.ok(enums.TEMPLATES.includes('hero_title'));
assert.ok(enums.TEMPLATES.includes('data_cards'));
assert.ok(enums.LAYOUTS.includes('center_stack'));
assert.ok(enums.BACKGROUNDS.includes('dark_gradient'));
assert.ok(enums.MOTIONS.includes('fade_up'));
assert.ok(enums.VISUAL_LAYER_TYPES.includes('glow_panel'));
assert.equal(enums.isAllowedKind('text'), true);
assert.equal(enums.isAllowedKind('freeform'), false);

console.log('creative video spec enum tests passed');
```

- [ ] **Step 2: Write scene spec tests**

Create `tests/test-creative-video-scene-spec.js`:

```js
const assert = require('assert');
const sceneSpec = require('../server/services/creative-video/sceneSpecService');

const raw = {
  title: '测试视频',
  aspect_ratio: '16:9',
  target_duration_sec: 20,
  scenes: [
    {
      id: 'scene_01',
      duration: 8.345,
      kind: 'text',
      narration_text: '第一段旁白',
      captions: [{ id: 'cap_01_01', start: 0, end: 2.2, text: '第一句字幕' }],
      visual_text: {
        headline: '第一幕',
        keywords: ['重点'],
        cards: ['观众可见卡片'],
      },
    },
    {
      id: 'scene_02',
      duration: 6,
      kind: 'cta',
      narration_text: '第二段旁白',
      captions: [],
      visual_text: { headline: '行动号召', keywords: [], cards: [] },
    },
  ],
};

const normalized = sceneSpec.normalizeSceneSpec(raw);
assert.equal(normalized.version, 1);
assert.equal(normalized.scenes[0].start, 0);
assert.equal(normalized.scenes[0].duration, 8.35);
assert.equal(normalized.scenes[1].start, 8.35);
assert.equal(normalized.scenes[0].kind, 'text');
assert.equal(sceneSpec.validateSceneSpec(normalized).success, true);

const edited = sceneSpec.applySceneEdit(normalized, {
  type: 'duration',
  scene_id: 'scene_01',
  duration: 10,
});
assert.equal(edited.scene_spec.scenes[1].start, 10);
assert.equal(edited.requires_render, true);
assert.equal(edited.requires_tts, false);

const textEdit = sceneSpec.applySceneEdit(normalized, {
  type: 'narration_text',
  scene_id: 'scene_01',
  text: '新的旁白',
});
assert.equal(textEdit.requires_tts, true);
assert.equal(textEdit.scene_spec.scenes[0].narration_text, '新的旁白');

const invalidVisualText = sceneSpec.validateSceneSpec({
  scenes: [{
    id: 'scene_01',
    duration: 3,
    kind: 'text',
    narration_text: '旁白',
    captions: [],
    visual_text: { headline: '标题', keywords: [], cards: ['深色科技背景'] },
  }],
});
assert.equal(invalidVisualText.success, false);
assert.ok(invalidVisualText.errors.some(error => error.includes('视觉描述')));

console.log('creative video scene spec tests passed');
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
node tests/test-creative-video-spec-enums.js
node tests/test-creative-video-scene-spec.js
```

Expected: both fail with missing module errors.

- [ ] **Step 4: Implement enum and scene spec services**

Create `server/services/creative-video/specEnums.js` with these exports:

```js
const KINDS = ['text', 'data', 'quote', 'steps', 'comparison', 'cta'];
const TEMPLATES = ['hero_title', 'keyword_burst', 'process_steps', 'compare_split', 'quote_focus', 'data_cards', 'cta_end'];
const LAYOUTS = ['center_stack', 'left_title_right_cards', 'three_step_grid', 'split_compare', 'bottom_caption', 'stat_focus'];
const BACKGROUNDS = ['dark_gradient', 'soft_grid', 'radial_spotlight', 'brand_blocks', 'clean_light'];
const MOTIONS = ['fade_up', 'slide_in', 'scale_pop', 'stagger_cards', 'glow_pulse', 'fade_out'];
const VISUAL_LAYER_TYPES = ['glow_panel', 'grid_lines', 'shape_blocks', 'number_counter', 'progress_bar', 'connector_lines'];

function includes(list, value) {
  return list.includes(String(value || '').trim());
}

module.exports = {
  KINDS,
  TEMPLATES,
  LAYOUTS,
  BACKGROUNDS,
  MOTIONS,
  VISUAL_LAYER_TYPES,
  isAllowedKind: value => includes(KINDS, value),
  isAllowedTemplate: value => includes(TEMPLATES, value),
  isAllowedLayout: value => includes(LAYOUTS, value),
  isAllowedBackground: value => includes(BACKGROUNDS, value),
  isAllowedMotion: value => includes(MOTIONS, value),
  isAllowedVisualLayerType: value => includes(VISUAL_LAYER_TYPES, value),
};
```

Create `server/services/creative-video/sceneSpecService.js` with pure functions only. It must not import `fs`, Express, AI services, render services, or workflow services.

Required exports:

```js
module.exports = {
  normalizeSceneSpec,
  validateSceneSpec,
  applySceneEdit,
  retimeScenes,
};
```

Required behavior:

- Normalize unknown `kind` to `text`.
- Round `duration`, `start`, `caption.start`, and `caption.end` to two decimals.
- Recalculate scene `order` and `start` in `retimeScenes`.
- Reject visual production words inside `visual_text.headline`, `visual_text.keywords`, `visual_text.cards`, `caption.text`, and `narration_text`.
- Production words list must include `背景`, `光效`, `动画`, `转场`, `布局`, `发光`, `粒子`, `镜头`.
- `applySceneEdit` supports `caption_text`, `narration_text`, `visual_text`, `duration`, and `reorder_scenes`.

- [ ] **Step 5: Run passing tests**

Run:

```bash
node tests/test-creative-video-spec-enums.js
node tests/test-creative-video-scene-spec.js
```

Expected: both pass.

- [ ] **Step 6: Register tests and commit**

Modify `package.json` so both tests run after `node tests/test-storyboard-schema.js`.

Run:

```bash
node tests/test-creative-video-spec-enums.js
node tests/test-creative-video-scene-spec.js
```

Expected: both pass.

Commit:

```bash
git add server/services/creative-video/specEnums.js server/services/creative-video/sceneSpecService.js tests/test-creative-video-spec-enums.js tests/test-creative-video-scene-spec.js package.json
git commit -m "新增创意视频场景规格服务"
```

---

### Task 2: Frame Spec Service

**Files:**
- Create: `server/services/creative-video/frameSpecService.js`
- Create: `tests/test-creative-video-frame-spec.js`
- Modify: `package.json`

- [ ] **Step 1: Write frame spec tests**

Create `tests/test-creative-video-frame-spec.js`:

```js
const assert = require('assert');
const frameSpec = require('../server/services/creative-video/frameSpecService');

const sceneSpec = {
  scenes: [
    { id: 'scene_01', order: 1, start: 0, duration: 8, kind: 'text' },
    { id: 'scene_02', order: 2, start: 8, duration: 6, kind: 'cta' },
  ],
};

const raw = {
  frames: [
    {
      id: 'frame_01_01',
      scene_id: 'scene_01',
      start: 0,
      duration: 4,
      kind: 'text',
      template: 'hero_title',
      layout: 'center_stack',
      background: 'dark_gradient',
      motion: 'fade_up',
      text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }],
      visual_layers: [{ id: 'accent_01', type: 'glow_panel', variant: 'cyan_pink' }],
    },
    {
      id: 'frame_02_01',
      scene_id: 'scene_02',
      start: 8,
      duration: 6,
      kind: 'cta',
      template: 'cta_end',
      layout: 'center_stack',
      background: 'radial_spotlight',
      motion: 'glow_pulse',
      text_layers: [{ id: 'cta', role: 'headline', text: '马上行动', emphasis: 'primary' }],
      visual_layers: [],
    },
  ],
};

const normalized = frameSpec.normalizeFrameSpecs(raw, sceneSpec);
assert.equal(normalized.frames[0].order, 1);
assert.equal(normalized.frames[0].duration, 4);
assert.equal(frameSpec.validateFrameSpecs(normalized, sceneSpec).success, true);

const invalidTemplate = frameSpec.validateFrameSpecs({
  frames: [{ ...raw.frames[0], template: 'unknown_template' }],
}, sceneSpec);
assert.equal(invalidTemplate.success, false);
assert.ok(invalidTemplate.errors.some(error => error.includes('template')));

const invalidTiming = frameSpec.validateFrameSpecs({
  frames: [{ ...raw.frames[0], start: 7, duration: 4 }],
}, sceneSpec);
assert.equal(invalidTiming.success, false);
assert.ok(invalidTiming.errors.some(error => error.includes('时间范围')));

const retimed = frameSpec.retimeFramesForScenes(normalized, {
  scenes: [
    { id: 'scene_02', order: 1, start: 0, duration: 6, kind: 'cta' },
    { id: 'scene_01', order: 2, start: 6, duration: 8, kind: 'text' },
  ],
});
assert.equal(retimed.frames[0].scene_id, 'scene_02');
assert.equal(retimed.frames[0].start, 0);
assert.equal(retimed.frames[1].scene_id, 'scene_01');
assert.equal(retimed.frames[1].start, 6);

console.log('creative video frame spec tests passed');
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node tests/test-creative-video-frame-spec.js
```

Expected: fail with missing module error.

- [ ] **Step 3: Implement frame spec service**

Create `server/services/creative-video/frameSpecService.js`.

Required exports:

```js
module.exports = {
  normalizeFrameSpecs,
  validateFrameSpecs,
  retimeFramesForScenes,
};
```

Required behavior:

- Import only `./specEnums`.
- Normalize `{ frame_specs: [...] }` and `{ frames: [...] }` into `{ frames }`.
- Ensure frame IDs are stable and unique.
- Validate `scene_id` exists.
- Validate `kind`, `template`, `layout`, `background`, `motion`, and `visual_layers[].type` against enums.
- Validate each frame has at least one `text_layers[]` item.
- Validate each frame has `background` or at least one `visual_layers[]` item.
- Validate frame timing stays inside its scene.
- `retimeFramesForScenes` sorts frames by scene order and local order, then resets `start` to the scene start plus the frame's local offset.

- [ ] **Step 4: Run passing tests**

Run:

```bash
node tests/test-creative-video-frame-spec.js
```

Expected: pass.

- [ ] **Step 5: Register test and commit**

Modify `package.json` so the frame spec test runs after `node tests/test-creative-video-scene-spec.js`.

Commit:

```bash
git add server/services/creative-video/frameSpecService.js tests/test-creative-video-frame-spec.js package.json
git commit -m "新增创意视频帧规格服务"
```

---

### Task 3: Creative Spec Agent Two-Call Prompts

**Files:**
- Create: `server/services/creative-video/creativeSpecAgent.js`
- Create: `tests/test-creative-spec-agent.js`
- Modify: `package.json`

- [ ] **Step 1: Write prompt and parser tests**

Create `tests/test-creative-spec-agent.js`:

```js
const assert = require('assert');
const agent = require('../server/services/creative-video/creativeSpecAgent');

const scenePrompt = agent.buildSceneSpecPrompt({
  creativeContext: { input: { raw_text: '介绍 Superpowers Skill' } },
  target: { aspect_ratio: '16:9', duration: 60 },
});
assert.ok(scenePrompt.includes('只输出 JSON'));
assert.ok(scenePrompt.includes('不允许输出 frame_specs'));
assert.ok(scenePrompt.includes('不要输出 HTML'));
assert.ok(scenePrompt.includes('visual_text.cards'));
assert.ok(scenePrompt.includes('背景'));

const sceneParsed = agent.parseSceneSpecResponse(JSON.stringify({
  scene_spec: {
    title: '测试',
    aspect_ratio: '16:9',
    scenes: [{
      id: 'scene_01',
      duration: 8,
      kind: 'text',
      narration_text: '旁白',
      captions: [],
      visual_text: { headline: '标题', keywords: [], cards: ['卡片文案'] },
    }],
  },
}));
assert.equal(sceneParsed.success, true);
assert.equal(sceneParsed.scene_spec.scenes[0].kind, 'text');

const framePrompt = agent.buildFrameSpecsPrompt({
  sceneSpec: sceneParsed.scene_spec,
});
assert.ok(framePrompt.includes('只输出 JSON'));
assert.ok(framePrompt.includes('不允许改写 scene_spec 文案'));
assert.ok(framePrompt.includes('allowed_templates'));
assert.ok(framePrompt.includes('hero_title'));

const frameParsed = agent.parseFrameSpecsResponse(JSON.stringify({
  frame_specs: [{
    id: 'frame_01_01',
    scene_id: 'scene_01',
    start: 0,
    duration: 8,
    kind: 'text',
    template: 'hero_title',
    layout: 'center_stack',
    background: 'dark_gradient',
    motion: 'fade_up',
    text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }],
    visual_layers: [{ id: 'accent', type: 'glow_panel', variant: 'cyan_pink' }],
  }],
}), sceneParsed.scene_spec);
assert.equal(frameParsed.success, true);
assert.equal(frameParsed.frame_specs.frames[0].template, 'hero_title');

const badScene = agent.parseSceneSpecResponse('```html\n<div>bad</div>\n```');
assert.equal(badScene.success, false);
assert.ok(badScene.message.includes('JSON'));

console.log('creative spec agent tests passed');
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node tests/test-creative-spec-agent.js
```

Expected: fail with missing module error.

- [ ] **Step 3: Implement creative spec agent**

Create `server/services/creative-video/creativeSpecAgent.js`.

Required exports:

```js
module.exports = {
  buildSceneSpecPrompt,
  buildFrameSpecsPrompt,
  parseSceneSpecResponse,
  parseFrameSpecsResponse,
};
```

Required behavior:

- `buildSceneSpecPrompt` contains Chinese constraints for JSON-only output and banned engineering files.
- `buildSceneSpecPrompt` explicitly bans `frame_specs`.
- `buildFrameSpecsPrompt` includes enum lists from `specEnums`.
- `buildFrameSpecsPrompt` includes the full validated `scene_spec`.
- `parseSceneSpecResponse` rejects Markdown fences and HTML-looking output before JSON parse.
- `parseFrameSpecsResponse` rejects Markdown fences and HTML-looking output before JSON parse.
- Both parsers call the relevant normalize and validate services.

- [ ] **Step 4: Run passing tests and commit**

Run:

```bash
node tests/test-creative-spec-agent.js
```

Expected: pass.

Modify `package.json` so this test runs after `node tests/test-creative-video-frame-spec.js`.

Commit:

```bash
git add server/services/creative-video/creativeSpecAgent.js tests/test-creative-spec-agent.js package.json
git commit -m "新增创意视频规格 Agent"
```

---

### Task 4: Template Registry

**Files:**
- Create: `server/services/creative-video/templateRegistry.js`
- Create: `tests/test-creative-template-registry.js`
- Modify: `package.json`

- [ ] **Step 1: Write registry tests**

Create `tests/test-creative-template-registry.js`:

```js
const assert = require('assert');
const registry = require('../server/services/creative-video/templateRegistry');

const templates = registry.listTemplates();
assert.ok(templates.length >= 6);
assert.ok(templates.some(template => template.id === 'hero_title'));
assert.ok(templates.some(template => template.id === 'data_cards'));

const hero = registry.getTemplate('hero_title');
assert.equal(hero.id, 'hero_title');
assert.ok(hero.supportedKinds.includes('text'));
assert.equal(typeof hero.renderFrame, 'function');
assert.ok(registry.getBackgroundCss('dark_gradient').includes('linear-gradient'));
assert.ok(registry.getMotionSnippet('fade_up', '.target', 0).includes('fromTo'));
assert.ok(registry.getVisualLayerRenderer('glow_panel'));

assert.throws(() => registry.getTemplate('missing_template'), /未知模板/);
assert.throws(() => registry.getBackgroundCss('freeform_background'), /未知背景/);

console.log('creative template registry tests passed');
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node tests/test-creative-template-registry.js
```

Expected: fail with missing module error.

- [ ] **Step 3: Implement registry**

Create `server/services/creative-video/templateRegistry.js`.

Required exports:

```js
module.exports = {
  listTemplates,
  getTemplate,
  getBackgroundCss,
  getLayoutClass,
  getMotionSnippet,
  getVisualLayerRenderer,
};
```

Required behavior:

- Register templates: `hero_title`, `keyword_burst`, `process_steps`, `compare_split`, `data_cards`, `cta_end`.
- Provide CSS for `dark_gradient`, `soft_grid`, `radial_spotlight`, `brand_blocks`, `clean_light`.
- Provide motion snippets for `fade_up`, `slide_in`, `scale_pop`, `stagger_cards`, `glow_pulse`, `fade_out`.
- Provide visual layer renderers for `glow_panel`, `grid_lines`, `shape_blocks`, `number_counter`, `progress_bar`, `connector_lines`.
- Template `renderFrame(frame, scene)` returns `{ html, cssClasses, timeline }`.
- Return Chinese errors for unknown template/background/motion/visual layer type.
- Do not import AI, file system, routes, workflow services, or render services.

- [ ] **Step 4: Run passing tests and commit**

Run:

```bash
node tests/test-creative-template-registry.js
```

Expected: pass.

Modify `package.json` so this test runs after `node tests/test-creative-spec-agent.js`.

Commit:

```bash
git add server/services/creative-video/templateRegistry.js tests/test-creative-template-registry.js package.json
git commit -m "新增创意视频模板注册表"
```

---

### Task 5: HyperFrames Template Renderer

**Files:**
- Create: `server/services/creative-video/hyperframesTemplateRenderer.js`
- Create: `tests/test-hyperframes-template-renderer.js`
- Modify: `package.json`

- [ ] **Step 1: Write renderer tests**

Create `tests/test-hyperframes-template-renderer.js`:

```js
const assert = require('assert');
const renderer = require('../server/services/creative-video/hyperframesTemplateRenderer');

const sceneSpec = {
  title: '测试视频',
  aspect_ratio: '16:9',
  target_duration_sec: 12,
  scenes: [{
    id: 'scene_01',
    order: 1,
    start: 0,
    duration: 12,
    kind: 'text',
    narration_text: '旁白',
    captions: [{ id: 'cap_01_01', start: 0, end: 2, text: '字幕' }],
    visual_text: { headline: '标题', keywords: ['关键词'], cards: ['卡片'] },
  }],
};

const frameSpecs = {
  frames: [{
    id: 'frame_01_01',
    scene_id: 'scene_01',
    order: 1,
    start: 0,
    duration: 12,
    kind: 'text',
    template: 'hero_title',
    layout: 'center_stack',
    background: 'dark_gradient',
    motion: 'fade_up',
    text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }],
    visual_layers: [{ id: 'accent', type: 'glow_panel', variant: 'cyan_pink' }],
  }],
};

const result = renderer.renderHyperframesProjectFiles({ sceneSpec, frameSpecs });
assert.equal(result.success, true);
const html = result.files['index.html'];
assert.ok(html.includes('data-composition-id="main"'));
assert.ok(html.includes('data-width="1920"'));
assert.ok(html.includes('data-height="1080"'));
assert.ok(html.includes('linear-gradient'));
assert.ok(html.includes('gsap.timeline'));
assert.ok(html.includes('window.__timelines["main"]'));
assert.ok(html.includes('class="creative-frame'));
assert.ok(html.includes('class="caption-line clip"'));
assert.ok(html.includes('data-duration="2"'));
assert.ok(result.files['scene_spec.json'].includes('"scene_01"'));
assert.ok(result.files['frame_specs.json'].includes('"frame_01_01"'));
assert.doesNotMatch(html, /<body>\s*<div class="composition"/);
assert.doesNotMatch(html, /performance\.now|requestAnimationFrame|setInterval|Date\.now/);

console.log('hyperframes template renderer tests passed');
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node tests/test-hyperframes-template-renderer.js
```

Expected: fail with missing module error.

- [ ] **Step 3: Implement renderer**

Create `server/services/creative-video/hyperframesTemplateRenderer.js`.

Required exports:

```js
module.exports = {
  renderHyperframesProjectFiles,
  buildIndexHtml,
};
```

Required behavior:

- Import `sceneSpecService`, `frameSpecService`, and `templateRegistry`.
- Normalize and validate scene/frame specs.
- Generate `index.html`, `meta.json`, `hyperframes.json`, `scene_spec.json`, `frame_specs.json`, and `design.md`.
- Include CSS reset, full-bleed composition, dark default body background, caption styling, frame positioning, and template CSS.
- Include GSAP script before timeline code.
- Build a real `gsap.timeline({ paused: true })`.
- Store timeline in `window.__timelines["main"]`.
- Each frame has `class="creative-frame clip"` and timing attributes.
- Each caption has `class="caption-line clip"` and `data-start` plus `data-duration`.
- No non-deterministic browser APIs in output.

- [ ] **Step 4: Run renderer tests**

Run:

```bash
node tests/test-hyperframes-template-renderer.js
```

Expected: pass.

- [ ] **Step 5: Run a real HyperFrames check**

Use this one-off verification command:

```bash
node -e "const fs=require('fs/promises');const os=require('os');const path=require('path');const r=require('./server/services/creative-video/hyperframesTemplateRenderer');const p=require('./server/services/hyperframesFreeformProject');const q=require('./server/services/hyperframesFreeformQuality');(async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'hf-lite-'));const sceneSpec={title:'测试视频',aspect_ratio:'16:9',target_duration_sec:12,scenes:[{id:'scene_01',order:1,start:0,duration:12,kind:'text',narration_text:'旁白',captions:[{id:'cap_01_01',start:0,end:2,text:'字幕'}],visual_text:{headline:'标题',keywords:['关键词'],cards:['卡片']}}]};const frameSpecs={frames:[{id:'frame_01_01',scene_id:'scene_01',order:1,start:0,duration:12,kind:'text',template:'hero_title',layout:'center_stack',background:'dark_gradient',motion:'fade_up',text_layers:[{id:'headline',role:'headline',text:'标题',emphasis:'primary'}],visual_layers:[{id:'accent',type:'glow_panel',variant:'cyan_pink'}]}]};const files=r.renderHyperframesProjectFiles({sceneSpec,frameSpecs}).files;const created=await p.createFreeformProject({awemeId:'202606140000000001',runId:'hf-lite-test',rootDir:root,files});const projectDir=created.projectDir||created.project_dir;const checked=await q.checkFreeformProject({projectDir});console.log(JSON.stringify({success:checked.success,message:checked.message,projectDir},null,2));if(!checked.success) process.exit(1);})().catch(e=>{console.error(e);process.exit(1);})"
```

Expected: prints `"success": true`.

- [ ] **Step 6: Register test and commit**

Modify `package.json` so this test runs after `node tests/test-creative-template-registry.js`.

Commit:

```bash
git add server/services/creative-video/hyperframesTemplateRenderer.js tests/test-hyperframes-template-renderer.js package.json
git commit -m "新增 HyperFrames 模板渲染器"
```

---

### Task 6: Render Adapter And Project Writer

**Files:**
- Create: `server/services/creative-video/renderAdapter.js`
- Create: `server/services/creative-video/projectWriter.js`
- Create: `tests/test-creative-render-adapter.js`
- Create: `tests/test-creative-video-project-writer.js`
- Modify: `package.json`

- [ ] **Step 1: Write adapter and writer tests**

Create `tests/test-creative-render-adapter.js`:

```js
const assert = require('assert');
const { HyperFramesRenderAdapter, createRenderAdapter } = require('../server/services/creative-video/renderAdapter');

(async () => {
  const calls = [];
  const adapter = new HyperFramesRenderAdapter({
    renderer: {
      renderHyperframesProject: async input => {
        calls.push(input);
        return { success: true, output_path: 'D:/tmp/output.mp4', stdout: 'ok', stderr: '' };
      },
    },
  });

  const result = await adapter.render({ project_dir: 'D:/tmp/project', output_path: 'D:/tmp/output.mp4', fps: 30, duration: 12 });
  assert.equal(result.success, true);
  assert.equal(result.output_path, 'D:/tmp/output.mp4');
  assert.equal(result.stdout, 'ok');
  assert.equal(calls[0].projectDir, 'D:/tmp/project');
  assert.ok(createRenderAdapter({ type: 'hyperframes' }));

  console.log('creative render adapter tests passed');
})();
```

Create `tests/test-creative-video-project-writer.js`:

```js
const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const writer = require('../server/services/creative-video/projectWriter');

(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'creative-video-project-'));
  const result = await writer.writeCreativeVideoProject({
    rootDir,
    workflowId: '202606140000000001',
    runId: 'run_001',
    files: {
      'index.html': '<html></html>',
      'meta.json': '{}',
      'hyperframes.json': '{}',
      'scene_spec.json': '{}',
      'frame_specs.json': '{}',
    },
  });
  assert.equal(result.success, true);
  assert.ok(result.project_dir.includes('202606140000000001'));
  assert.equal(await fs.readFile(path.join(result.project_dir, 'index.html'), 'utf8'), '<html></html>');

  const bad = await writer.writeCreativeVideoProject({
    rootDir,
    workflowId: '202606140000000001',
    runId: 'run_002',
    files: { '../escape.txt': 'bad' },
  });
  assert.equal(bad.success, false);

  console.log('creative video project writer tests passed');
})();
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node tests/test-creative-render-adapter.js
node tests/test-creative-video-project-writer.js
```

Expected: both fail with missing module errors.

- [ ] **Step 3: Implement adapter and writer**

Create `server/services/creative-video/renderAdapter.js`.

Required exports:

```js
module.exports = {
  HyperFramesRenderAdapter,
  createRenderAdapter,
};
```

Required behavior:

- Default renderer imports `../hyperframesRenderer`.
- `render(input)` accepts snake_case input: `project_dir`, `output_path`, `fps`, `duration`, `audio`.
- It calls existing renderer as `renderHyperframesProject({ projectDir, renderOptions })`.
- It returns snake_case output: `success`, `output_path`, `stdout`, `stderr`, `diagnostics`, `meta`, `message`.

Create `server/services/creative-video/projectWriter.js`.

Required exports:

```js
module.exports = {
  writeCreativeVideoProject,
};
```

Required behavior:

- Safely write files under `rootDir/workflowId/agent_runs/runId-hyperframes-lite`.
- Reject file names with path traversal, absolute paths, or backslashes.
- Return `{ success, project_dir, files, message }`.
- Do not import render services, AI services, routes, or React code.

- [ ] **Step 4: Run passing tests and commit**

Run:

```bash
node tests/test-creative-render-adapter.js
node tests/test-creative-video-project-writer.js
```

Expected: both pass.

Modify `package.json` to register both tests after renderer tests.

Commit:

```bash
git add server/services/creative-video/renderAdapter.js server/services/creative-video/projectWriter.js tests/test-creative-render-adapter.js tests/test-creative-video-project-writer.js package.json
git commit -m "新增创意视频渲染适配和工程写入"
```

---

### Task 7: Visual QA Service

**Files:**
- Create: `server/services/creative-video/visualQaService.js`
- Create: `tests/test-visual-qa-service.js`
- Modify: `package.json`

- [ ] **Step 1: Write visual QA tests**

Create `tests/test-visual-qa-service.js`:

```js
const assert = require('assert');
const qa = require('../server/services/creative-video/visualQaService');

const whiteFrames = Array.from({ length: 10 }, (_, index) => ({
  id: `frame_${index}`,
  average_luma: 245,
  luma_stddev: 4,
  edge_score: 2,
  color_variance: 3,
}));

const whiteResult = qa.analyzeFrameMetrics({
  frames: whiteFrames,
  contact_sheet_size: 6000,
});
assert.equal(whiteResult.success, false);
assert.ok(whiteResult.issues.some(issue => issue.code === 'too_many_blank_frames'));
assert.ok(whiteResult.issues.some(issue => issue.code === 'contact_sheet_too_small'));

const healthyFrames = Array.from({ length: 10 }, (_, index) => ({
  id: `frame_${index}`,
  average_luma: 120,
  luma_stddev: 45,
  edge_score: 28,
  color_variance: 35,
}));

const healthyResult = qa.analyzeFrameMetrics({
  frames: healthyFrames,
  contact_sheet_size: 45000,
});
assert.equal(healthyResult.success, true);
assert.deepEqual(healthyResult.issues, []);

console.log('visual qa service tests passed');
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node tests/test-visual-qa-service.js
```

Expected: fail with missing module error.

- [ ] **Step 3: Implement visual QA service**

Create `server/services/creative-video/visualQaService.js`.

Required exports:

```js
module.exports = {
  analyzeFrameMetrics,
  inspectRenderedVideo,
};
```

Required behavior:

- `analyzeFrameMetrics({ frames, contact_sheet_size })` applies thresholds:
  - `average_luma > 230` means near-white.
  - `average_luma < 25` means near-black.
  - near-white or near-black frame ratio over `0.3` fails.
  - contact sheet size under `20000` bytes fails.
  - low-information frame means `luma_stddev < 12` and `edge_score < 8` and `color_variance < 10`.
  - low-information frame ratio over `0.4` fails.
- Return `{ success, issues, metrics, message }`.
- `inspectRenderedVideo` may delegate frame extraction to existing `hyperframesFreeformQuality.inspectRenderedVideo`, then analyze extracted frame metrics when metrics are available. If only contact sheet exists, check file size and return a warning issue when pixel metrics were not collected.

- [ ] **Step 4: Run passing tests and commit**

Run:

```bash
node tests/test-visual-qa-service.js
```

Expected: pass.

Modify `package.json` so this test runs after `node tests/test-creative-video-project-writer.js`.

Commit:

```bash
git add server/services/creative-video/visualQaService.js tests/test-visual-qa-service.js package.json
git commit -m "新增创意视频视觉质检服务"
```

---

### Task 8: Workflow Facade Integration

**Files:**
- Create: `server/services/creative-video/workflowFacade.js`
- Create: `tests/test-creative-video-workflow-facade.js`
- Modify: `server/services/agentRuns.js`
- Modify: `server/services/creativeWorkflows.js`
- Modify: `tests/test-agent-runs.js`
- Modify: `tests/test-creative-workflows.js`
- Modify: `package.json`

- [ ] **Step 1: Write facade tests**

Create `tests/test-creative-video-workflow-facade.js`:

```js
const assert = require('assert');
const facade = require('../server/services/creative-video/workflowFacade');

(async () => {
  const calls = [];
  const result = await facade.generateCreativeVideoProject({
    workflowId: '202606140000000001',
    runId: 'run_001',
    creativeContext: { input: { raw_text: '测试主题' } },
    services: {
      aiTextModel: {
        callTextModel: async ({ messages }) => {
          calls.push(messages.map(message => message.content).join('\n'));
          if (calls.length === 1) {
            return { success: true, text: JSON.stringify({ scene_spec: { title: '测试', aspect_ratio: '16:9', scenes: [{ id: 'scene_01', duration: 8, kind: 'text', narration_text: '旁白', captions: [], visual_text: { headline: '标题', keywords: [], cards: ['卡片'] } }] } }) };
          }
          return { success: true, text: JSON.stringify({ frame_specs: [{ id: 'frame_01_01', scene_id: 'scene_01', start: 0, duration: 8, kind: 'text', template: 'hero_title', layout: 'center_stack', background: 'dark_gradient', motion: 'fade_up', text_layers: [{ id: 'headline', role: 'headline', text: '标题', emphasis: 'primary' }], visual_layers: [{ id: 'accent', type: 'glow_panel', variant: 'cyan_pink' }] }] }) };
        },
      },
      projectWriter: async files => ({ success: true, project_dir: 'D:/tmp/project', files: Object.keys(files) }),
      checker: async () => ({ success: true, message: '校验通过' }),
    },
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 2);
  assert.ok(result.scene_spec);
  assert.ok(result.frame_specs);
  assert.equal(result.project_dir, 'D:/tmp/project');
  assert.ok(result.files.includes('index.html'));

  console.log('creative video workflow facade tests passed');
})();
```

- [ ] **Step 2: Run failing facade test**

Run:

```bash
node tests/test-creative-video-workflow-facade.js
```

Expected: fail with missing module error.

- [ ] **Step 3: Implement workflow facade**

Create `server/services/creative-video/workflowFacade.js`.

Required exports:

```js
module.exports = {
  generateCreativeVideoProject,
  rerenderCreativeVideoProject,
  applyCreativeVideoEdit,
};
```

Required behavior:

- `generateCreativeVideoProject` performs:
  - build scene prompt
  - call text model
  - parse scene spec
  - build frame prompt
  - call text model
  - parse frame specs
  - render HyperFrames files
  - write project
  - check project
- Return `scene_spec`, `frame_specs`, `project_dir`, `files`, and Chinese `message`.
- Do not import Express routes or React code.
- Use dependency injection for tests.

- [ ] **Step 4: Integrate without growing large files**

Modify `server/services/agentRuns.js` only at the existing freeform project generation boundary:

- Import `./creative-video/workflowFacade`.
- Replace the stable scene-spec project path with `workflowFacade.generateCreativeVideoProject`.
- Preserve legacy freeform path behind an option named `useLegacyFreeformProject === true`.
- Keep existing exported function names stable.
- Do not paste template renderer logic into `agentRuns.js`.

Modify `server/services/creativeWorkflows.js` only at facade call boundaries:

- Store `scene_spec`, `frame_specs`, `project_dir`, and `render_versions` in workflow result.
- Do not paste renderer or visual QA logic into this file.

- [ ] **Step 5: Run focused workflow tests**

Run:

```bash
node tests/test-creative-video-workflow-facade.js
node tests/test-agent-runs.js
node tests/test-creative-workflows.js
```

Expected: all pass.

- [ ] **Step 6: Register test and commit**

Modify `package.json` so the facade test runs after `node tests/test-visual-qa-service.js`.

Commit:

```bash
git add server/services/creative-video/workflowFacade.js server/services/agentRuns.js server/services/creativeWorkflows.js tests/test-creative-video-workflow-facade.js tests/test-agent-runs.js tests/test-creative-workflows.js package.json
git commit -m "接入 html-video lite 成片工作流"
```

---

### Task 9: Routes And API Client

**Files:**
- Modify: `server/routes/creativeWorkflows.js`
- Modify: `frontend-react/src/api/client.js`
- Modify: `tests/test-creative-workflow-routes.js`
- Modify: `tests/test-creative-api-client.mjs`

- [ ] **Step 1: Add route and client tests**

Update `tests/test-creative-workflow-routes.js` to assert routes for:

```js
GET /api/creative-workflows/:workflow_id/video-spec
PATCH /api/creative-workflows/:workflow_id/video-spec
POST /api/creative-workflows/:workflow_id/rerender
POST /api/creative-workflows/:workflow_id/remix
```

Expected assertions:

```js
assert.equal(getResponse.statusCode, 200);
assert.ok(getResponse.body.scene_spec);
assert.ok(getResponse.body.frame_specs);
assert.equal(patchResponse.statusCode, 200);
assert.equal(rerenderResponse.statusCode, 200);
assert.equal(remixResponse.statusCode, 200);
```

Update `tests/test-creative-api-client.mjs` with source assertions:

```js
assert.ok(source.includes('getCreativeVideoSpec(workflowId)'));
assert.ok(source.includes('patchCreativeVideoSpec(workflowId, payload)'));
assert.ok(source.includes('rerenderCreativeVideo(workflowId, payload)'));
assert.ok(source.includes('remixCreativeVideo(workflowId, payload)'));
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node tests/test-creative-workflow-routes.js
node tests/test-creative-api-client.mjs
```

Expected: fail because routes/client methods do not exist.

- [ ] **Step 3: Implement thin routes**

Modify `server/routes/creativeWorkflows.js`:

- Add new route handlers before `router.get('/:workflow_id', ...)`.
- Validate workflow ID with existing pattern.
- Call service methods only.
- Return Chinese messages.
- Do not mutate specs in route handlers.

- [ ] **Step 4: Implement API client methods**

Modify `frontend-react/src/api/client.js` with:

```js
getCreativeVideoSpec(workflowId) {
  return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/video-spec`);
},
patchCreativeVideoSpec(workflowId, payload) {
  return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/video-spec`, {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
  });
},
rerenderCreativeVideo(workflowId, payload) {
  return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/rerender`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
},
remixCreativeVideo(workflowId, payload) {
  return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}/remix`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
},
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
node tests/test-creative-workflow-routes.js
node tests/test-creative-api-client.mjs
```

Expected: both pass.

Commit:

```bash
git add server/routes/creativeWorkflows.js frontend-react/src/api/client.js tests/test-creative-workflow-routes.js tests/test-creative-api-client.mjs
git commit -m "新增创意视频规格接口"
```

---

### Task 10: Componentized Frontend Editor

**Files:**
- Create: `frontend-react/src/hooks/useCreativeVideoEditor.js`
- Create: `frontend-react/src/components/creative-video-editor/CreativeVideoEditor.jsx`
- Create: `frontend-react/src/components/creative-video-editor/SceneList.jsx`
- Create: `frontend-react/src/components/creative-video-editor/SceneEditPanel.jsx`
- Create: `frontend-react/src/components/creative-video-editor/FrameList.jsx`
- Create: `frontend-react/src/components/creative-video-editor/FrameEditPanel.jsx`
- Create: `frontend-react/src/components/creative-video-editor/CaptionEditor.jsx`
- Create: `frontend-react/src/components/creative-video-editor/VisualTextEditor.jsx`
- Create: `frontend-react/src/components/creative-video-editor/RenderVersionPanel.jsx`
- Create: `frontend-react/src/components/creative-video-editor/EditorStatusBar.jsx`
- Modify: `frontend-react/src/pages/OneClickCreativePage.jsx`
- Modify: `frontend-react/src/styles.css`
- Create: `tests/test-creative-video-editor-components.mjs`
- Modify: `tests/test-one-click-creative-page.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write frontend boundary tests**

Create `tests/test-creative-video-editor-components.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('frontend-react/src/pages/OneClickCreativePage.jsx', 'utf-8');
const hook = fs.readFileSync('frontend-react/src/hooks/useCreativeVideoEditor.js', 'utf-8');
const editor = fs.readFileSync('frontend-react/src/components/creative-video-editor/CreativeVideoEditor.jsx', 'utf-8');
const sceneList = fs.readFileSync('frontend-react/src/components/creative-video-editor/SceneList.jsx', 'utf-8');
const frameList = fs.readFileSync('frontend-react/src/components/creative-video-editor/FrameList.jsx', 'utf-8');
const status = fs.readFileSync('frontend-react/src/components/creative-video-editor/EditorStatusBar.jsx', 'utf-8');

assert.ok(page.includes('CreativeVideoEditor'));
assert.doesNotMatch(page, /caption_id|frame_specs|patchCreativeVideoSpec|selectedSceneId/);
assert.ok(hook.includes('getCreativeVideoSpec'));
assert.ok(hook.includes('patchCreativeVideoSpec'));
assert.ok(hook.includes('rerenderCreativeVideo'));
assert.ok(hook.includes('正在加载可编辑工程'));
assert.ok(hook.includes('正在保存编辑'));
assert.ok(hook.includes('正在重新渲染'));
assert.ok(editor.includes('SceneList'));
assert.ok(editor.includes('FrameList'));
assert.ok(editor.includes('EditorStatusBar'));
assert.ok(sceneList.includes('场景'));
assert.ok(frameList.includes('帧'));
assert.ok(status.includes('message'));

console.log('creative video editor component tests passed');
```

- [ ] **Step 2: Run failing frontend test**

Run:

```bash
node tests/test-creative-video-editor-components.mjs
```

Expected: fail because files do not exist.

- [ ] **Step 3: Implement hook**

Create `frontend-react/src/hooks/useCreativeVideoEditor.js`.

Hook contract:

```js
export function useCreativeVideoEditor({ workflowId, api }) {
  return {
    sceneSpec,
    frameSpecs,
    renderVersions,
    selectedSceneId,
    selectedFrameId,
    selectedScene,
    selectedFrame,
    status,
    message,
    loading,
    saving,
    load,
    selectScene,
    selectFrame,
    saveSceneEdit,
    saveFrameEdit,
    rerender,
    remix,
  };
}
```

Required behavior:

- API calls live only in this hook.
- Use Chinese loading messages.
- Disable repeat actions through `loading` and `saving`.
- Update local specs from server response after save.

- [ ] **Step 4: Implement components**

Create all component files listed in this task.

Component rules:

- Components receive props and callbacks only.
- Components do not import `api`.
- Components do not call `fetch`.
- `SceneEditPanel` and `FrameEditPanel` use local draft state.
- Saves happen through explicit buttons, not on every keystroke.
- Every save/rerender/remix button receives `disabled`.

- [ ] **Step 5: Wire page shell**

Modify `frontend-react/src/pages/OneClickCreativePage.jsx`:

- Import `CreativeVideoEditor`.
- Add only `editorOpen` state.
- Render `编辑成片` button when workflow status is done.
- Render `<CreativeVideoEditor workflowId={workflowId} api={api} />` when open.
- Do not add scene/frame/caption draft state to this page.

- [ ] **Step 6: Add styles**

Modify `frontend-react/src/styles.css`:

- All new selectors start with `.creative-video-editor`.
- Layout uses a responsive grid.
- Buttons have disabled styles.
- Status messages have loading/success/error variants.

- [ ] **Step 7: Run frontend tests and build**

Run:

```bash
node tests/test-creative-video-editor-components.mjs
node tests/test-one-click-creative-page.mjs
npm run build:frontend
```

Expected: tests pass and build succeeds.

Modify `package.json` so the component test runs after `node tests/test-one-click-creative-page.mjs`.

Commit:

```bash
git add frontend-react/src/hooks/useCreativeVideoEditor.js frontend-react/src/components/creative-video-editor frontend-react/src/pages/OneClickCreativePage.jsx frontend-react/src/styles.css tests/test-creative-video-editor-components.mjs tests/test-one-click-creative-page.mjs package.json
git commit -m "新增组件化创意视频编辑器"
```

---

### Task 11: Regression And Boundary Verification

**Files:**
- Modify only files required by failing verification.

- [ ] **Step 1: Run backend focused tests**

Run:

```bash
node tests/test-creative-video-spec-enums.js
node tests/test-creative-video-scene-spec.js
node tests/test-creative-video-frame-spec.js
node tests/test-creative-spec-agent.js
node tests/test-creative-template-registry.js
node tests/test-hyperframes-template-renderer.js
node tests/test-creative-render-adapter.js
node tests/test-creative-video-project-writer.js
node tests/test-visual-qa-service.js
node tests/test-creative-video-workflow-facade.js
node tests/test-agent-runs.js
node tests/test-creative-workflows.js
node tests/test-creative-workflow-routes.js
```

Expected: all pass.

- [ ] **Step 2: Run frontend focused tests**

Run:

```bash
node tests/test-creative-api-client.mjs
node tests/test-one-click-creative-page.mjs
node tests/test-creative-video-editor-components.mjs
npm run build:frontend
```

Expected: all pass and build succeeds.

- [ ] **Step 3: Run complete test suite**

Run:

```bash
npm test
```

Expected: all registered tests pass.

- [ ] **Step 4: Run boundary scans**

Run:

```bash
rg -n "require\\('fs'\\)|require\\(\"fs\"\\)|express|req\\.|res\\.|renderHyperframesProject|callTextModel" server/services/creative-video/sceneSpecService.js server/services/creative-video/frameSpecService.js server/services/creative-video/templateRegistry.js
rg -n "api\\.|fetch\\(" frontend-react/src/components/creative-video-editor
rg -n "caption_id|frame_specs|patchCreativeVideoSpec|selectedSceneId" frontend-react/src/pages/OneClickCreativePage.jsx
```

Expected:

- First command has no matches.
- Second command has no matches.
- Third command has no matches.

- [ ] **Step 5: Run real renderer smoke**

Run:

```bash
node -e "const fs=require('fs/promises');const os=require('os');const path=require('path');const r=require('./server/services/creative-video/hyperframesTemplateRenderer');const p=require('./server/services/creative-video/projectWriter');const q=require('./server/services/hyperframesFreeformQuality');(async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'hf-lite-final-'));const sceneSpec={title:'最终冒烟',aspect_ratio:'16:9',target_duration_sec:8,scenes:[{id:'scene_01',order:1,start:0,duration:8,kind:'text',narration_text:'旁白',captions:[{id:'cap_01_01',start:0,end:2,text:'字幕'}],visual_text:{headline:'最终冒烟',keywords:['稳定'],cards:['可渲染']}}]};const frameSpecs={frames:[{id:'frame_01_01',scene_id:'scene_01',order:1,start:0,duration:8,kind:'text',template:'hero_title',layout:'center_stack',background:'dark_gradient',motion:'fade_up',text_layers:[{id:'headline',role:'headline',text:'最终冒烟',emphasis:'primary'}],visual_layers:[{id:'accent',type:'glow_panel',variant:'cyan_pink'}]}]};const files=r.renderHyperframesProjectFiles({sceneSpec,frameSpecs}).files;const written=await p.writeCreativeVideoProject({rootDir:root,workflowId:'202606140000000001',runId:'final-smoke',files});const checked=await q.checkFreeformProject({projectDir:written.project_dir});console.log(JSON.stringify({success:checked.success,message:checked.message,projectDir:written.project_dir},null,2));if(!checked.success) process.exit(1);})().catch(e=>{console.error(e);process.exit(1);})"
```

Expected: prints `"success": true`.

- [ ] **Step 6: Inspect git diff**

Run:

```bash
git diff --stat
```

Expected: changes are limited to html-video lite services, workflow integration, routes, API client, editor components, styles, tests, and package test registration.

- [ ] **Step 7: Commit final fixes when needed**

If verification required fixes:

```bash
git add <fixed-files>
git commit -m "修正 html-video lite 验证问题"
```

If no fixes were needed, do not create an empty commit.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-14-html-video-lite-one-click-video-redesign.md`.

Preferred execution mode:

**Use Subagent-Driven when the target agent supports it.** Dispatch one fresh subagent per task. Review the diff and run the task tests before dispatching the next task.

Fallback execution mode:

**Use Inline Execution only when Subagent-Driven is unavailable.** Execute exactly one task at a time and stop after each commit for review.

Required reporting language:

**All status reports, review notes, test results, risk notes, and commit summaries must be written in Chinese.**
