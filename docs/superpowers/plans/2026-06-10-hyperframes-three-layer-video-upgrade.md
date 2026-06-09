# HyperFrames Three-Layer Video Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前“长口播 + 固定卡片轮播”的 HyperFrames 成片链路升级为“可控时长 + HyperFrames 专家分镜 + 可执行视觉 DSL + 多类型 DOM/GSAP 场景渲染”。

**Architecture:** 保留现有主链路：任务 Agent 生成 `rewrite_script`，TTS 生成字幕时间轴，分镜 Agent 根据字幕生成 scene，HyperFrames CLI 渲染 MP4。新增 `video_brief`、`visual_scene` DSL 和独立 scene renderer 模块；旧分镜继续通过 fallback DSL 渲染，避免历史 run 失效。

**Tech Stack:** Node.js CommonJS、Express 服务层、现有 plain Node `assert` 测试、HyperFrames HTML/CSS/GSAP 工程输出。

---

## File Structure

- Modify: `server/services/agentTemplates.js`
  - 增加 `video_brief` 归一化。
  - 更新 `viral_rewrite` 默认 prompt 和可编辑模板，要求 45-75 秒脚本、beats 和视频节奏。
  - 将 `video_brief` 加入 `resultFields`。
- Modify: `server/services/agentRuns.js`
  - `validateTaskAgentResult` 允许并校验 `video_brief`。
  - `createDouyinRunStoryboard` 将 `run.result.video_brief` 传给分镜 Agent。
- Modify: `server/services/storyboardAgent.js`
  - 分镜 Agent 系统提示词升级为 HyperFrames 视觉导演 / HyperFrames 专家。
  - 用户提示词要求 AI 自动选择白名单 `visual_type`。
  - 将 `videoBrief` 注入分镜 messages。
- Modify: `server/services/storyboardSchema.js`
  - 增加 `VISUAL_TYPE_ALLOWED`、`VISUAL_OBJECT_ALLOWED`、`VISUAL_MOTION_ALLOWED`。
  - 增加 `normalizeVisualScene`、`normalizeVisualObject`、`normalizeVisualMotion`、`makeFallbackVisualScene`。
  - `buildScene` 保留/生成 `visual_scene`。
- Create: `server/services/hyperframesVisualDsl.js`
  - 渲染前归一化 scene DSL。
  - 将旧 scene 转换为 fallback DSL。
- Create: `server/services/hyperframesSceneRenderers.js`
  - 输出各类 scene HTML：`workflow`、`code_panel`、`ui_mockup`、`split_compare`、`concept_map`、`timeline`、`quote_burst` 和旧卡片。
- Create: `server/services/hyperframesAnimations.js`
  - 输出每个 scene 的 GSAP timeline 片段。
  - 保证首帧不空白。
- Modify: `server/services/hyperframesProject.js`
  - 使用新 DSL 和 renderer。
  - 写入 `visual_dsl_version: 1`。
  - 保留字幕条、背景层、音频和 HyperFrames timeline 入口。
- Modify: `server/services/frameProfiles.js`
  - 将 profile 的 `sceneRenderers` 扩展为新白名单。
- Modify: `test-agent-templates.js`
- Modify: `test-storyboard-agent.js`
- Modify: `test-storyboard-schema.js`
- Modify: `test-hyperframes-project.js`
- Create: `test-hyperframes-visual-dsl.js`
- Create: `test-hyperframes-scene-renderers.js`

---

### Task 1: Task Agent Adds `video_brief`

**Files:**
- Modify: `server/services/agentTemplates.js`
- Modify: `server/services/agentRuns.js`
- Test: `test-agent-templates.js`

- [ ] **Step 1: Write failing tests for `video_brief` normalization and prompt**

In `test-agent-templates.js`, update the viral result fields assertion:

```js
assert.deepEqual(viral.resultFields, ['summary', 'viral_points', 'audience', 'comment_insights', 'topics', 'rewrite_script', 'titles', 'video_brief']);
```

Add after the existing `customPrompt` assertions:

```js
assert.match(customPrompt[0].content, /video_brief/);
assert.match(customPrompt[0].content, /target_duration_sec/);
assert.match(customPrompt[0].content, /beats/);
assert.match(customPrompt[0].content, /45-75/);
assert.match(customPrompt[0].content, /rewrite_script/);

const normalizedViral = viral.normalizeResult({
  summary: '摘要',
  viral_points: ['爆点'],
  audience: '普通用户',
  comment_insights: ['想看教程'],
  topics: ['主题'],
  rewrite_script: '第一句。第二句。',
  titles: ['标题'],
  video_brief: {
    target_duration_sec: 90,
    target_word_count: 400,
    tone: '知识科普',
    hook: '先抛误解',
    beats: [
      {
        purpose: 'hook',
        summary: '拆误解',
        duration_sec: 6,
        visual_intent: '强对比开场',
      },
    ],
  },
});
assert.equal(normalizedViral.video_brief.target_duration_sec, 90);
assert.equal(normalizedViral.video_brief.target_word_count, 400);
assert.equal(normalizedViral.video_brief.beats[0].purpose, 'hook');
assert.equal(normalizedViral.video_brief.beats[0].visual_intent, '强对比开场');

const emptyViral = viral.normalizeResult({});
assert.deepStrictEqual(emptyViral.video_brief, {
  target_duration_sec: 60,
  target_word_count: 220,
  tone: '',
  hook: '',
  beats: [],
});
```

Update editable viral assertions:

```js
assert.ok(editableViral.systemPrompt.includes('video_brief'));
assert.ok(editableViral.systemPrompt.includes('45-75'));
assert.ok(editableViral.userPromptTemplate.includes('{{promptOptionsText}}'));
assert.deepEqual(editableViral.resultFields, [
  'summary',
  'viral_points',
  'audience',
  'comment_insights',
  'topics',
  'rewrite_script',
  'titles',
  'video_brief',
]);
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
node test-agent-templates.js
```

Expected: FAIL because `video_brief` is not normalized or listed in `resultFields`.

- [ ] **Step 3: Implement `video_brief` helpers**

In `server/services/agentTemplates.js`, add near `normalizeStringArray`:

```js
function normalizeNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeVideoBrief(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const beats = Array.isArray(source.beats)
    ? source.beats.map(item => {
      const beat = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
      return {
        purpose: sanitizeOptionText(beat.purpose, 40),
        summary: sanitizeOptionText(beat.summary, 120),
        duration_sec: normalizeNumber(beat.duration_sec, 6, 2, 20),
        visual_intent: sanitizeOptionText(beat.visual_intent, 160),
      };
    }).filter(item => item.purpose || item.summary || item.visual_intent).slice(0, 12)
    : [];

  return {
    target_duration_sec: normalizeNumber(source.target_duration_sec, 60, 15, 180),
    target_word_count: normalizeNumber(source.target_word_count, 220, 60, 900),
    tone: sanitizeOptionText(source.tone, 120),
    hook: sanitizeOptionText(source.hook, 160),
    beats,
  };
}
```

Update `normalizeViralRewriteResult`:

```js
function normalizeViralRewriteResult(value = {}) {
  const result = value && typeof value === 'object' ? value : {};
  return {
    summary: typeof result.summary === 'string' ? result.summary : '',
    viral_points: normalizeStringArray(result.viral_points),
    audience: typeof result.audience === 'string' ? result.audience : '',
    comment_insights: normalizeStringArray(result.comment_insights),
    topics: normalizeStringArray(result.topics),
    rewrite_script: typeof result.rewrite_script === 'string' ? result.rewrite_script : '',
    titles: normalizeStringArray(result.titles),
    video_brief: normalizeVideoBrief(result.video_brief),
  };
}
```

Update `getViralRewriteSystemPrompt()` so the JSON rule includes `video_brief`:

```js
'JSON 字段必须包含 summary, viral_points, audience, comment_insights, topics, rewrite_script, titles, video_brief。',
'video_brief 必须包含 target_duration_sec, target_word_count, tone, hook, beats；beats 是视频节奏段落数组。',
'默认把 rewrite_script 控制在 45-75 秒中文口播，约 180-260 个汉字；除非用户明确要求更长。',
'rewrite_script 每句尽量短，适合 TTS 字幕切分和 HyperFrames 视觉节奏。',
'复杂内容要压缩成可视化段落，不要为了完整解释无限拉长脚本。',
```

Update `buildViralRewritePrompt()` system message with the same required fields and constraints.

Update viral template `resultFields`:

```js
resultFields: ['summary', 'viral_points', 'audience', 'comment_insights', 'topics', 'rewrite_script', 'titles', 'video_brief'],
```

Export the helper:

```js
normalizeVideoBrief,
```

- [ ] **Step 4: Allow `video_brief` in task result validation**

In `server/services/agentRuns.js`, inside `validateTaskAgentResult`, after array validation:

```js
if (templateDefinition.id === TEMPLATE_VIRAL_REWRITE) {
  const brief = result.video_brief;
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
    errors.push('video_brief 必须是对象。');
  } else if (!Array.isArray(brief.beats)) {
    errors.push('video_brief.beats 必须是数组。');
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
node test-agent-templates.js
```

Expected: PASS with `agent template tests passed`.

- [ ] **Step 6: Commit**

```powershell
git add -- server/services/agentTemplates.js server/services/agentRuns.js test-agent-templates.js
git commit -m "增强任务 Agent 视频节奏输出"
```

---

### Task 2: Storyboard Agent Becomes HyperFrames Expert

**Files:**
- Modify: `server/services/storyboardAgent.js`
- Modify: `server/services/agentRuns.js`
- Test: `test-storyboard-agent.js`

- [ ] **Step 1: Write failing tests for expert prompt, automatic `visual_type`, and `videoBrief` injection**

In `test-storyboard-agent.js`, update the first `buildStoryboardMessages` call:

```js
const messages = storyboardAgent.buildStoryboardMessages({
  rewriteScript: 'test script',
  captions: [{ index: 1, start: 0, end: 2, duration: 2, text: 'first line' }],
  videoBrief: {
    target_duration_sec: 60,
    target_word_count: 220,
    tone: '知识科普',
    hook: '先拆误解',
    beats: [
      { purpose: 'hook', summary: '开场问题', duration_sec: 5, visual_intent: '强对比' },
    ],
  },
  storyboardOptions: {
    visualStyle: 'business style',
    pacing: 'fast',
    captionStyle: 'large captions',
    backgroundDirection: 'abstract data background',
    primaryColor: '#fe2c55',
    forbidden: 'no real people, no original video frames',
    extraRequirements: 'short headlines',
  },
});
```

Add assertions:

```js
assert.match(messages[0].content, /HyperFrames/);
assert.match(messages[0].content, /DOM\/CSS\/GSAP/);
assert.match(messages[0].content, /不是图片生成模型/);
assert.match(messages[1].content, /visual_scene/);
assert.match(messages[1].content, /workflow/);
assert.match(messages[1].content, /code_panel/);
assert.match(messages[1].content, /ui_mockup/);
assert.match(messages[1].content, /split_compare/);
assert.match(messages[1].content, /concept_map/);
assert.match(messages[1].content, /timeline/);
assert.match(messages[1].content, /quote_burst/);
assert.match(messages[1].content, /自动选择 visual_type/);
assert.match(messages[1].content, /视频结构 brief/);
assert.match(messages[1].content, /target_duration_sec/);
assert.match(messages[1].content, /开场问题/);
```

In the `createStoryboard` test that records `calls`, pass `videoBrief`:

```js
videoBrief: {
  target_duration_sec: 60,
  target_word_count: 220,
  tone: '教程感',
  hook: '一句话解释',
  beats: [{ purpose: 'explain', summary: '定义', duration_sec: 8, visual_intent: '概念图' }],
},
```

Add:

```js
assert.match(calls[0].messages[1].content, /教程感/);
assert.match(calls[0].messages[1].content, /概念图/);
```

- [ ] **Step 2: Run the failing test**

```powershell
node test-storyboard-agent.js
```

Expected: FAIL because current prompt has no `visual_scene`, no expert identity, and no `videoBrief` injection.

- [ ] **Step 3: Add `videoBrief` formatting**

In `server/services/storyboardAgent.js`, add:

```js
function formatVideoBriefForPrompt(videoBrief = {}) {
  const source = videoBrief && typeof videoBrief === 'object' && !Array.isArray(videoBrief) ? videoBrief : {};
  const beats = Array.isArray(source.beats) ? source.beats.slice(0, 12) : [];
  return [
    '视频结构 brief：',
    `- 目标时长：${Number(source.target_duration_sec || 60)} 秒`,
    `- 目标字数：${Number(source.target_word_count || 220)} 字`,
    `- 语气风格：${source.tone || '未指定'}`,
    `- 开场钩子：${source.hook || '未指定'}`,
    '- 节奏段落：',
    beats.length
      ? JSON.stringify(beats.map(beat => ({
        purpose: beat.purpose || '',
        summary: beat.summary || '',
        duration_sec: Number(beat.duration_sec || 0),
        visual_intent: beat.visual_intent || '',
      })), null, 2)
      : '[]',
  ].join('\n');
}
```

