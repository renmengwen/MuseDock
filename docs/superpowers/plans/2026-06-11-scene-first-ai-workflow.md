# Scene-First AI Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI workspace main flow with a scene-first workflow: director storyboard plan, scene-level TTS, visual storyboard DSL, HyperFrames project, then MP4 render.

**Architecture:** Keep staged agents, but change the contract. The first agent creates a `storyboard_plan` with scene narration and target durations; TTS runs per scene and backfills real timing; the visual storyboard agent consumes real captions to produce strict HyperFrames DSL. The frontend follows backend `workflow.next_action` instead of guessing from scattered fields.

**Tech Stack:** Node.js 22, Express, React/Vite, existing AI text/TTS adapters, existing `ttsTimeline`, `phraseTimeline`, `storyboardAgent`, `hyperframesProject`, and plain Node test scripts.

---

## File Structure

- Create: `server/services/storyboardPlanAgent.js`
  - Builds director-plan messages and normalizes `storyboard_plan`.
  - Produces scene-level `narration_text`, `target_duration_sec`, `headline`, `visual_intent`, and `visual_type_hint`.

- Create: `server/services/sceneTts.js`
  - Runs TTS per scene, stores scene audio segments, concatenates final audio, and builds global captions plus scene-local phrase captions.

- Create: `server/services/storyboardTiming.js`
  - Converts scene TTS output into global caption indexes, scene `start/end/duration`, and final caption arrays.

- Create: `server/services/agentWorkflowDecision.js`
  - Computes `workflow.stage`, `workflow.next_action`, and user-facing Chinese messages from the current run.

- Modify: `server/services/storyboardAgent.js`
  - Keep it as the visual DSL agent.
  - Make schema validation failures return unsuccessful status.
  - Add object type whitelist wording and common aliases support through schema.

- Modify: `server/services/storyboardSchema.js`
  - Add aliases for model-natural object types such as `card`, `chip`, `line_arrow`, `bubble`, `label`, `icon`.

- Modify: `server/services/agentRuns.js`
  - Add APIs for director plan, scene TTS, visual storyboard, workflow decision, and repair entrypoint.
  - Preserve legacy fields for old runs.

- Modify: `server/routes/agents.js`
  - Add new workflow endpoints.

- Modify: `frontend-react/src/api/client.js`
  - Add client methods for new endpoints.

- Modify: `frontend-react/src/pages/AiWorkspace.jsx`
  - Replace the main flow UI with scene-first stages.
  - Keep legacy run display behind a compatibility/debug section.

- Modify: `frontend-react/src/utils/agentRuns.js`
  - Add helpers to display workflow stage, next action, scene TTS summaries, and legacy status.

- Test: `tests/test-storyboard-plan-agent.js`
- Test: `tests/test-scene-tts.js`
- Test: `tests/test-storyboard-timing.js`
- Test: `tests/test-agent-workflow-decision.js`
- Test: update `tests/test-storyboard-agent.js`
- Test: update `tests/test-storyboard-schema.js`
- Test: update `tests/test-agent-runs.js`
- Test: update `tests/test-ai-workspace-brief-ui.mjs`
- Test: update `package.json`

---

### Task 1: Director Storyboard Plan Agent

**Files:**
- Create: `server/services/storyboardPlanAgent.js`
- Test: `tests/test-storyboard-plan-agent.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `tests/test-storyboard-plan-agent.js`:

```js
const assert = require('assert');
const storyboardPlanAgent = require('../server/services/storyboardPlanAgent');

