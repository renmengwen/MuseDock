# Editable Agent Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing `/ai` workspace into a fully editable Agent workbench with editable task Agent templates, editable storyboard Agent configuration, run snapshots, debug output, scene editing, and video regeneration.

**Architecture:** Keep the current `/api/agents` and `/ai` workflow as the main product surface. Add a template override service that merges code defaults, saved local overrides, and per-run overrides; persist every run with config snapshots, final messages, raw model output, parse status, and validation results. Extend the existing React AI workspace instead of adding a separate debug page.

**Tech Stack:** Node.js 22, Express, React 19, Vite, local JSON persistence under `data/`, existing model adapters in `server/services/aiTextModel.js`, existing Agent services in `server/services/agentRuns.js`, `agentTemplates.js`, `storyboardAgent.js`, and `storyboardSchema.js`.

---

## File Structure

- Create: `server/services/agentTemplateOverrides.js`
  - Reads and writes `data/config/agent_templates.json`.
  - Exposes default editable configs for task Agents and storyboard Agent.
  - Merges saved overrides and request overrides.
  - Builds final messages from editable templates.
  - Validates editable config fields and model options.

- Modify: `server/services/agentTemplates.js`
  - Expose default editable template configs.
  - Keep existing normalize/build logic working for old callers.
  - Add message building from editable prompt templates.

- Modify: `server/services/storyboardAgent.js`
  - Expose default editable storyboard config.
  - Allow `createStoryboard()` to use an editable config override.
  - Return messages, raw text, parse status, and validation summary.

- Modify: `server/services/storyboardSchema.js`
  - Add validation helpers for editable storyboard scene input.
  - Keep `normalizeStoryboard()` as the single source of time-axis normalization.

- Modify: `server/services/agentRuns.js`
  - Use merged task Agent config for runs.
  - Save `agent_config_snapshot`, `messages`, `raw_output`, `parse`, and `schema_validation`.
  - Use merged storyboard config for storyboard generation.
  - Save `storyboard_config_snapshot`, `storyboard_messages`, `storyboard_raw_output`, `storyboard_parse`, and `storyboard_schema_validation`.
  - Add `updateDouyinRunStoryboard()`.

- Modify: `server/routes/agents.js`
  - Add template config CRUD routes.
  - Accept per-run task and storyboard config overrides.
  - Add `PUT /douyin/:aweme_id/runs/:run_id/storyboard`.

- Modify: `frontend-react/src/api/client.js`
  - Add template config APIs.
  - Pass task and storyboard overrides to run APIs.
  - Add save storyboard API.

- Modify: `frontend-react/src/pages/AiWorkspace.jsx`
  - Replace static template sidebar with editable Agent config UI.
  - Add preview messages, save override, restore default.
  - Add debug result tabs.
  - Add storyboard Agent advanced editor.
  - Add scene editor and save/regenerate flow.

- Modify: `frontend-react/src/utils/agentRuns.js`
  - Format config source labels, parse status, validation status, and debug sections.

- Modify: `frontend-react/src/styles.css`
  - Add responsive styles for prompt editors, debug tabs, model option controls, and scene editor.

- Create: `test-agent-template-overrides.js`
  - Backend tests for config merge, persistence, validation, and editable message building.

- Modify: `test-agent-templates.js`
  - Cover editable task Agent defaults.

- Modify: `test-storyboard-agent.js`
  - Cover editable storyboard config and debug metadata.

- Modify: `test-storyboard-schema.js`
  - Cover editable scene validation and normalization.

- Modify: `test-agent-runs.js`
  - Cover run snapshots, per-run overrides, storyboard snapshots, and manual storyboard updates.

- Modify: `test-agent-run-utils.mjs`
  - Cover frontend formatting helpers for editable Agent metadata.

- Modify: `package.json`
  - Add `test-agent-template-overrides.js` to the full test script.

---

## Task 1: Editable Template Defaults

**Files:**
- Modify: `server/services/agentTemplates.js`
- Modify: `test-agent-templates.js`

- [ ] **Step 1: Add failing tests for editable task Agent defaults**

Append to `test-agent-templates.js` before the final success log:

```js
const editableTemplates = agentTemplates.listEditableAgentTemplates();
assert.ok(Array.isArray(editableTemplates));
assert.ok(editableTemplates.length >= 2);

const editableViral = agentTemplates.getEditableAgentTemplate('viral_rewrite');
assert.equal(editableViral.id, 'viral_rewrite');
assert.equal(editableViral.label, '爆款拆解 + 改写脚本');
assert.ok(editableViral.systemPrompt.includes('MuseDock'));
assert.ok(editableViral.userPromptTemplate.includes('{{transcriptText}}'));
assert.deepEqual(editableViral.resultFields, [
  'summary',
  'viral_points',
  'audience',
  'comment_insights',
  'topics',
  'rewrite_script',
  'titles',
]);
assert.equal(editableViral.modelOptions.temperature, 0.4);
assert.equal(editableViral.modelOptions.stream, true);

const editableComment = agentTemplates.getEditableAgentTemplate('comment_insights');
assert.equal(editableComment.id, 'comment_insights');
assert.ok(editableComment.userPromptTemplate.includes('{{commentsText}}'));
assert.equal(agentTemplates.getEditableAgentTemplate('missing'), null);
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node test-agent-templates.js
```

Expected: fails because `listEditableAgentTemplates` and `getEditableAgentTemplate` do not exist.

- [ ] **Step 3: Implement editable task Agent defaults**

In `server/services/agentTemplates.js`, add helpers:

```js
const DEFAULT_MODEL_OPTIONS = {
  temperature: 0.4,
  stream: true,
  maxRetries: 1,
};

function getViralRewriteSystemPrompt() {
  return [
    '你是 MuseDock 的受控内容创作 Agent。',
    '请只输出 JSON，不要输出 Markdown、解释或代码块。',
    'JSON 字段必须包含 summary, viral_points, audience, comment_insights, topics, rewrite_script, titles。',
    'viral_points, comment_insights, topics, titles 必须是字符串数组。',
  ].join('\n');
}

function getViralRewriteUserPromptTemplate() {
  return [
    '任务：爆款拆解 + 改写脚本。',
    '视频标题：{{videoTitle}}',
    '作者：{{authorName}}',
    '链接：{{awemeUrl}}',
    '统计：点赞 {{likeCount}}，评论 {{commentCount}}，分享 {{shareCount}}',
    '',
    '转写文本：',
    '{{transcriptNote}}',
    '{{transcriptText}}',
    '',
    '评论信息：',
    '{{commentsNote}}',
    '{{commentsText}}',
    '',
    '{{promptOptionsText}}',
  ].join('\n');
}

function getCommentInsightsSystemPrompt() {
  return [
    '你是 MuseDock 的评论研究 Agent。',
    '请只输出 JSON，不要输出 Markdown、解释或代码块。',
    'JSON 字段必须包含 summary, pain_points, questions, sentiment, content_opportunities, reply_suggestions。',
    'pain_points, questions, content_opportunities, reply_suggestions 必须是字符串数组。',
  ].join('\n');
}

function getCommentInsightsUserPromptTemplate() {
  return [
    '任务：评论洞察。',
    '视频标题：{{videoTitle}}',
    '作者：{{authorName}}',
    '统计：评论 {{commentCount}}，点赞 {{likeCount}}',
    '',
    '本地评论缓存共 {{localCommentCount}} 条。请从评论里提炼用户痛点、高频问题、整体情绪、可转化为内容的机会，以及适合运营回复的建议。',
    '',
    '评论样本：',
    '{{commentsText}}',
    '',
    '{{promptOptionsText}}',
  ].join('\n');
}

function getEditableAgentTemplate(id) {
  const template = getAgentTemplate(id);
  if (!template) return null;
  const editable = {
    id: template.id,
    label: template.label,
    description: template.description,
    requireTranscript: template.requireTranscript,
    requireComments: template.requireComments,
    resultFields: [...template.resultFields],
    modelOptions: { ...DEFAULT_MODEL_OPTIONS },
  };
  if (template.id === 'comment_insights') {
    return {
      ...editable,
      systemPrompt: getCommentInsightsSystemPrompt(),
      userPromptTemplate: getCommentInsightsUserPromptTemplate(),
    };
  }
  return {
    ...editable,
    systemPrompt: getViralRewriteSystemPrompt(),
    userPromptTemplate: getViralRewriteUserPromptTemplate(),
  };
}

function listEditableAgentTemplates() {
  return templates.map(template => getEditableAgentTemplate(template.id));
}
```

Export the new functions:

```js
module.exports = {
  MAX_TRANSCRIPT_CHARS,
  MAX_COMMENTS_CHARS,
  getAgentTemplate,
  listAgentTemplates,
  getEditableAgentTemplate,
  listEditableAgentTemplates,
  normalizeStringArray,
  normalizePromptOptions,
  formatPromptOptionsForPrompt,
};
```

- [ ] **Step 4: Run the test**

Run:

```bash
node test-agent-templates.js
```

Expected: `agent template tests passed`.

- [ ] **Step 5: Commit**

