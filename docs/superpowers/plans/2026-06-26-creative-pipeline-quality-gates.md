# Creative Pipeline Quality Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent one-click creative runs from publishing videos whose narration was semantically truncated or whose generated content graph no longer matches the scene script.

**Architecture:** Keep `scene_spec` as the contract between audio, content graph, frames, and render. Prefer retiming within the requested duration over trimming narration; if a graph/frame diverges from `scene_spec`, retry once or fail instead of silently publishing fallback-looking output.

**Tech Stack:** Node.js services, existing assert-based tests, `ffprobe`/render checks where already available.

---

## File Structure

- Modify `server/services/agentRuns.js`: change freeform narration budget fitting so per-scene over-budget text is retimed when the total target has room, and only trimmed when the total narration itself is over target.
- Modify `server/services/creative-video/narrationQuality.js`: detect conditional/lead-in sentence fragments that have terminal punctuation but lost their conclusion.
- Modify `server/services/creative-video/html-video/contentGraphAgent.js`: make scene ids/count a hard prompt contract and fail retry parsing when the graph does not match expected scenes.
- Modify `server/services/creative-video/html-video/htmlVideoWorkflow.js` or the existing caller path if graph retry is centralized there: stop treating `content_graph_scene_spec_mismatch` as a publishable fallback after retry.
- Test `tests/test-agent-runs-freeform-audio-budget.js`: add regression for preserving the pnpm conclusion when total duration still fits.
- Test `tests/test-agent-runs-incomplete-narration.js`: add regression for conditional fragments such as `如果你正在启动新项目。`.
- Test `tests/test-html-video-content-graph-retry.js` or `tests/test-html-video-content-graph-agent.js`: add graph scene id mismatch retry/fail behavior.

---

### Task 1: Narration Quality Regression

**Files:**
- Modify: `tests/test-agent-runs-freeform-audio-budget.js`
- Modify: `tests/test-agent-runs-incomplete-narration.js`

- [x] **Step 1: Add a failing budget test for semantic preservation**

Add this case after the existing budget assertions in `tests/test-agent-runs-freeform-audio-budget.js`:

```js
  const semanticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-semantic-budget-'));
  const semanticAwemeId = '20260626061707994796';
  const semanticRunId = 'semantic-budget';
  const semanticRunDir = path.join(semanticRoot, semanticAwemeId, 'agent_runs');
  fs.mkdirSync(semanticRunDir, { recursive: true });
  const semanticScenes = [
    { index: 1, headline: '开场', narration_text: 'npm、Yarn、pnpm都是Node.js的包管理器。' },
    { index: 2, headline: '结尾', target_duration_sec: 3, narration_text: '如果你正在启动新项目，pnpm 通常是目前最均衡的选择。' },
  ];
  fs.writeFileSync(path.join(semanticRunDir, `${semanticRunId}.json`), JSON.stringify({
    success: true,
    run_id: semanticRunId,
    template: 'hyperframes_freeform',
    aweme_id: semanticAwemeId,
    status: 'ready',
    result: { video_brief: { target_duration_sec: 60 } },
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: '语义预算测试',
          target_duration_sec: 60,
          storyboard: { scenes: semanticScenes },
        },
      },
    },
  }, null, 2));

  let semanticCaptured = null;
  const semanticResult = await agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(semanticAwemeId, semanticRunId, {
    rootDir: semanticRoot,
    sceneTtsService: {
      synthesizeSceneTts: async ({ scenes }) => {
        semanticCaptured = scenes;
        return {
          success: true,
          message: 'ok',
          scene_tts: {
            status: 'done',
            duration: 12,
            scenes: scenes.map(scene => ({
              index: scene.index,
              duration: scene.index === 2 ? 6 : 4,
              speech_duration_sec: scene.index === 2 ? 6 : 4,
              narration_text: scene.narration_text,
              captions: [{ start: 0, end: scene.index === 2 ? 6 : 4, text: scene.narration_text }],
            })),
          },
        };
      },
    },
  });

  assert.equal(semanticResult.success, true);
  assert.equal(semanticCaptured[1].narration_text, '如果你正在启动新项目，pnpm 通常是目前最均衡的选择。');
```

- [x] **Step 2: Add a failing fragment test**

Add this assertion near the existing incomplete narration test:

