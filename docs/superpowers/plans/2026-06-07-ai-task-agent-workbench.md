# AI Task Agent Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first controlled AI task-flow Agent in MuseDock: “爆款拆解 + 改写脚本” for prepared Douyin media.

**Architecture:** Add a backend text-model adapter, an Agent run service that reads local media context and persists results, Express routes under `/api/agents`, and a React AI workbench UI that drives one fixed task template. The first version is intentionally bounded: one template, one text-model call, local data only, no autonomous crawling or global queue.

**Tech Stack:** Node.js 22, Express, React 19, Vite, SQLite via `better-sqlite3`, existing file-based media cache, OpenAI-compatible chat completions.

---

## File Structure

- Create `server/services/aiTextModel.js`: text model runtime resolver and OpenAI-compatible `/chat/completions` caller.
- Create `server/services/agentRuns.js`: controlled Agent workflow, prompt construction, result parsing, `agent_runs` persistence.
- Create `server/routes/agents.js`: HTTP API for creating and reading Agent runs.
- Modify `server/app.js`: mount `/api/agents`.
- Modify `frontend-react/src/api/client.js`: add Agent API methods.
- Rewrite `frontend-react/src/pages/AiWorkspace.jsx`: controlled task-flow UI.
- Create `frontend-react/src/utils/agentRuns.js`: pure formatting helpers for Agent output.
- Modify `frontend-react/src/styles.css`: AI workbench layout and result styles.
- Create `test-ai-text-model.js`: backend text model adapter tests.
- Create `test-agent-runs.js`: backend Agent workflow tests.
- Create `test-agent-run-utils.mjs`: frontend pure utility tests.
- Modify `package.json`: add a focused `test` script that runs non-live tests.
- Modify `README.md`: document AI Agent workbench usage and API.

## Task 1: Text Model Adapter

**Files:**
- Create: `server/services/aiTextModel.js`
- Create: `test-ai-text-model.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing adapter test**

Create `test-ai-text-model.js`:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const aiModelConfig = require('./server/services/aiModelConfig');
const aiTextModel = require('./server/services/aiTextModel');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-text-model-test-'));
  const configPath = path.join(root, 'ai-models.json');

  const missing = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'hello' }],
    configPath,
  });
  assert.strictEqual(missing.success, false);
  assert.strictEqual(missing.configured, false);
  assert.match(missing.message, /文本模型未配置/);

  await aiModelConfig.saveConfig({
    models: {
      text: {
        enabled: true,
        provider: 'OpenAI',
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com/v1/',
        modelId: 'gpt-test',
        note: '',
      },
    },
  }, { configPath });

  let requestedUrl = '';
  let requestedOptions = null;
  const ok = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: '生成 JSON' }],
    configPath,
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"summary":"ok"}' } }],
        }),
      };
    },
  });

  assert.strictEqual(ok.success, true);
  assert.strictEqual(ok.text, '{"summary":"ok"}');
  assert.strictEqual(ok.model.provider, 'OpenAI');
  assert.strictEqual(ok.model.model_id, 'gpt-test');
  assert.strictEqual(requestedUrl, 'https://api.example.com/v1/chat/completions');
  assert.strictEqual(requestedOptions.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(requestedOptions.body);
  assert.strictEqual(body.model, 'gpt-test');
  assert.deepStrictEqual(body.messages, [{ role: 'user', content: '生成 JSON' }]);

  const failed = await aiTextModel.callTextModel({
    messages: [{ role: 'user', content: 'fail' }],
    configPath,
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'rate limited' } }),
    }),
  });
  assert.strictEqual(failed.success, false);
  assert.strictEqual(failed.configured, true);
  assert.match(failed.message, /rate limited/);
}

run().then(() => {
  console.log('ai text model tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run the failing adapter test**

Run:

```powershell
node test-ai-text-model.js
```

Expected: failure because `./server/services/aiTextModel` does not exist.

- [ ] **Step 3: Implement `server/services/aiTextModel.js`**

```js
const aiModelConfig = require('./aiModelConfig');

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function getErrorMessage(payload, status) {
  return payload?.error?.message || payload?.message || `HTTP ${status}`;
}