```bash
git add server/services/agentTemplates.js test-agent-templates.js
git commit -m "增加可编辑任务Agent默认配置"
```

---

## Task 2: Template Override Service

**Files:**
- Create: `server/services/agentTemplateOverrides.js`
- Create: `test-agent-template-overrides.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing override service tests**

Create `test-agent-template-overrides.js`:

```js
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const overrides = require('./server/services/agentTemplateOverrides');

(async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-template-overrides-'));

  const list = await overrides.listTaskAgentConfigs({ rootDir });
  assert.ok(list.data.some(item => item.id === 'viral_rewrite'));
  assert.equal(list.data.find(item => item.id === 'viral_rewrite').source, 'default');

  const detail = await overrides.getTaskAgentConfig('viral_rewrite', { rootDir });
  assert.equal(detail.success, true);
  assert.equal(detail.data.id, 'viral_rewrite');
  assert.ok(detail.data.systemPrompt.includes('MuseDock'));

  const invalid = await overrides.saveTaskAgentConfig('viral_rewrite', {
    systemPrompt: '',
    userPromptTemplate: 'hello',
    modelOptions: { temperature: 0.4, stream: true, maxRetries: 1 },
  }, { rootDir });
  assert.equal(invalid.success, false);
  assert.match(invalid.message, /system prompt/);

  const saved = await overrides.saveTaskAgentConfig('viral_rewrite', {
    systemPrompt: '系统：只输出 JSON。',
    userPromptTemplate: '标题：{{videoTitle}}\n正文：{{transcriptText}}',
    resultSchema: { summary: 'string' },
    modelOptions: { temperature: 0.2, stream: false, maxRetries: 2 },
  }, { rootDir });
  assert.equal(saved.success, true);
  assert.equal(saved.data.source, 'override');
  assert.equal(saved.data.modelOptions.temperature, 0.2);

  const mergedRequest = await overrides.resolveTaskAgentConfig('viral_rewrite', {
    agentConfigOverride: {
      systemPrompt: '临时系统',
      userPromptTemplate: '临时 {{videoTitle}}',
      modelOptions: { temperature: 0.7 },
    },
    rootDir,
  });
  assert.equal(mergedRequest.source, 'request');
  assert.equal(mergedRequest.systemPrompt, '临时系统');
  assert.equal(mergedRequest.modelOptions.temperature, 0.7);
  assert.equal(mergedRequest.modelOptions.stream, false);

  const messages = overrides.buildMessagesFromTemplate({
    systemPrompt: '系统',
    userPromptTemplate: '标题：{{videoTitle}}\n未知：{{missing}}\n{{promptOptionsText}}',
  }, {
    videoTitle: '测试标题',
    promptOptionsText: '补充 brief',
  });
  assert.deepEqual(messages, [
    { role: 'system', content: '系统' },
    { role: 'user', content: '标题：测试标题\n未知：\n补充 brief' },
  ]);

  const cleared = await overrides.clearTaskAgentOverride('viral_rewrite', { rootDir });
  assert.equal(cleared.success, true);
  const afterClear = await overrides.getTaskAgentConfig('viral_rewrite', { rootDir });
  assert.equal(afterClear.data.source, 'default');

  const storyboard = await overrides.getStoryboardAgentConfig({ rootDir });
  assert.equal(storyboard.success, true);
  assert.equal(storyboard.data.source, 'default');
  assert.ok(storyboard.data.systemPrompt.includes('MuseDock'));

  const savedStoryboard = await overrides.saveStoryboardAgentConfig({
    systemPrompt: '分镜系统',
    userPromptTemplate: '脚本：{{rewriteScript}}\n字幕：{{captionIndexesJson}}',
    useFrameProfile: false,
    modelOptions: { temperature: 0.3, stream: true, maxRetries: 1 },
  }, { rootDir });
  assert.equal(savedStoryboard.success, true);
  assert.equal(savedStoryboard.data.source, 'override');
  assert.equal(savedStoryboard.data.useFrameProfile, false);

  console.log('agent template override tests passed');
})();
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node test-agent-template-overrides.js
```

Expected: fails because `server/services/agentTemplateOverrides.js` does not exist.

- [ ] **Step 3: Implement `agentTemplateOverrides.js`**

Create `server/services/agentTemplateOverrides.js`:

```js
const fsp = require('fs/promises');
const path = require('path');
const agentTemplates = require('./agentTemplates');
const storyboardAgent = require('./storyboardAgent');

const DEFAULT_CONFIG_RELATIVE_PATH = path.join('data', 'config', 'agent_templates.json');

function getConfigPath(rootDir) {
  return path.join(rootDir || process.cwd(), DEFAULT_CONFIG_RELATIVE_PATH);
}

async function readConfig(rootDir) {
  try {
    return JSON.parse(await fsp.readFile(getConfigPath(rootDir), 'utf-8'));
  } catch {
    return { task_agents: {}, storyboard_agent: null };
  }
}

