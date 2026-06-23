# html-video Production Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the creative-video production path reliably render real `html-video` output, stop hiding `html-video` failures behind Legacy fallback, and move the generation chain closer to `D:\code3\html-video`.

**Architecture:** Fix the render adapter first so generated HTML frames become valid MP4 segments. Then make workflow fallback explicit and non-silent. Finally add a full `content graph -> per-frame complete HTML -> render -> concat -> mux` production path while retaining the current template-input path only as an explicit compatibility mode.

**Tech Stack:** Node.js CommonJS services, Playwright video recording, `ffmpeg`/`ffprobe`, project JSON files, current test style using `node tests/*.js`.

---

## Context

The latest analyzed run was:

- Media id: `20260617132145588589`
- Run id: `20260617-132212-341Z-c080ec-hyperframes_freeform`
- Run JSON: `D:\code3\MediaCrawler-GUI\data\media\douyin\20260617132145588589\agent_runs\20260617-132212-341Z-c080ec-hyperframes_freeform.json`
- html-video project: `D:\code3\MediaCrawler-GUI\data\media\douyin\20260617132145588589\agent_runs\20260617-132212-341Z-c080ec-hyperframes_freeform-html-video`
- Final displayed output: `D:\code3\MediaCrawler-GUI\data\media\douyin\20260617132145588589\agent_runs\20260617-132212-341Z-c080ec-hyperframes_freeform-hyperframes-lite\output.mp4`

Evidence from that run:

- Final `render_mode` was `legacy`, not `html-video`.
- html-video generated frame HTML files but failed rendering `scene_01.mp4`.
- `frames\scene_01.mp4` was 48 bytes and `ffprobe` reported `moov atom not found`.
- Reproducing through `frameRenderer.renderFrame()` showed `leadInMs` around 19.9s while the recorded WebM was around 10.6s, so ffmpeg seek started beyond the input duration.
- Using system `ffmpeg` avoided non-zero exit but still produced a 262-byte MP4 with no video stream.
- Current html-video generation is template-input based: one selected template, cloned inputs per scene, then local materialization. This is not the same as `D:\code3\html-video`, which generates a content graph and then one complete HTML document per frame.

Reference implementation locations:

- `D:\code3\html-video\packages\adapter-hyperframes\src\render.ts`
- `D:\code3\html-video\packages\cli\src\studio-server.ts`
- `D:\code3\html-video\packages\core\src\project.ts`
- `D:\code3\html-video\packages\content-graph\src\index.ts`

Current repo locations:

- `D:\code3\MediaCrawler-GUI\server\services\creative-video\workflowFacade.js`
- `D:\code3\MediaCrawler-GUI\server\services\creative-video\html-video\htmlVideoWorkflow.js`
- `D:\code3\MediaCrawler-GUI\server\services\creative-video\html-video\hyperframesPlaywrightAdapter.js`
- `D:\code3\MediaCrawler-GUI\server\services\creative-video\html-video\environmentDoctor.js`
- `D:\code3\MediaCrawler-GUI\server\services\creative-video\html-video\ffmpegComposer.js`
- `D:\code3\MediaCrawler-GUI\server\services\creative-video\html-video\sceneSpecMapper.js`
- `D:\code3\MediaCrawler-GUI\server\routes\agents.js`

## Required Project Rules

- Work only on branch `dev`.
- Do not modify `D:\code3\html-video`; use it as reference only.
- User-facing messages must be Chinese by default.
- Git commit messages must be Chinese if commits are requested.
- Use `Get-Content -Encoding UTF8` when reading Chinese files in PowerShell.
- Use TDD for production behavior changes: write the failing test, run it, then implement.
- Do not claim success without fresh verification output.

## Files Map

Expected modified files:

- `server/services/creative-video/html-video/hyperframesPlaywrightAdapter.js`
  - Clamp or disable unsafe lead-in seek.
  - Probe recorded WebM duration.
  - Validate rendered MP4 contains a video stream.
  - Return concise Chinese diagnostics.

- `server/services/creative-video/html-video/environmentDoctor.js`
  - Resolve ffmpeg closer to reference behavior: `FFMPEG_PATH`, then PATH `ffmpeg`, then installer fallback.
  - Keep injectable command runner for tests.

- `server/services/creative-video/html-video/ffmpegComposer.js`
  - Align ffmpeg/ffprobe resolution with adapter if needed.
  - Expose or reuse probe helpers if useful.

