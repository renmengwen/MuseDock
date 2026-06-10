# AI Workbench Stage 7 Video Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the AI workbench video pipeline end to end so generated MP4s use short phrase-synced captions, beat-driven HyperFrames visuals, duration control, render quality reports, and an end-to-end comparison workflow against the current `output (1).mp4` baseline.

**Architecture:** Keep the existing chain of task Agent, TTS, storyboard Agent, HyperFrames project, and renderer, but strengthen the contracts between each layer. The task Agent will produce `spoken_blocks`; TTS captions will be converted to phrase-level timeline blocks; the storyboard Agent will bind `visual_scene.beats` to phrase blocks; HyperFrames animation will consume those beats; a quality analyzer will inspect rendered MP4s and generated project metadata.

**Tech Stack:** Node.js CommonJS services, plain Node assertion tests, React AI workbench, HyperFrames HTML/CSS/GSAP renderer, ffmpeg/ffprobe for local video analysis.

---

## Existing Context

Current relevant files:

- `server/services/agentTemplates.js`: default task Agent prompt and `video_brief` output rules.
- `server/services/agentRuns.js`: orchestration for task Agent, TTS, storyboard, HyperFrames project, render status, and run persistence.
- `server/services/ttsTimeline.js`: sentence and caption generation from TTS segments.
- `server/services/storyboardAgent.js`: storyboard Agent prompt and `visual_scene` request.
- `server/services/storyboardSchema.js`: storyboard normalization and validation.
- `server/services/hyperframesProject.js`: project JSON, HTML/CSS, caption bar, render options, and timeline assembly.
- `server/services/hyperframesAnimations.js`: GSAP timeline generation from scenes and `visual_scene.beats`.
- `server/services/hyperframesSceneRenderers.js`: composition-specific DOM renderers.
- `server/services/frameProfiles.js`: frame option normalization.
- `frontend-react/src/pages/AiWorkspace.jsx`: AI workbench controls and status display.
- `frontend-react/src/api/client.js`: API client methods for AI workbench actions.
- `server/routes/agents.js`: endpoints used by the AI workbench.
- Existing tests under `tests/`.

Important baseline:

- Current user-provided weak sample: `C:/Users/MOVER/Downloads/output (1).mp4`
- Strong comparison sample: `C:/Users/MOVER/Documents/Codex/2026-06-09/60-hyperframes-skill-stagger-0-5s/outputs/hyperframes-skill-intro.mp4`
- Current latest local run used during investigation:
  - `D:/code3/MediaCrawler-GUI/data/media/douyin/7626629893899488555/agent_runs/20260610-043953-998Z-ea9d4c-viral_rewrite.json`
  - `D:/code3/MediaCrawler-GUI/data/media/douyin/7626629893899488555/agent_runs/20260610-043953-998Z-ea9d4c-viral_rewrite-hyperframes/project.json`

## File Structure

Create:

- `server/services/phraseTimeline.js`
  - Converts Chinese captions and TTS segments into phrase-level timed blocks.
  - Owns punctuation and max-length splitting rules.
  - Provides stable IDs used by storyboard and renderer.

- `server/services/videoQualityReport.js`
  - Reads project metadata and optional sampled-frame metrics.
  - Scores duration fit, visual type variety, phrase caption usage, beat coverage, caption sync coverage, and repeated static-card risk.
  - Returns Chinese user-facing findings.

- `scripts/analyze-video-quality.js`
  - CLI wrapper for `videoQualityReport`.
  - Can inspect a HyperFrames project directory and optionally an MP4 path.

- `tests/test-phrase-timeline.js`
  - Unit tests for Chinese phrase splitting and timing allocation.

- `tests/test-video-quality-report.js`
  - Unit tests for quality report scoring.

Modify:

- `server/services/agentTemplates.js`
  - Require `spoken_blocks` from task Agent results.

- `server/services/agentRuns.js`
  - Normalize and persist `spoken_blocks`.
  - Create phrase captions after TTS.
  - Persist `video_quality_report` after project generation and render.

- `server/services/ttsTimeline.js`
  - Export helpers needed by `phraseTimeline`, or delegate phrase generation to the new service.

- `server/services/storyboardAgent.js`
  - Inject phrase blocks into storyboard messages.
  - Require `visual_scene.beats[].caption_block_id`.

- `server/services/storyboardSchema.js`
  - Normalize and validate `caption_block_id` on beats and `caption_sync`.

- `server/services/hyperframesProject.js`
  - Add `captionMode=phrase_kinetic`.
  - Render phrase caption spans with `data-caption-block-id`.
  - Write phrase captions and quality report references into project JSON.

- `server/services/hyperframesAnimations.js`
  - Use phrase block start/end times and beat `caption_block_id` for timing.
  - Highlight phrase captions and visual objects together.

- `server/services/frameProfiles.js`
  - Allow `phrase_kinetic` caption mode.

- `frontend-react/src/pages/AiWorkspace.jsx`
  - Add render option for phrase kinetic captions.
  - Display target duration, TTS duration, and quality report summary.

- `frontend-react/src/api/client.js`
  - Add methods only if a new endpoint is needed for report refresh.

- `server/routes/agents.js`
  - Expose quality report refresh endpoint if report generation is not only part of render/project creation.

Update tests:

- `tests/test-agent-templates.js`
- `tests/test-agent-runs.js`
- `tests/test-storyboard-agent.js`
- `tests/test-storyboard-schema.js`
- `tests/test-frame-profiles.js`
- `tests/test-hyperframes-project.js`
- `tests/test-ai-workspace-brief-ui.mjs`