async function writeConfig(config, rootDir) {
  const filePath = getConfigPath(rootDir);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

function sanitizeText(value, limit = 20000) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function normalizeModelOptions(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const temperature = Number(source.temperature ?? fallback.temperature ?? 0.4);
  const maxRetries = Number(source.maxRetries ?? fallback.maxRetries ?? 1);
  return {
    temperature: Number.isFinite(temperature) ? Math.min(2, Math.max(0, temperature)) : fallback.temperature ?? 0.4,
    stream: typeof source.stream === 'boolean' ? source.stream : fallback.stream !== false,
    maxRetries: Number.isFinite(maxRetries) ? Math.min(5, Math.max(0, Math.round(maxRetries))) : fallback.maxRetries ?? 1,
  };
}

function validateEditableConfig(config) {
  if (!sanitizeText(config.systemPrompt)) {
    return { success: false, message: 'system prompt 不能为空。' };
  }
  if (!sanitizeText(config.userPromptTemplate)) {
    return { success: false, message: 'user prompt 模板不能为空。' };
  }
  return { success: true, message: '' };
}

function normalizeTaskConfig(input = {}, fallback) {
  return {
    ...fallback,
    systemPrompt: sanitizeText(input.systemPrompt, 20000) || fallback.systemPrompt,
    userPromptTemplate: sanitizeText(input.userPromptTemplate, 30000) || fallback.userPromptTemplate,
    resultSchema: input.resultSchema && typeof input.resultSchema === 'object' && !Array.isArray(input.resultSchema)
      ? input.resultSchema
      : fallback.resultSchema || {},
    modelOptions: normalizeModelOptions(input.modelOptions, fallback.modelOptions),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

function normalizeStoryboardConfig(input = {}, fallback) {
  return {
    ...fallback,
    systemPrompt: sanitizeText(input.systemPrompt, 20000) || fallback.systemPrompt,
    userPromptTemplate: sanitizeText(input.userPromptTemplate, 30000) || fallback.userPromptTemplate,
    useFrameProfile: typeof input.useFrameProfile === 'boolean' ? input.useFrameProfile : fallback.useFrameProfile,
    modelOptions: normalizeModelOptions(input.modelOptions, fallback.modelOptions),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

function replaceTemplateVars(template, values = {}) {
  return String(template || '').replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, key) => {
    const value = values[key];
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : String(value);
  });
}

function buildMessagesFromTemplate(config, values = {}) {
  return [
    { role: 'system', content: sanitizeText(config.systemPrompt, 20000) },
    { role: 'user', content: replaceTemplateVars(config.userPromptTemplate, values) },
  ];
}

async function listTaskAgentConfigs(options = {}) {
  const config = await readConfig(options.rootDir);
  const data = agentTemplates.listEditableAgentTemplates().map(defaultConfig => {
    const override = config.task_agents?.[defaultConfig.id];
    return {
      ...defaultConfig,
      ...(override ? normalizeTaskConfig(override, defaultConfig) : {}),
      source: override ? 'override' : 'default',
      hasOverride: !!override,
    };
  });
  return { success: true, data };
}

async function getTaskAgentConfig(id, options = {}) {
  const defaultConfig = agentTemplates.getEditableAgentTemplate(id);
  if (!defaultConfig) return { success: false, message: '暂不支持该 Agent 模板。' };
  const config = await readConfig(options.rootDir);
  const override = config.task_agents?.[id];
  return {
    success: true,
    data: {
      ...(override ? normalizeTaskConfig(override, defaultConfig) : defaultConfig),
      source: override ? 'override' : 'default',
      hasOverride: !!override,
    },
  };
}

async function saveTaskAgentConfig(id, input, options = {}) {
  const defaultConfig = agentTemplates.getEditableAgentTemplate(id);
  if (!defaultConfig) return { success: false, message: '暂不支持该 Agent 模板。' };
  const validation = validateEditableConfig(input || {});
  if (!validation.success) return validation;
  const next = normalizeTaskConfig(input, defaultConfig);
  const config = await readConfig(options.rootDir);
  config.task_agents = config.task_agents || {};
  config.task_agents[id] = next;
  await writeConfig(config, options.rootDir);
  return { success: true, message: 'Agent 模板配置已保存。', data: { ...next, source: 'override', hasOverride: true } };
}

async function clearTaskAgentOverride(id, options = {}) {
  const config = await readConfig(options.rootDir);
  if (config.task_agents) delete config.task_agents[id];
  await writeConfig(config, options.rootDir);
  return { success: true, message: '已恢复默认 Agent 模板配置。' };
}

async function resolveTaskAgentConfig(id, options = {}) {
  const detail = await getTaskAgentConfig(id, options);
  if (!detail.success) return null;
  const requestOverride = options.agentConfigOverride && typeof options.agentConfigOverride === 'object'
    ? options.agentConfigOverride
    : null;
  if (!requestOverride) return detail.data;
  const merged = normalizeTaskConfig(requestOverride, detail.data);
  return { ...merged, source: 'request', hasOverride: detail.data.hasOverride };
}

function getDefaultStoryboardConfig() {
  return storyboardAgent.getEditableStoryboardTemplate();
}

async function getStoryboardAgentConfig(options = {}) {
  const defaultConfig = getDefaultStoryboardConfig();
  const config = await readConfig(options.rootDir);
  const override = config.storyboard_agent;
  return {
    success: true,
    data: {
      ...(override ? normalizeStoryboardConfig(override, defaultConfig) : defaultConfig),
      source: override ? 'override' : 'default',
      hasOverride: !!override,
    },
  };
}

async function saveStoryboardAgentConfig(input, options = {}) {
  const defaultConfig = getDefaultStoryboardConfig();
  const validation = validateEditableConfig(input || {});
  if (!validation.success) return validation;
  const next = normalizeStoryboardConfig(input, defaultConfig);
  const config = await readConfig(options.rootDir);
  config.storyboard_agent = next;
  await writeConfig(config, options.rootDir);
  return { success: true, message: '分镜 Agent 配置已保存。', data: { ...next, source: 'override', hasOverride: true } };
}

async function clearStoryboardAgentOverride(options = {}) {
  const config = await readConfig(options.rootDir);
  config.storyboard_agent = null;
  await writeConfig(config, options.rootDir);
  return { success: true, message: '已恢复默认分镜 Agent 配置。' };
}

async function resolveStoryboardAgentConfig(options = {}) {
  const detail = await getStoryboardAgentConfig(options);
  const requestOverride = options.storyboardConfigOverride && typeof options.storyboardConfigOverride === 'object'
    ? options.storyboardConfigOverride
    : null;
  if (!requestOverride) return detail.data;
  const merged = normalizeStoryboardConfig(requestOverride, detail.data);
  return { ...merged, source: 'request', hasOverride: detail.data.hasOverride };
}

module.exports = {
  readConfig,
  listTaskAgentConfigs,
  getTaskAgentConfig,
  saveTaskAgentConfig,
  clearTaskAgentOverride,
  resolveTaskAgentConfig,
  getStoryboardAgentConfig,
  saveStoryboardAgentConfig,
  clearStoryboardAgentOverride,
  resolveStoryboardAgentConfig,
  normalizeModelOptions,
  buildMessagesFromTemplate,
  replaceTemplateVars,
};
```

- [ ] **Step 4: Add the test script**

Modify `package.json` so the full `test` script includes `node test-agent-template-overrides.js` immediately after `node test-agent-templates.js`.

- [ ] **Step 5: Run tests**

Run:

```bash
node test-agent-template-overrides.js
npm test -- --help
```

Expected: first command prints `agent template override tests passed`; second command may still run the full test suite because scripts do not consume `--help`, and should pass if local dependencies/config are ready.

- [ ] **Step 6: Commit**

```bash
git add package.json server/services/agentTemplateOverrides.js test-agent-template-overrides.js
git commit -m "添加Agent模板覆盖配置服务"
```

---

## Task 3: Editable Task Agent Runs and Snapshots

**Files:**
- Modify: `server/services/agentRuns.js`
- Modify: `test-agent-runs.js`

- [ ] **Step 1: Add failing tests for task Agent snapshots**

In `test-agent-runs.js`, add a case that calls `createDouyinAgentRun()` with `agentConfigOverride` and a fake `aiTextModel`. Assert:

```js
assert.equal(generated.agent_config_snapshot.source, 'request');
assert.equal(generated.agent_config_snapshot.systemPrompt, '临时系统');
assert.ok(Array.isArray(generated.messages));
assert.equal(generated.messages[0].content, '临时系统');
assert.match(generated.messages[1].content, /测试标题/);
assert.equal(generated.raw_output.includes('"summary"'), true);
assert.deepEqual(generated.parse, { success: true, error: '' });
assert.deepEqual(generated.schema_validation, { success: true, errors: [] });
```

Add a malformed JSON case and assert:

```js
assert.equal(rawRun.parse.success, false);
assert.match(rawRun.parse.error, /JSON/);
assert.equal(rawRun.schema_validation.success, false);
assert.ok(rawRun.raw_output);
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node test-agent-runs.js
```

Expected: fails because snapshots and override messages are not saved.

- [ ] **Step 3: Update task Agent run creation**

In `server/services/agentRuns.js`:

- Require the override service:

```js
const agentTemplateOverrides = require('./agentTemplateOverrides');
```

- Replace `parseModelText()` with:

```js
function parseModelText(text, templateDefinition) {
  try {
    return {
      parsed: true,
      parse: { success: true, error: '' },
      schema_validation: { success: true, errors: [] },
      result: templateDefinition.normalizeResult(JSON.parse(text)),
      raw_text: '',
      raw_output: typeof text === 'string' ? text : '',
    };
  } catch (error) {
    return {
      parsed: false,
      parse: { success: false, error: `模型返回不是有效 JSON：${error.message}` },
      schema_validation: { success: false, errors: ['模型返回不是有效 JSON，无法完成结构化校验。'] },
      result: templateDefinition.normalizeResult({}),
      raw_text: typeof text === 'string' ? text : '',
      raw_output: typeof text === 'string' ? text : '',
    };
  }
}
```

- Add a helper for task template variables:

```js
function createTaskTemplateValues({ analysisInput, transcript, commentsText, comments, promptOptions }) {
  const video = analysisInput.video || {};
  const statistics = video.statistics || {};
  const transcriptText = typeof transcript?.text === 'string' ? transcript.text : '';
  const transcriptTruncated = transcriptText.length > agentTemplates.MAX_TRANSCRIPT_CHARS;
  const promptTranscript = transcriptTruncated ? transcriptText.slice(0, agentTemplates.MAX_TRANSCRIPT_CHARS) : transcriptText;
  return {
    videoTitle: video.title || '',
    authorName: video.author?.nickname || '',
    awemeUrl: video.aweme_url || '',
    likeCount: statistics.digg_count || statistics.liked_count || 0,
    commentCount: statistics.comment_count || 0,
    shareCount: statistics.share_count || 0,
    localCommentCount: Array.isArray(comments) ? comments.length : 0,
    transcriptNote: transcriptTruncated
      ? `转写文本已截断，仅保留前 ${agentTemplates.MAX_TRANSCRIPT_CHARS} 字。`
      : '转写文本未截断。',
    transcriptText: promptTranscript,
    commentsNote: Array.isArray(comments) && comments.length > 0
      ? `本地评论缓存共 ${comments.length} 条，以下是抽样评论：`
      : '暂无本地评论缓存。',
    commentsText,
    promptOptionsText: agentTemplates.formatPromptOptionsForPrompt(promptOptions),
  };
}
```

- In `createDouyinAgentRun()`, resolve config before building messages:

```js
const agentConfig = await agentTemplateOverrides.resolveTaskAgentConfig(template, {
  rootDir,
  agentConfigOverride: options.agentConfigOverride,
});
```

- Replace `templateDefinition.buildPrompt(...)` with:

```js
const templateValues = createTaskTemplateValues({
  analysisInput,
  transcript,
  commentsText,
  comments,
  promptOptions,
});
const messages = agentTemplateOverrides.buildMessagesFromTemplate(agentConfig, templateValues);
```

- Pass model options:

```js
modelResult = await modelService.callTextModel({
  messages,
  temperature: agentConfig.modelOptions.temperature,
  configPath: options.configPath,
  textConfig: options.textConfig,
  fetchImpl: options.fetchImpl,
  maxRetries: agentConfig.modelOptions.maxRetries,
  stream: agentConfig.modelOptions.stream,
});
```

- Save snapshot fields in the run:

```js
agent_config_snapshot: {
  templateId: template,
  source: agentConfig.source,
  systemPrompt: agentConfig.systemPrompt,
  userPromptTemplate: agentConfig.userPromptTemplate,
  resultSchema: agentConfig.resultSchema || {},
  modelOptions: agentConfig.modelOptions,
},
messages,
raw_output: parsed.raw_output,
parse: parsed.parse,
schema_validation: parsed.schema_validation,
raw_text: parsed.raw_text,
```

- Include the same snapshot shape in `createFailureRun()` when `options.agent_config_snapshot` is provided.

- [ ] **Step 4: Run tests**

Run:

```bash
node test-agent-runs.js
node test-agent-template-overrides.js
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/agentRuns.js test-agent-runs.js
git commit -m "保存任务Agent运行配置快照"
```

---

## Task 4: Template APIs

**Files:**
- Modify: `server/routes/agents.js`
- Modify: `frontend-react/src/api/client.js`
- Modify: `test-agent-runs.js`

- [ ] **Step 1: Add route coverage**

Extend route tests in `test-agent-runs.js` or add focused route assertions if the existing test creates an Express app. Cover:

```js
GET /api/agents/templates
GET /api/agents/templates/viral_rewrite
PUT /api/agents/templates/viral_rewrite
DELETE /api/agents/templates/viral_rewrite/override
GET /api/agents/storyboard-template
PUT /api/agents/storyboard-template
DELETE /api/agents/storyboard-template/override
```

Assert all responses use Chinese `message` values on save/delete.

- [ ] **Step 2: Run failing route tests**

Run:

```bash
node test-agent-runs.js
```

Expected: fails because routes do not exist.

- [ ] **Step 3: Implement routes**

At the top of `server/routes/agents.js`:

```js
const agentTemplateOverrides = require('../services/agentTemplateOverrides');
```

Add routes before `router.post('/douyin/:aweme_id/runs', ...)`:

```js
router.get('/templates', async (req, res) => {
  const result = await agentTemplateOverrides.listTaskAgentConfigs();
  return res.json(result);
});

router.get('/templates/:id', async (req, res) => {
  const result = await agentTemplateOverrides.getTaskAgentConfig(req.params.id);
  return res.status(result.success ? 200 : 404).json(result);
});

router.put('/templates/:id', async (req, res) => {
  const result = await agentTemplateOverrides.saveTaskAgentConfig(req.params.id, req.body || {});
  return res.status(result.success ? 200 : 400).json(result);
});

router.delete('/templates/:id/override', async (req, res) => {
  const result = await agentTemplateOverrides.clearTaskAgentOverride(req.params.id);
  return res.json(result);
});

router.get('/storyboard-template', async (req, res) => {
  const result = await agentTemplateOverrides.getStoryboardAgentConfig();
  return res.json(result);
});

router.put('/storyboard-template', async (req, res) => {
  const result = await agentTemplateOverrides.saveStoryboardAgentConfig(req.body || {});
  return res.status(result.success ? 200 : 400).json(result);
});

router.delete('/storyboard-template/override', async (req, res) => {
  const result = await agentTemplateOverrides.clearStoryboardAgentOverride();
  return res.json(result);
});
```

Update run route bodies:

```js
agentConfigOverride: req.body?.agentConfigOverride || null,
```

and storyboard:

```js
storyboardConfigOverride: req.body?.storyboardConfigOverride || null,
```

- [ ] **Step 4: Add client APIs**

In `frontend-react/src/api/client.js`, add:

```js
listAgentTemplates() {
  return requestJson('/api/agents/templates');
},
getAgentTemplate(id) {
  return requestJson(`/api/agents/templates/${encodeURIComponent(id)}`);
},
saveAgentTemplate(id, payload) {
  return requestJson(`/api/agents/templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
},
restoreAgentTemplate(id) {
  return requestJson(`/api/agents/templates/${encodeURIComponent(id)}/override`, { method: 'DELETE' });
},
getStoryboardTemplate() {
  return requestJson('/api/agents/storyboard-template');
},
saveStoryboardTemplate(payload) {
  return requestJson('/api/agents/storyboard-template', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
},
restoreStoryboardTemplate() {
  return requestJson('/api/agents/storyboard-template/override', { method: 'DELETE' });
},
previewAgentMessages(config, values = {}) {
  return requestJson('/api/agents/messages/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, values }),
  });
},
```

Change `createDouyinAgentRun()` signature:

```js
createDouyinAgentRun(awemeId, template = 'viral_rewrite', promptOptions = {}, agentConfigOverride = null) {
  return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template, promptOptions, agentConfigOverride }),
  });
},
```

Change `createDouyinRunStoryboard()` signature:

```js
createDouyinRunStoryboard(awemeId, runId, storyboardOptions = {}, storyboardConfigOverride = null) {
  return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/storyboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storyboardOptions, storyboardConfigOverride }),
  });
},
```

- [ ] **Step 5: Run checks**

Run:

```bash
node --check server/routes/agents.js
node --check server/services/agentRuns.js
node test-agent-runs.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/routes/agents.js frontend-react/src/api/client.js test-agent-runs.js
git commit -m "添加可编辑Agent模板接口"
```

---

## Task 5: Editable Storyboard Agent Snapshots

**Files:**
- Modify: `server/services/storyboardAgent.js`
- Modify: `test-storyboard-agent.js`
- Modify: `server/services/agentRuns.js`
- Modify: `test-agent-runs.js`

- [ ] **Step 1: Add failing storyboard Agent tests**

In `test-storyboard-agent.js`, add assertions:

```js
const editableStoryboard = storyboardAgent.getEditableStoryboardTemplate();
assert.ok(editableStoryboard.systemPrompt.includes('MuseDock'));
assert.ok(editableStoryboard.userPromptTemplate.includes('{{rewriteScript}}'));
assert.equal(editableStoryboard.useFrameProfile, true);
assert.equal(editableStoryboard.modelOptions.temperature, 0.35);

const customResult = await storyboardAgent.createStoryboard({
  rewriteScript: '第一句。第二句。',
  captions: [
    { index: 1, start: 0, end: 1, duration: 1, text: '第一句。' },
    { index: 2, start: 1, end: 2, duration: 1, text: '第二句。' },
  ],
  editableConfig: {
    source: 'request',
    systemPrompt: '自定义分镜系统',
    userPromptTemplate: '脚本：{{rewriteScript}}\n字幕：{{captionIndexesJson}}',
    useFrameProfile: false,
    modelOptions: { temperature: 0.9, stream: false, maxRetries: 2 },
  },
  aiTextModel: {
    async callTextModel(payload) {
      assert.equal(payload.messages[0].content, '自定义分镜系统');
      assert.equal(payload.temperature, 0.9);
      assert.equal(payload.stream, false);
      return {
        success: true,
        text: JSON.stringify({
          template: 'ai_storyboard_cards',
          scenes: [{ caption_indexes: [1], headline: '开头', visual_type: 'text_card', layout: 'center_focus', background_prompt: '抽象背景', emphasis_words: ['开头'] }],
        }),
        model: { model_id: 'fake' },
      };
    },
  },
});
assert.equal(customResult.config_snapshot.source, 'request');
assert.equal(customResult.messages[0].content, '自定义分镜系统');
assert.equal(customResult.raw_output.includes('ai_storyboard_cards'), true);
assert.equal(customResult.parse.success, true);
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node test-storyboard-agent.js
```

Expected: fails because editable storyboard config is not implemented.

- [ ] **Step 3: Implement editable storyboard config**

In `server/services/storyboardAgent.js`, add:

```js
function getEditableStoryboardTemplate() {
  return {
    id: 'storyboard_agent',
    label: 'AI 分镜 Agent',
    description: '根据改写脚本和 TTS 字幕生成原创分镜。',
    systemPrompt: [
      '你是 MuseDock 的原创短视频分镜 Agent。',
      '只输出 JSON，不要输出 Markdown、解释或代码块。',
      '你只负责决定原创视觉分镜结构、标题、布局、强调词和原创视觉提示。',
      '不要输出 start、end、duration，最终时间轴由后端根据 tts.captions 计算。',
      '不要引用原视频、原视频帧、截图、原作者画面或搬运素材。',
      'JSON 必须包含 template、style、scenes。',
      '每个 scene 必须包含 caption_indexes、headline、visual_type、layout、background_prompt、emphasis_words。',
    ].join('\n'),
    userPromptTemplate: [
      '任务：根据改写脚本和字幕索引生成原创分镜。',
      '',
      '改写脚本：',
      '{{rewriteScript}}',
      '',
      '字幕索引：',
      '{{captionIndexesJson}}',
      '',
      '[AI_STORYBOARD_MAX_SCENES=12]',
      '[AI_STORYBOARD_BACKEND_FILL=true]',
      '',
      '要求：',
      '- caption_indexes 必须引用现有字幕 index。',
      '- 每个字幕 index 最多被一个 scene 使用。',
      '- 最多生成 12 个关键分镜，优先覆盖开头、转折、核心观点和结尾。',
      '- 未覆盖字幕会由后端自动补齐为默认分镜。',
      '- 每个 scene 最多覆盖 2 条连续字幕。',
      '- visual_type 优先使用 text_card、quote_card、step_card、contrast_card。',
      '- background_prompt 必须描述原创抽象/图文背景，不得描述原视频画面。',
      '',
      '{{frameProfileBrief}}',
      '',
      '{{storyboardOptionsText}}',
    ].join('\n'),
    useFrameProfile: true,
    modelOptions: {
      temperature: 0.35,
      stream: true,
      maxRetries: 1,
    },
  };
}
```

Add:

```js
function replaceTemplateVars(template, values = {}) {
  return String(template || '').replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, key) => {
    const value = values[key];
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : String(value);
  });
}

function buildStoryboardMessagesFromEditableConfig(config, values) {
  return [
    { role: 'system', content: config.systemPrompt },
    { role: 'user', content: replaceTemplateVars(config.userPromptTemplate, values) },
  ];
}
```

In `createStoryboard()`, choose:

```js
const editableConfig = options.editableConfig || getEditableStoryboardTemplate();
const messages = buildStoryboardMessagesFromEditableConfig(editableConfig, {
  rewriteScript,
  captionIndexesJson: JSON.stringify(captionIndexes, null, 2),
  frameProfileBrief: editableConfig.useFrameProfile === false ? '' : getFrameProfileBrief({
    frameProfileId: options.frameProfileId || DEFAULT_FRAME_PROFILE_ID,
    frameDocText: options.frameDocText || '',
  }),
  storyboardOptionsText: formatStoryboardOptionsForPrompt(storyboardOptions),
});
```

Pass model options:

```js
temperature: editableConfig.modelOptions?.temperature ?? 0.35,
maxRetries: editableConfig.modelOptions?.maxRetries,
stream: editableConfig.modelOptions?.stream !== false,
```

Return:

```js
config_snapshot: {
  source: editableConfig.source || 'default',
  systemPrompt: editableConfig.systemPrompt,
  userPromptTemplate: editableConfig.userPromptTemplate,
  useFrameProfile: editableConfig.useFrameProfile !== false,
  modelOptions: editableConfig.modelOptions || {},
},
messages,
raw_output: modelResult.text || '',
parse: parsed.parsed ? { success: true, error: '' } : { success: false, error: 'AI 分镜返回不是有效 JSON。' },
schema_validation: storyboard.status === 'done'
  ? { success: true, errors: [] }
  : { success: false, errors: [storyboard.message || '分镜生成失败。'] },
```

Export `getEditableStoryboardTemplate`.

- [ ] **Step 4: Save storyboard snapshot in runs**

In `agentRuns.createDouyinRunStoryboard()`, resolve config:

```js
const agentTemplateOverrides = require('./agentTemplateOverrides');
const storyboardConfig = await agentTemplateOverrides.resolveStoryboardAgentConfig({
  rootDir: options.rootDir,
  storyboardConfigOverride: options.storyboardConfigOverride,
});
```

Pass `editableConfig: storyboardConfig` to `createStoryboard()`.

Save in `updatedRun`:

```js
storyboard_config_snapshot: result.config_snapshot,
storyboard_messages: result.messages || [],
storyboard_raw_output: result.raw_output || '',
storyboard_parse: result.parse || { success: true, error: '' },
storyboard_schema_validation: result.schema_validation || { success: true, errors: [] },
```

Return the same fields.

- [ ] **Step 5: Run tests**

Run:

```bash
node test-storyboard-agent.js
node test-agent-runs.js
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add server/services/storyboardAgent.js server/services/agentRuns.js test-storyboard-agent.js test-agent-runs.js
git commit -m "保存分镜Agent配置快照"
```

---

## Task 6: Manual Storyboard Scene Editing

**Files:**
- Modify: `server/services/storyboardSchema.js`
- Modify: `server/services/agentRuns.js`
- Modify: `server/routes/agents.js`
- Modify: `frontend-react/src/api/client.js`
- Modify: `test-storyboard-schema.js`
- Modify: `test-agent-runs.js`

- [ ] **Step 1: Add failing schema tests**

In `test-storyboard-schema.js`, add:

```js
const validation = schema.validateStoryboardEditableInput({
  storyboard: {
    scenes: [
      { caption_indexes: [1], headline: '第一屏', visual_type: 'text_card', layout: 'center_focus', background_prompt: '原创背景', emphasis_words: ['重点'] },
      { caption_indexes: [1], headline: '重复', visual_type: 'text_card', layout: 'center_focus', background_prompt: '原创背景', emphasis_words: [] },
    ],
  },
  captions: [
    { index: 1, start: 0, end: 1, duration: 1, text: '字幕一' },
  ],
});
assert.equal(validation.success, false);
assert.ok(validation.errors.some(item => item.includes('重复')));

const valid = schema.validateStoryboardEditableInput({
  storyboard: {
    scenes: [
      { caption_indexes: [1], headline: '第一屏', visual_type: 'text_card', layout: 'center_focus', background_prompt: '原创背景', emphasis_words: ['重点'] },
    ],
  },
  captions: [
    { index: 1, start: 0, end: 1, duration: 1, text: '字幕一' },
  ],
});
assert.equal(valid.success, true);
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node test-storyboard-schema.js
```

Expected: fails because validation helper does not exist.

- [ ] **Step 3: Implement editable storyboard validation**

In `server/services/storyboardSchema.js`, add:

```js
function validateStoryboardEditableInput({ storyboard = {}, captions = [] } = {}) {
  const normalizedCaptions = normalizeCaptions(captions);
  const captionIndexes = new Set(normalizedCaptions.map(item => item.index));
  const used = new Set();
  const errors = [];
  const scenes = asArray(storyboard.scenes);
  if (!scenes.length) errors.push('分镜不能为空。');

  scenes.forEach((scene, sceneIndex) => {
    const label = `分镜 ${sceneIndex + 1}`;
    const indexes = asArray(scene.caption_indexes).map(item => Number(item)).filter(Number.isFinite);
    if (!indexes.length) errors.push(`${label} 必须至少引用一条字幕。`);
    indexes.forEach(index => {
      if (!captionIndexes.has(index)) errors.push(`${label} 引用了不存在的字幕 ${index}。`);
      if (used.has(index)) errors.push(`${label} 重复使用了字幕 ${index}。`);
      used.add(index);
    });
    if (!sanitizeText(scene.headline)) errors.push(`${label} 标题不能为空。`);
    if (!sanitizeText(scene.visual_type)) errors.push(`${label} 画面类型不能为空。`);
    if (!sanitizeText(scene.layout)) errors.push(`${label} 布局不能为空。`);
    if (!sanitizeText(scene.background_prompt)) errors.push(`${label} 背景提示不能为空。`);
  });

  return {
    success: errors.length === 0,
    errors,
  };
}
```

Export it.

- [ ] **Step 4: Add update run service**

In `server/services/agentRuns.js`, require `storyboardSchema`:

```js
const storyboardSchema = require('./storyboardSchema');
```

Add:

```js
async function updateDouyinRunStoryboard(awemeId, runId, storyboard, options = {}) {
  if (!isSafeId(awemeId)) return createInvalidAwemeResult(awemeId);
  if (!isSafeRunId(runId)) {
    return { success: false, aweme_id: String(awemeId || ''), run_id: String(runId || ''), message: '未找到或非法的 Agent 运行记录' };
  }

  const runPath = getRunPath(awemeId, runId, options.rootDir);
  const run = await readJsonIfExists(runPath);
  if (!run) {
    return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: '未找到该 Agent 运行记录' };
  }

  const captions = Array.isArray(run?.tts?.captions) ? run.tts.captions : [];
  if (!captions.length) {
    return { success: false, aweme_id: String(awemeId), run_id: String(runId), message: '请先完成 TTS 合成并生成字幕时间轴。' };
  }

  const validation = storyboardSchema.validateStoryboardEditableInput({ storyboard, captions });
  if (!validation.success) {
    return {
      success: false,
      aweme_id: String(awemeId),
      run_id: String(runId),
      message: '分镜校验失败，请修正后再保存。',
      storyboard_schema_validation: validation,
    };
  }

  const normalized = storyboardSchema.normalizeStoryboard({ storyboard, captions });
  const updatedRun = {
    ...run,
    storyboard: normalized,
    storyboard_schema_validation: { success: true, errors: [] },
    video: run.video?.status === 'rendering' ? run.video : null,
    updated_at: new Date().toISOString(),
  };
  await writeJson(runPath, updatedRun);

  return {
    success: true,
    aweme_id: String(awemeId),
    run_id: String(runId),
    message: '分镜已保存，请重新生成视频工程。',
    storyboard: normalized,
    storyboard_schema_validation: updatedRun.storyboard_schema_validation,
  };
}
```

Export `updateDouyinRunStoryboard`.

- [ ] **Step 5: Add route and client API**

In `server/routes/agents.js`, add before the storyboard POST or after it:

```js
router.put('/douyin/:aweme_id/runs/:run_id/storyboard', async (req, res) => {
  try {
    const result = await agentRuns.updateDouyinRunStoryboard(req.params.aweme_id, req.params.run_id, req.body?.storyboard || {});
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '保存 AI 分镜接口异常，请稍后重试。',
    });
  }
});
```

In `frontend-react/src/api/client.js`, add:

```js
saveDouyinRunStoryboard(awemeId, runId, storyboard = {}) {
  return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/storyboard`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storyboard }),
  });
},
```

- [ ] **Step 6: Run tests**

Run:

```bash
node test-storyboard-schema.js
node test-agent-runs.js
node --check server/routes/agents.js
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/services/storyboardSchema.js server/services/agentRuns.js server/routes/agents.js frontend-react/src/api/client.js test-storyboard-schema.js test-agent-runs.js
git commit -m "支持手动编辑并保存AI分镜"
```

---

## Task 7: Frontend Formatting Utilities

**Files:**
- Modify: `frontend-react/src/utils/agentRuns.js`
- Modify: `test-agent-run-utils.mjs`

- [ ] **Step 1: Add failing utility tests**

In `test-agent-run-utils.mjs`, add:

```js
import {
  getAgentConfigSourceLabel,
  getDebugSections,
  getValidationSummary,
} from './frontend-react/src/utils/agentRuns.js';