async function run() {
  const messages = storyboardPlanAgent.buildStoryboardPlanMessages({
    transcriptText: '原视频讲 AI Agent、API 和 MCP 的关系。',
    commentsText: '- 想知道新手怎么开始',
    promptOptions: {
      targetDurationSec: 60,
      accountPositioning: 'AI科普账号',
      audience: 'AI 工具新手',
    },
  });

  assert.match(messages[0].content, /导演规划 Agent/);
  assert.match(messages[0].content, /只输出 JSON/);
  assert.match(messages[1].content, /target_duration_sec/);
  assert.match(messages[1].content, /storyboard_plan/);
  assert.match(messages[1].content, /narration_text/);

  const normalized = storyboardPlanAgent.normalizeStoryboardPlan({
    target_duration_sec: 60,
    scenes: [
      {
        index: 9,
        target_duration_sec: 4.7,
        narration_text: '先别急着买最贵的模型。',
        headline: '先看工作流',
        visual_intent: '用对比画面说明模型不是全部',
        visual_type_hint: 'split_compare',
      },
    ],
  });

  assert.equal(normalized.status, 'planned');
  assert.equal(normalized.target_duration_sec, 60);
  assert.equal(normalized.scenes[0].index, 1);
  assert.equal(normalized.scenes[0].target_duration_sec, 4.7);
  assert.equal(normalized.scenes[0].narration_text, '先别急着买最贵的模型。');
  assert.equal(normalized.scenes[0].visual_type_hint, 'split_compare');

  const result = await storyboardPlanAgent.createStoryboardPlan({
    transcriptText: 'AI Agent 可以拆任务、调用工具、输出结果。',
    commentsText: '- 新手想知道怎么选模型',
    aiTextModel: {
      async callTextModel(payload) {
        assert.equal(payload.stream, true);
        assert.equal(payload.maxRetries, 3);
        return {
          success: true,
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          text: JSON.stringify({
            target_duration_sec: 60,
            scenes: [
              {
                target_duration_sec: 5,
                narration_text: 'Agent 不是聊天机器人升级版。',
                headline: '不只是聊天',
                visual_intent: '左右对比聊天和执行任务',
                visual_type_hint: 'split_compare',
              },
            ],
          }),
        };
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.storyboard_plan.status, 'planned');
  assert.equal(result.storyboard_plan.scenes.length, 1);
  assert.equal(result.parse.success, true);

  const malformed = await storyboardPlanAgent.createStoryboardPlan({
    transcriptText: '测试',
    aiTextModel: {
      async callTextModel() {
        return { success: true, text: 'not json' };
      },
    },
  });

  assert.equal(malformed.success, false);
  assert.equal(malformed.parse.success, false);
}

run().then(() => {
  console.log('storyboard plan agent tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-storyboard-plan-agent.js
```

Expected: FAIL with `Cannot find module '../server/services/storyboardPlanAgent'`.

- [ ] **Step 3: Implement `storyboardPlanAgent.js`**

Create `server/services/storyboardPlanAgent.js`:

```js
const defaultAiTextModel = require('./aiTextModel');

const PLAN_TEXT_LIMITS = {
  transcriptText: 9000,
  commentsText: 3000,
  narrationText: 220,
  headline: 24,
  visualIntent: 180,
  visualTypeHint: 40,
};

const VISUAL_TYPE_HINT_ALLOWED = [
  'workflow',
  'code_panel',
  'ui_mockup',
  'split_compare',
  'concept_map',
  'timeline',
  'quote_burst',
  'text_card',
  'quote_card',
  'step_card',
  'contrast_card',
];

function sanitizeText(value, limit = 200) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function safeNumber(value, fallback, min = 1, max = 600) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number * 10) / 10));
}

function buildStoryboardPlanMessages({
  transcriptText = '',
  commentsText = '',
  promptOptions = {},
} = {}) {
  const targetDuration = safeNumber(promptOptions.targetDurationSec || promptOptions.target_duration_sec, 60, 15, 180);
  return [
    {
      role: 'system',
      content: [
        '你是 MuseDock 的导演规划 Agent。',
        '你负责把素材转写和评论洞察整理成可配音的短视频分镜计划。',
        '你只输出 JSON，不输出 Markdown、解释或代码块。',
        'JSON 必须包含 target_duration_sec 和 scenes。',
        '每个 scene 必须包含 target_duration_sec、narration_text、headline、visual_intent、visual_type_hint。',
        'narration_text 是这一段最终要配音的口播文本，必须短、口语化、可直接 TTS。',
        '不要输出 HyperFrames DSL，不要输出 visual_scene，不要输出 start/end/duration。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '任务：生成 storyboard_plan。',
        '',
        `target_duration_sec=${targetDuration}`,
        `账号定位：${sanitizeText(promptOptions.accountPositioning || 'AI科普账号', 80)}`,
        `目标受众：${sanitizeText(promptOptions.audience || 'AI 工具新手', 120)}`,
        '',
        '转写文本：',
        sanitizeText(transcriptText, PLAN_TEXT_LIMITS.transcriptText),
        '',
        '评论洞察：',
        sanitizeText(commentsText, PLAN_TEXT_LIMITS.commentsText),
        '',
        '输出格式：',
        JSON.stringify({
          target_duration_sec: targetDuration,
          scenes: [
            {
              target_duration_sec: 5,
              narration_text: '这一段要说的话。',
              headline: '画面标题',
              visual_intent: '画面意图',
              visual_type_hint: 'split_compare',
            },
          ],
        }, null, 2),
      ].join('\n'),
    },
  ];
}

function normalizeStoryboardPlan(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawScenes = Array.isArray(source.scenes) ? source.scenes : [];
  const targetDurationSec = safeNumber(source.target_duration_sec, 60, 15, 180);
  const scenes = rawScenes
    .map(scene => (scene && typeof scene === 'object' && !Array.isArray(scene) ? scene : null))
    .filter(Boolean)
    .map((scene, index) => {
      const hint = sanitizeText(scene.visual_type_hint, PLAN_TEXT_LIMITS.visualTypeHint);
      return {
        index: index + 1,
        target_duration_sec: safeNumber(scene.target_duration_sec, Math.max(3, targetDurationSec / Math.max(1, rawScenes.length)), 2, 30),
        narration_text: sanitizeText(scene.narration_text, PLAN_TEXT_LIMITS.narrationText),
        headline: sanitizeText(scene.headline, PLAN_TEXT_LIMITS.headline),
        visual_intent: sanitizeText(scene.visual_intent, PLAN_TEXT_LIMITS.visualIntent),
        visual_type_hint: VISUAL_TYPE_HINT_ALLOWED.includes(hint) ? hint : 'text_card',
      };
    })
    .filter(scene => scene.narration_text);

  return {
    status: scenes.length ? 'planned' : 'failed',
    target_duration_sec: targetDurationSec,
    scenes,
    message: scenes.length ? '导演分镜已生成。' : '导演分镜生成失败：没有可配音分镜。',
    updated_at: new Date().toISOString(),
  };
}

function parseJson(text) {
  try {
    return { success: true, value: JSON.parse(text), error: '' };
  } catch (error) {
    return { success: false, value: {}, error: `模型返回不是有效 JSON：${error.message}` };
  }
}

async function createStoryboardPlan(options = {}) {
  const modelService = options.aiTextModel || defaultAiTextModel;
  const messages = buildStoryboardPlanMessages(options);
  let modelResult;
  try {
    modelResult = await modelService.callTextModel({
      messages,
      temperature: options.temperature ?? 0.35,
      configPath: options.configPath,
      textConfig: options.textConfig,
      fetchImpl: options.fetchImpl,
      maxRetries: options.maxRetries ?? 3,
      retryDelayMs: options.retryDelayMs,
      stream: options.stream !== false,
      fallbackToNonStreamOnGatewayTimeout: options.stream !== false,
    });
  } catch (error) {
    modelResult = { success: false, message: error.message || '导演分镜模型调用失败。' };
  }

  if (!modelResult.success) {
    return {
      success: false,
      message: modelResult.message || '导演分镜生成失败。',
      model: modelResult.model || {},
      messages,
      raw_output: '',
      parse: { success: false, error: modelResult.message || '导演分镜模型调用失败。' },
      storyboard_plan: normalizeStoryboardPlan({}),
    };
  }

  const parse = parseJson(modelResult.text);
  const storyboardPlan = normalizeStoryboardPlan(parse.value);
  const success = parse.success && storyboardPlan.scenes.length > 0;
  return {
    success,
    message: success ? '导演分镜已生成。' : (parse.error || storyboardPlan.message),
    model: modelResult.model || {},
    messages,
    raw_output: modelResult.text || '',
    raw: parse.value,
    parse,
    storyboard_plan: storyboardPlan,
  };
}

module.exports = {
  buildStoryboardPlanMessages,
  normalizeStoryboardPlan,
  createStoryboardPlan,
  VISUAL_TYPE_HINT_ALLOWED,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node tests/test-storyboard-plan-agent.js
```

Expected: PASS with `storyboard plan agent tests passed`.

- [ ] **Step 5: Add test script coverage**

Modify `package.json` `test` script by inserting:

```bash
node tests/test-storyboard-plan-agent.js
```

after `node tests/test-agent-template-overrides.js`.

- [ ] **Step 6: Commit**

```bash
git add server/services/storyboardPlanAgent.js tests/test-storyboard-plan-agent.js package.json
git commit -m "新增导演分镜规划 Agent"
```

---

### Task 2: Scene-Level TTS And Timing

**Files:**
- Create: `server/services/storyboardTiming.js`
- Create: `server/services/sceneTts.js`
- Test: `tests/test-storyboard-timing.js`
- Test: `tests/test-scene-tts.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing timing test**

Create `tests/test-storyboard-timing.js`:

```js
const assert = require('assert');
const timing = require('../server/services/storyboardTiming');

function run() {
  const plan = {
    target_duration_sec: 60,
    scenes: [
      { index: 1, target_duration_sec: 4, narration_text: '第一段。', headline: '开场' },
      { index: 2, target_duration_sec: 6, narration_text: '第二段。', headline: '解释' },
    ],
  };
  const sceneTts = {
    scenes: [
      {
        index: 1,
        duration: 1.2,
        captions: [{ index: 1, start: 0, end: 1.2, duration: 1.2, text: '第一段。' }],
        phrase_captions: [{ id: 'cap-1-p1', caption_index: 1, start: 0, end: 1.2, text: '第一段' }],
      },
      {
        index: 2,
        duration: 2.5,
        captions: [{ index: 1, start: 0, end: 2.5, duration: 2.5, text: '第二段。' }],
        phrase_captions: [{ id: 'cap-1-p1', caption_index: 1, start: 0, end: 2.5, text: '第二段' }],
      },
    ],
  };

  const result = timing.buildTimedStoryboardPlan({ storyboardPlan: plan, sceneTts });
  assert.equal(result.status, 'timed');
  assert.equal(result.duration, 3.7);
  assert.deepEqual(result.scenes.map(scene => scene.caption_indexes), [[1], [2]]);
  assert.equal(result.scenes[0].start, 0);
  assert.equal(result.scenes[0].end, 1.2);
  assert.equal(result.scenes[1].start, 1.2);
  assert.equal(result.scenes[1].end, 3.7);
  assert.equal(result.captions[1].index, 2);
  assert.equal(result.captions[1].start, 1.2);
  assert.equal(result.phrase_captions[1].id, 'cap-2-p1');
  assert.equal(result.phrase_captions[1].caption_index, 2);
}

run();
console.log('storyboard timing tests passed');
```

- [ ] **Step 2: Run timing test to verify it fails**

Run:

```bash
node tests/test-storyboard-timing.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement `storyboardTiming.js`**

Create `server/services/storyboardTiming.js`:

```js
function roundTime(value) {
  const number = Number(value || 0);
  return Math.round(number * 1000) / 1000;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildTimedStoryboardPlan({ storyboardPlan = {}, sceneTts = {} } = {}) {
  const planScenes = asArray(storyboardPlan.scenes);
  const ttsScenesByIndex = new Map(asArray(sceneTts.scenes).map(scene => [Number(scene.index), scene]));
  const captions = [];
  const phraseCaptions = [];
  const scenes = [];
  let cursor = 0;
  let nextCaptionIndex = 1;

  for (const planScene of planScenes) {
    const sceneIndex = Number(planScene.index || scenes.length + 1);
    const ttsScene = ttsScenesByIndex.get(sceneIndex) || {};
    const localCaptions = asArray(ttsScene.captions);
    const localPhraseCaptions = asArray(ttsScene.phrase_captions);
    const captionIndexes = [];
    const sceneStart = roundTime(cursor);

    for (const caption of localCaptions) {
      const oldIndex = Number(caption.index);
      const globalIndex = nextCaptionIndex;
      nextCaptionIndex += 1;
      captionIndexes.push(globalIndex);
      captions.push({
        ...caption,
        index: globalIndex,
        scene_index: sceneIndex,
        start: roundTime(cursor + Number(caption.start || 0)),
        end: roundTime(cursor + Number(caption.end || 0)),
        duration: roundTime(caption.duration || Number(caption.end || 0) - Number(caption.start || 0)),
      });
      for (const block of localPhraseCaptions.filter(item => Number(item.caption_index) === oldIndex)) {
        phraseCaptions.push({
          ...block,
          id: `cap-${globalIndex}-p${String(block.id || '').split('-p').pop() || '1'}`,
          caption_index: globalIndex,
          scene_index: sceneIndex,
          start: roundTime(cursor + Number(block.start || 0)),
          end: roundTime(cursor + Number(block.end || 0)),
        });
      }
    }

    const sceneDuration = roundTime(Number(ttsScene.duration || 0) || (captionIndexes.length
      ? captions[captions.length - 1].end - sceneStart
      : 0));
    const sceneEnd = roundTime(sceneStart + sceneDuration);
    scenes.push({
      ...planScene,
      index: sceneIndex,
      caption_indexes: captionIndexes,
      start: sceneStart,
      end: sceneEnd,
      duration: sceneDuration,
      actual_duration_sec: sceneDuration,
    });
    cursor = sceneEnd;
  }

  return {
    status: scenes.length ? 'timed' : 'failed',
    target_duration_sec: Number(storyboardPlan.target_duration_sec || 60),
    duration: roundTime(cursor),
    scenes,
    captions,
    phrase_captions: phraseCaptions,
    message: scenes.length ? '分段配音时间轴已生成。' : '分段配音时间轴生成失败。',
    updated_at: new Date().toISOString(),
  };
}

module.exports = {
  buildTimedStoryboardPlan,
  roundTime,
};
```

- [ ] **Step 4: Run timing test to verify it passes**

Run:

```bash
node tests/test-storyboard-timing.js
```

Expected: PASS.

- [ ] **Step 5: Write failing scene TTS test**

Create `tests/test-scene-tts.js`:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sceneTts = require('../server/services/sceneTts');

async function run() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-tts-test-'));
  const calls = [];
  const result = await sceneTts.synthesizeSceneTts({
    scenes: [
      { index: 1, narration_text: '第一段。' },
      { index: 2, narration_text: '第二段。' },
    ],
    outputDir: rootDir,
    runId: 'run-1',
    format: 'wav',
    ttsModel: {
      async callTtsModel(payload) {
        calls.push(payload.text);
        return {
          success: true,
          audioBuffer: Buffer.from(`audio:${payload.text}`),
          format: 'wav',
          voice: 'mimo_default',
          model: { provider: 'mock' },
        };
      },
    },
    readAudioDuration: async filePath => {
      const text = fs.readFileSync(filePath, 'utf8');
      return text.includes('第一段') ? 1.1 : 1.9;
    },
    concatenateAudioFiles: async ({ inputPaths, targetPath }) => {
      fs.writeFileSync(targetPath, inputPaths.map(item => fs.readFileSync(item, 'utf8')).join('|'));
      return { success: true };
    },
  });

  assert.equal(result.success, true);
  assert.deepEqual(calls, ['第一段。', '第二段。']);
  assert.equal(result.scene_tts.status, 'done');
  assert.equal(result.scene_tts.scenes.length, 2);
  assert.equal(result.scene_tts.scenes[0].duration, 1.1);
  assert.equal(result.scene_tts.scenes[0].captions[0].text, '第一段。');
  assert.ok(fs.existsSync(result.scene_tts.path));
}

run().then(() => {
  console.log('scene tts tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 6: Run scene TTS test to verify it fails**

Run:

```bash
node tests/test-scene-tts.js
```

Expected: FAIL with module not found.

- [ ] **Step 7: Implement `sceneTts.js`**

Create `server/services/sceneTts.js`:

```js
const fsp = require('fs/promises');
const path = require('path');
const defaultAiTtsModel = require('./aiTtsModel');
const ttsTimeline = require('./ttsTimeline');
const phraseTimeline = require('./phraseTimeline');

function safeFormat(format) {
  return String(format || 'wav').replace(/[^A-Za-z0-9]/g, '') || 'wav';
}

function getSceneAudioFileName(index, format = 'wav') {
  return `scene-${String(index).padStart(3, '0')}.${safeFormat(format)}`;
}

async function synthesizeSceneTts(options = {}) {
  const scenes = Array.isArray(options.scenes) ? options.scenes : [];
  const outputDir = options.outputDir;
  const runId = options.runId || 'run';
  const format = safeFormat(options.format || 'wav');
  if (!outputDir) {
    return { success: false, message: '缺少分段配音输出目录。' };
  }
  if (!scenes.length) {
    return { success: false, message: '没有可配音的分镜。' };
  }

  const ttsModel = options.ttsModel || defaultAiTtsModel;
  const readAudioDuration = options.readAudioDuration || (async filePath => {
    const duration = await ttsTimeline.readAudioDuration(filePath, options);
    if (!duration.success) throw new Error(duration.message);
    return duration.duration;
  });
  const concatenateAudioFiles = options.concatenateAudioFiles || ttsTimeline.concatenateAudioFiles;
  const sceneDir = path.join(outputDir, `${runId}-scene-tts`);
  await fsp.rm(sceneDir, { recursive: true, force: true });
  await fsp.mkdir(sceneDir, { recursive: true });

  const sceneResults = [];
  let model = {};
  let voice = options.voice || '';
  let resolvedFormat = format;
  for (const scene of scenes) {
    const index = Number(scene.index || sceneResults.length + 1);
    const text = String(scene.narration_text || '').trim();
    if (!text) {
      return { success: false, message: `分镜 ${index} 没有可配音文本。` };
    }
    const tts = await ttsModel.callTtsModel({
      text,
      voice: options.voice,
      stylePrompt: options.stylePrompt,
      format,
      configPath: options.configPath,
      ttsConfig: options.ttsConfig,
      fetchImpl: options.fetchImpl,
      waitImpl: options.waitImpl,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      ttsConcurrency: options.ttsConcurrency,
      ttsQueueIntervalMs: options.ttsQueueIntervalMs,
    });
    if (!tts.success) {
      return {
        success: false,
        message: tts.message || `分镜 ${index} 配音失败。`,
        scene_index: index,
        model: tts.model || {},
      };
    }
    resolvedFormat = safeFormat(tts.format || resolvedFormat);
    voice = tts.voice || voice;
    model = tts.model || model;
    const fileName = getSceneAudioFileName(index, resolvedFormat);
    const filePath = path.join(sceneDir, fileName);
    await fsp.writeFile(filePath, tts.audioBuffer);
    const duration = await readAudioDuration(filePath);
    const captions = ttsTimeline.buildCaptionsFromSegments([{ index: 1, text, duration, path: filePath }]);
    const phraseCaptions = phraseTimeline.buildPhraseBlocksFromCaptions(captions);
    sceneResults.push({
      index,
      text,
      path: filePath,
      file_name: fileName,
      duration,
      captions,
      phrase_captions: phraseCaptions,
    });
  }

  const finalFileName = `${runId}-tts.${resolvedFormat}`;
  const finalPath = path.join(outputDir, finalFileName);
  const concatResult = await concatenateAudioFiles({
    inputPaths: sceneResults.map(scene => scene.path),
    targetPath: finalPath,
    options,
  });
  if (concatResult && concatResult.success === false) {
    return { success: false, message: concatResult.message || '拼接分段配音失败。' };
  }

  return {
    success: true,
    message: '分段配音完成。',
    scene_tts: {
      status: 'done',
      voice,
      style_prompt: options.stylePrompt || '',
      format: resolvedFormat,
      path: finalPath,
      file_name: finalFileName,
      scenes: sceneResults,
      model,
      updated_at: new Date().toISOString(),
    },
  };
}

module.exports = {
  synthesizeSceneTts,
  getSceneAudioFileName,
};
```

- [ ] **Step 8: Run scene TTS test to verify it passes**

Run:

```bash
node tests/test-scene-tts.js
```

Expected: PASS.

- [ ] **Step 9: Add tests to package script**

Modify `package.json` `test` script by inserting:

```bash
node tests/test-storyboard-timing.js && node tests/test-scene-tts.js
```

after `node tests/test-phrase-timeline.js`.

- [ ] **Step 10: Commit**

```bash
git add server/services/storyboardTiming.js server/services/sceneTts.js tests/test-storyboard-timing.js tests/test-scene-tts.js package.json
git commit -m "新增分段配音和分镜时间轴"
```

---

### Task 3: Workflow Decision Service

**Files:**
- Create: `server/services/agentWorkflowDecision.js`
- Test: `tests/test-agent-workflow-decision.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing test**

Create `tests/test-agent-workflow-decision.js`:

```js
const assert = require('assert');
const decision = require('../server/services/agentWorkflowDecision');

function run() {
  assert.deepEqual(decision.decideNextAction({}).next_action, 'generate_storyboard_plan');

  assert.equal(decision.decideNextAction({
    storyboard_plan: { status: 'planned', scenes: [{ index: 1, narration_text: '测试' }] },
  }).next_action, 'synthesize_scene_tts');

  assert.equal(decision.decideNextAction({
    storyboard_plan: { status: 'planned', scenes: [{ index: 1, narration_text: '测试' }] },
    scene_tts: { status: 'done', timed_storyboard_plan: { status: 'timed', captions: [{ index: 1 }] } },
  }).next_action, 'generate_visual_storyboard');

  assert.equal(decision.decideNextAction({
    storyboard_plan: { status: 'planned', scenes: [{ index: 1 }] },
    scene_tts: { status: 'done', timed_storyboard_plan: { status: 'timed', captions: [{ index: 1 }] } },
    storyboard: { scenes: [{ index: 1 }] },
    storyboard_schema_validation: { success: false, errors: ['分镜 1 visual_scene.objects 包含不受支持的对象类型。'] },
  }).next_action, 'repair_visual_storyboard');

  assert.equal(decision.decideNextAction({
    storyboard_plan: { status: 'planned', scenes: [{ index: 1 }] },
    scene_tts: { status: 'done', timed_storyboard_plan: { status: 'timed', captions: [{ index: 1 }] } },
    storyboard: { scenes: [{ index: 1 }] },
    storyboard_schema_validation: { success: true, errors: [] },
  }).next_action, 'generate_video_project');

  const duration = decision.decideNextAction({
    video: {
      status: 'failed',
      video_quality_report: {
        pass: false,
        issues: [{ code: 'duration_too_long', severity: 'error', message: '太长' }],
      },
    },
  });
  assert.equal(duration.next_action, 'compress_scene_narration');
  assert.match(duration.message, /压缩/);

  assert.equal(decision.decideNextAction({
    video: { status: 'project_ready', project_dir: '/tmp/project' },
  }).next_action, 'render_video');
}

run();
console.log('agent workflow decision tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-agent-workflow-decision.js
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement decision service**

Create `server/services/agentWorkflowDecision.js`:

```js
function getQualityIssue(run, code) {
  const issues = Array.isArray(run?.video?.video_quality_report?.issues)
    ? run.video.video_quality_report.issues
    : [];
  return issues.find(issue => issue?.code === code);
}

function makeWorkflow(stage, nextAction, message) {
  return {
    stage,
    next_action: nextAction,
    message,
    updated_at: new Date().toISOString(),
  };
}

function decideNextAction(run = {}) {
  const durationIssue = getQualityIssue(run, 'duration_too_long');
  if (durationIssue) {
    return makeWorkflow('needs_script_repair', 'compress_scene_narration', '成片时长超出目标，请先压缩超时分镜口播并重新配音。');
  }

  const visualIssue = getQualityIssue(run, 'unbound_visual_objects') || getQualityIssue(run, 'invalid_caption_sync');
  if (visualIssue) {
    return makeWorkflow('needs_visual_repair', 'repair_visual_storyboard', '视觉分镜和字幕绑定需要修复。');
  }

  if (run.video?.status === 'rendered' && run.video?.output_url) {
    return makeWorkflow('done', 'done', 'MP4 已渲染完成。');
  }

  if (run.video?.status === 'project_ready' && run.video?.project_dir) {
    return makeWorkflow('video_project', 'render_video', '视频工程已生成，请渲染 MP4。');
  }

  const schemaValidation = run.storyboard_schema_validation;
  const hasStoryboard = Array.isArray(run.storyboard?.scenes) && run.storyboard.scenes.length > 0;
  if (hasStoryboard && schemaValidation?.success === false) {
    return makeWorkflow('visual_storyboard_failed', 'repair_visual_storyboard', '视觉分镜结构校验失败，请修复后继续。');
  }
  if (hasStoryboard && schemaValidation?.success !== false) {
    return makeWorkflow('visual_storyboard', 'generate_video_project', '视觉分镜已生成，请生成视频工程。');
  }

  const timedPlan = run.scene_tts?.timed_storyboard_plan;
  if (run.scene_tts?.status === 'done' && Array.isArray(timedPlan?.captions) && timedPlan.captions.length > 0) {
    return makeWorkflow('scene_tts', 'generate_visual_storyboard', '分段配音已完成，请生成视觉分镜。');
  }

  if (run.scene_tts?.status === 'failed') {
    return makeWorkflow('scene_tts_failed', 'retry_scene_tts', run.scene_tts.message || '分段配音失败，请重试失败分镜。');
  }

  if (run.storyboard_plan?.status === 'planned' && Array.isArray(run.storyboard_plan.scenes) && run.storyboard_plan.scenes.length > 0) {
    return makeWorkflow('storyboard_plan', 'synthesize_scene_tts', '导演分镜已生成，请生成分段配音。');
  }

  return makeWorkflow('empty', 'generate_storyboard_plan', '请先生成导演分镜。');
}

module.exports = {
  decideNextAction,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node tests/test-agent-workflow-decision.js
```

Expected: PASS.

- [ ] **Step 5: Add to package test script**

Add:

```bash
node tests/test-agent-workflow-decision.js
```

after `node tests/test-agent-runs.js`.

- [ ] **Step 6: Commit**

```bash
git add server/services/agentWorkflowDecision.js tests/test-agent-workflow-decision.js package.json
git commit -m "新增 AI 工作流下一步决策"
```

---

### Task 4: Strict Visual Storyboard Validation And Object Aliases

**Files:**
- Modify: `server/services/storyboardSchema.js`
- Modify: `server/services/storyboardAgent.js`
- Test: `tests/test-storyboard-schema.js`
- Test: `tests/test-storyboard-agent.js`

- [ ] **Step 1: Add failing schema alias assertions**

In `tests/test-storyboard-schema.js`, add:

```js
{
  const normalized = schema.normalizeVisualObject({ id: 'x1', type: 'card', text: '卡片' });
  assert.equal(normalized.type, 'panel');
  const chip = schema.normalizeVisualObject({ id: 'x2', type: 'chip', text: '标签' });
  assert.equal(chip.type, 'badge');
  const arrow = schema.normalizeVisualObject({ id: 'x3', type: 'line_arrow', text: '连接' });
  assert.equal(arrow.type, 'connector');
}
```

- [ ] **Step 2: Run schema test to verify it fails**

Run:

```bash
node tests/test-storyboard-schema.js
```

Expected: FAIL because `card`, `chip`, or `line_arrow` is not normalized.

- [ ] **Step 3: Add aliases**

In `server/services/storyboardSchema.js`, extend `VISUAL_OBJECT_TYPE_ALIASES`:

```js
  banner: 'panel',
  bubble: 'panel',
  burst_text: 'keyword',
  card: 'panel',
  chip: 'badge',
  gate: 'panel',
  icon: 'badge',
  input: 'field',
  input_card: 'panel',
  label: 'badge',
  line_arrow: 'connector',
  line_group: 'connector',
  pipe: 'connector',
  stamp: 'badge',
  status_card: 'panel',
  tag: 'badge',
  tool_card: 'panel',
  ui_window: 'panel',
```

- [ ] **Step 4: Run schema test to verify it passes**

Run:

```bash
node tests/test-storyboard-schema.js
```

Expected: PASS.

- [ ] **Step 5: Add failing strict storyboard test**

In `tests/test-storyboard-agent.js`, change the malformed and invalid raw scene expectations:

```js
assert.equal(malformed.success, false);
assert.equal(malformed.raw_parse_failed, true);

assert.equal(invalidRawScene.success, false);
assert.equal(invalidRawScene.schema_validation.success, false);
```

- [ ] **Step 6: Run storyboard agent test to verify it fails**

Run:

```bash
node tests/test-storyboard-agent.js
```

Expected: FAIL because current `createStoryboard` returns `success: true` for parse/schema failures.

- [ ] **Step 7: Make `storyboardAgent.createStoryboard` strict**

In `server/services/storyboardAgent.js`, replace the final return success/message block with:

```js
  const success = parsed.parsed && schemaValidation.success;

  return {
    success,
    message: success
      ? 'AI 分镜已生成。'
      : (parsed.parsed ? 'AI 分镜结构校验失败，请查看调试信息或重新生成。' : 'AI 分镜返回不是有效 JSON，无法生成可用分镜。'),
    model: modelResult.model || {},
    storyboard,
    config_snapshot: configSnapshot,
    messages,
    raw_output: modelResult.text || '',
    parse: parsed.parsed
      ? { success: true, error: '' }
      : { success: false, error: 'AI 分镜返回不是有效 JSON。' },
    schema_validation: schemaValidation,
    raw: parsed.value,
    raw_parse_failed: !parsed.parsed,
  };
```

- [ ] **Step 8: Add whitelist wording to visual prompt**

In the default storyboard prompt in `server/services/storyboardAgent.js`, add the explicit object whitelist line:

```js
'- visual_scene.objects[].type 只能使用 node、connector、code、terminal、panel、button、field、metric、column、branch、milestone、badge、keyword、center、step；不要使用 card、chip、line_arrow、bubble、icon 等自造类型。',
```

Add it near the existing `visual_scene.objects` requirement.

- [ ] **Step 9: Run tests**

Run:

```bash
node tests/test-storyboard-schema.js
node tests/test-storyboard-agent.js
```

Expected: both PASS.

- [ ] **Step 10: Commit**

```bash
git add server/services/storyboardSchema.js server/services/storyboardAgent.js tests/test-storyboard-schema.js tests/test-storyboard-agent.js
git commit -m "收紧视觉分镜校验并兼容常见对象别名"
```

---

### Task 5: Backend Run Workflow Endpoints

**Files:**
- Modify: `server/services/agentRuns.js`
- Modify: `server/routes/agents.js`
- Test: `tests/test-agent-runs.js`

- [ ] **Step 1: Add failing agent run workflow tests**

In `tests/test-agent-runs.js`, after the existing generated run assertions, add a new isolated workflow section:

```js
  const planRun = await agentRuns.createDouyinStoryboardPlanRun(awemeId, {
    rootDir,
    storyboardPlanAgent: {
      createStoryboardPlan: async () => ({
        success: true,
        storyboard_plan: {
          status: 'planned',
          target_duration_sec: 60,
          scenes: [
            { index: 1, target_duration_sec: 5, narration_text: '第一段。', headline: '开场', visual_intent: '对比', visual_type_hint: 'split_compare' },
          ],
        },
        model: { model_id: 'plan-test' },
        messages: [{ role: 'user', content: 'plan' }],
        raw_output: '{}',
        parse: { success: true, error: '' },
      }),
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.equal(planRun.success, true);
  assert.equal(planRun.storyboard_plan.status, 'planned');
  assert.equal(planRun.workflow.next_action, 'synthesize_scene_tts');

  const sceneTtsResult = await agentRuns.synthesizeDouyinRunSceneTts(awemeId, planRun.run_id, {
    rootDir,
    sceneTtsService: {
      synthesizeSceneTts: async () => ({
        success: true,
        scene_tts: {
          status: 'done',
          path: 'mock.wav',
          file_name: 'mock.wav',
          scenes: [
            {
              index: 1,
              duration: 1.2,
              captions: [{ index: 1, start: 0, end: 1.2, duration: 1.2, text: '第一段。' }],
              phrase_captions: [{ id: 'cap-1-p1', caption_index: 1, start: 0, end: 1.2, text: '第一段' }],
            },
          ],
          model: {},
        },
      }),
    },
  });
  assert.equal(sceneTtsResult.success, true);
  assert.equal(sceneTtsResult.scene_tts.timed_storyboard_plan.status, 'timed');
  assert.equal(sceneTtsResult.workflow.next_action, 'generate_visual_storyboard');

  const visualResult = await agentRuns.createDouyinRunVisualStoryboard(awemeId, planRun.run_id, {
    rootDir,
    storyboardAgent: {
      createStoryboard: async ({ captions, phraseCaptions }) => {
        assert.equal(captions.length, 1);
        assert.equal(phraseCaptions.length, 1);
        return {
          success: true,
          storyboard: {
            status: 'done',
            scenes: [{ index: 1, caption_indexes: [1], headline: '开场' }],
          },
          schema_validation: { success: true, errors: [] },
          parse: { success: true, error: '' },
          messages: [],
          raw_output: '{}',
          raw: {},
          model: {},
        };
      },
    },
  });
  assert.equal(visualResult.success, true);
  assert.equal(visualResult.workflow.next_action, 'generate_video_project');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-agent-runs.js
```

Expected: FAIL because workflow methods do not exist.

- [ ] **Step 3: Add helper imports**

At the top of `server/services/agentRuns.js`, add:

```js
const defaultStoryboardPlanAgent = require('./storyboardPlanAgent');
const defaultSceneTts = require('./sceneTts');
const storyboardTiming = require('./storyboardTiming');
const workflowDecision = require('./agentWorkflowDecision');
```

- [ ] **Step 4: Implement `createDouyinStoryboardPlanRun`**

Add to `server/services/agentRuns.js`:

```js
async function createDouyinStoryboardPlanRun(awemeId, options = {}) {
  if (!isSafeId(awemeId)) return createInvalidAwemeResult(awemeId);
  const rootDir = options.rootDir;
  const paths = mediaPipeline.getMediaPaths(awemeId, rootDir);
  const status = await mediaPipeline.getStatus(awemeId, { rootDir });
  if (!status.exists) {
    return createFailureRun(awemeId, TEMPLATE_VIRAL_REWRITE, '未找到该视频素材，请先准备该视频的本地素材。', { rootDir, persist: false });
  }
  const analysisInput = await readJsonIfExists(paths.analysisInput);
  const transcript = await readJsonIfExists(paths.transcript);
  if (!analysisInput || !transcript?.text) {
    return createFailureRun(awemeId, TEMPLATE_VIRAL_REWRITE, '请先准备素材并完成转写。', { rootDir });
  }
  const getLocalComments = options.getLocalComments || defaultGetLocalComments;
  const commentsResult = await getLocalComments(awemeId, { max: 50, maxReplies: 5 });
  const comments = Array.isArray(commentsResult?.data) ? commentsResult.data : [];
  const commentsText = summarizeComments(comments);
  const agent = options.storyboardPlanAgent || defaultStoryboardPlanAgent;
  const result = await agent.createStoryboardPlan({
    transcriptText: transcript.text,
    commentsText,
    promptOptions: options.promptOptions || {},
    aiTextModel: options.aiTextModel,
    configPath: options.configPath,
    textConfig: options.textConfig,
    fetchImpl: options.fetchImpl,
  });
  const run = {
    success: !!result.success,
    run_id: createRunId('storyboard_plan'),
    template: 'storyboard_plan',
    aweme_id: String(awemeId),
    status: result.success ? 'done' : 'failed',
    model: result.model || {},
    input_summary: createInputSummary({ analysisInput, transcript, comments }),
    messages: result.messages || [],
    raw_output: result.raw_output || '',
    parse: result.parse || { success: false, error: '' },
    storyboard_plan: result.storyboard_plan,
    storyboard_plan_raw: result.raw || {},
    storyboard_plan_model: result.model || {},
    message: result.message,
    created_at: new Date().toISOString(),
  };
  run.workflow = workflowDecision.decideNextAction(run);
  return persistRun(awemeId, run, rootDir);
}
```

- [ ] **Step 5: Implement scene TTS run method**

Add to `server/services/agentRuns.js`:

```js
async function synthesizeDouyinRunSceneTts(awemeId, runId, options = {}) {
  if (!isSafeId(awemeId)) return createInvalidAwemeResult(awemeId);
  if (!isSafeRunId(runId)) {
    return { success: false, aweme_id: String(awemeId || ''), run_id: String(runId || ''), message: '未找到或非法的 Agent 运行记录' };
  }
  const runPath = getRunPath(awemeId, runId, options.rootDir);
  const run = await readJsonIfExists(runPath);
  if (!run) return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: '未找到该 Agent 运行记录' };
  const scenes = Array.isArray(run.storyboard_plan?.scenes) ? run.storyboard_plan.scenes : [];
  if (!scenes.length) return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: '请先生成导演分镜。' };

  const service = options.sceneTtsService || defaultSceneTts;
  const result = await service.synthesizeSceneTts({
    scenes,
    outputDir: getAgentRunsDir(awemeId, options.rootDir),
    runId,
    voice: options.voice,
    stylePrompt: options.stylePrompt,
    format: options.format || 'wav',
    ttsModel: options.ttsModel,
    readAudioDuration: options.readAudioDuration,
    concatenateAudioFiles: options.concatenateAudioFiles,
    configPath: options.configPath,
    ttsConfig: options.ttsConfig,
    fetchImpl: options.fetchImpl,
    waitImpl: options.waitImpl,
    maxRetries: options.maxRetries,
    retryDelayMs: options.retryDelayMs,
    ttsConcurrency: options.ttsConcurrency,
    ttsQueueIntervalMs: options.ttsQueueIntervalMs,
  });
  const sceneTtsValue = result.scene_tts || { status: 'failed', message: result.message || '分段配音失败。' };
  if (result.success) {
    sceneTtsValue.timed_storyboard_plan = storyboardTiming.buildTimedStoryboardPlan({
      storyboardPlan: run.storyboard_plan,
      sceneTts: sceneTtsValue,
    });
  }
  const updatedRun = {
    ...run,
    scene_tts: sceneTtsValue,
    tts: result.success ? {
      status: 'done',
      path: sceneTtsValue.path,
      file_name: sceneTtsValue.file_name,
      duration: sceneTtsValue.timed_storyboard_plan?.duration || 0,
      captions: sceneTtsValue.timed_storyboard_plan?.captions || [],
      phrase_captions: sceneTtsValue.timed_storyboard_plan?.phrase_captions || [],
      segments: sceneTtsValue.scenes || [],
      model: sceneTtsValue.model || {},
      message: '分段 TTS 语音合成完成。',
      updated_at: new Date().toISOString(),
    } : run.tts,
    video: null,
    updated_at: new Date().toISOString(),
  };
  updatedRun.workflow = workflowDecision.decideNextAction(updatedRun);
  await writeJson(runPath, updatedRun);
  return {
    success: !!result.success,
    aweme_id: String(awemeId),
    run_id: String(runId),
    message: result.message,
    scene_tts: updatedRun.scene_tts,
    tts: updatedRun.tts,
    workflow: updatedRun.workflow,
  };
}
```

- [ ] **Step 6: Implement visual storyboard run method**

Add to `server/services/agentRuns.js`:

```js
async function createDouyinRunVisualStoryboard(awemeId, runId, options = {}) {
  if (!isSafeId(awemeId)) return createInvalidAwemeResult(awemeId);
  if (!isSafeRunId(runId)) {
    return { success: false, aweme_id: String(awemeId || ''), run_id: String(runId || ''), message: '未找到或非法的 Agent 运行记录' };
  }
  const runPath = getRunPath(awemeId, runId, options.rootDir);
  const run = await readJsonIfExists(runPath);
  if (!run) return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: '未找到该 Agent 运行记录' };

  const timedPlan = run.scene_tts?.timed_storyboard_plan;
  const captions = Array.isArray(timedPlan?.captions) ? timedPlan.captions : [];
  const phraseCaptions = Array.isArray(timedPlan?.phrase_captions) ? timedPlan.phrase_captions : [];
  if (!captions.length) return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: '请先完成分段配音。' };

  const rewriteScript = Array.isArray(run.storyboard_plan?.scenes)
    ? run.storyboard_plan.scenes.map(scene => scene.narration_text).join('\n')
    : '';
  const storyboardConfig = await agentTemplateOverrides.resolveStoryboardAgentConfig({
    rootDir: options.rootDir,
    storyboardConfigOverride: options.storyboardConfigOverride,
  });
  if (!storyboardConfig || storyboardConfig.success === false) {
    return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: storyboardConfig?.message || '分镜 Agent 配置校验失败。' };
  }
  const agent = options.storyboardAgent || defaultStoryboardAgent;
  const result = await agent.createStoryboard({
    rewriteScript,
    captions,
    phraseCaptions,
    videoBrief: { target_duration_sec: run.storyboard_plan?.target_duration_sec || 60 },
    storyboardOptions: options.storyboardOptions || {},
    editableConfig: storyboardConfig,
    frameProfileId: options.frameProfileId,
    qualityFeedback: options.qualityFeedback || null,
    aiTextModel: options.aiTextModel,
    configPath: options.configPath,
    textConfig: options.textConfig,
    fetchImpl: options.fetchImpl,
  });
  const updatedRun = {
    ...run,
    storyboard_options: options.storyboardOptions || run.storyboard_options || {},
    storyboard_raw: result.raw || {},
    storyboard: result.storyboard,
    storyboard_model: result.model || {},
    storyboard_raw_parse_failed: !!result.raw_parse_failed,
    storyboard_config_snapshot: result.config_snapshot,
    storyboard_messages: result.messages || [],
    storyboard_raw_output: result.raw_output || '',
    storyboard_parse: result.parse || { success: false, error: '' },
    storyboard_schema_validation: result.schema_validation || { success: false, errors: [] },
    video: null,
    updated_at: new Date().toISOString(),
  };
  updatedRun.workflow = workflowDecision.decideNextAction(updatedRun);
  await writeJson(runPath, updatedRun);
  return {
    success: !!result.success,
    aweme_id: String(awemeId),
    run_id: String(runId),
    message: result.message,
    storyboard: updatedRun.storyboard,
    storyboard_schema_validation: updatedRun.storyboard_schema_validation,
    workflow: updatedRun.workflow,
  };
}
```

- [ ] **Step 7: Ensure project/render methods update workflow**

In `createDouyinRunHyperframesProject` and `renderDouyinRunHyperframesVideo`, before writing updated run JSON, attach:

```js
const nextRun = { ...run, video, updated_at: new Date().toISOString() };
nextRun.workflow = workflowDecision.decideNextAction(nextRun);
await writeJson(runPath, nextRun);
```

Return `workflow: nextRun.workflow` in the API response.

- [ ] **Step 8: Export new methods**

In `module.exports` of `server/services/agentRuns.js`, add:

```js
  createDouyinStoryboardPlanRun,
  synthesizeDouyinRunSceneTts,
  createDouyinRunVisualStoryboard,
  decideNextAction: workflowDecision.decideNextAction,
```

- [ ] **Step 9: Add routes**

In `server/routes/agents.js`, add:

```js
router.post('/douyin/:aweme_id/storyboard-plan-runs', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinStoryboardPlanRun(req.params.aweme_id, {
      promptOptions: req.body?.promptOptions || {},
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch {
    return res.status(500).json({ success: false, aweme_id: req.params.aweme_id, message: '导演分镜生成接口异常，请稍后重试。' });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/scene-tts', async (req, res) => {
  try {
    const result = await agentRuns.synthesizeDouyinRunSceneTts(req.params.aweme_id, req.params.run_id, req.body || {});
    return res.status(result.success ? 200 : 400).json(result);
  } catch {
    return res.status(500).json({ success: false, aweme_id: req.params.aweme_id, run_id: req.params.run_id, message: '分段配音接口异常，请稍后重试。' });
  }
});

router.post('/douyin/:aweme_id/runs/:run_id/visual-storyboard', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinRunVisualStoryboard(req.params.aweme_id, req.params.run_id, {
      storyboardOptions: req.body?.storyboardOptions || {},
      storyboardConfigOverride: req.body?.storyboardConfigOverride || null,
      frameProfileId: req.body?.frameProfileId || '',
      qualityFeedback: req.body?.qualityFeedback || null,
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch {
    return res.status(500).json({ success: false, aweme_id: req.params.aweme_id, run_id: req.params.run_id, message: '视觉分镜生成接口异常，请稍后重试。' });
  }
});

router.get('/douyin/:aweme_id/runs/:run_id/next-action', async (req, res) => {
  const result = await agentRuns.getDouyinAgentRun(req.params.aweme_id, req.params.run_id);
  if (!result.success) return res.status(404).json(result);
  return res.json({ success: true, workflow: agentRuns.decideNextAction(result.data) });
});
```

- [ ] **Step 10: Run test**

Run:

```bash
node tests/test-agent-runs.js
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add server/services/agentRuns.js server/routes/agents.js tests/test-agent-runs.js
git commit -m "接入分镜优先 AI 工作流接口"
```

---

### Task 6: Frontend API Client And Display Helpers

**Files:**
- Modify: `frontend-react/src/api/client.js`
- Modify: `frontend-react/src/utils/agentRuns.js`
- Test: `tests/test-agent-run-utils.mjs`

- [ ] **Step 1: Add failing utility tests**

In `tests/test-agent-run-utils.mjs`, add:

```js
import {
  getWorkflowStageLabel,
  getWorkflowActionLabel,
  isLegacyAgentRun,
} from '../frontend-react/src/utils/agentRuns.js';

assert.equal(getWorkflowStageLabel('storyboard_plan'), '导演分镜');
assert.equal(getWorkflowStageLabel('scene_tts'), '分段配音');
assert.equal(getWorkflowActionLabel('synthesize_scene_tts'), '生成分段配音');
assert.equal(getWorkflowActionLabel('compress_scene_narration'), '压缩超时分镜并重新配音');
assert.equal(isLegacyAgentRun({ result: { rewrite_script: '旧脚本' }, storyboard_plan: null }), true);
assert.equal(isLegacyAgentRun({ storyboard_plan: { status: 'planned' } }), false);
```

- [ ] **Step 2: Run utility test to verify it fails**

Run:

```bash
node tests/test-agent-run-utils.mjs
```

Expected: FAIL because helpers are missing.

- [ ] **Step 3: Add API methods**

In `frontend-react/src/api/client.js`, add:

```js
  createDouyinStoryboardPlanRun(awemeId, promptOptions = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/storyboard-plan-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptOptions }),
    });
  },
  synthesizeDouyinRunSceneTts(awemeId, runId, payload = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/scene-tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  createDouyinRunVisualStoryboard(awemeId, runId, storyboardOptions = {}, storyboardConfigOverride = null, frameProfileId = '', qualityFeedback = null) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/visual-storyboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyboardOptions, storyboardConfigOverride, frameProfileId, qualityFeedback }),
    });
  },
  getDouyinRunNextAction(awemeId, runId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/next-action`);
  },
```

- [ ] **Step 4: Add display helpers**

In `frontend-react/src/utils/agentRuns.js`, add:

```js
export function getWorkflowStageLabel(stage) {
  const labels = {
    empty: '未开始',
    storyboard_plan: '导演分镜',
    scene_tts: '分段配音',
    visual_storyboard: '视觉分镜',
    visual_storyboard_failed: '视觉分镜需修复',
    video_project: '视频工程',
    needs_script_repair: '口播需压缩',
    needs_visual_repair: '视觉需修复',
    done: '已完成',
  };
  return labels[stage] || '未知阶段';
}

export function getWorkflowActionLabel(action) {
  const labels = {
    generate_storyboard_plan: '生成导演分镜',
    synthesize_scene_tts: '生成分段配音',
    retry_scene_tts: '重试失败分镜配音',
    generate_visual_storyboard: '生成视觉分镜',
    repair_visual_storyboard: '修复视觉分镜结构',
    generate_video_project: '生成视频工程',
    render_video: '渲染 MP4',
    compress_scene_narration: '压缩超时分镜并重新配音',
    done: '已完成',
  };
  return labels[action] || '继续处理';
}

export function isLegacyAgentRun(run) {
  return !!(run?.result?.rewrite_script && !run?.storyboard_plan);
}
```

- [ ] **Step 5: Run utility test**

Run:

```bash
node tests/test-agent-run-utils.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend-react/src/api/client.js frontend-react/src/utils/agentRuns.js tests/test-agent-run-utils.mjs
git commit -m "新增前端 AI 工作流接口和状态文案"
```

---

### Task 7: Replace AI Workspace Main Flow

**Files:**
- Modify: `frontend-react/src/pages/AiWorkspace.jsx`
- Test: `tests/test-ai-workspace-brief-ui.mjs`

- [ ] **Step 1: Add failing source assertions**

In `tests/test-ai-workspace-brief-ui.mjs`, replace old storyboard button assertions with:

```js
assert.match(source, /createDouyinStoryboardPlanRun/);
assert.match(source, /synthesizeDouyinRunSceneTts/);
assert.match(source, /createDouyinRunVisualStoryboard/);
assert.match(source, /生成导演分镜/);
assert.match(source, /生成分段配音/);
assert.match(source, /生成视觉分镜/);
assert.match(source, /旧流程记录/);
assert.doesNotMatch(source, /带问题重新生成分镜/);
assert.doesNotMatch(source, /createDouyinRunStoryboard\(/);
```

- [ ] **Step 2: Run source test to verify it fails**

Run:

```bash
node tests/test-ai-workspace-brief-ui.mjs
```

Expected: FAIL because page still calls old storyboard flow.

- [ ] **Step 3: Import helpers**

In `frontend-react/src/pages/AiWorkspace.jsx`, extend imports from `../utils/agentRuns.js`:

```js
  getWorkflowActionLabel,
  getWorkflowStageLabel,
  isLegacyAgentRun,
```

- [ ] **Step 4: Add new state flags**

Replace separate old action flags as needed with:

```js
  const [workflowRunning, setWorkflowRunning] = useState(false);
```

Keep `videoGenerating` and `videoRendering` if existing render buttons still need separate spinners.

- [ ] **Step 5: Add current workflow derivation**

Inside `AiWorkspace`, add:

```js
  const workflow = activeRun?.workflow || {};
  const nextAction = workflow.next_action || (activeRun ? 'generate_storyboard_plan' : '');
  const legacyRun = isLegacyAgentRun(activeRun);
  const workflowBusy = workflowRunning || videoBusy;
```

- [ ] **Step 6: Add action handler**

Add:

```js
  async function runNextWorkflowAction() {
    const value = selectedAwemeId.trim();
    if (!value) {
      setStatus({ type: 'error', message: '请输入抖音视频 aweme_id' });
      return;
    }
    setWorkflowRunning(true);
    setStatus({ type: 'loading', message: `正在${getWorkflowActionLabel(nextAction)}...` });
    try {
      let json;
      if (nextAction === 'generate_storyboard_plan') {
        json = await api.createDouyinStoryboardPlanRun(value, DEFAULT_PROMPT_OPTIONS);
        setActiveRun(json.run || json);
      } else if (nextAction === 'synthesize_scene_tts' || nextAction === 'retry_scene_tts') {
        json = await api.synthesizeDouyinRunSceneTts(value, activeRun.run_id, {
          voice: ttsVoice,
          stylePrompt: ttsStylePrompt,
        });
        setActiveRun(prev => prev ? { ...prev, ...json, workflow: json.workflow, updated_at: new Date().toISOString() } : prev);
      } else if (nextAction === 'generate_visual_storyboard' || nextAction === 'repair_visual_storyboard') {
        const storyboardOverride = storyboardConfigDraft ? {
          systemPrompt: storyboardConfigDraft.systemPrompt,
          userPromptTemplate: storyboardConfigDraft.userPromptTemplate,
          useFrameProfile: storyboardConfigDraft.useFrameProfile !== false,
          modelOptions: storyboardConfigDraft.modelOptions || {},
        } : null;
        json = await api.createDouyinRunVisualStoryboard(
          value,
          activeRun.run_id,
          DEFAULT_STORYBOARD_OPTIONS,
          storyboardOverride,
          renderOptions.frameStyle,
          activeRun?.video?.video_quality_report || null,
        );
        setActiveRun(prev => prev ? { ...prev, ...json, workflow: json.workflow, updated_at: new Date().toISOString() } : prev);
      } else if (nextAction === 'generate_video_project') {
        await createVideoProject();
      } else if (nextAction === 'render_video') {
        await renderVideo();
      } else {
        setStatus({ type: 'info', message: workflow.message || '当前没有需要执行的下一步。' });
        return;
      }
      const runsJson = await api.listDouyinAgentRuns(value);
      const runList = runsJson.data || [];
      setRuns(runList);
      const latestRunId = json?.run_id || json?.run?.run_id || activeRun?.run_id;
      setActiveRun(runList.find(run => run.run_id === latestRunId) || runList[0] || null);
      setStatus({ type: json?.success === false ? 'error' : 'success', message: json?.message || '工作流已更新。' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setWorkflowRunning(false);
    }
  }
```

- [ ] **Step 7: Replace main workflow action area**

Replace old primary action cluster with a single workflow stage panel:

```jsx
<section className="agentResultSection">
  <div className="agentResultSectionHeader">
    <div>
      <h4>AI 成片流程</h4>
      <p>{workflow.message || '按顺序完成导演分镜、分段配音、视觉分镜和视频渲染。'}</p>
    </div>
    <Button
      size="sm"
      disabled={workflowBusy || !selectedAwemeId || nextAction === 'done' || legacyRun}
      onClick={runNextWorkflowAction}
    >
      {workflowRunning ? '处理中...' : getWorkflowActionLabel(nextAction)}
    </Button>
  </div>
  <ol className="workflowSteps">
    {['storyboard_plan', 'scene_tts', 'visual_storyboard', 'video_project', 'done'].map(stage => (
      <li className={workflow.stage === stage ? 'active' : ''} key={stage}>
        <span>{getWorkflowStageLabel(stage)}</span>
      </li>
    ))}
  </ol>
  {legacyRun ? <p className="mutedText">旧流程记录：该记录来自旧版“脚本 -> 整段配音 -> 分镜”流程，可查看结果，但主流程请重新生成导演分镜。</p> : null}
</section>
```

- [ ] **Step 8: Remove old primary flow calls**

Remove or move these from the main flow:

```js
runAgent
synthesizeTts
createStoryboard
```

Keep them only in an advanced legacy/debug section if still needed. The source test must not find `createDouyinRunStoryboard(` in `AiWorkspace.jsx`.

- [ ] **Step 9: Run frontend source test**

Run:

```bash
node tests/test-ai-workspace-brief-ui.mjs
```

Expected: PASS.

- [ ] **Step 10: Run frontend build**

Run:

```bash
npm run build:frontend
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add frontend-react/src/pages/AiWorkspace.jsx tests/test-ai-workspace-brief-ui.mjs
git commit -m "替换 AI 工作台主流程为分镜优先链路"
```

---

### Task 8: Integration Verification

**Files:**
- No new files expected.
- Modify only if verification reveals defects.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
node tests/test-storyboard-plan-agent.js
node tests/test-storyboard-timing.js
node tests/test-scene-tts.js
node tests/test-agent-workflow-decision.js
node tests/test-storyboard-schema.js
node tests/test-storyboard-agent.js
node tests/test-agent-runs.js
```

Expected: all PASS.

- [ ] **Step 2: Run frontend focused tests**

Run:

```bash
node tests/test-agent-run-utils.mjs
node tests/test-ai-workspace-brief-ui.mjs
npm run build:frontend
```

Expected: all PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Manual smoke with mocked or configured models**

Start server:

```bash
npm run dev
```

Open AI 工作台 and verify:

```text
1. 输入已有 aweme_id
2. 点击“生成导演分镜”
3. 点击“生成分段配音”
4. 点击“生成视觉分镜”
5. 点击“生成视频工程”
6. 点击“渲染 MP4”
```

Expected:

```text
每一步都有 loading。
每一步完成后 workflow.next_action 更新到下一步。
duration_too_long 不再显示“带问题重新生成分镜”，而显示压缩/重新配音类动作。
旧 run 显示“旧流程记录”，不作为主流程继续。
```

- [ ] **Step 5: Commit final fixes if needed**

If Step 1-4 required fixes:

```bash
git add <changed-files>
git commit -m "修复分镜优先工作流验证问题"
```

---

## Self-Review

- Spec coverage: Covers backend plan generation, scene TTS, timing backfill, workflow decision, strict visual storyboard validation, new routes, frontend API, frontend main-flow replacement, and verification.
- Placeholder scan: No `TBD` or open-ended implementation placeholders remain; each task includes concrete file changes and commands.
- Type consistency: Uses `storyboard_plan`, `scene_tts`, `timed_storyboard_plan`, `workflow.stage`, and `workflow.next_action` consistently across backend and frontend.
- Scope check: Repair automation for scene compression is represented as `compress_scene_narration` routing, but the actual compression endpoint is intentionally deferred until the new main flow is stable. That keeps this replacement deliverable focused and testable.
