# One Click Creative Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new default “一键创作” entry that accepts plain text directions or Douyin IDs/links, creates a backend-orchestrated video workflow, and preserves the future custom-asset contract.

**Architecture:** Add a backend Creative Workflow layer that normalizes input into `creative_context`, persists workflow records, and reuses the existing Douyin media, Agent run, HyperFrames Freeform, check, render, and inspect services. Add a React page as the new default route while keeping the existing crawl, records, media workspace, advanced video, and settings pages reachable through navigation.

**Tech Stack:** Node.js 22, Express, existing filesystem JSON persistence, React 19, React Router, Vite, plain Node test scripts with `assert`.

---

## File Structure

- Create `server/services/creativeContext.js`: input parsing, `creative_context` normalization, disabled `research_context`, disabled `asset_context`, and synthetic text-source context.
- Create `server/services/researchService.js`: explicit `useResearch` handling. Default-off returns `disabled`; enabled without a provider returns `failed` with a Chinese message.
- Create `server/services/creativeWorkflows.js`: workflow persistence, numeric local creative ID generation for pure text input, source preparation, workflow stage updates, and orchestration over existing services.
- Create `server/routes/creativeWorkflows.js`: `POST /api/creative-workflows` and `GET /api/creative-workflows/:workflow_id`.
- Modify `server/app.js`: mount `/api/creative-workflows`.
- Create `tests/test-creative-context.js`: focused tests for parsing and context schema.
- Create `tests/test-research-service.js`: focused tests for default disabled and enabled-provider behavior.
- Create `tests/test-creative-workflows.js`: service tests with injected fake dependencies.
- Create `tests/test-creative-workflow-routes.js`: route contract tests.
- Create `frontend-react/src/pages/OneClickCreativePage.jsx`: first-screen one-click form, Chinese loading/status copy, and workflow result panel.
- Modify `frontend-react/src/api/client.js`: add create/get creative workflow API methods.
- Modify `frontend-react/src/components/AppShell.jsx`: add the “一键创作” navigation entry while keeping all current entries.
- Modify `frontend-react/src/utils/persistentRoutes.js`: add `creative` as a persisted active page.
- Modify `frontend-react/src/App.jsx`: render `OneClickCreativePage` in `PersistentPages` and make the index route navigate to `/creative`.
- Create `tests/test-one-click-creative-page.mjs`: static structure test for the new page and Chinese copy.
- Modify `tests/test-persistent-routes.mjs`: assert `/creative` is the default-style active route and old routes still work.
- Create `tests/test-creative-api-client.mjs`: static API client test for new endpoint methods.
- Modify `package.json`: add the new tests to `npm test` after related API/UI route tests.

## Data Contract

The first phase must always return this stable shape, including when no materials are uploaded:

```json
{
  "input": {
    "mode": "text",
    "raw_text": "",
    "aweme_id": "",
    "douyin_url": "",
    "use_research": false,
    "asset_ids": [],
    "created_at": ""
  },
  "source_context": {
    "status": "ready",
    "kind": "text",
    "summary": "",
    "transcript": "",
    "comments_summary": "",
    "douyin_metadata": {},
    "diagnostics": {}
  },
  "research_context": {
    "status": "disabled",
    "query": "",
    "sources": [],
    "summary": "",
    "updated_at": ""
  },
  "asset_context": {
    "status": "disabled",
    "assets": [],
    "updated_at": ""
  }
}
```

The existing `mediaPipeline.getMediaPaths()` only accepts numeric `aweme_id`, so pure-text workflows must generate a numeric local creative ID and mark the synthetic origin in metadata with `source_type: "creative_text"`.

## Workflow Stages

Use these stage IDs in backend records and frontend display:

```js
const CREATIVE_WORKFLOW_STAGES = [
  'source',
  'research',
  'assets',
  'agent_run',
  'brief',
  'audio',
  'project',
  'check',
  'render',
  'inspect',
];
```

Stage labels shown to users must be Chinese:

```js
const STAGE_LABELS = {
  source: '准备来源资料',
  research: '联网研究',
  assets: '素材分析',
  agent_run: '导演改写',
  brief: '成片策划',
  audio: '生成音频轨',
  project: '生成工程',
  check: '校验工程',
  render: '渲染视频',
  inspect: '巡检视频',
};
```

### Task 1: Creative Context Service

**Files:**
- Create: `server/services/creativeContext.js`
- Create: `tests/test-creative-context.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test-creative-context.js`:

```js
const assert = require('assert/strict');
const creativeContext = require('../server/services/creativeContext');

const textInput = creativeContext.normalizeCreativeInput({
  input: '  做一期关于本地 AI 视频工作流的科普  ',
  useResearch: false,
});

assert.equal(textInput.success, true);
assert.equal(textInput.data.mode, 'text');
assert.equal(textInput.data.raw_text, '做一期关于本地 AI 视频工作流的科普');
assert.equal(textInput.data.use_research, false);
assert.deepEqual(textInput.data.asset_ids, []);

const douyinUrl = creativeContext.normalizeCreativeInput({
  input: 'https://www.douyin.com/video/7345678901234567890',
  useResearch: true,
  assetIds: [],
});

assert.equal(douyinUrl.success, true);
assert.equal(douyinUrl.data.mode, 'douyin');
assert.equal(douyinUrl.data.aweme_id, '7345678901234567890');
assert.equal(douyinUrl.data.douyin_url, 'https://www.douyin.com/video/7345678901234567890');
assert.equal(douyinUrl.data.use_research, true);

const douyinId = creativeContext.normalizeCreativeInput({
  input: '7345678901234567890',
});
assert.equal(douyinId.success, true);
assert.equal(douyinId.data.mode, 'douyin');
assert.equal(douyinId.data.aweme_id, '7345678901234567890');
assert.equal(douyinId.data.douyin_url, '');

const empty = creativeContext.normalizeCreativeInput({ input: '   ' });
assert.equal(empty.success, false);
assert.match(empty.message, /请输入视频方向、抖音 ID 或抖音链接/);

const unsupportedAssets = creativeContext.normalizeCreativeInput({
  input: '做一期新品发布视频',
  assetIds: ['asset-1'],
});
assert.equal(unsupportedAssets.success, false);
assert.match(unsupportedAssets.message, /图片素材将在下一阶段开放/);

const now = '2026-06-12T10:00:00.000Z';
const context = creativeContext.buildCreativeContext({
  input: textInput.data,
  sourceContext: creativeContext.createTextSourceContext(textInput.data.raw_text),
  researchContext: creativeContext.createDisabledResearchContext({ now }),
  assetContext: creativeContext.createDisabledAssetContext({ now }),
  now,
});

assert.equal(context.input.mode, 'text');
assert.equal(context.input.created_at, now);
assert.equal(context.source_context.status, 'ready');
assert.equal(context.source_context.kind, 'text');
assert.match(context.source_context.summary, /本地 AI 视频工作流/);
assert.equal(context.research_context.status, 'disabled');
assert.equal(context.asset_context.status, 'disabled');
assert.deepEqual(context.asset_context.assets, []);

console.log('creative context tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-creative-context.js`