assert.strictEqual(getAgentConfigSourceLabel('default'), '默认模板');
assert.strictEqual(getAgentConfigSourceLabel('override'), '已保存自定义');
assert.strictEqual(getAgentConfigSourceLabel('request'), '本次临时编辑');

assert.deepStrictEqual(getValidationSummary({ success: false, errors: ['字段缺失'] }), {
  type: 'error',
  message: '字段缺失',
});

const debugSections = getDebugSections({
  messages: [{ role: 'system', content: '系统' }],
  raw_output: '{"summary":"ok"}',
  parse: { success: true, error: '' },
  schema_validation: { success: true, errors: [] },
  result: { summary: 'ok' },
});
assert.strictEqual(debugSections.length, 5);
assert.strictEqual(debugSections[0].title, '最终 messages');
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node test-agent-run-utils.mjs
```

Expected: fails because helpers do not exist.

- [ ] **Step 3: Implement helpers**

In `frontend-react/src/utils/agentRuns.js`, add:

```js
export function getAgentConfigSourceLabel(source) {
  const labels = {
    default: '默认模板',
    override: '已保存自定义',
    request: '本次临时编辑',
  };
  return labels[source] || '未知来源';
}

export function getValidationSummary(validation = {}) {
  if (validation.success) {
    return { type: 'success', message: '校验通过' };
  }
  const errors = Array.isArray(validation.errors) ? validation.errors.filter(Boolean) : [];
  return {
    type: 'error',
    message: errors[0] || validation.error || '校验失败',
  };
}