- [ ] **Step 4: Update default storyboard prompt**

Update `buildStoryboardMessages` signature:

```js
function buildStoryboardMessages({
  rewriteScript,
  captions,
  videoBrief = {},
  storyboardOptions = {},
  frameProfileId = DEFAULT_FRAME_PROFILE_ID,
  frameDocText = '',
} = {}) {
```

In system content, replace the opening identity lines with:

```js
'你是 MuseDock 的 HyperFrames 视觉导演 Agent，也是一名熟悉 DOM/CSS/GSAP 动效编排的 HyperFrames 专家。',
'你不是图片生成模型，不输出摄影幻想描述；你要把口播脚本转成可由 HyperFrames 渲染的结构化视觉分镜。',
'请只输出 JSON，不要输出 Markdown、解释或代码块。',
'你只负责决定原创视觉分镜结构、标题、布局、强调词、visual_type 和 visual_scene。',
```

In user content, after rewrite script, add:

```js
'',
formatVideoBriefForPrompt(videoBrief),
```

In requirements, add:

```js
'- visual_type 必须由你根据字幕语义、视频结构 brief 和画面节奏自动选择，用户不需要指定。',
'- visual_type 只能使用 workflow、code_panel、ui_mockup、split_compare、concept_map、timeline、quote_burst、text_card、quote_card、step_card、contrast_card。',
'- 每个 scene 必须输出 visual_scene，包含 composition、objects、motion；objects 必须能用 DOM/CSS/GSAP 表达。',
'- 不要输出真实摄影、人物镜头、复杂 3D 城市、无法由 DOM/CSS/GSAP 稳定实现的描述。',
```

- [ ] **Step 5: Update editable storyboard template**

In `getEditableStoryboardTemplate()`, mirror the system prompt identity and add `{{videoBriefText}}` to `userPromptTemplate` after `{{rewriteScript}}`.

Update `buildStoryboardMessagesFromEditableConfig` call in `createStoryboard`:

```js
videoBriefText: formatVideoBriefForPrompt(options.videoBrief || {}),
```

- [ ] **Step 6: Pass `video_brief` from runs to storyboard agent**

In `server/services/agentRuns.js`, in `createDouyinRunStoryboard`, before `const result = await agent.createStoryboard`, add:

```js
const videoBrief = run?.result?.video_brief || {};
```

Pass it:

```js
videoBrief,
```

- [ ] **Step 7: Export formatter and run tests**

In `storyboardAgent.js` exports, add:

```js
formatVideoBriefForPrompt,
```

Run:

```powershell
node test-storyboard-agent.js
```

Expected: PASS with `storyboard agent tests passed`.

- [ ] **Step 8: Commit**

```powershell
git add -- server/services/storyboardAgent.js server/services/agentRuns.js test-storyboard-agent.js
git commit -m "升级分镜 Agent 为 HyperFrames 视觉导演"
```

---

### Task 3: Storyboard Schema Normalizes Visual DSL

**Files:**
- Modify: `server/services/storyboardSchema.js`
- Test: `test-storyboard-schema.js`

- [ ] **Step 1: Write failing schema tests**

In `test-storyboard-schema.js`, inside `run()`, after the first `normalized` assertions:

```js
const visualDsl = schema.normalizeStoryboard({
  storyboard: {
    template: 'ai_storyboard_cards',
    scenes: [
      {
        caption_indexes: [1],
        headline: '传统开发链路',
        visual_type: 'workflow',
        layout: 'vertical_flow',
        background_prompt: '原创流程背景',
        emphasis_words: ['产品需求'],
        visual_scene: {
          composition: 'vertical_flow',
          objects: [
            { id: 'node-1', type: 'node', text: '产品需求', role: 'primary' },
            { id: 'node-2', type: 'node', text: '设计界面', role: 'primary' },
            { id: 'bad', type: 'unknown', text: '应被丢弃' },
          ],
          motion: [
            { target: 'node', effect: 'stagger_reveal', delay: 0.1 },
            { target: 'bad', effect: 'explode', delay: 999 },
          ],
          focus: { text: '流程太重', style: 'warning_pulse' },
        },
      },
    ],
  },
  captions,
});
assert.equal(visualDsl.scenes[0].visual_type, 'workflow');
assert.equal(visualDsl.scenes[0].visual_scene.composition, 'vertical_flow');
assert.equal(visualDsl.scenes[0].visual_scene.objects.length, 2);
assert.equal(visualDsl.scenes[0].visual_scene.objects[0].type, 'node');
assert.equal(visualDsl.scenes[0].visual_scene.motion.length, 1);
assert.equal(visualDsl.scenes[0].visual_scene.motion[0].effect, 'stagger_reveal');
assert.equal(visualDsl.scenes[0].visual_scene.focus.text, '流程太重');

const fallbackVisual = schema.normalizeStoryboard({
  storyboard: {
    scenes: [
      {
        caption_indexes: [1],
        headline: '未知类型',
        visual_type: 'imaginary_camera_scene',
        layout: 'center_focus',
        background_prompt: '原创背景',
        emphasis_words: ['重点一', '重点二'],
      },
    ],
  },
  captions,
});
assert.equal(fallbackVisual.scenes[0].visual_type, 'quote_burst');
assert.equal(fallbackVisual.scenes[0].visual_scene.composition, 'burst_center');
assert.ok(fallbackVisual.scenes[0].visual_scene.objects.length >= 2);
```

Add validation test:

```js
const visualValidation = schema.validateStoryboardEditableInput({
  storyboard: {
    scenes: [
      {
        caption_indexes: [1],
        headline: '视觉 DSL',
        visual_type: 'workflow',
        layout: 'vertical_flow',
        background_prompt: '原创背景',
        emphasis_words: ['重点'],
        visual_scene: {
          composition: 'vertical_flow',
          objects: [{ type: 'node', text: '节点' }],
          motion: [{ target: 'node', effect: 'stagger_reveal' }],
        },
      },
    ],
  },
  captions: [{ index: 1, start: 0, end: 1, duration: 1, text: '字幕一' }],
});
assert.equal(visualValidation.success, true);
```

- [ ] **Step 2: Run failing test**

```powershell
node test-storyboard-schema.js
```

Expected: FAIL because `visual_scene` is not present.

- [ ] **Step 3: Add constants and helpers**

In `server/services/storyboardSchema.js`, add after defaults:

```js
const VISUAL_TYPE_ALLOWED = [
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

const VISUAL_OBJECT_ALLOWED = [
  'node',
  'connector',
  'code',
  'terminal',
  'panel',
  'button',
  'field',
  'metric',
  'column',
  'branch',
  'milestone',
  'badge',
  'keyword',
];

const VISUAL_MOTION_ALLOWED = [
  'stagger_reveal',
  'draw_line',
  'type_in',
  'scan',
  'pulse',
  'slide_in',
  'zoom_focus',
  'highlight',
  'float',
];

function pickAllowed(value, allowed, fallback) {
  const text = sanitizeText(value);
  return allowed.includes(text) ? text : fallback;
}

function sanitizeShortText(value, fallback = '', limit = 18) {
  return sanitizeText(value, fallback).replace(/\s+/g, ' ').slice(0, limit);
}
```

- [ ] **Step 4: Implement visual scene normalization**

Add before `buildScene`:

```js
function normalizeVisualObject(object = {}, index = 0) {
  const source = object && typeof object === 'object' && !Array.isArray(object) ? object : {};
  const type = pickAllowed(source.type, VISUAL_OBJECT_ALLOWED, '');
  if (!type) return null;
  const id = sanitizeShortText(source.id, `${type}-${index + 1}`, 32).replace(/[^A-Za-z0-9_-]/g, '') || `${type}-${index + 1}`;
  const normalized = {
    id,
    type,
    text: sanitizeShortText(source.text, '', 18),
    role: sanitizeShortText(source.role, 'default', 24),
    style: sanitizeShortText(source.style, '', 24),
  };
  if (source.from) normalized.from = sanitizeShortText(source.from, '', 32);
  if (source.to) normalized.to = sanitizeShortText(source.to, '', 32);
  if (source.code) normalized.code = String(source.code).trim().slice(0, 160);
  return normalized;
}

function normalizeVisualMotion(item = {}) {
  const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
  const effect = pickAllowed(source.effect, VISUAL_MOTION_ALLOWED, '');
  if (!effect) return null;
  return {
    target: sanitizeShortText(source.target, 'object', 32),
    effect,
    delay: Math.max(0, Math.min(3, Number(source.delay || 0))),
  };
}

function makeFallbackVisualScene(scene = {}) {
  const words = asArray(scene.emphasis_words).map(item => sanitizeShortText(item)).filter(Boolean).slice(0, 6);
  const objects = words.length
    ? words.map((word, index) => ({ id: `keyword-${index + 1}`, type: 'keyword', text: word, role: index === 0 ? 'primary' : 'support' }))
    : [{ id: 'headline-1', type: 'keyword', text: sanitizeShortText(scene.headline, '核心观点'), role: 'primary' }];
  return {
    composition: 'burst_center',
    objects,
    motion: [
      { target: 'keyword', effect: 'stagger_reveal', delay: 0.1 },
      { target: 'keyword', effect: 'pulse', delay: 0.4 },
    ],
    focus: {
      text: sanitizeShortText(scene.headline, ''),
      style: 'accent_pulse',
    },
  };
}

function normalizeVisualScene(scene = {}) {
  const source = scene.visual_scene && typeof scene.visual_scene === 'object' && !Array.isArray(scene.visual_scene)
    ? scene.visual_scene
    : makeFallbackVisualScene(scene);
  const objects = asArray(source.objects)
    .map(normalizeVisualObject)
    .filter(Boolean)
    .slice(0, 8);
  const fallback = makeFallbackVisualScene(scene);
  const safeObjects = objects.length ? objects : fallback.objects;
  const motion = asArray(source.motion)
    .map(normalizeVisualMotion)
    .filter(Boolean)
    .slice(0, 8);
  const focus = source.focus && typeof source.focus === 'object' && !Array.isArray(source.focus)
    ? source.focus
    : {};
  return {
    composition: sanitizeShortText(source.composition, fallback.composition, 40),
    objects: safeObjects,
    motion: motion.length ? motion : fallback.motion,
    focus: {
      text: sanitizeShortText(focus.text, fallback.focus.text, 24),
      style: sanitizeShortText(focus.style, fallback.focus.style, 24),
    },
  };
}
```

- [ ] **Step 5: Integrate with scene building**

In `buildScene`, before return:

```js
const visualType = pickAllowed(source.visual_type, VISUAL_TYPE_ALLOWED, 'quote_burst');
const baseScene = {
  index: sceneIndex,
  caption_indexes: sceneCaptions.map(item => item.index),
  start,
  end,
  duration: roundTime(end - start),
  headline: sanitizeText(source.headline, sceneCaptions[0].text),
  visual_type: visualType,
  layout: sanitizeText(source.layout, sceneIndex % 2 === 1 ? 'center_focus' : 'split_emphasis'),
  background_prompt: sanitizeText(source.background_prompt, '原创抽象动态图文背景，不包含原视频画面'),
  emphasis_words: asArray(source.emphasis_words).map(item => String(item).trim()).filter(Boolean).slice(0, 6),
  captions: sceneCaptions,
};
return {
  ...baseScene,
  visual_scene: normalizeVisualScene(baseScene.visual_scene ? baseScene : { ...baseScene, visual_scene: source.visual_scene }),
};
```

Remove the old direct return block in `buildScene`.

- [ ] **Step 6: Export constants and helpers**

Add to `module.exports`:

```js
VISUAL_TYPE_ALLOWED,
VISUAL_OBJECT_ALLOWED,
VISUAL_MOTION_ALLOWED,
normalizeVisualScene,
makeFallbackVisualScene,
```

- [ ] **Step 7: Run tests**

```powershell
node test-storyboard-schema.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add -- server/services/storyboardSchema.js test-storyboard-schema.js
git commit -m "新增分镜视觉 DSL 归一化"
```

---

### Task 4: Add HyperFrames Visual DSL Runtime

**Files:**
- Create: `server/services/hyperframesVisualDsl.js`
- Test: `test-hyperframes-visual-dsl.js`

- [ ] **Step 1: Write failing tests**

Create `test-hyperframes-visual-dsl.js`:

```js
const assert = require('assert');
const visualDsl = require('./server/services/hyperframesVisualDsl');

function run() {
  const scene = {
    index: 1,
    headline: '传统开发链路',
    visual_type: 'workflow',
    emphasis_words: ['产品需求', '设计界面'],
    visual_scene: {
      composition: 'vertical_flow',
      objects: [
        { id: 'node-1', type: 'node', text: '产品需求' },
        { id: 'node-2', type: 'node', text: '设计界面' },
      ],
      motion: [{ target: 'node', effect: 'stagger_reveal', delay: 0.1 }],
      focus: { text: '流程太重', style: 'warning_pulse' },
    },
  };

  const normalized = visualDsl.prepareSceneDsl(scene);
  assert.equal(normalized.visualType, 'workflow');
  assert.equal(normalized.composition, 'vertical_flow');
  assert.equal(normalized.objects.length, 2);
  assert.equal(normalized.motion[0].effect, 'stagger_reveal');
  assert.equal(normalized.focus.text, '流程太重');

  const fallback = visualDsl.prepareSceneDsl({
    index: 2,
    headline: '一句话定义',
    visual_type: 'missing_type',
    emphasis_words: ['自然语言', '指挥 AI'],
  });
  assert.equal(fallback.visualType, 'quote_burst');
  assert.equal(fallback.objects[0].type, 'keyword');
  assert.equal(fallback.objects[0].text, '自然语言');
}

try {
  run();
  console.log('hyperframes visual dsl tests passed');
} catch (error) {
  console.error(error);
  process.exit(1);
}
```

- [ ] **Step 2: Run failing test**

```powershell
node test-hyperframes-visual-dsl.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement visual DSL runtime**

Create `server/services/hyperframesVisualDsl.js`:

```js
const storyboardSchema = require('./storyboardSchema');

function prepareSceneDsl(scene = {}) {
  const normalizedScene = {
    ...scene,
    visual_type: storyboardSchema.VISUAL_TYPE_ALLOWED.includes(scene.visual_type)
      ? scene.visual_type
      : 'quote_burst',
  };
  const visualScene = storyboardSchema.normalizeVisualScene(normalizedScene);
  return {
    visualType: normalizedScene.visual_type,
    composition: visualScene.composition,
    objects: visualScene.objects,
    motion: visualScene.motion,
    focus: visualScene.focus,
  };
}

function prepareScenes(scenes = []) {
  return Array.isArray(scenes)
    ? scenes.map(scene => ({ ...scene, prepared_visual_scene: prepareSceneDsl(scene) }))
    : [];
}

module.exports = {
  prepareSceneDsl,
  prepareScenes,
};
```

- [ ] **Step 4: Run test**

```powershell
node test-hyperframes-visual-dsl.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- server/services/hyperframesVisualDsl.js test-hyperframes-visual-dsl.js
git commit -m "新增 HyperFrames 视觉 DSL 运行时"
```

---

### Task 5: Add Scene Renderers

**Files:**
- Create: `server/services/hyperframesSceneRenderers.js`
- Test: `test-hyperframes-scene-renderers.js`

- [ ] **Step 1: Write failing renderer tests**

Create `test-hyperframes-scene-renderers.js`:

```js
const assert = require('assert');
const renderers = require('./server/services/hyperframesSceneRenderers');

function baseScene(visualType, objects) {
  return {
    index: 1,
    headline: '测试标题',
    visual_type: visualType,
    prepared_visual_scene: {
      visualType,
      composition: 'test',
      objects,
      motion: [{ target: 'node', effect: 'stagger_reveal', delay: 0.1 }],
      focus: { text: '焦点', style: 'accent_pulse' },
    },
  };
}

function run() {
  const workflow = renderers.renderSceneContent({
    scene: baseScene('workflow', [
      { id: 'node-1', type: 'node', text: '产品需求' },
      { id: 'node-2', type: 'node', text: '设计界面' },
      { id: 'line-1', type: 'connector', from: 'node-1', to: 'node-2' },
    ]),
    index: 0,
    wordHtml: '<span>重点</span>',
  });
  assert.match(workflow, /scene-content--workflow/);
  assert.match(workflow, /visual-node/);
  assert.match(workflow, /visual-connector/);

  const code = renderers.renderSceneContent({
    scene: baseScene('code_panel', [
      { id: 'code-1', type: 'code', text: '生成页面', code: 'const app = createApp();' },
      { id: 'terminal-1', type: 'terminal', text: 'npm run dev' },
    ]),
    index: 0,
    wordHtml: '',
  });
  assert.match(code, /scene-content--code-panel/);
  assert.match(code, /visual-code-line/);
  assert.match(code, /visual-terminal/);

  const ui = renderers.renderSceneContent({
    scene: baseScene('ui_mockup', [
      { id: 'panel-1', type: 'panel', text: '背单词工具' },
      { id: 'field-1', type: 'field', text: '输入单词' },
      { id: 'button-1', type: 'button', text: '添加' },
    ]),
    index: 0,
    wordHtml: '',
  });
  assert.match(ui, /scene-content--ui-mockup/);
  assert.match(ui, /visual-ui-panel/);
  assert.match(ui, /visual-ui-button/);

  const compare = renderers.renderSceneContent({
    scene: baseScene('split_compare', [
      { id: 'old', type: 'column', text: '多人协作' },
      { id: 'new', type: 'column', text: '你和 AI' },
    ]),
    index: 0,
    wordHtml: '',
  });
  assert.match(compare, /scene-content--split-compare/);
  assert.match(compare, /visual-compare-column/);

  const quote = renderers.renderSceneContent({
    scene: baseScene('quote_burst', [
      { id: 'keyword-1', type: 'keyword', text: '自然语言' },
    ]),
    index: 0,
    wordHtml: '<span>自然语言</span>',
  });
  assert.match(quote, /scene-content--quote-burst/);
}

try {
  run();
  console.log('hyperframes scene renderer tests passed');
} catch (error) {
  console.error(error);
  process.exit(1);
}
```

- [ ] **Step 2: Run failing test**

```powershell
node test-hyperframes-scene-renderers.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement renderers**

Create `server/services/hyperframesSceneRenderers.js`:

```js
function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function objectText(object) {
  return escapeHtml(object?.text || '');
}

function renderObjectList(objects = [], className = 'visual-pill') {
  return objects.map((object, index) => (
    `<div class="${className} ${className}--${escapeHtml(object.type)}" data-visual-object="${escapeHtml(object.id || index + 1)}">${objectText(object)}</div>`
  )).join('');
}

function renderWorkflowScene(scene) {
  const dsl = scene.prepared_visual_scene || {};
  const nodes = (dsl.objects || []).filter(item => item.type === 'node');
  const connectors = (dsl.objects || []).filter(item => item.type === 'connector');
  return [
    '<div class="scene-content scene-content--workflow" data-visual-type="workflow">',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    '  <div class="visual-flow">',
    nodes.map((node, index) => `<div class="visual-node" data-visual-object="${escapeHtml(node.id)}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${objectText(node)}</strong></div>`).join(''),
    connectors.map(connector => `<div class="visual-connector" data-from="${escapeHtml(connector.from)}" data-to="${escapeHtml(connector.to)}"></div>`).join(''),
    '  </div>',
    '</div>',
  ].join('\n');
}