- `server/services/creative-video/workflowFacade.js`
  - Disable html-video failure -> legacy fallback by default.
  - When fallback is explicitly enabled, mark it clearly as fallback in `render_mode`, message, and diagnostics.

- `server/routes/agents.js`
  - Ensure run state and file route do not hide html-video failure behind a legacy output path.

- `server/services/creative-video/html-video/htmlVideoWorkflow.js`
  - Route production generation to full graph/per-frame HTML path once available.
  - Keep template-input mode as explicit compatibility path.

Expected new files:

- `server/services/creative-video/html-video/contentGraphAgent.js`
  - Build graph prompt.
  - Parse strict graph JSON.
  - Normalize graph nodes.

- `server/services/creative-video/html-video/frameHtmlAgent.js`
  - Build one prompt per frame.
  - Extract complete HTML from model output.
  - Retry once with a shorter prompt on empty or invalid HTML.

- `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`
  - Write generated raw HTML frames.
  - Build project frames with `source_mode: "raw_html"`.

Expected tests:

- `tests/test-html-video-playwright-adapter-command.js`
- `tests/test-html-video-frame-renderer.js`
- `tests/test-html-video-workflow.js`
- `tests/test-creative-video-workflow-facade.js`
- `tests/test-agent-runs.js`
- New: `tests/test-html-video-content-graph-agent.js`
- New: `tests/test-html-video-frame-html-agent.js`
- New: `tests/test-html-video-raw-html-frame-builder.js`

---

## Task 1: Fix html-video Adapter Lead-In and Output Validation

**Files:**

- Modify: `server/services/creative-video/html-video/hyperframesPlaywrightAdapter.js`
- Modify if needed: `server/services/creative-video/html-video/environmentDoctor.js`
- Modify if needed: `server/services/creative-video/html-video/ffmpegComposer.js`
- Test: `tests/test-html-video-playwright-adapter-command.js`

- [ ] **Step 1: Add a failing test for unsafe seek clamping**

Add a test case that calls `buildFfmpegArgs()` with `leadInMs` larger than the input duration and asserts the generated args do not seek past the usable input range.

Target behavior:

```js
const args = buildFfmpegArgs({
  webmPath: 'input.webm',
  outputPath: 'output.mp4',
  fps: 30,
  duration: 2.56,
  explicit: true,
  leadInMs: 19936,
  inputDurationSec: 10.6,
});

const ssIndex = args.indexOf('-ss');
assert.equal(ssIndex, -1, 'unsafe lead-in seek should be disabled when it exceeds input duration');
```

Run:

```powershell
node tests/test-html-video-playwright-adapter-command.js
```

Expected before implementation: FAIL because `buildFfmpegArgs()` currently has no `inputDurationSec` parameter and still emits unsafe `-ss`.

- [ ] **Step 2: Add a failing test for ffmpeg success with invalid MP4**

In the adapter command test, inject `runFfmpeg` that returns `{ ok: true }`, then inject a probe result showing no video stream. The adapter must return or throw `render-failed` instead of success.

Use dependency injection rather than real Playwright when possible. If the current test helper already mocks Playwright, extend it.

Expected error message should include Chinese text similar to:

```text
html-video 编码完成但输出视频无有效画面流。
```

Run:

```powershell
node tests/test-html-video-playwright-adapter-command.js
```

Expected before implementation: FAIL because the adapter currently trusts ffmpeg exit code and file stat only.

- [ ] **Step 3: Implement WebM duration probing and safe seek**

In `hyperframesPlaywrightAdapter.js`:

- Add a helper like `probeMediaDurationSec(filePath, deps)`.
- Prefer injectable `deps.probeMedia` or `deps.runFfprobe` in tests.
- If duration is missing or invalid, do not use a seek that could exceed the recording.
- Update `buildFfmpegArgs()` signature to accept `inputDurationSec`.
- Disable `-ss` if `seekSec + duration > inputDurationSec - 0.1`.
- Keep existing behavior for safe `leadInMs`.

Suggested rule:

```js
function safeSeekSec({ leadInMs, duration, inputDurationSec }) {
  const proposed = leadInMs > 200 ? Math.max(0, (leadInMs - 120) / 1000) : 0;
  if (!proposed) return 0;
  if (!Number.isFinite(inputDurationSec) || inputDurationSec <= 0) return 0;
  if (proposed + duration > Math.max(0, inputDurationSec - 0.1)) return 0;
  return proposed;
}
```

- [ ] **Step 4: Implement output video validation**

In `hyperframesPlaywrightAdapter.js`:

- After ffmpeg exits ok, validate the output path.
- Require file size above a small minimum such as 2048 bytes.
- Require at least one video stream via ffprobe or injected probe.
- If validation fails, throw `createRenderError('render-failed', 'html-video 编码完成但输出视频无有效画面流。')`.

Keep diagnostics concise. Do not expose full ffmpeg stderr as the main user-facing message.

- [ ] **Step 5: Prefer PATH ffmpeg over installer fallback**

In `environmentDoctor.js`:

- Keep `process.env.FFMPEG_PATH` first.
- On Windows use `where.exe ffmpeg`, on non-Windows use `which ffmpeg`.
- If a PATH ffmpeg is found, use it before `@ffmpeg-installer/ffmpeg`.
- Fall back to installer only when PATH lookup fails.

Keep `options.ffmpegPath` and test injection behavior.

- [ ] **Step 6: Verify Task 1**

Run:

```powershell
node tests/test-html-video-playwright-adapter-command.js
node tests/test-html-video-frame-renderer.js
```

Expected: both pass.

Then manually rerun the latest single frame:

```powershell
@'
const fs=require('fs');
const path=require('path');
const frameRenderer=require('./server/services/creative-video/html-video/frameRenderer');
(async()=>{
  const projectDir=path.resolve('data/media/douyin/20260617132145588589/agent_runs/20260617-132212-341Z-c080ec-hyperframes_freeform-html-video');
  const project=JSON.parse(fs.readFileSync(path.join(projectDir,'project.json'),'utf8'));
  const frame=project.frames[0];
  const out=path.join(process.env.TEMP,'hv-fixed-scene01.mp4');
  try{fs.rmSync(out,{force:true});}catch(e){}
  const res=await frameRenderer.renderFrame(frame,{projectDir, outputPath:out, resolution:project.output.resolution, fps:project.output.fps});
  console.log(JSON.stringify({res, exists:fs.existsSync(out), size:fs.existsSync(out)?fs.statSync(out).size:0}, null, 2));
})().catch(e=>{console.error(e); process.exit(1);});
'@ | node -
ffprobe -v error -show_streams -show_format -of json "$env:TEMP\hv-fixed-scene01.mp4"
```

Expected: render succeeds, output size is meaningful, `ffprobe` shows one video stream.

---

## Task 2: Stop Silent Legacy Fallback

**Files:**

- Modify: `server/services/creative-video/workflowFacade.js`
- Modify if needed: `server/routes/agents.js`
- Test: `tests/test-creative-video-workflow-facade.js`
- Test: `tests/test-agent-runs.js`

- [ ] **Step 1: Add failing facade test for default fallback disabled**

Add a test where `htmlVideoWorkflow.generateHtmlVideo()` returns failure and `HTML_VIDEO_LEGACY_FALLBACK_ENABLED` is unset.

Expected:

- `result.success === false`
- Legacy `projectWriter` is not called.
- `result.render_mode === 'html-video'`
- `result.legacy_fallback_reason` is present.
- Diagnostics include html-video failure details.

Run:

```powershell
node tests/test-creative-video-workflow-facade.js
```

Expected before implementation: FAIL because fallback currently defaults to enabled.

- [ ] **Step 2: Add explicit fallback-enabled behavior test**

Set `process.env.HTML_VIDEO_LEGACY_FALLBACK_ENABLED = 'true'`.

Expected:

- Legacy path may run.
- Final message must include Chinese wording like `html-video 失败，已回退到 Legacy 模式。`
- `render_mode === 'legacy'`
- `legacy_fallback_reason` is present.

Run:

```powershell
node tests/test-creative-video-workflow-facade.js
```

- [ ] **Step 3: Change fallback default**

In `workflowFacade.js`, change:

```js
envFlag('HTML_VIDEO_LEGACY_FALLBACK_ENABLED', true)
```

to:

```js
envFlag('HTML_VIDEO_LEGACY_FALLBACK_ENABLED', false)
```

Then ensure failure returns `render_mode: 'html-video'` and does not continue to Rich/Legacy unless fallback is explicitly enabled.

- [ ] **Step 4: Make fallback message explicit**

When fallback is explicitly enabled and used, set message and diagnostics so UI/run JSON makes the fallback obvious.

Suggested message:

```text
html-video 生成失败，已按配置回退到 Legacy 模式。
```

Do not use a plain success message that hides the fallback.

- [ ] **Step 5: Verify route behavior**

Review `server/routes/agents.js` file-output route and run-state update path.

Expected:

- If render failed and no valid html-video output exists, `/files/output.mp4` should not silently point at `hyperframes-lite/output.mp4`.
- If explicit legacy fallback happened, the output path may point to legacy, but run JSON must carry `render_mode: "legacy"` and `legacy_fallback_reason`.

Add or update `tests/test-agent-runs.js` accordingly.

- [ ] **Step 6: Verify Task 2**

Run:

```powershell
node tests/test-creative-video-workflow-facade.js
node tests/test-agent-runs.js
```

Expected: both pass.

---

## Task 3: Add Full Content Graph Agent

**Files:**

- Create: `server/services/creative-video/html-video/contentGraphAgent.js`
- Test: `tests/test-html-video-content-graph-agent.js`
- Reference: `D:\code3\html-video\packages\cli\src\studio-server.ts`

- [ ] **Step 1: Write tests for graph prompt content**

Create `tests/test-html-video-content-graph-agent.js`.

Test that `buildContentGraphPrompt({ sceneSpec, creativeContext, target })` includes:

- Source title/raw text.
- Scene spec title and scenes.
- Target aspect ratio and duration.
- Language.
- Instruction to output strict JSON.
- Data-frame quality rules for comparable units and sane values.
- A schema requiring nodes with `id`, `kind`, `label`, `durationSec`, and either `text` or `data`.

Run:

```powershell
node tests/test-html-video-content-graph-agent.js
```

Expected before implementation: FAIL because file does not exist.

- [ ] **Step 2: Implement prompt builder**

Implement:

```js
function buildContentGraphPrompt({ sceneSpec = {}, creativeContext = {}, target = {} } = {}) {}
```

Prompt requirements:

- Chinese user-facing instruction where appropriate.
- Strict JSON block only.
- Preserve facts from source context.
- Do not invent unsupported concrete data.
- Produce one node per intended frame.
- For data nodes, use:

```json
{
  "title": "string",
  "unit": "optional shared unit",
  "items": [{ "label": "string", "value": 123 }]
}
```

- [ ] **Step 3: Write tests for parse/normalize**

Add tests for:

- Valid fenced JSON block.
- Valid raw JSON.
- Invalid JSON returns `{ success: false }`.
- Missing nodes returns `{ success: false }`.
- Object values never become `[object Object]`.

- [ ] **Step 4: Implement parser**

Implement:

```js
function parseContentGraphResponse(text) {}
function normalizeContentGraph(graph, sceneSpec) {}
```

Normalized output should be compatible with existing `contentGraph.js` helpers.

- [ ] **Step 5: Verify Task 3**

Run:

```powershell
node tests/test-html-video-content-graph-agent.js
```

Expected: pass.

---

## Task 4: Add Per-Frame Complete HTML Agent

**Files:**

- Create: `server/services/creative-video/html-video/frameHtmlAgent.js`
- Test: `tests/test-html-video-frame-html-agent.js`
- Reference: `D:\code3\html-video\packages\cli\src\studio-server.ts`

- [ ] **Step 1: Write tests for frame prompt**

Create `tests/test-html-video-frame-html-agent.js`.

Test that `buildFrameHtmlPrompt()` includes:

- Current frame id and order.
- Current frame content from graph node.
- Whole video synopsis.
- Previous and next frame summaries when available.
- Target resolution.
- Style reference from selected template if available.
- Source context summary.
- Requirement: output exactly one fenced `html` block or complete HTML document.
- Requirement: full-bleed 1920x1080 or target resolution.
- Requirement: visible text tagged with stable data attributes where practical.
- Requirement: no prose outside the HTML block.

Run:

```powershell
node tests/test-html-video-frame-html-agent.js
```

Expected before implementation: FAIL.

- [ ] **Step 2: Implement frame prompt builder**

Implement:

```js
function buildFrameHtmlPrompt({
  graph,
  node,
  index,
  total,
  sceneSpec,
  creativeContext,
  target,
  template,
} = {}) {}
```

Important prompt rules:

- Generate a fresh complete HTML page for this frame.
- Use selected template as style reference, not as a rigid input schema.
- Do not make every frame the same layout.
- Do not include unrelated nav labels such as `Search / GitHub / Tech Forums / Docs / Issues` unless they are relevant content.
- Do not output `[object Object]`.
- Keep Chinese visible text unless technical terms should remain English.

- [ ] **Step 3: Write tests for HTML extraction**

Test:

- Fenced ` ```html ` output is extracted.
- Raw `<!doctype html>...</html>` output is extracted.
- Empty output fails.
- Non-HTML output fails.

- [ ] **Step 4: Implement HTML extraction and retry wrapper**

Implement:

```js
function extractHtmlDocument(text) {}
async function generateFrameHtml({ model, ...args }) {}
```

`generateFrameHtml()` behavior:

- Call model once with full prompt.
- If no valid HTML is extracted, call model once with a shorter retry prompt.
- Return `{ success: true, html }` or `{ success: false, message, diagnostics }`.

- [ ] **Step 5: Verify Task 4**

Run:

```powershell
node tests/test-html-video-frame-html-agent.js
```

Expected: pass.

---

## Task 5: Build Raw HTML Frame Projects

**Files:**

- Create: `server/services/creative-video/html-video/rawHtmlFrameBuilder.js`
- Modify if needed: `server/services/creative-video/html-video/materializer.js`
- Modify if needed: `server/services/creative-video/html-video/projectSchema.js`
- Test: `tests/test-html-video-raw-html-frame-builder.js`

- [ ] **Step 1: Write tests for raw HTML frame project**

Test that the builder:

- Writes `frames/01-scene_01.html`, `frames/02-scene_02.html`, etc.
- Creates frames with `source_mode: "raw_html"`.
- Sets `html_path` to the written relative path.
- Preserves `duration_sec`, `narration_text`, and metadata.
- Does not require `template_inputs`.

Run:

```powershell
node tests/test-html-video-raw-html-frame-builder.js
```

Expected before implementation: FAIL.

- [ ] **Step 2: Implement raw frame builder**

Implement:

```js
async function buildRawHtmlFrameProject({
  projectDir,
  workflowId,
  runId,
  graph,
  frameHtmlByNodeId,
  sceneSpec,
  target,
  template,
} = {}) {}
```

Return a normalized project object compatible with `projectOrchestrator.renderHtmlVideoProject()`.

- [ ] **Step 3: Ensure materializer does not overwrite raw HTML**

If `materializer.materializeProject()` currently assumes `template_id` + inputs, update it so:

- `source_mode: "raw_html"` frames with existing `html_path` are preserved.
- It validates file exists inside project dir.
- It emits a materialized diagnostic without rewriting content.

- [ ] **Step 4: Verify Task 5**

Run:

```powershell
node tests/test-html-video-raw-html-frame-builder.js
node tests/test-html-video-workflow.js
```

Expected: pass.

---

## Task 6: Wire Full html-video Production Path

**Files:**

- Modify: `server/services/creative-video/html-video/htmlVideoWorkflow.js`
- Modify: `server/services/creative-video/html-video/sceneSpecMapper.js` only if compatibility is needed
- Test: `tests/test-html-video-workflow.js`
- Test: `tests/test-html-video-production-regression.js`

- [ ] **Step 1: Add workflow test for full path**

In `tests/test-html-video-workflow.js`, add a test where:

- `services.aiTextModel.callTextModel()` returns graph JSON for the graph prompt.
- It returns different complete HTML documents for each frame prompt.
- `frameRenderer.renderFrame()` is called for each raw HTML frame.

Expected:

- `result.success === true`
- `result.render_mode === 'html-video'`
- `result.project.frames.every(frame => frame.source_mode === 'raw_html')`
- The two or more written HTML files are not identical.
- The old `template_inputs` path is not used by default.

Run:

```powershell
node tests/test-html-video-workflow.js
```

Expected before implementation: FAIL.

- [ ] **Step 2: Add explicit compatibility-mode test**

Add a test that passes an explicit target flag such as:

```js
target: { html_video_generation_mode: 'template_inputs' }
```

Expected:

- Current template-input behavior still works.
- Frames may use `source_mode: "template_inputs"`.

- [ ] **Step 3: Wire graph + frame HTML in workflow**

In `htmlVideoWorkflow.generateHtmlVideo()`:

- Keep environment validation.
- Select template/style if useful.
- Default generation mode should be full raw HTML.
- Call content graph agent.
- For each node, call frame HTML agent.
- Build raw HTML frame project.
- Reuse existing audio logic.
- Call `projectOrchestrator.renderHtmlVideoProject()`.

- [ ] **Step 4: Keep failures hard for html-video**

If graph generation, frame HTML generation, render, concat, mux, or duration verification fails:

- Return `success: false`.
- Include `fallback_allowed` only for explicit compatibility mode or explicit fallback config.
- Include concise Chinese diagnostics.

- [ ] **Step 5: Verify Task 6**

Run:

```powershell
node tests/test-html-video-workflow.js
node tests/test-html-video-production-regression.js
```

Expected: pass.

---

## Task 7: Strengthen Prompts and Source Context

**Files:**

- Modify: `server/services/creative-video/sceneSpecService.js`
- Modify: `server/services/creative-video/html-video/contentGraphAgent.js`
- Modify: `server/services/creative-video/html-video/frameHtmlAgent.js`
- Test existing or new prompt tests

- [ ] **Step 1: Add tests for context inclusion**

Add tests that pass `creativeContext` with:

- `input.raw_text`
- `input.title`
- `source_context.summary`
- `brief.summary`
- comment or secondary-comment summaries if present in current data shape
- audio/narration text if present

Expected prompt includes compact but meaningful context.

- [ ] **Step 2: Add tests for visual anti-repetition rules**

Prompt tests should assert these rules appear:

- Do not make all frames use the same main layout.
- Do not only change bottom captions.
- Do not leave irrelevant template labels.
- Do not output `[object Object]`.
- Do not invent precise facts absent from source context.

- [ ] **Step 3: Implement prompt enhancements**

Add a shared helper if useful:

```js
function summarizeCreativeContextForPrompt(creativeContext = {}) {}
```

Keep it deterministic and bounded. Do not add new model calls just to summarize.

- [ ] **Step 4: Verify Task 7**

Run:

```powershell
node tests/test-html-video-content-graph-agent.js
node tests/test-html-video-frame-html-agent.js
node tests/test-creative-video-scene-spec.js
```

Expected: pass.

---

## Task 8: End-to-End Verification on Latest Project

**Files:**

- No production edit unless verification exposes a bug.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
node tests/test-html-video-playwright-adapter-command.js
node tests/test-html-video-frame-renderer.js
node tests/test-html-video-content-graph-agent.js
node tests/test-html-video-frame-html-agent.js
node tests/test-html-video-raw-html-frame-builder.js
node tests/test-html-video-workflow.js
node tests/test-creative-video-workflow-facade.js
node tests/test-agent-runs.js
node tests/test-html-video-production-regression.js
node tests/test-html-video-scene-spec-mapper.js
node tests/test-creative-video-scene-spec.js
```