function stringifyDebug(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value || {}, null, 2);
}

export function getDebugSections(run = {}) {
  return [
    { key: 'messages', title: '最终 messages', text: stringifyDebug(run.messages || []) },
    { key: 'raw_output', title: '模型原始输出', text: run.raw_output || run.raw_text || '' },
    { key: 'parse', title: 'JSON 解析状态', text: stringifyDebug(run.parse || {}) },
    { key: 'schema_validation', title: 'schema 校验结果', text: stringifyDebug(run.schema_validation || {}) },
    { key: 'normalized_result', title: '归一化结果', text: stringifyDebug(run.result || {}) },
  ];
}

export function getStoryboardDebugSections(run = {}) {
  return [
    { key: 'storyboard_messages', title: '分镜 messages', text: stringifyDebug(run.storyboard_messages || []) },
    { key: 'storyboard_raw_output', title: '分镜原始输出', text: run.storyboard_raw_output || '' },
    { key: 'storyboard_parse', title: '分镜 JSON 解析状态', text: stringifyDebug(run.storyboard_parse || {}) },
    { key: 'storyboard_schema_validation', title: '分镜 schema 校验结果', text: stringifyDebug(run.storyboard_schema_validation || {}) },
    { key: 'storyboard', title: '归一化分镜', text: stringifyDebug(run.storyboard || {}) },
  ];
}
```

- [ ] **Step 4: Run test**

Run:

```bash
node test-agent-run-utils.mjs
```

Expected: `agent run utils tests passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend-react/src/utils/agentRuns.js test-agent-run-utils.mjs
git commit -m "添加Agent调试信息展示工具"
```

---

## Task 8: Editable Task Agent UI

**Files:**
- Modify: `frontend-react/src/pages/AiWorkspace.jsx`
- Modify: `frontend-react/src/styles.css`

- [ ] **Step 1: Add state and loading for template configs**

In `AiWorkspace.jsx`, import new helpers:

```js
import {
  getAgentConfigSourceLabel,
  getAgentResultSections,
  getAgentStepLabel,
  getDebugSections,
  getRunDisplayTime,
} from '../utils/agentRuns.js';
```

Add state:

```js
const [agentTemplates, setAgentTemplates] = useState(AGENT_TEMPLATES);
const [agentConfig, setAgentConfig] = useState(null);
const [agentConfigDraft, setAgentConfigDraft] = useState(null);
const [agentConfigOpen, setAgentConfigOpen] = useState(false);
const [agentConfigSaving, setAgentConfigSaving] = useState(false);
```

Add loader:

```js
async function loadAgentTemplates(nextTemplate = selectedTemplate) {
  const listJson = await api.listAgentTemplates();
  const nextTemplates = listJson.data || [];
  setAgentTemplates(nextTemplates.length ? nextTemplates : AGENT_TEMPLATES);
  const detailJson = await api.getAgentTemplate(nextTemplate);
  setAgentConfig(detailJson.data);
  setAgentConfigDraft(detailJson.data);
}
```

In `loadWorkspace()`, include `loadAgentTemplates(value)` before setting success.

- [ ] **Step 2: Add config editing functions**

Add:

```js
function updateAgentConfigDraft(key, value) {
  setAgentConfigDraft(prev => ({ ...(prev || {}), [key]: value }));
}