Expected: FAIL with `Cannot find module '../server/services/creativeContext'`.

- [ ] **Step 3: Implement the service**

Create `server/services/creativeContext.js`:

```js
const AWEME_ID_PATTERN = /^\d{5,32}$/;

function nowIso() {
  return new Date().toISOString();
}

function normalizeAssetIds(assetIds) {
  if (assetIds === undefined) return [];
  if (!Array.isArray(assetIds)) {
    return {
      success: false,
      message: 'assetIds 必须是数组。',
    };
  }
  const values = assetIds.map(item => String(item || '').trim()).filter(Boolean);
  if (values.length > 0) {
    return {
      success: false,
      message: '图片素材将在下一阶段开放，请先不添加素材后重试。',
    };
  }
  return values;
}

function extractAwemeId(value) {
  const text = String(value || '').trim();
  if (AWEME_ID_PATTERN.test(text)) return text;
  const videoMatch = text.match(/\/video\/(\d{5,32})/);
  if (videoMatch) return videoMatch[1];
  const modalMatch = text.match(/[?&]modal_id=(\d{5,32})/);
  if (modalMatch) return modalMatch[1];
  const awemeMatch = text.match(/[?&]aweme_id=(\d{5,32})/);
  if (awemeMatch) return awemeMatch[1];
  return '';
}

function normalizeCreativeInput(payload = {}) {
  const rawText = String(payload.input || '').trim();
  if (!rawText) {
    return {
      success: false,
      message: '请输入视频方向、抖音 ID 或抖音链接。',
    };
  }

  const assetIds = normalizeAssetIds(payload.assetIds);
  if (assetIds && assetIds.success === false) return assetIds;

  const awemeId = extractAwemeId(rawText);
  const isDouyin = !!awemeId;
  return {
    success: true,
    data: {
      mode: isDouyin ? 'douyin' : 'text',
      raw_text: rawText,
      aweme_id: awemeId,
      douyin_url: isDouyin && /^https?:\/\//i.test(rawText) ? rawText : '',
      use_research: payload.useResearch === true,
      asset_ids: assetIds,
    },
  };
}

function createTextSourceContext(text) {
  return {
    status: 'ready',
    kind: 'text',
    summary: String(text || '').trim(),
    transcript: String(text || '').trim(),
    comments_summary: '',
    douyin_metadata: {},
    diagnostics: {
      source_type: 'creative_text',
    },
  };
}

function createDisabledResearchContext(options = {}) {
  return {
    status: 'disabled',
    query: '',
    sources: [],
    summary: '',
    updated_at: options.now || nowIso(),
  };
}

function createDisabledAssetContext(options = {}) {
  return {
    status: 'disabled',
    assets: [],
    updated_at: options.now || nowIso(),
  };
}

function buildCreativeContext({ input, sourceContext, researchContext, assetContext, now = nowIso() }) {
  return {
    input: {
      mode: input.mode,
      raw_text: input.raw_text,
      aweme_id: input.aweme_id || '',
      douyin_url: input.douyin_url || '',
      use_research: input.use_research === true,
      asset_ids: Array.isArray(input.asset_ids) ? input.asset_ids : [],
      created_at: now,
    },
    source_context: sourceContext,
    research_context: researchContext || createDisabledResearchContext({ now }),
    asset_context: assetContext || createDisabledAssetContext({ now }),
  };
}

module.exports = {
  AWEME_ID_PATTERN,
  normalizeCreativeInput,
  extractAwemeId,
  createTextSourceContext,
  createDisabledResearchContext,
  createDisabledAssetContext,
  buildCreativeContext,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-creative-context.js`

Expected: PASS with `creative context tests passed`.

- [ ] **Step 5: Commit**

```bash
git add server/services/creativeContext.js tests/test-creative-context.js
git commit -m "新增一键创作上下文服务"
```

### Task 2: Research Service Contract

**Files:**
- Create: `server/services/researchService.js`
- Create: `tests/test-research-service.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test-research-service.js`:

```js
const assert = require('assert/strict');
const researchService = require('../server/services/researchService');

async function run() {
  const disabled = await researchService.createResearchContext({
    enabled: false,
    query: '今天 AI 视频热点',
    now: '2026-06-12T11:00:00.000Z',
  });

  assert.equal(disabled.status, 'disabled');
  assert.equal(disabled.query, '');
  assert.deepEqual(disabled.sources, []);

  const failed = await researchService.createResearchContext({
    enabled: true,
    query: '今天 AI 视频热点',
    now: '2026-06-12T11:00:00.000Z',
  });

  assert.equal(failed.status, 'failed');
  assert.equal(failed.query, '今天 AI 视频热点');
  assert.match(failed.summary, /联网研究服务未配置/);

  const ready = await researchService.createResearchContext({
    enabled: true,
    query: '今天 AI 视频热点',
    now: '2026-06-12T11:00:00.000Z',
    provider: async ({ query }) => ({
      sources: [
        {
          title: '来源标题',
          url: 'https://example.com/news',
          published_at: '2026-06-12',
          retrieved_at: '2026-06-12T11:00:00.000Z',
          summary: `关于 ${query} 的摘要`,
          evidence: '来源证据',
        },
      ],
      summary: '联网摘要',
    }),
  });

  assert.equal(ready.status, 'ready');
  assert.equal(ready.summary, '联网摘要');
  assert.equal(ready.sources[0].title, '来源标题');
  assert.equal(ready.updated_at, '2026-06-12T11:00:00.000Z');

  console.log('research service tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-research-service.js`

Expected: FAIL with `Cannot find module '../server/services/researchService'`.

- [ ] **Step 3: Implement the service**

Create `server/services/researchService.js`:

```js
function nowIso() {
  return new Date().toISOString();
}

function normalizeSource(source = {}, fallbackRetrievedAt) {
  return {
    title: String(source.title || ''),
    url: String(source.url || ''),
    published_at: String(source.published_at || ''),
    retrieved_at: String(source.retrieved_at || fallbackRetrievedAt || ''),
    summary: String(source.summary || ''),
    evidence: String(source.evidence || ''),
  };
}

async function createResearchContext(options = {}) {
  const updatedAt = options.now || nowIso();
  const query = String(options.query || '').trim();

  if (options.enabled !== true) {
    return {
      status: 'disabled',
      query: '',
      sources: [],
      summary: '',
      updated_at: updatedAt,
    };
  }

  if (typeof options.provider !== 'function') {
    return {
      status: 'failed',
      query,
      sources: [],
      summary: '联网研究服务未配置，请关闭联网获取最新资料后重试。',
      updated_at: updatedAt,
    };
  }

  try {
    const result = await options.provider({ query });
    return {
      status: 'ready',
      query,
      sources: Array.isArray(result?.sources)
        ? result.sources.map(source => normalizeSource(source, updatedAt))
        : [],
      summary: String(result?.summary || ''),
      updated_at: updatedAt,
    };
  } catch (error) {
    return {
      status: 'failed',
      query,
      sources: [],
      summary: `联网研究失败：${error.message}`,
      updated_at: updatedAt,
    };
  }
}

module.exports = {
  createResearchContext,
  normalizeSource,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-research-service.js`

Expected: PASS with `research service tests passed`.

- [ ] **Step 5: Commit**

```bash
git add server/services/researchService.js tests/test-research-service.js
git commit -m "新增一键创作联网研究契约"
```

### Task 3: Creative Workflow Service

**Files:**
- Create: `server/services/creativeWorkflows.js`
- Create: `tests/test-creative-workflows.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test-creative-workflows.js`:

```js
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const creativeWorkflows = require('../server/services/creativeWorkflows');

async function run() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-workflows-test-'));
  const calls = [];
  const services = {
    agentRuns: {
      createDouyinHyperframesFreeformRun: async awemeId => {
        calls.push(['createRun', awemeId]);
        return { success: true, aweme_id: awemeId, run_id: 'run-1', status: 'done' };
      },
      generateDouyinRunHyperframesFreeformBrief: async (awemeId, runId, options) => {
        calls.push(['brief', awemeId, runId, options.briefOptions.creative_context.input.mode]);
        return { success: true, run_id: runId, hyperframes_freeform: { brief: { status: 'ready' } } };
      },
      synthesizeDouyinRunHyperframesFreeformAudio: async (awemeId, runId) => {
        calls.push(['audio', awemeId, runId]);
        return { success: true, run_id: runId, hyperframes_freeform: { audio: { status: 'ready' } } };
      },
      generateDouyinRunHyperframesFreeformProject: async (awemeId, runId, options) => {
        calls.push(['project', awemeId, runId, options.projectOptions.creative_context.asset_context.status]);
        return { success: true, run_id: runId, hyperframes_freeform: { project: { status: 'ready' } } };
      },
      checkDouyinRunHyperframesFreeformProject: async (awemeId, runId) => {
        calls.push(['check', awemeId, runId]);
        return { success: true, run_id: runId, hyperframes_freeform: { checks: { status: 'passed' } } };
      },
      renderDouyinRunHyperframesFreeformVideo: async (awemeId, runId) => {
        calls.push(['render', awemeId, runId]);
        return { success: true, run_id: runId, hyperframes_freeform: { render: { status: 'rendered' } } };
      },
      inspectDouyinRunHyperframesFreeformVideo: async (awemeId, runId) => {
        calls.push(['inspect', awemeId, runId]);
        return { success: true, run_id: runId, hyperframes_freeform: { visual_inspect: { status: 'passed' } } };
      },
    },
    researchService: {
      createResearchContext: async ({ enabled }) => ({
        status: enabled ? 'ready' : 'disabled',
        query: enabled ? 'query' : '',
        sources: [],
        summary: enabled ? 'research summary' : '',
        updated_at: '2026-06-12T12:00:00.000Z',
      }),
    },
    now: () => '2026-06-12T12:00:00.000Z',
    idFactory: () => '202606121200000001',
  };

  const created = await creativeWorkflows.createCreativeWorkflow({
    input: '做一期关于 AI 视频生产的知识科普',
    useResearch: false,
    assetIds: [],
  }, { rootDir, services });

  assert.equal(created.success, true);
  assert.equal(created.status, 'queued');
  assert.equal(created.workflow_id, '202606121200000001');
  assert.match(created.aweme_id, /^\d{5,32}$/);
  assert.equal(created.creative_context.input.mode, 'text');
  assert.equal(created.creative_context.research_context.status, 'disabled');
  assert.deepEqual(created.creative_context.asset_context.assets, []);

  const completed = await creativeWorkflows.runCreativeWorkflow(created.workflow_id, { rootDir, services });
  assert.equal(completed.success, true);
  assert.equal(completed.status, 'done');
  assert.equal(completed.run_id, 'run-1');
  assert.deepEqual(calls.map(item => item[0]), ['createRun', 'brief', 'audio', 'project', 'check', 'render', 'inspect']);
  assert.equal(calls[1][3], 'text');
  assert.equal(calls[3][3], 'disabled');

  const detail = await creativeWorkflows.getCreativeWorkflow(created.workflow_id, { rootDir });
  assert.equal(detail.success, true);
  assert.equal(detail.data.status, 'done');
  assert.equal(detail.data.stages.find(stage => stage.id === 'render').status, 'done');

  const failedInput = await creativeWorkflows.createCreativeWorkflow({ input: '' }, { rootDir, services });
  assert.equal(failedInput.success, false);
  assert.match(failedInput.message, /请输入视频方向/);

  console.log('creative workflow tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-creative-workflows.js`