---

### Task 1: Phrase Timeline Contract

**Files:**

- Create: `server/services/phraseTimeline.js`
- Create: `tests/test-phrase-timeline.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing test for Chinese phrase splitting**

Create `tests/test-phrase-timeline.js` with these assertions:

```js
const assert = require('assert');
const phraseTimeline = require('../server/services/phraseTimeline');

const phrases = phraseTimeline.splitChineseCaptionIntoPhrases(
  '输入是什么，输出是什么，规则是什么，哪里需要确认。'
);

assert.deepStrictEqual(phrases, [
  '输入是什么',
  '输出是什么',
  '规则是什么',
  '哪里需要确认',
]);

const listPhrases = phraseTimeline.splitChineseCaptionIntoPhrases(
  '处理固定模板、批量命名、拆分文件、汇总数据，本质上都是重复动作。'
);

assert.deepStrictEqual(listPhrases, [
  '处理固定模板',
  '批量命名',
  '拆分文件',
  '汇总数据',
  '本质上都是重复动作',
]);

console.log('phrase timeline tests passed');
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
node tests/test-phrase-timeline.js
```

Expected: FAIL with `Cannot find module '../server/services/phraseTimeline'`.

- [ ] **Step 3: Implement minimal phrase splitter**

Create `server/services/phraseTimeline.js`:

```js
const PHRASE_SPLIT_RE = /[，,、；;。：:\n]+/g;

function splitLongPhrase(text, maxChars = 14) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if ([...clean].length <= maxChars) return [clean];

  const chars = [...clean];
  const result = [];
  for (let index = 0; index < chars.length; index += maxChars) {
    result.push(chars.slice(index, index + maxChars).join('').trim());
  }
  return result.filter(Boolean);
}

function splitChineseCaptionIntoPhrases(text, options = {}) {
  const maxChars = Number(options.maxChars || 14);
  return String(text || '')
    .split(PHRASE_SPLIT_RE)
    .flatMap(part => splitLongPhrase(part, maxChars))
    .map(part => part.replace(/[。.!！?？]+$/g, '').trim())
    .filter(Boolean);
}

module.exports = {
  splitChineseCaptionIntoPhrases,
};
```

- [ ] **Step 4: Verify green**

Run:

```powershell
node tests/test-phrase-timeline.js
```

Expected: PASS and prints `phrase timeline tests passed`.

- [ ] **Step 5: Add test command to package script**

Modify `package.json` test script so `node tests/test-phrase-timeline.js` runs after `node tests/test-tts-timeline.js`.

- [ ] **Step 6: Verify test script slice**

Run:

```powershell
node tests/test-tts-timeline.js && node tests/test-phrase-timeline.js
```

Expected: PASS.

---

### Task 2: Phrase Timing From TTS Captions

**Files:**

- Modify: `server/services/phraseTimeline.js`
- Modify: `tests/test-phrase-timeline.js`

- [ ] **Step 1: Write failing test for timed phrase blocks**

Append to `tests/test-phrase-timeline.js`:

```js
const blocks = phraseTimeline.buildPhraseBlocksFromCaptions([
  {
    index: 3,
    start: 10,
    end: 14,
    duration: 4,
    text: '输入是什么，输出是什么，规则是什么，哪里需要确认。',
  },
]);