function updateAgentModelOption(key, value) {
  setAgentConfigDraft(prev => ({
    ...(prev || {}),
    modelOptions: {
      ...((prev && prev.modelOptions) || {}),
      [key]: key === 'stream' ? Boolean(value) : value,
    },
  }));
}

async function saveAgentConfig() {
  if (!agentConfigDraft?.id) return;
  setAgentConfigSaving(true);
  setStatus({ type: 'loading', message: '正在保存 Agent 模板配置...' });
  try {
    const json = await api.saveAgentTemplate(agentConfigDraft.id, agentConfigDraft);
    setAgentConfig(json.data);
    setAgentConfigDraft(json.data);
    setStatus({ type: 'success', message: json.message || 'Agent 模板配置已保存。' });
  } catch (error) {
    setStatus({ type: 'error', message: error.message });
  } finally {
    setAgentConfigSaving(false);
  }
}

async function restoreAgentConfig() {
  if (!selectedTemplate) return;
  setAgentConfigSaving(true);
  setStatus({ type: 'loading', message: '正在恢复默认 Agent 模板配置...' });
  try {
    const json = await api.restoreAgentTemplate(selectedTemplate);
    const detailJson = await api.getAgentTemplate(selectedTemplate);
    setAgentConfig(detailJson.data);
    setAgentConfigDraft(detailJson.data);
    setStatus({ type: 'success', message: json.message || '已恢复默认 Agent 模板配置。' });
  } catch (error) {
    setStatus({ type: 'error', message: error.message });
  } finally {
    setAgentConfigSaving(false);
  }
}
```

When selecting a template, fetch detail:

```js
onClick={async () => {
  setSelectedTemplate(template.id);
  const detailJson = await api.getAgentTemplate(template.id);
  setAgentConfig(detailJson.data);
  setAgentConfigDraft(detailJson.data);
}}
```

- [ ] **Step 3: Pass overrides when running**

In `runAgent()`, compute:

```js
const override = agentConfigDraft ? {
  systemPrompt: agentConfigDraft.systemPrompt,
  userPromptTemplate: agentConfigDraft.userPromptTemplate,
  resultSchema: agentConfigDraft.resultSchema || {},
  modelOptions: agentConfigDraft.modelOptions || {},
} : null;
```

Call:

```js
const json = await api.createDouyinAgentRun(value, selectedTemplate, promptOptions, override);
```

Use loading text:

```js
setStatus({ type: 'loading', message: `正在运行当前 Agent：${templateMeta.label}...` });
```

- [ ] **Step 4: Replace left panel markup**

Replace the left panel heading and template area with:

```jsx
<h3>Agent 配置</h3>
{agentTemplates.map(template => (
  <div className={`agentTemplate ${selectedTemplate === template.id ? 'active' : ''}`} key={template.id}>
    <strong>{template.label}</strong>
    <p>{template.description}</p>
    <span className="configSource">{getAgentConfigSourceLabel(template.source)}</span>
    <Button
      variant={selectedTemplate === template.id ? 'default' : 'secondary'}
      disabled={loading || running}
      onClick={async () => {
        setSelectedTemplate(template.id);
        setStatus({ type: 'loading', message: '正在加载 Agent 模板配置...' });
        const detailJson = await api.getAgentTemplate(template.id);
        setAgentConfig(detailJson.data);
        setAgentConfigDraft(detailJson.data);
        setStatus({ type: 'success', message: 'Agent 模板配置已加载。' });
      }}
    >
      {selectedTemplate === template.id ? '已选择' : '选择模板'}
    </Button>
  </div>
))}