Expected: all exit code 0.

- [ ] **Step 2: Re-render latest html-video project**

Use latest project:

```text
D:\code3\MediaCrawler-GUI\data\media\douyin\20260617132145588589\agent_runs\20260617-132212-341Z-c080ec-hyperframes_freeform-html-video
```

Re-render through the actual workflow or orchestrator, not by hand-copying files.

- [ ] **Step 3: Probe output**

Run:

```powershell
ffprobe -v error -show_streams -show_format -of json "PATH_TO_FINAL_OUTPUT.mp4"
```

Expected:

- One video stream.
- One audio stream if narration exists.
- Duration close to scene spec total duration.
- File size clearly larger than a few KB.

- [ ] **Step 4: Generate contact sheet**

Run:

```powershell
ffmpeg -y -i "PATH_TO_FINAL_OUTPUT.mp4" -vf "fps=1/4,scale=360:-1,tile=4x3" -frames:v 1 "$env:TEMP\html-video-fixed-contact-sheet.jpg"
```

Expected:

- Main picture changes across scenes.
- No fixed “带上你自己的 Agent。” from fallback.
- No `[object Object]`.
- No empty main screen.

- [ ] **Step 5: Restart backend**

Stop any old backend process on port 3000 and start:

```powershell
node server/index.js
```

Keep the server running and report PID/URL.

---

## Acceptance Criteria

- html-video render no longer produces 48-byte or 262-byte invalid MP4 files as success.
- Unsafe lead-in seek is clamped or disabled.
- MP4 output is validated for a real video stream.
- Default html-video failure does not silently fall back to Legacy.
- Explicit Legacy fallback, if enabled, is clearly labeled in run JSON and user-facing message.
- Default production generation uses content graph and per-frame complete HTML, not only one template with changed text fields.
- Latest project can be re-rendered into a valid video.
- Contact sheet shows scene-specific main visuals.
- Focused tests pass with fresh output.

## Known Risks

- Full per-frame HTML generation increases model calls and runtime.
- Existing UI may assume `render.status === rendered` even for fallback; route/run-state tests should catch this.
- Some current templates may still be useful as style references but should not constrain every frame to identical layout.
- Real model output may vary; parser and retry logic must be strict enough to fail clearly but tolerant enough to extract valid fenced HTML.