assert.deepStrictEqual(blocks.map(block => ({
  id: block.id,
  caption_index: block.caption_index,
  text: block.text,
  start: Number(block.start.toFixed(2)),
  end: Number(block.end.toFixed(2)),
})), [
  { id: 'cap-3-p1', caption_index: 3, text: '输入是什么', start: 10, end: 11 },
  { id: 'cap-3-p2', caption_index: 3, text: '输出是什么', start: 11, end: 12 },
  { id: 'cap-3-p3', caption_index: 3, text: '规则是什么', start: 12, end: 13 },
  { id: 'cap-3-p4', caption_index: 3, text: '哪里需要确认', start: 13, end: 14 },
]);
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
node tests/test-phrase-timeline.js
```

Expected: FAIL because `buildPhraseBlocksFromCaptions` is not defined.

- [ ] **Step 3: Implement phrase block timing**

Add to `server/services/phraseTimeline.js`:

```js
function roundTime(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function buildPhraseBlocksFromCaptions(captions = [], options = {}) {
  const safeCaptions = Array.isArray(captions) ? captions : [];
  return safeCaptions.flatMap((caption, captionIndex) => {
    const captionNumber = Number(caption?.index || captionIndex + 1);
    const start = Number(caption?.start || 0);
    const end = Number(caption?.end || start);
    const duration = Math.max(0, end - start);
    const phrases = splitChineseCaptionIntoPhrases(caption?.text || '', options);
    if (!phrases.length) return [];

    const slot = duration / phrases.length;
    return phrases.map((text, index) => ({
      id: `cap-${captionNumber}-p${index + 1}`,
      caption_index: captionNumber,
      phrase_index: index + 1,
      text,
      start: roundTime(start + slot * index),
      end: roundTime(index === phrases.length - 1 ? end : start + slot * (index + 1)),
      duration: roundTime(index === phrases.length - 1 ? end - (start + slot * index) : slot),
    }));
  });
}

module.exports = {
  splitChineseCaptionIntoPhrases,
  buildPhraseBlocksFromCaptions,
};
```

- [ ] **Step 4: Verify green**

Run:

```powershell
node tests/test-phrase-timeline.js
```

Expected: PASS.

---

### Task 3: Task Agent Spoken Blocks

**Files:**

- Modify: `server/services/agentTemplates.js`
- Modify: `server/services/agentRuns.js`
- Modify: `tests/test-agent-templates.js`
- Modify: `tests/test-agent-runs.js`

- [ ] **Step 1: Write failing prompt tests**

In `tests/test-agent-templates.js`, add assertions that the default viral rewrite prompt includes `spoken_blocks`:

```js
assert.match(defaultViral.systemPrompt, /spoken_blocks/);
assert.match(defaultViral.systemPrompt, /每个 spoken_blocks/);
assert.match(defaultViral.systemPrompt, /短语级/);
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
node tests/test-agent-templates.js
```

Expected: FAIL because prompt does not yet require `spoken_blocks`.

- [ ] **Step 3: Update task Agent prompt**

Modify the viral rewrite system prompt in `server/services/agentTemplates.js`:

```js
'JSON 字段必须包含 spoken_blocks；spoken_blocks 必须是数组，每项包含 id, text, purpose, visual_hint。',
'每个 spoken_blocks.text 必须是适合字幕短语级显示的中文短句，建议 4-16 个汉字，不要写成长句。',
'rewrite_script 必须能由 spoken_blocks 顺序拼接理解；spoken_blocks 用于后续字幕逐块出现和画面对象同步。',
```

- [ ] **Step 4: Verify prompt test green**

Run:

```powershell
node tests/test-agent-templates.js
```

Expected: PASS.

- [ ] **Step 5: Write failing normalization test**

In `tests/test-agent-runs.js`, extend the mocked viral rewrite result to include:

```js
spoken_blocks: [
  { id: 'b1', text: '输入是什么', purpose: 'define_input', visual_hint: 'field_highlight' },
  { id: 'b2', text: '输出是什么', purpose: 'define_output', visual_hint: 'field_highlight' },
],
```

Assert the saved run keeps normalized blocks:

```js
assert.deepStrictEqual(saved.result.spoken_blocks.map(item => item.text), [
  '输入是什么',
  '输出是什么',
]);
```

- [ ] **Step 6: Run test to verify failure**

Run:

```powershell
node tests/test-agent-runs.js
```

Expected: FAIL because `spoken_blocks` is not persisted or normalized.

- [ ] **Step 7: Normalize spoken blocks**

In `server/services/agentRuns.js`, add a helper near existing result normalization:

```js
function normalizeSpokenBlocks(value = []) {
  const blocks = Array.isArray(value) ? value : [];
  return blocks
    .map((block, index) => {
      const source = block && typeof block === 'object' && !Array.isArray(block) ? block : {};
      const text = String(source.text || '').replace(/\s+/g, ' ').trim();
      if (!text) return null;
      return {
        id: String(source.id || `block-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '-'),
        text: text.slice(0, 36),
        purpose: String(source.purpose || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        visual_hint: String(source.visual_hint || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      };
    })
    .filter(Boolean);
}
```

Call it when storing task Agent result:

```js
result.spoken_blocks = normalizeSpokenBlocks(result.spoken_blocks);
```

- [ ] **Step 8: Verify green**

Run:

```powershell
node tests/test-agent-runs.js
```

Expected: PASS.

---

### Task 4: Phrase Captions In Run Orchestration

**Files:**

- Modify: `server/services/agentRuns.js`
- Modify: `tests/test-agent-runs.js`
- Modify: `server/services/phraseTimeline.js`

- [ ] **Step 1: Write failing test for TTS phrase captions**

In the TTS creation test inside `tests/test-agent-runs.js`, assert:

```js
assert.ok(Array.isArray(updatedRun.tts.phrase_captions));
assert.ok(updatedRun.tts.phrase_captions.length > updatedRun.tts.captions.length);
assert.ok(updatedRun.tts.phrase_captions[0].id.startsWith('cap-'));
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
node tests/test-agent-runs.js
```

Expected: FAIL because `tts.phrase_captions` does not exist.

- [ ] **Step 3: Generate phrase captions after TTS captions**

In `server/services/agentRuns.js`, require the new service:

```js
const phraseTimeline = require('./phraseTimeline');
```

After `const captions = ttsTimeline.buildCaptionsFromSegments(segments);`, add:

```js
const phraseCaptions = phraseTimeline.buildPhraseBlocksFromCaptions(captions);
```

Persist under `tts`:

```js
phrase_captions: phraseCaptions,
```

- [ ] **Step 4: Verify green**

Run:

```powershell
node tests/test-agent-runs.js
```

Expected: PASS.

---

### Task 5: Storyboard Agent Receives Phrase Blocks

**Files:**

- Modify: `server/services/storyboardAgent.js`
- Modify: `server/services/agentRuns.js`
- Modify: `tests/test-storyboard-agent.js`
- Modify: `tests/test-agent-runs.js`

- [ ] **Step 1: Write failing storyboard prompt test**

In `tests/test-storyboard-agent.js`, call `buildStoryboardMessages` with:

```js
phraseCaptions: [
  { id: 'cap-1-p1', caption_index: 1, text: '输入是什么', start: 0, end: 1 },
  { id: 'cap-1-p2', caption_index: 1, text: '输出是什么', start: 1, end: 2 },
],
```

Assert:

```js
assert.match(messages[1].content, /短语字幕块/);
assert.match(messages[1].content, /cap-1-p1/);
assert.match(messages[1].content, /caption_block_id/);
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
node tests/test-storyboard-agent.js
```

Expected: FAIL because phrase captions are not injected.

- [ ] **Step 3: Update storyboard message builder**

Modify `buildStoryboardMessages` signature:

```js
function buildStoryboardMessages({
  rewriteScript,
  captions,
  phraseCaptions = [],
  videoBrief = {},
  storyboardOptions = {},
  frameProfileId = DEFAULT_FRAME_PROFILE_ID,
  frameDocText = '',
} = {}) {
```

Add formatted phrase block JSON to user message:

```js
'短语字幕块：',
JSON.stringify((Array.isArray(phraseCaptions) ? phraseCaptions : []).map(block => ({
  id: block.id,
  caption_index: block.caption_index,
  text: block.text,
  start: block.start,
  end: block.end,
})), null, 2),
```

Add rules:

```js
'- visual_scene.beats 中如需绑定字幕，必须使用 caption_block_id 引用短语字幕块 id。',
'- 枚举、顿号和列表内容必须拆成多个 beat，不要一次性显示整句。',
```

- [ ] **Step 4: Pass phrase captions from run orchestration**

In `server/services/agentRuns.js`, when calling storyboard Agent, pass:

```js
phraseCaptions: run.tts?.phrase_captions || [],
```

- [ ] **Step 5: Verify green**

Run:

```powershell
node tests/test-storyboard-agent.js && node tests/test-agent-runs.js
```

Expected: PASS.

---

### Task 6: Schema Support For Caption Block Binding

**Files:**

- Modify: `server/services/storyboardSchema.js`
- Modify: `server/services/hyperframesVisualDsl.js`
- Modify: `tests/test-storyboard-schema.js`
- Modify: `tests/test-hyperframes-visual-dsl.js`

- [ ] **Step 1: Write failing schema test**

In `tests/test-storyboard-schema.js`, add a scene with:

```js
visual_scene: {
  composition: 'checklist_pipeline',
  objects: [
    { id: 'input-field', type: 'field', text: '输入' },
    { id: 'output-field', type: 'field', text: '输出' },
  ],
  motion: [{ target: 'input-field', effect: 'stagger_reveal' }],
  beats: [
    { at: 0, duration: 0.3, target: 'input-field', effect: 'highlight', caption_block_id: 'cap-1-p1' },
    { at: 1, duration: 0.3, target: 'output-field', effect: 'highlight', caption_block_id: 'cap-1-p2' },
  ],
  caption_sync: [
    { caption_index: 1, caption_block_id: 'cap-1-p1', target: 'input-field', effect: 'caption_highlight' },
  ],
}
```

Assert:

```js
assert.equal(result.scenes[0].visual_scene.beats[0].caption_block_id, 'cap-1-p1');
assert.equal(result.scenes[0].visual_scene.caption_sync[0].caption_block_id, 'cap-1-p1');
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
node tests/test-storyboard-schema.js && node tests/test-hyperframes-visual-dsl.js
```

Expected: FAIL because `caption_block_id` is dropped.

- [ ] **Step 3: Preserve caption block IDs**

In `server/services/storyboardSchema.js`, when normalizing beats and caption sync, preserve safe IDs:

```js
caption_block_id: sanitizeId(item.caption_block_id || ''),
```

Use a local helper:

```js
function sanitizeId(value) {
  return sanitizeText(value, 80).replace(/[^a-zA-Z0-9_-]/g, '-');
}
```

- [ ] **Step 4: Pass through prepared DSL**

In `server/services/hyperframesVisualDsl.js`, ensure `beats` and `caption_sync` include `caption_block_id` by using normalized values without remapping them away.

- [ ] **Step 5: Verify green**

Run:

```powershell
node tests/test-storyboard-schema.js && node tests/test-hyperframes-visual-dsl.js
```

Expected: PASS.

---

### Task 7: Phrase Kinetic Caption Rendering

**Files:**

- Modify: `server/services/frameProfiles.js`
- Modify: `server/services/hyperframesProject.js`
- Modify: `tests/test-frame-profiles.js`
- Modify: `tests/test-hyperframes-project.js`

- [ ] **Step 1: Write failing frame profile test**

In `tests/test-frame-profiles.js`, assert:

```js
const phraseOptions = frameProfiles.normalizeFrameOptions({ captionMode: 'phrase_kinetic' });
assert.equal(phraseOptions.captionMode, 'phrase_kinetic');
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
node tests/test-frame-profiles.js
```

Expected: FAIL because `phrase_kinetic` is not allowed.

- [ ] **Step 3: Allow phrase kinetic mode**

In `server/services/frameProfiles.js`, add `phrase_kinetic` to allowed caption modes.

- [ ] **Step 4: Write failing HyperFrames project test**

In `tests/test-hyperframes-project.js`, create a project with:

```js
renderOptions: { captionMode: 'phrase_kinetic' }
```

Assert generated HTML includes:

```js
assert.match(indexHtml, /phrase-caption/);
assert.match(indexHtml, /data-caption-block-id="cap-1-p1"/);
assert.match(indexHtml, /captionMode": "phrase_kinetic"/);
```

- [ ] **Step 5: Run test to verify failure**

Run:

```powershell
node tests/test-hyperframes-project.js
```

Expected: FAIL because phrase captions are not rendered.

- [ ] **Step 6: Render phrase caption spans**

In `server/services/hyperframesProject.js`, add support in `renderCaptionBar`:

```js
if (frameOptions.captionMode === 'phrase_kinetic') {
  const phraseBlocks = Array.isArray(scene.phrase_captions) ? scene.phrase_captions : [];
  const blocks = phraseBlocks.length
    ? phraseBlocks
    : phraseTimeline.buildPhraseBlocksFromCaptions(captions);
  return `<div class="caption-bar caption-bar--phrase">${blocks.map(block => [
    `<span class="phrase-caption" data-caption-block-id="${escapeHtml(block.id)}" data-start="${Number(block.start || 0)}" data-end="${Number(block.end || 0)}">`,
    escapeHtml(block.text || ''),
    '</span>',
  ].join('')).join('')}</div>`;
}
```

Add CSS:

```css
.caption-bar--phrase { display: flex; flex-wrap: wrap; justify-content: center; gap: .38em; }
.phrase-caption { opacity: .32; transform: translateY(8px); display: inline-block; }
.phrase-caption.is-active { opacity: 1; color: var(--accent); text-shadow: 0 0 22px color-mix(in srgb, var(--accent) 40%, transparent); }
```

- [ ] **Step 7: Attach phrase captions to scenes**

When building `sceneHtml`, filter phrase blocks by scene start/end:

```js
const phraseCaptions = Array.isArray(captions.phrase_captions) ? captions.phrase_captions : [];
```

If current function only receives array captions, pass a richer object into `buildIndexHtml` or compute from `storyboard.tts_phrase_captions`. Keep legacy callers working by falling back to `phraseTimeline.buildPhraseBlocksFromCaptions(scene.captions)`.

- [ ] **Step 8: Verify green**

Run:

```powershell
node tests/test-frame-profiles.js && node tests/test-hyperframes-project.js
```

Expected: PASS.

---

### Task 8: Beat-Driven Caption And Visual Sync

**Files:**

- Modify: `server/services/hyperframesAnimations.js`
- Modify: `server/services/hyperframesProject.js`
- Modify: `tests/test-hyperframes-project.js`

- [ ] **Step 1: Write failing animation test**

In `tests/test-hyperframes-project.js`, assert generated HTML timeline includes:

```js
assert.match(indexHtml, /\[data-caption-block-id='cap-1-p1'\]/);
assert.match(indexHtml, /is-active/);
assert.match(indexHtml, /\[data-visual-object='input-field'\]/);
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
node tests/test-hyperframes-project.js
```

Expected: FAIL because caption block highlight animation is missing.

- [ ] **Step 3: Add caption block highlight animation**

In `server/services/hyperframesAnimations.js`, inside beat iteration:

```js
const captionBlockId = String(beat?.caption_block_id || '').replace(/['"\\[\]]/g, '').trim();
if (captionBlockId) {
  const captionSelector = `${sceneId} [data-caption-block-id='${captionBlockId}']`;
  lines.push(`    tl.to("${captionSelector}", { autoAlpha: 1, y: 0, duration: 0.12, ease: "power2.out", onStart: function(){ document.querySelectorAll("${sceneId} .phrase-caption").forEach(function(el){ el.classList.remove("is-active"); }); var el = document.querySelector("${captionSelector}"); if (el) el.classList.add("is-active"); } }, ${beatStart.toFixed(3)});`);
}
```

- [ ] **Step 4: Ensure default phrase reveal without beats**

When `captionMode=phrase_kinetic` and a scene has no beat binding, animate phrase captions by their own `data-start` values:

```js
phraseBlocks.forEach(block => {
  const selector = `${sceneId} [data-caption-block-id='${block.id}']`;
  lines.push(`    tl.to("${selector}", { autoAlpha: 1, y: 0, duration: 0.16, ease: "power2.out" }, ${Number(block.start).toFixed(3)});`);
});
```

- [ ] **Step 5: Verify green**

Run:

```powershell
node tests/test-hyperframes-project.js
```

Expected: PASS.

---

### Task 9: Video Quality Report Service

**Files:**

- Create: `server/services/videoQualityReport.js`
- Create: `tests/test-video-quality-report.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing quality report test**

Create `tests/test-video-quality-report.js`:

```js
const assert = require('assert');
const report = require('../server/services/videoQualityReport');

const result = report.buildVideoQualityReport({
  project: {
    duration: 95.52,
    render_options: { captionMode: 'standard' },
  },
  storyboard: {
    scenes: [
      { visual_type: 'text_card', visual_scene: { beats: [] } },
      { visual_type: 'text_card', visual_scene: { beats: [] } },
      { visual_type: 'text_card', visual_scene: { beats: [] } },
    ],
  },
  captions: [{ index: 1, text: '输入是什么，输出是什么，规则是什么。' }],
  phraseCaptions: [],
  targetDurationSec: 60,
});

assert.equal(result.success, true);
assert.ok(result.score < 70);
assert.ok(result.issues.some(issue => issue.code === 'duration_too_long'));
assert.ok(result.issues.some(issue => issue.code === 'caption_mode_not_phrase'));
assert.ok(result.issues.some(issue => issue.code === 'low_visual_variety'));
assert.ok(result.issues.some(issue => issue.message.includes('中文')));

const good = report.buildVideoQualityReport({
  project: {
    duration: 62,
    render_options: { captionMode: 'phrase_kinetic' },
  },
  storyboard: {
    scenes: [
      { visual_type: 'workflow', visual_scene: { beats: [{ caption_block_id: 'cap-1-p1' }] } },
      { visual_type: 'code_panel', visual_scene: { beats: [{ caption_block_id: 'cap-2-p1' }] } },
      { visual_type: 'timeline', visual_scene: { beats: [{ caption_block_id: 'cap-3-p1' }] } },
    ],
  },
  captions: [{ index: 1, text: '输入是什么，输出是什么。' }],
  phraseCaptions: [{ id: 'cap-1-p1' }, { id: 'cap-2-p1' }, { id: 'cap-3-p1' }],
  targetDurationSec: 60,
});

assert.ok(good.score >= 85);
assert.equal(good.issues.length, 0);

console.log('video quality report tests passed');
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
node tests/test-video-quality-report.js
```

Expected: FAIL with `Cannot find module '../server/services/videoQualityReport'`.

- [ ] **Step 3: Implement report service**

Create `server/services/videoQualityReport.js`:

```js
function uniqueCount(values = []) {
  return new Set(values.filter(Boolean)).size;
}

function addIssue(issues, code, message, penalty) {
  issues.push({ code, message, penalty });
}

function buildVideoQualityReport({
  project = {},
  storyboard = {},
  captions = [],
  phraseCaptions = [],
  targetDurationSec = 60,
} = {}) {
  const issues = [];
  const scenes = Array.isArray(storyboard.scenes) ? storyboard.scenes : [];
  const duration = Number(project.duration || 0);
  const target = Number(targetDurationSec || 60);
  const visualTypes = scenes.map(scene => scene.visual_type || scene.prepared_visual_scene?.visualType || 'text_card');
  const beatCount = scenes.reduce((sum, scene) => sum + (Array.isArray(scene.visual_scene?.beats) ? scene.visual_scene.beats.length : 0), 0);
  const beatWithCaption = scenes.reduce((sum, scene) => sum + (Array.isArray(scene.visual_scene?.beats) ? scene.visual_scene.beats.filter(beat => beat.caption_block_id).length : 0), 0);

  if (duration && target && duration > target * 1.25) {
    addIssue(issues, 'duration_too_long', `实际 TTS 时长 ${duration.toFixed(1)} 秒，明显超过目标 ${target} 秒，容易拖慢视频节奏。`, 18);
  }

  if (project.render_options?.captionMode !== 'phrase_kinetic') {
    addIssue(issues, 'caption_mode_not_phrase', '字幕模式不是中文短语动效，枚举和列表容易整句一次显示。', 18);
  }

  if (scenes.length >= 3 && uniqueCount(visualTypes) < Math.min(3, scenes.length)) {
    addIssue(issues, 'low_visual_variety', '连续分镜的视觉类型变化不足，成片容易呈现 PPT 卡片轮播感。', 16);
  }

  if (scenes.length && beatCount < scenes.length * 2) {
    addIssue(issues, 'low_beat_coverage', '每个分镜的段内视觉事件不足，画面变化跟不上口播。', 16);
  }

  if (beatCount && beatWithCaption / beatCount < 0.5) {
    addIssue(issues, 'low_caption_sync', '多数视觉 beat 没有绑定字幕短语，画面和口播同步关系偏弱。', 12);
  }

  if (!Array.isArray(phraseCaptions) || phraseCaptions.length === 0) {
    addIssue(issues, 'missing_phrase_captions', '没有生成中文短语字幕块，无法做到读到哪一块就显示哪一块。', 20);
  }

  const penalty = issues.reduce((sum, issue) => sum + issue.penalty, 0);
  return {
    success: true,
    score: Math.max(0, 100 - penalty),
    duration,
    target_duration_sec: target,
    scene_count: scenes.length,
    visual_type_count: uniqueCount(visualTypes),
    beat_count: beatCount,
    caption_synced_beat_count: beatWithCaption,
    phrase_caption_count: Array.isArray(phraseCaptions) ? phraseCaptions.length : 0,
    issues,
  };
}

module.exports = {
  buildVideoQualityReport,
};
```

- [ ] **Step 4: Add test to package script**

Modify `package.json` so `node tests/test-video-quality-report.js` runs after `node tests/test-video-quality-report.js` is created and before `node tests/test-agent-templates.js`.

- [ ] **Step 5: Verify green**

Run:

```powershell
node tests/test-video-quality-report.js
```

Expected: PASS.

---

### Task 10: Quality Report Persistence

**Files:**

- Modify: `server/services/agentRuns.js`
- Modify: `server/services/hyperframesProject.js`
- Modify: `tests/test-agent-runs.js`
- Modify: `tests/test-hyperframes-project.js`

- [ ] **Step 1: Write failing project report test**

In `tests/test-hyperframes-project.js`, after creating a project, read `project.json` and assert:

```js
assert.ok(projectJson.video_quality_report);
assert.equal(typeof projectJson.video_quality_report.score, 'number');
assert.ok(Array.isArray(projectJson.video_quality_report.issues));
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
node tests/test-hyperframes-project.js
```

Expected: FAIL because project JSON does not include quality report.

- [ ] **Step 3: Generate report in project creation**

In `server/services/hyperframesProject.js`, require:

```js
const videoQualityReport = require('./videoQualityReport');
```

Before writing `project.json`, compute:

```js
const qualityReport = videoQualityReport.buildVideoQualityReport({
  project: {
    duration,
    render_options: normalizedRenderOptions,
  },
  storyboard,
  captions,
  phraseCaptions,
  targetDurationSec: run?.result?.video_brief?.target_duration_sec || 60,
});
```

Add:

```js
video_quality_report: qualityReport,
```

- [ ] **Step 4: Persist report on run video state**

In `server/services/agentRuns.js`, when storing video project metadata, add:

```js
video_quality_report: result.video_quality_report || result.project?.video_quality_report || null,
```

- [ ] **Step 5: Verify green**

Run:

```powershell
node tests/test-hyperframes-project.js && node tests/test-agent-runs.js
```

Expected: PASS.

---

### Task 11: AI Workbench Controls And Report Display

**Files:**

- Modify: `frontend-react/src/pages/AiWorkspace.jsx`
- Modify: `frontend-react/src/utils/aiWorkspaceDefaults.js`
- Modify: `tests/test-ai-workspace-brief-ui.mjs`
- Modify: `tests/test-ai-workspace-defaults.mjs`

- [ ] **Step 1: Write failing UI default test**

In `tests/test-ai-workspace-defaults.mjs`, assert:

```js
assert.equal(DEFAULT_RENDER_OPTIONS.captionMode, 'phrase_kinetic');
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
node tests/test-ai-workspace-defaults.mjs
```

Expected: FAIL because default caption mode is `standard`.

- [ ] **Step 3: Update default render options**

In `frontend-react/src/utils/aiWorkspaceDefaults.js`, set:

```js
captionMode: 'phrase_kinetic',
```

- [ ] **Step 4: Write failing AI workspace UI test**

In `tests/test-ai-workspace-brief-ui.mjs`, assert the page source includes:

```js
assert.match(source, /短语动效/);
assert.match(source, /质量评分/);
assert.match(source, /实际时长/);
assert.match(source, /目标时长/);
```

- [ ] **Step 5: Run test to verify failure**

Run:

```powershell
node tests/test-ai-workspace-brief-ui.mjs
```

Expected: FAIL because quality report UI is absent.

- [ ] **Step 6: Add caption mode option**

In `AiWorkspace.jsx`, add a render option:

```jsx
<option value="phrase_kinetic">短语动效</option>
```

Keep existing `standard` and `kinetic` options available for compatibility.

- [ ] **Step 7: Display quality report**

In the active run video/project panel, render:

```jsx
{activeRun.video?.video_quality_report ? (
  <div className="qualityReportPanel">
    <strong>质量评分：{activeRun.video.video_quality_report.score}</strong>
    <span>目标时长：{activeRun.video.video_quality_report.target_duration_sec} 秒</span>
    <span>实际时长：{activeRun.video.video_quality_report.duration?.toFixed?.(1) || activeRun.video.video_quality_report.duration} 秒</span>
    {activeRun.video.video_quality_report.issues?.map(issue => (
      <p key={issue.code}>{issue.message}</p>
    ))}
  </div>
) : null}
```

- [ ] **Step 8: Verify green**

Run:

```powershell
node tests/test-ai-workspace-defaults.mjs && node tests/test-ai-workspace-brief-ui.mjs
```

Expected: PASS.

---

### Task 12: Analysis CLI For Rendered MP4 And Project

**Files:**

- Create: `scripts/analyze-video-quality.js`
- Create: `tests/test-video-quality-report.js`

- [ ] **Step 1: Write failing CLI export test**

Append to `tests/test-video-quality-report.js`:

```js
assert.equal(typeof report.loadProjectQualityInputs, 'function');
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
node tests/test-video-quality-report.js
```

Expected: FAIL because loader is not defined.

- [ ] **Step 3: Implement project input loader**

In `server/services/videoQualityReport.js`, add:

```js
const fs = require('fs');
const path = require('path');

function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function loadProjectQualityInputs(projectDir) {
  const root = path.resolve(projectDir);
  return {
    project: readJsonIfExists(path.join(root, 'project.json'), {}),
    storyboard: readJsonIfExists(path.join(root, 'storyboard.json'), {}),
    captions: readJsonIfExists(path.join(root, 'captions.json'), []),
  };
}
```

Export it.

- [ ] **Step 4: Create CLI wrapper**

Create `scripts/analyze-video-quality.js`:

```js
#!/usr/bin/env node
const path = require('path');
const videoQualityReport = require('../server/services/videoQualityReport');

const projectDir = process.argv[2];
if (!projectDir) {
  console.error('用法：node scripts/analyze-video-quality.js <HyperFrames工程目录>');
  process.exit(1);
}

const inputs = videoQualityReport.loadProjectQualityInputs(path.resolve(projectDir));
const report = videoQualityReport.buildVideoQualityReport({
  ...inputs,
  phraseCaptions: inputs.project.phrase_captions || inputs.project.tts_phrase_captions || [],
  targetDurationSec: inputs.project.target_duration_sec || 60,
});

console.log(JSON.stringify(report, null, 2));
process.exit(report.score >= 70 ? 0 : 2);
```

- [ ] **Step 5: Verify CLI on latest existing project**

Run:

```powershell
node scripts/analyze-video-quality.js "D:/code3/MediaCrawler-GUI/data/media/douyin/7626629893899488555/agent_runs/20260610-043953-998Z-ea9d4c-viral_rewrite-hyperframes"
```

Expected before regenerated project may exit 2 and report issues. This is acceptable for the old sample.

---

### Task 13: End-To-End Regeneration Check

**Files:**

- Modify only if required by failing tests:
  - `server/services/agentRuns.js`
  - `server/services/hyperframesProject.js`
  - `server/services/hyperframesRenderer.js`

- [ ] **Step 1: Run focused unit tests**

Run:

```powershell
node tests/test-phrase-timeline.js
node tests/test-video-quality-report.js
node tests/test-storyboard-agent.js
node tests/test-storyboard-schema.js
node tests/test-frame-profiles.js
node tests/test-hyperframes-project.js
node tests/test-agent-runs.js
node tests/test-ai-workspace-defaults.mjs
node tests/test-ai-workspace-brief-ui.mjs
```

Expected: all PASS.

- [ ] **Step 2: Generate a new project from existing latest run**

Use a one-off Node command:

```powershell
node -e "const fs=require('fs'); const p=require('./server/services/hyperframesProject'); (async()=>{ const run=JSON.parse(fs.readFileSync('data/media/douyin/7626629893899488555/agent_runs/20260610-043953-998Z-ea9d4c-viral_rewrite.json','utf8')); const result=await p.createOriginalCaptionProject({run, projectDir:'data/media/douyin/7626629893899488555/agent_runs/20260610-043953-998Z-ea9d4c-viral_rewrite-stage7-check', renderOptions:{resolution:'720x1280', fps:'30', quality:'high', motionLevel:'high', captionMode:'phrase_kinetic', showCaptionBar:true, showSceneNumber:true}}); console.log(JSON.stringify({success:result.success,message:result.message,project_dir:result.project_dir,duration:result.duration,score:result.video_quality_report&&result.video_quality_report.score},null,2)); if(!result.success) process.exit(1); })().catch(e=>{console.error(e); process.exit(1);})"
```

Expected: `success: true`, project directory created, quality score printed.

- [ ] **Step 3: Analyze generated project**

Run:

```powershell
node scripts/analyze-video-quality.js "D:/code3/MediaCrawler-GUI/data/media/douyin/7626629893899488555/agent_runs/20260610-043953-998Z-ea9d4c-viral_rewrite-stage7-check"
```

Expected: exit 0 if score is at least 70. If score is below 70, inspect reported issues and return to the task that owns the failing metric.

- [ ] **Step 4: Render MP4**

Run the existing renderer path used by the app, or call HyperFrames CLI from the generated project:

```powershell
npx --yes hyperframes render -o "D:/code3/MediaCrawler-GUI/.codex-logs/stage7-output.mp4"
```

Expected: MP4 created. If HyperFrames CLI requires running from the project directory, run with `workdir` set to the generated project path.

- [ ] **Step 5: Extract one frame per second**

Run:

```powershell
New-Item -ItemType Directory -Force -Path "D:/code3/MediaCrawler-GUI/.codex-logs/stage7_frames" | Out-Null
ffmpeg -hide_banner -y -i "D:/code3/MediaCrawler-GUI/.codex-logs/stage7-output.mp4" -vf "fps=1,scale=180:-1" "D:/code3/MediaCrawler-GUI/.codex-logs/stage7_frames/frame_%03d.jpg"
ffmpeg -hide_banner -y -framerate 1 -i "D:/code3/MediaCrawler-GUI/.codex-logs/stage7_frames/frame_%03d.jpg" -vf "scale=180:320,tile=9x9" -frames:v 1 "D:/code3/MediaCrawler-GUI/.codex-logs/stage7_contact.jpg"
```

Expected: contact sheet exists at `D:/code3/MediaCrawler-GUI/.codex-logs/stage7_contact.jpg`.

- [ ] **Step 6: Compare against baseline**

Open these images visually:

```text
D:/code3/MediaCrawler-GUI/.codex-logs/video_compare/output1_contact.jpg
D:/code3/MediaCrawler-GUI/.codex-logs/stage7_contact.jpg
```

Expected visual acceptance:

- New video uses `phrase_kinetic` captions.
- Enumerations and list phrases appear progressively.
- Scene body is not dominated by the same card template for most of the video.
- Each scene has visible internal changes beyond one entrance animation.
- At least 3 visual types appear across the rendered video.

---

### Task 14: Full Verification

**Files:**

- No new files expected.

- [ ] **Step 1: Run full test suite**

Run:

```powershell
npm test
```

Expected: PASS with all test scripts succeeding.

- [ ] **Step 2: Build frontend**

Run:

```powershell
npm run build:frontend
```

Expected: exit 0.

- [ ] **Step 3: Inspect git diff**

Run:

```powershell
git diff --stat
git diff -- server/services/phraseTimeline.js server/services/videoQualityReport.js server/services/hyperframesProject.js server/services/hyperframesAnimations.js frontend-react/src/pages/AiWorkspace.jsx
```

Expected: changes are limited to AI workbench/video pipeline and tests.

- [ ] **Step 4: Final manual evidence**

Collect and report:

- `npm test` exit code and summary.
- `npm run build:frontend` exit code.
- Quality report score from regenerated project.
- Generated MP4 path.
- Contact sheet path.
- Any known remaining gaps.

---

## Acceptance Criteria

- `captionMode=phrase_kinetic` is available and becomes the AI workbench default.
- TTS output stores `tts.phrase_captions`.
- Storyboard Agent prompt receives phrase captions and asks for `caption_block_id`.
- `visual_scene.beats` preserves `caption_block_id`.
- HyperFrames output renders phrase caption spans with `data-caption-block-id`.
- GSAP timeline highlights visual objects and phrase captions from beat timing.
- Generated project JSON includes `video_quality_report`.
- AI workbench displays quality score, target duration, actual duration, and Chinese issue messages.
- A new project generated from the current Vibe Coding run can be analyzed with `scripts/analyze-video-quality.js`.
- Full tests pass with `npm test`.
- Frontend builds with `npm run build:frontend`.

## Known Risks And Boundaries

- This plan does not add external image generation or video generation services.
- This plan keeps HyperFrames as the renderer and does not replace it with another video engine.
- The first implementation can use approximate phrase timing based on caption duration distribution; forced-alignment per word is out of scope.
- If a previous run lacks `spoken_blocks`, the system must fall back to phrase blocks generated from TTS captions.
- If a storyboard lacks `caption_block_id`, the renderer must still reveal phrase captions by their own phrase timing.