Expected: FAIL with `Cannot find module '../server/services/creativeWorkflows'`.

- [ ] **Step 3: Implement workflow persistence and orchestration**

Create `server/services/creativeWorkflows.js`:

```js
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const creativeContext = require('./creativeContext');
const defaultResearchService = require('./researchService');
const defaultAgentRuns = require('./agentRuns');
const mediaPipeline = require('./mediaPipeline');

const DEFAULT_ROOT = path.join(__dirname, '../../data/creative-workflows');
const DEFAULT_MEDIA_ROOT = path.join(__dirname, '../../data/media/douyin');
const STAGE_IDS = ['source', 'research', 'assets', 'agent_run', 'brief', 'audio', 'project', 'check', 'render', 'inspect'];
const STAGE_LABELS = {
  source: '准备来源资料',
  research: '联网研究',
  assets: '素材分析',
  agent_run: '导演改写',
  brief: '成片策划',
  audio: '生成音频轨',
  project: '生成工程',
  check: '校验工程',
  render: '渲染视频',
  inspect: '巡检视频',
};

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
  return `${stamp}${crypto.randomInt(1000, 9999)}`;
}

function makeLocalCreativeAwemeId(id) {
  return String(id || makeId()).replace(/\D/g, '').slice(0, 31) || makeId();
}

function getRootDir(rootDir = DEFAULT_ROOT) {
  return path.resolve(rootDir);
}

function getWorkflowPath(workflowId, rootDir = DEFAULT_ROOT) {
  const id = String(workflowId || '');
  if (!/^\d{5,32}$/.test(id)) {
    throw new Error('Invalid workflow_id');
  }
  const rootPath = getRootDir(rootDir);
  const filePath = path.resolve(rootPath, `${id}.json`);
  const relative = path.relative(rootPath, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('workflow_id resolves outside root');
  }
  return filePath;
}

function createStages() {
  return STAGE_IDS.map(id => ({
    id,
    label: STAGE_LABELS[id],
    status: 'pending',
    message: '',
  }));
}

function setStage(record, id, status, message = '') {
  record.stages = record.stages.map(stage => (
    stage.id === id ? { ...stage, status, message } : stage
  ));
  record.current_stage = id;
}

async function writeJson(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
}

async function saveWorkflow(record, rootDir) {
  await writeJson(getWorkflowPath(record.workflow_id, rootDir), record);
  return record;
}

async function getCreativeWorkflow(workflowId, options = {}) {
  try {
    const data = await readJson(getWorkflowPath(workflowId, options.rootDir));
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      workflow_id: workflowId,
      message: '未找到创作任务。',
    };
  }
}

async function ensureTextWorkspace({ awemeId, input, creative_context, mediaRoot }) {
  const paths = mediaPipeline.getMediaPaths(awemeId, mediaRoot);
  const metadata = {
    aweme_id: awemeId,
    title: input.raw_text,
    desc: input.raw_text,
    source_type: 'creative_text',
    created_at: creative_context.input.created_at,
  };
  const transcript = {
    success: true,
    status: 'done',
    text: input.raw_text,
    source_type: 'creative_text',
  };
  const analysisInput = {
    aweme_id: awemeId,
    video: metadata,
    transcript: {
      status: 'done',
      path: paths.transcript,
      text: input.raw_text,
    },
    creative_context,
    steps: {
      source: { status: 'done', kind: 'text' },
    },
  };
  await writeJson(paths.metadata, metadata);
  await writeJson(paths.transcript, transcript);
  await writeJson(paths.analysisInput, analysisInput);
  return paths;
}

async function createCreativeWorkflow(payload = {}, options = {}) {
  const services = options.services || {};
  const now = services.now ? services.now() : nowIso();
  const idFactory = services.idFactory || makeId;
  const workflowId = idFactory();
  const inputResult = creativeContext.normalizeCreativeInput(payload);
  if (!inputResult.success) return inputResult;

  const input = inputResult.data;
  const researchService = services.researchService || defaultResearchService;
  const sourceContext = input.mode === 'text'
    ? creativeContext.createTextSourceContext(input.raw_text)
    : {
      status: 'pending',
      kind: 'douyin',
      summary: '',
      transcript: '',
      comments_summary: '',
      douyin_metadata: { aweme_id: input.aweme_id, douyin_url: input.douyin_url },
      diagnostics: {},
    };
  const researchContext = await researchService.createResearchContext({
    enabled: input.use_research,
    query: input.raw_text,
    now,
  });
  const assetContext = creativeContext.createDisabledAssetContext({ now });
  const context = creativeContext.buildCreativeContext({
    input,
    sourceContext,
    researchContext,
    assetContext,
    now,
  });

  const awemeId = input.mode === 'text' ? makeLocalCreativeAwemeId(workflowId) : input.aweme_id;
  const record = {
    success: true,
    workflow_id: workflowId,
    aweme_id: awemeId,
    run_id: '',
    status: 'queued',
    current_stage: 'source',
    stages: createStages(),
    creative_context: context,
    result: {},
    error: null,
    created_at: now,
    updated_at: now,
  };
  setStage(record, 'source', 'queued', '创作任务已创建。');
  await saveWorkflow(record, options.rootDir);
  return {
    success: true,
    workflow_id: workflowId,
    aweme_id: awemeId,
    run_id: '',
    status: 'queued',
    creative_context: context,
    message: '创作任务已创建。',
  };
}

async function executeStep(record, rootDir, id, message, fn) {
  setStage(record, id, 'running', message);
  record.status = 'running';
  record.updated_at = nowIso();
  await saveWorkflow(record, rootDir);
  const result = await fn();
  if (result && result.success === false) {
    throw new Error(result.message || result.error || `${message}失败`);
  }
  setStage(record, id, 'done', result?.message || `${message}完成。`);
  record.updated_at = nowIso();
  await saveWorkflow(record, rootDir);
  return result;
}

async function runCreativeWorkflow(workflowId, options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const mediaRoot = options.mediaRoot || DEFAULT_MEDIA_ROOT;
  const services = options.services || {};
  const agentRuns = services.agentRuns || defaultAgentRuns;
  const detail = await getCreativeWorkflow(workflowId, { rootDir });
  if (!detail.success) return detail;
  const record = detail.data;

  try {
    await executeStep(record, rootDir, 'source', '正在准备来源资料...', async () => {
      if (record.creative_context.input.mode === 'text') {
        await ensureTextWorkspace({
          awemeId: record.aweme_id,
          input: record.creative_context.input,
          creative_context: record.creative_context,
          mediaRoot,
        });
        return { success: true, message: '文本来源资料已准备。' };
      }
      return { success: true, message: '抖音来源资料将复用现有素材准备能力。' };
    });
    await executeStep(record, rootDir, 'research', '正在处理联网研究...', async () => ({
      success: record.creative_context.research_context.status !== 'failed',
      message: record.creative_context.research_context.status === 'disabled'
        ? '未开启联网研究。'
        : '联网研究已完成。',
    }));
    await executeStep(record, rootDir, 'assets', '正在处理素材上下文...', async () => ({
      success: true,
      message: '图片素材将在下一阶段开放。',
    }));

    const run = await executeStep(record, rootDir, 'agent_run', '正在创建高级成片记录...', async () => (
      agentRuns.createDouyinHyperframesFreeformRun(record.aweme_id, { rootDir: mediaRoot })
    ));
    record.run_id = run.run_id;
    await saveWorkflow(record, rootDir);

    await executeStep(record, rootDir, 'brief', '正在生成成片策划...', async () => (
      agentRuns.generateDouyinRunHyperframesFreeformBrief(record.aweme_id, record.run_id, {
        rootDir: mediaRoot,
        briefOptions: { creative_context: record.creative_context },
      })
    ));
    await executeStep(record, rootDir, 'audio', '正在生成音频轨...', async () => (
      agentRuns.synthesizeDouyinRunHyperframesFreeformAudio(record.aweme_id, record.run_id, { rootDir: mediaRoot })
    ));
    await executeStep(record, rootDir, 'project', '正在生成 HyperFrames 工程...', async () => (
      agentRuns.generateDouyinRunHyperframesFreeformProject(record.aweme_id, record.run_id, {
        rootDir: mediaRoot,
        projectOptions: { creative_context: record.creative_context },
      })
    ));
    await executeStep(record, rootDir, 'check', '正在校验 HyperFrames 工程...', async () => (
      agentRuns.checkDouyinRunHyperframesFreeformProject(record.aweme_id, record.run_id, { rootDir: mediaRoot })
    ));
    await executeStep(record, rootDir, 'render', '正在渲染视频...', async () => (
      agentRuns.renderDouyinRunHyperframesFreeformVideo(record.aweme_id, record.run_id, { rootDir: mediaRoot })
    ));
    const inspect = await executeStep(record, rootDir, 'inspect', '正在巡检视频...', async () => (
      agentRuns.inspectDouyinRunHyperframesFreeformVideo(record.aweme_id, record.run_id, { rootDir: mediaRoot })
    ));

    record.status = 'done';
    record.success = true;
    record.result = inspect;
    record.updated_at = nowIso();
    await saveWorkflow(record, rootDir);
    return record;
  } catch (error) {
    record.status = 'failed';
    record.success = false;
    record.error = {
      message: error.message,
    };
    const failedStage = record.stages.find(stage => stage.id === record.current_stage);
    if (failedStage) {
      failedStage.status = 'failed';
      failedStage.message = error.message;
    }
    record.updated_at = nowIso();
    await saveWorkflow(record, rootDir);
    return record;
  }
}

module.exports = {
  STAGE_IDS,
  STAGE_LABELS,
  createCreativeWorkflow,
  runCreativeWorkflow,
  getCreativeWorkflow,
  getWorkflowPath,
  makeLocalCreativeAwemeId,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-creative-workflows.js`