async function callTextModel(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const runtime = options.textConfig || await aiModelConfig.getRuntimeConfig('text', {
    configPath: options.configPath,
  });
  const enabled = runtime?.enabled === true;
  const apiKey = String(runtime?.apiKey || '').trim();
  const baseUrl = normalizeBaseUrl(runtime?.baseUrl);
  const modelId = String(runtime?.modelId || '').trim();

  if (!enabled || !apiKey || !baseUrl || !modelId) {
    return {
      success: false,
      configured: false,
      message: '文本模型未配置。请到设置页启用文本模型，并填写 API Key、Base URL 和模型 ID。',
      model: {
        provider: runtime?.provider || '',
        model_id: modelId,
      },
    };
  }

  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: options.messages || [],
      temperature: typeof options.temperature === 'number' ? options.temperature : 0.4,
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const model = {
    provider: runtime.provider || '',
    model_id: modelId,
  };

  if (!response.ok) {
    return {
      success: false,
      configured: true,
      message: `文本模型调用失败：${getErrorMessage(payload, response.status)}`,
      model,
      raw_response: payload,
    };
  }

  const text = payload?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') {
    return {
      success: false,
      configured: true,
      message: '文本模型调用失败：模型未返回有效文本。',
      model,
      raw_response: payload,
    };
  }

  return {
    success: true,
    configured: true,
    message: '文本模型生成完成',
    text,
    model,
    raw_response: payload,
  };
}

module.exports = {
  callTextModel,
};
```

- [ ] **Step 4: Run the adapter test**

Run:

```powershell
node test-ai-text-model.js
```

Expected: `ai text model tests passed`.

- [ ] **Step 5: Add the first test script entry**

Modify `package.json` scripts:

```json
"test:ai-text": "node test-ai-text-model.js"
```

Keep the existing scripts unchanged.

- [ ] **Step 6: Commit Task 1**

```powershell
git add package.json server/services/aiTextModel.js test-ai-text-model.js
git commit -m "添加文本模型调用服务"
```

## Task 2: Agent Run Service

**Files:**
- Create: `server/services/agentRuns.js`
- Create: `test-agent-runs.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing Agent service test**

Create `test-agent-runs.js`:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agentRuns = require('./server/services/agentRuns');
const mediaPipeline = require('./server/services/mediaPipeline');

async function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function run() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runs-test-'));
  const awemeId = '1234567890';
  const paths = mediaPipeline.getMediaPaths(awemeId, rootDir);

  const missing = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: { callTextModel: async () => ({ success: true, text: '{}' }) },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(missing.success, false);
  assert.strictEqual(missing.status, 'failed');
  assert.match(missing.message, /未找到该视频素材/);

  await writeJson(paths.metadata, {
    aweme_id: awemeId,
    title: '测试视频',
    author: { nickname: 'Tester' },
    statistics: { digg_count: 10, comment_count: 2 },
    aweme_url: `https://www.douyin.com/video/${awemeId}`,
  });
  fs.mkdirSync(paths.framesDir, { recursive: true });
  fs.writeFileSync(path.join(paths.framesDir, 'frame-0001.jpg'), 'fake');
  await writeJson(paths.analysisInput, {
    aweme_id: awemeId,
    video: { title: '测试视频', author: { nickname: 'Tester' }, statistics: { digg_count: 10 } },
    local_assets: { frames: [path.join(paths.framesDir, 'frame-0001.jpg')] },
    transcript: { status: 'done', path: paths.transcript },
    steps: {},
  });

  const noTranscript = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: { callTextModel: async () => ({ success: true, text: '{}' }) },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(noTranscript.success, false);
  assert.match(noTranscript.message, /未找到转写文本/);

  await writeJson(paths.transcript, {
    success: true,
    status: 'done',
    text: '这是一个关于本地创作工作流的视频。',
  });

  const generated = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        assert.match(messages[1].content, /测试视频/);
        assert.match(messages[1].content, /本地创作工作流/);
        return {
          success: true,
          model: { provider: 'OpenAI', model_id: 'gpt-test' },
          text: JSON.stringify({
            summary: '摘要',
            viral_points: ['开头明确'],
            audience: '创作者',
            comment_insights: ['评论关注效率'],
            topics: ['本地素材管理'],
            rewrite_script: '改写脚本',
            titles: ['标题一'],
          }),
        };
      },
    },
    getLocalComments: () => ({
      success: true,
      count: 1,
      data: [
        { content: '这个工具提升效率', like_count: 9, replies: [{ content: '同意', like_count: 1 }] },
      ],
    }),
  });

  assert.strictEqual(generated.success, true);
  assert.strictEqual(generated.status, 'done');
  assert.strictEqual(generated.result.summary, '摘要');
  assert.strictEqual(generated.input_summary.comment_count, 1);
  assert.strictEqual(generated.input_summary.has_transcript, true);
  assert.ok(generated.run_id.endsWith('-viral_rewrite'));
  assert.ok(fs.existsSync(generated.path));

  const listed = await agentRuns.listDouyinAgentRuns(awemeId, { rootDir });
  assert.strictEqual(listed.success, true);
  assert.strictEqual(listed.data.length, 1);
  assert.strictEqual(listed.data[0].run_id, generated.run_id);

  const detail = await agentRuns.getDouyinAgentRun(awemeId, generated.run_id, { rootDir });
  assert.strictEqual(detail.success, true);
  assert.strictEqual(detail.data.result.rewrite_script, '改写脚本');

  const raw = await agentRuns.createDouyinAgentRun(awemeId, {
    rootDir,
    template: 'viral_rewrite',
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        model: { provider: 'OpenAI', model_id: 'gpt-test' },
        text: '普通文本结果',
      }),
    },
    getLocalComments: () => ({ success: true, count: 0, data: [] }),
  });
  assert.strictEqual(raw.success, true);
  assert.strictEqual(raw.status, 'done');
  assert.strictEqual(raw.raw_text, '普通文本结果');
  assert.match(raw.message, /未能解析为结构化结果/);
}

