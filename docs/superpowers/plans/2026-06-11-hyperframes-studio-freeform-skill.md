# HyperFrames Studio Freeform Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new componentized "高级成片" page that generates freeform HyperFrames projects from skill context, validates/renders them, and keeps the existing template video flow intact.

**Architecture:** Add a separate freeform HyperFrames pipeline beside the existing `ai_storyboard_cards` pipeline. Backend services own skill-context loading, project file creation, checks, render orchestration, and run JSON state. Frontend uses a route-level page with small components and a dedicated hook; `HyperframesStudioPage.jsx` must only coordinate route params and layout, not contain workflow logic.

**Tech Stack:** Node.js 22, Express, React 19, React Router 7, Vite, HyperFrames CLI through `npx hyperframes`, ffmpeg/ffprobe via system path or existing installed binaries, Node built-in test style with `assert`.

---

## File Structure

Create backend services:

- `server/services/hyperframesSkillContext.js`: resolve allowed skill source directories, read selected skill files, produce compact prompt context, and copy a skill snapshot into each freeform project.
- `server/services/hyperframesFreeformProject.js`: create `<run_id>-hyperframes-freeform`, write/read whitelisted files, build file URLs, and prevent path traversal.
- `server/services/hyperframesFreeformAgent.js`: build messages for brief/project generation and parse generated files from model output.
- `server/services/hyperframesFreeformQuality.js`: run `hyperframes lint`, `hyperframes validate`, `hyperframes inspect`, extract frames every 0.3s, and create a contact sheet.

Modify backend entry points:

- `server/services/agentRuns.js`: add freeform orchestration methods and run JSON state updates.
- `server/routes/agents.js`: add `/hyperframes-freeform/*` endpoints.
- `server/services/hyperframesRenderer.js`: expose reusable check command helper if needed, but keep render behavior backward compatible.

Create frontend state and components:

- `frontend-react/src/pages/HyperframesStudioPage.jsx`: route-level shell only. It reads route/search params, calls the hook, and lays out components.
- `frontend-react/src/hooks/useHyperframesStudio.js`: owns selected `awemeId`, `runId`, loading states, API calls, run refresh, and derived button disabled states.
- `frontend-react/src/components/hyperframes-studio/StudioSidebar.jsx`: input controls and workflow buttons.
- `frontend-react/src/components/hyperframes-studio/DirectorPanel.jsx`: brief, storyboard, narration, and `design.md` display/edit surface.
- `frontend-react/src/components/hyperframes-studio/ProjectPanel.jsx`: generated file list, selected file preview/edit, save button, and check results.
- `frontend-react/src/components/hyperframes-studio/RenderPreview.jsx`: video preview, contact sheet, download/open links.
- `frontend-react/src/components/hyperframes-studio/StudioStatus.jsx`: shared status strip for loading/success/error messages.

Modify frontend infrastructure:

- `frontend-react/src/App.jsx`: add persistent page slot for `hyperframes-studio`.
- `frontend-react/src/components/AppShell.jsx`: add `高级成片` navigation.
- `frontend-react/src/utils/persistentRoutes.js`: persist studio route params.
- `frontend-react/src/api/client.js`: add freeform API methods.
- `frontend-react/src/pages/AiWorkspace.jsx`: add a small "打开高级成片工作台" link/button for active runs. Do not move existing workflow logic.
- `frontend-react/src/styles.css`: add scoped `.hyperframesStudio*` styles and component classes.

Create tests:

- `tests/test-hyperframes-skill-context.js`
- `tests/test-hyperframes-freeform-project.js`
- `tests/test-hyperframes-freeform-quality.js`
- Extend `tests/test-agent-runs.js`
- Extend `tests/test-persistent-routes.mjs`
- Add `tests/test-hyperframes-studio-page.mjs` for static component-boundary assertions.

## Task 1: Backend Freeform State Helpers

**Files:**
- Modify: `server/services/agentRuns.js`
- Test: `tests/test-agent-runs.js`

- [ ] **Step 1: Write failing tests for initial freeform state**

Append assertions near existing HyperFrames project tests in `tests/test-agent-runs.js`:

```js
  const initialFreeform = await agentRuns.getDouyinRunHyperframesFreeformState(awemeId, generated.run_id, { rootDir });
  assert.equal(initialFreeform.success, true);
  assert.equal(initialFreeform.hyperframes_freeform.mode, 'builtin_skill_context');
  assert.equal(initialFreeform.hyperframes_freeform.status, 'idle');
  assert.equal(initialFreeform.hyperframes_freeform.brief.status, 'idle');
  assert.equal(initialFreeform.hyperframes_freeform.project.status, 'idle');
  assert.equal(initialFreeform.hyperframes_freeform.checks.status, 'idle');
  assert.equal(initialFreeform.hyperframes_freeform.render.status, 'idle');
  assert.equal(initialFreeform.hyperframes_freeform.visual_inspect.status, 'idle');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-agent-runs.js
```

Expected: fail with `agentRuns.getDouyinRunHyperframesFreeformState is not a function`.

- [ ] **Step 3: Implement freeform default state and getter**

In `server/services/agentRuns.js`, add:

```js
function createDefaultHyperframesFreeformState(overrides = {}) {
  return {
    mode: 'builtin_skill_context',
    agent_runtime: null,
    status: 'idle',
    project_dir: '',
    brief: {
      status: 'idle',
      design_path: '',
      summary: '',
      message: '',
    },
    project: {
      status: 'idle',
      index_path: '',
      files: [],
      message: '',
    },
    checks: {
      status: 'idle',
      lint: 'pending',
      validate: 'pending',
      inspect: 'pending',
      message: '',
    },
    render: {
      status: 'idle',
      output_path: '',
      output_url: '',
      message: '',
    },
    visual_inspect: {
      status: 'idle',
      contact_sheet_path: '',
      contact_sheet_url: '',
      issues: [],
      message: '',
    },
    ...overrides,
  };
}

function normalizeHyperframesFreeformState(value = {}) {
  const current = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const defaults = createDefaultHyperframesFreeformState();
  return {
    ...defaults,
    ...current,
    brief: { ...defaults.brief, ...(current.brief || {}) },
    project: { ...defaults.project, ...(current.project || {}) },
    checks: { ...defaults.checks, ...(current.checks || {}) },
    render: { ...defaults.render, ...(current.render || {}) },
    visual_inspect: { ...defaults.visual_inspect, ...(current.visual_inspect || {}) },
  };
}
```

Add exported async getter:

```js
async function getDouyinRunHyperframesFreeformState(awemeId, runId, options = {}) {
  const detail = await getDouyinAgentRun(awemeId, runId, options);
  if (!detail.success) return detail;
  return {
    success: true,
    aweme_id: awemeId,
    run_id: runId,
    hyperframes_freeform: normalizeHyperframesFreeformState(detail.data.hyperframes_freeform),
  };
}
```

Export all three helpers.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node tests/test-agent-runs.js
```

Expected: pass through the new assertions or fail later on unrelated pre-existing assertions.

- [ ] **Step 5: Commit**

```bash
git add server/services/agentRuns.js tests/test-agent-runs.js
git commit -m "新增自由 HyperFrames 状态结构"
```

## Task 2: Skill Context Loader

**Files:**
- Create: `server/services/hyperframesSkillContext.js`
- Create: `tests/test-hyperframes-skill-context.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Create `tests/test-hyperframes-skill-context.js`:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const skillContext = require('../server/services/hyperframesSkillContext');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-skill-context-'));
  const skillDir = path.join(root, 'hyperframes');
  fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# HyperFrames\n\nUse lint, validate, inspect, render.');
  fs.writeFileSync(path.join(skillDir, 'references', 'captions.md'), 'Captions must be readable and synchronized.');
  fs.writeFileSync(path.join(skillDir, 'references', 'ignored.md'), 'SHOULD_NOT_APPEAR');

  const context = await skillContext.loadHyperframesSkillContext({
    skillRoot: root,
    maxChars: 500,
  });

  assert.equal(context.success, true);
  assert.equal(context.source_dir, skillDir);
  assert.match(context.prompt_context, /HyperFrames/);
  assert.match(context.prompt_context, /lint, validate, inspect, render/);
  assert.match(context.prompt_context, /Captions must be readable/);
  assert.doesNotMatch(context.prompt_context, /SHOULD_NOT_APPEAR/);

  const missing = await skillContext.loadHyperframesSkillContext({
    skillRoot: path.join(root, 'missing'),
  });
  assert.equal(missing.success, false);
  assert.match(missing.message, /未找到 HyperFrames skill/);

  const projectDir = path.join(root, 'project');
  await skillContext.copySkillSnapshot({
    sourceDir: skillDir,
    projectDir,
  });
  assert.equal(fs.existsSync(path.join(projectDir, '.agents', 'skills', 'hyperframes', 'SKILL.md')), true);
}