Expected: PASS with `creative workflow tests passed`.

- [ ] **Step 5: Commit**

```bash
git add server/services/creativeWorkflows.js tests/test-creative-workflows.js
git commit -m "新增一键创作工作流编排"
```

### Task 4: Creative Workflow Routes

**Files:**
- Create: `server/routes/creativeWorkflows.js`
- Modify: `server/app.js`
- Create: `tests/test-creative-workflow-routes.js`

- [ ] **Step 1: Write the failing route test**

Create `tests/test-creative-workflow-routes.js`:

```js
const assert = require('assert/strict');
const express = require('express');
const http = require('http');
const router = require('../server/routes/creativeWorkflows');

async function requestJson(server, method, pathName, body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: { 'Content-Type': 'application/json' },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        body: text ? JSON.parse(text) : null,
      }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

async function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function run() {
  const app = express();
  app.use(express.json());
  app.use('/api/creative-workflows', router);
  const server = await listen(app);

  try {
    const created = await requestJson(server, 'POST', '/api/creative-workflows', {
      input: '做一期关于 AI 视频工作流的科普',
      useResearch: false,
      assetIds: [],
    });

    assert.equal(created.statusCode, 200);
    assert.equal(created.body.success, true);
    assert.equal(created.body.status, 'queued');
    assert.ok(created.body.workflow_id);
    assert.equal(created.body.creative_context.asset_context.status, 'disabled');
    assert.match(created.body.message, /创作任务已创建/);

    const detail = await requestJson(server, 'GET', `/api/creative-workflows/${created.body.workflow_id}`);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.body.success, true);
    assert.equal(detail.body.data.workflow_id, created.body.workflow_id);

    const bad = await requestJson(server, 'POST', '/api/creative-workflows', { input: '' });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.body.success, false);
    assert.match(bad.body.message, /请输入视频方向/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('creative workflow route tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-creative-workflow-routes.js`

