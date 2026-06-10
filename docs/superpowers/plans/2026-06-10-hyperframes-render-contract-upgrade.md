# HyperFrames Render Contract Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade HyperFrames storyboard rendering from static object layout to executable scene choreography, and add the provided Creative Mode Frame as an optional profile.

**Architecture:** `storyboardSchema` owns the render contract normalization and validation. `storyboardAgent` asks the AI for executable `visual_scene.beats`, `composition`, and caption sync. `hyperframesSceneRenderers` renders composition-specific DOM, while `hyperframesAnimations` consumes normalized beats to drive GSAP timing. `frameProfiles` exposes `creative_brutalist` without replacing the default `tech_neon`.

**Tech Stack:** Node.js CommonJS services, plain Node assertion tests, HyperFrames HTML/CSS/GSAP renderer.

---

### Task 1: Visual DSL Contract

**Files:**
- Modify: `server/services/storyboardSchema.js`
- Modify: `server/services/hyperframesVisualDsl.js`
- Test: `test-storyboard-schema.js`
- Test: `test-hyperframes-visual-dsl.js`

- [ ] **Step 1: Write failing tests**

Add tests that verify `visual_scene.beats`, semantic `composition`, `caption_sync`, object `stage/accent`, and fallback beats are normalized and validated.

- [ ] **Step 2: Run tests to verify failure**

Run: `node test-storyboard-schema.js && node test-hyperframes-visual-dsl.js`

Expected: failure because `beats` and `caption_sync` are not preserved.

- [ ] **Step 3: Implement minimal schema support**

Add allowed composition/effect constants, normalize `visual_scene.beats`, normalize optional object stage/accent fields, and pass the new fields through `prepareSceneDsl`.

- [ ] **Step 4: Verify green**

Run: `node test-storyboard-schema.js && node test-hyperframes-visual-dsl.js`

Expected: both tests pass.

### Task 2: Storyboard Agent Prompt

**Files:**
- Modify: `server/services/storyboardAgent.js`
- Test: `test-storyboard-agent.js`

- [ ] **Step 1: Write failing tests**

Assert the prompt asks the AI to output `visual_scene.beats`, semantic `composition`, `caption_sync`, and to describe how each scene is built over time rather than only listing static objects.

- [ ] **Step 2: Run test to verify failure**

Run: `node test-storyboard-agent.js`

Expected: failure because the prompt still only requires `composition/objects/motion`.

- [ ] **Step 3: Implement prompt update**

Update default and editable prompts to position the agent as a HyperFrames choreography expert and require executable beats.

- [ ] **Step 4: Verify green**

Run: `node test-storyboard-agent.js`

Expected: test passes.

### Task 3: Renderer And Animation Choreography

**Files:**
- Modify: `server/services/hyperframesSceneRenderers.js`
- Modify: `server/services/hyperframesAnimations.js`
- Modify: `server/services/hyperframesProject.js`
- Test: `test-hyperframes-scene-renderers.js`
- Test: `test-hyperframes-project.js`

- [ ] **Step 1: Write failing tests**

Assert composition-specific DOM for `formula_build`, `process_flow`, `code_walkthrough`, `timeline_sync`, `checklist_pipeline`, and beat-driven GSAP selectors.

- [ ] **Step 2: Run tests to verify failure**

Run: `node test-hyperframes-scene-renderers.js && node test-hyperframes-project.js`

Expected: failure because current renderer does not output these composition wrappers or beat animations.

- [ ] **Step 3: Implement renderer support**

Render composition-specific wrappers and classes while keeping legacy visual types working.

- [ ] **Step 4: Implement beat animation support**

Generate GSAP steps from normalized beats with safe selector targeting and composition-specific defaults.

- [ ] **Step 5: Verify green**

Run: `node test-hyperframes-scene-renderers.js && node test-hyperframes-project.js`

Expected: both tests pass.

### Task 4: Creative Brutalist Frame Profile

**Files:**
- Create: `docs/frame/creative-brutalist.frame.md`
- Modify: `server/services/frameProfiles.js`
- Modify: `server/services/hyperframesProject.js`
- Test: `test-frame-profiles.js`
- Test: `test-hyperframes-project.js`

- [ ] **Step 1: Write failing tests**

Assert `creative_brutalist` is allowed, normalizes correctly, returns cream/ink/accent variables, and appears in generated HTML when selected.

- [ ] **Step 2: Run tests to verify failure**

Run: `node test-frame-profiles.js && node test-hyperframes-project.js`

Expected: failure because only `tech_neon` is supported.

- [ ] **Step 3: Add profile**

Add the Creative Mode Frame as an optional profile, preserving `tech_neon` as default.

- [ ] **Step 4: Verify green**

Run: `node test-frame-profiles.js && node test-hyperframes-project.js`

Expected: both tests pass.

### Task 5: Final Verification

**Files:**
- All changed files

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: all configured tests pass.

- [ ] **Step 2: Review git diff**

Run: `git diff --stat && git diff -- server/services/storyboardSchema.js server/services/storyboardAgent.js server/services/hyperframesSceneRenderers.js server/services/hyperframesAnimations.js server/services/frameProfiles.js`

Expected: diff is scoped to render contract, prompt, renderer, profile, tests, and docs.