run().then(() => {
  console.log('hyperframes skill context tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-hyperframes-skill-context.js
```

Expected: fail with module not found.

- [ ] **Step 3: Implement loader**

Create `server/services/hyperframesSkillContext.js`:

```js
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const INCLUDED_REFERENCE_FILES = new Set([
  'captions.md',
  'typography.md',
  'motion-principles.md',
  'video-composition.md',
  'transitions.md',
]);

function safeString(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function resolveHyperframesSkillDir({ skillRoot = '', env = process.env } = {}) {
  const candidates = [
    skillRoot,
    env.HYPERFRAMES_SKILL_ROOT,
    path.join(process.cwd(), 'server', 'resources', 'hyperframes-skills'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const direct = path.join(resolved, 'SKILL.md');
    const nested = path.join(resolved, 'hyperframes', 'SKILL.md');
    if (fs.existsSync(direct)) return resolved;
    if (fs.existsSync(nested)) return path.dirname(nested);
  }
  return '';
}

async function readIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return fsp.readFile(filePath, 'utf-8');
}

async function loadHyperframesSkillContext({ skillRoot = '', maxChars = 12000, env = process.env } = {}) {
  const sourceDir = resolveHyperframesSkillDir({ skillRoot, env });
  if (!sourceDir) {
    return {
      success: false,
      message: '未找到 HyperFrames skill，请在设置中配置 skill 目录，或使用项目内置模板。',
      source_dir: '',
      prompt_context: '',
    };
  }

  const chunks = [];
  const skillText = await readIfExists(path.join(sourceDir, 'SKILL.md'));
  if (skillText) chunks.push(`# SKILL.md\n${safeString(skillText)}`);

  const referencesDir = path.join(sourceDir, 'references');
  if (fs.existsSync(referencesDir)) {
    const names = fs.readdirSync(referencesDir)
      .filter(name => INCLUDED_REFERENCE_FILES.has(name))
      .sort();
    for (const name of names) {
      const text = await readIfExists(path.join(referencesDir, name));
      if (text) chunks.push(`# references/${name}\n${safeString(text)}`);
    }
  }

  const promptContext = safeString(chunks.join('\n\n')).slice(0, maxChars);
  return {
    success: true,
    message: 'HyperFrames skill 上下文已读取。',
    source_dir: sourceDir,
    prompt_context: promptContext,
  };
}

async function copyDirLimited(source, target) {
  await fsp.mkdir(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirLimited(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(sourcePath, targetPath);
    }
  }
}

async function copySkillSnapshot({ sourceDir, projectDir } = {}) {
  if (!sourceDir || !projectDir || !fs.existsSync(path.join(sourceDir, 'SKILL.md'))) {
    return { success: false, message: '未找到可复制的 HyperFrames skill。' };
  }
  const targetDir = path.join(projectDir, '.agents', 'skills', 'hyperframes');
  await copyDirLimited(sourceDir, targetDir);
  return { success: true, target_dir: targetDir, message: 'HyperFrames skill 快照已保存。' };
}

module.exports = {
  resolveHyperframesSkillDir,
  loadHyperframesSkillContext,
  copySkillSnapshot,
};
```

- [ ] **Step 4: Add test script entry**

In `package.json`, insert `node tests/test-hyperframes-skill-context.js` before `node tests/test-hyperframes-project.js` in the `test` script.

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
node tests/test-hyperframes-skill-context.js
```

Expected: `hyperframes skill context tests passed`.

- [ ] **Step 6: Commit**

```bash
git add server/services/hyperframesSkillContext.js tests/test-hyperframes-skill-context.js package.json
git commit -m "新增 HyperFrames skill 上下文读取"
```

## Task 3: Freeform Project File Service

**Files:**
- Create: `server/services/hyperframesFreeformProject.js`
- Create: `tests/test-hyperframes-freeform-project.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Create `tests/test-hyperframes-freeform-project.js`:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const freeformProject = require('../server/services/hyperframesFreeformProject');

async function run() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-freeform-project-'));
  const awemeId = '1234567890';
  const runId = '20260611-test-storyboard_plan';

  const projectDir = freeformProject.getFreeformProjectDir(awemeId, runId, rootDir);
  assert.ok(projectDir.endsWith(`${runId}-hyperframes-freeform`));

  const created = await freeformProject.createFreeformProject({
    awemeId,
    runId,
    rootDir,
    files: {
      'index.html': '<html><body>ok</body></html>',
      'design.md': '# Design',
      'hyperframes.json': '{}',
      'package.json': '{"private":true}',
    },
  });

  assert.equal(created.success, true);
  assert.equal(fs.existsSync(path.join(projectDir, 'index.html')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'design.md')), true);
  assert.deepEqual(created.files.map(file => file.name).sort(), ['design.md', 'hyperframes.json', 'index.html', 'package.json']);

  const file = await freeformProject.readFreeformFile({ projectDir, fileName: 'design.md' });
  assert.equal(file.success, true);
  assert.equal(file.content, '# Design');

  const saved = await freeformProject.writeFreeformFile({
    projectDir,
    fileName: 'design.md',
    content: '# Updated',
  });
  assert.equal(saved.success, true);
  assert.equal(fs.readFileSync(path.join(projectDir, 'design.md'), 'utf-8'), '# Updated');

  assert.throws(() => freeformProject.resolveFreeformFile(projectDir, '../secret.txt'), /非法/);
  assert.throws(() => freeformProject.resolveFreeformFile(projectDir, 'unknown.txt'), /不支持/);
}

run().then(() => {
  console.log('hyperframes freeform project tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-hyperframes-freeform-project.js
```

Expected: fail with module not found.

- [ ] **Step 3: Implement project service**

Create `server/services/hyperframesFreeformProject.js`:

```js
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const mediaPipeline = require('./mediaPipeline');

const ALLOWED_FILES = new Set([
  'index.html',
  'design.md',
  'hyperframes.json',
  'package.json',
  'meta.json',
  'output.mp4',
  'contact_sheet.jpg',
]);

function getFreeformProjectDir(awemeId, runId, rootDir) {
  return path.join(mediaPipeline.getMediaDir(awemeId, rootDir), 'agent_runs', `${runId}-hyperframes-freeform`);
}

function resolveFreeformFile(projectDir, fileName) {
  const cleanName = String(fileName || '').replace(/\\/g, '/');
  const baseName = path.basename(cleanName);
  if (cleanName.includes('..') || cleanName !== baseName) {
    throw new Error('非法的工程文件路径。');
  }
  if (!ALLOWED_FILES.has(baseName)) {
    throw new Error('不支持访问该工程文件。');
  }
  const resolved = path.resolve(projectDir, baseName);
  const root = path.resolve(projectDir);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('工程文件路径越界。');
  }
  return resolved;
}

async function writeFreeformFile({ projectDir, fileName, content = '' } = {}) {
  const filePath = resolveFreeformFile(projectDir, fileName);
  await fsp.mkdir(projectDir, { recursive: true });
  await fsp.writeFile(filePath, String(content || ''), 'utf-8');
  return { success: true, file_name: path.basename(filePath), path: filePath, message: '工程文件已保存。' };
}

async function readFreeformFile({ projectDir, fileName } = {}) {
  const filePath = resolveFreeformFile(projectDir, fileName);
  if (!fs.existsSync(filePath)) {
    return { success: false, message: '未找到该工程文件。' };
  }
  return {
    success: true,
    file_name: path.basename(filePath),
    path: filePath,
    content: await fsp.readFile(filePath, 'utf-8'),
  };
}

function listFreeformFiles(projectDir) {
  if (!fs.existsSync(projectDir)) return [];
  return fs.readdirSync(projectDir)
    .filter(name => ALLOWED_FILES.has(name) && fs.statSync(path.join(projectDir, name)).isFile())
    .map(name => ({ name, path: path.join(projectDir, name) }));
}

async function createFreeformProject({ awemeId, runId, rootDir, files = {} } = {}) {
  const projectDir = getFreeformProjectDir(awemeId, runId, rootDir);
  await fsp.mkdir(projectDir, { recursive: true });
  await fsp.mkdir(path.join(projectDir, 'assets'), { recursive: true });
  await fsp.mkdir(path.join(projectDir, 'checks'), { recursive: true });
  await fsp.mkdir(path.join(projectDir, 'inspect', 'frames'), { recursive: true });
  await fsp.mkdir(path.join(projectDir, 'renders'), { recursive: true });

  for (const [fileName, content] of Object.entries(files || {})) {
    await writeFreeformFile({ projectDir, fileName, content });
  }

  return {
    success: true,
    project_dir: projectDir,
    files: listFreeformFiles(projectDir),
    message: 'HyperFrames 自由工程已生成。',
  };
}

function buildFreeformFileUrl(awemeId, runId, fileName) {
  return `/api/agents/douyin/${encodeURIComponent(String(awemeId))}/runs/${encodeURIComponent(String(runId))}/hyperframes-freeform/files/${encodeURIComponent(String(fileName))}`;
}

module.exports = {
  ALLOWED_FILES,
  getFreeformProjectDir,
  resolveFreeformFile,
  writeFreeformFile,
  readFreeformFile,
  listFreeformFiles,
  createFreeformProject,
  buildFreeformFileUrl,
};
```

- [ ] **Step 4: Add test script entry**

In `package.json`, insert `node tests/test-hyperframes-freeform-project.js` after `node tests/test-hyperframes-skill-context.js`.

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
node tests/test-hyperframes-freeform-project.js
```

Expected: `hyperframes freeform project tests passed`.

- [ ] **Step 6: Commit**

```bash
git add server/services/hyperframesFreeformProject.js tests/test-hyperframes-freeform-project.js package.json
git commit -m "新增自由 HyperFrames 工程文件服务"
```

## Task 4: Freeform Agent Prompt and Parsing

**Files:**
- Create: `server/services/hyperframesFreeformAgent.js`
- Create: `tests/test-hyperframes-freeform-agent.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Create `tests/test-hyperframes-freeform-agent.js`:

```js
const assert = require('assert');

const agent = require('../server/services/hyperframesFreeformAgent');

async function run() {
  const messages = agent.buildFreeformProjectMessages({
    run: {
      rewrite_script: '这是一段口播。',
      storyboard_plan: { scenes: [{ headline: '开场', narration_text: '你好。' }] },
    },
    brief: {
      title: '测试短片',
      design_md: '# Design\nUse black and gold.',
    },
    skillContext: 'Use HyperFrames. Run lint validate inspect render.',
    options: { aspectRatio: '16:9', targetDurationSec: 30, stylePrompt: '高级科技纪录片' },
  });

  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /HyperFrames 工程生成 Agent/);
  assert.match(messages[1].content, /高级科技纪录片/);
  assert.match(messages[1].content, /Use HyperFrames/);
  assert.match(messages[1].content, /index.html/);
  assert.match(messages[1].content, /design.md/);

  const parsed = agent.parseFreeformProjectResponse(JSON.stringify({
    files: {
      'index.html': '<html></html>',
      'design.md': '# Design',
      'hyperframes.json': '{}',
      'package.json': '{"private":true}',
    },
    summary: '工程已生成',
  }));
  assert.equal(parsed.success, true);
  assert.equal(parsed.files['index.html'], '<html></html>');

  const markdownParsed = agent.parseFreeformProjectResponse('```json\\n{\"files\":{\"index.html\":\"<html></html>\"}}\\n```');
  assert.equal(markdownParsed.success, true);

  const failed = agent.parseFreeformProjectResponse('not json');
  assert.equal(failed.success, false);
  assert.match(failed.message, /解析/);
}

run().then(() => {
  console.log('hyperframes freeform agent tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-hyperframes-freeform-agent.js
```

Expected: fail with module not found.

- [ ] **Step 3: Implement agent service**

Create `server/services/hyperframesFreeformAgent.js`:

```js
function stripCodeFence(text = '') {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function safeJson(value) {
  return JSON.stringify(value || {}, null, 2).slice(0, 12000);
}

function buildFreeformBriefMessages({ run = {}, skillContext = '', options = {} } = {}) {
  return [
    {
      role: 'system',
      content: [
        '你是 MuseDock 的 HyperFrames 导演策划 Agent。',
        '请输出 JSON，不要输出 Markdown。',
        '你负责生成导演级分镜、旁白、视觉风格和 design.md 草稿。',
        '所有用户可见文案默认中文，技术文件名和 HyperFrames 术语可保留英文。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `目标时长：${options.targetDurationSec || 60} 秒`,
        `画幅：${options.aspectRatio || '16:9'}`,
        `风格要求：${options.stylePrompt || '高级科技纪录片'}`,
        '',
        'HyperFrames skill 摘要：',
        skillContext || '未提供 skill 上下文。',
        '',
        '当前 run 摘要：',
        safeJson({
          rewrite_script: run.rewrite_script || run.result?.rewrite_script || '',
          storyboard_plan: run.storyboard_plan || null,
          storyboard: run.storyboard || null,
        }),
        '',
        '请返回 JSON：',
        safeJson({
          title: '片名',
          summary: '一句话创意方向',
          narration: '可配音旁白',
          storyboard: [{ time: '0-5s', shot: '开场', visual: '画面设计', camera: '镜头运动', caption: '字幕' }],
          design_md: '# Design\n...',
        }),
      ].join('\n'),
    },
  ];
}

function buildFreeformProjectMessages({ run = {}, brief = {}, skillContext = '', options = {} } = {}) {
  return [
    {
      role: 'system',
      content: [
        '你是 MuseDock 的 HyperFrames 工程生成 Agent。',
        '你熟悉 HTML、CSS、GSAP 和 HyperFrames CLI。',
        '请只输出 JSON，不要输出 Markdown、解释或代码块。',
        '必须生成可由 HyperFrames render 的完整单页工程文件。',
        '不要访问本地敏感路径，不要上传网络数据，不要引用未授权品牌素材。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `目标时长：${options.targetDurationSec || 60} 秒`,
        `画幅：${options.aspectRatio || '16:9'}`,
        `风格要求：${options.stylePrompt || ''}`,
        '',
        'HyperFrames skill 摘要：',
        skillContext || '未提供 skill 上下文。',
        '',
        '导演策划：',
        safeJson(brief),
        '',
        '当前 run 摘要：',
        safeJson({
          rewrite_script: run.rewrite_script || run.result?.rewrite_script || '',
          storyboard_plan: run.storyboard_plan || null,
          storyboard: run.storyboard || null,
          tts: run.tts || null,
        }),
        '',
        '请返回 JSON，格式如下：',
        safeJson({
          summary: '工程说明',
          files: {
            'index.html': '<!doctype html>...',
            'design.md': '# Design\n...',
            'hyperframes.json': '{...}',
            'package.json': '{...}',
          },
        }),
      ].join('\n'),
    },
  ];
}

function parseJsonObject(text = '') {
  const cleaned = stripCodeFence(text);
  return JSON.parse(cleaned);
}

function parseFreeformBriefResponse(text = '') {
  try {
    const value = parseJsonObject(text);
    return { success: true, brief: value };
  } catch (error) {
    return { success: false, message: `导演策划解析失败：${error.message}` };
  }
}

function parseFreeformProjectResponse(text = '') {
  try {
    const value = parseJsonObject(text);
    const files = value.files && typeof value.files === 'object' && !Array.isArray(value.files) ? value.files : {};
    if (!files['index.html']) {
      return { success: false, message: '工程解析失败：缺少 index.html。' };
    }
    return { success: true, summary: value.summary || '', files };
  } catch (error) {
    return { success: false, message: `工程解析失败：${error.message}` };
  }
}

module.exports = {
  buildFreeformBriefMessages,
  buildFreeformProjectMessages,
  parseFreeformBriefResponse,
  parseFreeformProjectResponse,
};
```

- [ ] **Step 4: Add test script entry**

In `package.json`, insert `node tests/test-hyperframes-freeform-agent.js` after `node tests/test-hyperframes-freeform-project.js`.

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
node tests/test-hyperframes-freeform-agent.js
```

Expected: `hyperframes freeform agent tests passed`.

- [ ] **Step 6: Commit**

```bash
git add server/services/hyperframesFreeformAgent.js tests/test-hyperframes-freeform-agent.js package.json
git commit -m "新增自由 HyperFrames 工程生成提示"
```

## Task 5: Freeform Quality Checks

**Files:**
- Create: `server/services/hyperframesFreeformQuality.js`
- Create: `tests/test-hyperframes-freeform-quality.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Create `tests/test-hyperframes-freeform-quality.js`:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const quality = require('../server/services/hyperframesFreeformQuality');

async function run() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-freeform-quality-'));
  fs.writeFileSync(path.join(projectDir, 'index.html'), '<html></html>');

  const calls = [];
  const check = await quality.checkFreeformProject({
    projectDir,
    runCommand: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { ok: true, code: 0, stdout: `${args.join(' ')} ok`, stderr: '' };
    },
  });

  assert.equal(check.success, true);
  assert.equal(check.lint, 'passed');
  assert.equal(check.validate, 'passed');
  assert.equal(check.inspect, 'passed');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.args[1]), ['lint', 'validate', 'inspect']);
  assert.equal(fs.existsSync(path.join(projectDir, 'checks', 'lint.txt')), true);

  const failed = await quality.checkFreeformProject({
    projectDir,
    runCommand: async (_command, args) => ({
      ok: args[1] !== 'validate',
      code: args[1] === 'validate' ? 1 : 0,
      stdout: '',
      stderr: args[1] === 'validate' ? 'bad layout' : '',
    }),
  });

  assert.equal(failed.success, false);
  assert.equal(failed.validate, 'failed');
  assert.match(failed.message, /validate/);

  const inspect = await quality.inspectRenderedVideo({
    projectDir,
    outputPath: path.join(projectDir, 'output.mp4'),
    runCommand: async (command, args) => {
      if (args.includes('fps=10/3')) {
        const framesDir = path.join(projectDir, 'inspect', 'frames');
        fs.mkdirSync(framesDir, { recursive: true });
        fs.writeFileSync(path.join(framesDir, 'frame_0001.jpg'), 'fake jpg');
      }
      if (args.includes('tile=5x3')) {
        fs.mkdirSync(path.join(projectDir, 'inspect'), { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'inspect', 'contact_sheet.jpg'), 'fake sheet');
      }
      return { ok: true, code: 0, stdout: 'ok', stderr: '' };
    },
  });

  assert.equal(inspect.success, true);
  assert.equal(fs.existsSync(path.join(projectDir, 'checks', 'visual_report.json')), true);
}

run().then(() => {
  console.log('hyperframes freeform quality tests passed');
}).catch(error => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-hyperframes-freeform-quality.js
```

Expected: fail with module not found.

- [ ] **Step 3: Implement quality service**

Create `server/services/hyperframesFreeformQuality.js`:

```js
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { getNpxCommand, runCommand: defaultRunCommand } = require('./hyperframesRenderer');

async function writeCheck(projectDir, name, result) {
  const checksDir = path.join(projectDir, 'checks');
  await fsp.mkdir(checksDir, { recursive: true });
  const text = [
    `ok: ${result.ok}`,
    `code: ${result.code}`,
    '',
    'stdout:',
    result.stdout || '',
    '',
    'stderr:',
    result.stderr || result.error || '',
  ].join('\n');
  await fsp.writeFile(path.join(checksDir, `${name}.txt`), text, 'utf-8');
}

async function runHyperframesCheck(projectDir, name, args, runCommand) {
  const result = await runCommand(getNpxCommand(), ['hyperframes', name, ...args], { cwd: projectDir });
  await writeCheck(projectDir, name, result);
  return result;
}

async function checkFreeformProject({ projectDir, runCommand = defaultRunCommand } = {}) {
  if (!projectDir || !fs.existsSync(path.join(projectDir, 'index.html'))) {
    return { success: false, message: '校验失败：未找到 HyperFrames 工程入口 index.html。' };
  }
  const lint = await runHyperframesCheck(projectDir, 'lint', [], runCommand);
  const validate = await runHyperframesCheck(projectDir, 'validate', [], runCommand);
  const inspect = await runHyperframesCheck(projectDir, 'inspect', ['--samples', '12'], runCommand);
  const success = lint.ok && validate.ok && inspect.ok;
  return {
    success,
    lint: lint.ok ? 'passed' : 'failed',
    validate: validate.ok ? 'passed' : 'failed',
    inspect: inspect.ok ? 'passed' : 'failed',
    message: success ? '动画工程校验通过。' : `动画工程校验未通过：${!lint.ok ? 'lint' : !validate.ok ? 'validate' : 'inspect'} 失败。`,
  };
}

function getFfmpegCommand() {
  return process.env.FFMPEG_PATH || (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

async function inspectRenderedVideo({ projectDir, outputPath, runCommand = defaultRunCommand } = {}) {
  const target = outputPath || path.join(projectDir, 'output.mp4');
  if (!fs.existsSync(target)) {
    return { success: false, message: '抽帧质检失败：未找到 output.mp4。' };
  }
  const framesDir = path.join(projectDir, 'inspect', 'frames');
  const sheetPath = path.join(projectDir, 'inspect', 'contact_sheet.jpg');
  const reportPath = path.join(projectDir, 'checks', 'visual_report.json');
  await fsp.mkdir(framesDir, { recursive: true });
  await fsp.mkdir(path.dirname(reportPath), { recursive: true });

  const extract = await runCommand(getFfmpegCommand(), [
    '-y',
    '-i',
    target,
    '-vf',
    'fps=10/3,scale=320:-1',
    path.join(framesDir, 'frame_%04d.jpg'),
  ], { cwd: projectDir });

  if (!extract.ok) {
    const report = { success: false, issues: [{ code: 'frame_extract_failed', message: extract.stderr || extract.error || '抽帧失败' }] };
    await fsp.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    return { success: false, message: '视频已生成，但抽帧质检失败。', report };
  }

  const tile = await runCommand(getFfmpegCommand(), [
    '-y',
    '-framerate',
    '10/3',
    '-i',
    path.join(framesDir, 'frame_%04d.jpg'),
    '-vf',
    "select='not(mod(n,14))',scale=180:-1,tile=5x3",
    '-frames:v',
    '1',
    sheetPath,
  ], { cwd: projectDir });

  const report = {
    success: tile.ok && fs.existsSync(sheetPath),
    issues: tile.ok ? [] : [{ code: 'contact_sheet_failed', message: tile.stderr || tile.error || '联系表生成失败' }],
    contact_sheet_path: fs.existsSync(sheetPath) ? sheetPath : '',
  };
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  return {
    success: report.success,
    message: report.success ? '抽帧质检完成。' : '视频已生成，但联系表生成失败。',
    contact_sheet_path: report.contact_sheet_path,
    report,
  };
}

module.exports = {
  checkFreeformProject,
  inspectRenderedVideo,
};
```

- [ ] **Step 4: Add test script entry**

In `package.json`, insert `node tests/test-hyperframes-freeform-quality.js` after `node tests/test-hyperframes-freeform-agent.js`.

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
node tests/test-hyperframes-freeform-quality.js
```

Expected: `hyperframes freeform quality tests passed`.

- [ ] **Step 6: Commit**

```bash
git add server/services/hyperframesFreeformQuality.js tests/test-hyperframes-freeform-quality.js package.json
git commit -m "新增自由 HyperFrames 校验质检"
```

## Task 6: Agent Run Orchestration

**Files:**
- Modify: `server/services/agentRuns.js`
- Modify: `tests/test-agent-runs.js`

- [ ] **Step 1: Write failing orchestration tests**

Add tests in `tests/test-agent-runs.js` after the initial freeform state test:

```js
  const freeformBrief = await agentRuns.generateDouyinRunHyperframesFreeformBrief(awemeId, generated.run_id, {
    rootDir,
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: '' }),
    },
    aiTextModel: {
      callTextModel: async ({ messages }) => {
        assert.match(messages[1].content, /skill context/);
        return {
          success: true,
          text: JSON.stringify({
            title: '高级测试片',
            summary: '自由工程 brief',
            design_md: '# Design',
            narration: '旁白',
            storyboard: [],
          }),
        };
      },
    },
  });
  assert.equal(freeformBrief.success, true);
  assert.equal(freeformBrief.hyperframes_freeform.brief.status, 'ready');
  assert.match(freeformBrief.hyperframes_freeform.brief.summary, /自由工程 brief/);

  const freeformProject = await agentRuns.generateDouyinRunHyperframesFreeformProject(awemeId, generated.run_id, {
    rootDir,
    skillContext: {
      loadHyperframesSkillContext: async () => ({ success: true, prompt_context: 'skill context', source_dir: '' }),
      copySkillSnapshot: async () => ({ success: true }),
    },
    aiTextModel: {
      callTextModel: async () => ({
        success: true,
        text: JSON.stringify({
          summary: '工程生成',
          files: {
            'index.html': '<html></html>',
            'design.md': '# Design',
            'hyperframes.json': '{}',
            'package.json': '{"private":true}',
          },
        }),
      }),
    },
  });
  assert.equal(freeformProject.success, true);
  assert.equal(freeformProject.hyperframes_freeform.project.status, 'ready');
  assert.ok(fs.existsSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}-hyperframes-freeform`, 'index.html')));
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-agent-runs.js
```

Expected: fail with `generateDouyinRunHyperframesFreeformBrief is not a function`.

- [ ] **Step 3: Implement orchestration methods**

In `server/services/agentRuns.js`, require new services near existing requires:

```js
const defaultHyperframesSkillContext = require('./hyperframesSkillContext');
const defaultHyperframesFreeformAgent = require('./hyperframesFreeformAgent');
const defaultHyperframesFreeformProject = require('./hyperframesFreeformProject');
const defaultHyperframesFreeformQuality = require('./hyperframesFreeformQuality');
```

Add a helper:

```js
async function updateRunHyperframesFreeform(awemeId, runId, updater, options = {}) {
  const detail = await getDouyinAgentRun(awemeId, runId, options);
  if (!detail.success) return detail;
  const run = detail.data;
  const current = normalizeHyperframesFreeformState(run.hyperframes_freeform);
  const next = typeof updater === 'function' ? updater(current, run) : { ...current, ...(updater || {}) };
  run.hyperframes_freeform = normalizeHyperframesFreeformState(next);
  run.updated_at = new Date().toISOString();
  await writeJson(getAgentRunPath(awemeId, runId, options.rootDir), run);
  return run;
}
```

Add `generateDouyinRunHyperframesFreeformBrief`:

```js
async function generateDouyinRunHyperframesFreeformBrief(awemeId, runId, options = {}) {
  const detail = await getDouyinAgentRun(awemeId, runId, options);
  if (!detail.success) return detail;
  const skillContext = options.skillContext || defaultHyperframesSkillContext;
  const freeformAgent = options.freeformAgent || defaultHyperframesFreeformAgent;
  const aiTextModel = options.aiTextModel || defaultAiTextModel;
  const context = await skillContext.loadHyperframesSkillContext(options.skillOptions || {});
  if (!context.success) {
    return { success: false, aweme_id: awemeId, run_id: runId, message: context.message };
  }
  await updateRunHyperframesFreeform(awemeId, runId, state => ({
    ...state,
    status: 'generating',
    brief: { ...state.brief, status: 'generating', message: '正在生成导演策划...' },
  }), options);
  const messages = freeformAgent.buildFreeformBriefMessages({
    run: detail.data,
    skillContext: context.prompt_context,
    options: options.briefOptions || {},
  });
  const modelResult = await aiTextModel.callTextModel({ messages, temperature: 0.35, stream: true });
  if (!modelResult.success) {
    const run = await updateRunHyperframesFreeform(awemeId, runId, state => ({
      ...state,
      status: 'failed',
      brief: { ...state.brief, status: 'failed', message: modelResult.message || '导演策划生成失败。' },
    }), options);
    return { success: false, aweme_id: awemeId, run_id: runId, message: run.hyperframes_freeform.brief.message, hyperframes_freeform: run.hyperframes_freeform };
  }
  const parsed = freeformAgent.parseFreeformBriefResponse(modelResult.text || modelResult.raw_text || '');
  if (!parsed.success) {
    const run = await updateRunHyperframesFreeform(awemeId, runId, state => ({
      ...state,
      status: 'failed',
      brief: { ...state.brief, status: 'failed', message: parsed.message },
    }), options);
    return { success: false, aweme_id: awemeId, run_id: runId, message: parsed.message, hyperframes_freeform: run.hyperframes_freeform };
  }
  const run = await updateRunHyperframesFreeform(awemeId, runId, state => ({
    ...state,
    status: 'ready',
    brief: {
      ...state.brief,
      status: 'ready',
      summary: parsed.brief.summary || parsed.brief.title || '导演策划已生成。',
      data: parsed.brief,
      message: '导演策划已生成。',
    },
  }), options);
  return { success: true, aweme_id: awemeId, run_id: runId, message: '导演策划已生成。', hyperframes_freeform: run.hyperframes_freeform };
}
```

Add `generateDouyinRunHyperframesFreeformProject` similarly. It must:

1. Load current run.
2. Load skill context.
3. Build project messages using `run.hyperframes_freeform.brief.data`.
4. Parse files.
5. Create project via `hyperframesFreeformProject.createFreeformProject`.
6. Copy skill snapshot when `context.source_dir` exists.
7. Update `hyperframes_freeform.project_dir`, `project.status`, `project.index_path`, and file list.

Export the new functions.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node tests/test-agent-runs.js
```

Expected: pass or fail only on unrelated pre-existing dirty-worktree assertions. If it fails because `defaultAiTextModel` is not imported under that name, use the existing AI text model variable name from `agentRuns.js`.

- [ ] **Step 5: Commit**

```bash
git add server/services/agentRuns.js tests/test-agent-runs.js
git commit -m "串联自由 HyperFrames brief 和工程生成"
```

## Task 7: Freeform Check, Render, Inspect Orchestration

**Files:**
- Modify: `server/services/agentRuns.js`
- Modify: `tests/test-agent-runs.js`

- [ ] **Step 1: Write failing tests**

Add after freeform project test:

```js
  const freeformCheck = await agentRuns.checkDouyinRunHyperframesFreeformProject(awemeId, generated.run_id, {
    rootDir,
    hyperframesFreeformQuality: {
      checkFreeformProject: async ({ projectDir }) => {
        assert.ok(projectDir.endsWith(`${generated.run_id}-hyperframes-freeform`));
        return { success: true, lint: 'passed', validate: 'passed', inspect: 'passed', message: '检查通过' };
      },
    },
  });
  assert.equal(freeformCheck.success, true);
  assert.equal(freeformCheck.hyperframes_freeform.checks.status, 'passed');

  const freeformRender = await agentRuns.renderDouyinRunHyperframesFreeformVideo(awemeId, generated.run_id, {
    rootDir,
    hyperframesRenderer: {
      renderHyperframesProject: async ({ projectDir }) => {
        const outputPath = path.join(projectDir, 'output.mp4');
        fs.writeFileSync(outputPath, 'fake freeform mp4');
        return { success: true, output_path: outputPath, message: '渲染完成' };
      },
    },
  });
  assert.equal(freeformRender.success, true);
  assert.equal(freeformRender.hyperframes_freeform.render.status, 'rendered');
  assert.match(freeformRender.hyperframes_freeform.render.output_url, /hyperframes-freeform\/files\/output\.mp4/);

  const freeformInspect = await agentRuns.inspectDouyinRunHyperframesFreeformVideo(awemeId, generated.run_id, {
    rootDir,
    hyperframesFreeformQuality: {
      inspectRenderedVideo: async ({ projectDir }) => {
        const sheetPath = path.join(projectDir, 'inspect', 'contact_sheet.jpg');
        fs.mkdirSync(path.dirname(sheetPath), { recursive: true });
        fs.writeFileSync(sheetPath, 'fake sheet');
        return { success: true, contact_sheet_path: sheetPath, report: { success: true, issues: [] }, message: '抽帧完成' };
      },
    },
  });
  assert.equal(freeformInspect.success, true);
  assert.equal(freeformInspect.hyperframes_freeform.visual_inspect.status, 'passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-agent-runs.js
```

Expected: fail with missing orchestration function.

- [ ] **Step 3: Implement check/render/inspect methods**

In `server/services/agentRuns.js`, add:

```js
async function checkDouyinRunHyperframesFreeformProject(awemeId, runId, options = {}) {
  const detail = await getDouyinAgentRun(awemeId, runId, options);
  if (!detail.success) return detail;
  const freeform = normalizeHyperframesFreeformState(detail.data.hyperframes_freeform);
  if (!freeform.project_dir) {
    return { success: false, aweme_id: awemeId, run_id: runId, message: '请先生成 HyperFrames 自由工程。' };
  }
  const quality = options.hyperframesFreeformQuality || defaultHyperframesFreeformQuality;
  await updateRunHyperframesFreeform(awemeId, runId, state => ({
    ...state,
    checks: { ...state.checks, status: 'checking', message: '正在校验动画工程...' },
  }), options);
  const result = await quality.checkFreeformProject({ projectDir: freeform.project_dir });
  const run = await updateRunHyperframesFreeform(awemeId, runId, state => ({
    ...state,
    checks: {
      ...state.checks,
      status: result.success ? 'passed' : 'failed',
      lint: result.lint || 'pending',
      validate: result.validate || 'pending',
      inspect: result.inspect || 'pending',
      message: result.message || (result.success ? '动画工程校验通过。' : '动画工程校验未通过。'),
    },
  }), options);
  return { success: result.success, aweme_id: awemeId, run_id: runId, message: run.hyperframes_freeform.checks.message, hyperframes_freeform: run.hyperframes_freeform };
}
```

Add render and inspect functions with the same pattern:

- render status becomes `rendering`, then `rendered` or `failed`.
- render output URL uses `hyperframesFreeformProject.buildFreeformFileUrl(awemeId, runId, 'output.mp4')`.
- inspect status becomes `inspecting`, then `passed` or `failed`.
- inspect contact sheet URL uses `buildFreeformFileUrl(awemeId, runId, 'contact_sheet.jpg')`.

Export all three functions.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node tests/test-agent-runs.js
```

Expected: freeform orchestration assertions pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/agentRuns.js tests/test-agent-runs.js
git commit -m "串联自由 HyperFrames 校验渲染质检"
```

## Task 8: Freeform API Routes

**Files:**
- Modify: `server/routes/agents.js`
- Modify: `tests/test-agent-runs.js` if route helper coverage exists there, otherwise create `tests/test-hyperframes-freeform-routes.js`

- [ ] **Step 1: Add route tests**

If the existing test server helper in `tests/test-agent-runs.js` already covers Express routes, add route assertions near current `/hyperframes/project` and `/hyperframes/render` route tests:

```js
    const freeformBriefResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes-freeform/brief`, {});
    assert.strictEqual(freeformBriefResponse.statusCode, 200);
    assert.strictEqual(freeformBriefResponse.body.success, true);

    const freeformProjectResponse = await requestJson(server, 'POST', `/api/agents/douyin/${awemeId}/runs/ok-run/hyperframes-freeform/project`, {});
    assert.strictEqual(freeformProjectResponse.statusCode, 200);
    assert.strictEqual(freeformProjectResponse.body.success, true);
```

If route tests require stubbing new `agentRuns` methods, follow the existing pattern that stubs `renderDouyinRunHyperframesVideo`.

- [ ] **Step 2: Run route tests to verify failure**

Run:

```bash
node tests/test-agent-runs.js
```

Expected: fail with 404 for new route.

- [ ] **Step 3: Implement routes**

In `server/routes/agents.js`, add before `files/:file_name` handlers:

```js
router.post('/douyin/:aweme_id/runs/:run_id/hyperframes-freeform/brief', async (req, res) => {
  try {
    const result = await agentRuns.generateDouyinRunHyperframesFreeformBrief(req.params.aweme_id, req.params.run_id, {
      briefOptions: req.body || {},
    });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      aweme_id: req.params.aweme_id,
      run_id: req.params.run_id,
      message: '导演策划生成接口异常，请稍后重试。',
    });
  }
});
```

Add matching routes for:

- `/project` -> `generateDouyinRunHyperframesFreeformProject`
- `/check` -> `checkDouyinRunHyperframesFreeformProject`
- `/render` -> `renderDouyinRunHyperframesFreeformVideo`
- `/inspect` -> `inspectDouyinRunHyperframesFreeformVideo`
- `GET /files/:file_name` -> resolve file through `agentRuns.resolveDouyinRunHyperframesFreeformFile`
- `PUT /files/:file_name` -> save through `agentRuns.saveDouyinRunHyperframesFreeformFile`

The GET/PUT helpers are implemented in Task 9 if not available yet.

- [ ] **Step 4: Run tests**

Run:

```bash
node tests/test-agent-runs.js
```

Expected: route tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/agents.js tests/test-agent-runs.js
git commit -m "新增自由 HyperFrames 接口路由"
```

## Task 9: Freeform File Resolve and Save Helpers

**Files:**
- Modify: `server/services/agentRuns.js`
- Modify: `tests/test-agent-runs.js`

- [ ] **Step 1: Write failing tests**

Add after freeform project generation assertions:

```js
  const freeformFilePath = agentRuns.resolveDouyinRunHyperframesFreeformFile(awemeId, generated.run_id, 'index.html', { rootDir });
  assert.ok(freeformFilePath.endsWith('index.html'));
  assert.throws(() => agentRuns.resolveDouyinRunHyperframesFreeformFile(awemeId, generated.run_id, '../secret.txt', { rootDir }), /非法|不支持/);

  const savedFreeformFile = await agentRuns.saveDouyinRunHyperframesFreeformFile(awemeId, generated.run_id, 'design.md', '# Edited', { rootDir });
  assert.equal(savedFreeformFile.success, true);
  assert.equal(fs.readFileSync(path.join(rootDir, awemeId, 'agent_runs', `${generated.run_id}-hyperframes-freeform`, 'design.md'), 'utf-8'), '# Edited');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-agent-runs.js
```

Expected: fail with missing helper.

- [ ] **Step 3: Implement helpers**

In `server/services/agentRuns.js`, add:

```js
function resolveDouyinRunHyperframesFreeformFile(awemeId, runId, fileName, options = {}) {
  const projectDir = defaultHyperframesFreeformProject.getFreeformProjectDir(awemeId, runId, options.rootDir);
  if (fileName === 'contact_sheet.jpg') {
    const sheetPath = path.join(projectDir, 'inspect', 'contact_sheet.jpg');
    const root = path.resolve(projectDir);
    const resolved = path.resolve(sheetPath);
    if (!resolved.startsWith(root + path.sep)) throw new Error('非法的工程文件路径。');
    return sheetPath;
  }
  return defaultHyperframesFreeformProject.resolveFreeformFile(projectDir, fileName);
}

async function saveDouyinRunHyperframesFreeformFile(awemeId, runId, fileName, content, options = {}) {
  const projectDir = defaultHyperframesFreeformProject.getFreeformProjectDir(awemeId, runId, options.rootDir);
  return defaultHyperframesFreeformProject.writeFreeformFile({ projectDir, fileName, content });
}
```

Export both.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node tests/test-agent-runs.js
```

Expected: helper assertions pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/agentRuns.js tests/test-agent-runs.js
git commit -m "新增自由 HyperFrames 文件访问"
```

## Task 10: Frontend API Client

**Files:**
- Modify: `frontend-react/src/api/client.js`
- Create: `tests/test-hyperframes-studio-api-client.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write static API client test**

Create `tests/test-hyperframes-studio-api-client.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('frontend-react/src/api/client.js', 'utf-8');

for (const name of [
  'generateHyperframesFreeformBrief',
  'generateHyperframesFreeformProject',
  'checkHyperframesFreeformProject',
  'renderHyperframesFreeformProject',
  'inspectHyperframesFreeformVideo',
  'getHyperframesFreeformFile',
  'saveHyperframesFreeformFile',
]) {
  assert.match(source, new RegExp(`${name}\\\\(`), `${name} should exist`);
}

assert.match(source, /hyperframes-freeform\\/brief/);
assert.match(source, /hyperframes-freeform\\/project/);
assert.match(source, /hyperframes-freeform\\/check/);
assert.match(source, /hyperframes-freeform\\/render/);
assert.match(source, /hyperframes-freeform\\/inspect/);
assert.match(source, /hyperframes-freeform\\/files/);

console.log('hyperframes studio api client tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-hyperframes-studio-api-client.mjs
```

Expected: fail because methods do not exist.

- [ ] **Step 3: Add API methods**

In `frontend-react/src/api/client.js`, add:

```js
  generateHyperframesFreeformBrief(awemeId, runId, payload = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  generateHyperframesFreeformProject(awemeId, runId, payload = {}) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
  checkHyperframesFreeformProject(awemeId, runId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/check`, { method: 'POST' });
  },
  renderHyperframesFreeformProject(awemeId, runId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/render`, { method: 'POST' });
  },
  inspectHyperframesFreeformVideo(awemeId, runId) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/inspect`, { method: 'POST' });
  },
  getHyperframesFreeformFile(awemeId, runId, fileName) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/files/${encodeURIComponent(fileName)}`);
  },
  saveHyperframesFreeformFile(awemeId, runId, fileName, content) {
    return requestJson(`/api/agents/douyin/${encodeURIComponent(awemeId)}/runs/${encodeURIComponent(runId)}/hyperframes-freeform/files/${encodeURIComponent(fileName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  },
```

- [ ] **Step 4: Add test script entry**

In `package.json`, add `node tests/test-hyperframes-studio-api-client.mjs` before `node tests/test-persistent-routes.mjs`.

- [ ] **Step 5: Run test**

Run:

```bash
node tests/test-hyperframes-studio-api-client.mjs
```

Expected: `hyperframes studio api client tests passed`.

- [ ] **Step 6: Commit**

```bash
git add frontend-react/src/api/client.js tests/test-hyperframes-studio-api-client.mjs package.json
git commit -m "新增高级成片前端接口"
```

## Task 11: Persistent Route and Navigation

**Files:**
- Modify: `frontend-react/src/utils/persistentRoutes.js`
- Modify: `frontend-react/src/App.jsx`
- Modify: `frontend-react/src/components/AppShell.jsx`
- Modify: `tests/test-persistent-routes.mjs`

- [ ] **Step 1: Write route state tests**

In `tests/test-persistent-routes.mjs`, add:

```js
const studioState = getPersistentRouteState(undefined, '/hyperframes-studio/123/run-abc', '');
assert.equal(studioState.activePage, 'hyperframes-studio');
assert.equal(studioState.studioAwemeId, '123');
assert.equal(studioState.studioRunId, 'run-abc');

const studioNoRun = getPersistentRouteState(studioState, '/hyperframes-studio/456', '');
assert.equal(studioNoRun.activePage, 'hyperframes-studio');
assert.equal(studioNoRun.studioAwemeId, '456');
assert.equal(studioNoRun.studioRunId, 'run-abc');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-persistent-routes.mjs
```

Expected: fail because route state does not support studio.

- [ ] **Step 3: Update persistent route state**

In `frontend-react/src/utils/persistentRoutes.js`, add to `DEFAULT_STATE`:

```js
  studioAwemeId: '',
  studioRunId: '',
```

Add before settings:

```js
  if (section === 'hyperframes-studio') {
    return {
      ...state,
      studioAwemeId: parts[1] || state.studioAwemeId,
      studioRunId: parts[2] || state.studioRunId,
      activePage: 'hyperframes-studio',
    };
  }
```

- [ ] **Step 4: Add route shell placeholder**

Create `frontend-react/src/pages/HyperframesStudioPage.jsx` with temporary component:

```jsx
export function HyperframesStudioPage() {
  return (
    <main className="page hyperframesStudioPage">
      <section className="panel">
        <h2>高级成片</h2>
        <p>高级 HyperFrames 成片工作台正在准备。</p>
      </section>
    </main>
  );
}
```

In `frontend-react/src/App.jsx`, import it and add persistent slot:

```jsx
import { HyperframesStudioPage } from './pages/HyperframesStudioPage.jsx';
```

Inside `PersistentPages`:

```jsx
      <div hidden={!isActive('hyperframes-studio')}>
        <HyperframesStudioPage awemeId={routeState.studioAwemeId} runId={routeState.studioRunId} />
      </div>
```

In `frontend-react/src/components/AppShell.jsx`, add:

```jsx
        <NavLink className={navClass} to="/hyperframes-studio">高级成片</NavLink>
```

- [ ] **Step 5: Run route test and frontend build**

Run:

```bash
node tests/test-persistent-routes.mjs
npm run build:frontend
```

Expected: route test passes and Vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend-react/src/utils/persistentRoutes.js frontend-react/src/App.jsx frontend-react/src/components/AppShell.jsx frontend-react/src/pages/HyperframesStudioPage.jsx tests/test-persistent-routes.mjs
git commit -m "新增高级成片页面路由"
```

## Task 12: Studio Hook

**Files:**
- Create: `frontend-react/src/hooks/useHyperframesStudio.js`
- Create: `tests/test-hyperframes-studio-hook.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write static hook boundary test**

Create `tests/test-hyperframes-studio-hook.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('frontend-react/src/hooks/useHyperframesStudio.js', 'utf-8');

assert.match(source, /export function useHyperframesStudio/);
assert.match(source, /generateBrief/);
assert.match(source, /generateProject/);
assert.match(source, /checkProject/);
assert.match(source, /renderVideo/);
assert.match(source, /inspectVideo/);
assert.match(source, /saveFile/);
assert.match(source, /正在生成导演策划/);
assert.match(source, /正在生成 HyperFrames 工程/);
assert.match(source, /正在校验动画工程/);
assert.match(source, /正在渲染视频/);
assert.match(source, /正在抽帧质检/);

console.log('hyperframes studio hook tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-hyperframes-studio-hook.mjs
```

Expected: fail because hook file does not exist.

- [ ] **Step 3: Implement hook**

Create `frontend-react/src/hooks/useHyperframesStudio.js`:

```js
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

function makeStatus(type = 'info', message = '') {
  return { type, message };
}

export function useHyperframesStudio({ initialAwemeId = '', initialRunId = '' } = {}) {
  const [awemeId, setAwemeId] = useState(initialAwemeId || '');
  const [runId, setRunId] = useState(initialRunId || '');
  const [runs, setRuns] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [selectedFile, setSelectedFile] = useState('design.md');
  const [fileContent, setFileContent] = useState('');
  const [status, setStatus] = useState(makeStatus('info', '请输入抖音视频 ID，或从 AI 工作台打开一条运行记录。'));
  const [busyAction, setBusyAction] = useState('');

  const freeform = activeRun?.hyperframes_freeform || null;
  const busy = Boolean(busyAction);

  async function refreshRuns(nextAwemeId = awemeId, nextRunId = runId) {
    if (!nextAwemeId) return;
    setStatus(makeStatus('loading', '正在读取素材状态和历史运行记录...'));
    const json = await api.listDouyinAgentRuns(nextAwemeId);
    const list = json.data || [];
    setRuns(list);
    const nextActive = list.find(item => item.run_id === nextRunId) || list[0] || null;
    setActiveRun(nextActive);
    if (nextActive && nextActive.run_id !== runId) setRunId(nextActive.run_id);
    setStatus(makeStatus('success', '运行记录已加载。'));
  }

  async function refreshActiveRun(nextAwemeId = awemeId, nextRunId = runId) {
    if (!nextAwemeId || !nextRunId) return;
    const json = await api.getDouyinAgentRun(nextAwemeId, nextRunId);
    setActiveRun(json.data || null);
  }

  async function runAction(actionName, loadingMessage, action) {
    if (!awemeId || !runId) {
      setStatus(makeStatus('error', '请先选择抖音视频 ID 和运行记录。'));
      return null;
    }
    setBusyAction(actionName);
    setStatus(makeStatus('loading', loadingMessage));
    try {
      const result = await action();
      await refreshActiveRun();
      setStatus(makeStatus(result.success ? 'success' : 'error', result.message || '操作已完成。'));
      return result;
    } catch (error) {
      setStatus(makeStatus('error', error.message || '操作失败，请稍后重试。'));
      return null;
    } finally {
      setBusyAction('');
    }
  }

  function generateBrief(options = {}) {
    return runAction('brief', '正在生成导演策划...', () => api.generateHyperframesFreeformBrief(awemeId, runId, options));
  }

  function generateProject(options = {}) {
    return runAction('project', '正在生成 HyperFrames 工程...', () => api.generateHyperframesFreeformProject(awemeId, runId, options));
  }

  function checkProject() {
    return runAction('check', '正在校验动画工程...', () => api.checkHyperframesFreeformProject(awemeId, runId));
  }

  function renderVideo() {
    return runAction('render', '正在渲染视频...', () => api.renderHyperframesFreeformProject(awemeId, runId));
  }

  function inspectVideo() {
    return runAction('inspect', '正在抽帧质检...', () => api.inspectHyperframesFreeformVideo(awemeId, runId));
  }

  async function loadFile(fileName = selectedFile) {
    if (!awemeId || !runId || !fileName) return;
    setBusyAction('file');
    setStatus(makeStatus('loading', '正在读取工程文件...'));
    try {
      const json = await api.getHyperframesFreeformFile(awemeId, runId, fileName);
      setSelectedFile(fileName);
      setFileContent(json.content || '');
      setStatus(makeStatus('success', '工程文件已读取。'));
    } catch (error) {
      setStatus(makeStatus('error', error.message || '读取工程文件失败。'));
    } finally {
      setBusyAction('');
    }
  }

  async function saveFile() {
    if (!selectedFile) return;
    return runAction('save-file', '正在保存工程文件...', () => api.saveHyperframesFreeformFile(awemeId, runId, selectedFile, fileContent));
  }

  useEffect(() => {
    if (initialAwemeId) refreshRuns(initialAwemeId, initialRunId).catch(error => {
      setStatus(makeStatus('error', error.message || '加载运行记录失败。'));
    });
  }, [initialAwemeId, initialRunId]);

  const canUseWorkflow = Boolean(awemeId && runId && !busy);

  return {
    awemeId,
    setAwemeId,
    runId,
    setRunId,
    runs,
    activeRun,
    freeform,
    selectedFile,
    setSelectedFile,
    fileContent,
    setFileContent,
    status,
    busy,
    busyAction,
    canUseWorkflow,
    refreshRuns,
    refreshActiveRun,
    generateBrief,
    generateProject,
    checkProject,
    renderVideo,
    inspectVideo,
    loadFile,
    saveFile,
  };
}
```

- [ ] **Step 4: Add test script entry**

In `package.json`, add `node tests/test-hyperframes-studio-hook.mjs` after the API client test.

- [ ] **Step 5: Run test**

Run:

```bash
node tests/test-hyperframes-studio-hook.mjs
npm run build:frontend
```

Expected: hook test passes and frontend builds.

- [ ] **Step 6: Commit**

```bash
git add frontend-react/src/hooks/useHyperframesStudio.js tests/test-hyperframes-studio-hook.mjs package.json
git commit -m "新增高级成片页面状态 hook"
```

## Task 13: Componentized Studio UI

**Files:**
- Create: `frontend-react/src/components/hyperframes-studio/StudioStatus.jsx`
- Create: `frontend-react/src/components/hyperframes-studio/StudioSidebar.jsx`
- Create: `frontend-react/src/components/hyperframes-studio/DirectorPanel.jsx`
- Create: `frontend-react/src/components/hyperframes-studio/ProjectPanel.jsx`
- Create: `frontend-react/src/components/hyperframes-studio/RenderPreview.jsx`
- Modify: `frontend-react/src/pages/HyperframesStudioPage.jsx`
- Create: `tests/test-hyperframes-studio-page.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write component-boundary test**

Create `tests/test-hyperframes-studio-page.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('frontend-react/src/pages/HyperframesStudioPage.jsx', 'utf-8');

assert.match(page, /useHyperframesStudio/);
assert.match(page, /StudioSidebar/);
assert.match(page, /DirectorPanel/);
assert.match(page, /ProjectPanel/);
assert.match(page, /RenderPreview/);
assert.match(page, /StudioStatus/);
assert.ok(page.length < 5000, 'HyperframesStudioPage should stay as a thin route-level composition component');
assert.doesNotMatch(page, /api\./, 'Page must not call API directly; use the hook');

for (const file of [
  'StudioSidebar.jsx',
  'DirectorPanel.jsx',
  'ProjectPanel.jsx',
  'RenderPreview.jsx',
  'StudioStatus.jsx',
]) {
  const source = fs.readFileSync(`frontend-react/src/components/hyperframes-studio/${file}`, 'utf-8');
  assert.match(source, /export function/);
}

console.log('hyperframes studio page tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-hyperframes-studio-page.mjs
```

Expected: fail because components do not exist.

- [ ] **Step 3: Create `StudioStatus.jsx`**

```jsx
export function StudioStatus({ status }) {
  if (!status?.message) return null;
  return (
    <div className={`status ${status.type || 'info'}`}>
      {status.message}
    </div>
  );
}
```

- [ ] **Step 4: Create `StudioSidebar.jsx`**

```jsx
import { Button } from '../ui/Button.jsx';

export function StudioSidebar({
  awemeId,
  setAwemeId,
  runId,
  setRunId,
  runs,
  busy,
  canUseWorkflow,
  refreshRuns,
  generateBrief,
  generateProject,
  checkProject,
  renderVideo,
  inspectVideo,
}) {
  return (
    <aside className="hyperframesStudioSidebar">
      <h3>素材与控制</h3>
      <label>
        <span>抖音视频 ID</span>
        <input value={awemeId} onChange={event => setAwemeId(event.target.value.trim())} placeholder="输入抖音视频 ID" />
      </label>
      <Button variant="secondary" disabled={busy || !awemeId} onClick={() => refreshRuns()}>
        读取运行记录
      </Button>
      <label>
        <span>运行记录</span>
        <select value={runId} onChange={event => setRunId(event.target.value)}>
          <option value="">请选择运行记录</option>
          {runs.map(run => (
            <option key={run.run_id} value={run.run_id}>{run.run_id}</option>
          ))}
        </select>
      </label>
      <div className="studioActionStack">
        <Button disabled={!canUseWorkflow} onClick={() => generateBrief({ aspectRatio: '16:9', targetDurationSec: 60 })}>生成导演策划</Button>
        <Button disabled={!canUseWorkflow} onClick={() => generateProject({ aspectRatio: '16:9', targetDurationSec: 60 })}>生成 HyperFrames 工程</Button>
        <Button variant="secondary" disabled={!canUseWorkflow} onClick={checkProject}>校验工程</Button>
        <Button variant="secondary" disabled={!canUseWorkflow} onClick={renderVideo}>渲染视频</Button>
        <Button variant="secondary" disabled={!canUseWorkflow} onClick={inspectVideo}>抽帧质检</Button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Create `DirectorPanel.jsx`**

```jsx
export function DirectorPanel({ freeform }) {
  const brief = freeform?.brief?.data || null;
  return (
    <section className="hyperframesStudioPanel">
      <h3>导演内容</h3>
      {!brief ? (
        <p className="mutedText">暂无导演策划，请先生成导演策划。</p>
      ) : (
        <>
          <h4>{brief.title || '未命名短片'}</h4>
          <p>{brief.summary || '导演策划已生成。'}</p>
          <h4>旁白稿</h4>
          <pre className="studioTextPreview">{brief.narration || '暂无旁白。'}</pre>
          <h4>分镜</h4>
          <pre className="studioTextPreview">{JSON.stringify(brief.storyboard || [], null, 2)}</pre>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Create `ProjectPanel.jsx`**

```jsx
import { Button } from '../ui/Button.jsx';

export function ProjectPanel({
  freeform,
  selectedFile,
  setSelectedFile,
  fileContent,
  setFileContent,
  loadFile,
  saveFile,
  busy,
}) {
  const files = freeform?.project?.files || [];
  const checks = freeform?.checks || {};
  return (
    <section className="hyperframesStudioPanel">
      <h3>工程文件</h3>
      {files.length ? (
        <div className="studioFileTabs">
          {files.map(file => (
            <button
              key={file.name}
              type="button"
              className={file.name === selectedFile ? 'active' : ''}
              onClick={() => {
                setSelectedFile(file.name);
                loadFile(file.name);
              }}
            >
              {file.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="mutedText">暂无工程文件，请先生成 HyperFrames 工程。</p>
      )}
      <textarea
        className="studioCodeArea"
        value={fileContent}
        onChange={event => setFileContent(event.target.value)}
        placeholder="选择工程文件后可查看和编辑内容"
      />
      <Button size="sm" disabled={busy || !selectedFile} onClick={saveFile}>保存文件</Button>
      <div className="studioCheckGrid">
        <span>lint：{checks.lint || 'pending'}</span>
        <span>validate：{checks.validate || 'pending'}</span>
        <span>inspect：{checks.inspect || 'pending'}</span>
      </div>
      {checks.message ? <p className="mutedText">{checks.message}</p> : null}
    </section>
  );
}
```

- [ ] **Step 7: Create `RenderPreview.jsx`**

```jsx
export function RenderPreview({ freeform }) {
  const outputUrl = freeform?.render?.output_url || '';
  const contactSheetUrl = freeform?.visual_inspect?.contact_sheet_url || '';
  return (
    <section className="hyperframesStudioPanel">
      <h3>预览与下载</h3>
      {outputUrl ? (
        <>
          <video className="studioVideoPreview" src={outputUrl} controls />
          <a className="buttonLink" href={outputUrl} download>下载 output.mp4</a>
        </>
      ) : (
        <p className="mutedText">暂无视频，请先渲染。</p>
      )}
      {contactSheetUrl ? (
        <>
          <h4>抽帧联系表</h4>
          <img className="studioContactSheet" src={contactSheetUrl} alt="抽帧联系表" />
        </>
      ) : (
        <p className="mutedText">暂无抽帧联系表，请先执行抽帧质检。</p>
      )}
    </section>
  );
}
```

- [ ] **Step 8: Compose page**

Replace `frontend-react/src/pages/HyperframesStudioPage.jsx`:

```jsx
import { useHyperframesStudio } from '../hooks/useHyperframesStudio.js';
import { DirectorPanel } from '../components/hyperframes-studio/DirectorPanel.jsx';
import { ProjectPanel } from '../components/hyperframes-studio/ProjectPanel.jsx';
import { RenderPreview } from '../components/hyperframes-studio/RenderPreview.jsx';
import { StudioSidebar } from '../components/hyperframes-studio/StudioSidebar.jsx';
import { StudioStatus } from '../components/hyperframes-studio/StudioStatus.jsx';

export function HyperframesStudioPage({ awemeId = '', runId = '' }) {
  const studio = useHyperframesStudio({ initialAwemeId: awemeId, initialRunId: runId });
  return (
    <main className="page hyperframesStudioPage">
      <section className="workspaceHero compact">
        <div>
          <h2>高级成片</h2>
          <p>使用 HyperFrames skill 上下文生成自由动画工程，并完成校验、渲染和抽帧质检。</p>
        </div>
      </section>
      <StudioStatus status={studio.status} />
      <div className="hyperframesStudioLayout">
        <StudioSidebar {...studio} />
        <div className="hyperframesStudioMain">
          <DirectorPanel freeform={studio.freeform} />
          <ProjectPanel {...studio} />
          <RenderPreview freeform={studio.freeform} />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 9: Add test script entry**

In `package.json`, add `node tests/test-hyperframes-studio-page.mjs` after `node tests/test-hyperframes-studio-hook.mjs`.

- [ ] **Step 10: Run tests and build**

Run:

```bash
node tests/test-hyperframes-studio-page.mjs
npm run build:frontend
```

Expected: component-boundary test passes and frontend builds.

- [ ] **Step 11: Commit**

```bash
git add frontend-react/src/pages/HyperframesStudioPage.jsx frontend-react/src/components/hyperframes-studio tests/test-hyperframes-studio-page.mjs package.json
git commit -m "组件化实现高级成片工作台"
```

## Task 14: Studio Styles

**Files:**
- Modify: `frontend-react/src/styles.css`

- [ ] **Step 1: Add scoped styles**

Append:

```css
.hyperframesStudioPage {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hyperframesStudioLayout {
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.hyperframesStudioSidebar,
.hyperframesStudioPanel {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 16px;
}

.hyperframesStudioSidebar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: sticky;
  top: 12px;
}

.hyperframesStudioSidebar label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.studioActionStack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hyperframesStudioMain {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}

.hyperframesStudioPanel {
  min-width: 0;
}

.studioTextPreview,
.studioCodeArea {
  width: 100%;
  max-width: 100%;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.studioCodeArea {
  min-height: 300px;
  resize: vertical;
}

.studioFileTabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.studioFileTabs button {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-muted);
  color: var(--text);
  padding: 6px 10px;
}

.studioFileTabs button.active {
  border-color: var(--accent);
  color: var(--accent);
}

.studioCheckGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.studioVideoPreview,
.studioContactSheet {
  width: 100%;
  max-width: 100%;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #000;
}

@media (max-width: 1100px) {
  .hyperframesStudioLayout,
  .hyperframesStudioMain {
    grid-template-columns: 1fr;
  }

  .hyperframesStudioSidebar {
    position: static;
  }
}
```

If CSS variables like `--border` or `--surface` do not exist, use the nearest existing project variables after inspecting `styles.css`.

- [ ] **Step 2: Run frontend build**

Run:

```bash
npm run build:frontend
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend-react/src/styles.css
git commit -m "完善高级成片工作台样式"
```

## Task 15: AI Workspace Link

**Files:**
- Modify: `frontend-react/src/pages/AiWorkspace.jsx`
- Create or modify: `tests/test-ai-workspace-brief-ui.mjs`

- [ ] **Step 1: Write static UI test**

In `tests/test-ai-workspace-brief-ui.mjs`, add:

```js
assert.match(source, /打开高级成片工作台/);
assert.match(source, /hyperframes-studio/);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/test-ai-workspace-brief-ui.mjs
```

Expected: fail because link is absent.

- [ ] **Step 3: Add link in active run result area**

In `frontend-react/src/pages/AiWorkspace.jsx`, where active run workflow action buttons are displayed, add a small secondary link/button:

```jsx
                        <a
                          className="buttonLink secondary"
                          href={`/hyperframes-studio/${encodeURIComponent(awemeIdInput.trim())}/${encodeURIComponent(activeRun.run_id)}`}
                        >
                          打开高级成片工作台
                        </a>
```

Use the current variable names from `AiWorkspace.jsx`; if `awemeIdInput` is not the active source at that point, use the page's selected aweme id state.

- [ ] **Step 4: Run tests and build**

Run:

```bash
node tests/test-ai-workspace-brief-ui.mjs
npm run build:frontend
```

Expected: test passes and build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend-react/src/pages/AiWorkspace.jsx tests/test-ai-workspace-brief-ui.mjs
git commit -m "添加高级成片工作台入口"
```

## Task 16: End-to-End Verification

**Files:**
- No code changes unless verification reveals defects.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
node tests/test-hyperframes-skill-context.js
node tests/test-hyperframes-freeform-project.js
node tests/test-hyperframes-freeform-agent.js
node tests/test-hyperframes-freeform-quality.js
node tests/test-agent-runs.js
```

Expected: all pass.

- [ ] **Step 2: Run focused frontend/static tests**

Run:

```bash
node tests/test-hyperframes-studio-api-client.mjs
node tests/test-hyperframes-studio-hook.mjs
node tests/test-hyperframes-studio-page.mjs
node tests/test-persistent-routes.mjs
node tests/test-ai-workspace-brief-ui.mjs
```

Expected: all pass.

- [ ] **Step 3: Run frontend build**

Run:

```bash
npm run build:frontend
```

Expected: Vite build succeeds.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Manual smoke test**

Start app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/hyperframes-studio
```

Expected:

- 页面显示“高级成片”。
- 组件分三块呈现，不出现文本溢出。
- 输入 aweme_id 后点击“读取运行记录”显示 loading。
- 没有 run 时显示中文错误或空状态。
- 从 AI 工作台点击“打开高级成片工作台”能进入带参数页面。

- [ ] **Step 6: Final commit if fixes were needed**

If verification required fixes:

```bash
git add <fixed files>
git commit -m "修复高级成片工作台验证问题"
```

## Self-Review

- Spec coverage: This plan covers the new page, componentized frontend, skill context loading, freeform project generation, check/render/inspect, file access, AI workspace entry, and tests.
- Componentization: `HyperframesStudioPage.jsx` is explicitly constrained to a thin route-level shell, with state in `useHyperframesStudio.js` and UI split into five components.
- Existing flow isolation: Existing `ai_storyboard_cards` project/render functions are not replaced; all new routes use `/hyperframes-freeform`.
- Placeholder scan: No task uses TBD/TODO placeholders. Each code task includes concrete files, code, commands, and expected outcomes.
- Type consistency: The plan consistently uses `hyperframes_freeform`, `builtin_skill_context`, `generateHyperframesFreeform*`, and `/hyperframes-freeform/*`.