<div className="agentOptionGroup">
  <div className="agentResultSectionHeader">
    <h4>高级编辑</h4>
    <Button size="sm" variant="secondary" onClick={() => setAgentConfigOpen(value => !value)}>
      {agentConfigOpen ? '收起' : '展开'}
    </Button>
  </div>
  {agentConfigOpen && agentConfigDraft ? (
    <div className="promptEditor">
      <label>
        <span>system prompt</span>
        <textarea
          value={agentConfigDraft.systemPrompt || ''}
          onChange={event => updateAgentConfigDraft('systemPrompt', event.target.value)}
          disabled={loading || running || agentConfigSaving}
        />
      </label>
      <label>
        <span>user prompt 模板</span>
        <textarea
          value={agentConfigDraft.userPromptTemplate || ''}
          onChange={event => updateAgentConfigDraft('userPromptTemplate', event.target.value)}
          disabled={loading || running || agentConfigSaving}
        />
      </label>
      <label>
        <span>temperature</span>
        <Input
          type="number"
          min="0"
          max="2"
          step="0.1"
          value={agentConfigDraft.modelOptions?.temperature ?? 0.4}
          onChange={event => updateAgentModelOption('temperature', Number(event.target.value))}
          disabled={loading || running || agentConfigSaving}
        />
      </label>
      <label className="inlineCheck">
        <input
          type="checkbox"
          checked={agentConfigDraft.modelOptions?.stream !== false}
          onChange={event => updateAgentModelOption('stream', event.target.checked)}
          disabled={loading || running || agentConfigSaving}
        />
        流式调用
      </label>
      <label>
        <span>maxRetries</span>
        <Input
          type="number"
          min="0"
          max="5"
          step="1"
          value={agentConfigDraft.modelOptions?.maxRetries ?? 1}
          onChange={event => updateAgentModelOption('maxRetries', Number(event.target.value))}
          disabled={loading || running || agentConfigSaving}
        />
      </label>
      <div className="videoProjectActions">
        <Button size="sm" variant="secondary" disabled={agentConfigSaving} onClick={restoreAgentConfig}>恢复默认</Button>
        <Button size="sm" disabled={agentConfigSaving} onClick={saveAgentConfig}>保存为当前模板配置</Button>
      </div>
    </div>
  ) : null}