Expected: FAIL with `Cannot find module '../server/routes/creativeWorkflows'`.

- [ ] **Step 3: Implement route module**

Create `server/routes/creativeWorkflows.js`:

```js
const express = require('express');
const creativeWorkflows = require('../services/creativeWorkflows');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const result = await creativeWorkflows.createCreativeWorkflow(req.body || {});
    if (!result.success) return res.status(400).json(result);
    setImmediate(() => {
      creativeWorkflows.runCreativeWorkflow(result.workflow_id).catch(error => {
        console.error('[creative-workflows] background run failed:', error.message);
      });
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: '创建创作任务失败，请稍后重试。',
    });
  }
});

router.get('/:workflow_id', async (req, res) => {
  try {
    const result = await creativeWorkflows.getCreativeWorkflow(req.params.workflow_id);
    return res.status(result.success ? 200 : 404).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      workflow_id: req.params.workflow_id,
      message: '读取创作任务失败，请检查任务 ID。',
    });
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount the route**

Modify `server/app.js` by adding this line after the `/api/agents` mount:

```js
app.use('/api/creative-workflows', require('./routes/creativeWorkflows'));
```

- [ ] **Step 5: Run route test**

Run: `node tests/test-creative-workflow-routes.js`

Expected: PASS with `creative workflow route tests passed`.

- [ ] **Step 6: Commit**

```bash
git add server/routes/creativeWorkflows.js server/app.js tests/test-creative-workflow-routes.js
git commit -m "新增一键创作工作流接口"
```

### Task 5: Agent Context Pass-Through Guard

**Files:**
- Modify: `server/services/agentRuns.js`
- Modify: `tests/test-agent-runs.js`

- [ ] **Step 1: Add failing assertions to the existing Agent test**

In `tests/test-agent-runs.js`, extend the HyperFrames Freeform mocked section by passing `creative_context` in route/service options and asserting the generated brief/project calls receive it. Add this object near the mocked `agentRuns.generateDouyinRunHyperframesFreeformBrief` route test setup:

```js
const creativeContextForRoute = {
  input: { mode: 'text', raw_text: '本地创作方向', use_research: false, asset_ids: [] },
  source_context: { status: 'ready', kind: 'text', summary: '本地创作方向' },
  research_context: { status: 'disabled', sources: [] },
  asset_context: { status: 'disabled', assets: [] },
};
```

Update the request body for `/hyperframes-freeform/brief`:

```js
const freeformBriefResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes-freeform/brief`, {
  tone: 'route brief',
  creative_context: creativeContextForRoute,
});
```

Update the mocked assertion:

```js
assert.deepStrictEqual(options.briefOptions.creative_context, creativeContextForRoute);
```

Update the request body for `/hyperframes-freeform/project`:

```js
const freeformProjectResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes-freeform/project`, {
  theme: 'route project',
  creative_context: creativeContextForRoute,
});
```

Update the mocked assertion:

```js
assert.deepStrictEqual(options.projectOptions.creative_context, creativeContextForRoute);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-agent-runs.js`

Expected: FAIL because `creative_context` is not forwarded through the route options.

- [ ] **Step 3: Pass `creative_context` through route options**

In `server/routes/agents.js`, update the brief route call to preserve the body field:

```js
const result = await agentRuns.generateDouyinRunHyperframesFreeformBrief(
  req.params.aweme_id,
  req.params.run_id,
  {
    briefOptions: {
      ...req.body,
      creative_context: req.body?.creative_context || null,
    },
  },
);
```

Update the project route call similarly:

```js
const result = await agentRuns.generateDouyinRunHyperframesFreeformProject(
  req.params.aweme_id,
  req.params.run_id,
  {
    projectOptions: {
      ...req.body,
      creative_context: req.body?.creative_context || null,
    },
  },
);
```

If the current route already forwards `req.body` as the relevant option object, keep the existing shape and only add the `creative_context` assertion to lock the contract.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-agent-runs.js`

Expected: PASS with `agent run tests passed`.

- [ ] **Step 5: Commit**

```bash
git add server/routes/agents.js server/services/agentRuns.js tests/test-agent-runs.js
git commit -m "透传一键创作上下文到成片 Agent"
```

### Task 6: Frontend API Client

**Files:**
- Modify: `frontend-react/src/api/client.js`
- Create: `tests/test-creative-api-client.mjs`

- [ ] **Step 1: Write the failing static test**