function renderCodePanelScene(scene) {
  const dsl = scene.prepared_visual_scene || {};
  const objects = dsl.objects || [];
  const code = objects.find(item => item.type === 'code');
  const terminal = objects.find(item => item.type === 'terminal');
  return [
    '<div class="scene-content scene-content--code-panel" data-visual-type="code_panel">',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    '  <div class="visual-code-window">',
    '    <div class="visual-window-dots"><i></i><i></i><i></i></div>',
    `    <pre class="visual-code-line">${escapeHtml(code?.code || code?.text || 'const idea = await ai.build();')}</pre>`,
    `    <div class="visual-terminal">${objectText(terminal || { text: '运行中...' })}</div>`,
    '  </div>',
    '</div>',
  ].join('\n');
}

function renderUiMockupScene(scene) {
  const dsl = scene.prepared_visual_scene || {};
  const panels = (dsl.objects || []).filter(item => ['panel', 'field', 'button', 'metric'].includes(item.type));
  return [
    '<div class="scene-content scene-content--ui-mockup" data-visual-type="ui_mockup">',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    '  <div class="visual-ui-panel">',
    renderObjectList(panels, 'visual-ui-item'),
    '    <div class="visual-ui-button">生成</div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

function renderSplitCompareScene(scene) {
  const dsl = scene.prepared_visual_scene || {};
  const columns = (dsl.objects || []).filter(item => item.type === 'column').slice(0, 2);
  const left = columns[0] || { text: '旧流程' };
  const right = columns[1] || { text: '新流程' };
  return [
    '<div class="scene-content scene-content--split-compare" data-visual-type="split_compare">',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    '  <div class="visual-compare-grid">',
    `    <div class="visual-compare-column visual-compare-column--old"><span>过去</span><strong>${objectText(left)}</strong></div>`,
    '    <div class="visual-compare-vs">VS</div>',
    `    <div class="visual-compare-column visual-compare-column--new"><span>现在</span><strong>${objectText(right)}</strong></div>`,
    '  </div>',
    '</div>',
  ].join('\n');
}

function renderConceptMapScene(scene) {
  const dsl = scene.prepared_visual_scene || {};
  return [
    '<div class="scene-content scene-content--concept-map" data-visual-type="concept_map">',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    '  <div class="visual-concept-center">核心</div>',
    `  <div class="visual-concept-branches">${renderObjectList(dsl.objects || [], 'visual-branch')}</div>`,
    '</div>',
  ].join('\n');
}

function renderTimelineScene(scene) {
  const dsl = scene.prepared_visual_scene || {};
  const milestones = (dsl.objects || []).filter(item => ['milestone', 'node', 'keyword'].includes(item.type));
  return [
    '<div class="scene-content scene-content--timeline" data-visual-type="timeline">',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    `  <div class="visual-timeline">${milestones.map((item, index) => `<div class="visual-milestone"><span>${index + 1}</span><strong>${objectText(item)}</strong></div>`).join('')}</div>`,
    '</div>',
  ].join('\n');
}

function renderQuoteBurstScene({ scene, wordHtml }) {
  return [
    '<div class="scene-content scene-content--quote-burst" data-visual-type="quote_burst">',
    '  <div class="quote-mark">“</div>',
    `  <h1>${escapeHtml(scene.headline)}</h1>`,
    `  <div class="emphasis timed-cards">${wordHtml}</div>`,
    '</div>',
  ].join('\n');
}

function renderSceneContent({ scene, index, captionText, wordHtml }) {
  const type = scene.prepared_visual_scene?.visualType || scene.visual_type || 'quote_burst';
  if (type === 'workflow') return renderWorkflowScene(scene, index);
  if (type === 'code_panel') return renderCodePanelScene(scene, index);
  if (type === 'ui_mockup') return renderUiMockupScene(scene, index);
  if (type === 'split_compare') return renderSplitCompareScene(scene, index);
  if (type === 'concept_map') return renderConceptMapScene(scene, index);
  if (type === 'timeline') return renderTimelineScene(scene, index);
  return renderQuoteBurstScene({ scene, wordHtml, captionText });
}

module.exports = {
  escapeHtml,
  renderSceneContent,
  renderWorkflowScene,
  renderCodePanelScene,
  renderUiMockupScene,
  renderSplitCompareScene,
  renderConceptMapScene,
  renderTimelineScene,
  renderQuoteBurstScene,
};
```

- [ ] **Step 4: Run test**

```powershell
node test-hyperframes-scene-renderers.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- server/services/hyperframesSceneRenderers.js test-hyperframes-scene-renderers.js
git commit -m "新增 HyperFrames 多类型场景渲染器"
```

---

### Task 6: Add Animation Builder and Integrate Project HTML

**Files:**
- Create: `server/services/hyperframesAnimations.js`
- Modify: `server/services/hyperframesProject.js`
- Modify: `server/services/frameProfiles.js`
- Test: `test-hyperframes-project.js`

- [ ] **Step 1: Write failing project tests**

In `test-hyperframes-project.js`, add a scene to `runData.storyboard.scenes`:

```js
{
  index: 3,
  caption_indexes: [1],
  start: 0,
  end: 1.25,
  duration: 1.25,
  headline: '自动生成流程',
  visual_type: 'workflow',
  layout: 'vertical_flow',
  background_prompt: '原创流程背景',
  emphasis_words: ['需求', '页面'],
  visual_scene: {
    composition: 'vertical_flow',
    objects: [
      { id: 'node-1', type: 'node', text: '需求' },
      { id: 'node-2', type: 'node', text: '页面' },
      { id: 'line-1', type: 'connector', from: 'node-1', to: 'node-2' },
    ],
    motion: [{ target: 'node', effect: 'stagger_reveal', delay: 0.1 }],
  },
  captions: [
    { index: 1, start: 0, end: 1.25, text: '第一句。' },
  ],
}
```

After reading `html`, add:

```js
assert.match(html, /scene-content--workflow/);
assert.match(html, /visual-node/);
assert.match(html, /visual-connector/);
assert.match(html, /prepared_visual_scene/);
assert.match(html, /tl\.set\("#scene-1"/);
assert.match(html, /autoAlpha: 1/);
```

After reading `projectJson`, add:

```js
assert.equal(projectJson.visual_dsl_version, 1);
```

Update `indexHtml` assertions for custom project:

```js
assert.match(indexHtml, /scene-content--workflow|scene-content--quote-burst|scene-content--text-card/);
```

- [ ] **Step 2: Run failing test**

```powershell
node test-hyperframes-project.js
```

Expected: FAIL because workflow renderer and `visual_dsl_version` are not integrated.

- [ ] **Step 3: Create animation builder**

Create `server/services/hyperframesAnimations.js`:

```js
function buildSceneAnimation(scene, index, motionScale = 1, frameOptions = {}) {
  const sceneId = `#scene-${index + 1}`;
  const start = Number(scene.start || 0);
  const sceneDuration = Math.max(0.2, Number(scene.duration || 0.2));
  const enterDuration = Math.max(0.08, Math.min(0.42, sceneDuration * 0.22) * motionScale);
  const exitDuration = Math.max(0.08, Math.min(0.28, sceneDuration * 0.16) * motionScale);
  const exitStart = Math.max(start + enterDuration, start + sceneDuration - exitDuration);
  const lines = [];

  lines.push(`    tl.set("${sceneId}", { autoAlpha: 1 }, ${start.toFixed(3)});`);
  lines.push(`    tl.fromTo("${sceneId} .scene-content", { y: 42, scale: 0.96, filter: "blur(10px)" }, { y: 0, scale: 1, filter: "blur(0px)", duration: ${enterDuration.toFixed(3)}, ease: "power3.out" }, ${start.toFixed(3)});`);
  lines.push(`    tl.fromTo("${sceneId} h1", { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: ${Math.min(0.28, enterDuration).toFixed(3)}, ease: "power2.out" }, ${(start + 0.03).toFixed(3)});`);
  lines.push(`    tl.fromTo("${sceneId} [data-visual-object]", { y: 20, autoAlpha: 0, scale: 0.92 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.28, stagger: 0.08, ease: "back.out(1.5)" }, ${(start + 0.12).toFixed(3)});`);
  lines.push(`    tl.fromTo("${sceneId} .visual-connector", { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.34, stagger: 0.06, ease: "power2.out" }, ${(start + 0.24).toFixed(3)});`);
  lines.push(`    tl.fromTo("${sceneId} .caption-bar", { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.24, ease: "power2.out" }, ${(start + 0.12).toFixed(3)});`);
  lines.push(`    tl.to("${sceneId} .scene-content", { y: -16, scale: 1.02, duration: ${Math.max(0.2, sceneDuration - exitDuration).toFixed(3)}, ease: "none" }, ${start.toFixed(3)});`);
  lines.push(`    tl.to("${sceneId}", { autoAlpha: 0, duration: ${exitDuration.toFixed(3)}, ease: "power1.in" }, ${exitStart.toFixed(3)});`);

  return lines.join('\n');
}

function buildTimelineScript(scenes, duration, motionScale = 1, frameOptions = {}) {
  const lines = [
    '    const tl = gsap.timeline({ paused: true });',
    `    tl.to({}, { duration: ${duration} }, 0);`,
    '    tl.to(".neon-grid", { backgroundPosition: "140px 220px", duration: Math.max(8, ' + duration + '), ease: "none" }, 0);',
    '    tl.to(".radial-energy", { rotate: 16, scale: 1.08, duration: Math.max(8, ' + duration + '), ease: "sine.inOut" }, 0);',
  ];
  scenes.forEach((scene, index) => lines.push(buildSceneAnimation(scene, index, motionScale, frameOptions)));
  return lines.join('\n');
}

module.exports = {
  buildSceneAnimation,
  buildTimelineScript,
};
```

- [ ] **Step 4: Integrate modules in `hyperframesProject.js`**

At top:

```js
const visualDsl = require('./hyperframesVisualDsl');
const sceneRenderers = require('./hyperframesSceneRenderers');
const animations = require('./hyperframesAnimations');
```

Remove the old local `renderSceneContent` function or stop using it.

In `buildIndexHtml`, replace:

```js
const renderScenes = storyboard.scenes.map(scene => {
```

with:

```js
const renderScenes = visualDsl.prepareScenes(storyboard.scenes).map(scene => {
```

Replace the scene content call:

```js
sceneRenderers.renderSceneContent({ scene, index, captionText, wordHtml }),
```

Replace timeline call:

```js
${animations.buildTimelineScript(renderScenes, duration, motionScale, frameOptions)}
```

Add CSS for new classes inside `<style>`:

```css
.scene-content--workflow, .scene-content--code-panel, .scene-content--ui-mockup, .scene-content--split-compare, .scene-content--concept-map, .scene-content--timeline, .scene-content--quote-burst { border-left: 0; overflow: hidden; }
.visual-flow, .visual-timeline, .visual-concept-branches { display: grid; gap: 18px; }
.visual-node, .visual-milestone, .visual-pill, .visual-ui-item, .visual-branch { border: 1px solid color-mix(in srgb, var(--accent) 58%, transparent); background: rgba(255,255,255,.065); padding: 16px 18px; border-radius: 8px; color: #fff; font-weight: 800; }
.visual-node span, .visual-milestone span { color: var(--accent); margin-right: 12px; font-weight: 900; }
.visual-connector { height: 4px; width: 100%; transform-origin: left center; background: linear-gradient(90deg, var(--accent), var(--frame-hot)); border-radius: 999px; }
.visual-code-window, .visual-ui-panel { border: 1px solid color-mix(in srgb, var(--accent) 48%, transparent); background: rgba(0,0,0,.34); border-radius: 8px; padding: 22px; box-shadow: inset 0 0 40px rgba(37,244,238,.08); }
.visual-window-dots { display: flex; gap: 8px; margin-bottom: 16px; }
.visual-window-dots i { width: 12px; height: 12px; border-radius: 999px; background: var(--accent); display: block; }
.visual-code-line { white-space: pre-wrap; color: #dff; font-size: 26px; line-height: 1.45; margin: 0; }
.visual-terminal { margin-top: 16px; color: var(--frame-gold); font-size: 24px; }
.visual-ui-button { justify-self: start; margin-top: 18px; padding: 12px 18px; border-radius: 8px; background: var(--accent); color: #001014; font-weight: 900; }
.visual-compare-grid { display: grid; grid-template-columns: 1fr 82px 1fr; gap: 16px; align-items: stretch; }
.visual-compare-column { min-height: 210px; display: grid; align-content: center; gap: 12px; padding: 22px; border: 1px solid var(--accent); background: rgba(255,255,255,.06); border-radius: 8px; }
.visual-compare-column strong { font-size: 40px; line-height: 1.18; }
.visual-compare-vs { display: grid; place-items: center; color: var(--frame-hot); font-size: 34px; font-weight: 900; }
.visual-concept-center { width: 160px; height: 160px; display: grid; place-items: center; border-radius: 999px; background: var(--accent); color: #001014; font-weight: 900; justify-self: center; }
```

- [ ] **Step 5: Add `visual_dsl_version` to project JSON**

In `createOriginalCaptionProject`, inside `project.json` write:

```js
visual_dsl_version: 1,
```

- [ ] **Step 6: Update frame profile renderers**

In `server/services/frameProfiles.js`, update `sceneRenderers`:

```js
sceneRenderers: ['workflow', 'code_panel', 'ui_mockup', 'split_compare', 'concept_map', 'timeline', 'quote_burst', 'text_card', 'quote_card', 'contrast_card', 'step_card'],
```

- [ ] **Step 7: Run tests**

```powershell
node test-hyperframes-project.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add -- server/services/hyperframesAnimations.js server/services/hyperframesProject.js server/services/frameProfiles.js test-hyperframes-project.js
git commit -m "接入 HyperFrames 视觉 DSL 渲染"
```

---

### Task 7: Full Test Suite and Manual Render Verification

**Files:**
- Modify: `package.json`
- No new implementation files unless test command needs the new tests listed.

- [ ] **Step 1: Add new tests to `package.json`**

In `package.json`, update the `test` script so the new tests run after `test-hyperframes-project.js`:

```json
"test": "node test-runtime-env.js && node test-ai-text-model.js && node test-ai-tts-model.js && node test-tts-timeline.js && node test-storyboard-schema.js && node test-storyboard-agent.js && node test-frame-profiles.js && node test-hyperframes-project.js && node test-hyperframes-visual-dsl.js && node test-hyperframes-scene-renderers.js && node test-hyperframes-renderer.js && node test-agent-templates.js && node test-agent-template-overrides.js && node test-agent-runs.js && node test-agent-run-utils.mjs && node test-ai-workspace-defaults.mjs && node test-ai-workspace-brief-ui.mjs && node test-persistent-routes.mjs && node test-media-tasks.js && node test-media-routes.js && node test-media-pipeline.js && node test-media-pipeline-cache.js && node test-content-utils.mjs && node test-media-assets-utils.mjs && node test-table-utils.mjs && node test-workspace-params.mjs && node test-comment-cache-utils.mjs"
```

- [ ] **Step 2: Run focused tests**

```powershell
node test-agent-templates.js
node test-storyboard-agent.js
node test-storyboard-schema.js
node test-hyperframes-visual-dsl.js
node test-hyperframes-scene-renderers.js
node test-hyperframes-project.js
```

Expected: every command prints its `... tests passed` line.

- [ ] **Step 3: Run full test suite**

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 4: Regenerate a project from an existing run without rendering MP4**

Use the latest known run paths from the analysis:

```powershell
node -e "const fs=require('fs'); const p=require('./server/services/hyperframesProject'); (async()=>{ const run=JSON.parse(fs.readFileSync('data/media/douyin/7614912768881216777/agent_runs/20260609-212127-456Z-30efc7-viral_rewrite.json','utf8')); const result=await p.createOriginalCaptionProject({run, projectDir:'data/media/douyin/7614912768881216777/agent_runs/20260609-212127-456Z-30efc7-viral_rewrite-hyperframes-upgrade-check', renderOptions:{quality:'high', motionLevel:'medium', captionMode:'standard'}}); console.log(JSON.stringify({success:result.success,message:result.message,index_path:result.index_path,duration:result.duration},null,2)); })().catch(e=>{console.error(e); process.exit(1);})"
```

Expected: `success: true`, generated `index.html` exists.

- [ ] **Step 5: Inspect generated HTML for new scene types**

```powershell
Select-String -LiteralPath 'data/media/douyin/7614912768881216777/agent_runs/20260609-212127-456Z-30efc7-viral_rewrite-hyperframes-upgrade-check/index.html' -Pattern 'scene-content--workflow|scene-content--code-panel|scene-content--ui-mockup|scene-content--split-compare|scene-content--quote-burst'
```

Expected: At least one `scene-content--...` match.

- [ ] **Step 6: Optionally render MP4 if HyperFrames CLI is available**

```powershell
npx hyperframes render
```

Run this from the generated project directory:

```powershell
Set-Location 'data/media/douyin/7614912768881216777/agent_runs/20260609-212127-456Z-30efc7-viral_rewrite-hyperframes-upgrade-check'
npx hyperframes render
```

Expected: `renders` directory contains an MP4. If `npx hyperframes render` fails because the CLI is unavailable or misconfigured, record the error in the final implementation notes and do not treat it as a code test failure unless existing renderer tests also fail.

- [ ] **Step 7: Commit**

```powershell
git add -- package.json
git commit -m "纳入 HyperFrames 视觉 DSL 测试"
```

---

### Task 8: Final Review and Compatibility Check

**Files:**
- Potentially modify docs only if implementation discoveries require clarifying the design.

- [ ] **Step 1: Check git status**

```powershell
git status --short
```

Expected: only intentional uncommitted files, or clean except user-owned unrelated changes that existed before this work.

- [ ] **Step 2: Verify old scene compatibility**

Run:

```powershell
node -e "const schema=require('./server/services/storyboardSchema'); const captions=[{index:1,start:0,end:1,duration:1,text:'第一句'}]; const result=schema.normalizeStoryboard({storyboard:{scenes:[{caption_indexes:[1],headline:'旧卡片',visual_type:'text_card',layout:'center_focus',background_prompt:'原创背景',emphasis_words:['重点']}]},captions}); console.log(JSON.stringify(result.scenes[0],null,2)); if(!result.scenes[0].visual_scene) process.exit(1);"
```

Expected: printed scene includes `visual_scene`.

- [ ] **Step 3: Verify unknown type fallback**

Run:

```powershell
node -e "const schema=require('./server/services/storyboardSchema'); const captions=[{index:1,start:0,end:1,duration:1,text:'第一句'}]; const result=schema.normalizeStoryboard({storyboard:{scenes:[{caption_indexes:[1],headline:'未知',visual_type:'camera_flythrough',layout:'center_focus',background_prompt:'原创背景',emphasis_words:['重点']}]},captions}); console.log(result.scenes[0].visual_type); if(result.scenes[0].visual_type!=='quote_burst') process.exit(1);"
```

Expected: prints `quote_burst`.

- [ ] **Step 4: Run final suite**

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 5: Summarize implementation**

Final notes must include:

- Which new scene types are supported.
- How AI chooses `visual_type`.
- How old runs remain compatible.
- Which tests passed.
- Whether optional MP4 render was performed.