</div>
```

- [ ] **Step 5: Add debug tab**

Add tab:

```js
['debug', '调试']
```

Render:

```jsx
{resultTab === 'debug' ? (
  <>
    {getDebugSections(activeRun).map(section => (
      <section className="agentResultSection" key={section.key}>
        <h4>{section.title}</h4>
        <pre>{section.text || '暂无内容'}</pre>
      </section>
    ))}
  </>
) : null}
```

Show config source in run meta:

```jsx
<span>{getAgentConfigSourceLabel(activeRun.agent_config_snapshot?.source)}</span>
```

- [ ] **Step 6: Add styles**

In `frontend-react/src/styles.css`, add:

```css
.configSource { color: #69717e; font-size: 12px; font-weight: 700; }
.promptEditor { display: grid; gap: 12px; }
.promptEditor label { display: grid; gap: 6px; color: #30343b; font-size: 13px; font-weight: 700; }
.promptEditor label span { color: #69717e; font-size: 12px; }
.promptEditor textarea { min-height: 160px; resize: vertical; border: 1px solid #d7dce3; border-radius: 8px; padding: 10px; font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; color: #30343b; background: #fff; }
.promptEditor textarea:disabled { color: #8a93a2; background: #f4f6f8; }
```

- [ ] **Step 7: Run checks**

Run:

```bash
npm run build:frontend
node test-agent-run-utils.mjs
```

Expected: frontend builds successfully and utility tests pass.

- [ ] **Step 8: Commit**

```bash
git add frontend-react/src/pages/AiWorkspace.jsx frontend-react/src/styles.css
git commit -m "将AI工作台升级为可编辑任务Agent"
```

---

## Task 9: Editable Storyboard UI and Scene Editor

**Files:**
- Modify: `frontend-react/src/pages/AiWorkspace.jsx`
- Modify: `frontend-react/src/styles.css`

- [ ] **Step 1: Add storyboard config and scene editor state**

In `AiWorkspace.jsx`, import `getStoryboardDebugSections`.

Add state:

```js
const [storyboardConfig, setStoryboardConfig] = useState(null);
const [storyboardConfigDraft, setStoryboardConfigDraft] = useState(null);
const [storyboardConfigOpen, setStoryboardConfigOpen] = useState(false);
const [storyboardConfigSaving, setStoryboardConfigSaving] = useState(false);
const [storyboardDraft, setStoryboardDraft] = useState(null);
const [storyboardSaving, setStoryboardSaving] = useState(false);
```

Load storyboard config in `loadWorkspace()`:

```js
const storyboardTemplateJson = await api.getStoryboardTemplate();
setStoryboardConfig(storyboardTemplateJson.data);
setStoryboardConfigDraft(storyboardTemplateJson.data);
```

Sync scene draft:

```js
useEffect(() => {
  if (activeRun?.storyboard) {
    setStoryboardDraft(JSON.parse(JSON.stringify(activeRun.storyboard)));
  } else {
    setStoryboardDraft(null);
  }
}, [activeRun?.run_id, activeRun?.storyboard?.updated_at]);
```

- [ ] **Step 2: Add storyboard config actions**

Add:

```js
function updateStoryboardConfigDraft(key, value) {
  setStoryboardConfigDraft(prev => ({ ...(prev || {}), [key]: value }));
}

function updateStoryboardModelOption(key, value) {
  setStoryboardConfigDraft(prev => ({
    ...(prev || {}),
    modelOptions: {
      ...((prev && prev.modelOptions) || {}),
      [key]: key === 'stream' ? Boolean(value) : value,
    },
  }));
}

async function saveStoryboardConfig() {
  setStoryboardConfigSaving(true);
  setStatus({ type: 'loading', message: '正在保存分镜 Agent 配置...' });
  try {
    const json = await api.saveStoryboardTemplate(storyboardConfigDraft);
    setStoryboardConfig(json.data);
    setStoryboardConfigDraft(json.data);
    setStatus({ type: 'success', message: json.message || '分镜 Agent 配置已保存。' });
  } catch (error) {
    setStatus({ type: 'error', message: error.message });
  } finally {
    setStoryboardConfigSaving(false);
  }
}

async function restoreStoryboardConfig() {
  setStoryboardConfigSaving(true);
  setStatus({ type: 'loading', message: '正在恢复默认分镜 Agent 配置...' });
  try {
    const json = await api.restoreStoryboardTemplate();
    const detail = await api.getStoryboardTemplate();
    setStoryboardConfig(detail.data);
    setStoryboardConfigDraft(detail.data);
    setStatus({ type: 'success', message: json.message || '已恢复默认分镜 Agent 配置。' });
  } catch (error) {
    setStatus({ type: 'error', message: error.message });
  } finally {
    setStoryboardConfigSaving(false);
  }
}
```

Pass override in `createStoryboard()`:

```js
const storyboardOverride = storyboardConfigDraft ? {
  systemPrompt: storyboardConfigDraft.systemPrompt,
  userPromptTemplate: storyboardConfigDraft.userPromptTemplate,
  useFrameProfile: storyboardConfigDraft.useFrameProfile !== false,
  modelOptions: storyboardConfigDraft.modelOptions || {},
} : null;
const json = await api.createDouyinRunStoryboard(value, activeRun.run_id, storyboardOptions, storyboardOverride);
```

- [ ] **Step 3: Add scene draft editing functions**

Add:

```js
function updateStoryboardScene(index, key, value) {
  setStoryboardDraft(prev => {
    if (!prev) return prev;
    return {
      ...prev,
      scenes: prev.scenes.map(scene => (
        scene.index === index ? { ...scene, [key]: value } : scene
      )),
    };
  });
}

function updateStoryboardSceneIndexes(index, value) {
  const indexes = String(value || '')
    .split(',')
    .map(item => Number(item.trim()))
    .filter(Number.isFinite);
  updateStoryboardScene(index, 'caption_indexes', indexes);
}

function updateStoryboardSceneEmphasis(index, value) {
  const words = String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  updateStoryboardScene(index, 'emphasis_words', words);
}

async function saveStoryboardDraft() {
  const value = selectedAwemeId.trim();
  if (!value || !activeRun?.run_id || !storyboardDraft) {
    setStatus({ type: 'error', message: '请先选择一条包含分镜的运行记录。' });
    return;
  }
  setStoryboardSaving(true);
  setStatus({ type: 'loading', message: '正在校验并保存 AI 分镜...' });
  try {
    const json = await api.saveDouyinRunStoryboard(value, activeRun.run_id, storyboardDraft);
    setActiveRun(prev => prev ? {
      ...prev,
      storyboard: json.storyboard,
      storyboard_schema_validation: json.storyboard_schema_validation,
      video: null,
      updated_at: new Date().toISOString(),
    } : prev);
    setRuns(prev => prev.map(run => (
      run.run_id === activeRun.run_id ? {
        ...run,
        storyboard: json.storyboard,
        storyboard_schema_validation: json.storyboard_schema_validation,
        video: null,
        updated_at: new Date().toISOString(),
      } : run
    )));
    setStatus({ type: 'success', message: json.message || '分镜已保存。' });
  } catch (error) {
    setStatus({ type: 'error', message: error.message });
  } finally {
    setStoryboardSaving(false);
  }
}
```

- [ ] **Step 4: Add storyboard config editor UI**

In the `video` tab above existing storyboard options, add:

```jsx
<div className="agentOptionGroup">
  <div className="agentResultSectionHeader">
    <h4>分镜 Agent 高级编辑</h4>
    <Button size="sm" variant="secondary" onClick={() => setStoryboardConfigOpen(value => !value)}>
      {storyboardConfigOpen ? '收起' : '展开'}
    </Button>
  </div>
  {storyboardConfigOpen && storyboardConfigDraft ? (
    <div className="promptEditor">
      <label>
        <span>system prompt</span>
        <textarea
          value={storyboardConfigDraft.systemPrompt || ''}
          onChange={event => updateStoryboardConfigDraft('systemPrompt', event.target.value)}
          disabled={storyboardConfigSaving || storyboardRunning || videoBusy}
        />
      </label>
      <label>
        <span>user prompt 模板</span>
        <textarea
          value={storyboardConfigDraft.userPromptTemplate || ''}
          onChange={event => updateStoryboardConfigDraft('userPromptTemplate', event.target.value)}
          disabled={storyboardConfigSaving || storyboardRunning || videoBusy}
        />
      </label>
      <label className="inlineCheck">
        <input
          type="checkbox"
          checked={storyboardConfigDraft.useFrameProfile !== false}
          onChange={event => updateStoryboardConfigDraft('useFrameProfile', event.target.checked)}
          disabled={storyboardConfigSaving || storyboardRunning || videoBusy}
        />
        引用 Frame Profile 文档
      </label>
      <Input
        type="number"
        min="0"
        max="2"
        step="0.1"
        value={storyboardConfigDraft.modelOptions?.temperature ?? 0.35}
        onChange={event => updateStoryboardModelOption('temperature', Number(event.target.value))}
        disabled={storyboardConfigSaving || storyboardRunning || videoBusy}
      />
      <label className="inlineCheck">
        <input
          type="checkbox"
          checked={storyboardConfigDraft.modelOptions?.stream !== false}
          onChange={event => updateStoryboardModelOption('stream', event.target.checked)}
          disabled={storyboardConfigSaving || storyboardRunning || videoBusy}
        />
        流式调用
      </label>
      <div className="videoProjectActions">
        <Button size="sm" variant="secondary" disabled={storyboardConfigSaving} onClick={restoreStoryboardConfig}>恢复默认</Button>
        <Button size="sm" disabled={storyboardConfigSaving} onClick={saveStoryboardConfig}>保存分镜 Agent 配置</Button>
      </div>
    </div>
  ) : null}
</div>
```

- [ ] **Step 5: Replace storyboard list with scene editor**

Replace read-only `storyboardList` rendering with:

```jsx
{storyboardDraft?.scenes?.length ? (
  <div className="storyboardList sceneEditorList">
    {storyboardDraft.scenes.map(scene => (
      <div className="storyboardItem sceneEditorItem" key={scene.index}>
        <div>
          <strong>分镜 {String(scene.index).padStart(2, '0')}</strong>
          <code>{formatCaptionTime(scene.start)} - {formatCaptionTime(scene.end)}</code>
        </div>
        <Input
          value={scene.headline || ''}
          onChange={event => updateStoryboardScene(scene.index, 'headline', event.target.value)}
          disabled={storyboardSaving || videoBusy}
          placeholder="分镜标题"
        />
        <Input
          value={(scene.caption_indexes || []).join(', ')}
          onChange={event => updateStoryboardSceneIndexes(scene.index, event.target.value)}
          disabled={storyboardSaving || videoBusy}
          placeholder="字幕索引，例如 1, 2"
        />
        <select
          value={scene.visual_type || 'text_card'}
          onChange={event => updateStoryboardScene(scene.index, 'visual_type', event.target.value)}
          disabled={storyboardSaving || videoBusy}
        >
          <option value="text_card">text_card</option>
          <option value="quote_card">quote_card</option>
          <option value="step_card">step_card</option>
          <option value="contrast_card">contrast_card</option>
        </select>
        <select
          value={scene.layout || 'center_focus'}
          onChange={event => updateStoryboardScene(scene.index, 'layout', event.target.value)}
          disabled={storyboardSaving || videoBusy}
        >
          <option value="center_focus">center_focus</option>
          <option value="split_emphasis">split_emphasis</option>
          <option value="stacked_steps">stacked_steps</option>
          <option value="compare_grid">compare_grid</option>
        </select>
        <textarea
          value={scene.background_prompt || ''}
          onChange={event => updateStoryboardScene(scene.index, 'background_prompt', event.target.value)}
          disabled={storyboardSaving || videoBusy}
          placeholder="原创背景提示"
        />
        <Input
          value={(scene.emphasis_words || []).join(', ')}
          onChange={event => updateStoryboardSceneEmphasis(scene.index, event.target.value)}
          disabled={storyboardSaving || videoBusy}
          placeholder="强调词，用英文逗号或中文逗号分隔"
        />
      </div>
    ))}
    <div className="videoProjectActions">
      <Button size="sm" variant="secondary" disabled={storyboardSaving || videoBusy} onClick={saveStoryboardDraft}>
        {storyboardSaving ? '保存中...' : '保存分镜修改'}
      </Button>
    </div>
  </div>
) : null}
```

Add debug sections under video tab:

```jsx
{getStoryboardDebugSections(activeRun).map(section => (
  <section className="agentResultSection" key={section.key}>
    <h4>{section.title}</h4>
    <pre>{section.text || '暂无内容'}</pre>
  </section>
))}
```

- [ ] **Step 6: Add scene editor styles**

In `styles.css`, add:

```css
.sceneEditorList { gap: 12px; }
.sceneEditorItem { display: grid; gap: 10px; }
.sceneEditorItem input,
.sceneEditorItem select,
.sceneEditorItem textarea { width: 100%; border: 1px solid #d7dce3; border-radius: 8px; padding: 9px 10px; font: inherit; color: #30343b; background: #fff; }
.sceneEditorItem textarea { min-height: 74px; resize: vertical; line-height: 1.5; }
.sceneEditorItem input:disabled,
.sceneEditorItem select:disabled,
.sceneEditorItem textarea:disabled { color: #8a93a2; background: #f4f6f8; }
```

- [ ] **Step 7: Run frontend verification**

Run:

```bash
npm run build:frontend
```

Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add frontend-react/src/pages/AiWorkspace.jsx frontend-react/src/styles.css
git commit -m "支持编辑分镜Agent和分镜结果"
```

---

## Task 10: Full Verification

**Files:**
- Review all modified files.

- [ ] **Step 1: Run backend checks**

Run:

```bash
node --check server/services/agentTemplates.js
node --check server/services/agentTemplateOverrides.js
node --check server/services/storyboardAgent.js
node --check server/services/storyboardSchema.js
node --check server/services/agentRuns.js
node --check server/routes/agents.js
```

Expected: no syntax errors.

- [ ] **Step 2: Run focused tests**

Run:

```bash
node test-agent-templates.js
node test-agent-template-overrides.js
node test-storyboard-schema.js
node test-storyboard-agent.js
node test-agent-runs.js
node test-agent-run-utils.mjs
```

Expected: all print their success messages.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Build frontend**

Run:

```bash
npm run build:frontend
```

Expected: Vite build succeeds.

- [ ] **Step 5: Manual smoke test**

Start the app:

```bash
npm run dev
```

Open `/ai` and verify:

- Loading an `aweme_id` shows Chinese loading status and finishes in success or clear failure state.
- Task Agent advanced editor opens and edits prompts.
- “保存为当前模板配置” persists after reload.
- “恢复默认” restores code defaults.
- Running current Agent stores `agent_config_snapshot`, `messages`, `raw_output`, `parse`, and `schema_validation`.
- Debug tab shows final messages and raw output.
- TTS generation still works for `viral_rewrite`.
- Storyboard Agent advanced editor opens and can save/restore.
- Generating storyboard stores storyboard debug snapshots.
- Editing a scene and saving updates storyboard and clears stale video project state.
- Regenerating HyperFrames project uses the edited storyboard.

- [ ] **Step 6: Commit any verification fixes**

If verification requires fixes:

```bash
git add <fixed-files>
git commit -m "修复可编辑Agent工作台验证问题"
```

If no fixes are needed, do not create an empty commit.

---

## Self-Review

- Spec coverage:
  - Editable task Agent templates: Tasks 1, 2, 3, 4, 8.
  - Editable storyboard Agent config: Tasks 2, 5, 9.
  - Run snapshots and debug output: Tasks 3, 5, 7, 8, 9.
  - Scene editing and video regeneration: Tasks 6, 9, 10.
  - Chinese loading/error states: Tasks 4, 8, 9, 10.
  - No separate `/ai/debug`: all UI work stays in `AiWorkspace.jsx`.

- Placeholder scan:
  - No `TBD`, `TODO`, `FIXME`, or vague “handle later” steps are intentionally included.

- Type consistency:
  - Task config override field is `agentConfigOverride`.
  - Storyboard config override field is `storyboardConfigOverride`.
  - Run snapshot field names match the design: `agent_config_snapshot`, `messages`, `raw_output`, `parse`, `schema_validation`, `storyboard_config_snapshot`, `storyboard_messages`, `storyboard_raw_output`, `storyboard_parse`, `storyboard_schema_validation`.