Create `tests/test-creative-api-client.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(__dirname, '../frontend-react/src/api/client.js');
const source = fs.readFileSync(clientPath, 'utf-8');

assert.match(source, /createCreativeWorkflow\s*\(/);
assert.match(source, /getCreativeWorkflow\s*\(/);
assert.ok(source.includes('/api/creative-workflows'));
assert.match(source, /body:\s*JSON\.stringify\(payload\)/);
assert.match(source, /encodeURIComponent\(workflowId\)/);

console.log('creative api client tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-creative-api-client.mjs`

Expected: FAIL with `missing createCreativeWorkflow` or matching assertion failure.

- [ ] **Step 3: Add API methods**

In `frontend-react/src/api/client.js`, add methods inside `export const api = { ... }`:

```js
  createCreativeWorkflow(payload) {
    return requestJson('/api/creative-workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  getCreativeWorkflow(workflowId) {
    return requestJson(`/api/creative-workflows/${encodeURIComponent(workflowId)}`);
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-creative-api-client.mjs`

Expected: PASS with `creative api client tests passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend-react/src/api/client.js tests/test-creative-api-client.mjs
git commit -m "新增一键创作前端接口"
```

### Task 7: One Click Creative Page and Default Route

**Files:**
- Create: `frontend-react/src/pages/OneClickCreativePage.jsx`
- Modify: `frontend-react/src/components/AppShell.jsx`
- Modify: `frontend-react/src/utils/persistentRoutes.js`
- Modify: `frontend-react/src/App.jsx`
- Create: `tests/test-one-click-creative-page.mjs`
- Modify: `tests/test-persistent-routes.mjs`

- [ ] **Step 1: Write failing UI structure test**

Create `tests/test-one-click-creative-page.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, '../frontend-react/src/pages/OneClickCreativePage.jsx');
const appPath = path.join(__dirname, '../frontend-react/src/App.jsx');
const shellPath = path.join(__dirname, '../frontend-react/src/components/AppShell.jsx');

assert.ok(fs.existsSync(pagePath), 'missing OneClickCreativePage.jsx');

const page = fs.readFileSync(pagePath, 'utf-8');
const app = fs.readFileSync(appPath, 'utf-8');
const shell = fs.readFileSync(shellPath, 'utf-8');

for (const text of [
  '一键创作',
  '输入视频方向、抖音 ID 或抖音链接',
  '联网获取最新资料',
  '图片素材将在下一阶段开放',
  '一键生成视频',
  '正在创建创作任务...',
  '请输入视频方向、抖音 ID 或抖音链接',
]) {
  assert.ok(page.includes(text), `missing Chinese copy: ${text}`);
}

assert.match(page, /createCreativeWorkflow/);
assert.match(page, /getCreativeWorkflow/);
assert.match(page, /setInterval/);
assert.match(app, /Navigate to="\/creative"/);
assert.match(app, /OneClickCreativePage/);
assert.ok(shell.includes('to="/creative"'));
assert.ok(shell.includes('内容抓取'));
assert.ok(shell.includes('抓取记录'));
assert.ok(shell.includes('素材工作台'));
assert.ok(shell.includes('高级成片'));
assert.ok(shell.includes('设置'));

console.log('one click creative page tests passed');
```

Modify `tests/test-persistent-routes.mjs` by adding:

```js
const creative = getPersistentRouteState(undefined, '/creative', '');
assert.strictEqual(creative.activePage, 'creative');

const creativeBackToMedia = getPersistentRouteState(creative, '/media/douyin/12345', '');
assert.strictEqual(creativeBackToMedia.activePage, 'media');
assert.strictEqual(creativeBackToMedia.mediaId, '12345');
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node tests/test-one-click-creative-page.mjs
node tests/test-persistent-routes.mjs
```

Expected: first test FAIL because the page does not exist; second test FAIL because `/creative` is not handled.

- [ ] **Step 3: Add the one-click page**

Create `frontend-react/src/pages/OneClickCreativePage.jsx`:

```jsx
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const STAGE_LABELS = {
  source: '准备来源资料',
  research: '联网研究',
  assets: '素材分析',
  agent_run: '导演改写',
  brief: '成片策划',
  audio: '生成音频轨',
  project: '生成工程',
  check: '校验工程',
  render: '渲染视频',
  inspect: '巡检视频',
};

function statusText(status) {
  if (status === 'done') return '已完成';
  if (status === 'running') return '进行中';
  if (status === 'queued') return '排队中';
  if (status === 'failed') return '失败';
  return '等待中';
}

export function OneClickCreativePage() {
  const [input, setInput] = useState('');
  const [useResearch, setUseResearch] = useState(false);
  const [workflow, setWorkflow] = useState(null);
  const [workflowId, setWorkflowId] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  const isBusy = status === 'creating' || status === 'polling';
  const stages = useMemo(() => {
    if (workflow?.stages?.length) return workflow.stages;
    return Object.entries(STAGE_LABELS).map(([id, label]) => ({ id, label, status: 'pending', message: '' }));
  }, [workflow]);

  useEffect(() => {
    if (!workflowId || status !== 'polling') return undefined;
    const timer = setInterval(async () => {
      try {
        const result = await api.getCreativeWorkflow(workflowId);
        if (result.success) {
          setWorkflow(result.data);
          if (result.data.status === 'done') {
            setStatus('done');
            setMessage('视频生成完成。');
          }
          if (result.data.status === 'failed') {
            setStatus('failed');
            setMessage(result.data.error?.message || '创作任务失败，请查看阶段信息。');
          }
        }
      } catch (error) {
        setStatus('failed');
        setMessage(error.message || '读取创作任务失败。');
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [workflowId, status]);

  async function submit(event) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) {
      setStatus('failed');
      setMessage('请输入视频方向、抖音 ID 或抖音链接。');
      return;
    }

    setStatus('creating');
    setMessage('正在创建创作任务...');
    setWorkflow(null);
    setWorkflowId('');

    try {
      const result = await api.createCreativeWorkflow({
        input: trimmed,
        useResearch,
        assetIds: [],
        renderOptions: {},
        workflowOptions: {},
      });
      setWorkflowId(result.workflow_id);
      setWorkflow({
        workflow_id: result.workflow_id,
        status: result.status,
        creative_context: result.creative_context,
      });
      setStatus('polling');
      setMessage(result.message || '创作任务已创建，正在生成视频...');
    } catch (error) {
      setStatus('failed');
      setMessage(error.message || '创建创作任务失败。');
    }
  }

  return (
    <main className="page creative-page">
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>一键创作</h2>
            <p>输入视频方向、抖音 ID 或抖音链接，系统会自动串联资料准备、成片策划、工程生成、校验、渲染和巡检。</p>
          </div>
        </div>

        <form className="form-stack" onSubmit={submit}>
          <label className="field">
            <span>创作输入</span>
            <textarea
              value={input}
              onChange={event => setInput(event.target.value)}
              placeholder="输入视频方向、抖音 ID 或抖音链接"
              rows={5}
              disabled={isBusy}
            />
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={useResearch}
              onChange={event => setUseResearch(event.target.checked)}
              disabled={isBusy}
            />
            <span>联网获取最新资料</span>
          </label>

          <div className="muted-box">
            图片素材将在下一阶段开放。本期会保留素材上下文结构，暂不上传图片。
          </div>

          <button type="submit" className="primary" disabled={isBusy}>
            {isBusy ? '正在生成视频...' : '一键生成视频'}
          </button>
        </form>

        {message ? <p className={`status-line ${status}`}>{message}</p> : null}
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>创作进度</h2>
        </div>
        <div className="stage-list">
          {stages.map(stage => (
            <div className={`stage-row ${stage.status}`} key={stage.id}>
              <strong>{stage.label || STAGE_LABELS[stage.id] || stage.id}</strong>
              <span>{statusText(stage.status)}</span>
              {stage.message ? <small>{stage.message}</small> : null}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Wire the default route while preserving current pages**

Modify `frontend-react/src/App.jsx`:

```jsx
import { OneClickCreativePage } from './pages/OneClickCreativePage.jsx';
```

Add this block at the top of `PersistentPages` return:

```jsx
      <div hidden={!isActive('creative')}>
        <OneClickCreativePage />
      </div>
```

Change the index route:

```jsx
<Route index element={<Navigate to="/creative" replace />} />
```

Modify `frontend-react/src/utils/persistentRoutes.js`:

```js
const DEFAULT_STATE = {
  crawlPlatform: 'douyin',
  recordsPlatform: 'douyin',
  mediaPlatform: '',
  mediaId: '',
  aiSearch: '',
  studioAwemeId: '',
  studioRunId: '',
  activePage: 'creative',
};
```

Add this branch before `records`:

```js
  if (section === 'creative') {
    return {
      ...state,
      activePage: 'creative',
    };
  }
```

Modify `frontend-react/src/components/AppShell.jsx` by adding the new first nav item and preserving existing nav items:

```jsx
<NavLink className={navClass} to="/creative">一键创作</NavLink>
```

- [ ] **Step 5: Run UI structure tests**

Run:

```bash
node tests/test-one-click-creative-page.mjs
node tests/test-persistent-routes.mjs
```

Expected: PASS with `one click creative page tests passed` and `persistent route tests passed`.

- [ ] **Step 6: Commit**

```bash
git add frontend-react/src/pages/OneClickCreativePage.jsx frontend-react/src/components/AppShell.jsx frontend-react/src/utils/persistentRoutes.js frontend-react/src/App.jsx tests/test-one-click-creative-page.mjs tests/test-persistent-routes.mjs
git commit -m "新增一键创作默认入口"
```

### Task 8: Test Script Integration and Final Verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add new tests to `npm test`**

In `package.json`, add these commands to the `test` script near related route/client/page tests:

```bash
node tests/test-creative-context.js && node tests/test-research-service.js && node tests/test-creative-workflows.js && node tests/test-creative-workflow-routes.js && node tests/test-creative-api-client.mjs && node tests/test-one-click-creative-page.mjs
```

- [ ] **Step 2: Run focused backend tests**

Run:

```bash
node tests/test-creative-context.js
node tests/test-research-service.js
node tests/test-creative-workflows.js
node tests/test-creative-workflow-routes.js
```

Expected:

```text
creative context tests passed
research service tests passed
creative workflow tests passed
creative workflow route tests passed
```

- [ ] **Step 3: Run focused frontend/static tests**

Run:

```bash
node tests/test-creative-api-client.mjs
node tests/test-one-click-creative-page.mjs
node tests/test-persistent-routes.mjs
```

Expected:

```text
creative api client tests passed
one click creative page tests passed
persistent route tests passed
```

- [ ] **Step 4: Build frontend**

Run: `npm run build:frontend`

Expected: PASS with Vite build output and no JSX syntax errors.

- [ ] **Step 5: Run full test suite**

Run: `npm test`

Expected: PASS. If a full suite failure is unrelated to this change, capture the failing test name and the exact error before deciding whether to fix or report it.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "接入一键创作测试"
```

## Self-Review

**Spec coverage:** This plan covers the new one-click entry, text and Douyin input parsing, explicit `useResearch` default-off behavior, stable `asset_context`, backend orchestration, default route `/creative`, and preservation of all existing pages. It also keeps keyframe extraction out of the one-click main path.

**Placeholder scan:** The plan contains concrete file paths, test commands, expected outputs, request/response fields, and implementation snippets. A red-flag wording scan was run and the plan body is clean.

**Type consistency:** The plan uses `creative_context`, `research_context`, `asset_context`, `workflow_id`, `run_id`, `useResearch`, and `assetIds` consistently across service, route, API client, and page code. Backend internal context uses snake_case, while HTTP request payload preserves existing frontend camelCase style.