run().then(() => {
  console.log('agent run tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run the failing Agent service test**

Run:

```powershell
node test-agent-runs.js
```

Expected: failure because `./server/services/agentRuns` does not exist.

- [ ] **Step 3: Implement `server/services/agentRuns.js`**

```js
const fsp = require('fs/promises');
const path = require('path');
const mediaPipeline = require('./mediaPipeline');
const aiTextModel = require('./aiTextModel');
const douyinStore = require('./douyinStore');

const TEMPLATE_VIRAL_REWRITE = 'viral_rewrite';

function createRunId(template = TEMPLATE_VIRAL_REWRITE) {
  const stamp = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  return `${stamp}-${template}`;
}

function getAgentRunsDir(awemeId, rootDir) {
  return path.join(mediaPipeline.getMediaDir(awemeId, rootDir), 'agent_runs');
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

async function writeJson(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function makeStep(id, label, status, message = '') {
  return { id, label, status, message };
}

function normalizeResult(parsed) {
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    viral_points: Array.isArray(parsed.viral_points) ? parsed.viral_points : [],
    audience: typeof parsed.audience === 'string' ? parsed.audience : '',
    comment_insights: Array.isArray(parsed.comment_insights) ? parsed.comment_insights : [],
    topics: Array.isArray(parsed.topics) ? parsed.topics : [],
    rewrite_script: typeof parsed.rewrite_script === 'string' ? parsed.rewrite_script : '',
    titles: Array.isArray(parsed.titles) ? parsed.titles : [],
  };
}

function parseModelText(text) {
  try {
    const parsed = JSON.parse(text);
    return { result: normalizeResult(parsed), rawText: '', parsed: true };
  } catch {
    return { result: normalizeResult({}), rawText: text || '', parsed: false };
  }
}

function summarizeComments(comments = []) {
  const parents = comments.slice(0, 30);
  const lines = [];
  for (const item of parents) {
    const likeText = Number(item.like_count || 0) > 0 ? `（${item.like_count}赞）` : '';
    if (item.content) lines.push(`- ${item.content}${likeText}`);
    for (const reply of (item.replies || []).slice(0, 3)) {
      if (reply.content) lines.push(`  - 回复：${reply.content}`);
    }
  }
  return lines.join('\n');
}

function buildPrompt({ analysisInput, transcript, commentsText, commentCount }) {
  const video = analysisInput.video || {};
  const statistics = video.statistics || {};
  const commentsNote = commentCount > 0
    ? `本地评论缓存共 ${commentCount} 条，以下是抽样评论：\n${commentsText}`
    : '未读取到本地评论缓存，评论洞察需要基于视频内容推断，并在结果中明确说明依据不足。';

  return [
    {
      role: 'system',
      content: [
        '你是 MuseDock 的受控内容创作 Agent。',
        '请只输出 JSON，不要输出 Markdown。',
        'JSON 字段必须包含 summary, viral_points, audience, comment_insights, topics, rewrite_script, titles。',
        'viral_points、comment_insights、topics、titles 必须是字符串数组。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '任务：爆款拆解 + 改写脚本。',
        `标题：${video.title || ''}`,
        `作者：${video.author?.nickname || ''}`,
        `链接：${video.aweme_url || ''}`,
        `统计：点赞 ${statistics.digg_count || statistics.liked_count || 0}，评论 ${statistics.comment_count || 0}，分享 ${statistics.share_count || 0}`,
        '',
        '转写文本：',
        transcript.text || '',
        '',
        '评论信息：',
        commentsNote,
      ].join('\n'),
    },
  ];
}

async function createFailureRun(awemeId, template, message, options = {}) {
  const runId = createRunId(template);
  const result = {
    success: false,
    run_id: runId,
    template,
    aweme_id: String(awemeId),
    status: 'failed',
    model: {},
    steps: options.steps || [],
    input_summary: options.input_summary || {},
    result: normalizeResult({}),
    raw_text: '',
    message,
    created_at: new Date().toISOString(),
  };
  if (options.persist !== false) {
    const filePath = path.join(getAgentRunsDir(awemeId, options.rootDir), `${runId}.json`);
    await writeJson(filePath, result);
    result.path = filePath;
  }
  return result;
}

async function createDouyinAgentRun(awemeId, options = {}) {
  const template = options.template || TEMPLATE_VIRAL_REWRITE;
  if (template !== TEMPLATE_VIRAL_REWRITE) {
    return createFailureRun(awemeId, template, '暂不支持该 Agent 模板。', {
      rootDir: options.rootDir,
      persist: false,
    });
  }

  const paths = mediaPipeline.getMediaPaths(awemeId, options.rootDir);
  const status = await mediaPipeline.getStatus(awemeId, { rootDir: options.rootDir });
  const steps = [makeStep('status', '检查素材状态', 'done')];
  if (!status.exists) {
    return createFailureRun(awemeId, template, '未找到该视频素材，请先进入素材工作台准备 AI 素材。', {
      rootDir: options.rootDir,
      steps,
      persist: false,
    });
  }

  const analysisInput = await readJsonIfExists(paths.analysisInput);
  steps.push(makeStep('analysis_input', '读取素材上下文', analysisInput ? 'done' : 'failed'));
  if (!analysisInput) {
    return createFailureRun(awemeId, template, '未找到素材上下文，请先重新准备 AI 素材。', {
      rootDir: options.rootDir,
      steps,
    });
  }

  const transcript = await readJsonIfExists(paths.transcript);
  steps.push(makeStep('transcript', '读取转写文本', transcript?.text ? 'done' : 'failed'));
  if (!transcript?.text) {
    return createFailureRun(awemeId, template, '未找到转写文本，请先完成 ASR 转写。', {
      rootDir: options.rootDir,
      steps,
    });
  }

  const getLocalComments = options.getLocalComments || douyinStore.getLocalDouyinComments;
  const commentsResult = getLocalComments(awemeId, { max: 80, maxReplies: 5 });
  const comments = Array.isArray(commentsResult?.data) ? commentsResult.data : [];
  steps.push(makeStep('comments', '读取评论缓存', 'done', comments.length ? `已读取 ${comments.length} 条评论` : '暂无本地评论缓存'));

  const messages = buildPrompt({
    analysisInput,
    transcript,
    commentsText: summarizeComments(comments),
    commentCount: comments.length,
  });

  steps.push(makeStep('generate', '生成分析结果', 'running'));
  const textModel = options.aiTextModel || aiTextModel;
  const modelResult = await textModel.callTextModel({
    messages,
    configPath: options.configPath,
    fetchImpl: options.fetchImpl,
    textConfig: options.textConfig,
  });
  steps[steps.length - 1] = makeStep('generate', '生成分析结果', modelResult.success ? 'done' : 'failed', modelResult.message || '');

  const runId = createRunId(template);
  const parsed = modelResult.success ? parseModelText(modelResult.text) : parseModelText('');
  const run = {
    success: !!modelResult.success,
    run_id: runId,
    template,
    aweme_id: String(awemeId),
    status: modelResult.success ? 'done' : 'failed',
    model: modelResult.model || {},
    steps,
    input_summary: {
      has_transcript: !!transcript.text,
      comment_count: comments.length,
      frame_count: analysisInput.local_assets?.frames?.length || status.frames?.length || 0,
    },
    result: parsed.result,
    raw_text: parsed.rawText,
    message: modelResult.success
      ? (parsed.parsed ? '生成完成' : '模型返回未能解析为结构化结果，已保留原始文本。')
      : (modelResult.message || 'Agent 执行失败'),
    created_at: new Date().toISOString(),
  };

  const filePath = path.join(getAgentRunsDir(awemeId, options.rootDir), `${runId}.json`);
  await writeJson(filePath, run);
  return { ...run, path: filePath };
}

async function listDouyinAgentRuns(awemeId, options = {}) {
  const dir = getAgentRunsDir(awemeId, options.rootDir);
  try {
    const names = await fsp.readdir(dir);
    const data = [];
    for (const name of names.filter(item => item.endsWith('.json')).sort().reverse()) {
      const item = await readJsonIfExists(path.join(dir, name));
      if (item) data.push(item);
    }
    return { success: true, aweme_id: String(awemeId), count: data.length, data };
  } catch {
    return { success: true, aweme_id: String(awemeId), count: 0, data: [] };
  }
}

async function getDouyinAgentRun(awemeId, runId, options = {}) {
  const filePath = path.join(getAgentRunsDir(awemeId, options.rootDir), `${runId}.json`);
  const data = await readJsonIfExists(filePath);
  if (!data) {
    return { success: false, aweme_id: String(awemeId), run_id: runId, message: '未找到该 Agent 运行记录。' };
  }
  return { success: true, aweme_id: String(awemeId), run_id: runId, data };
}

module.exports = {
  TEMPLATE_VIRAL_REWRITE,
  createDouyinAgentRun,
  listDouyinAgentRuns,
  getDouyinAgentRun,
  summarizeComments,
  buildPrompt,
};
```

- [ ] **Step 4: Run the Agent service test**

Run:

```powershell
node test-agent-runs.js
```

Expected: `agent run tests passed`.

- [ ] **Step 5: Add the Agent test script**

Modify `package.json` scripts:

```json
"test:agent": "node test-ai-text-model.js && node test-agent-runs.js"
```

- [ ] **Step 6: Commit Task 2**

```powershell
git add package.json server/services/agentRuns.js test-agent-runs.js
git commit -m "添加AI任务流Agent服务"
```

## Task 3: Agent API Routes

**Files:**
- Create: `server/routes/agents.js`
- Modify: `server/app.js`
- Modify: `frontend-react/src/api/client.js`

- [ ] **Step 1: Create the route module**

Create `server/routes/agents.js`:

```js
const express = require('express');
const agentRuns = require('../services/agentRuns');

const router = express.Router();

router.post('/douyin/:aweme_id/runs', async (req, res) => {
  try {
    const result = await agentRuns.createDouyinAgentRun(req.params.aweme_id, {
      template: req.body?.template || agentRuns.TEMPLATE_VIRAL_REWRITE,
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      status: 'failed',
      message: error.message,
    });
  }
});

router.get('/douyin/:aweme_id/runs', async (req, res) => {
  try {
    const result = await agentRuns.listDouyinAgentRuns(req.params.aweme_id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      message: error.message,
    });
  }
});

router.get('/douyin/:aweme_id/runs/:run_id', async (req, res) => {
  try {
    const result = await agentRuns.getDouyinAgentRun(req.params.aweme_id, req.params.run_id);
    return res.status(result.success ? 200 : 404).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: error.message,
    });
  }
});

module.exports = router;
```

- [ ] **Step 2: Mount routes in `server/app.js`**

Add this line with the other API routes:

```js
app.use('/api/agents', require('./routes/agents'));
```

- [ ] **Step 3: Add frontend API client methods**

Modify `frontend-react/src/api/client.js` inside `export const api = { ... }`:

```js
createDouyinAgentRun(awemeId, template = 'viral_rewrite') {
  return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template }),
  });
},
listDouyinAgentRuns(awemeId) {
  return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs`);
},
getDouyinAgentRun(awemeId, runId) {
  return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}`);
},
```

- [ ] **Step 4: Run syntax checks and backend tests**

Run:

```powershell
node --check server/routes/agents.js
node --check server/app.js
node test-ai-text-model.js
node test-agent-runs.js
```

Expected: syntax checks pass, both tests pass.

- [ ] **Step 5: Commit Task 3**

```powershell
git add frontend-react/src/api/client.js server/app.js server/routes/agents.js
git commit -m "添加Agent运行接口"
```

## Task 4: Frontend Agent Utilities

**Files:**
- Create: `frontend-react/src/utils/agentRuns.js`
- Create: `test-agent-run-utils.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the utility test**

Create `test-agent-run-utils.mjs`:

```js
import assert from 'assert';
import {
  getAgentResultSections,
  getAgentStepLabel,
  getRunDisplayTime,
} from './frontend-react/src/utils/agentRuns.js';

const sections = getAgentResultSections({
  summary: '摘要',
  viral_points: ['爆点一'],
  audience: '创作者',
  comment_insights: ['评论一'],
  topics: ['选题一'],
  rewrite_script: '脚本',
  titles: ['标题一'],
});

assert.deepStrictEqual(sections.map(item => item.title), [
  '内容摘要',
  '爆点拆解',
  '受众画像',
  '评论洞察',
  '可复用选题',
  '改写脚本',
  '标题建议',
]);
assert.strictEqual(sections[1].items[0], '爆点一');
assert.strictEqual(getAgentStepLabel('done'), '已完成');
assert.strictEqual(getAgentStepLabel('failed'), '失败');
assert.strictEqual(getAgentStepLabel('running'), '执行中');
assert.match(getRunDisplayTime('2026-06-07T15:30:12.000Z'), /2026/);

console.log('agent run utils tests passed');
```

- [ ] **Step 2: Run the failing utility test**

Run:

```powershell
node test-agent-run-utils.mjs
```

Expected: failure because `frontend-react/src/utils/agentRuns.js` does not exist.

- [ ] **Step 3: Implement utility helpers**

Create `frontend-react/src/utils/agentRuns.js`:

```js
function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function getAgentResultSections(result = {}) {
  return [
    { key: 'summary', title: '内容摘要', text: result.summary || '' },
    { key: 'viral_points', title: '爆点拆解', items: asArray(result.viral_points) },
    { key: 'audience', title: '受众画像', text: result.audience || '' },
    { key: 'comment_insights', title: '评论洞察', items: asArray(result.comment_insights) },
    { key: 'topics', title: '可复用选题', items: asArray(result.topics) },
    { key: 'rewrite_script', title: '改写脚本', text: result.rewrite_script || '' },
    { key: 'titles', title: '标题建议', items: asArray(result.titles) },
  ];
}

export function getAgentStepLabel(status) {
  const labels = {
    done: '已完成',
    failed: '失败',
    running: '执行中',
    pending: '等待中',
  };
  return labels[status] || '未知';
}

export function getRunDisplayTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}
```

- [ ] **Step 4: Run utility test**

Run:

```powershell
node test-agent-run-utils.mjs
```

Expected: `agent run utils tests passed`.

- [ ] **Step 5: Add utility test script**

Modify `package.json` scripts:

```json
"test:agent-utils": "node test-agent-run-utils.mjs"
```

- [ ] **Step 6: Commit Task 4**

```powershell
git add package.json frontend-react/src/utils/agentRuns.js test-agent-run-utils.mjs
git commit -m "添加Agent结果展示工具"
```

## Task 5: AI Workbench UI

**Files:**
- Modify: `frontend-react/src/pages/AiWorkspace.jsx`
- Modify: `frontend-react/src/styles.css`

- [ ] **Step 1: Replace `AiWorkspace.jsx` with task-flow UI**

Use this structure for `frontend-react/src/pages/AiWorkspace.jsx`:

```jsx
import { useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { Status } from '../components/Status.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { getAgentResultSections, getAgentStepLabel, getRunDisplayTime } from '../utils/agentRuns.js';

const TEMPLATE = 'viral_rewrite';

function ResultSection({ section }) {
  const hasItems = Array.isArray(section.items) && section.items.length > 0;
  const hasText = !!section.text;
  return (
    <article className="agentResultSection">
      <h4>{section.title}</h4>
      {hasItems ? (
        <ul>
          {section.items.map((item, index) => <li key={`${section.key}-${index}`}>{item}</li>)}
        </ul>
      ) : null}
      {hasText ? <p>{section.text}</p> : null}
      {!hasItems && !hasText ? <p className="mutedText">暂无内容</p> : null}
    </article>
  );
}

export function AiWorkspace() {
  const [awemeId, setAwemeId] = useState('');
  const [mediaStatus, setMediaStatus] = useState(null);
  const [runs, setRuns] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const resultSections = useMemo(() => getAgentResultSections(activeRun?.result || {}), [activeRun]);

  async function loadWorkspace() {
    const value = awemeId.trim();
    if (!value) {
      setStatus({ type: 'error', message: '请输入抖音视频 ID' });
      return;
    }
    setLoading(true);
    setStatus({ type: 'loading', message: '正在读取素材状态和历史 Agent 运行记录...' });
    try {
      const [mediaJson, runsJson] = await Promise.all([
        api.getDouyinMediaStatus(value),
        api.listDouyinAgentRuns(value),
      ]);
      setMediaStatus(mediaJson);
      setRuns(runsJson.data || []);
      setActiveRun((runsJson.data || [])[0] || null);
      setStatus({ type: 'success', message: `已加载素材 ${value}` });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function runAgent() {
    const value = awemeId.trim();
    if (!value) {
      setStatus({ type: 'error', message: '请输入抖音视频 ID' });
      return;
    }
    setRunning(true);
    setStatus({ type: 'loading', message: '正在执行爆款拆解 Agent，正在读取素材上下文并请求文本模型...' });
    try {
      const json = await api.createDouyinAgentRun(value, TEMPLATE);
      setActiveRun(json);
      const runsJson = await api.listDouyinAgentRuns(value);
      setRuns(runsJson.data || []);
      setStatus({ type: json.success ? 'success' : 'error', message: json.message || 'Agent 执行完成' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setRunning(false);
    }
  }

  function selectRun(run) {
    setActiveRun(run);
    setStatus({ type: 'info', message: `已切换到运行记录 ${run.run_id}` });
  }

  const transcriptReady = mediaStatus?.steps?.transcript?.status === 'done' || mediaStatus?.transcript?.status === 'done';
  const mediaReady = mediaStatus?.steps?.video?.status === 'done' && mediaStatus?.steps?.audio?.status === 'done';

  return (
    <main className="container">
      <div className="workspaceIntro">
        <div>
          <h2>AI 工作台</h2>
          <p>选择已准备的抖音素材，执行受控 Agent，生成爆款拆解、评论洞察和改写脚本。</p>
        </div>
        <div className="settingsSummary">
          <strong>{runs.length}</strong>
          <span>运行记录</span>
        </div>
      </div>

      <div className="toolbar">
        <Input
          value={awemeId}
          onChange={event => setAwemeId(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && loadWorkspace()}
          placeholder="输入抖音视频 ID"
        />
        <Button variant="secondary" disabled={loading || running} onClick={loadWorkspace}>
          {loading ? '加载中...' : '加载素材'}
        </Button>
        <Button disabled={loading || running || !awemeId.trim()} onClick={runAgent}>
          {running ? '执行中...' : '开始执行'}
        </Button>
      </div>

      <Status status={status} />
      {loading || running ? <div className="pageLoading">{running ? '正在执行 Agent，请不要重复点击...' : '正在加载素材上下文...'}</div> : null}

      <section className="agentWorkbench">
        <aside className="agentPanel">
          <h3>任务模板</h3>
          <div className="agentTemplate active">
            <strong>爆款拆解 + 改写脚本</strong>
            <span>读取转写、评论和素材状态，生成结构化创作结果。</span>
          </div>

          <h3>素材状态</h3>
          <div className="agentStatusList">
            <span>素材：{mediaReady ? '已准备' : '未确认'}</span>
            <span>转写：{transcriptReady ? '已完成' : '未完成'}</span>
            <span>视频 ID：{mediaStatus?.aweme_id || '-'}</span>
          </div>
        </aside>

        <section className="agentPanel agentStepsPanel">
          <h3>执行步骤</h3>
          {(activeRun?.steps || []).length ? (
            <div className="agentSteps">
              {activeRun.steps.map(step => (
                <div className={`agentStep ${step.status}`} key={step.id}>
                  <span>{step.label}</span>
                  <strong>{getAgentStepLabel(step.status)}</strong>
                  {step.message ? <em>{step.message}</em> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty small">加载素材后点击“开始执行”，这里会显示 Agent 执行过程</div>
          )}

          <h3>历史运行</h3>
          <div className="agentRunList">
            {runs.length === 0 ? <div className="empty small">暂无历史运行记录</div> : null}
            {runs.map(run => (
              <button
                type="button"
                className={`agentRunItem ${activeRun?.run_id === run.run_id ? 'active' : ''}`}
                key={run.run_id}
                onClick={() => selectRun(run)}
              >
                <strong>{run.template === TEMPLATE ? '爆款拆解' : run.template}</strong>
                <span>{getRunDisplayTime(run.created_at)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="agentPanel agentResultPanel">
          <h3>生成结果</h3>
          {activeRun ? (
            <>
              <div className="agentRunMeta">
                <span>{activeRun.message || 'Agent 运行记录'}</span>
                <span>{activeRun.model?.model_id || '未记录模型'}</span>
              </div>
              {resultSections.map(section => <ResultSection section={section} key={section.key} />)}
              {activeRun.raw_text ? (
                <article className="agentResultSection">
                  <h4>原始返回</h4>
                  <pre>{activeRun.raw_text}</pre>
                </article>
              ) : null}
            </>
          ) : (
            <div className="empty">暂无 Agent 结果</div>
          )}
        </section>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Add styles**

Append to `frontend-react/src/styles.css`:

```css
.agentWorkbench { display: grid; grid-template-columns: 260px minmax(260px, 360px) minmax(0, 1fr); gap: 16px; align-items: start; }
.agentPanel { background: #fff; border: 1px solid #e7e9ee; border-radius: 8px; padding: 16px; min-width: 0; }
.agentPanel h3 { margin: 0 0 12px; font-size: 15px; }
.agentPanel h3:not(:first-child) { margin-top: 20px; }
.agentTemplate { border: 1px solid #ffd6df; border-radius: 8px; background: #fff6f8; padding: 12px; }
.agentTemplate strong, .agentTemplate span { display: block; }
.agentTemplate strong { margin-bottom: 6px; color: #22252c; }
.agentTemplate span, .agentStatusList span, .agentRunItem span, .agentRunMeta span, .mutedText { color: #69717e; font-size: 13px; line-height: 1.6; }
.agentStatusList { display: grid; gap: 8px; }
.agentSteps { display: grid; gap: 10px; }
.agentStep { border: 1px solid #edf0f4; border-radius: 8px; padding: 10px; background: #fafbfc; }
.agentStep span, .agentStep strong, .agentStep em { display: block; }
.agentStep strong { margin-top: 4px; font-size: 12px; color: #69717e; }
.agentStep em { margin-top: 4px; color: #858d9a; font-size: 12px; font-style: normal; }
.agentStep.done { border-color: #c8e6d0; background: #f3fbf5; }
.agentStep.failed { border-color: #ffd2d2; background: #fff6f6; }
.agentStep.running { border-color: #dbeafe; background: #eff6ff; }
.agentRunList { display: grid; gap: 8px; }
.agentRunItem { width: 100%; border: 1px solid #edf0f4; border-radius: 8px; background: #fff; padding: 10px; text-align: left; cursor: pointer; }
.agentRunItem.active { border-color: #fe2c55; background: #fff6f8; }
.agentRunItem strong, .agentRunItem span { display: block; }
.agentResultPanel { display: grid; gap: 12px; }
.agentRunMeta { display: flex; justify-content: space-between; gap: 12px; border: 1px solid #edf0f4; border-radius: 8px; background: #fafbfc; padding: 10px 12px; }
.agentResultSection { border: 1px solid #edf0f4; border-radius: 8px; padding: 12px; background: #fff; }
.agentResultSection h4 { margin: 0 0 8px; font-size: 14px; }
.agentResultSection p { margin: 0; color: #30343b; line-height: 1.75; white-space: pre-wrap; }
.agentResultSection ul { margin: 0; padding-left: 18px; color: #30343b; line-height: 1.75; }
.agentResultSection pre { max-height: 260px; overflow: auto; margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 13px; line-height: 1.7; }
@media (max-width: 1100px) { .agentWorkbench { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Build frontend**

Run:

```powershell
npm run build:frontend
```

Expected: Vite build succeeds.

- [ ] **Step 4: Commit Task 5**

```powershell
git add frontend-react/src/pages/AiWorkspace.jsx frontend-react/src/styles.css
git commit -m "实现AI任务流工作台界面"
```

## Task 6: Unified Test Script and Documentation

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add the unified test script**

Modify `package.json` scripts:

```json
"test": "node test-ai-text-model.js && node test-agent-runs.js && node test-agent-run-utils.mjs && node test-media-pipeline.js && node test-media-pipeline-cache.js && node test-content-utils.mjs"
```

Do not include tests that require live browser login, platform network access, or a specific local SQLite ABI state.

- [ ] **Step 2: Update README feature list**

In `README.md` feature list, add:

```markdown
- **AI 任务流 Agent**：AI 工作台提供“爆款拆解 + 改写脚本”受控 Agent，读取本地素材、转写和评论缓存，生成结构化创作结果并保存到素材目录。
```

- [ ] **Step 3: Update README API list**

In `README.md` API overview, add:

```markdown
### AI Agent

- `POST /api/agents/douyin/:aweme_id/runs`：执行抖音素材的 Agent 任务。
- `GET /api/agents/douyin/:aweme_id/runs`：读取该素材的 Agent 运行记录。
- `GET /api/agents/douyin/:aweme_id/runs/:run_id`：读取单次 Agent 运行详情。
```

- [ ] **Step 4: Update README data files list**

In README data section, add:

```markdown
- `data/media/douyin/<aweme_id>/agent_runs/`：AI 任务流 Agent 的本地运行结果。
```

- [ ] **Step 5: Run full verification**

Run:

```powershell
npm test
npm run build:frontend
node --check server/app.js
node --check server/routes/agents.js
node --check server/services/aiTextModel.js
node --check server/services/agentRuns.js
```

Expected: all tests and syntax checks pass.

- [ ] **Step 6: Commit Task 6**

```powershell
git add README.md package.json package-lock.json
git commit -m "补充AI Agent测试和文档"
```

## Task 7: Manual Product Verification

**Files:**
- No planned file changes.

- [ ] **Step 1: Start the app**

Run:

```powershell
npm run build:frontend
npm run start
```

Expected: server starts at `http://localhost:3000`.

- [ ] **Step 2: Verify missing model configuration**

Open `http://localhost:3000/ai`, enter an `aweme_id` that has prepared media and transcript, click “开始执行”.

Expected when text model is disabled: UI shows a Chinese error telling the user to configure the text model in Settings.

- [ ] **Step 3: Verify successful run with configured text model**

Configure a valid OpenAI-compatible text model in Settings, return to AI 工作台, load the same `aweme_id`, click “开始执行”.

Expected:
- Button is disabled during execution.
- Loading text says Agent is reading context and requesting the text model.
- Steps show material status, transcript, comments, and generation.
- Result panel shows content summary, viral points, audience, comment insights, topics, rewrite script, and titles.
- `data/media/douyin/<aweme_id>/agent_runs/<run_id>.json` exists.

- [ ] **Step 4: Verify history reload**

Refresh the browser page, enter the same `aweme_id`, click “加载素材”.

Expected: previous Agent run appears in history and can be selected.

- [ ] **Step 5: Commit manual verification note if docs changed**

If manual verification reveals README wording that needs correction, update README and commit:

```powershell
git add README.md
git commit -m "完善AI Agent使用说明"
```

If no files changed, do not create an empty commit.

## Self-Review Checklist

- Spec coverage: backend text model, Agent run service, API routes, UI, persistence, errors, tests, and docs are covered.
- Scope check: first version implements one controlled template and does not add autonomous crawling, queueing, image generation, or free chat.
- Type consistency: template id is `viral_rewrite`; main functions are `callTextModel`, `createDouyinAgentRun`, `listDouyinAgentRuns`, and `getDouyinAgentRun`.
- Verification: plan includes focused Node tests, syntax checks, frontend build, and manual product verification.