```js
  fs.writeFileSync(path.join(runDir, `${runId}.json`), JSON.stringify({
    success: true,
    run_id: runId,
    template: 'hyperframes_freeform',
    aweme_id: awemeId,
    status: 'ready',
    result: { video_brief: { target_duration_sec: 60 } },
    hyperframes_freeform: {
      status: 'ready',
      brief: {
        status: 'ready',
        data: {
          title: '旁白完整性测试',
          storyboard: {
            scenes: [
              { index: 1, narration_text: '如果你正在启动新项目。' },
              { index: 2, narration_text: 'npm 完全够用，关键是团队统一。' },
            ],
          },
        },
      },
    },
  }, null, 2));
```

Expected: TTS is not called and the result message mentions incomplete narration.

- [x] **Step 3: Run failing tests**

Run:

```powershell
node tests/test-agent-runs-freeform-audio-budget.js
node tests/test-agent-runs-incomplete-narration.js
```

Expected before implementation: the semantic budget test fails because the conclusion is trimmed, and/or the fragment test passes only after adding the quality rule.

---

### Task 2: Retiming Before Trimming

**Files:**
- Modify: `server/services/agentRuns.js`

- [x] **Step 1: Replace trim-first fitting with retime-first fitting**

Update `fitFreeformNarrationToBudget()` so it:

```js
function fitFreeformNarrationToBudget(brief = {}, scenes = [], targetDurationSec = 60) {
  const plan = freeformStoryboardPlanForBudget(brief, scenes, targetDurationSec);
  const budget = narrationBudget.buildNarrationBudget(plan);
  if (budget.status !== 'too_long') {
    return { scenes, brief: replaceFreeformBriefScenes(brief, scenes, budget), budget, changed: false };
  }

  const target = firstPositiveNumber(targetDurationSec, 60);
  const maxChars = Math.floor(target * narrationBudget.DEFAULT_CHARS_PER_SECOND);
  const totalChars = scenes.reduce((sum, scene) => (
    sum + narrationBudget.countNarrationChars(scene?.narration_text || '')
  ), 0);

  if (totalChars <= maxChars) {
    const retimedPlan = freeformStoryboardPlanForBudget(
      brief,
      scenes.map(scene => ({ ...scene, target_duration_sec: undefined, targetDurationSec: undefined })),
      target,
    );
    const retimedBudget = narrationBudget.buildNarrationBudget(retimedPlan);
    const retimedScenes = scenes.map((scene, index) => ({
      ...scene,
      target_duration_sec: retimedPlan.scenes[index]?.target_duration_sec || scene.target_duration_sec,
    }));
    return {
      scenes: retimedScenes,
      brief: replaceFreeformBriefScenes(brief, retimedScenes, retimedBudget),
      budget: retimedBudget,
      changed: retimedBudget.status !== budget.status,
    };
  }

  const budgetsByIndex = new Map((budget.scenes || []).map(item => [Number(item.index), item]));
  const nextScenes = scenes.map((scene, index) => {
    const sceneIndex = Number(scene.index || index + 1);
    const sceneBudget = budgetsByIndex.get(sceneIndex) || {};
    return {
      ...scene,
      narration_text: trimNarrationToBudget(scene.narration_text, sceneBudget.max_recommended_chars),
    };
  });
  const nextPlan = freeformStoryboardPlanForBudget(brief, nextScenes, targetDurationSec);
  const nextBudget = narrationBudget.buildNarrationBudget(nextPlan);
  return {
    scenes: nextScenes,
    brief: replaceFreeformBriefScenes(brief, nextScenes, nextBudget),
    budget: nextBudget,
    changed: true,
  };
}
```

- [x] **Step 2: Run narration tests**

Run:

```powershell
node tests/test-agent-runs-freeform-audio-budget.js
```

Expected: semantic test preserves the pnpm conclusion and existing long-budget test still compresses truly overlong narration.

---

### Task 3: Stronger Incomplete Narration Detection

**Files:**
- Modify: `server/services/creative-video/narrationQuality.js`

- [x] **Step 1: Add conditional fragment detection**

Add a helper:

```js
function isConditionalFragment(text) {
  const value = compactText(text);
  return /^(如果|当|假如|若|要是).{2,18}[。！？!?]$/.test(value)
    && !/(就|则|建议|推荐|优先|选择|可以|应该|最好|通常|直接|记住|关键|结论)/.test(value);
}
```

Update `isIncompleteNarration()`:

```js
function isIncompleteNarration(text) {
  const value = compactText(text);
  if (!value) return false;
  if (isConditionalFragment(value)) return true;
  if (hasTerminalPunctuation(value)) return false;
  if (endsWithDanglingToken(value)) return true;
  const hasLongClause = /[，,：:；;]/.test(value) && value.length >= 18;
  return hasLongClause;
}
```

- [x] **Step 2: Run incomplete narration test**

Run:

```powershell
node tests/test-agent-runs-incomplete-narration.js
```

Expected: both obvious dangling text and `如果你正在启动新项目。` fail before TTS.

---

### Task 4: Content Graph Contract Gate

**Files:**
- Modify: `server/services/creative-video/html-video/contentGraphAgent.js`
- Modify: graph caller path discovered by `rg "parseContentGraphResponse|generateContentGraph" server/services/creative-video/html-video`
- Test: `tests/test-html-video-content-graph-retry.js` or `tests/test-html-video-content-graph-agent.js`

- [x] **Step 1: Locate graph generation call chain**

Run:

```powershell
rg -n "parseContentGraphResponse|generateContentGraph|content_graph_scene_spec_mismatch|validate.*scene" server/services/creative-video/html-video tests -S
```

Expected: identify one place where AI graph output is parsed and one place where scene_spec mismatch currently becomes fallback.

- [x] **Step 2: Add a failing mismatch test**

Create or extend an assert-based test with:

```js
const sceneSpec = {
  scenes: [
    { id: 'scene_01', order: 1, narration_text: '第一句。' },
    { id: 'scene_02', order: 2, narration_text: '第二句。' },
  ],
};
const badGraph = {
  schemaVersion: 1,
  intent: 'explainer',
  nodes: [
    { id: 'scene_01', kind: 'text', text: '第一句。' },
    { id: 'scene_02', kind: 'text', text: '第二句。' },
    { id: 'scene_03', kind: 'text', text: '多出来。' },
  ],
  edges: [],
};
```

Expected result: graph validation returns a failed result or throws a user-facing error; it must not be marked as a fallback-allowed successful graph.

- [x] **Step 3: Implement scene id contract**

Add or reuse a function equivalent to:

```js
function validateContentGraphSceneContract(graph = {}, sceneSpec = {}) {
  const expected = (Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : []).map(scene => String(scene.id || '').trim()).filter(Boolean);
  const actual = (Array.isArray(graph.nodes) ? graph.nodes : []).map(node => String(node.id || node.scene_id || node.metadata?.scene_id || '').trim()).filter(Boolean);
  const ok = expected.length > 0
    && expected.length === actual.length
    && expected.every((id, index) => actual[index] === id);
  return ok
    ? { ok: true, expected_scene_ids: expected, actual_scene_ids: actual }
    : {
        ok: false,
        code: 'content_graph_scene_spec_mismatch',
        expected_scene_ids: expected,
        actual_scene_ids: actual,
        expected_count: expected.length,
        actual_count: actual.length,
      };
}
```

Wire it before materialization. On first mismatch, retry graph generation with expected ids in the prompt. On second mismatch, fail the project stage with Chinese message:

```js
'画面结构与旁白脚本不一致，已停止渲染。请重新生成画面结构后再导出。'
```

- [x] **Step 4: Run graph tests**

Run:

```powershell
node tests/test-html-video-content-graph-agent.js
node tests/test-html-video-content-graph-retry.js
```

Expected: mismatch is no longer publishable fallback; matching graph still passes.

---

### Task 5: Final Verification

**Files:**
- No new files unless tests reveal a focused helper should be split.

- [x] **Step 1: Run focused tests**

Run:

```powershell
node tests/test-agent-runs-freeform-audio-budget.js
node tests/test-agent-runs-incomplete-narration.js
node tests/test-html-video-content-graph-agent.js
node tests/test-html-video-content-graph-retry.js
node tests/test-html-video-project-orchestrator.js
```

Expected: all pass.

- [x] **Step 2: Inspect git diff**

Run:

```powershell
git diff --stat
git diff --check
```

Expected: no whitespace errors; changed files match this plan.

- [x] **Step 3: Document outcome**

Final response should state:

```text
已完成：旁白预算优先重排时长，不再把可保留的结论截成半句；content graph 与 scene_spec 不一致时不再发布 fallback 成片。
验证：列出实际运行的 node 测试。
```
